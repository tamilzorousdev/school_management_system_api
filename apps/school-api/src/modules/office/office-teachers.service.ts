import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppException } from '@app/common';
import { yearClause } from '../../shared/year-context';
import { inWings, wingClassIds } from '../../shared/wing-context';
import { FilesService } from '../files/files.service';
import {
  OfficeTeachersDto,
  SectionTeachersDto,
  TeacherCardDto,
  TeacherDetailDto,
  TeacherPaperDto,
  TeachersTodayDto,
  TeacherToday,
} from './dto/office-teachers.dto';
import { percent } from './office.logic';
import { WingScopeService } from './wing-scope.service';

const num = (value: unknown) => Number(value ?? 0);

interface TeacherRow {
  user_id: number;
  name: string;
  mobile: string | null;
  photo_file_id: number | null;
  designation: string | null;
  subjects: string[] | null;
  sections: string[] | null;
  class_teacher_of: string[] | null;
  att_status: string | null;
  check_in_at: Date | null;
  on_leave: boolean;
  rating_avg: string | null;
  rating_count: string;
  passed: string;
  sat: string;
}

@Injectable()
export class OfficeTeachersService {
  constructor(
    private readonly scope: WingScopeService,
    private readonly files: FilesService,
    private readonly dataSource: DataSource,
  ) {}

  async list(schoolId: number): Promise<OfficeTeachersDto> {
    const rows = await this.rows(schoolId, wingClassIds(), null);
    const teachers = await this.cards(rows);
    return { today: this.summary(teachers), teachers };
  }

  async today(schoolId: number, classIds: number[] | null): Promise<TeachersTodayDto> {
    const rows = await this.rows(schoolId, classIds, null);
    return this.summary(rows.map((row) => ({ today: this.status(row) })));
  }

  async detail(schoolId: number, userId: number): Promise<TeacherDetailDto> {
    const classIds = wingClassIds();
    const [row] = await this.rows(schoolId, classIds, userId);
    if (!row) throw AppException.notFound('Teacher not found', 'TEACHER_NOT_FOUND');
    const [teacher] = await this.cards([row]);
    const [papers, stars, recent, month] = await Promise.all([
      this.papers(schoolId, classIds, userId),
      this.dataSource.query(
        `SELECT r.stars, count(*) AS n FROM teacher_ratings r
         JOIN academic_years ay ON ay.id = r.academic_year_id AND ${yearClause('ay')}
         WHERE r.school_id = $1 AND r.teacher_user_id = $2 AND r.deleted_at IS NULL GROUP BY r.stars`,
        [schoolId, userId],
      ) as Promise<{ stars: number; n: string }[]>,
      this.dataSource.query(
        `SELECT r.stars, r.remark, c.name || COALESCE(' - ' || sec.name, '') AS class_section, r.created_at
         FROM teacher_ratings r
         JOIN academic_years ay ON ay.id = r.academic_year_id AND ${yearClause('ay')}
         LEFT JOIN sections sec ON sec.id = r.section_id LEFT JOIN classes c ON c.id = sec.class_id
         WHERE r.school_id = $1 AND r.teacher_user_id = $2 AND r.deleted_at IS NULL
           AND COALESCE(trim(r.remark), '') <> ''
         ORDER BY r.created_at DESC LIMIT 5`,
        [schoolId, userId],
      ) as Promise<{ stars: number; remark: string | null; class_section: string | null; created_at: Date }[]>,
      this.dataSource.query(
        `SELECT
           count(*) FILTER (WHERE status = 'present') AS present_days,
           count(*) FILTER (WHERE status = 'late') AS late_days,
           (SELECT COALESCE(sum(days), 0) FROM staff_leave_requests
              WHERE user_id = $2 AND school_id = $1 AND status = 'approved' AND deleted_at IS NULL
                AND from_date >= date_trunc('month', $3::date)) AS leave_days
         FROM staff_attendance WHERE user_id = $2 AND school_id = $1 AND date >= date_trunc('month', $3::date)`,
        [schoolId, userId, this.scope.today()],
      ) as Promise<Record<string, string>[]>,
    ]);
    const distribution: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    stars.forEach((item) => (distribution[String(item.stars)] = num(item.n)));
    return {
      teacher,
      papers,
      rating: {
        ...teacher.rating,
        stars: distribution,
        recent: recent.map((item) => ({ ...item, stars: Number(item.stars) })),
      },
      month: {
        present_days: num(month[0]?.present_days),
        late_days: num(month[0]?.late_days),
        leave_days: num(month[0]?.leave_days),
      },
    };
  }

  async section(schoolId: number, sectionId: number): Promise<SectionTeachersDto> {
    const [section]: { id: number; class_id: number; label: string; class_teacher_user_id: number | null }[] =
      await this.dataSource.query(
        `SELECT s.id, s.class_id, c.name || ' - ' || s.name AS label, s.class_teacher_user_id
         FROM sections s JOIN classes c ON c.id = s.class_id
         WHERE s.id = $1 AND s.school_id = $2 AND s.deleted_at IS NULL`,
        [sectionId, schoolId],
      );
    if (!section || !inWings(Number(section.class_id))) {
      throw AppException.notFound('Section not found', 'SECTION_NOT_FOUND');
    }
    const subjects: Record<string, unknown>[] = await this.dataSource.query(
      `WITH latest AS (
         SELECT x.id AS exam_id, x.name AS exam FROM exams x JOIN exam_subjects es ON es.exam_id = x.id
         WHERE x.school_id = $1 AND x.status = 'published' AND x.deleted_at IS NULL AND es.class_id = $3
           AND x.academic_year_id = (SELECT academic_year_id FROM sections WHERE id = $2)
         ORDER BY x.start_date DESC, x.id DESC LIMIT 1
       )
       SELECT ta.teacher_user_id AS user_id, sb.name AS subject, ta.periods_per_week, l.exam,
              count(m.id) AS students,
              count(m.id) FILTER (WHERE NOT m.is_absent AND m.marks >= COALESCE(es.pass_marks, 0)) AS passed,
              avg(CASE WHEN m.is_absent THEN 0 ELSE m.marks END * 100.0 / NULLIF(es.max_marks, 0)) AS average_percent
       FROM teacher_assignments ta
       JOIN subjects sb ON sb.id = ta.subject_id
       LEFT JOIN latest l ON true
       LEFT JOIN exam_subjects es ON es.exam_id = l.exam_id AND es.class_id = $3 AND es.subject_id = ta.subject_id
       LEFT JOIN student_enrollments e ON e.section_id = ta.section_id AND e.status = 'studying'
         AND e.academic_year_id = ta.academic_year_id AND es.id IS NOT NULL
       LEFT JOIN exam_marks m ON m.exam_id = l.exam_id AND m.subject_id = ta.subject_id AND m.student_id = e.student_id
       WHERE ta.section_id = $2 AND ta.school_id = $1 AND ta.deleted_at IS NULL
       GROUP BY ta.teacher_user_id, sb.name, ta.periods_per_week, l.exam
       ORDER BY sb.name`,
      [schoolId, sectionId, section.class_id],
    );
    const userIds = [
      ...new Set([
        ...(section.class_teacher_user_id ? [Number(section.class_teacher_user_id)] : []),
        ...subjects.map((row) => Number(row.user_id)),
      ]),
    ];
    const rows = (await this.rows(schoolId, wingClassIds(), null)).filter((row) =>
      userIds.includes(Number(row.user_id)),
    );
    const cards = new Map((await this.cards(rows)).map((card) => [card.user_id, card]));
    const teachers = userIds
      .filter((id) => cards.has(id))
      .map((id) => ({
        teacher: cards.get(id)!,
        is_class_teacher: id === Number(section.class_teacher_user_id),
        subjects: subjects
          .filter((row) => Number(row.user_id) === id)
          .map((row) => ({
            subject: row.subject as string,
            periods_per_week: row.periods_per_week === null ? null : Number(row.periods_per_week),
            exam: (row.exam as string | null) ?? null,
            students: num(row.students),
            passed: num(row.passed),
            pass_percent: percent(num(row.passed), num(row.students)),
            average_percent: row.average_percent === null ? null : Math.round(Number(row.average_percent) * 10) / 10,
          })),
      }));
    return { section_id: Number(section.id), class_section: section.label, teachers };
  }

  private summary(rows: { today: TeacherToday }[]): TeachersTodayDto {
    return {
      total: rows.length,
      present: rows.filter((row) => row.today === 'present').length,
      late: rows.filter((row) => row.today === 'late').length,
      on_leave: rows.filter((row) => row.today === 'on_leave').length,
      not_checked_in: rows.filter((row) => row.today === 'not_checked_in').length,
    };
  }

  private status(row: TeacherRow): TeacherToday {
    if (row.att_status === 'late') return 'late';
    if (row.att_status) return 'present';
    if (row.on_leave) return 'on_leave';
    return 'not_checked_in';
  }

  private async cards(rows: TeacherRow[]): Promise<TeacherCardDto[]> {
    const photos = await this.files.presentMany(
      rows.map((row) => (row.photo_file_id ? Number(row.photo_file_id) : null)),
    );
    return rows.map((row) => {
      const photo = row.photo_file_id ? photos.get(Number(row.photo_file_id)) : null;
      return {
        user_id: Number(row.user_id),
        name: row.name,
        photo_url: photo?.thumbnail_url ?? photo?.url ?? null,
        designation: row.designation,
        mobile: row.mobile,
        subjects: row.subjects ?? [],
        sections: row.sections ?? [],
        class_teacher_of: row.class_teacher_of ?? [],
        today: this.status(row),
        check_in_at: row.check_in_at,
        pass_percent: percent(num(row.passed), num(row.sat)),
        rating: {
          average: row.rating_avg === null ? null : Math.round(Number(row.rating_avg) * 10) / 10,
          count: num(row.rating_count),
        },
      };
    });
  }

  private async rows(schoolId: number, classIds: number[] | null, userId: number | null): Promise<TeacherRow[]> {
    if (classIds && !classIds.length) return [];
    return this.dataSource.query(
      `WITH yr AS (SELECT ay.id FROM academic_years ay WHERE ay.school_id = $1 AND ay.deleted_at IS NULL AND ${yearClause('ay')}),
       sec AS (
         SELECT s.id, s.class_id, s.class_teacher_user_id, c.name || ' - ' || s.name AS label
         FROM sections s JOIN yr ON yr.id = s.academic_year_id JOIN classes c ON c.id = s.class_id
         WHERE s.school_id = $1 AND s.deleted_at IS NULL AND ($2::int[] IS NULL OR s.class_id = ANY($2))
       ),
       teaching AS (
         SELECT ta.teacher_user_id AS user_id, ta.section_id, ta.subject_id FROM teacher_assignments ta
         JOIN sec ON sec.id = ta.section_id JOIN yr ON yr.id = ta.academic_year_id WHERE ta.deleted_at IS NULL
       ),
       people AS (
         SELECT user_id FROM teaching UNION SELECT class_teacher_user_id FROM sec WHERE class_teacher_user_id IS NOT NULL
       ),
       latest AS (
         SELECT DISTINCT ON (es.class_id) es.class_id, x.id AS exam_id
         FROM exams x JOIN exam_subjects es ON es.exam_id = x.id
         WHERE x.school_id = $1 AND x.status = 'published' AND x.deleted_at IS NULL
           AND x.academic_year_id IN (SELECT id FROM yr)
         ORDER BY es.class_id, x.start_date DESC, x.id DESC
       ),
       results AS (
         SELECT t.user_id,
                count(*) FILTER (WHERE m.id IS NOT NULL) AS sat,
                count(*) FILTER (WHERE m.id IS NOT NULL AND NOT m.is_absent AND m.marks >= COALESCE(es.pass_marks, 0)) AS passed
         FROM teaching t JOIN sec ON sec.id = t.section_id
         JOIN latest l ON l.class_id = sec.class_id
         JOIN exam_subjects es ON es.exam_id = l.exam_id AND es.class_id = sec.class_id AND es.subject_id = t.subject_id
         JOIN student_enrollments e ON e.section_id = t.section_id AND e.status = 'studying' AND e.academic_year_id IN (SELECT id FROM yr)
         LEFT JOIN exam_marks m ON m.exam_id = l.exam_id AND m.subject_id = t.subject_id AND m.student_id = e.student_id
         GROUP BY t.user_id
       )
       SELECT u.id AS user_id, u.name, u.mobile, u.photo_file_id, st.designation,
              (SELECT array_agg(DISTINCT sb.name ORDER BY sb.name) FROM teaching t JOIN subjects sb ON sb.id = t.subject_id WHERE t.user_id = u.id) AS subjects,
              (SELECT array_agg(DISTINCT sec.label ORDER BY sec.label) FROM teaching t JOIN sec ON sec.id = t.section_id WHERE t.user_id = u.id) AS sections,
              (SELECT array_agg(sec.label ORDER BY sec.label) FROM sec WHERE sec.class_teacher_user_id = u.id) AS class_teacher_of,
              sa.status AS att_status, sa.check_in_at,
              EXISTS (SELECT 1 FROM staff_leave_requests l WHERE l.user_id = u.id AND l.school_id = $1 AND l.status = 'approved'
                       AND l.deleted_at IS NULL AND l.from_date <= $3::date AND l.to_date >= $3::date) AS on_leave,
              (SELECT avg(r.stars) FROM teacher_ratings r WHERE r.teacher_user_id = u.id AND r.deleted_at IS NULL
                 AND r.academic_year_id IN (SELECT id FROM yr)) AS rating_avg,
              (SELECT count(*) FROM teacher_ratings r WHERE r.teacher_user_id = u.id AND r.deleted_at IS NULL
                 AND r.academic_year_id IN (SELECT id FROM yr)) AS rating_count,
              COALESCE(res.passed, 0) AS passed, COALESCE(res.sat, 0) AS sat
       FROM people p JOIN users u ON u.id = p.user_id AND u.deleted_at IS NULL
       LEFT JOIN staff st ON st.user_id = u.id AND st.deleted_at IS NULL
       LEFT JOIN staff_attendance sa ON sa.user_id = u.id AND sa.date = $3::date
       LEFT JOIN results res ON res.user_id = u.id
       WHERE ($4::int IS NULL OR u.id = $4)
       ORDER BY u.name`,
      [schoolId, classIds, this.scope.today(), userId],
    );
  }

  private async papers(schoolId: number, classIds: number[] | null, userId: number): Promise<TeacherPaperDto[]> {
    const rows: Record<string, unknown>[] = await this.dataSource.query(
      `WITH yr AS (SELECT ay.id FROM academic_years ay WHERE ay.school_id = $1 AND ay.deleted_at IS NULL AND ${yearClause('ay')}),
       latest AS (
         SELECT DISTINCT ON (es.class_id) es.class_id, x.id AS exam_id, x.name AS exam
         FROM exams x JOIN exam_subjects es ON es.exam_id = x.id
         WHERE x.school_id = $1 AND x.status = 'published' AND x.deleted_at IS NULL AND x.academic_year_id IN (SELECT id FROM yr)
         ORDER BY es.class_id, x.start_date DESC, x.id DESC
       )
       SELECT c.name || ' - ' || s.name AS class_section, sb.name AS subject, l.exam,
              count(m.id) AS students,
              count(m.id) FILTER (WHERE NOT m.is_absent AND m.marks >= COALESCE(es.pass_marks, 0)) AS passed,
              avg(CASE WHEN m.is_absent THEN 0 ELSE m.marks END * 100.0 / NULLIF(es.max_marks, 0)) AS average_percent
       FROM teacher_assignments ta
       JOIN yr ON yr.id = ta.academic_year_id
       JOIN sections s ON s.id = ta.section_id AND s.deleted_at IS NULL
       JOIN classes c ON c.id = s.class_id
       JOIN subjects sb ON sb.id = ta.subject_id
       JOIN latest l ON l.class_id = s.class_id
       JOIN exam_subjects es ON es.exam_id = l.exam_id AND es.class_id = s.class_id AND es.subject_id = ta.subject_id
       JOIN student_enrollments e ON e.section_id = s.id AND e.status = 'studying' AND e.academic_year_id = yr.id
       LEFT JOIN exam_marks m ON m.exam_id = l.exam_id AND m.subject_id = ta.subject_id AND m.student_id = e.student_id
       WHERE ta.school_id = $1 AND ta.teacher_user_id = $2 AND ta.deleted_at IS NULL
         AND ($3::int[] IS NULL OR s.class_id = ANY($3))
       GROUP BY c.grade_level, c.name, s.name, sb.name, l.exam
       ORDER BY c.grade_level, s.name, sb.name`,
      [schoolId, userId, classIds],
    );
    return rows.map((row) => ({
      class_section: row.class_section as string,
      subject: row.subject as string,
      exam: row.exam as string,
      students: num(row.students),
      passed: num(row.passed),
      pass_percent: percent(num(row.passed), num(row.students)),
      average_percent: row.average_percent === null ? null : Math.round(Number(row.average_percent) * 10) / 10,
    }));
  }
}
