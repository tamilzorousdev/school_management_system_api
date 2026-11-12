import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthUser } from '@app/common';
import { ACHIEVEMENT_LEVELS } from '../achievements/entities/student-achievement.entity';
import { visibleSections, whenAllowed } from './dashboard.logic';
import { YearPerformanceListDto } from './dto/year-performance.dto';
import { byYear, FigureRow, groupByYear, YearRow, yearPerformance } from './year-performance.logic';

const DAY_VALUE = `CASE d.status WHEN 'present' THEN 1 WHEN 'late' THEN 1 WHEN 'half_day' THEN 0.5 WHEN 'absent' THEN 0 END`;

const datedIn = (table: string, alias: string, dateColumn: string, extra = '') =>
  `academic_years y
   JOIN ${table} ${alias} ON ${alias}.school_id = y.school_id ${extra}
     AND ${alias}.${dateColumn} BETWEEN y.start_date AND y.end_date
   WHERE y.school_id = $1 AND y.deleted_at IS NULL`;

@Injectable()
export class YearPerformanceService {
  constructor(private readonly dataSource: DataSource) {}

  async list(schoolId: number, user: AuthUser): Promise<YearPerformanceListDto> {
    const show = visibleSections(user.permissions);
    const [years, students, attendance, staff, studies, activities, fees, feeHeads] = await Promise.all([
      this.years(schoolId),
      whenAllowed(show.students, () => this.students(schoolId)),
      whenAllowed(show.attendance, () => this.attendance(schoolId)),
      whenAllowed(show.attendance, () => this.staffAttendance(schoolId)),
      whenAllowed(show.exams, () => this.studies(schoolId)),
      whenAllowed(show.students, () => this.activities(schoolId)),
      whenAllowed(show.fees, () => this.fees(schoolId)),
      whenAllowed(show.fees, () => this.feeHeads(schoolId)),
    ]);
    return {
      years: yearPerformance(years, { students, attendance, staff, studies, activities, fees, feeHeads }, show),
    };
  }

  private years(schoolId: number): Promise<YearRow[]> {
    return this.dataSource.query(
      `SELECT y.id, y.name, y.start_date, y.end_date, y.is_current
       FROM academic_years y
       WHERE y.school_id = $1 AND y.deleted_at IS NULL
         AND y.start_date <= COALESCE(
           (SELECT c.start_date FROM academic_years c
            WHERE c.school_id = $1 AND c.is_current = true AND c.deleted_at IS NULL),
           CURRENT_DATE)
       ORDER BY y.start_date DESC`,
      [schoolId],
    );
  }

  private async rows(sql: string, schoolId: number) {
    return byYear((await this.dataSource.query(sql, [schoolId])) as FigureRow[]);
  }

  private students(schoolId: number) {
    return this.rows(
      `SELECT e.academic_year_id AS year_id,
              COUNT(DISTINCT e.student_id)::int AS enrolled,
              COUNT(*) FILTER (WHERE e.status = 'promoted')::int AS promoted,
              COUNT(*) FILTER (WHERE e.status = 'left')::int AS left_school
       FROM student_enrollments e
       JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
       WHERE e.school_id = $1
       GROUP BY e.academic_year_id`,
      schoolId,
    );
  }

  private attendance(schoolId: number) {
    return this.rows(
      `WITH days AS (
         SELECT y.id AS year_id, d.student_id, d.date, ${DAY_VALUE} AS value
         FROM ${datedIn('student_attendance_days', 'd', 'date')}
       ),
       per_student AS (
         SELECT year_id, student_id, SUM(COALESCE(value, 0)) / COUNT(*) AS ratio
         FROM days GROUP BY year_id, student_id
       )
       SELECT t.year_id, t.percent, t.days_marked, COALESCE(b.below_75, 0)::int AS below_75
       FROM (SELECT year_id, ROUND(100 * AVG(value)::numeric, 1) AS percent, COUNT(DISTINCT date)::int AS days_marked
             FROM days GROUP BY year_id) t
       LEFT JOIN (SELECT year_id, COUNT(*) AS below_75 FROM per_student WHERE ratio < 0.75 GROUP BY year_id) b
         ON b.year_id = t.year_id`,
      schoolId,
    );
  }

  private staffAttendance(schoolId: number) {
    return this.rows(
      `SELECT y.id AS year_id, ROUND(100 * AVG(${DAY_VALUE})::numeric, 1) AS percent
       FROM ${datedIn('staff_attendance', 'd', 'date')}
       GROUP BY y.id`,
      schoolId,
    );
  }

  private studies(schoolId: number) {
    return this.rows(
      `WITH scored AS (
         SELECT x.academic_year_id AS year_id, m.exam_id, m.student_id,
                SUM(CASE WHEN m.is_absent THEN 0 ELSE m.marks END) AS total,
                SUM(es.max_marks) AS max_total,
                bool_or(m.is_absent OR m.marks < es.pass_marks) AS failed,
                COUNT(*) AS papers,
                COUNT(*) FILTER (WHERE m.is_absent) AS absent_papers
         FROM exam_marks m
         JOIN exams x ON x.id = m.exam_id AND x.school_id = $1 AND x.status = 'published' AND x.deleted_at IS NULL
         JOIN student_enrollments e ON e.student_id = m.student_id AND e.academic_year_id = x.academic_year_id
         JOIN exam_subjects es ON es.exam_id = m.exam_id AND es.subject_id = m.subject_id AND es.class_id = e.class_id
         WHERE m.is_absent OR m.marks IS NOT NULL
         GROUP BY x.academic_year_id, m.exam_id, m.student_id
       )
       SELECT year_id,
              COUNT(DISTINCT exam_id)::int AS exams,
              COUNT(DISTINCT student_id)::int AS students,
              ROUND(AVG(100.0 * total / NULLIF(max_total, 0))::numeric, 1) AS average_percent,
              ROUND(100.0 * COUNT(*) FILTER (WHERE NOT failed) / COUNT(*), 1) AS pass_percent,
              ROUND(100.0 * COUNT(*) FILTER (WHERE failed) / COUNT(*), 1) AS fail_percent,
              ROUND(100.0 * SUM(absent_papers) / NULLIF(SUM(papers), 0), 1) AS absent_percent
       FROM scored GROUP BY year_id`,
      schoolId,
    );
  }

  private activities(schoolId: number) {
    const levels = ACHIEVEMENT_LEVELS.map((level) => `'${level}'`).join(', ');
    return this.rows(
      `SELECT y.id AS year_id,
              COUNT(a.id)::int AS total,
              COUNT(a.id) FILTER (WHERE a.category = 'sports')::int AS sports,
              COUNT(a.id) FILTER (WHERE a.result IN ('winner', 'runner_up', 'third_place'))::int AS podium,
              COUNT(DISTINCT a.student_id)::int AS students,
              COALESCE(SUM(a.points), 0)::int AS points,
              MAX(array_position(ARRAY[${levels}]::text[], a.level::text)) AS top_rank
       FROM ${datedIn('student_achievements', 'a', 'achieved_on', 'AND a.deleted_at IS NULL')}
       GROUP BY y.id`,
      schoolId,
    );
  }

  private fees(schoolId: number) {
    return this.rows(
      `SELECT academic_year_id AS year_id, SUM(total) AS billed, SUM(paid) AS collected
       FROM fee_invoices
       WHERE school_id = $1 AND deleted_at IS NULL AND status <> 'cancelled'
       GROUP BY academic_year_id`,
      schoolId,
    );
  }

  private async feeHeads(schoolId: number) {
    const rows: FigureRow[] = await this.dataSource.query(
      `SELECT i.academic_year_id AS year_id,
              COALESCE(h.name, l.head_name) AS name,
              bool_or(COALESCE(h.is_transport, false)) AS is_transport,
              COALESCE(SUM(l.amount * i.total / NULLIF(i.gross, 0)), 0) AS billed,
              COALESCE(SUM(l.amount * i.paid / NULLIF(i.gross, 0)), 0) AS collected
       FROM fee_invoice_lines l
       JOIN fee_invoices i ON i.id = l.invoice_id AND i.school_id = $1 AND i.deleted_at IS NULL AND i.status <> 'cancelled'
       LEFT JOIN fee_heads h ON h.id = l.fee_head_id
       WHERE l.deleted_at IS NULL
       GROUP BY i.academic_year_id, COALESCE(h.name, l.head_name)`,
      [schoolId],
    );
    return groupByYear(rows);
  }
}
