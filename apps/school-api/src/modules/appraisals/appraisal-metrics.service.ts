import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppException } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { PaperRow, subjectResults } from '../feedback/feedback.logic';
import { round2 } from './appraisal.logic';
import { AutoMetric } from './entities/appraisal.entity';

export type MetricValues = Record<AutoMetric, number | null>;

interface YearRange {
  id: number;
  start: string;
  end: string;
}

interface ClassResult {
  section_id: number;
  section: string;
  subject: string;
  periods_per_week: number;
  papers: number;
  pass_percent: number | null;
  average_percent: number | null;
}

export interface StaffDossier {
  user_id: number;
  academic_year_id: number;
  metrics: MetricValues;
  attendance: { marked_days: number; present: number; late: number; half_day: number; absent: number };
  workload: { periods_per_week: number; sections: number; classes: ClassResult[] };
  homework: { count: number; recent: { id: number; title: string; section: string | null; published_at: string }[] };
  ratings: { parent_average: number | null; parent_count: number; good_behaviour_percent: number | null };
  driver: { average: number | null; count: number };
}

const asNumber = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

@Injectable()
export class AppraisalMetricsService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async forUsers(schoolId: number, yearId: number, userIds: number[]): Promise<Map<number, MetricValues>> {
    const result = new Map<number, MetricValues>();
    if (!userIds.length) return result;
    const year = await this.year(schoolId, yearId);
    const [attendance, passes, ratings, homework, drivers] = await Promise.all([
      this.attendanceRows(schoolId, year, userIds),
      this.passPercents(schoolId, year, userIds),
      this.ratingRows(schoolId, year, userIds),
      this.homeworkRows(schoolId, year, userIds),
      this.driverRows(schoolId, year, userIds),
    ]);
    for (const userId of userIds) {
      const att = attendance.get(userId);
      const rating = ratings.get(userId);
      const driver = drivers.get(userId);
      result.set(userId, {
        attendance_percent: att ? attendancePercent(att) : null,
        exam_pass_percent: passes.get(userId)?.pass_percent ?? null,
        parent_rating: rating?.average ?? null,
        parent_good_behaviour_percent: rating?.good_percent ?? null,
        homework_count: homework.get(userId) ?? 0,
        driver_rating: driver?.average ?? null,
      });
    }
    return result;
  }

  async dossier(schoolId: number, yearId: number, userId: number): Promise<StaffDossier> {
    const year = await this.year(schoolId, yearId);
    const [metrics, attendance, classes, recent, ratings, drivers] = await Promise.all([
      this.forUsers(schoolId, yearId, [userId]),
      this.attendanceRows(schoolId, year, [userId]),
      this.classResults(schoolId, year, userId),
      this.dataSource.query(
        `SELECT d.id, d.title, d.published_at, c.name || ' - ' || sec.name AS section
         FROM diary_entries d
         LEFT JOIN sections sec ON sec.id = d.section_id LEFT JOIN classes c ON c.id = sec.class_id
         WHERE d.school_id = $1 AND d.created_by = $2 AND d.type = 'homework' AND d.status = 'published'
           AND d.deleted_at IS NULL AND d.published_at::date BETWEEN $3 AND $4
         ORDER BY d.published_at DESC LIMIT 5`,
        [schoolId, userId, year.start, year.end],
      ) as Promise<{ id: number; title: string; published_at: Date; section: string | null }[]>,
      this.ratingRows(schoolId, year, [userId]),
      this.driverRows(schoolId, year, [userId]),
    ]);
    const values = metrics.get(userId)!;
    const att = attendance.get(userId) ?? { marked: 0, present: 0, late: 0, half_day: 0, absent: 0 };
    return {
      user_id: userId,
      academic_year_id: yearId,
      metrics: values,
      attendance: {
        marked_days: att.marked,
        present: att.present,
        late: att.late,
        half_day: att.half_day,
        absent: att.absent,
      },
      workload: {
        periods_per_week: classes.reduce((sum, row) => sum + row.periods_per_week, 0),
        sections: new Set(classes.map((row) => row.section_id)).size,
        classes,
      },
      homework: {
        count: values.homework_count ?? 0,
        recent: recent.map((row) => ({
          id: Number(row.id),
          title: row.title,
          section: row.section,
          published_at: new Date(row.published_at).toISOString(),
        })),
      },
      ratings: {
        parent_average: ratings.get(userId)?.average ?? null,
        parent_count: ratings.get(userId)?.count ?? 0,
        good_behaviour_percent: ratings.get(userId)?.good_percent ?? null,
      },
      driver: { average: drivers.get(userId)?.average ?? null, count: drivers.get(userId)?.count ?? 0 },
    };
  }

  private async year(schoolId: number, yearId: number): Promise<YearRange> {
    const [row] = await this.dataSource.query(
      `SELECT id, start_date::text AS start, end_date::text AS end FROM academic_years
       WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [yearId, schoolId],
    );
    if (!row) throw AppException.notFound('Academic year not found', 'ACADEMIC_YEAR_NOT_FOUND');
    const today = todayIn(this.app.timeZone);
    return { id: Number(row.id), start: row.start, end: row.end < today ? row.end : today };
  }

  private async attendanceRows(schoolId: number, year: YearRange, userIds: number[]) {
    const rows: { user_id: number; marked: string; present: string; late: string; half_day: string; absent: string }[] =
      await this.dataSource.query(
        `SELECT user_id, COUNT(*) AS marked,
                COUNT(*) FILTER (WHERE status = 'present') AS present,
                COUNT(*) FILTER (WHERE status = 'late') AS late,
                COUNT(*) FILTER (WHERE status = 'half_day') AS half_day,
                COUNT(*) FILTER (WHERE status = 'absent') AS absent
         FROM staff_attendance
         WHERE school_id = $1 AND user_id = ANY($2) AND date BETWEEN $3 AND $4
         GROUP BY user_id`,
        [schoolId, userIds, year.start, year.end],
      );
    return new Map(
      rows.map((row) => [
        Number(row.user_id),
        {
          marked: Number(row.marked),
          present: Number(row.present),
          late: Number(row.late),
          half_day: Number(row.half_day),
          absent: Number(row.absent),
        },
      ]),
    );
  }

  private async assignments(schoolId: number, year: YearRange, userIds: number[]) {
    const rows: {
      teacher_user_id: number;
      section_id: number;
      subject_id: number;
      subject: string;
      section: string;
      periods_per_week: number;
    }[] = await this.dataSource.query(
      `SELECT ta.teacher_user_id, ta.section_id, ta.subject_id, ta.periods_per_week,
              sub.name AS subject, c.name || ' - ' || sec.name AS section
       FROM teacher_assignments ta
       JOIN subjects sub ON sub.id = ta.subject_id
       JOIN sections sec ON sec.id = ta.section_id JOIN classes c ON c.id = sec.class_id
       WHERE ta.school_id = $1 AND ta.academic_year_id = $2 AND ta.deleted_at IS NULL AND ta.teacher_user_id = ANY($3)
       ORDER BY c.name, sec.name, sub.name`,
      [schoolId, year.id, userIds],
    );
    return rows.map((row) => ({
      ...row,
      teacher_user_id: Number(row.teacher_user_id),
      section_id: Number(row.section_id),
      subject_id: Number(row.subject_id),
      periods_per_week: Number(row.periods_per_week),
    }));
  }

  private async results(schoolId: number, year: YearRange) {
    const papers: PaperRow[] = await this.dataSource.query(
      `SELECT e.section_id, m.subject_id, m.student_id, m.marks, m.is_absent, es.max_marks, es.pass_marks
       FROM exam_marks m
       JOIN exams x ON x.id = m.exam_id AND x.school_id = $1 AND x.academic_year_id = $2
         AND x.status = 'published' AND x.deleted_at IS NULL
       JOIN student_enrollments e ON e.student_id = m.student_id AND e.academic_year_id = $2 AND e.section_id IS NOT NULL
       JOIN students s ON s.id = m.student_id AND s.deleted_at IS NULL
       JOIN exam_subjects es ON es.exam_id = m.exam_id AND es.subject_id = m.subject_id AND es.class_id = e.class_id
       WHERE m.is_absent OR m.marks IS NOT NULL`,
      [schoolId, year.id],
    );
    return subjectResults(
      papers.map((row) => ({
        ...row,
        section_id: Number(row.section_id),
        subject_id: Number(row.subject_id),
        student_id: Number(row.student_id),
      })),
    );
  }

  private async passPercents(schoolId: number, year: YearRange, userIds: number[]) {
    const [assignments, results] = await Promise.all([
      this.assignments(schoolId, year, userIds),
      this.results(schoolId, year),
    ]);
    const totals = new Map<number, { papers: number; passed: number }>();
    for (const row of assignments) {
      const result = results.get(`${row.section_id}:${row.subject_id}`);
      if (!result?.papers) continue;
      const total = totals.get(row.teacher_user_id) ?? { papers: 0, passed: 0 };
      total.papers += result.papers;
      total.passed += result.passed;
      totals.set(row.teacher_user_id, total);
    }
    return new Map(
      [...totals].map(([userId, total]) => [userId, { pass_percent: round2((total.passed / total.papers) * 100) }]),
    );
  }

  private async classResults(schoolId: number, year: YearRange, userId: number): Promise<ClassResult[]> {
    const [assignments, results] = await Promise.all([
      this.assignments(schoolId, year, [userId]),
      this.results(schoolId, year),
    ]);
    return assignments.map((row) => {
      const result = results.get(`${row.section_id}:${row.subject_id}`);
      return {
        section_id: row.section_id,
        section: row.section,
        subject: row.subject,
        periods_per_week: row.periods_per_week,
        papers: result?.papers ?? 0,
        pass_percent: result?.pass_percent ?? null,
        average_percent: result?.average_percent ?? null,
      };
    });
  }

  private async ratingRows(schoolId: number, year: YearRange, userIds: number[]) {
    const rows: { teacher_user_id: number; average: string; count: string; good: string }[] =
      await this.dataSource.query(
        `SELECT teacher_user_id, AVG(stars) AS average, COUNT(*) AS count,
                COUNT(*) FILTER (WHERE behaviour = 'good') AS good
         FROM teacher_ratings
         WHERE school_id = $1 AND academic_year_id = $2 AND deleted_at IS NULL AND teacher_user_id = ANY($3)
         GROUP BY teacher_user_id`,
        [schoolId, year.id, userIds],
      );
    return new Map(
      rows.map((row) => [
        Number(row.teacher_user_id),
        {
          average: round2(Number(row.average)),
          count: Number(row.count),
          good_percent: Number(row.count) ? round2((Number(row.good) / Number(row.count)) * 100) : null,
        },
      ]),
    );
  }

  private async homeworkRows(schoolId: number, year: YearRange, userIds: number[]) {
    const rows: { user_id: number; count: string }[] = await this.dataSource.query(
      `SELECT created_by AS user_id, COUNT(*) AS count FROM diary_entries
       WHERE school_id = $1 AND created_by = ANY($2) AND type = 'homework' AND status = 'published'
         AND deleted_at IS NULL AND published_at::date BETWEEN $3 AND $4
       GROUP BY created_by`,
      [schoolId, userIds, year.start, year.end],
    );
    return new Map(rows.map((row) => [Number(row.user_id), Number(row.count)]));
  }

  private async driverRows(schoolId: number, year: YearRange, userIds: number[]) {
    const rows: { driver_user_id: number; average: string; count: string }[] = await this.dataSource.query(
      `SELECT driver_user_id, AVG(rating) AS average, COUNT(*) AS count FROM driver_ratings
       WHERE school_id = $1 AND driver_user_id = ANY($2) AND deleted_at IS NULL
         AND month BETWEEN to_char($3::date, 'YYYY-MM') AND to_char($4::date, 'YYYY-MM')
       GROUP BY driver_user_id`,
      [schoolId, userIds, year.start, year.end],
    );
    return new Map(
      rows.map((row) => [
        Number(row.driver_user_id),
        { average: asNumber(row.average) === null ? null : round2(Number(row.average)), count: Number(row.count) },
      ]),
    );
  }
}

function attendancePercent(row: { marked: number; present: number; late: number; half_day: number }): number | null {
  if (!row.marked) return null;
  return round2(((row.present + row.late + row.half_day * 0.5) / row.marked) * 100);
}
