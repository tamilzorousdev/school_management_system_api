import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppException, AuthUser } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { addDays, weekday } from '../../shared/school-days';
import { NotificationsService } from '../notifications/notifications.service';
import { BellPeriodDto } from '../timetable/dto/timetable.dto';
import { TimetableService } from '../timetable/timetable.service';
import {
  AbsentPeriodDto,
  AbsentTeacherDto,
  AssignSubstituteDto,
  AutoAssignResultDto,
  CombineClassDto,
  CombinedIntoDto,
  CombineOptionsDto,
  CombineTargetDto,
  StudentGroupCountDto,
  FreeTeacherDto,
  FreeTeachersDto,
  MySubstitutionDto,
  SubstituteBoardDto,
} from './dto/substitute.dto';
import { MergeGroup, SubstitutionMerge } from './entities/substitution-merge.entity';
import { CoverKind, Substitution } from './entities/substitution.entity';
import { yearClause } from '../../shared/year-context';

interface SlotRow {
  id: number;
  day_of_week: number;
  period_no: number;
  section_id: number;
  class_name: string;
  section_name: string;
  subject_id: number;
  subject_name: string;
  subject_code: string;
  teacher_user_id: number | null;
  room: string | null;
}

interface Cover {
  substitution_id: number;
  kind: CoverKind;
  substitute: { id: number; name: string } | null;
  note: string | null;
  combined_into: CombinedIntoDto[];
}

const NO_COVER = { substitution_id: null, kind: null, substitute: null, note: null, combined_into: [] };

export function groupSize(counts: StudentGroupCountDto | undefined, group: MergeGroup): number {
  if (!counts) return 0;
  if (group === 'boys') return counts.boys;
  if (group === 'girls') return counts.girls;
  return counts.total;
}

const GROUP_WORDS: Record<MergeGroup, { en: string; ta: string }> = {
  all: { en: 'students', ta: 'மாணவ மாணவிகள்' },
  boys: { en: 'boys', ta: 'மாணவர்கள்' },
  girls: { en: 'girls', ta: 'மாணவிகள்' },
};

interface CandidateRow {
  user_id: number;
  name: string;
  department: string | null;
  periods_today: string;
  substitutions_this_week: string;
  same_subject: boolean;
  knows_section: boolean;
}

export interface CandidateScore {
  same_subject: boolean;
  knows_section: boolean;
  periods_today: number;
  substitutions_this_week: number;
  name: string;
}

export function rankCandidates<T extends CandidateScore>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      Number(b.same_subject) - Number(a.same_subject) ||
      Number(b.knows_section) - Number(a.knows_section) ||
      a.periods_today - b.periods_today ||
      a.substitutions_this_week - b.substitutions_this_week ||
      a.name.localeCompare(b.name),
  );
}

export function weekRange(date: string): { from: string; to: string } {
  const day = weekday(date);
  const monday = addDays(date, day === 0 ? -6 : 1 - day);
  return { from: monday, to: addDays(monday, 5) };
}

const SLOT_SELECT = `SELECT t.id, t.day_of_week, t.period_no, t.section_id, c.name AS class_name, sec.name AS section_name,
  t.subject_id, s.name AS subject_name, s.code AS subject_code, t.teacher_user_id, t.room
  FROM timetable_slots t
  JOIN sections sec ON sec.id = t.section_id JOIN classes c ON c.id = sec.class_id
  JOIN subjects s ON s.id = t.subject_id
  JOIN academic_years y ON y.id = t.academic_year_id AND ${yearClause('y')}`;

const displayDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' });

@Injectable()
export class SubstitutesService {
  private readonly logger = new Logger('Substitutes');

  constructor(
    @InjectRepository(Substitution) private readonly substitutions: Repository<Substitution>,
    @InjectRepository(SubstitutionMerge) private readonly merges: Repository<SubstitutionMerge>,
    private readonly timetable: TimetableService,
    private readonly notifications: NotificationsService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async board(schoolId: number, date: string): Promise<SubstituteBoardDto> {
    const day = weekday(date);
    const holiday = await this.holidayName(schoolId, date);
    const empty = {
      date,
      day_of_week: day,
      working_day: day !== 0 && !holiday,
      holiday,
      absent_teachers: 0,
      periods: 0,
      covered: 0,
      uncovered: 0,
      teachers: [] as AbsentTeacherDto[],
    };
    if (!empty.working_day) return empty;
    const absent = await this.absentTeachers(schoolId, date);
    if (!absent.size) return empty;
    const [periods, slots] = await Promise.all([
      this.timetable.periods(schoolId),
      this.dataSource.query(
        `${SLOT_SELECT} WHERE t.school_id = $1 AND t.day_of_week = $2 AND t.teacher_user_id = ANY($3) ORDER BY t.period_no`,
        [schoolId, day, [...absent.keys()]],
      ) as Promise<SlotRow[]>,
    ]);
    const coverBySlot = await this.covers(
      schoolId,
      date,
      slots.map((slot) => Number(slot.id)),
    );
    const teachers = [...absent.entries()].map(([userId, info]) => ({
      teacher: { id: userId, name: info.name },
      reason: info.reason,
      periods: slots
        .filter((slot) => Number(slot.teacher_user_id) === userId)
        .map((slot) => ({ ...this.presentSlot(slot, periods), ...(coverBySlot.get(Number(slot.id)) ?? NO_COVER) })),
    }));
    const all = teachers.flatMap((teacher) => teacher.periods);
    const covered = all.filter((period) => period.substitution_id).length;
    return {
      ...empty,
      absent_teachers: teachers.length,
      periods: all.length,
      covered,
      uncovered: all.length - covered,
      teachers: teachers.sort((a, b) => a.teacher.name.localeCompare(b.teacher.name)),
    };
  }

  async free(schoolId: number, date: string, slotId: number): Promise<FreeTeachersDto> {
    const slot = await this.slot(schoolId, slotId);
    const periods = await this.timetable.periods(schoolId);
    const absent = await this.absentTeachers(schoolId, date);
    const week = weekRange(date);
    const rows: CandidateRow[] = await this.dataSource.query(
      `SELECT st.user_id, u.name, st.department,
         (SELECT COUNT(*) FROM timetable_slots t JOIN academic_years y ON y.id = t.academic_year_id AND ${yearClause('y')}
            WHERE t.teacher_user_id = st.user_id AND t.day_of_week = $3)
         + (SELECT COUNT(*) FROM substitutions sb WHERE sb.substitute_user_id = st.user_id AND sb.date = $2) AS periods_today,
         (SELECT COUNT(*) FROM substitutions sb WHERE sb.substitute_user_id = st.user_id
            AND sb.date BETWEEN $5 AND $6) AS substitutions_this_week,
         EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.teacher_user_id = st.user_id
            AND ta.subject_id = $7 AND ta.deleted_at IS NULL) AS same_subject,
         EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.teacher_user_id = st.user_id
            AND ta.section_id = $8 AND ta.deleted_at IS NULL) AS knows_section
       FROM staff st JOIN users u ON u.id = st.user_id AND u.deleted_at IS NULL AND u.status = 'active'
       WHERE st.school_id = $1 AND st.deleted_at IS NULL AND st.status = 'active' AND st.staff_type = 'teaching'
         AND NOT (st.user_id = ANY($9))
         AND NOT EXISTS (SELECT 1 FROM timetable_slots t JOIN academic_years y ON y.id = t.academic_year_id AND ${yearClause('y')}
            WHERE t.teacher_user_id = st.user_id AND t.day_of_week = $3 AND t.period_no = $4)
         AND NOT EXISTS (SELECT 1 FROM substitutions sb WHERE sb.substitute_user_id = st.user_id
            AND sb.date = $2 AND sb.period_no = $4 AND sb.slot_id <> $10)`,
      [
        schoolId,
        date,
        slot.day_of_week,
        slot.period_no,
        week.from,
        week.to,
        slot.subject_id,
        slot.section_id,
        [...absent.keys()],
        slot.id,
      ],
    );
    const cover = (await this.covers(schoolId, date, [slot.id])).get(slot.id) ?? NO_COVER;
    const teachers: FreeTeacherDto[] = rankCandidates(
      rows.map((row) => ({
        teacher: { id: Number(row.user_id), name: row.name },
        name: row.name,
        department: row.department,
        periods_today: Number(row.periods_today),
        substitutions_this_week: Number(row.substitutions_this_week),
        same_subject: Boolean(row.same_subject),
        knows_section: Boolean(row.knows_section),
      })),
    ).map((row) => ({
      teacher: row.teacher,
      department: row.department,
      periods_today: row.periods_today,
      substitutions_this_week: row.substitutions_this_week,
      same_subject: row.same_subject,
      knows_section: row.knows_section,
    }));
    return {
      period: { ...this.presentSlot(slot, periods), ...cover },
      teachers,
    };
  }

  async assign(schoolId: number, dto: AssignSubstituteDto, actor: AuthUser): Promise<SubstituteBoardDto> {
    await this.assertBookable(schoolId, dto.date);
    const slot = await this.slot(schoolId, dto.slot_id);
    if (slot.day_of_week !== weekday(dto.date)) {
      throw AppException.validation([{ field: 'slot_id', message: 'This period is not on that day of the week' }]);
    }
    const absent = await this.absentTeachers(schoolId, dto.date);
    if (!slot.teacher_user_id || !absent.has(Number(slot.teacher_user_id))) {
      throw AppException.conflict(
        'The teacher of this period is not on leave or absent that day',
        'TEACHER_NOT_ABSENT',
      );
    }
    const options = await this.free(schoolId, dto.date, slot.id);
    const chosen = options.teachers.find((row) => row.teacher.id === dto.substitute_user_id);
    if (!chosen) {
      throw AppException.conflict(
        'This teacher is not free in that period. Choose one from the free list.',
        'SUBSTITUTE_BUSY',
      );
    }
    await this.save(schoolId, slot, dto.date, dto.substitute_user_id, dto.note ?? null, actor.id);
    await this.notify(schoolId, slot, dto.date, dto.substitute_user_id, absent.get(Number(slot.teacher_user_id))!.name);
    return this.board(schoolId, dto.date);
  }

  async autoAssign(schoolId: number, date: string, actor: AuthUser): Promise<AutoAssignResultDto> {
    await this.assertBookable(schoolId, date);
    const before = await this.board(schoolId, date);
    let assigned = 0;
    let left = 0;
    for (const teacher of before.teachers) {
      for (const period of teacher.periods.filter((item) => !item.substitution_id)) {
        const options = await this.free(schoolId, date, period.slot_id);
        const best = options.teachers[0];
        if (!best) {
          left += 1;
          continue;
        }
        const slot = await this.slot(schoolId, period.slot_id);
        await this.save(schoolId, slot, date, best.teacher.id, null, actor.id);
        await this.notify(schoolId, slot, date, best.teacher.id, teacher.teacher.name);
        assigned += 1;
      }
    }
    return { assigned, left_uncovered: left, board: await this.board(schoolId, date) };
  }

  async combineOptions(schoolId: number, date: string, slotId: number): Promise<CombineOptionsDto> {
    const slot = await this.slot(schoolId, slotId);
    const [periods, absent, candidates] = await Promise.all([
      this.timetable.periods(schoolId),
      this.absentTeachers(schoolId, date),
      this.dataSource.query(
        `${SLOT_SELECT} WHERE t.school_id = $1 AND t.day_of_week = $2 AND t.period_no = $3 AND t.section_id <> $4
           AND sec.class_id = (SELECT class_id FROM sections WHERE id = $4) ORDER BY sec.name`,
        [schoolId, weekday(date), slot.period_no, slot.section_id],
      ) as Promise<SlotRow[]>,
    ]);
    const candidateIds = candidates.map((row) => Number(row.id));
    const [candidateCovers, ownCover, teacherNames, joining, counts] = await Promise.all([
      this.covers(schoolId, date, candidateIds),
      this.covers(schoolId, date, [slot.id]),
      this.userNames(candidates.map((row) => Number(row.teacher_user_id)).filter(Boolean)),
      this.joiningStudents(date, candidateIds),
      this.groupCounts([slot.section_id, ...candidates.map((row) => Number(row.section_id))]),
    ]);
    const targets: CombineTargetDto[] = candidates.flatMap((row) => {
      const own = row.teacher_user_id ? Number(row.teacher_user_id) : null;
      const cover = candidateCovers.get(Number(row.id));
      const teacher =
        own && !absent.has(own) && teacherNames.has(own)
          ? { id: own, name: teacherNames.get(own)! }
          : cover?.kind === 'proxy'
            ? cover.substitute
            : null;
      if (!teacher) return [];
      const presented = this.presentSlot(row, periods);
      return [
        {
          slot_id: presented.slot_id,
          section: presented.section,
          subject: presented.subject,
          teacher,
          room: row.room,
          students: groupSize(counts.get(Number(row.section_id)), 'all'),
          joining: joining.get(Number(row.id)) ?? 0,
        },
      ];
    });
    return {
      period: { ...this.presentSlot(slot, periods), ...(ownCover.get(slot.id) ?? NO_COVER) },
      students: counts.get(Number(slot.section_id)) ?? { total: 0, boys: 0, girls: 0 },
      targets,
    };
  }

  async combine(schoolId: number, dto: CombineClassDto, actor: AuthUser): Promise<SubstituteBoardDto> {
    await this.assertBookable(schoolId, dto.date);
    const slot = await this.slot(schoolId, dto.slot_id);
    if (slot.day_of_week !== weekday(dto.date)) {
      throw AppException.validation([{ field: 'slot_id', message: 'This period is not on that day of the week' }]);
    }
    const absent = await this.absentTeachers(schoolId, dto.date);
    if (!slot.teacher_user_id || !absent.has(Number(slot.teacher_user_id))) {
      throw AppException.conflict(
        'The teacher of this period is not on leave or absent that day',
        'TEACHER_NOT_ABSENT',
      );
    }
    if (dto.mode === 'split' && dto.boys_section_id === dto.girls_section_id) {
      throw AppException.validation([
        {
          field: 'girls_section_id',
          message: 'Choose a different section for the girls, or send the whole class to one section',
        },
      ]);
    }
    const plan: { section_id: number; group: MergeGroup }[] =
      dto.mode === 'whole'
        ? [{ section_id: dto.section_id!, group: 'all' }]
        : [
            { section_id: dto.boys_section_id!, group: 'boys' },
            { section_id: dto.girls_section_id!, group: 'girls' },
          ];
    const options = await this.combineOptions(schoolId, dto.date, slot.id);
    const chosen = plan.map((item) => {
      const target = options.targets.find((row) => row.section.id === item.section_id);
      if (!target) {
        throw AppException.conflict(
          'That section has no class with a teacher in this period. Choose one from the list.',
          'SECTION_NOT_AVAILABLE',
        );
      }
      return { ...item, target };
    });
    await this.dataSource.transaction(async (manager) => {
      const mergeRepo = manager.getRepository(SubstitutionMerge);
      const saved = await this.upsert(manager.getRepository(Substitution), schoolId, slot, dto.date, {
        kind: 'combine',
        substitute_user_id: null,
        note: dto.note ?? null,
        assigned_by: actor.id,
      });
      await mergeRepo.delete({ substitution_id: saved.id });
      await mergeRepo.save(
        chosen.map((item) =>
          mergeRepo.create({
            substitution_id: saved.id,
            school_id: schoolId,
            target_section_id: item.target.section.id,
            target_slot_id: item.target.slot_id,
            target_teacher_user_id: item.target.teacher.id,
            student_group: item.group,
          }),
        ),
      );
    });
    const absentName = absent.get(Number(slot.teacher_user_id))!.name;
    for (const item of chosen) {
      await this.notifyCombined(
        schoolId,
        slot,
        dto.date,
        item.target,
        item.group,
        groupSize(options.students, item.group),
        absentName,
      );
    }
    return this.board(schoolId, dto.date);
  }

  async cancel(schoolId: number, id: number): Promise<SubstituteBoardDto> {
    const row = await this.substitutions.findOneBy({ id, school_id: schoolId });
    if (!row) throw AppException.notFound('Substitution not found', 'SUBSTITUTION_NOT_FOUND');
    await this.substitutions.delete(id);
    return this.board(schoolId, row.date);
  }

  async mine(user: AuthUser): Promise<MySubstitutionDto[]> {
    if (!user.school_id) return [];
    const today = todayIn(this.app.timeZone);
    const periods = await this.timetable.periods(user.school_id);
    const rows: (SlotRow & {
      substitution_id: number;
      date: string;
      note: string | null;
      absent_id: number | null;
      absent_name: string | null;
    })[] = await this.dataSource.query(
      `SELECT sb.id AS substitution_id, to_char(sb.date, 'YYYY-MM-DD') AS date, sb.note, a.id AS absent_id, a.name AS absent_name,
                t.id, t.day_of_week, t.period_no, t.section_id, c.name AS class_name, sec.name AS section_name,
                t.subject_id, s.name AS subject_name, s.code AS subject_code, t.teacher_user_id, t.room
         FROM substitutions sb
         JOIN timetable_slots t ON t.id = sb.slot_id
         JOIN sections sec ON sec.id = t.section_id JOIN classes c ON c.id = sec.class_id
         JOIN subjects s ON s.id = t.subject_id
         LEFT JOIN users a ON a.id = sb.absent_user_id
         WHERE sb.substitute_user_id = $1 AND sb.date BETWEEN $2 AND $3
         ORDER BY sb.date, t.period_no`,
      [user.id, today, addDays(today, 7)],
    );
    return rows.map((row) => {
      const slot = this.presentSlot(row, periods);
      return {
        id: Number(row.substitution_id),
        date: row.date,
        period_no: slot.period_no,
        start_time: slot.start_time,
        end_time: slot.end_time,
        section: slot.section,
        subject: slot.subject,
        room: slot.room,
        absent_teacher: row.absent_id ? { id: Number(row.absent_id), name: row.absent_name ?? '' } : null,
        note: row.note,
      };
    });
  }

  async absentTeachers(schoolId: number, date: string): Promise<Map<number, { name: string; reason: string }>> {
    const rows: { user_id: number; name: string; reason: string; source: string }[] = await this.dataSource.query(
      `SELECT l.user_id, u.name, lt.name AS reason, 'leave' AS source FROM staff_leave_requests l
         JOIN users u ON u.id = l.user_id JOIN leave_types lt ON lt.id = l.leave_type_id
         WHERE l.school_id = $1 AND l.status = 'approved' AND l.deleted_at IS NULL AND l.from_date <= $2 AND l.to_date >= $2
       UNION ALL
       SELECT a.user_id, u.name, 'Absent' AS reason, 'attendance' AS source FROM staff_attendance a
         JOIN users u ON u.id = a.user_id
         WHERE a.school_id = $1 AND a.date = $2 AND a.status = 'absent'`,
      [schoolId, date],
    );
    const absent = new Map<number, { name: string; reason: string }>();
    for (const row of rows.sort((a, b) => (a.source === 'leave' ? -1 : 1) - (b.source === 'leave' ? -1 : 1))) {
      if (!absent.has(Number(row.user_id))) absent.set(Number(row.user_id), { name: row.name, reason: row.reason });
    }
    return absent;
  }

  private async save(
    schoolId: number,
    slot: SlotRow,
    date: string,
    substituteId: number,
    note: string | null,
    actorId: number,
  ): Promise<void> {
    const saved = await this.upsert(this.substitutions, schoolId, slot, date, {
      kind: 'proxy',
      substitute_user_id: substituteId,
      note,
      assigned_by: actorId,
    });
    await this.merges.delete({ substitution_id: saved.id });
  }

  private async upsert(
    repo: Repository<Substitution>,
    schoolId: number,
    slot: SlotRow,
    date: string,
    fields: Pick<Substitution, 'kind' | 'substitute_user_id' | 'note' | 'assigned_by'>,
  ): Promise<Substitution> {
    const existing = await repo.findOneBy({ slot_id: slot.id, date });
    return repo.save(
      repo.merge(existing ?? repo.create(), {
        school_id: schoolId,
        date,
        slot_id: Number(slot.id),
        section_id: Number(slot.section_id),
        period_no: Number(slot.period_no),
        subject_id: Number(slot.subject_id),
        absent_user_id: slot.teacher_user_id ? Number(slot.teacher_user_id) : null,
        ...fields,
      }),
    );
  }

  private async covers(schoolId: number, date: string, slotIds: number[]): Promise<Map<number, Cover>> {
    const result = new Map<number, Cover>();
    if (!slotIds.length) return result;
    const rows: {
      id: number;
      slot_id: number;
      section_id: number;
      kind: CoverKind;
      note: string | null;
      user_id: number | null;
      name: string | null;
    }[] = await this.dataSource.query(
      `SELECT sb.id, sb.slot_id, sb.section_id, sb.kind, sb.note, u.id AS user_id, u.name FROM substitutions sb
       LEFT JOIN users u ON u.id = sb.substitute_user_id
       WHERE sb.school_id = $1 AND sb.date = $2 AND sb.slot_id = ANY($3)`,
      [schoolId, date, slotIds],
    );
    if (!rows.length) return result;
    const [merges, counts] = await Promise.all([
      this.dataSource.query(
        `SELECT m.substitution_id, m.student_group, sec.id AS section_id, c.name AS class_name, sec.name AS section_name,
                tu.id AS teacher_id, tu.name AS teacher_name
         FROM substitution_merges m
         JOIN sections sec ON sec.id = m.target_section_id JOIN classes c ON c.id = sec.class_id
         LEFT JOIN users tu ON tu.id = m.target_teacher_user_id
         WHERE m.substitution_id = ANY($1) ORDER BY m.id`,
        [rows.map((row) => row.id)],
      ) as Promise<
        {
          substitution_id: number;
          student_group: MergeGroup;
          section_id: number;
          class_name: string;
          section_name: string;
          teacher_id: number | null;
          teacher_name: string | null;
        }[]
      >,
      this.groupCounts(rows.map((row) => Number(row.section_id))),
    ]);
    for (const row of rows) {
      result.set(Number(row.slot_id), {
        substitution_id: Number(row.id),
        kind: row.kind,
        substitute: row.user_id ? { id: Number(row.user_id), name: row.name ?? '' } : null,
        note: row.note,
        combined_into: merges
          .filter((merge) => Number(merge.substitution_id) === Number(row.id))
          .map((merge) => ({
            section: { id: Number(merge.section_id), name: `${merge.class_name} - ${merge.section_name}` },
            group: merge.student_group,
            students: groupSize(counts.get(Number(row.section_id)), merge.student_group),
            teacher: merge.teacher_id ? { id: Number(merge.teacher_id), name: merge.teacher_name ?? '' } : null,
          })),
      });
    }
    return result;
  }

  private async groupCounts(sectionIds: number[]): Promise<Map<number, StudentGroupCountDto>> {
    const ids = [...new Set(sectionIds)];
    if (!ids.length) return new Map();
    const rows: { section_id: number; total: string; boys: string }[] = await this.dataSource.query(
      `SELECT e.section_id, COUNT(*) AS total, COUNT(*) FILTER (WHERE s.gender = 'male') AS boys
       FROM student_enrollments e
       JOIN academic_years y ON y.id = e.academic_year_id AND ${yearClause('y')}
       JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL AND s.status = 'active'
       WHERE e.section_id = ANY($1) GROUP BY e.section_id`,
      [ids],
    );
    return new Map(
      rows.map((row) => [
        Number(row.section_id),
        { total: Number(row.total), boys: Number(row.boys), girls: Number(row.total) - Number(row.boys) },
      ]),
    );
  }

  private async joiningStudents(date: string, targetSlotIds: number[]): Promise<Map<number, number>> {
    if (!targetSlotIds.length) return new Map();
    const rows: { target_slot_id: number; section_id: number; student_group: MergeGroup }[] =
      await this.dataSource.query(
        `SELECT m.target_slot_id, sb.section_id, m.student_group FROM substitution_merges m
         JOIN substitutions sb ON sb.id = m.substitution_id
         WHERE sb.date = $1 AND m.target_slot_id = ANY($2)`,
        [date, targetSlotIds],
      );
    const counts = await this.groupCounts(rows.map((row) => Number(row.section_id)));
    const result = new Map<number, number>();
    for (const row of rows) {
      const key = Number(row.target_slot_id);
      result.set(key, (result.get(key) ?? 0) + groupSize(counts.get(Number(row.section_id)), row.student_group));
    }
    return result;
  }

  private async userNames(ids: number[]): Promise<Map<number, string>> {
    if (!ids.length) return new Map();
    const rows: { id: number; name: string }[] = await this.dataSource.query(
      `SELECT id, name FROM users WHERE id = ANY($1) AND deleted_at IS NULL`,
      [ids],
    );
    return new Map(rows.map((row) => [Number(row.id), row.name]));
  }

  private async notifyCombined(
    schoolId: number,
    slot: SlotRow,
    date: string,
    target: CombineTargetDto,
    group: MergeGroup,
    count: number,
    absentName: string,
  ) {
    const periods = await this.timetable.periods(schoolId);
    const period = periods.find((item) => item.period_no === Number(slot.period_no));
    const [school] = await this.dataSource.query(`SELECT name FROM schools WHERE id = $1`, [schoolId]);
    await this.notifications
      .dispatch({
        template: 'CLASS_COMBINED',
        audience: { user_ids: [target.teacher.id] },
        data: {
          from: `${slot.class_name} - ${slot.section_name}`,
          section: target.section.name,
          group: GROUP_WORDS[group].en,
          group_ta: GROUP_WORDS[group].ta,
          count: String(count),
          period: String(slot.period_no),
          time: period ? `${period.start_time}-${period.end_time}` : '',
          date: displayDate(date),
          absent: absentName,
          school: school?.name ?? '',
          on_date: date,
          section_id: String(target.section.id),
        },
      })
      .catch((error: Error) => this.logger.warn(`Combined class alert for slot ${slot.id} not sent: ${error.message}`));
  }

  private async notify(schoolId: number, slot: SlotRow, date: string, userId: number, absentName: string) {
    const periods = await this.timetable.periods(schoolId);
    const period = periods.find((item) => item.period_no === Number(slot.period_no));
    const [school] = await this.dataSource.query(`SELECT name FROM schools WHERE id = $1`, [schoolId]);
    await this.notifications
      .dispatch({
        template: 'SUBSTITUTE_ASSIGNED',
        audience: { user_ids: [userId] },
        data: {
          section: `${slot.class_name} - ${slot.section_name}`,
          period: String(slot.period_no),
          time: period ? `${period.start_time}-${period.end_time}` : '',
          subject: slot.subject_name,
          date: displayDate(date),
          on_date: date,
          absent: absentName,
          room: slot.room ? ` Room ${slot.room}.` : '',
          school: school?.name ?? '',
        },
      })
      .catch((error: Error) => this.logger.warn(`Substitute alert for slot ${slot.id} not sent: ${error.message}`));
  }

  private async assertBookable(schoolId: number, date: string): Promise<void> {
    if (date < todayIn(this.app.timeZone)) {
      throw AppException.validation([{ field: 'date', message: 'Substitutes can be set for today or later' }]);
    }
    if (weekday(date) === 0) throw AppException.badRequest('That day is a Sunday', 'NOT_A_SCHOOL_DAY');
    const holiday = await this.holidayName(schoolId, date);
    if (holiday) throw AppException.badRequest(`${date} is a holiday: ${holiday}`, 'HOLIDAY');
  }

  private async slot(schoolId: number, slotId: number): Promise<SlotRow> {
    const [slot]: SlotRow[] = await this.dataSource.query(`${SLOT_SELECT} WHERE t.school_id = $1 AND t.id = $2`, [
      schoolId,
      slotId,
    ]);
    if (!slot) throw AppException.notFound('Timetable period not found', 'SLOT_NOT_FOUND');
    return { ...slot, id: Number(slot.id), day_of_week: Number(slot.day_of_week), period_no: Number(slot.period_no) };
  }

  private async holidayName(schoolId: number, date: string): Promise<string | null> {
    const [row] = await this.dataSource.query(
      `SELECT name FROM holidays WHERE school_id = $1 AND deleted_at IS NULL AND type <> 'event'
       AND date <= $2 AND COALESCE(end_date, date) >= $2 LIMIT 1`,
      [schoolId, date],
    );
    return row?.name ?? null;
  }

  private presentSlot(
    slot: SlotRow,
    periods: BellPeriodDto[],
  ): Omit<AbsentPeriodDto, 'substitution_id' | 'kind' | 'substitute' | 'note' | 'combined_into'> {
    const period = periods.find((item) => item.period_no === Number(slot.period_no));
    return {
      slot_id: Number(slot.id),
      period_no: Number(slot.period_no),
      start_time: period?.start_time ?? '',
      end_time: period?.end_time ?? '',
      section: { id: Number(slot.section_id), name: `${slot.class_name} - ${slot.section_name}` },
      subject: { id: Number(slot.subject_id), name: slot.subject_name, code: slot.subject_code },
      room: slot.room,
    };
  }
}
