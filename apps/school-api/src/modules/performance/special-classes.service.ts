import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AppException, AuthUser } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { holidaySet, weekday } from '../../shared/school-days';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import { NotificationsService } from '../notifications/notifications.service';
import { DAY_NAMES } from '../timetable/dto/timetable.dto';
import {
  SpecialClassDto,
  SpecialClassInputDto,
  SpecialClassSettingsResultDto,
  SpecialMarkDto,
  SpecialRosterDto,
  UpdateSpecialClassDto,
} from './dto/performance.dto';
import { SpecialClass, SpecialClassStudent } from './entities/special-class.entity';
import {
  DAY_SHORT,
  firstClash,
  Occurrence,
  occurrences,
  runsOn,
  timesOverlap,
  to12,
  whenText,
  Window,
} from './special-class.logic';

interface SpecialRow {
  id: number;
  kind: 'extra' | 'special';
  timing: 'period' | 'extra_time';
  title: string;
  notes: string | null;
  section_id: number;
  class_id: number;
  section_name: string;
  class_name: string;
  subject_id: number | null;
  subject_name: string | null;
  teacher_user_id: number;
  teacher_name: string;
  day_of_week: number | null;
  period_no: number | null;
  days: number[] | null;
  own_start: string | null;
  own_end: string | null;
  start_date: string | null;
  end_date: string | null;
  day_part: SpecialClassDto['day_part'];
  bell_start: string | null;
  bell_end: string | null;
  year_from: string;
  year_to: string;
  students: { id: number; name: string; roll_no: number | null }[] | null;
}

type Loaded = SpecialClassDto & { year: Window };

const STUDENT_JSON = `json_agg(json_build_object(
  'id', s.id, 'name', concat_ws(' ', s.first_name, s.last_name), 'roll_no', e.roll_no)
  ORDER BY e.roll_no NULLS LAST, s.first_name)`;

const LIST_SQL = `
  SELECT sc.id, sc.kind, sc.timing, sc.title, sc.notes, sc.section_id, sec.class_id,
         sec.name AS section_name, c.name AS class_name,
         sc.subject_id, sub.name AS subject_name, sc.teacher_user_id, u.name AS teacher_name,
         sc.day_of_week, sc.period_no, sc.days, sc.start_time AS own_start, sc.end_time AS own_end,
         to_char(sc.start_date, 'YYYY-MM-DD') AS start_date, to_char(sc.end_date, 'YYYY-MM-DD') AS end_date,
         sc.day_part, b.start_time AS bell_start, b.end_time AS bell_end,
         to_char(y.start_date, 'YYYY-MM-DD') AS year_from, to_char(y.end_date, 'YYYY-MM-DD') AS year_to,
         CASE WHEN sc.kind = 'special' THEN
           (SELECT ${STUDENT_JSON} FROM student_enrollments e
              JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL AND s.status = 'active'
             WHERE e.section_id = sc.section_id AND e.academic_year_id = sc.academic_year_id)
         ELSE
           (SELECT ${STUDENT_JSON} FROM special_class_students st
              JOIN students s ON s.id = st.student_id AND s.deleted_at IS NULL
              LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = sc.academic_year_id
             WHERE st.special_class_id = sc.id)
         END AS students
  FROM special_classes sc
  JOIN sections sec ON sec.id = sc.section_id
  JOIN classes c ON c.id = sec.class_id
  JOIN academic_years y ON y.id = sc.academic_year_id
  JOIN users u ON u.id = sc.teacher_user_id
  LEFT JOIN subjects sub ON sub.id = sc.subject_id
  LEFT JOIN LATERAL (
    SELECT bp.start_time, bp.end_time
    FROM bell_periods bp
    WHERE bp.school_id = sc.school_id AND bp.period_no = sc.period_no
      AND (bp.class_id = sec.class_id OR bp.class_id IS NULL)
    ORDER BY bp.class_id NULLS LAST LIMIT 1
  ) b ON true
  WHERE sc.school_id = $1 AND sc.deleted_at IS NULL`;

const SCHEDULE_FIELDS = [
  'timing',
  'day_of_week',
  'period_no',
  'days',
  'start_time',
  'end_time',
  'start_date',
  'end_date',
] as const;

@Injectable()
export class SpecialClassesService {
  private readonly logger = new Logger('SpecialClasses');

  constructor(
    @InjectRepository(SpecialClass) private readonly specials: Repository<SpecialClass>,
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  list(schoolId: number, filter: { section_id?: number; teacher_user_id?: number } = {}): Promise<SpecialClassDto[]> {
    const where: string[] = [];
    const params: number[] = [];
    if (filter.section_id) where.push(`AND sc.section_id = $${params.push(filter.section_id) + 1}`);
    if (filter.teacher_user_id) where.push(`AND sc.teacher_user_id = $${params.push(filter.teacher_user_id) + 1}`);
    return this.query(schoolId, where.join(' '), params).then((rows) => rows.map(publicOf));
  }

  forTeacher(schoolId: number, userId: number): Promise<SpecialClassDto[]> {
    return this.list(schoolId, { teacher_user_id: userId });
  }

  async forStudent(schoolId: number, studentId: number): Promise<SpecialClassDto[]> {
    const rows = await this.query(
      schoolId,
      `AND (EXISTS (SELECT 1 FROM special_class_students x WHERE x.special_class_id = sc.id AND x.student_id = $2)
            OR (sc.kind = 'special' AND EXISTS (
              SELECT 1 FROM student_enrollments x
              WHERE x.section_id = sc.section_id AND x.academic_year_id = sc.academic_year_id AND x.student_id = $2)))`,
      [studentId],
    );
    const counts: { special_class_id: number; status: string; count: string }[] = rows.length
      ? await this.dataSource.query(
          `SELECT special_class_id, status, COUNT(*) AS count FROM special_class_attendance
           WHERE student_id = $1 AND special_class_id = ANY($2) GROUP BY special_class_id, status`,
          [studentId, rows.map((row) => row.id)],
        )
      : [];
    return rows.map((row) => {
      const own = counts.filter((item) => Number(item.special_class_id) === row.id);
      const count = (status: string) => Number(own.find((item) => item.status === status)?.count ?? 0);
      const days = own.reduce((sum, item) => sum + Number(item.count), 0);
      const attended = count('present') + count('late');
      return {
        ...publicOf(row),
        students: row.students.filter((student) => student.id === studentId),
        attendance: {
          days,
          present: count('present'),
          absent: count('absent'),
          late: count('late'),
          percent: days ? Math.round((attended / days) * 1000) / 10 : null,
        },
      };
    });
  }

  async get(schoolId: number, id: number): Promise<SpecialClassDto> {
    return publicOf(await this.load(schoolId, id));
  }

  async settings(schoolId: number): Promise<SpecialClassSettingsResultDto> {
    const [school] = await this.dataSource.query(`SELECT special_class_class_ids FROM schools WHERE id = $1`, [
      schoolId,
    ]);
    const ids: number[] | null = school?.special_class_class_ids ?? null;
    const classes: { id: number; name: string }[] = await this.dataSource.query(
      `SELECT id, name FROM classes WHERE school_id = $1 AND deleted_at IS NULL ORDER BY grade_level`,
      [schoolId],
    );
    return {
      all: ids === null,
      classes: classes
        .filter((row) => ids === null || ids.map(Number).includes(Number(row.id)))
        .map((row) => ({ id: Number(row.id), name: row.name })),
    };
  }

  async saveSettings(schoolId: number, classIds: number[] | null): Promise<SpecialClassSettingsResultDto> {
    if (classIds?.length) {
      const rows: { id: number }[] = await this.dataSource.query(
        `SELECT id FROM classes WHERE school_id = $1 AND id = ANY($2) AND deleted_at IS NULL`,
        [schoolId, classIds],
      );
      if (rows.length !== classIds.length) {
        throw AppException.validation([{ field: 'class_ids', message: 'Choose classes of this school' }]);
      }
    }
    await this.dataSource.query(`UPDATE schools SET special_class_class_ids = $2 WHERE id = $1`, [schoolId, classIds]);
    return this.settings(schoolId);
  }

  async create(schoolId: number, dto: SpecialClassInputDto): Promise<SpecialClassDto> {
    const input = normalise(dto);
    const id = await this.dataSource.transaction(async (manager) => {
      const yearId = await this.validate(manager, schoolId, input, null);
      const saved = await manager.save(
        manager.create(SpecialClass, { ...columnsOf(input), school_id: schoolId, academic_year_id: yearId }),
      );
      if (input.kind === 'extra') await this.setStudents(manager, schoolId, saved.id, input.student_ids ?? []);
      return saved.id;
    });
    const special = await this.load(schoolId, id);
    await this.tellTeacher(TEMPLATES.SPECIAL_CLASS_ASSIGNED, special, special.teacher.id);
    await this.tellParents(
      TEMPLATES.SPECIAL_CLASS_ADDED,
      special,
      special.students.map((student) => student.id),
    );
    return publicOf(special);
  }

  async update(schoolId: number, id: number, dto: UpdateSpecialClassDto): Promise<SpecialClassDto> {
    const before = await this.load(schoolId, id);
    const input = normalise({ ...inputOf(before), ...dto } as Loose);
    await this.dataSource.transaction(async (manager) => {
      await this.validate(manager, schoolId, input, id);
      await manager.update(SpecialClass, id, columnsOf(input));
      if (input.kind === 'extra' && (dto.student_ids || before.kind === 'special')) {
        await this.setStudents(manager, schoolId, id, input.student_ids ?? []);
      }
      if (input.kind === 'special') await manager.delete(SpecialClassStudent, { special_class_id: id });
    });
    const after = await this.load(schoolId, id);
    const was = new Set(before.students.map((student) => student.id));
    const now = new Set(after.students.map((student) => student.id));
    const scheduleChanged =
      SCHEDULE_FIELDS.some(
        (field) => JSON.stringify(normalise(inputOf(before))[field]) !== JSON.stringify(input[field]),
      ) || before.title !== after.title;
    if (before.teacher.id !== after.teacher.id) {
      await this.tellTeacher(TEMPLATES.SPECIAL_CLASS_CANCELLED, before, before.teacher.id);
      await this.tellTeacher(TEMPLATES.SPECIAL_CLASS_ASSIGNED, after, after.teacher.id);
    } else if (scheduleChanged) {
      await this.tellTeacher(TEMPLATES.SPECIAL_CLASS_CHANGED, after, after.teacher.id);
    }
    await this.tellParents(
      TEMPLATES.SPECIAL_CLASS_ADDED,
      after,
      [...now].filter((studentId) => !was.has(studentId)),
    );
    await this.tellParents(
      TEMPLATES.SPECIAL_CLASS_CANCELLED,
      before,
      [...was].filter((studentId) => !now.has(studentId)),
    );
    if (scheduleChanged) {
      await this.tellParents(
        TEMPLATES.SPECIAL_CLASS_CHANGED,
        after,
        [...now].filter((studentId) => was.has(studentId)),
      );
    }
    return publicOf(after);
  }

  async remove(schoolId: number, id: number): Promise<{ id: number }> {
    const special = await this.load(schoolId, id);
    await this.specials.softDelete({ id, school_id: schoolId });
    await this.tellTeacher(TEMPLATES.SPECIAL_CLASS_CANCELLED, special, special.teacher.id);
    await this.tellParents(
      TEMPLATES.SPECIAL_CLASS_CANCELLED,
      special,
      special.students.map((student) => student.id),
    );
    return { id };
  }

  async roster(schoolId: number, id: number, date: string, teacherId?: number): Promise<SpecialRosterDto> {
    const special = await this.load(schoolId, id);
    if (teacherId !== undefined && special.teacher.id !== teacherId) {
      throw AppException.forbidden('Only the teacher of this class can take its attendance', 'NOT_YOUR_SPECIAL_CLASS');
    }
    const saved: { student_id: number; status: SpecialRosterDto['students'][number]['status'] }[] =
      await this.dataSource.query(
        `SELECT student_id, status FROM special_class_attendance WHERE special_class_id = $1 AND date = $2`,
        [id, date],
      );
    const byStudent = new Map(saved.map((row) => [Number(row.student_id), row.status]));
    return {
      special_class: publicOf(special),
      date,
      runs_today: runsOn(special, date, special.year),
      marked: saved.length > 0,
      students: special.students.map((student) => ({
        student_id: student.id,
        full_name: student.name,
        roll_no: student.roll_no,
        status: byStudent.get(student.id) ?? 'present',
      })),
    };
  }

  async mark(
    schoolId: number,
    id: number,
    dto: SpecialMarkDto,
    actor: AuthUser,
    teacherOnly = false,
  ): Promise<SpecialRosterDto> {
    const special = await this.load(schoolId, id);
    if (teacherOnly && special.teacher.id !== actor.id) {
      throw AppException.forbidden('Only the teacher of this class can take its attendance', 'NOT_YOUR_SPECIAL_CLASS');
    }
    const today = todayIn(this.app.timeZone);
    if (dto.date > today) throw AppException.badRequest('Attendance cannot be taken for a future date', 'FUTURE_DATE');
    if (!runsOn(special, dto.date, special.year)) {
      throw AppException.badRequest(`${special.title} does not run on ${dto.date}`, 'NOT_A_CLASS_DAY');
    }
    const members = new Set(special.students.map((student) => student.id));
    const stranger = dto.items.find((item) => !members.has(item.student_id));
    if (stranger) {
      throw AppException.badRequest(`Student ${stranger.student_id} is not in this class`, 'STUDENT_NOT_IN_CLASS');
    }
    const given = new Map(dto.items.map((item) => [item.student_id, item.status]));
    const absentees = await this.dataSource.transaction(async (manager) => {
      const previous: { student_id: number; status: string; alert_sent: boolean }[] = await manager.query(
        `SELECT student_id, status, alert_sent FROM special_class_attendance WHERE special_class_id = $1 AND date = $2`,
        [id, dto.date],
      );
      const before = new Map(previous.map((row) => [Number(row.student_id), row]));
      for (const studentId of members) {
        const status =
          given.get(studentId) ?? (before.get(studentId)?.status as (typeof dto.items)[number]['status']) ?? 'present';
        await manager.query(
          `INSERT INTO special_class_attendance (school_id, special_class_id, date, student_id, status, marked_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (special_class_id, date, student_id)
           DO UPDATE SET status = EXCLUDED.status, marked_by = EXCLUDED.marked_by, updated_at = now()`,
          [schoolId, id, dto.date, studentId, status, actor.id],
        );
      }
      if (dto.date !== today) return [];
      return [...given]
        .filter(([studentId, status]) => status === 'absent' && !before.get(studentId)?.alert_sent)
        .map(([studentId]) => studentId);
    });
    if (absentees.length) {
      await this.tellParents(TEMPLATES.SPECIAL_CLASS_ABSENT, special, absentees, { date: dto.date });
      await this.dataSource.query(
        `UPDATE special_class_attendance SET alert_sent = true
         WHERE special_class_id = $1 AND date = $2 AND student_id = ANY($3)`,
        [id, dto.date, absentees],
      );
    }
    return this.roster(schoolId, id, dto.date);
  }

  private async load(schoolId: number, id: number): Promise<Loaded> {
    const [row] = await this.query(schoolId, 'AND sc.id = $2', [id]);
    if (!row) throw AppException.notFound('Special class not found', 'SPECIAL_CLASS_NOT_FOUND');
    return row;
  }

  private async query(schoolId: number, where: string, params: number[]): Promise<Loaded[]> {
    const rows: SpecialRow[] = await this.dataSource.query(
      `${LIST_SQL} ${where} ORDER BY c.grade_level, sec.name, sc.title`,
      [schoolId, ...params],
    );
    return rows.map((row) => {
      const days = (row.days ?? []).map(Number);
      const start = row.timing === 'period' ? row.bell_start : row.own_start;
      const end = row.timing === 'period' ? row.bell_end : row.own_end;
      const schedule = {
        timing: row.timing,
        day_of_week: row.day_of_week === null ? null : Number(row.day_of_week),
        period_no: row.period_no === null ? null : Number(row.period_no),
        days,
        start_date: row.start_date,
        end_date: row.end_date,
        start_time: start,
        end_time: end,
      };
      return {
        id: Number(row.id),
        kind: row.kind,
        timing: row.timing,
        title: row.title,
        notes: row.notes,
        section: { id: Number(row.section_id), name: `${row.class_name} - ${row.section_name}` },
        class_id: Number(row.class_id),
        subject: row.subject_id ? { id: Number(row.subject_id), name: row.subject_name ?? '' } : null,
        teacher: { id: Number(row.teacher_user_id), name: row.teacher_name },
        day_of_week: schedule.day_of_week,
        day:
          row.timing === 'period'
            ? (DAY_NAMES[schedule.day_of_week ?? 0] ?? '')
            : days.map((day) => DAY_SHORT[day]).join(', '),
        period_no: schedule.period_no,
        days,
        start_time: start,
        end_time: end,
        start_date: row.start_date,
        end_date: row.end_date,
        day_part: row.day_part,
        when: whenText(schedule, { start, end }),
        students: (row.students ?? []).map((student) => ({
          id: Number(student.id),
          name: student.name,
          roll_no: student.roll_no === null ? null : Number(student.roll_no),
        })),
        attendance: null,
        year: { from: row.year_from, to: row.year_to },
      };
    });
  }

  private async validate(
    manager: EntityManager,
    schoolId: number,
    dto: Normalised,
    selfId: number | null,
  ): Promise<number> {
    const [section] = await manager.query(
      `SELECT sec.id, sec.class_id, sec.academic_year_id,
              to_char(y.start_date, 'YYYY-MM-DD') AS year_from, to_char(y.end_date, 'YYYY-MM-DD') AS year_to
       FROM sections sec
       JOIN academic_years y ON y.id = sec.academic_year_id AND y.is_current = true AND y.deleted_at IS NULL
       WHERE sec.id = $1 AND sec.school_id = $2 AND sec.deleted_at IS NULL`,
      [dto.section_id, schoolId],
    );
    if (!section) throw AppException.notFound('Section not found in the current academic year', 'SECTION_NOT_FOUND');
    const yearId = Number(section.academic_year_id);
    const classId = Number(section.class_id);
    const year: Window = { from: section.year_from, to: section.year_to };

    if (dto.kind === 'special') {
      const [school] = await manager.query(`SELECT special_class_class_ids FROM schools WHERE id = $1`, [schoolId]);
      const allowed: number[] | null = school?.special_class_class_ids ?? null;
      if (allowed && !allowed.map(Number).includes(classId)) {
        throw AppException.badRequest(
          'Whole-class special classes are not turned on for this class. Turn it on in the special class settings.',
          'CLASS_NOT_ALLOWED',
        );
      }
    }
    if (dto.subject_id) {
      const [subject] = await manager.query(
        `SELECT 1 FROM subjects WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
        [dto.subject_id, schoolId],
      );
      if (!subject)
        throw AppException.validation([{ field: 'subject_id', message: 'Choose a subject of this school' }]);
    }
    const [teacher] = await manager.query(
      `SELECT st.max_periods_per_week, u.name FROM staff st JOIN users u ON u.id = st.user_id
       WHERE st.user_id = $1 AND st.school_id = $2 AND st.deleted_at IS NULL
         AND st.status <> 'resigned' AND st.staff_type = 'teaching'`,
      [dto.teacher_user_id, schoolId],
    );
    if (!teacher) throw AppException.badRequest('Choose a teacher from the teaching staff', 'NOT_A_TEACHER');

    const enrolled: { student_id: number }[] = await manager.query(
      `SELECT e.student_id FROM student_enrollments e JOIN students s ON s.id = e.student_id
       WHERE e.section_id = $1 AND e.academic_year_id = $2 AND s.deleted_at IS NULL AND s.status = 'active'`,
      [dto.section_id, yearId],
    );
    const sectionStudents = enrolled.map((row) => Number(row.student_id));
    const students = dto.kind === 'special' ? sectionStudents : (dto.student_ids ?? []);
    const stranger = students.find((studentId) => !sectionStudents.includes(studentId));
    if (stranger) throw AppException.badRequest(`Student ${stranger} is not in this section`, 'STUDENT_NOT_IN_SECTION');
    if (!students.length) throw AppException.badRequest('This section has no students', 'NO_STUDENTS');

    const bell = await this.bellOf(manager, schoolId, classId);
    let times: { start: string; end: string };
    if (dto.timing === 'period') {
      times = await this.checkPeriod(manager, schoolId, dto, selfId, yearId, teacher, bell);
    } else {
      times = this.checkExtraTime(dto, year);
      const holidays = await holidaySet(manager, schoolId, dto.start_date!, dto.end_date!, classId);
      for (const date of occurrences(dto, year)) {
        if (weekday(date) === 0 || holidays.has(date)) continue;
        const period = bell.find(
          (slot) =>
            slot.period_no !== null &&
            !slot.is_break &&
            timesOverlap(times.start, times.end, slot.start_time, slot.end_time),
        );
        if (period) {
          throw AppException.conflict(
            `${to12(times.start)} – ${to12(times.end)} overlaps ${period.name} (${to12(period.start_time)} – ${to12(period.end_time)}) on ${DAY_SHORT[weekday(date)]} ${date}. Choose a time before or after school, or a break.`,
            'DURING_CLASS_TIME',
          );
        }
      }
    }

    const mine = occurrences(dto, year).map((date) => ({ date, start: times.start, end: times.end }));
    if (!mine.length) {
      throw AppException.badRequest('No class day falls between the first and last day you chose', 'NO_CLASS_DAYS');
    }
    const range = { from: mine[0].date, to: mine[mine.length - 1].date };
    const others = (
      await this.query(schoolId, 'AND sc.academic_year_id = $2 AND sc.id <> $3', [yearId, selfId ?? 0])
    ).filter((other) => other.start_time && other.end_time);
    const slotsOf = (other: Loaded): Occurrence[] =>
      occurrences(other, other.year, range).map((date) => ({ date, start: other.start_time!, end: other.end_time! }));

    const combined = (other: Loaded) =>
      other.title === dto.title &&
      other.timing === dto.timing &&
      other.start_time === times.start &&
      other.end_time === times.end &&
      JSON.stringify(scheduleDaysOf(other)) === JSON.stringify(scheduleDaysOf(dto)) &&
      (other.start_date ?? null) === (dto.start_date ?? null) &&
      (other.end_date ?? null) === (dto.end_date ?? null);
    const teacherClash = others
      .filter((other) => other.teacher.id === dto.teacher_user_id && !combined(other))
      .map((other) => ({ other, clash: firstClash(mine, slotsOf(other)) }))
      .find((item) => item.clash);
    if (teacherClash) {
      throw AppException.conflict(
        `${teacher.name} already takes ${teacherClash.other.title} (${teacherClash.other.section.name}) at ${to12(teacherClash.clash!.start)} on ${teacherClash.clash!.date}`,
        'TEACHER_CLASH',
      );
    }
    if (dto.timing === 'extra_time')
      await this.checkTeacherTimetable(manager, schoolId, yearId, dto, teacher.name, mine);

    const chosen = new Set(students);
    const studentClash = others
      .filter((other) => other.students.some((student) => chosen.has(student.id)))
      .map((other) => ({ other, clash: firstClash(mine, slotsOf(other)) }))
      .find((item) => item.clash);
    if (studentClash) {
      const name = studentClash.other.students.find((student) => chosen.has(student.id))?.name ?? 'A student';
      throw AppException.conflict(
        `${name} already attends ${studentClash.other.title} at ${to12(studentClash.clash!.start)} on ${studentClash.clash!.date}`,
        'STUDENT_CLASH',
      );
    }
    return yearId;
  }

  private checkExtraTime(dto: Normalised, year: Window): { start: string; end: string } {
    if (!dto.start_time || !dto.end_time || dto.end_time <= dto.start_time) {
      throw AppException.validation([{ field: 'end_time', message: 'The class must end after it starts' }]);
    }
    if (!dto.start_date || !dto.end_date || dto.end_date < dto.start_date) {
      throw AppException.validation([{ field: 'end_date', message: 'The last day cannot be before the first day' }]);
    }
    if (dto.start_date < year.from || dto.end_date > year.to) {
      throw AppException.validation([
        { field: 'start_date', message: `Choose days inside this academic year (${year.from} to ${year.to})` },
      ]);
    }
    if (!dto.days?.length && dto.start_date !== dto.end_date) {
      throw AppException.validation([
        { field: 'days', message: 'Choose the weekdays, or the same first and last day for a one-day class' },
      ]);
    }
    return { start: dto.start_time, end: dto.end_time };
  }

  private async checkPeriod(
    manager: EntityManager,
    schoolId: number,
    dto: Normalised,
    selfId: number | null,
    yearId: number,
    teacher: { name: string; max_periods_per_week: number },
    bell: BellRow[],
  ): Promise<{ start: string; end: string }> {
    const teaching = bell.filter((slot) => slot.period_no !== null && !slot.is_break);
    const slot = teaching.find((item) => Number(item.period_no) === dto.period_no);
    if (!slot) {
      throw AppException.validation([
        { field: 'period_no', message: `The bell schedule has ${teaching.length} periods` },
      ]);
    }
    const skip = selfId ?? 0;
    const [sectionTaken] = await manager.query(
      `SELECT title FROM special_classes
       WHERE section_id = $1 AND timing = 'period' AND day_of_week = $2 AND period_no = $3 AND deleted_at IS NULL AND id <> $4`,
      [dto.section_id, dto.day_of_week, dto.period_no, skip],
    );
    if (sectionTaken) {
      throw AppException.conflict(
        `This section already has the special class "${sectionTaken.title}" in that period`,
        'SPECIAL_CLASS_CLASH',
      );
    }
    const [busy] = await manager.query(
      `SELECT c.name AS class_name, sec.name AS section_name FROM timetable_slots t
       JOIN sections sec ON sec.id = t.section_id JOIN classes c ON c.id = sec.class_id
       WHERE t.academic_year_id = $1 AND t.teacher_user_id = $2 AND t.day_of_week = $3 AND t.period_no = $4
         AND t.section_id <> $5
       LIMIT 1`,
      [yearId, dto.teacher_user_id, dto.day_of_week, dto.period_no, dto.section_id],
    );
    if (busy) {
      throw AppException.conflict(
        `${teacher.name} already teaches ${busy.class_name} - ${busy.section_name} in period ${dto.period_no} on ${DAY_NAMES[dto.day_of_week!]}`,
        'TEACHER_CLASH',
      );
    }
    const [load] = await manager.query(
      `SELECT (SELECT COUNT(*) FROM timetable_slots WHERE academic_year_id = $1 AND teacher_user_id = $2)
            + (SELECT COUNT(*) FROM special_classes
               WHERE academic_year_id = $1 AND teacher_user_id = $2 AND timing = 'period'
                 AND deleted_at IS NULL AND id <> $3) AS periods`,
      [yearId, dto.teacher_user_id, skip],
    );
    const [own] = await manager.query(
      `SELECT EXISTS (SELECT 1 FROM timetable_slots WHERE section_id = $1 AND teacher_user_id = $2
                      AND day_of_week = $3 AND period_no = $4) AS exists`,
      [dto.section_id, dto.teacher_user_id, dto.day_of_week, dto.period_no],
    );
    const periods = Number(load?.periods ?? 0) + (own?.exists ? 0 : 1);
    if (periods > Number(teacher.max_periods_per_week)) {
      throw AppException.conflict(
        `${teacher.name} can teach at most ${teacher.max_periods_per_week} periods a week; this special class would make it ${periods}.`,
        'TEACHER_OVER_LIMIT',
      );
    }
    return { start: slot.start_time, end: slot.end_time };
  }

  private async checkTeacherTimetable(
    manager: EntityManager,
    schoolId: number,
    yearId: number,
    dto: Normalised,
    name: string,
    mine: Occurrence[],
  ): Promise<void> {
    const slots: { day_of_week: number; start_time: string; end_time: string; section: string }[] = await manager.query(
      `SELECT t.day_of_week, b.start_time, b.end_time, c.name || ' - ' || sec.name AS section
       FROM timetable_slots t
       JOIN sections sec ON sec.id = t.section_id JOIN classes c ON c.id = sec.class_id
       JOIN LATERAL (
         SELECT bp.start_time, bp.end_time FROM bell_periods bp
         WHERE bp.school_id = $1 AND bp.period_no = t.period_no AND (bp.class_id = sec.class_id OR bp.class_id IS NULL)
         ORDER BY bp.class_id NULLS LAST LIMIT 1
       ) b ON true
       WHERE t.academic_year_id = $2 AND t.teacher_user_id = $3`,
      [schoolId, yearId, dto.teacher_user_id],
    );
    const holidays = await holidaySet(manager, schoolId, mine[0].date, mine[mine.length - 1].date);
    for (const item of mine) {
      if (weekday(item.date) === 0 || holidays.has(item.date)) continue;
      const busy = slots.find(
        (slot) =>
          Number(slot.day_of_week) === weekday(item.date) &&
          timesOverlap(item.start, item.end, slot.start_time, slot.end_time),
      );
      if (busy) {
        throw AppException.conflict(
          `${name} teaches ${busy.section} at ${to12(busy.start_time)} on ${DAY_SHORT[weekday(item.date)]}`,
          'TEACHER_CLASH',
        );
      }
    }
  }

  private async bellOf(manager: EntityManager, schoolId: number, classId: number): Promise<BellRow[]> {
    return manager.query(
      `SELECT period_no, name, start_time, end_time, is_break FROM bell_periods
       WHERE school_id = $1 AND class_id IS NOT DISTINCT FROM (
         SELECT CASE WHEN EXISTS (SELECT 1 FROM bell_periods WHERE school_id = $1 AND class_id = $2) THEN $2::int END)
       ORDER BY start_time`,
      [schoolId, classId],
    );
  }

  private async setStudents(manager: EntityManager, schoolId: number, id: number, studentIds: number[]) {
    await manager.delete(SpecialClassStudent, { special_class_id: id });
    if (!studentIds.length) return;
    await manager.insert(
      SpecialClassStudent,
      studentIds.map((studentId) => ({ special_class_id: id, student_id: studentId, school_id: schoolId })),
    );
  }

  private data(special: SpecialClassDto): Record<string, string> {
    return {
      title: special.title,
      kind: special.kind === 'special' ? 'special class' : 'extra class',
      class: special.section.name,
      subject: special.subject?.name ?? special.title,
      teacher: special.teacher.name,
      when: special.when,
      students: String(special.students.length),
      special_class_id: String(special.id),
    };
  }

  private async tellTeacher(template: string, special: SpecialClassDto, userId: number): Promise<void> {
    await this.notifications
      .dispatch({
        template,
        audience: { user_ids: [userId] },
        data: { ...this.data(special), student: special.teacher.name },
      })
      .catch((error: Error) => this.logger.warn(`${template} for teacher ${userId} failed: ${error.message}`));
  }

  private async tellParents(
    template: string,
    special: SpecialClassDto,
    studentIds: number[],
    extra: Record<string, string> = {},
  ): Promise<void> {
    if (!studentIds.length) return;
    const rows: { student_id: number; name: string; user_ids: number[] }[] = await this.dataSource.query(
      `SELECT s.id AS student_id, concat_ws(' ', s.first_name, s.last_name) AS name,
              array_remove(array_agg(DISTINCT g.user_id), NULL) AS user_ids
       FROM students s
       LEFT JOIN student_guardians sg ON sg.student_id = s.id
       LEFT JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
       WHERE s.id = ANY($1)
       GROUP BY s.id`,
      [studentIds],
    );
    for (const row of rows.filter((item) => item.user_ids.length)) {
      await this.notifications
        .dispatch({
          template,
          audience: { user_ids: row.user_ids.map(Number) },
          data: { ...this.data(special), ...extra, student: row.name, student_id: String(row.student_id) },
        })
        .catch((error: Error) =>
          this.logger.warn(`${template} for student ${row.student_id} failed: ${error.message}`),
        );
    }
  }
}

interface BellRow {
  period_no: number | null;
  name: string;
  start_time: string;
  end_time: string;
  is_break: boolean;
}

type Loose = Omit<SpecialClassInputDto, 'day_of_week' | 'period_no' | 'days' | 'start_date' | 'end_date'> & {
  day_of_week?: number | null;
  period_no?: number | null;
  days?: number[] | null;
  start_date?: string | null;
  end_date?: string | null;
};

type Normalised = Omit<Loose, 'kind' | 'timing' | 'day_of_week' | 'period_no' | 'days' | 'start_date' | 'end_date'> & {
  kind: 'extra' | 'special';
  timing: 'period' | 'extra_time';
  day_of_week: number | null;
  period_no: number | null;
  days: number[] | null;
  start_date: string | null;
  end_date: string | null;
};

function scheduleDaysOf(schedule: { timing: string; day_of_week: number | null; days: number[] | null }): number[] {
  return schedule.timing === 'period'
    ? schedule.day_of_week === null
      ? []
      : [schedule.day_of_week]
    : [...(schedule.days ?? [])].sort();
}

function normalise(dto: Loose): Normalised {
  const timing = dto.timing ?? 'period';
  return {
    ...dto,
    start_date: dto.start_date ?? null,
    end_date: dto.end_date ?? null,
    kind: dto.kind ?? 'extra',
    timing,
    day_of_week: timing === 'period' ? (dto.day_of_week ?? null) : null,
    period_no: timing === 'period' ? (dto.period_no ?? null) : null,
    days: timing === 'extra_time' ? [...(dto.days ?? [])].sort() : null,
    start_time: timing === 'extra_time' ? dto.start_time : undefined,
    end_time: timing === 'extra_time' ? dto.end_time : undefined,
  };
}

function columnsOf(input: Normalised): Partial<SpecialClass> {
  return {
    kind: input.kind,
    timing: input.timing,
    section_id: input.section_id,
    subject_id: input.subject_id ?? null,
    teacher_user_id: input.teacher_user_id,
    day_of_week: input.day_of_week,
    period_no: input.period_no,
    days: input.days,
    start_time: input.start_time ?? null,
    end_time: input.end_time ?? null,
    start_date: input.start_date ?? null,
    end_date: input.end_date ?? null,
    day_part: input.timing === 'extra_time' ? (input.day_part ?? 'custom') : null,
    title: input.title,
    notes: input.notes ?? null,
  };
}

function inputOf(special: SpecialClassDto): Loose {
  return {
    kind: special.kind,
    timing: special.timing,
    section_id: special.section.id,
    subject_id: special.subject?.id ?? null,
    teacher_user_id: special.teacher.id,
    day_of_week: special.day_of_week,
    period_no: special.period_no,
    days: special.timing === 'extra_time' ? special.days : null,
    start_time: special.timing === 'extra_time' ? (special.start_time ?? undefined) : undefined,
    end_time: special.timing === 'extra_time' ? (special.end_time ?? undefined) : undefined,
    start_date: special.start_date,
    end_date: special.end_date,
    day_part: special.day_part ?? undefined,
    title: special.title,
    notes: special.notes,
    student_ids: special.kind === 'extra' ? special.students.map((student) => student.id) : undefined,
  };
}

function publicOf(special: Loaded): SpecialClassDto {
  return Object.fromEntries(Object.entries(special).filter(([key]) => key !== 'year')) as SpecialClassDto;
}
