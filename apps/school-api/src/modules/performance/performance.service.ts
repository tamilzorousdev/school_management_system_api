import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppException } from '@app/common';
import { yearWhere } from '../../shared/year-context';
import { AcademicYear } from '../setup/entities/academic-year.entity';
import {
  BelowAverageDto,
  BelowAverageQueryDto,
  ClassPerformanceDto,
  PerformanceQueryDto,
  SectionPerformanceDto,
} from './dto/performance.dto';
import {
  average,
  belowLine,
  MarkRow,
  round1,
  scoreStudents,
  sectionFigures,
  StudentScore,
  subjectAverages,
  weakSubjects,
} from './performance.logic';

const DAY_VALUE = `CASE d.status WHEN 'present' THEN 1 WHEN 'late' THEN 1 WHEN 'half_day' THEN 0.5 WHEN 'absent' THEN 0 END`;

interface SectionRow {
  section_id: number;
  class_id: number;
  class_name: string;
  section_name: string;
  class_teacher: string | null;
  students: string;
  special_classes: string;
}

@Injectable()
export class PerformanceService {
  constructor(private readonly dataSource: DataSource) {}

  async classes(schoolId: number, query: PerformanceQueryDto): Promise<ClassPerformanceDto> {
    const year = await this.year(schoolId);
    const exam = await this.exam(schoolId, year.id, query.exam_id);
    const [sections, marks, attendance] = await Promise.all([
      this.sections(schoolId, year.id, query.class_id),
      this.marks(schoolId, year.id, exam?.id, query.class_id),
      this.sectionAttendance(schoolId, year),
    ]);
    const scores = [...scoreStudents(marks).values()];
    const rows: SectionPerformanceDto[] = sections
      .filter((section) => Number(section.students) > 0)
      .map((section) => {
        const own = scores.filter((score) => score.section_id === Number(section.section_id));
        return {
          section_id: Number(section.section_id),
          class_id: Number(section.class_id),
          name: `${section.class_name} - ${section.section_name}`,
          class_teacher: section.class_teacher,
          students: Number(section.students),
          ...sectionFigures(own),
          attendance_percent: attendance.get(Number(section.section_id)) ?? null,
          special_classes: Number(section.special_classes),
        };
      });
    const totals = sectionFigures(scores);
    return {
      academic_year: { id: year.id, name: year.name },
      exam,
      totals: {
        students: rows.reduce((sum, row) => sum + row.students, 0),
        assessed: totals.assessed,
        average_percent: totals.average_percent,
        pass_percent: totals.pass_percent,
        fail_percent: totals.fail_percent,
        attendance_percent: average(
          rows.map((row) => row.attendance_percent).filter((value): value is number => value !== null),
        ),
        below_average: rows.reduce((sum, row) => sum + row.below_average, 0),
      },
      sections: rows,
    };
  }

  async belowAverage(schoolId: number, sectionId: number, query: BelowAverageQueryDto): Promise<BelowAverageDto> {
    const year = await this.year(schoolId);
    const [section] = await this.dataSource.query(
      `SELECT sec.id, sec.name, c.name AS class_name, sec.class_id FROM sections sec JOIN classes c ON c.id = sec.class_id
       WHERE sec.id = $1 AND sec.school_id = $2 AND sec.academic_year_id = $3 AND sec.deleted_at IS NULL`,
      [sectionId, schoolId, year.id],
    );
    if (!section) throw AppException.notFound('Section not found', 'SECTION_NOT_FOUND');
    const exam = await this.exam(schoolId, year.id, query.exam_id);
    const [marks, students, attendance, special] = await Promise.all([
      this.marks(schoolId, year.id, exam?.id, undefined, sectionId),
      this.dataSource.query(
        `SELECT s.id, s.first_name, s.last_name, e.roll_no FROM student_enrollments e
         JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL AND s.status = 'active'
         WHERE e.section_id = $1 AND e.academic_year_id = $2`,
        [sectionId, year.id],
      ) as Promise<{ id: number; first_name: string; last_name: string | null; roll_no: number | null }[]>,
      this.studentAttendance(schoolId, year, sectionId),
      this.dataSource.query(
        `SELECT st.student_id, sc.id, sc.title FROM special_class_students st
         JOIN special_classes sc ON sc.id = st.special_class_id AND sc.deleted_at IS NULL
         WHERE sc.section_id = $1`,
        [sectionId],
      ) as Promise<{ student_id: number; id: number; title: string }[]>,
    ]);
    const scores = [...scoreStudents(marks).values()];
    const sectionAverage = average(scores.map((score) => score.percent));
    const line = belowLine(scores, query.below);
    const subjects = subjectAverages(scores);
    const byId = new Map(students.map((student) => [Number(student.id), student]));
    const below = line === null ? [] : scores.filter((score) => score.percent < line && byId.has(score.student_id));
    return {
      section: { id: Number(section.id), name: `${section.class_name} - ${section.name}` },
      exam,
      section_average: sectionAverage,
      line,
      students: below
        .sort((a, b) => a.percent - b.percent)
        .map((score: StudentScore) => {
          const student = byId.get(score.student_id)!;
          return {
            student_id: score.student_id,
            full_name: [student.first_name, student.last_name].filter(Boolean).join(' '),
            roll_no: student.roll_no,
            percent: score.percent,
            gap: round1(line! - score.percent),
            failed_results: score.failed_results,
            attendance_percent: attendance.get(score.student_id) ?? null,
            weak_subjects: weakSubjects(score, subjects),
            special_classes: special
              .filter((row) => Number(row.student_id) === score.student_id)
              .map((row) => ({ id: Number(row.id), title: row.title })),
          };
        }),
    };
  }

  private async year(schoolId: number): Promise<AcademicYear> {
    const year = await this.dataSource.getRepository(AcademicYear).findOneBy(yearWhere(schoolId));
    if (!year) throw AppException.badRequest('Set the current academic year first', 'NO_CURRENT_YEAR');
    return year;
  }

  private async exam(schoolId: number, yearId: number, examId?: number) {
    if (!examId) return null;
    const [exam] = await this.dataSource.query(
      `SELECT id, name FROM exams
       WHERE id = $1 AND school_id = $2 AND academic_year_id = $3 AND status = 'published' AND deleted_at IS NULL`,
      [examId, schoolId, yearId],
    );
    if (!exam) throw AppException.notFound('Published exam not found', 'EXAM_NOT_FOUND');
    return { id: Number(exam.id), name: exam.name as string };
  }

  private sections(schoolId: number, yearId: number, classId?: number): Promise<SectionRow[]> {
    return this.dataSource.query(
      `SELECT sec.id AS section_id, sec.class_id, c.name AS class_name, sec.name AS section_name, t.name AS class_teacher,
              (SELECT COUNT(*) FROM student_enrollments e JOIN students s ON s.id = e.student_id
                WHERE e.section_id = sec.id AND e.academic_year_id = $2 AND s.deleted_at IS NULL AND s.status = 'active') AS students,
              (SELECT COUNT(*) FROM special_classes sc WHERE sc.section_id = sec.id AND sc.deleted_at IS NULL) AS special_classes
       FROM sections sec
       JOIN classes c ON c.id = sec.class_id AND c.deleted_at IS NULL
       LEFT JOIN users t ON t.id = sec.class_teacher_user_id
       WHERE sec.school_id = $1 AND sec.academic_year_id = $2 AND sec.deleted_at IS NULL
         ${classId ? 'AND sec.class_id = $3' : ''}
       ORDER BY c.grade_level, sec.name`,
      classId ? [schoolId, yearId, classId] : [schoolId, yearId],
    );
  }

  private marks(
    schoolId: number,
    yearId: number,
    examId?: number,
    classId?: number,
    sectionId?: number,
  ): Promise<MarkRow[]> {
    const params: number[] = [schoolId, yearId];
    const extra: string[] = [];
    if (examId) extra.push(`AND x.id = $${params.push(examId)}`);
    if (classId) extra.push(`AND e.class_id = $${params.push(classId)}`);
    if (sectionId) extra.push(`AND e.section_id = $${params.push(sectionId)}`);
    return this.dataSource.query(
      `SELECT e.section_id, m.student_id, m.exam_id, m.subject_id, sub.name AS subject_name,
              m.marks, m.is_absent, es.max_marks, es.pass_marks
       FROM exam_marks m
       JOIN exams x ON x.id = m.exam_id AND x.school_id = $1 AND x.academic_year_id = $2
         AND x.status = 'published' AND x.deleted_at IS NULL
       JOIN student_enrollments e ON e.student_id = m.student_id AND e.academic_year_id = $2 AND e.section_id IS NOT NULL
       JOIN students s ON s.id = m.student_id AND s.deleted_at IS NULL
       JOIN exam_subjects es ON es.exam_id = m.exam_id AND es.subject_id = m.subject_id AND es.class_id = e.class_id
       JOIN subjects sub ON sub.id = m.subject_id
       WHERE (m.is_absent OR m.marks IS NOT NULL) ${extra.join(' ')}`,
      params,
    );
  }

  private async sectionAttendance(schoolId: number, year: AcademicYear): Promise<Map<number, number>> {
    const rows: { section_id: number; percent: string | null }[] = await this.dataSource.query(
      `SELECT e.section_id, ROUND(100 * AVG(${DAY_VALUE})::numeric, 1) AS percent
       FROM student_attendance_days d
       JOIN student_enrollments e ON e.student_id = d.student_id AND e.academic_year_id = $2
       WHERE d.school_id = $1 AND d.date BETWEEN $3 AND $4
       GROUP BY e.section_id`,
      [schoolId, year.id, year.start_date, year.end_date],
    );
    return new Map(
      rows.filter((row) => row.percent !== null).map((row) => [Number(row.section_id), Number(row.percent)]),
    );
  }

  private async studentAttendance(
    schoolId: number,
    year: AcademicYear,
    sectionId: number,
  ): Promise<Map<number, number>> {
    const rows: { student_id: number; percent: string | null }[] = await this.dataSource.query(
      `SELECT d.student_id, ROUND(100 * AVG(${DAY_VALUE})::numeric, 1) AS percent
       FROM student_attendance_days d
       JOIN student_enrollments e ON e.student_id = d.student_id AND e.academic_year_id = $2 AND e.section_id = $5
       WHERE d.school_id = $1 AND d.date BETWEEN $3 AND $4
       GROUP BY d.student_id`,
      [schoolId, year.id, year.start_date, year.end_date, sectionId],
    );
    return new Map(
      rows.filter((row) => row.percent !== null).map((row) => [Number(row.student_id), Number(row.percent)]),
    );
  }
}
