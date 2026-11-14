import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { AppException, AuthUser, Paginated, paginate } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { yearClause, yearWhere } from '../../shared/year-context';
import { ROLES } from '../access/access.catalog';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import { NotificationsService } from '../notifications/notifications.service';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../setup/entities/academic-year.entity';
import { Term } from '../setup/entities/term.entity';
import { AssignmentsService } from '../staff/assignments.service';
import {
  FeedbackRosterDto,
  FeedbackSettingsDto,
  FeedbackSettingsInputDto,
  OwnRatingsDto,
  PeriodDto,
  RankingRowDto,
  RateableTeacherDto,
  RateableTeachersDto,
  RateTeacherDto,
  RatingDto,
  RatingsQueryDto,
  StudentFeedbackDto,
  StudentFeedbackInputDto,
  StudentFeedbackQueryDto,
  TeacherReportDto,
  TeacherReportQueryDto,
  TeacherReportRowDto,
  TermRefDto,
} from './dto/feedback.dto';
import { StudentFeedback, TeacherRating } from './entities/feedback.entity';
import { PaperRow, rankTeachers, ratingCycle, starLabel, subjectResults, summariseRatings } from './feedback.logic';

interface ChildRow {
  school_id: number;
  section_id: number | null;
  section: string | null;
  class_teacher_user_id: number | null;
  name: string;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger('Feedback');

  constructor(
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
    private readonly assignments: AssignmentsService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async settings(schoolId: number): Promise<FeedbackSettingsDto> {
    const school = await this.school(schoolId);
    const year = await this.dataSource.getRepository(AcademicYear).findOneBy(yearWhere(schoolId));
    return {
      teacher_rating_enabled: school.teacher_rating_enabled,
      teacher_rating_months: school.teacher_rating_months,
      student_feedback_enabled: school.student_feedback_enabled,
      cycle: year ? this.cycle(school, year) : null,
      term: year ? await this.term(schoolId, year) : null,
    };
  }

  async updateSettings(schoolId: number, dto: FeedbackSettingsInputDto): Promise<FeedbackSettingsDto> {
    await this.school(schoolId);
    const changes: Partial<School> = {};
    if (dto.teacher_rating_enabled !== undefined) changes.teacher_rating_enabled = dto.teacher_rating_enabled;
    if (dto.teacher_rating_months !== undefined) changes.teacher_rating_months = dto.teacher_rating_months;
    if (dto.student_feedback_enabled !== undefined) changes.student_feedback_enabled = dto.student_feedback_enabled;
    if (Object.keys(changes).length) await this.dataSource.getRepository(School).update(schoolId, changes);
    return this.settings(schoolId);
  }

  async rateable(parentUserId: number, studentId: number): Promise<RateableTeachersDto> {
    const child = await this.child(parentUserId, studentId);
    const school = await this.school(child.school_id);
    const year = await this.viewedYear(child.school_id);
    const cycle = this.cycle(school, year);
    const teachers = await this.childTeachers(child, year.id);
    const mine = cycle
      ? await this.dataSource.getRepository(TeacherRating).findBy({
          parent_user_id: parentUserId,
          student_id: studentId,
          cycle_start: cycle.start,
        })
      : [];
    return {
      enabled: school.teacher_rating_enabled,
      months: school.teacher_rating_months,
      cycle,
      teachers: teachers.map((teacher) => {
        const rating = mine.find((row) => row.teacher_user_id === teacher.teacher_user_id);
        return {
          ...teacher,
          rated: Boolean(rating),
          my_rating: rating
            ? {
                stars: rating.stars,
                stars_label: starLabel(rating.stars)!,
                behaviour: rating.behaviour,
                remark: rating.remark,
                rated_at: rating.created_at,
              }
            : null,
        };
      }),
    };
  }

  async rate(parent: AuthUser, studentId: number, dto: RateTeacherDto): Promise<RateableTeacherDto> {
    const child = await this.child(parent.id, studentId);
    const school = await this.school(child.school_id);
    if (!school.teacher_rating_enabled) {
      throw AppException.forbidden('The school has not opened teacher ratings now', 'RATING_CLOSED');
    }
    const year = await this.viewedYear(child.school_id);
    const cycle = this.cycle(school, year);
    if (!cycle) throw AppException.forbidden('Teacher ratings open during the academic year', 'RATING_CLOSED');
    const teacher = (await this.childTeachers(child, year.id)).find(
      (item) => item.teacher_user_id === dto.teacher_user_id,
    );
    if (!teacher) {
      throw AppException.badRequest('You can rate only your child’s teachers', 'NOT_CHILD_TEACHER');
    }
    const repo = this.dataSource.getRepository(TeacherRating);
    const existing = await repo.findOneBy({
      parent_user_id: parent.id,
      teacher_user_id: dto.teacher_user_id,
      student_id: studentId,
      cycle_start: cycle.start,
    });
    if (existing) {
      throw AppException.conflict(
        `You have already rated ${teacher.name}. You can rate again from ${this.nextDay(cycle.end)}.`,
        'ALREADY_RATED',
      );
    }
    const remark = dto.remark?.trim() || null;
    const saved = await repo.save(
      repo.create({
        school_id: child.school_id,
        academic_year_id: year.id,
        teacher_user_id: dto.teacher_user_id,
        parent_user_id: parent.id,
        student_id: studentId,
        section_id: child.section_id,
        stars: dto.stars,
        behaviour: dto.behaviour,
        remark,
        cycle_start: cycle.start,
        cycle_end: cycle.end,
        created_by: parent.id,
      }),
    );
    const [parentRow] = await this.dataSource.query(`SELECT name FROM users WHERE id = $1`, [parent.id]);
    this.notifications
      .dispatch({
        template: TEMPLATES.TEACHER_RATED,
        audience: { roles: [ROLES.ADMIN], school_id: child.school_id },
        data: {
          teacher: teacher.name,
          teacher_user_id: String(teacher.teacher_user_id),
          parent: parentRow?.name ?? 'A parent',
          student: child.name,
          student_id: String(studentId),
          class: child.section ?? '',
          stars: String(dto.stars),
          behaviour: dto.behaviour === 'good' ? 'Good' : 'Bad',
          remark: remark ? ` “${remark}”` : '',
          rating_id: String(saved.id),
        },
      })
      .catch((error: Error) => this.logger.warn(`TEACHER_RATED ${saved.id} failed: ${error.message}`));
    return {
      ...teacher,
      rated: true,
      my_rating: {
        stars: saved.stars,
        stars_label: starLabel(saved.stars)!,
        behaviour: saved.behaviour,
        remark: saved.remark,
        rated_at: saved.created_at,
      },
    };
  }

  async childFeedback(parentUserId: number, studentId: number): Promise<StudentFeedbackDto[]> {
    const child = await this.child(parentUserId, studentId);
    const year = await this.viewedYear(child.school_id);
    const rows = await this.dataSource.getRepository(StudentFeedback).find({
      where: { school_id: child.school_id, academic_year_id: year.id, student_id: studentId },
      order: { created_at: 'DESC' },
    });
    return this.presentFeedback(rows, year);
  }

  async ownRatings(teacher: AuthUser): Promise<OwnRatingsDto> {
    const schoolId = this.schoolOf(teacher);
    const school = await this.school(schoolId);
    const year = await this.viewedYear(schoolId);
    const cycle = this.cycle(school, year);
    const rows = await this.dataSource.getRepository(TeacherRating).find({
      where: { school_id: schoolId, academic_year_id: year.id, teacher_user_id: teacher.id },
      order: { cycle_start: 'DESC', stars: 'DESC', behaviour: 'DESC' },
    });
    const current = cycle ? rows.filter((row) => row.cycle_start === cycle.start) : [];
    return {
      enabled: school.teacher_rating_enabled,
      summary: summariseRatings(rows),
      this_cycle: cycle ? summariseRatings(current) : null,
      cycle,
      remarks: rows.map((row) => ({
        stars: row.stars,
        stars_label: starLabel(row.stars)!,
        behaviour: row.behaviour,
        remark: row.remark,
        cycle: { start: row.cycle_start, end: row.cycle_end },
      })),
    };
  }

  async roster(teacher: AuthUser, sectionId: number): Promise<FeedbackRosterDto> {
    const schoolId = this.schoolOf(teacher);
    await this.assignments.assertTeachesSection(schoolId, teacher.id, sectionId);
    const school = await this.school(schoolId);
    const year = await this.viewedYear(schoolId);
    const term = await this.term(schoolId, year);
    const students: { student_id: number; first_name: string; last_name: string | null; roll_no: number | null }[] =
      await this.dataSource.query(
        `SELECT s.id AS student_id, s.first_name, s.last_name, e.roll_no FROM student_enrollments e
         JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL AND s.status = 'active'
         WHERE e.section_id = $1 AND e.academic_year_id = $2
         ORDER BY e.roll_no NULLS LAST, s.first_name`,
        [sectionId, year.id],
      );
    const given = term
      ? await this.dataSource.getRepository(StudentFeedback).find({
          where: {
            teacher_user_id: teacher.id,
            academic_year_id: year.id,
            term_id: term.id,
            student_id: In(students.map((row) => Number(row.student_id)).concat(0)),
          },
        })
      : [];
    const presented = new Map(
      (await this.presentFeedback(given, year)).map((item) => [item.student.id, item] as const),
    );
    return {
      enabled: school.student_feedback_enabled,
      term,
      total: students.length,
      given: presented.size,
      students: students.map((row) => ({
        student_id: Number(row.student_id),
        name: [row.first_name, row.last_name].filter(Boolean).join(' '),
        roll_no: row.roll_no,
        feedback: presented.get(Number(row.student_id)) ?? null,
      })),
    };
  }

  async giveFeedback(teacher: AuthUser, studentId: number, dto: StudentFeedbackInputDto): Promise<StudentFeedbackDto> {
    const schoolId = this.schoolOf(teacher);
    const school = await this.school(schoolId);
    if (!school.student_feedback_enabled) {
      throw AppException.forbidden('The school has not opened student feedback now', 'FEEDBACK_CLOSED');
    }
    const year = await this.viewedYear(schoolId);
    const term = await this.term(schoolId, year);
    if (!term) throw AppException.badRequest('Today is not inside any term of this year', 'NO_TERM_NOW');
    await this.assignments.assertTeachesStudent(schoolId, teacher.id, studentId);
    const repo = this.dataSource.getRepository(StudentFeedback);
    const existing = await repo.findOneBy({
      teacher_user_id: teacher.id,
      student_id: studentId,
      academic_year_id: year.id,
      term_id: term.id,
    });
    if (existing) {
      throw AppException.conflict(`You have already given feedback for ${term.name}`, 'FEEDBACK_ALREADY_GIVEN');
    }
    const [enrollment] = await this.dataSource.query(
      `SELECT section_id FROM student_enrollments WHERE student_id = $1 AND academic_year_id = $2 LIMIT 1`,
      [studentId, year.id],
    );
    const saved = await repo.save(
      repo.create({
        school_id: schoolId,
        academic_year_id: year.id,
        term_id: term.id,
        teacher_user_id: teacher.id,
        student_id: studentId,
        section_id: enrollment?.section_id ? Number(enrollment.section_id) : null,
        studies: dto.studies,
        behaviour: dto.behaviour,
        sports: dto.sports ?? null,
        remark: dto.remark?.trim() || null,
        created_by: teacher.id,
      }),
    );
    const [presented] = await this.presentFeedback([saved], year);
    await this.tellParents(presented!);
    return presented!;
  }

  async ratings(schoolId: number, query: RatingsQueryDto): Promise<Paginated<RatingDto>> {
    const year = await this.viewedYear(schoolId);
    const params: (number | string)[] = [schoolId, year.id];
    const where = ['r.school_id = $1', 'r.academic_year_id = $2', 'r.deleted_at IS NULL'];
    if (query.teacher_user_id) where.push(`r.teacher_user_id = $${params.push(query.teacher_user_id)}`);
    if (query.behaviour) where.push(`r.behaviour = $${params.push(query.behaviour)}`);
    if (query.max_stars) where.push(`r.stars <= $${params.push(query.max_stars)}`);
    for (const word of (query.search ?? '').trim().split(/\s+/).filter(Boolean)) {
      const index = params.push(`%${word.replace(/[\\%_]/g, (char) => `\\${char}`)}%`);
      where.push(
        `(t.name ILIKE $${index} OR p.name ILIKE $${index} OR st.first_name ILIKE $${index} OR st.last_name ILIKE $${index} OR r.remark ILIKE $${index})`,
      );
    }
    const order = query.sort === 'stars' ? 'r.stars' : 'r.created_at';
    const direction = (query.order ?? 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    if (query.sort && !['stars', 'created_at'].includes(query.sort)) {
      throw AppException.badRequest('sort must be created_at or stars', 'INVALID_SORT');
    }
    const from = `FROM teacher_ratings r
      JOIN users t ON t.id = r.teacher_user_id
      JOIN users p ON p.id = r.parent_user_id
      JOIN students st ON st.id = r.student_id
      WHERE ${where.join(' AND ')}`;
    const [count] = await this.dataSource.query(`SELECT COUNT(*) AS total ${from}`, params);
    const rows: {
      id: number;
      teacher_user_id: number;
      teacher: string;
      parent_user_id: number;
      parent: string;
      student_id: number;
      first_name: string;
      last_name: string | null;
      section_id: number | null;
      stars: number;
      behaviour: 'good' | 'bad';
      remark: string | null;
      cycle_start: string;
      cycle_end: string;
      created_at: Date;
    }[] = await this.dataSource.query(
      `SELECT r.id, r.teacher_user_id, t.name AS teacher, r.parent_user_id, p.name AS parent, r.student_id,
              st.first_name, st.last_name, r.section_id, r.stars, r.behaviour, r.remark,
              r.cycle_start::text AS cycle_start, r.cycle_end::text AS cycle_end, r.created_at
       ${from} ORDER BY ${order} ${direction}, r.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.limit, (query.page - 1) * query.limit],
    );
    const sections = await this.sectionNames(rows.map((row) => row.section_id));
    return paginate(
      [
        rows.map((row) => ({
          id: Number(row.id),
          teacher: { id: Number(row.teacher_user_id), name: row.teacher },
          parent: { id: Number(row.parent_user_id), name: row.parent },
          student: {
            id: Number(row.student_id),
            name: [row.first_name, row.last_name].filter(Boolean).join(' '),
          },
          section: row.section_id ? (sections.get(Number(row.section_id)) ?? null) : null,
          stars: Number(row.stars),
          stars_label: starLabel(Number(row.stars))!,
          behaviour: row.behaviour,
          remark: row.remark,
          cycle: { start: row.cycle_start, end: row.cycle_end },
          created_at: row.created_at,
        })),
        Number(count?.total ?? 0),
      ],
      query.page,
      query.limit,
    );
  }

  async removeRating(schoolId: number, id: number): Promise<void> {
    const repo = this.dataSource.getRepository(TeacherRating);
    const row = await repo.findOneBy({ id, school_id: schoolId });
    if (!row) throw AppException.notFound('Rating not found', 'RATING_NOT_FOUND');
    await repo.softDelete(id);
  }

  async removeStudentFeedback(schoolId: number, id: number): Promise<void> {
    const repo = this.dataSource.getRepository(StudentFeedback);
    const row = await repo.findOneBy({ id, school_id: schoolId });
    if (!row) throw AppException.notFound('Feedback not found', 'FEEDBACK_NOT_FOUND');
    await repo.softDelete(id);
  }

  async ranking(schoolId: number): Promise<RankingRowDto[]> {
    const year = await this.viewedYear(schoolId);
    const [teachers, ratings] = await Promise.all([this.teachers(schoolId), this.yearRatings(schoolId, year.id)]);
    return rankTeachers(teachers, ratings);
  }

  async studentFeedback(schoolId: number, query: StudentFeedbackQueryDto): Promise<Paginated<StudentFeedbackDto>> {
    const year = await this.viewedYear(schoolId);
    const qb = this.dataSource
      .getRepository(StudentFeedback)
      .createQueryBuilder('f')
      .where('f.school_id = :schoolId AND f.academic_year_id = :yearId', { schoolId, yearId: year.id });
    if (query.section_id) qb.andWhere('f.section_id = :sectionId', { sectionId: query.section_id });
    if (query.teacher_user_id) qb.andWhere('f.teacher_user_id = :teacherId', { teacherId: query.teacher_user_id });
    if (query.term_id !== undefined) qb.andWhere('f.term_id = :termId', { termId: query.term_id });
    if (query.search?.trim()) {
      qb.andWhere(
        `f.student_id IN (SELECT s.id FROM students s WHERE concat_ws(' ', s.first_name, s.last_name) ILIKE :search)`,
        { search: `%${query.search.trim().replace(/[\\%_]/g, (char) => `\\${char}`)}%` },
      );
    }
    const [rows, total] = await qb
      .orderBy('f.created_at', 'DESC')
      .addOrderBy('f.id', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return paginate([await this.presentFeedback(rows, year), total], query.page, query.limit);
  }

  async teacherReport(schoolId: number, query: TeacherReportQueryDto): Promise<TeacherReportDto> {
    const year = await this.viewedYear(schoolId);
    let exam: { id: number; name: string } | null = null;
    if (query.exam_id) {
      const [row] = await this.dataSource.query(
        `SELECT id, name FROM exams WHERE id = $1 AND school_id = $2 AND academic_year_id = $3
           AND status = 'published' AND deleted_at IS NULL`,
        [query.exam_id, schoolId, year.id],
      );
      if (!row) throw AppException.notFound('Published exam not found', 'EXAM_NOT_FOUND');
      exam = { id: Number(row.id), name: row.name };
    }
    const assignmentRows: { teacher_user_id: number; section_id: number; subject_id: number; subject: string }[] =
      await this.dataSource.query(
        `SELECT ta.teacher_user_id, ta.section_id, ta.subject_id, sub.name AS subject
         FROM teacher_assignments ta JOIN subjects sub ON sub.id = ta.subject_id
         WHERE ta.school_id = $1 AND ta.academic_year_id = $2 AND ta.deleted_at IS NULL
           ${query.teacher_user_id ? 'AND ta.teacher_user_id = $3' : ''}`,
        query.teacher_user_id ? [schoolId, year.id, query.teacher_user_id] : [schoolId, year.id],
      );
    const params: number[] = [schoolId, year.id];
    const papers: PaperRow[] = await this.dataSource.query(
      `SELECT e.section_id, m.subject_id, m.student_id, m.marks, m.is_absent, es.max_marks, es.pass_marks
       FROM exam_marks m
       JOIN exams x ON x.id = m.exam_id AND x.school_id = $1 AND x.academic_year_id = $2
         AND x.status = 'published' AND x.deleted_at IS NULL
       JOIN student_enrollments e ON e.student_id = m.student_id AND e.academic_year_id = $2 AND e.section_id IS NOT NULL
       JOIN students s ON s.id = m.student_id AND s.deleted_at IS NULL
       JOIN exam_subjects es ON es.exam_id = m.exam_id AND es.subject_id = m.subject_id AND es.class_id = e.class_id
       WHERE (m.is_absent OR m.marks IS NOT NULL) ${exam ? `AND x.id = $${params.push(exam.id)}` : ''}`,
      params,
    );
    const results = subjectResults(
      papers.map((row) => ({
        ...row,
        section_id: Number(row.section_id),
        subject_id: Number(row.subject_id),
        student_id: Number(row.student_id),
      })),
    );
    const [teachers, ratings, remarks, sections] = await Promise.all([
      this.teachers(schoolId),
      this.yearRatings(schoolId, year.id),
      this.dataSource.query(
        `SELECT teacher_user_id, remark FROM teacher_ratings
         WHERE school_id = $1 AND academic_year_id = $2 AND deleted_at IS NULL AND remark IS NOT NULL
         ORDER BY created_at DESC`,
        [schoolId, year.id],
      ) as Promise<{ teacher_user_id: number; remark: string }[]>,
      this.sectionNames(assignmentRows.map((row) => row.section_id)),
    ]);
    const teacherIds = new Set(assignmentRows.map((row) => Number(row.teacher_user_id)));
    const rows: TeacherReportRowDto[] = teachers
      .filter((teacher) => teacherIds.has(teacher.teacher_user_id))
      .map((teacher) => {
        const classes = assignmentRows
          .filter((row) => Number(row.teacher_user_id) === teacher.teacher_user_id)
          .map((row) => {
            const result = results.get(`${row.section_id}:${row.subject_id}`);
            return {
              section_id: Number(row.section_id),
              section: sections.get(Number(row.section_id)) ?? '',
              subject_id: Number(row.subject_id),
              subject: row.subject,
              students: result?.students ?? 0,
              papers: result?.papers ?? 0,
              pass_percent: result?.pass_percent ?? null,
              fail_percent: result?.fail_percent ?? null,
              average_percent: result?.average_percent ?? null,
            };
          })
          .sort(
            (a, b) =>
              a.section.localeCompare(b.section, undefined, { numeric: true }) || a.subject.localeCompare(b.subject),
          );
        const paperCount = classes.reduce((sum, item) => sum + item.papers, 0);
        const passed = classes.reduce(
          (sum, item) => sum + (results.get(`${item.section_id}:${item.subject_id}`)?.passed ?? 0),
          0,
        );
        const weighted = classes.reduce((sum, item) => sum + (item.average_percent ?? 0) * item.papers, 0);
        const pass = paperCount ? round1((passed / paperCount) * 100) : null;
        return {
          teacher_user_id: teacher.teacher_user_id,
          name: teacher.name,
          designation: teacher.designation,
          overall: {
            papers: paperCount,
            pass_percent: pass,
            fail_percent: pass === null ? null : round1(100 - pass),
            average_percent: paperCount ? round1(weighted / paperCount) : null,
          },
          classes,
          rating: summariseRatings(ratings.filter((row) => row.teacher_user_id === teacher.teacher_user_id)),
          remarks: remarks
            .filter((row) => Number(row.teacher_user_id) === teacher.teacher_user_id)
            .slice(0, 5)
            .map((row) => row.remark),
        };
      });
    return { exam, teachers: rows };
  }

  private async tellParents(feedback: StudentFeedbackDto): Promise<void> {
    const [row] = await this.dataSource.query(
      `SELECT array_remove(array_agg(DISTINCT g.user_id), NULL) AS user_ids
       FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
       WHERE sg.student_id = $1`,
      [feedback.student.id],
    );
    const userIds: number[] = (row?.user_ids ?? []).map(Number);
    if (!userIds.length) return;
    const parts = [
      `Studies ${feedback.studies}★ ${feedback.studies_label}`,
      `Behaviour ${feedback.behaviour}★ ${feedback.behaviour_label}`,
      ...(feedback.sports ? [`Sports ${feedback.sports}★ ${feedback.sports_label}`] : []),
    ];
    this.notifications
      .dispatch({
        template: TEMPLATES.STUDENT_FEEDBACK,
        audience: { user_ids: userIds },
        data: {
          student: feedback.student.name,
          student_id: String(feedback.student.id),
          teacher: feedback.teacher.name,
          term: feedback.term.name,
          summary: parts.join(', '),
          remark: feedback.remark ? ` “${feedback.remark}”` : '',
          feedback_id: String(feedback.id),
        },
      })
      .catch((error: Error) => this.logger.warn(`STUDENT_FEEDBACK ${feedback.id} failed: ${error.message}`));
  }

  private async presentFeedback(rows: StudentFeedback[], year: AcademicYear): Promise<StudentFeedbackDto[]> {
    if (!rows.length) return [];
    const [people, students, terms, sections] = await Promise.all([
      this.dataSource.query(`SELECT id, name FROM users WHERE id = ANY($1)`, [
        [...new Set(rows.map((row) => row.teacher_user_id))],
      ]) as Promise<{ id: number; name: string }[]>,
      this.dataSource.query(`SELECT id, first_name, last_name FROM students WHERE id = ANY($1)`, [
        [...new Set(rows.map((row) => row.student_id))],
      ]) as Promise<{ id: number; first_name: string; last_name: string | null }[]>,
      this.dataSource.getRepository(Term).findBy({ academic_year_id: year.id }),
      this.sectionNames(rows.map((row) => row.section_id)),
    ]);
    const termOf = (id: number): TermRefDto => {
      const term = terms.find((item) => item.id === id);
      return term
        ? { id: term.id, name: term.name, start: term.start_date, end: term.end_date }
        : { id: 0, name: year.name, start: year.start_date, end: year.end_date };
    };
    return rows.map((row) => {
      const student = students.find((item) => Number(item.id) === row.student_id);
      return {
        id: row.id,
        term: termOf(row.term_id),
        teacher: {
          id: row.teacher_user_id,
          name: people.find((item) => Number(item.id) === row.teacher_user_id)?.name ?? '',
        },
        student: {
          id: row.student_id,
          name: student ? [student.first_name, student.last_name].filter(Boolean).join(' ') : '',
        },
        section: row.section_id ? (sections.get(row.section_id) ?? null) : null,
        studies: row.studies,
        studies_label: starLabel(row.studies)!,
        behaviour: row.behaviour,
        behaviour_label: starLabel(row.behaviour)!,
        sports: row.sports,
        sports_label: starLabel(row.sports),
        remark: row.remark,
        created_at: row.created_at,
      };
    });
  }

  private async child(parentUserId: number, studentId: number): Promise<ChildRow> {
    const [row] = await this.dataSource.query(
      `SELECT s.school_id, e.section_id, c.name || ' - ' || sec.name AS section, sec.class_teacher_user_id,
              concat_ws(' ', s.first_name, s.last_name) AS name
       FROM student_guardians sg
       JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
       JOIN students s ON s.id = sg.student_id AND s.deleted_at IS NULL AND s.status = 'active'
       LEFT JOIN academic_years y ON y.school_id = s.school_id AND ${yearClause('y')}
       LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = y.id
       LEFT JOIN sections sec ON sec.id = e.section_id
       LEFT JOIN classes c ON c.id = sec.class_id
       WHERE g.user_id = $1 AND sg.student_id = $2 LIMIT 1`,
      [parentUserId, studentId],
    );
    if (!row) throw AppException.notFound('This child is not linked to your mobile number', 'CHILD_NOT_FOUND');
    return {
      school_id: Number(row.school_id),
      section_id: row.section_id ? Number(row.section_id) : null,
      section: row.section,
      class_teacher_user_id: row.class_teacher_user_id ? Number(row.class_teacher_user_id) : null,
      name: row.name,
    };
  }

  private async childTeachers(
    child: ChildRow,
    yearId: number,
  ): Promise<{ teacher_user_id: number; name: string; subjects: string[]; is_class_teacher: boolean }[]> {
    if (!child.section_id) return [];
    const rows: { teacher_user_id: number; name: string; subject: string | null }[] = await this.dataSource.query(
      `SELECT ta.teacher_user_id, u.name, sub.name AS subject
       FROM teacher_assignments ta
       JOIN users u ON u.id = ta.teacher_user_id AND u.deleted_at IS NULL
       JOIN subjects sub ON sub.id = ta.subject_id
       WHERE ta.section_id = $1 AND ta.academic_year_id = $2 AND ta.deleted_at IS NULL
       UNION ALL
       SELECT u.id, u.name, NULL FROM users u WHERE u.id = $3 AND u.deleted_at IS NULL`,
      [child.section_id, yearId, child.class_teacher_user_id ?? 0],
    );
    const teachers = new Map<
      number,
      { teacher_user_id: number; name: string; subjects: string[]; is_class_teacher: boolean }
    >();
    for (const row of rows) {
      const id = Number(row.teacher_user_id);
      const entry = teachers.get(id) ?? {
        teacher_user_id: id,
        name: row.name,
        subjects: [],
        is_class_teacher: id === child.class_teacher_user_id,
      };
      if (row.subject && !entry.subjects.includes(row.subject)) entry.subjects.push(row.subject);
      teachers.set(id, entry);
    }
    return [...teachers.values()].sort(
      (a, b) => Number(b.is_class_teacher) - Number(a.is_class_teacher) || a.name.localeCompare(b.name),
    );
  }

  private async teachers(
    schoolId: number,
  ): Promise<{ teacher_user_id: number; name: string; designation: string | null }[]> {
    const rows: { user_id: number; name: string; designation: string | null }[] = await this.dataSource.query(
      `SELECT st.user_id, u.name, st.designation FROM staff st JOIN users u ON u.id = st.user_id
       WHERE st.school_id = $1 AND st.deleted_at IS NULL AND st.staff_type = 'teaching' AND st.user_id IS NOT NULL
       ORDER BY u.name`,
      [schoolId],
    );
    return rows.map((row) => ({ teacher_user_id: Number(row.user_id), name: row.name, designation: row.designation }));
  }

  private async yearRatings(schoolId: number, yearId: number) {
    const rows = await this.dataSource.getRepository(TeacherRating).find({
      select: { teacher_user_id: true, stars: true, behaviour: true },
      where: { school_id: schoolId, academic_year_id: yearId },
    });
    return rows.map((row) => ({ teacher_user_id: row.teacher_user_id, stars: row.stars, behaviour: row.behaviour }));
  }

  private async sectionNames(ids: (number | null)[]): Promise<Map<number, string>> {
    const unique = [...new Set(ids.filter((id): id is number => Boolean(id)).map(Number))];
    if (!unique.length) return new Map();
    const rows: { id: number; name: string }[] = await this.dataSource.query(
      `SELECT sec.id, c.name || ' - ' || sec.name AS name FROM sections sec JOIN classes c ON c.id = sec.class_id
       WHERE sec.id = ANY($1)`,
      [unique],
    );
    return new Map(rows.map((row) => [Number(row.id), row.name]));
  }

  private cycle(school: School, year: AcademicYear): PeriodDto | null {
    return ratingCycle(year.start_date, year.end_date, this.today(), school.teacher_rating_months);
  }

  private async term(schoolId: number, year: AcademicYear): Promise<TermRefDto | null> {
    const terms = await this.dataSource.getRepository(Term).find({
      where: { school_id: schoolId, academic_year_id: year.id },
      order: { sort_order: 'ASC', start_date: 'ASC' },
    });
    const today = this.today();
    if (!terms.length) {
      return today >= year.start_date && today <= year.end_date
        ? { id: 0, name: year.name, start: year.start_date, end: year.end_date }
        : null;
    }
    const term = terms.find((item) => today >= item.start_date && today <= item.end_date);
    return term ? { id: term.id, name: term.name, start: term.start_date, end: term.end_date } : null;
  }

  private async school(schoolId: number): Promise<School> {
    const school = await this.dataSource.getRepository(School).findOneBy({ id: schoolId });
    if (!school) throw AppException.notFound('School not found', 'SCHOOL_NOT_FOUND');
    return school;
  }

  private async viewedYear(schoolId: number): Promise<AcademicYear> {
    const year = await this.dataSource.getRepository(AcademicYear).findOneBy(yearWhere(schoolId));
    if (!year) throw AppException.badRequest('Set the current academic year first', 'NO_CURRENT_YEAR');
    return year;
  }

  private schoolOf(user: AuthUser): number {
    if (!user.school_id) throw AppException.forbidden('Your account is not linked to a school', 'NO_SCHOOL');
    return user.school_id;
  }

  private today(): string {
    return todayIn(this.app.timeZone);
  }

  private nextDay(iso: string): string {
    return new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  }
}
