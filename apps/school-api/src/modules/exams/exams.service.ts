import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AppException, AuthUser, FieldError, listQuery, Paginated } from '@app/common';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import { NotificationsService } from '../notifications/notifications.service';
import { AcademicYearsService } from '../setup/academic-years.service';
import { AcademicYear } from '../setup/entities/academic-year.entity';
import { Term } from '../setup/entities/term.entity';
import { AssignmentsService } from '../staff/assignments.service';
import {
  ClassToppersDto,
  ExamClassDto,
  ExamDetailDto,
  ExamDto,
  ExamInputDto,
  ExamQueryDto,
  ExamRefDto,
  ExamSubjectDto,
  ExamSubjectInputDto,
  ExamSubjectsInputDto,
  ExamToppersDto,
  MarksSheetDto,
  MarkSubjectDto,
  ResultRowDto,
  ResultSummaryDto,
  SaveMarksDto,
  SectionRankingDto,
  SectionRefDto,
  SectionResultsDto,
  StudentExamResultDto,
  TeacherExamDto,
  TopperDto,
  UpdateExamDto,
} from './dto/exams.dto';
import { ExamMark } from './entities/exam-mark.entity';
import { DEFAULT_MAX_MARKS, DEFAULT_PASS_MARKS, ExamSubject } from './entities/exam-subject.entity';
import { Exam } from './entities/exam.entity';
import { competitionRanks, scoreStudent, SubjectScore, subjectPassed, validateMarks } from './exam-results';

const DEFAULT_TOPPERS = 3;

interface SectionRow {
  id: number;
  name: string;
  class_id: number;
  class_name: string;
  academic_year_id: number;
}

interface PaperRow extends MarkSubjectDto {
  paper_id: number;
  class_id: number;
}

interface RosterRow {
  student_id: number;
  admission_no: string;
  first_name: string;
  last_name: string | null;
  roll_no: number | null;
  section_id: number;
  section_name: string;
}

interface ClassResults {
  subjects: PaperRow[];
  rows: ResultRowDto[];
}

const fullName = (row: { first_name: string; last_name: string | null }) =>
  [row.first_name, row.last_name].filter(Boolean).join(' ');

const byRank = (rank: (row: ResultRowDto) => number | null) => (a: ResultRowDto, b: ResultRowDto) =>
  (rank(a) ?? Number.MAX_SAFE_INTEGER) - (rank(b) ?? Number.MAX_SAFE_INTEGER) ||
  (a.roll_no ?? Number.MAX_SAFE_INTEGER) - (b.roll_no ?? Number.MAX_SAFE_INTEGER) ||
  a.full_name.localeCompare(b.full_name);

@Injectable()
export class ExamsService {
  private readonly logger = new Logger('Exams');

  constructor(
    @InjectRepository(Exam) private readonly exams: Repository<Exam>,
    @InjectRepository(ExamSubject) private readonly papers: Repository<ExamSubject>,
    private readonly years: AcademicYearsService,
    private readonly assignments: AssignmentsService,
    private readonly notifications: NotificationsService,
    private readonly dataSource: DataSource,
  ) {}

  async list(schoolId: number, query: ExamQueryDto): Promise<Paginated<ExamDto>> {
    const qb = this.exams
      .createQueryBuilder('x')
      .leftJoinAndSelect('x.academic_year', 'y')
      .leftJoinAndSelect('x.term', 't')
      .where('x.school_id = :schoolId', { schoolId });
    if (query.status) qb.andWhere('x.status = :status', { status: query.status });
    if (query.academic_year_id) qb.andWhere('x.academic_year_id = :year', { year: query.academic_year_id });
    const page = await listQuery(qb, query, {
      searchable: ['x.name'],
      sortable: {
        start_date: 'x.start_date',
        created_at: 'x.created_at',
        published_at: 'x.published_at',
        name: 'x.name',
      },
      defaultSort: 'start_date',
    });
    return { ...page, items: await this.presentMany(page.items) };
  }

  async get(schoolId: number, id: number): Promise<ExamDetailDto> {
    const exam = await this.find(schoolId, id, true);
    const [base] = await this.presentMany([exam]);
    const [papers, sections, entered] = await Promise.all([
      this.paperRows(exam.id),
      this.dataSource.query(
        `SELECT sec.id, sec.name, sec.class_id,
                (SELECT COUNT(*) FROM student_enrollments e JOIN students s ON s.id = e.student_id
                   WHERE e.section_id = sec.id AND s.deleted_at IS NULL AND s.status = 'active') AS student_count
         FROM sections sec
         WHERE sec.school_id = $1 AND sec.academic_year_id = $2 AND sec.deleted_at IS NULL
           AND sec.class_id IN (SELECT class_id FROM exam_subjects WHERE exam_id = $3)
         ORDER BY sec.name`,
        [schoolId, exam.academic_year_id, exam.id],
      ) as Promise<{ id: number; name: string; class_id: number; student_count: string }[]>,
      this.dataSource.query(
        `SELECT m.subject_id, e.class_id, COUNT(*) AS count FROM exam_marks m
         JOIN student_enrollments e ON e.student_id = m.student_id AND e.academic_year_id = $2
         WHERE m.exam_id = $1 GROUP BY m.subject_id, e.class_id`,
        [exam.id, exam.academic_year_id],
      ) as Promise<{ subject_id: number; class_id: number; count: string }[]>,
    ]);
    const classDetails: ExamClassDto[] = base.classes.map((schoolClass) => ({
      id: schoolClass.id,
      name: schoolClass.name,
      sections: sections
        .filter((section) => Number(section.class_id) === schoolClass.id)
        .map((section) => ({
          id: Number(section.id),
          name: section.name,
          student_count: Number(section.student_count),
        })),
      subjects: papers
        .filter((paper) => paper.class_id === schoolClass.id)
        .map((paper) => this.presentPaper(paper, schoolClass, entered)),
    }));
    return { ...base, class_details: classDetails };
  }

  async create(schoolId: number, dto: ExamInputDto): Promise<ExamDetailDto> {
    const year = await this.years.resolve(schoolId, dto.academic_year_id);
    await this.assertExamFields(schoolId, year, dto.name, dto.term_id ?? null, dto.start_date, dto.end_date);
    const id = await this.dataSource.transaction(async (manager) => {
      const exam = await manager.save(
        manager.create(Exam, {
          school_id: schoolId,
          academic_year_id: year.id,
          term_id: dto.term_id ?? null,
          name: dto.name,
          start_date: dto.start_date,
          end_date: dto.end_date,
          status: 'draft',
        }),
      );
      await this.addClasses(manager, schoolId, exam, dto.class_ids);
      if (dto.subjects && dto.subjects.length) {
        for (const item of dto.subjects) {
          if (item.exam_date && (item.exam_date < dto.start_date || item.exam_date > dto.end_date)) {
            throw AppException.badRequest('Subject exam date must be within the exam dates', 'EXAM_DATE_OUT_OF_RANGE');
          }
          await manager.update(
            ExamSubject,
            { exam_id: exam.id, class_id: item.class_id, subject_id: item.subject_id },
            {
              max_marks: item.max_marks ?? DEFAULT_MAX_MARKS,
              pass_marks: item.pass_marks ?? DEFAULT_PASS_MARKS,
              exam_date: item.exam_date ?? null,
            },
          );
        }
      }
      return exam.id;
    });
    return this.get(schoolId, id);
  }

  async update(schoolId: number, id: number, dto: UpdateExamDto): Promise<ExamDetailDto> {
    const exam = await this.find(schoolId, id);
    const year = await this.years.find(schoolId, exam.academic_year_id);
    const name = dto.name ?? exam.name;
    const termId = dto.term_id === undefined ? exam.term_id : dto.term_id;
    const start = dto.start_date ?? exam.start_date;
    const end = dto.end_date ?? exam.end_date;
    await this.assertExamFields(schoolId, year, name, termId, start, end, exam.id);
    await this.dataSource.transaction(async (manager) => {
      await manager.update(Exam, exam.id, { name, term_id: termId, start_date: start, end_date: end });
      if (!dto.class_ids) return;
      const current = await this.examClassIds(manager, exam.id);
      const removed = current.filter((classId) => !dto.class_ids!.includes(classId));
      for (const classId of removed) {
        if (await this.classHasMarks(manager, exam, classId)) {
          const [row] = await manager.query(`SELECT name FROM classes WHERE id = $1`, [classId]);
          throw AppException.conflict(
            `Class ${row?.name ?? classId} already has marks. Clear them before removing the class.`,
            'CLASS_HAS_MARKS',
          );
        }
      }
      if (removed.length) await manager.delete(ExamSubject, { exam_id: exam.id, class_id: In(removed) });
      const added = dto.class_ids.filter((classId) => !current.includes(classId));
      if (added.length) await this.addClasses(manager, schoolId, exam, added);
      if (dto.subjects && dto.subjects.length) {
        for (const item of dto.subjects) {
          if (item.exam_date && (item.exam_date < start || item.exam_date > end)) {
            throw AppException.badRequest('Subject exam date must be within the exam dates', 'EXAM_DATE_OUT_OF_RANGE');
          }
          await manager.update(
            ExamSubject,
            { exam_id: exam.id, class_id: item.class_id, subject_id: item.subject_id },
            {
              max_marks: item.max_marks ?? DEFAULT_MAX_MARKS,
              pass_marks: item.pass_marks ?? DEFAULT_PASS_MARKS,
              exam_date: item.exam_date ?? null,
            },
          );
        }
      }
    });
    return this.get(schoolId, id);
  }

  async remove(schoolId: number, id: number): Promise<void> {
    const exam = await this.find(schoolId, id);
    if (exam.status !== 'draft') {
      throw AppException.conflict('A published exam cannot be deleted', 'EXAM_PUBLISHED');
    }
    await this.exams.delete({ id: exam.id });
  }

  async subjects(schoolId: number, id: number): Promise<ExamSubjectDto[]> {
    const exam = await this.find(schoolId, id);
    return (await this.get(schoolId, exam.id)).class_details.flatMap((item) => item.subjects);
  }

  async setSubjects(schoolId: number, id: number, dto: ExamSubjectsInputDto): Promise<ExamSubjectDto[]> {
    const exam = await this.find(schoolId, id);
    this.assertPapers(exam, dto.items);
    const classIds = [...new Set(dto.items.map((item) => item.class_id))];
    const subjectIds = [...new Set(dto.items.map((item) => item.subject_id))];
    await this.assertSchoolRows(schoolId, 'classes', classIds, 'Class', 'CLASS_NOT_FOUND');
    await this.assertSchoolRows(schoolId, 'subjects', subjectIds, 'Subject', 'SUBJECT_NOT_FOUND');
    await this.dataSource.transaction(async (manager) => {
      const existing = await manager.find(ExamSubject, { where: { exam_id: exam.id }, relations: { subject: true } });
      const kept = (paper: ExamSubject) =>
        dto.items.some((item) => item.class_id === paper.class_id && item.subject_id === paper.subject_id);
      for (const paper of existing.filter((item) => !kept(item))) {
        if (await this.paperMaxMarks(manager, exam, paper.class_id, paper.subject_id)) {
          throw AppException.conflict(
            `${paper.subject?.name ?? 'This subject'} already has marks. Clear them before removing it.`,
            'SUBJECT_HAS_MARKS',
          );
        }
        await manager.delete(ExamSubject, paper.id);
      }
      for (const item of dto.items) {
        const highest = await this.paperMaxMarks(manager, exam, item.class_id, item.subject_id);
        if (highest !== null && highest > item.max_marks) {
          throw AppException.conflict(
            `Marks up to ${highest} are already entered. Max marks cannot be lower than that.`,
            'MARKS_ABOVE_MAX',
          );
        }
      }
      if (dto.items.length) {
        await manager.upsert(
          ExamSubject,
          dto.items.map((item) => ({
            school_id: schoolId,
            exam_id: exam.id,
            class_id: item.class_id,
            subject_id: item.subject_id,
            max_marks: item.max_marks,
            pass_marks: item.pass_marks,
            exam_date: item.exam_date ?? null,
          })),
          ['exam_id', 'class_id', 'subject_id'],
        );
      }
    });
    return this.subjects(schoolId, exam.id);
  }

  async marksSheet(
    schoolId: number,
    examId: number,
    sectionId: number,
    subjectId: number,
    forTeacher = false,
  ): Promise<MarksSheetDto> {
    const exam = await this.find(schoolId, examId);
    const section = await this.examSection(schoolId, exam, sectionId);
    const subject = await this.paper(exam, section.class_id, subjectId);
    const roster = await this.roster(exam, section.class_id, section.id);
    const marks = await this.marksFor(
      exam.id,
      roster.map((row) => row.student_id),
      subjectId,
    );
    const students = roster.map((row) => {
      const mark = marks.get(`${row.student_id}:${subjectId}`);
      return {
        student_id: row.student_id,
        admission_no: row.admission_no,
        full_name: fullName(row),
        roll_no: row.roll_no,
        marks: mark?.marks ?? null,
        is_absent: mark?.is_absent ?? false,
        entered: Boolean(mark),
      };
    });
    return {
      exam: this.ref(exam),
      section: this.sectionRef(section),
      subject: this.subjectRef(subject),
      editable: !forTeacher || exam.status === 'draft',
      entered: students.filter((row) => row.entered).length,
      total: students.length,
      students,
    };
  }

  async saveMarks(
    schoolId: number,
    examId: number,
    sectionId: number,
    subjectId: number,
    dto: SaveMarksDto,
    actor: AuthUser,
    forTeacher = false,
  ): Promise<MarksSheetDto> {
    const exam = await this.find(schoolId, examId);
    if (forTeacher && exam.status !== 'draft') {
      throw AppException.conflict('Results are published. Ask the office to correct marks.', 'EXAM_PUBLISHED');
    }
    const section = await this.examSection(schoolId, exam, sectionId);
    const subject = await this.paper(exam, section.class_id, subjectId);
    const roster = await this.roster(exam, section.class_id, section.id);
    const names = new Map(roster.map((row) => [row.student_id, fullName(row)]));
    const seen = new Set<number>();
    for (const item of dto.items) {
      if (seen.has(item.student_id)) {
        throw AppException.badRequest(`Student ${item.student_id} appears twice`, 'DUPLICATE_STUDENT');
      }
      seen.add(item.student_id);
      if (!names.has(item.student_id)) {
        throw AppException.badRequest(`Student ${item.student_id} is not in this section`, 'STUDENT_NOT_IN_SECTION');
      }
    }
    const errors: FieldError[] = validateMarks(dto.items, subject.max_marks, names).map((error) => ({
      field: `items.${error.index}.marks`,
      message: error.message,
    }));
    if (errors.length) throw AppException.validation(errors);

    await this.dataSource.transaction(async (manager) => {
      const cleared = dto.items.filter((item) => !item.is_absent && item.marks === null);
      if (cleared.length) {
        await manager.delete(ExamMark, {
          exam_id: exam.id,
          subject_id: subjectId,
          student_id: In(cleared.map((item) => item.student_id)),
        });
      }
      const saved = dto.items.filter((item) => item.is_absent || item.marks !== null);
      if (saved.length) {
        await manager.upsert(
          ExamMark,
          saved.map((item) => ({
            school_id: schoolId,
            exam_id: exam.id,
            student_id: item.student_id,
            subject_id: subjectId,
            marks: item.is_absent ? null : item.marks,
            is_absent: item.is_absent,
            entered_by: actor.id,
          })),
          ['exam_id', 'student_id', 'subject_id'],
        );
      }
    });
    return this.marksSheet(schoolId, exam.id, section.id, subjectId, forTeacher);
  }

  async sectionResults(schoolId: number, examId: number, sectionId: number): Promise<SectionResultsDto> {
    const exam = await this.find(schoolId, examId);
    const section = await this.examSection(schoolId, exam, sectionId);
    const results = await this.classResults(exam, section.class_id);
    const rows = results.rows.filter((row) => row.section_id === section.id).sort(byRank((row) => row.section_rank));
    return {
      exam: this.ref(exam),
      section: this.sectionRef(section),
      subjects: results.subjects.map((paper) => this.subjectRef(paper)),
      summary: this.summary(rows),
      rows,
    };
  }

  async classToppers(schoolId: number, examId: number, classId: number, limit?: number): Promise<ClassToppersDto> {
    const exam = await this.find(schoolId, examId);
    const [row] = await this.dataSource.query(
      `SELECT c.id, c.name FROM classes c
       WHERE c.id = $1 AND c.school_id = $2 AND c.deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM exam_subjects es WHERE es.exam_id = $3 AND es.class_id = c.id)`,
      [classId, schoolId, exam.id],
    );
    if (!row) throw AppException.notFound('This class does not write this exam', 'CLASS_NOT_IN_EXAM');
    return this.toppersOf(exam, { id: Number(row.id), name: row.name }, limit ?? DEFAULT_TOPPERS);
  }

  async examToppers(schoolId: number, examId: number, limit?: number): Promise<ExamToppersDto> {
    const exam = await this.find(schoolId, examId);
    const classes = await this.examClasses(exam.id);
    const result: ClassToppersDto[] = [];
    for (const schoolClass of classes) {
      result.push(await this.toppersOf(exam, schoolClass, limit ?? DEFAULT_TOPPERS));
    }
    return { exam: this.ref(exam), classes: result };
  }

  async publish(schoolId: number, id: number): Promise<ExamDetailDto> {
    const exam = await this.find(schoolId, id);
    if (exam.status === 'published') throw AppException.conflict('This exam is already published', 'EXAM_PUBLISHED');
    const [marks] = await this.dataSource.query(`SELECT COUNT(*) AS count FROM exam_marks WHERE exam_id = $1`, [
      exam.id,
    ]);
    if (!Number(marks?.count)) throw AppException.badRequest('Enter marks before publishing results', 'NO_MARKS');
    await this.exams.update(exam.id, { status: 'published', published_at: new Date() });
    void this.notifyParents({ ...exam, status: 'published' }).catch((error: Error) =>
      this.logger.warn(`Result alerts for exam ${exam.id} failed: ${error.message}`),
    );
    return this.get(schoolId, exam.id);
  }

  async studentResults(schoolId: number, studentId: number): Promise<StudentExamResultDto[]> {
    const [student] = await this.dataSource.query(
      `SELECT id FROM students WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [studentId, schoolId],
    );
    if (!student) throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');
    const rows: { id: number; class_id: number; class_name: string }[] = await this.dataSource.query(
      `SELECT x.id, e.class_id, c.name AS class_name FROM exams x
       JOIN student_enrollments e ON e.student_id = $2 AND e.academic_year_id = x.academic_year_id
       JOIN classes c ON c.id = e.class_id
       WHERE x.school_id = $1 AND x.status = 'published' AND x.deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM exam_subjects es WHERE es.exam_id = x.id AND es.class_id = e.class_id)
       ORDER BY x.start_date DESC, x.id DESC`,
      [schoolId, studentId],
    );
    const result: StudentExamResultDto[] = [];
    for (const row of rows) {
      const exam = await this.find(schoolId, Number(row.id));
      const mine = await this.resultFor(exam, Number(row.class_id), row.class_name, studentId);
      if (mine) result.push(mine);
    }
    return result;
  }

  async resultFor(
    exam: Exam,
    classId: number,
    className: string,
    studentId: number,
  ): Promise<StudentExamResultDto | null> {
    return (await this.resultsByStudent(exam, classId, className)).get(studentId) ?? null;
  }

  async resultsByStudent(exam: Exam, classId: number, className: string): Promise<Map<number, StudentExamResultDto>> {
    const results = await this.classResults(exam, classId);
    return new Map(results.rows.map((row) => [row.student_id, this.studentResult(exam, className, results, row)]));
  }

  private studentResult(
    exam: Exam,
    className: string,
    results: ClassResults,
    mine: ResultRowDto,
  ): StudentExamResultDto {
    return {
      exam: this.ref(exam),
      class_name: className,
      section_name: mine.section_name,
      total: mine.total,
      max_total: mine.max_total,
      percent: mine.percent,
      grade: mine.grade,
      result: mine.result,
      section_rank: mine.section_rank,
      section_size: results.rows.filter((item) => item.section_id === mine.section_id).length,
      class_rank: mine.class_rank,
      class_size: results.rows.length,
      subjects: results.subjects.map((paper) => {
        const score = mine.subjects.find((item) => item.subject_id === paper.id)!;
        return {
          ...score,
          name: paper.name,
          code: paper.code,
          max_marks: paper.max_marks,
          pass_marks: paper.pass_marks,
        };
      }),
    };
  }

  async childResults(userId: number, studentId: number): Promise<StudentExamResultDto[]> {
    const [row] = await this.dataSource.query(
      `SELECT s.school_id FROM student_guardians sg
       JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
       JOIN students s ON s.id = sg.student_id AND s.deleted_at IS NULL AND s.status = 'active'
       WHERE g.user_id = $1 AND sg.student_id = $2 LIMIT 1`,
      [userId, studentId],
    );
    if (!row) throw AppException.notFound('This child is not linked to your mobile number', 'CHILD_NOT_FOUND');
    return this.studentResults(Number(row.school_id), studentId);
  }

  async teacherExams(schoolId: number, userId: number): Promise<TeacherExamDto[]> {
    const year = await this.years.currentOrNull(schoolId);
    if (!year) return [];
    const classes = await this.assignments.teacherClasses(schoolId, userId);
    if (!classes.length) return [];
    const sectionIds = classes.map((item) => item.section_id);
    const [exams, sectionClasses] = await Promise.all([
      this.exams.find({
        where: { school_id: schoolId, academic_year_id: year.id },
        order: { start_date: 'DESC', id: 'DESC' },
      }),
      this.dataSource.query(`SELECT id, class_id FROM sections WHERE id = ANY($1)`, [sectionIds]) as Promise<
        { id: number; class_id: number }[]
      >,
    ]);
    if (!exams.length) return [];
    const examIds = exams.map((exam) => exam.id);
    const [papers, counts] = await Promise.all([
      this.papers.find({ where: { exam_id: In(examIds) }, relations: { subject: true } }),
      this.dataSource.query(
        `SELECT m.exam_id, e.section_id, m.subject_id, COUNT(*) AS count FROM exam_marks m
         JOIN student_enrollments e ON e.student_id = m.student_id AND e.academic_year_id = $3
         WHERE m.exam_id = ANY($1) AND e.section_id = ANY($2)
         GROUP BY m.exam_id, e.section_id, m.subject_id`,
        [examIds, sectionIds, year.id],
      ) as Promise<{ exam_id: number; section_id: number; subject_id: number; count: string }[]>,
    ]);
    const classOf = new Map(sectionClasses.map((row) => [Number(row.id), Number(row.class_id)]));
    return exams
      .map((exam) => ({
        ...this.ref(exam),
        sections: classes
          .map((item) => ({
            section_id: item.section_id,
            class_name: item.class_name,
            section_name: item.section_name,
            is_class_teacher: item.is_class_teacher,
            subjects: papers
              .filter(
                (paper) =>
                  paper.exam_id === exam.id &&
                  paper.class_id === classOf.get(item.section_id) &&
                  (item.is_class_teacher || item.subjects.some((subject) => subject.id === paper.subject_id)),
              )
              .sort((a, b) => (a.subject?.name ?? '').localeCompare(b.subject?.name ?? ''))
              .map((paper) => ({
                subject_id: paper.subject_id,
                name: paper.subject?.name ?? '',
                code: paper.subject?.code ?? '',
                max_marks: paper.max_marks,
                exam_date: paper.exam_date,
                entered: Number(
                  counts.find(
                    (row) =>
                      Number(row.exam_id) === exam.id &&
                      Number(row.section_id) === item.section_id &&
                      Number(row.subject_id) === paper.subject_id,
                  )?.count ?? 0,
                ),
                total: item.student_count,
              })),
          }))
          .filter((section) => section.subjects.length),
      }))
      .filter((exam) => exam.sections.length);
  }

  async assertTeacherSubject(schoolId: number, userId: number, sectionId: number, subjectId: number): Promise<void> {
    await this.assignments.assertTeachesSection(schoolId, userId, sectionId);
    const [row] = await this.dataSource.query(
      `SELECT (sec.class_teacher_user_id = $2) AS is_class_teacher,
              EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.section_id = sec.id AND ta.subject_id = $3
                        AND ta.teacher_user_id = $2 AND ta.deleted_at IS NULL) AS teaches
       FROM sections sec WHERE sec.id = $1`,
      [sectionId, userId, subjectId],
    );
    if (!row?.is_class_teacher && !row?.teaches) {
      throw AppException.forbidden('You do not teach this subject in this section', 'NOT_YOUR_SUBJECT');
    }
  }

  async sectionRanking(schoolId: number, sectionId: number, examId?: number): Promise<SectionRankingDto> {
    const section = await this.sectionRow(schoolId, sectionId);
    let exam: Exam | null;
    if (examId) {
      exam = await this.find(schoolId, examId);
      await this.examSection(schoolId, exam, sectionId);
    } else {
      exam = await this.exams
        .createQueryBuilder('x')
        .where('x.school_id = :schoolId AND x.status = :status AND x.academic_year_id = :year', {
          schoolId,
          status: 'published',
          year: section.academic_year_id,
        })
        .andWhere('EXISTS (SELECT 1 FROM exam_subjects es WHERE es.exam_id = x.id AND es.class_id = :classId)', {
          classId: section.class_id,
        })
        .orderBy('x.published_at', 'DESC')
        .addOrderBy('x.id', 'DESC')
        .getOne();
    }
    if (!exam) return { exam: null, section: this.sectionRef(section), rows: [] };
    const results = await this.classResults(exam, section.class_id);
    return {
      exam: this.ref(exam),
      section: this.sectionRef(section),
      rows: results.rows
        .filter((row) => row.section_id === section.id)
        .sort(byRank((row) => row.section_rank))
        .map((row) => ({
          rank: row.section_rank,
          student_id: row.student_id,
          full_name: row.full_name,
          roll_no: row.roll_no,
          total: row.total,
          max_total: row.max_total,
          percent: row.percent,
          grade: row.grade,
          result: row.result,
          class_rank: row.class_rank,
        })),
    };
  }

  private async classResults(exam: Exam, classId: number): Promise<ClassResults> {
    const subjects = (await this.paperRows(exam.id)).filter((paper) => paper.class_id === classId);
    const roster = await this.roster(exam, classId);
    const marks = await this.marksFor(
      exam.id,
      roster.map((row) => row.student_id),
    );
    const rows: ResultRowDto[] = roster.map((student) => {
      const scores: SubjectScore[] = subjects.map((paper) => {
        const mark = marks.get(`${student.student_id}:${paper.id}`);
        return {
          subject_id: paper.id,
          max_marks: paper.max_marks,
          pass_marks: paper.pass_marks,
          marks: mark?.marks ?? null,
          is_absent: mark?.is_absent ?? false,
          entered: Boolean(mark),
        };
      });
      return {
        student_id: student.student_id,
        admission_no: student.admission_no,
        full_name: fullName(student),
        roll_no: student.roll_no,
        section_id: student.section_id,
        section_name: student.section_name,
        ...scoreStudent(scores),
        section_rank: null,
        class_rank: null,
        subjects: scores.map((score) => ({
          subject_id: score.subject_id,
          marks: score.marks,
          is_absent: score.is_absent,
          passed: subjectPassed(score),
        })),
      };
    });
    const rankable = (row: ResultRowDto) => (row.result === 'incomplete' ? null : row.total);
    competitionRanks(rows.map(rankable)).forEach((rank, index) => (rows[index].class_rank = rank));
    for (const sectionId of new Set(rows.map((row) => row.section_id))) {
      const own = rows.filter((row) => row.section_id === sectionId);
      competitionRanks(own.map(rankable)).forEach((rank, index) => (own[index].section_rank = rank));
    }
    return { subjects, rows: rows.sort(byRank((row) => row.class_rank)) };
  }

  private async toppersOf(exam: Exam, schoolClass: { id: number; name: string }, limit: number) {
    const results = await this.classResults(exam, schoolClass.id);
    const toppers: TopperDto[] = results.rows
      .filter((row) => row.class_rank !== null && row.class_rank <= limit)
      .map((row) => ({
        rank: row.class_rank!,
        student_id: row.student_id,
        full_name: row.full_name,
        admission_no: row.admission_no,
        section_id: row.section_id,
        section_name: row.section_name,
        total: row.total,
        max_total: row.max_total,
        percent: row.percent!,
        grade: row.grade!,
      }));
    return { class_id: schoolClass.id, class_name: schoolClass.name, students: results.rows.length, toppers };
  }

  private summary(rows: ResultRowDto[]): ResultSummaryDto {
    const complete = rows.filter((row) => row.percent !== null);
    const percents = complete.map((row) => row.percent!);
    return {
      students: rows.length,
      ranked: complete.length,
      passed: rows.filter((row) => row.result === 'pass').length,
      failed: rows.filter((row) => row.result === 'fail').length,
      incomplete: rows.filter((row) => row.result === 'incomplete').length,
      average_percent: percents.length
        ? Math.round((percents.reduce((sum, value) => sum + value, 0) / percents.length) * 10) / 10
        : null,
      highest_percent: percents.length ? Math.max(...percents) : null,
    };
  }

  private async notifyParents(exam: Exam): Promise<void> {
    for (const schoolClass of await this.examClasses(exam.id)) {
      const results = await this.classResults(exam, schoolClass.id);
      const complete = results.rows.filter((row) => row.result !== 'incomplete');
      if (!complete.length) continue;
      const parents: { student_id: number; user_ids: number[] }[] = await this.dataSource.query(
        `SELECT sg.student_id, array_remove(array_agg(DISTINCT g.user_id), NULL) AS user_ids
         FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
         WHERE sg.student_id = ANY($1) AND sg.receives_alerts = true GROUP BY sg.student_id`,
        [complete.map((row) => row.student_id)],
      );
      for (const row of complete) {
        const userIds = (parents.find((item) => Number(item.student_id) === row.student_id)?.user_ids ?? []).map(
          Number,
        );
        if (!userIds.length) continue;
        await this.notifications
          .dispatch({
            template: TEMPLATES.RESULT_PUBLISHED,
            audience: { user_ids: userIds },
            data: {
              exam: exam.name,
              student: row.full_name,
              percent: String(row.percent),
              grade: row.grade ?? '',
              rank: `${row.class_rank}/${complete.length}`,
              student_id: String(row.student_id),
              exam_id: String(exam.id),
            },
          })
          .catch((error: Error) => this.logger.warn(`Result alert for student ${row.student_id}: ${error.message}`));
      }
    }
  }

  private async find(schoolId: number, id: number, withRelations = false): Promise<Exam> {
    const exam = await this.exams.findOne({
      where: { id, school_id: schoolId },
      relations: withRelations ? { academic_year: true, term: true } : undefined,
    });
    if (!exam) throw AppException.notFound('Exam not found', 'EXAM_NOT_FOUND');
    return exam;
  }

  private async sectionRow(schoolId: number, sectionId: number): Promise<SectionRow> {
    const [row] = await this.dataSource.query(
      `SELECT sec.id, sec.name, sec.class_id, c.name AS class_name, sec.academic_year_id
       FROM sections sec JOIN classes c ON c.id = sec.class_id
       WHERE sec.id = $1 AND sec.school_id = $2 AND sec.deleted_at IS NULL`,
      [sectionId, schoolId],
    );
    if (!row) throw AppException.notFound('Section not found', 'SECTION_NOT_FOUND');
    return {
      id: Number(row.id),
      name: row.name,
      class_id: Number(row.class_id),
      class_name: row.class_name,
      academic_year_id: Number(row.academic_year_id),
    };
  }

  private async examSection(schoolId: number, exam: Exam, sectionId: number): Promise<SectionRow> {
    const section = await this.sectionRow(schoolId, sectionId);
    const inExam =
      section.academic_year_id === exam.academic_year_id &&
      (await this.papers.existsBy({ exam_id: exam.id, class_id: section.class_id }));
    if (!inExam) throw AppException.notFound('This section does not write this exam', 'SECTION_NOT_IN_EXAM');
    return section;
  }

  private async paper(exam: Exam, classId: number, subjectId: number): Promise<PaperRow> {
    const paper = (await this.paperRows(exam.id)).find((row) => row.class_id === classId && row.id === subjectId);
    if (!paper) throw AppException.notFound('This subject is not part of the exam', 'SUBJECT_NOT_IN_EXAM');
    return paper;
  }

  private async paperRows(examId: number): Promise<PaperRow[]> {
    const rows: {
      paper_id: number;
      class_id: number;
      id: number;
      name: string;
      code: string;
      max_marks: number;
      pass_marks: number;
      exam_date: string | null;
    }[] = await this.dataSource.query(
      `SELECT es.id AS paper_id, es.class_id, s.id, s.name, s.code, es.max_marks, es.pass_marks,
              to_char(es.exam_date, 'YYYY-MM-DD') AS exam_date
       FROM exam_subjects es JOIN subjects s ON s.id = es.subject_id
       WHERE es.exam_id = $1
       ORDER BY es.exam_date NULLS LAST, s.name`,
      [examId],
    );
    return rows.map((row) => ({
      paper_id: Number(row.paper_id),
      class_id: Number(row.class_id),
      id: Number(row.id),
      name: row.name,
      code: row.code,
      max_marks: Number(row.max_marks),
      pass_marks: Number(row.pass_marks),
      exam_date: row.exam_date,
    }));
  }

  private async roster(exam: Exam, classId: number, sectionId?: number): Promise<RosterRow[]> {
    const rows: RosterRow[] = await this.dataSource.query(
      `SELECT s.id AS student_id, s.admission_no, s.first_name, s.last_name, e.roll_no, e.section_id,
              sec.name AS section_name
       FROM student_enrollments e
       JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
       JOIN sections sec ON sec.id = e.section_id
       WHERE e.school_id = $1 AND e.academic_year_id = $2 AND e.class_id = $3
         AND ($4::int IS NULL OR e.section_id = $4)
         AND (s.status = 'active' OR EXISTS (SELECT 1 FROM exam_marks m WHERE m.exam_id = $5 AND m.student_id = s.id))
       ORDER BY sec.name, e.roll_no NULLS LAST, s.first_name, s.last_name`,
      [exam.school_id, exam.academic_year_id, classId, sectionId ?? null, exam.id],
    );
    return rows.map((row) => ({
      ...row,
      student_id: Number(row.student_id),
      section_id: Number(row.section_id),
      roll_no: row.roll_no === null ? null : Number(row.roll_no),
    }));
  }

  private async marksFor(
    examId: number,
    studentIds: number[],
    subjectId?: number,
  ): Promise<Map<string, { marks: number | null; is_absent: boolean }>> {
    if (!studentIds.length) return new Map();
    const rows: { student_id: number; subject_id: number; marks: string | null; is_absent: boolean }[] =
      await this.dataSource.query(
        `SELECT student_id, subject_id, marks, is_absent FROM exam_marks
         WHERE exam_id = $1 AND student_id = ANY($2) AND ($3::int IS NULL OR subject_id = $3)`,
        [examId, studentIds, subjectId ?? null],
      );
    return new Map(
      rows.map((row) => [
        `${row.student_id}:${row.subject_id}`,
        { marks: row.marks === null ? null : Number(row.marks), is_absent: row.is_absent },
      ]),
    );
  }

  private async examClasses(examId: number): Promise<{ id: number; name: string }[]> {
    const rows: { id: number; name: string }[] = await this.dataSource.query(
      `SELECT c.id, c.name FROM classes c
       WHERE c.id IN (SELECT class_id FROM exam_subjects WHERE exam_id = $1)
       ORDER BY c.grade_level, c.name`,
      [examId],
    );
    return rows.map((row) => ({ id: Number(row.id), name: row.name }));
  }

  private async examClassIds(manager: EntityManager, examId: number): Promise<number[]> {
    const rows: { class_id: number }[] = await manager.query(
      `SELECT DISTINCT class_id FROM exam_subjects WHERE exam_id = $1`,
      [examId],
    );
    return rows.map((row) => Number(row.class_id));
  }

  private async classHasMarks(manager: EntityManager, exam: Exam, classId: number): Promise<boolean> {
    const [row] = await manager.query(
      `SELECT 1 FROM exam_marks m
       JOIN student_enrollments e ON e.student_id = m.student_id AND e.academic_year_id = $2 AND e.class_id = $3
       WHERE m.exam_id = $1 LIMIT 1`,
      [exam.id, exam.academic_year_id, classId],
    );
    return Boolean(row);
  }

  private async paperMaxMarks(
    manager: EntityManager,
    exam: Exam,
    classId: number,
    subjectId: number,
  ): Promise<number | null> {
    const [row] = await manager.query(
      `SELECT COUNT(*) AS count, MAX(m.marks) AS highest FROM exam_marks m
       JOIN student_enrollments e ON e.student_id = m.student_id AND e.academic_year_id = $2 AND e.class_id = $3
       WHERE m.exam_id = $1 AND m.subject_id = $4`,
      [exam.id, exam.academic_year_id, classId, subjectId],
    );
    if (!Number(row?.count)) return null;
    return Number(row.highest ?? 0);
  }

  private async addClasses(manager: EntityManager, schoolId: number, exam: Exam, classIds: number[]): Promise<void> {
    const classes: { id: number; name: string }[] = await manager.query(
      `SELECT id, name FROM classes WHERE id = ANY($1) AND school_id = $2 AND deleted_at IS NULL`,
      [classIds, schoolId],
    );
    const missing = classIds.find((id) => !classes.some((item) => Number(item.id) === id));
    if (missing) throw AppException.notFound(`Class ${missing} not found`, 'CLASS_NOT_FOUND');
    const subjects: { class_id: number; subject_id: number }[] = await manager.query(
      `SELECT cs.class_id, cs.subject_id FROM class_subjects cs
       JOIN subjects s ON s.id = cs.subject_id AND s.deleted_at IS NULL AND s.type <> 'activity'
       WHERE cs.class_id = ANY($1) AND cs.academic_year_id = $2`,
      [classIds, exam.academic_year_id],
    );
    const empty = classes.find((item) => !subjects.some((row) => Number(row.class_id) === Number(item.id)));
    if (empty) {
      throw AppException.badRequest(
        `Class ${empty.name} has no subjects this year. Pick its subjects in School setup first.`,
        'CLASS_HAS_NO_SUBJECTS',
      );
    }
    await manager.insert(
      ExamSubject,
      subjects.map((row) => ({
        school_id: schoolId,
        exam_id: exam.id,
        class_id: Number(row.class_id),
        subject_id: Number(row.subject_id),
        max_marks: DEFAULT_MAX_MARKS,
        pass_marks: DEFAULT_PASS_MARKS,
      })),
    );
  }

  private async assertExamFields(
    schoolId: number,
    year: AcademicYear,
    name: string,
    termId: number | null,
    start: string,
    end: string,
    examId?: number,
  ): Promise<void> {
    if (start > end) {
      throw AppException.validation([{ field: 'end_date', message: 'The exam must end on or after its first day' }]);
    }
    if (start < year.start_date || end > year.end_date) {
      throw AppException.badRequest(
        `Exam dates must be inside ${year.name} (${year.start_date} to ${year.end_date})`,
        'OUTSIDE_YEAR',
      );
    }
    if (termId !== null) {
      const term = await this.dataSource
        .getRepository(Term)
        .findOneBy({ id: termId, school_id: schoolId, academic_year_id: year.id });
      if (!term) throw AppException.badRequest(`Choose a term of ${year.name}`, 'TERM_NOT_IN_YEAR');
    }
    const clash = await this.exams
      .createQueryBuilder('x')
      .where('x.school_id = :schoolId AND x.academic_year_id = :year AND LOWER(x.name) = LOWER(:name)', {
        schoolId,
        year: year.id,
        name,
      })
      .andWhere(examId ? 'x.id <> :examId' : '1=1', { examId })
      .getExists();
    if (clash) throw AppException.conflict(`${name} already exists in ${year.name}`, 'EXAM_EXISTS');
  }

  private assertPapers(exam: Exam, items: ExamSubjectInputDto[]): void {
    const errors: FieldError[] = [];
    const keys = new Set<string>();
    items.forEach((item, index) => {
      const key = `${item.class_id}:${item.subject_id}`;
      if (keys.has(key)) errors.push({ field: `items.${index}.subject_id`, message: 'This subject is listed twice' });
      keys.add(key);
      if (item.pass_marks > item.max_marks) {
        errors.push({ field: `items.${index}.pass_marks`, message: 'Pass marks cannot be more than max marks' });
      }
      if (item.exam_date && (item.exam_date < exam.start_date || item.exam_date > exam.end_date)) {
        errors.push({
          field: `items.${index}.exam_date`,
          message: `Exam date must be between ${exam.start_date} and ${exam.end_date}`,
        });
      }
    });
    if (errors.length) throw AppException.validation(errors);
  }

  private async assertSchoolRows(
    schoolId: number,
    table: 'classes' | 'subjects',
    ids: number[],
    label: string,
    code: string,
  ): Promise<void> {
    if (!ids.length) return;
    const rows: { id: number }[] = await this.dataSource.query(
      `SELECT id FROM ${table} WHERE id = ANY($1) AND school_id = $2 AND deleted_at IS NULL`,
      [ids, schoolId],
    );
    const missing = ids.find((id) => !rows.some((row) => Number(row.id) === id));
    if (missing) throw AppException.notFound(`${label} ${missing} not found`, code);
  }

  private async presentMany(exams: Exam[]): Promise<ExamDto[]> {
    if (!exams.length) return [];
    const ids = exams.map((exam) => exam.id);
    const [papers, students, entered] = await Promise.all([
      this.dataSource.query(
        `SELECT es.exam_id, es.class_id, c.name, c.grade_level, COUNT(*) AS papers
         FROM exam_subjects es JOIN classes c ON c.id = es.class_id
         WHERE es.exam_id = ANY($1) GROUP BY es.exam_id, es.class_id, c.name, c.grade_level
         ORDER BY c.grade_level, c.name`,
        [ids],
      ) as Promise<{ exam_id: number; class_id: number; name: string; papers: string }[]>,
      this.dataSource.query(
        `SELECT e.academic_year_id, e.class_id, COUNT(*) AS count FROM student_enrollments e
         JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL AND s.status = 'active'
         WHERE e.academic_year_id = ANY($1) AND e.section_id IS NOT NULL
         GROUP BY e.academic_year_id, e.class_id`,
        [[...new Set(exams.map((exam) => exam.academic_year_id))]],
      ) as Promise<{ academic_year_id: number; class_id: number; count: string }[]>,
      this.dataSource.query(
        `SELECT exam_id, COUNT(*) AS count FROM exam_marks WHERE exam_id = ANY($1) GROUP BY exam_id`,
        [ids],
      ) as Promise<{ exam_id: number; count: string }[]>,
    ]);
    return exams.map((exam) => {
      const own = papers.filter((row) => Number(row.exam_id) === exam.id);
      const expected = own.reduce((sum, row) => {
        const count = students.find(
          (item) =>
            Number(item.academic_year_id) === exam.academic_year_id && Number(item.class_id) === Number(row.class_id),
        )?.count;
        return sum + Number(row.papers) * Number(count ?? 0);
      }, 0);
      return {
        id: exam.id,
        name: exam.name,
        academic_year: { id: exam.academic_year_id, name: exam.academic_year?.name ?? '' },
        term: exam.term ? { id: exam.term.id, name: exam.term.name } : null,
        start_date: exam.start_date,
        end_date: exam.end_date,
        status: exam.status,
        published_at: exam.published_at,
        classes: own.map((row) => ({ id: Number(row.class_id), name: row.name })),
        paper_count: own.reduce((sum, row) => sum + Number(row.papers), 0),
        marks_entered: Number(entered.find((row) => Number(row.exam_id) === exam.id)?.count ?? 0),
        marks_expected: expected,
        created_at: exam.created_at,
      };
    });
  }

  private presentPaper(
    paper: PaperRow,
    schoolClass: { id: number; name: string },
    entered: { subject_id: number; class_id: number; count: string }[],
  ): ExamSubjectDto {
    return {
      id: paper.paper_id,
      class: schoolClass,
      subject_id: paper.id,
      subject_name: paper.name,
      subject_code: paper.code,
      max_marks: paper.max_marks,
      pass_marks: paper.pass_marks,
      exam_date: paper.exam_date,
      marks_entered: Number(
        entered.find((row) => Number(row.subject_id) === paper.id && Number(row.class_id) === paper.class_id)?.count ??
          0,
      ),
    };
  }

  private ref(exam: Exam): ExamRefDto {
    return {
      id: exam.id,
      name: exam.name,
      status: exam.status,
      start_date: exam.start_date,
      end_date: exam.end_date,
      published_at: exam.published_at,
    };
  }

  private sectionRef(section: SectionRow): SectionRefDto {
    return {
      id: section.id,
      name: `${section.class_name} - ${section.name}`,
      class_id: section.class_id,
      class_name: section.class_name,
      section_name: section.name,
    };
  }

  private subjectRef(paper: PaperRow): MarkSubjectDto {
    return {
      id: paper.id,
      name: paper.name,
      code: paper.code,
      max_marks: paper.max_marks,
      pass_marks: paper.pass_marks,
      exam_date: paper.exam_date,
    };
  }
}
