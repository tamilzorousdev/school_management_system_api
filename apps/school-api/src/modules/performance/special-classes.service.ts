import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AppException } from '@app/common';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import { NotificationsService } from '../notifications/notifications.service';
import { DAY_NAMES } from '../timetable/dto/timetable.dto';
import { SpecialClassDto, SpecialClassInputDto, UpdateSpecialClassDto } from './dto/performance.dto';
import { SpecialClass, SpecialClassStudent } from './entities/special-class.entity';

interface SpecialRow {
  id: number;
  title: string;
  notes: string | null;
  section_id: number;
  section_name: string;
  class_name: string;
  subject_id: number | null;
  subject_name: string | null;
  teacher_user_id: number;
  teacher_name: string;
  day_of_week: number;
  period_no: number;
  start_time: string | null;
  end_time: string | null;
  students: { id: number; name: string; roll_no: number | null }[] | null;
}

const LIST_SQL = `
  SELECT sc.id, sc.title, sc.notes, sc.section_id, sec.name AS section_name, c.name AS class_name,
         sc.subject_id, sub.name AS subject_name, sc.teacher_user_id, u.name AS teacher_name,
         sc.day_of_week, sc.period_no, b.start_time, b.end_time,
         (SELECT json_agg(json_build_object(
                   'id', s.id, 'name', concat_ws(' ', s.first_name, s.last_name), 'roll_no', e.roll_no)
                 ORDER BY e.roll_no NULLS LAST, s.first_name)
            FROM special_class_students st
            JOIN students s ON s.id = st.student_id AND s.deleted_at IS NULL
            LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = sc.academic_year_id
           WHERE st.special_class_id = sc.id) AS students
  FROM special_classes sc
  JOIN sections sec ON sec.id = sc.section_id
  JOIN classes c ON c.id = sec.class_id
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

@Injectable()
export class SpecialClassesService {
  private readonly logger = new Logger('SpecialClasses');

  constructor(
    @InjectRepository(SpecialClass) private readonly specials: Repository<SpecialClass>,
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
  ) {}

  async list(schoolId: number, sectionId?: number): Promise<SpecialClassDto[]> {
    return this.query(schoolId, sectionId ? 'AND sc.section_id = $2' : '', sectionId ? [sectionId] : []);
  }

  async forTeacher(schoolId: number, userId: number): Promise<SpecialClassDto[]> {
    return this.query(schoolId, 'AND sc.teacher_user_id = $2', [userId]);
  }

  async forStudent(schoolId: number, studentId: number): Promise<SpecialClassDto[]> {
    const rows = await this.query(
      schoolId,
      'AND EXISTS (SELECT 1 FROM special_class_students x WHERE x.special_class_id = sc.id AND x.student_id = $2)',
      [studentId],
    );
    return rows.map((row) => ({ ...row, students: row.students.filter((student) => student.id === studentId) }));
  }

  async get(schoolId: number, id: number): Promise<SpecialClassDto> {
    const [row] = await this.query(schoolId, 'AND sc.id = $2', [id]);
    if (!row) throw AppException.notFound('Special class not found', 'SPECIAL_CLASS_NOT_FOUND');
    return row;
  }

  async create(schoolId: number, dto: SpecialClassInputDto): Promise<SpecialClassDto> {
    const id = await this.dataSource.transaction(async (manager) => {
      const yearId = await this.validate(manager, schoolId, dto, null);
      const saved = await manager.save(
        manager.create(SpecialClass, {
          school_id: schoolId,
          academic_year_id: yearId,
          section_id: dto.section_id,
          subject_id: dto.subject_id ?? null,
          teacher_user_id: dto.teacher_user_id,
          day_of_week: dto.day_of_week,
          period_no: dto.period_no,
          title: dto.title,
          notes: dto.notes ?? null,
        }),
      );
      await this.setStudents(manager, schoolId, saved.id, dto.student_ids);
      return saved.id;
    });
    const special = await this.get(schoolId, id);
    await this.tellParents(special, dto.student_ids);
    return special;
  }

  async update(schoolId: number, id: number, dto: UpdateSpecialClassDto): Promise<SpecialClassDto> {
    const before = await this.get(schoolId, id);
    const merged: SpecialClassInputDto = {
      section_id: dto.section_id ?? before.section.id,
      subject_id: dto.subject_id === undefined ? (before.subject?.id ?? null) : dto.subject_id,
      teacher_user_id: dto.teacher_user_id ?? before.teacher.id,
      day_of_week: dto.day_of_week ?? before.day_of_week,
      period_no: dto.period_no ?? before.period_no,
      title: dto.title ?? before.title,
      notes: dto.notes === undefined ? before.notes : dto.notes,
      student_ids: dto.student_ids ?? before.students.map((student) => student.id),
    };
    await this.dataSource.transaction(async (manager) => {
      await this.validate(manager, schoolId, merged, id);
      await manager.update(SpecialClass, id, {
        section_id: merged.section_id,
        subject_id: merged.subject_id ?? null,
        teacher_user_id: merged.teacher_user_id,
        day_of_week: merged.day_of_week,
        period_no: merged.period_no,
        title: merged.title,
        notes: merged.notes ?? null,
      });
      if (dto.student_ids) await this.setStudents(manager, schoolId, id, dto.student_ids);
    });
    const special = await this.get(schoolId, id);
    const known = new Set(before.students.map((student) => student.id));
    const added = merged.student_ids.filter((studentId) => !known.has(studentId));
    if (added.length) await this.tellParents(special, added);
    return special;
  }

  async remove(schoolId: number, id: number): Promise<{ id: number }> {
    await this.get(schoolId, id);
    await this.specials.softDelete({ id, school_id: schoolId });
    return { id };
  }

  private async query(schoolId: number, where: string, params: number[]): Promise<SpecialClassDto[]> {
    const rows: SpecialRow[] = await this.dataSource.query(
      `${LIST_SQL} ${where} ORDER BY c.name, sec.name, sc.day_of_week, sc.period_no`,
      [schoolId, ...params],
    );
    return rows.map((row) => ({
      id: Number(row.id),
      title: row.title,
      notes: row.notes,
      section: { id: Number(row.section_id), name: `${row.class_name} - ${row.section_name}` },
      subject: row.subject_id ? { id: Number(row.subject_id), name: row.subject_name ?? '' } : null,
      teacher: { id: Number(row.teacher_user_id), name: row.teacher_name },
      day_of_week: Number(row.day_of_week),
      day: DAY_NAMES[Number(row.day_of_week)] ?? '',
      period_no: Number(row.period_no),
      start_time: row.start_time,
      end_time: row.end_time,
      students: (row.students ?? []).map((student) => ({
        id: Number(student.id),
        name: student.name,
        roll_no: student.roll_no === null ? null : Number(student.roll_no),
      })),
    }));
  }

  private async validate(
    manager: EntityManager,
    schoolId: number,
    dto: SpecialClassInputDto,
    selfId: number | null,
  ): Promise<number> {
    const [section] = await manager.query(
      `SELECT sec.id, sec.class_id, sec.academic_year_id FROM sections sec
       JOIN academic_years y ON y.id = sec.academic_year_id AND y.is_current = true AND y.deleted_at IS NULL
       WHERE sec.id = $1 AND sec.school_id = $2 AND sec.deleted_at IS NULL`,
      [dto.section_id, schoolId],
    );
    if (!section) throw AppException.notFound('Section not found in the current academic year', 'SECTION_NOT_FOUND');
    const yearId = Number(section.academic_year_id);

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

    const [bell] = await manager.query(
      `SELECT COUNT(*) AS teaching FROM bell_periods
       WHERE school_id = $1 AND is_break = false
         AND class_id IS NOT DISTINCT FROM (
           SELECT CASE WHEN EXISTS (SELECT 1 FROM bell_periods WHERE school_id = $1 AND class_id = $2) THEN $2::int END
         )`,
      [schoolId, section.class_id],
    );
    if (dto.period_no > Number(bell?.teaching ?? 0)) {
      throw AppException.validation([
        { field: 'period_no', message: `The bell schedule has ${Number(bell?.teaching ?? 0)} periods` },
      ]);
    }

    const skip = selfId ?? 0;
    const [sectionTaken] = await manager.query(
      `SELECT title FROM special_classes
       WHERE section_id = $1 AND day_of_week = $2 AND period_no = $3 AND deleted_at IS NULL AND id <> $4`,
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
       UNION ALL
       SELECT c.name, sec.name FROM special_classes sc
       JOIN sections sec ON sec.id = sc.section_id JOIN classes c ON c.id = sec.class_id
       WHERE sc.teacher_user_id = $2 AND sc.day_of_week = $3 AND sc.period_no = $4 AND sc.deleted_at IS NULL AND sc.id <> $6
       LIMIT 1`,
      [yearId, dto.teacher_user_id, dto.day_of_week, dto.period_no, dto.section_id, skip],
    );
    if (busy) {
      throw AppException.conflict(
        `${teacher.name} already teaches ${busy.class_name} - ${busy.section_name} in period ${dto.period_no} on ${DAY_NAMES[dto.day_of_week]}`,
        'TEACHER_CLASH',
      );
    }

    const [load] = await manager.query(
      `SELECT (SELECT COUNT(*) FROM timetable_slots WHERE academic_year_id = $1 AND teacher_user_id = $2)
            + (SELECT COUNT(*) FROM special_classes
               WHERE academic_year_id = $1 AND teacher_user_id = $2 AND deleted_at IS NULL AND id <> $3) AS periods`,
      [yearId, dto.teacher_user_id, skip],
    );
    const ownSlot: { exists: boolean }[] = await manager.query(
      `SELECT EXISTS (SELECT 1 FROM timetable_slots WHERE section_id = $1 AND teacher_user_id = $2
                      AND day_of_week = $3 AND period_no = $4) AS exists`,
      [dto.section_id, dto.teacher_user_id, dto.day_of_week, dto.period_no],
    );
    const periods = Number(load?.periods ?? 0) + (ownSlot[0]?.exists ? 0 : 1);
    if (periods > Number(teacher.max_periods_per_week)) {
      throw AppException.conflict(
        `${teacher.name} can teach at most ${teacher.max_periods_per_week} periods a week; this special class would make it ${periods}.`,
        'TEACHER_OVER_LIMIT',
      );
    }

    const enrolled: { student_id: number }[] = await manager.query(
      `SELECT e.student_id FROM student_enrollments e JOIN students s ON s.id = e.student_id
       WHERE e.section_id = $1 AND e.academic_year_id = $2 AND s.deleted_at IS NULL AND s.status = 'active'`,
      [dto.section_id, yearId],
    );
    const ids = new Set(enrolled.map((row) => Number(row.student_id)));
    const stranger = dto.student_ids.find((studentId) => !ids.has(studentId));
    if (stranger) {
      throw AppException.badRequest(`Student ${stranger} is not in this section`, 'STUDENT_NOT_IN_SECTION');
    }
    return yearId;
  }

  private async setStudents(manager: EntityManager, schoolId: number, id: number, studentIds: number[]) {
    await manager.delete(SpecialClassStudent, { special_class_id: id });
    await manager.insert(
      SpecialClassStudent,
      studentIds.map((studentId) => ({ special_class_id: id, student_id: studentId, school_id: schoolId })),
    );
  }

  private async tellParents(special: SpecialClassDto, studentIds: number[]): Promise<void> {
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
    const time = special.start_time ? ` at ${special.start_time}` : '';
    for (const row of rows.filter((item) => item.user_ids.length)) {
      await this.notifications
        .dispatch({
          template: TEMPLATES.SPECIAL_CLASS_ADDED,
          audience: { user_ids: row.user_ids.map(Number) },
          data: {
            student: row.name,
            title: special.title,
            subject: special.subject?.name ?? special.title,
            teacher: special.teacher.name,
            when: `every ${special.day}, period ${special.period_no}${time}`,
            student_id: String(row.student_id),
            special_class_id: String(special.id),
          },
        })
        .catch((error: Error) =>
          this.logger.warn(`Special class alert for ${row.student_id} failed: ${error.message}`),
        );
    }
  }
}
