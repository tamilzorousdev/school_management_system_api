import { Inject, Injectable } from '@nestjs/common';
import { DataSource, In, IsNull } from 'typeorm';
import { AppException } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { FilesService } from '../files/files.service';
import {
  ReportCardDto,
  ReportCardOptionDto,
  ReportCardOptionsDto,
  ReportCardQueryDto,
  ReportCardScopeDto,
  ReportCardStudentDto,
  SectionReportCardQueryDto,
  SignReportCardDto,
  SectionSignaturesStatusDto,
  SectionStudentSignatureItemDto,
} from './dto/report-card.dto';
import { StudentExamResultDto } from './dto/exams.dto';
import { Exam } from './entities/exam.entity';
import { ReportCardSignature } from './entities/report-card-signature.entity';
import { Staff } from '../staff/entities/staff.entity';
import { Guardian } from '../students/entities/guardian.entity';
import { ExamsService } from './exams.service';
import { reportCardsPdf, ReportCardPdfData } from './report-card.pdf';
import { attendanceSummary, buildReportCard, CardExamInput, gradeScale } from './report-card.logic';

interface Enrollment {
  student_id: number;
  full_name: string;
  admission_no: string;
  dob: string;
  photo_file_id: number | null;
  academic_year_id: number;
  academic_year_name: string;
  year_start: string;
  year_end: string;
  class_id: number;
  class_name: string;
  section_id: number | null;
  section_name: string;
  roll_no: number | null;
  class_teacher: string | null;
  parent_name: string | null;
  class_teacher_user_id: number | null;
  class_teacher_signature_file_id: number | null;
  parent_mobile: string | null;
  parent_signature_file_id: number | null;
}

interface YearExam {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  term_id: number | null;
  term_name: string | null;
  term_order: number;
  term_start: string | null;
  term_end: string | null;
}

interface Scope {
  kind: ReportCardScopeDto['kind'];
  exams: YearExam[];
  term: ReportCardOptionDto | null;
  exam: ReportCardOptionDto | null;
  from: string;
  to: string;
}

interface SchoolInfo {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  board: string | null;
  logo_file_id: number | null;
  signature_file_id: number | null;
  seal_file_id: number | null;
  principal_name: string | null;
}

const ENROLLMENT_SQL = `
  SELECT s.id AS student_id, concat_ws(' ', s.first_name, s.last_name) AS full_name, s.admission_no,
         to_char(s.dob, 'YYYY-MM-DD') AS dob, s.photo_file_id,
         y.id AS academic_year_id, y.name AS academic_year_name,
         to_char(y.start_date, 'YYYY-MM-DD') AS year_start, to_char(y.end_date, 'YYYY-MM-DD') AS year_end,
         c.id AS class_id, c.name AS class_name, e.section_id, coalesce(sec.name, '') AS section_name, e.roll_no,
         u.name AS class_teacher,
         sec.class_teacher_user_id,
         st.signature_file_id AS class_teacher_signature_file_id,
         (SELECT g.name FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
          WHERE sg.student_id = s.id ORDER BY sg.is_primary DESC, sg.id LIMIT 1) AS parent_name,
         (SELECT g.mobile FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
          WHERE sg.student_id = s.id ORDER BY sg.is_primary DESC, sg.id LIMIT 1) AS parent_mobile,
         (SELECT g.signature_file_id FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
          WHERE sg.student_id = s.id ORDER BY sg.is_primary DESC, sg.id LIMIT 1) AS parent_signature_file_id
  FROM student_enrollments e
  JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
  JOIN academic_years y ON y.id = e.academic_year_id
  JOIN classes c ON c.id = e.class_id
  LEFT JOIN sections sec ON sec.id = e.section_id
  LEFT JOIN users u ON u.id = sec.class_teacher_user_id
  LEFT JOIN staff st ON st.user_id = sec.class_teacher_user_id AND st.deleted_at IS NULL`;

@Injectable()
export class ReportCardsService {
  constructor(
    private readonly exams: ExamsService,
    private readonly files: FilesService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async card(schoolId: number, studentId: number, query: ReportCardQueryDto, pdfBase: string): Promise<ReportCardDto> {
    const enrollment = await this.enrollment(schoolId, studentId, query.academic_year_id);
    const yearExams = await this.yearExams(schoolId, enrollment.academic_year_id, enrollment.class_id);
    const scope = this.scope(enrollment, yearExams, query);
    const results = await this.studentResults(schoolId, scope.exams, enrollment);
    return this.present(schoolId, enrollment, scope, results, await this.options(schoolId, enrollment, yearExams), {
      base: pdfBase,
      query,
    });
  }

  async childCard(userId: number, studentId: number, query: ReportCardQueryDto, pdfBase: string) {
    return this.card(await this.childSchool(userId, studentId), studentId, query, pdfBase);
  }

  async pdf(schoolId: number, studentId: number, query: ReportCardQueryDto): Promise<{ name: string; pdf: Buffer }> {
    const card = await this.card(schoolId, studentId, query, '');
    if (!card.columns.length) throw this.noResults();
    const pdf = await reportCardsPdf([await this.pdfData(schoolId, card)]);
    return { name: this.fileName(card), pdf };
  }

  async childPdf(userId: number, studentId: number, query: ReportCardQueryDto) {
    return this.pdf(await this.childSchool(userId, studentId), studentId, query);
  }

  async sectionPdf(
    schoolId: number,
    sectionId: number,
    query: SectionReportCardQueryDto,
  ): Promise<{ name: string; pdf: Buffer }> {
    const roster = await this.sectionRoster(schoolId, sectionId);
    const first = roster[0]!;
    const yearExams = await this.yearExams(schoolId, first.academic_year_id, first.class_id);
    const scope = this.scope(first, yearExams, query);
    if (!scope.exams.length) throw this.noResults();
    const types = await this.subjectTypes(scope.exams);
    const byExam = new Map<number, Map<number, StudentExamResultDto>>();
    for (const exam of scope.exams) {
      byExam.set(
        exam.id,
        await this.exams.resultsByStudent(await this.examRow(schoolId, exam.id), first.class_id, first.class_name),
      );
    }
    const pages: ReportCardPdfData[] = [];
    for (const enrollment of roster) {
      const results = scope.exams
        .map((exam) => this.cardExam(exam, byExam.get(exam.id)?.get(enrollment.student_id), types))
        .filter((item): item is CardExamInput => item !== null);
      if (!results.length) continue;
      const card = await this.present(schoolId, enrollment, scope, results, null, null);
      pages.push(await this.pdfData(schoolId, card));
    }
    if (!pages.length) throw this.noResults();
    const label = scope.exam?.name ?? scope.term?.name ?? first.academic_year_name;
    return {
      name: `Report-cards-${first.class_name}-${first.section_name}-${label}`.replace(/[^\w.-]+/g, '-'),
      pdf: await reportCardsPdf(pages),
    };
  }

  private async present(
    schoolId: number,
    enrollment: Enrollment,
    scope: Scope,
    results: CardExamInput[],
    options: ReportCardOptionsDto | null,
    pdf: { base: string; query: ReportCardQueryDto } | null,
  ): Promise<ReportCardDto> {
    const school = await this.school(schoolId);
    const body = buildReportCard(results);
    return {
      school: {
        name: school.name,
        address: school.address,
        phone: school.phone,
        email: school.email,
        board: school.board,
        logo_url: this.files.linkFor(school.logo_file_id),
        principal_name: school.principal_name,
        signature_url: this.files.linkFor(school.signature_file_id),
        seal_url: this.files.linkFor(school.seal_file_id),
      },
      student: await this.studentDto(schoolId, enrollment, scope),
      scope: {
        kind: scope.kind,
        title: this.title(scope),
        academic_year: { id: enrollment.academic_year_id, name: enrollment.academic_year_name },
        term: scope.term,
        exam: scope.exam,
        from: scope.from,
        to: scope.to,
      },
      ...body,
      attendance: await this.attendance(enrollment.student_id, scope.from, scope.to),
      grade_scale: gradeScale(),
      options: options ?? { academic_years: [], terms: [], exams: [] },
      pdf_path: pdf ? `${pdf.base}${this.queryString(pdf.query, enrollment.academic_year_id)}` : '',
      generated_at: new Date(),
    };
  }

  private async studentDto(schoolId: number, enrollment: Enrollment, scope: Scope): Promise<ReportCardStudentDto> {
    const sigRepo = this.dataSource.getRepository(ReportCardSignature);
    const sig = await sigRepo.findOne({
      where: {
        school_id: schoolId,
        student_id: enrollment.student_id,
        academic_year_id: enrollment.academic_year_id,
        term_id: scope.term?.id ?? IsNull(),
        exam_id: scope.exam?.id ?? IsNull(),
      },
    });
    const teacherSigned = !!(sig?.teacher_signed_at || enrollment.class_teacher_signature_file_id);
    const parentSigned = !!sig?.parent_signed_at;
    const teacherSigFileId = sig?.teacher_signature_file_id ?? enrollment.class_teacher_signature_file_id;
    const parentSigFileId =
      sig?.parent_signature_file_id ?? (parentSigned ? enrollment.parent_signature_file_id : null);
    return {
      id: enrollment.student_id,
      full_name: enrollment.full_name,
      admission_no: enrollment.admission_no,
      class_name: enrollment.class_name,
      section_name: enrollment.section_name,
      roll_no: enrollment.roll_no,
      dob: enrollment.dob,
      parent_name: enrollment.parent_name,
      class_teacher: enrollment.class_teacher,
      photo_url: this.files.linkFor(enrollment.photo_file_id),
      class_teacher_signature_url: teacherSigned ? this.files.linkFor(teacherSigFileId) : null,
      parent_signature_url: parentSigned ? this.files.linkFor(parentSigFileId) : null,
      parent_signed: parentSigned,
      parent_signed_at: sig?.parent_signed_at ?? null,
      teacher_signed: teacherSigned,
      teacher_signed_at: sig?.teacher_signed_at ?? null,
    };
  }

  private scope(enrollment: Enrollment, yearExams: YearExam[], query: SectionReportCardQueryDto): Scope {
    const yearEnd = this.capToday(enrollment.year_end);
    if (query.exam_id) {
      const exam = yearExams.find((item) => item.id === query.exam_id);
      if (!exam) throw AppException.notFound('No published results for this exam', 'EXAM_NOT_FOUND');
      return {
        kind: 'exam',
        exams: [exam],
        term: exam.term_id ? { id: exam.term_id, name: exam.term_name! } : null,
        exam: { id: exam.id, name: exam.name },
        from: exam.term_start ?? enrollment.year_start,
        to: this.capToday(exam.end_date),
      };
    }
    if (query.term_id) {
      const exams = yearExams.filter((item) => item.term_id === query.term_id);
      const term = exams[0];
      if (!term) throw AppException.notFound('No published results in this term', 'TERM_NOT_FOUND');
      return {
        kind: 'term',
        exams,
        term: { id: term.term_id!, name: term.term_name! },
        exam: null,
        from: term.term_start ?? enrollment.year_start,
        to: this.capToday(term.term_end ?? yearEnd),
      };
    }
    return { kind: 'year', exams: yearExams, term: null, exam: null, from: enrollment.year_start, to: yearEnd };
  }

  private title(scope: Scope): string {
    if (scope.kind === 'exam') return `Report card · ${scope.exam!.name}`;
    if (scope.kind === 'term') return `Report card · ${scope.term!.name}`;
    return 'Annual report card';
  }

  private async studentResults(schoolId: number, exams: YearExam[], enrollment: Enrollment) {
    const types = await this.subjectTypes(exams);
    const results: CardExamInput[] = [];
    for (const exam of exams) {
      const result = await this.exams.resultFor(
        await this.examRow(schoolId, exam.id),
        enrollment.class_id,
        enrollment.class_name,
        enrollment.student_id,
      );
      const card = this.cardExam(exam, result ?? undefined, types);
      if (card) results.push(card);
    }
    return results;
  }

  private async subjectTypes(exams: YearExam[]): Promise<Map<number, string>> {
    if (!exams.length) return new Map();
    const rows: { id: number; type: string }[] = await this.dataSource.query(
      `SELECT DISTINCT s.id, s.type FROM subjects s JOIN exam_subjects es ON es.subject_id = s.id WHERE es.exam_id = ANY($1)`,
      [exams.map((exam) => exam.id)],
    );
    return new Map(rows.map((row) => [Number(row.id), row.type]));
  }

  private cardExam(
    exam: YearExam,
    result: StudentExamResultDto | undefined,
    types: Map<number, string>,
  ): CardExamInput | null {
    if (!result) return null;
    return {
      id: exam.id,
      name: exam.name,
      start_date: exam.start_date,
      end_date: exam.end_date,
      term_id: exam.term_id,
      term_name: exam.term_name,
      term_order: exam.term_order,
      total: result.total,
      max_total: result.max_total,
      percent: result.percent,
      grade: result.grade,
      result: result.result,
      section_rank: result.section_rank,
      section_size: result.section_size,
      class_rank: result.class_rank,
      class_size: result.class_size,
      subjects: result.subjects.map((subject) => ({
        subject_id: subject.subject_id,
        name: subject.name,
        code: subject.code,
        max_marks: subject.max_marks,
        pass_marks: subject.pass_marks,
        marks: subject.marks,
        is_absent: subject.is_absent,
        passed: subject.passed,
        type: types.get(subject.subject_id),
      })),
    };
  }

  private async enrollment(schoolId: number, studentId: number, yearId?: number): Promise<Enrollment> {
    const [student] = await this.dataSource.query(
      `SELECT id FROM students WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [studentId, schoolId],
    );
    if (!student) throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');
    const rows = await this.dataSource.query(
      `${ENROLLMENT_SQL}
       WHERE e.student_id = $1 AND e.school_id = $2 AND ($3::int IS NULL OR e.academic_year_id = $3)
       ORDER BY (y.is_current IS TRUE) DESC, y.start_date DESC
       LIMIT 1`,
      [studentId, schoolId, yearId ?? null],
    );
    if (!rows[0]) {
      throw AppException.notFound('The student is not enrolled in this academic year', 'ENROLLMENT_NOT_FOUND');
    }
    return this.enrollmentRow(rows[0]);
  }

  private async sectionRoster(schoolId: number, sectionId: number): Promise<Enrollment[]> {
    const [section] = await this.dataSource.query(
      `SELECT id FROM sections WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [sectionId, schoolId],
    );
    if (!section) throw AppException.notFound('Section not found', 'SECTION_NOT_FOUND');
    const rows = await this.dataSource.query(
      `${ENROLLMENT_SQL}
       WHERE e.section_id = $1 AND e.school_id = $2 AND e.academic_year_id = (SELECT academic_year_id FROM sections WHERE id = $1)
         AND s.status = 'active'
       ORDER BY e.roll_no NULLS LAST, s.first_name, s.last_name`,
      [sectionId, schoolId],
    );
    if (!rows.length) throw AppException.notFound('No students in this section', 'NO_STUDENTS');
    return rows.map((row: Record<string, unknown>) => this.enrollmentRow(row));
  }

  private enrollmentRow(row: Record<string, unknown>): Enrollment {
    return {
      student_id: Number(row.student_id),
      full_name: String(row.full_name),
      admission_no: String(row.admission_no),
      dob: String(row.dob),
      photo_file_id: row.photo_file_id === null ? null : Number(row.photo_file_id),
      academic_year_id: Number(row.academic_year_id),
      academic_year_name: String(row.academic_year_name),
      year_start: String(row.year_start),
      year_end: String(row.year_end),
      class_id: Number(row.class_id),
      class_name: String(row.class_name),
      section_id: row.section_id === null ? null : Number(row.section_id),
      section_name: String(row.section_name),
      roll_no: row.roll_no === null ? null : Number(row.roll_no),
      class_teacher: (row.class_teacher as string | null) ?? null,
      parent_name: (row.parent_name as string | null) ?? null,
      class_teacher_user_id: row.class_teacher_user_id === null ? null : Number(row.class_teacher_user_id),
      class_teacher_signature_file_id:
        row.class_teacher_signature_file_id === null ? null : Number(row.class_teacher_signature_file_id),
      parent_mobile: (row.parent_mobile as string | null) ?? null,
      parent_signature_file_id: row.parent_signature_file_id === null ? null : Number(row.parent_signature_file_id),
    };
  }

  private async yearExams(schoolId: number, yearId: number, classId: number): Promise<YearExam[]> {
    const rows = await this.dataSource.query(
      `SELECT x.id, x.name, to_char(x.start_date, 'YYYY-MM-DD') AS start_date, to_char(x.end_date, 'YYYY-MM-DD') AS end_date,
              t.id AS term_id, t.name AS term_name, coalesce(t.sort_order, 0) AS term_order,
              to_char(t.start_date, 'YYYY-MM-DD') AS term_start, to_char(t.end_date, 'YYYY-MM-DD') AS term_end
       FROM exams x
       LEFT JOIN terms t ON t.id = x.term_id AND t.deleted_at IS NULL
       WHERE x.school_id = $1 AND x.academic_year_id = $2 AND x.status = 'published' AND x.deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM exam_subjects es WHERE es.exam_id = x.id AND es.class_id = $3)
       ORDER BY t.id IS NULL, coalesce(t.sort_order, 0), t.start_date, x.start_date, x.id`,
      [schoolId, yearId, classId],
    );
    return rows.map((row: Record<string, unknown>) => ({
      id: Number(row.id),
      name: String(row.name),
      start_date: String(row.start_date),
      end_date: String(row.end_date),
      term_id: row.term_id === null ? null : Number(row.term_id),
      term_name: (row.term_name as string | null) ?? null,
      term_order: Number(row.term_order),
      term_start: (row.term_start as string | null) ?? null,
      term_end: (row.term_end as string | null) ?? null,
    }));
  }

  private async options(
    schoolId: number,
    enrollment: Enrollment,
    yearExams: YearExam[],
  ): Promise<ReportCardOptionsDto> {
    const years: { id: number; name: string }[] = await this.dataSource.query(
      `SELECT DISTINCT y.id, y.name, y.start_date FROM student_enrollments e
       JOIN academic_years y ON y.id = e.academic_year_id
       WHERE e.student_id = $1 AND e.school_id = $2
         AND EXISTS (SELECT 1 FROM exams x JOIN exam_subjects es ON es.exam_id = x.id AND es.class_id = e.class_id
                     WHERE x.academic_year_id = y.id AND x.status = 'published' AND x.deleted_at IS NULL)
       ORDER BY y.start_date DESC`,
      [enrollment.student_id, schoolId],
    );
    const terms = new Map<number, string>();
    for (const exam of yearExams) if (exam.term_id) terms.set(exam.term_id, exam.term_name!);
    const academicYears = years.map((year) => ({ id: Number(year.id), name: year.name }));
    if (!academicYears.some((year) => year.id === enrollment.academic_year_id)) {
      academicYears.unshift({ id: enrollment.academic_year_id, name: enrollment.academic_year_name });
    }
    return {
      academic_years: academicYears,
      terms: [...terms.entries()].map(([id, name]) => ({ id, name })),
      exams: yearExams.map((exam) => ({ id: exam.id, name: exam.name, term_id: exam.term_id })),
    };
  }

  private async attendance(studentId: number, from: string, to: string) {
    const rows: { status: string; days: string }[] = await this.dataSource.query(
      `SELECT status, COUNT(*) AS days FROM student_attendance_days
       WHERE student_id = $1 AND date BETWEEN $2 AND $3
       GROUP BY status`,
      [studentId, from, to],
    );
    return attendanceSummary(rows.map((row) => ({ status: row.status, days: Number(row.days) })));
  }

  private async school(schoolId: number): Promise<SchoolInfo> {
    const [row] = await this.dataSource.query(
      `SELECT name, address, city, state, pincode, phone, email, board, logo_file_id, signature_file_id, seal_file_id
       FROM schools WHERE id = $1`,
      [schoolId],
    );
    const [principal] = await this.dataSource.query(
      `SELECT u.name FROM staff s JOIN users u ON u.id = s.user_id WHERE s.school_id = $1 AND s.designation ILIKE '%principal%' AND s.deleted_at IS NULL LIMIT 1`,
      [schoolId],
    );
    const place = [row?.city, [row?.state, row?.pincode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    return {
      name: row?.name ?? '',
      address: [row?.address, place].filter(Boolean).join(', ') || null,
      phone: row?.phone ?? null,
      email: row?.email ?? null,
      board: row?.board ?? null,
      logo_file_id: row?.logo_file_id ?? null,
      signature_file_id: row?.signature_file_id ?? null,
      seal_file_id: row?.seal_file_id ?? null,
      principal_name: principal?.name ?? null,
    };
  }

  private async pdfData(schoolId: number, card: ReportCardDto): Promise<ReportCardPdfData> {
    const [school] = await this.dataSource.query(
      `SELECT logo_file_id, signature_file_id, seal_file_id FROM schools WHERE id = $1`,
      [schoolId],
    );
    const [student] = await this.dataSource.query(`SELECT photo_file_id FROM students WHERE id = $1`, [
      card.student.id,
    ]);
    const sigRepo = this.dataSource.getRepository(ReportCardSignature);
    const sig = await sigRepo.findOne({
      where: {
        school_id: schoolId,
        student_id: card.student.id,
        academic_year_id: card.scope.academic_year.id,
        term_id: card.scope.term?.id ?? IsNull(),
        exam_id: card.scope.exam?.id ?? IsNull(),
      },
    });
    const [enr] = await this.dataSource.query(
      `SELECT se.section_id, s.signature_file_id AS class_teacher_signature_file_id,
              g.signature_file_id AS parent_signature_file_id
       FROM student_enrollments se
       LEFT JOIN sections sec ON sec.id = se.section_id AND sec.deleted_at IS NULL
       LEFT JOIN staff s ON s.user_id = sec.class_teacher_user_id AND s.deleted_at IS NULL
       LEFT JOIN student_guardians sg ON sg.student_id = se.student_id AND sg.is_primary = true
       LEFT JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
       WHERE se.student_id = $1 AND se.academic_year_id = $2 LIMIT 1`,
      [card.student.id, card.scope.academic_year.id],
    );
    const teacherSigFileId = sig?.teacher_signature_file_id ?? enr?.class_teacher_signature_file_id;
    const parentSigFileId =
      sig?.parent_signature_file_id ?? (sig?.parent_signed_at ? enr?.parent_signature_file_id : null);
    return {
      card,
      logo: await this.files.readImage(school?.logo_file_id ?? null),
      signature: await this.files.readImage(school?.signature_file_id ?? null),
      seal: await this.files.readImage(school?.seal_file_id ?? null),
      photo: await this.files.readImage(student?.photo_file_id ?? null),
      teacher_signature: await this.files.readImage(teacherSigFileId ?? null),
      parent_signature: await this.files.readImage(parentSigFileId ?? null),
      generated_on: todayIn(this.app.timeZone),
    };
  }

  private async examRow(schoolId: number, id: number): Promise<Exam> {
    const exam = await this.dataSource.getRepository(Exam).findOneBy({ id, school_id: schoolId });
    if (!exam) throw AppException.notFound('Exam not found', 'EXAM_NOT_FOUND');
    return exam;
  }

  private async childSchool(userId: number, studentId: number): Promise<number> {
    const [row] = await this.dataSource.query(
      `SELECT s.school_id FROM student_guardians sg
       JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
       JOIN students s ON s.id = sg.student_id AND s.deleted_at IS NULL AND s.status = 'active'
       WHERE g.user_id = $1 AND sg.student_id = $2 LIMIT 1`,
      [userId, studentId],
    );
    if (!row) throw AppException.notFound('This child is not linked to your mobile number', 'CHILD_NOT_FOUND');
    return Number(row.school_id);
  }

  private queryString(query: ReportCardQueryDto, yearId: number): string {
    const params = new URLSearchParams({ academic_year_id: String(yearId) });
    if (query.term_id) params.set('term_id', String(query.term_id));
    if (query.exam_id) params.set('exam_id', String(query.exam_id));
    return `?${params.toString()}`;
  }

  private fileName(card: ReportCardDto): string {
    const label = card.scope.exam?.name ?? card.scope.term?.name ?? card.scope.academic_year.name;
    return `Report-card-${card.student.admission_no}-${label}`.replace(/[^\w.-]+/g, '-');
  }

  private capToday(date: string): string {
    const today = todayIn(this.app.timeZone);
    return date > today ? today : date;
  }

  private noResults() {
    return AppException.notFound('No published results to print yet', 'NO_PUBLISHED_RESULTS');
  }

  async signChildCard(
    userId: number,
    studentId: number,
    dto: SignReportCardDto,
    pdfBase: string,
  ): Promise<ReportCardDto> {
    const schoolId = await this.childSchool(userId, studentId);
    const guardian = await this.dataSource.getRepository(Guardian).findOne({
      where: { user_id: userId, school_id: schoolId },
    });
    if (!guardian?.signature_file_id) {
      throw AppException.badRequest('Please upload your signature first', 'NO_SIGNATURE_UPLOADED');
    }
    const enrollment = await this.enrollment(schoolId, studentId, dto.academic_year_id);
    const sigRepo = this.dataSource.getRepository(ReportCardSignature);
    let sig = await sigRepo.findOne({
      where: {
        student_id: studentId,
        academic_year_id: enrollment.academic_year_id,
        term_id: dto.term_id ?? IsNull(),
        exam_id: dto.exam_id ?? IsNull(),
      },
    });
    if (!sig) {
      sig = sigRepo.create({
        school_id: schoolId,
        student_id: studentId,
        academic_year_id: enrollment.academic_year_id,
        term_id: dto.term_id ?? null,
        exam_id: dto.exam_id ?? null,
      });
    }
    sig.parent_user_id = userId;
    sig.parent_signature_file_id = guardian.signature_file_id;
    sig.parent_signed_at = new Date();
    await sigRepo.save(sig);
    return this.card(schoolId, studentId, dto, pdfBase);
  }

  async signSection(
    schoolId: number,
    teacherUserId: number,
    sectionId: number,
    dto: SignReportCardDto,
  ): Promise<SectionSignaturesStatusDto> {
    const staff = await this.dataSource.getRepository(Staff).findOne({
      where: { user_id: teacherUserId, school_id: schoolId },
    });
    if (!staff?.signature_file_id) {
      throw AppException.badRequest('Please upload your signature first', 'NO_SIGNATURE_UPLOADED');
    }
    const roster = await this.sectionRoster(schoolId, sectionId);
    const sigRepo = this.dataSource.getRepository(ReportCardSignature);
    const now = new Date();
    for (const student of roster) {
      let sig = await sigRepo.findOne({
        where: {
          student_id: student.student_id,
          academic_year_id: student.academic_year_id,
          term_id: dto.term_id ?? IsNull(),
          exam_id: dto.exam_id ?? IsNull(),
        },
      });
      if (!sig) {
        sig = sigRepo.create({
          school_id: schoolId,
          student_id: student.student_id,
          academic_year_id: student.academic_year_id,
          term_id: dto.term_id ?? null,
          exam_id: dto.exam_id ?? null,
        });
      }
      sig.teacher_user_id = teacherUserId;
      sig.teacher_signature_file_id = staff.signature_file_id;
      sig.teacher_signed_at = now;
      await sigRepo.save(sig);
    }
    return this.sectionSignaturesStatus(schoolId, teacherUserId, sectionId, dto);
  }

  async signStudent(
    schoolId: number,
    teacherUserId: number,
    studentId: number,
    dto: SignReportCardDto,
  ): Promise<ReportCardDto> {
    const staff = await this.dataSource.getRepository(Staff).findOne({
      where: { user_id: teacherUserId, school_id: schoolId },
    });
    if (!staff?.signature_file_id) {
      throw AppException.badRequest('Please upload your signature first', 'NO_SIGNATURE_UPLOADED');
    }
    const enrollment = await this.enrollment(schoolId, studentId, dto.academic_year_id);
    const sigRepo = this.dataSource.getRepository(ReportCardSignature);
    let sig = await sigRepo.findOne({
      where: {
        student_id: studentId,
        academic_year_id: enrollment.academic_year_id,
        term_id: dto.term_id ?? IsNull(),
        exam_id: dto.exam_id ?? IsNull(),
      },
    });
    if (!sig) {
      sig = sigRepo.create({
        school_id: schoolId,
        student_id: studentId,
        academic_year_id: enrollment.academic_year_id,
        term_id: dto.term_id ?? null,
        exam_id: dto.exam_id ?? null,
      });
    }
    sig.teacher_user_id = teacherUserId;
    sig.teacher_signature_file_id = staff.signature_file_id;
    sig.teacher_signed_at = new Date();
    await sigRepo.save(sig);
    return this.card(schoolId, studentId, dto, `/api/v1/admin/students/${studentId}/report-card/pdf`);
  }

  async sectionSignaturesStatus(
    schoolId: number,
    teacherUserId: number,
    sectionId: number,
    query: SectionReportCardQueryDto,
  ): Promise<SectionSignaturesStatusDto> {
    const roster = await this.sectionRoster(schoolId, sectionId);
    const studentIds = roster.map((r) => r.student_id);
    const sigRepo = this.dataSource.getRepository(ReportCardSignature);
    const sigs = await sigRepo.find({
      where: {
        school_id: schoolId,
        student_id: In(studentIds),
        term_id: query.term_id ?? IsNull(),
        exam_id: query.exam_id ?? IsNull(),
      },
    });
    const sigMap = new Map(sigs.map((item) => [item.student_id, item]));

    const students: SectionStudentSignatureItemDto[] = roster.map((r) => {
      const sig = sigMap.get(r.student_id);
      const teacherSigned = !!(sig?.teacher_signed_at ?? r.class_teacher_signature_file_id);
      const parentSigned = !!sig?.parent_signed_at;
      return {
        student_id: r.student_id,
        admission_no: r.admission_no,
        full_name: r.full_name,
        roll_no: r.roll_no,
        photo_url: this.files.linkFor(r.photo_file_id),
        parent_name: r.parent_name,
        parent_mobile: r.parent_mobile,
        teacher_signed: teacherSigned,
        teacher_signed_at: sig?.teacher_signed_at ?? null,
        parent_signed: parentSigned,
        parent_signed_at: sig?.parent_signed_at ?? null,
        status: parentSigned ? 'signed' : 'pending_parent',
      };
    });

    const teacherSignedCount = students.filter((item) => item.teacher_signed).length;
    const parentSignedCount = students.filter((item) => item.parent_signed).length;

    return {
      summary: {
        total: students.length,
        teacher_signed: teacherSignedCount,
        parent_signed: parentSignedCount,
        parent_pending: students.length - parentSignedCount,
      },
      students,
    };
  }
}
