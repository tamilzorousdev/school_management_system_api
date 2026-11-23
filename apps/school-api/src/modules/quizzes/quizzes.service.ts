import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AppException } from '@app/common';
import { NotificationsService } from '../notifications/notifications.service';
import { AssignmentsService } from '../staff/assignments.service';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import { OnlineQuiz } from './entities/online-quiz.entity';
import { QuizQuestion } from './entities/quiz-question.entity';
import { QuizSubmission } from './entities/quiz-submission.entity';
import { QuizAnswer } from './entities/quiz-answer.entity';
import { presentAdminQuiz } from './quiz-admin.present';
import { answerKeys, isCorrectAnswer, normalizeQuestion } from './quiz-questions.logic';
import { CreateQuizDto, QuizQueryDto, RejectQuizDto, SubmitQuizDto, UpdateQuizDto } from './dto/quiz.dto';

const passMarksOf = (quiz: OnlineQuiz): number | null => (quiz.pass_marks === null ? null : Number(quiz.pass_marks));

const passPercentage = (quiz: OnlineQuiz): number | null => {
  const total = Number(quiz.total_marks);
  return quiz.pass_marks === null || total <= 0 ? null : Math.round((Number(quiz.pass_marks) / total) * 1000) / 10;
};

function assertPassMarks(passMarks: number | null | undefined, totalMarks: number): void {
  if (passMarks !== null && passMarks !== undefined && passMarks > totalMarks) {
    throw AppException.badRequest(
      `The pass mark cannot be more than the total marks (${totalMarks})`,
      'INVALID_PASS_MARKS',
    );
  }
}

@Injectable()
export class QuizzesService {
  private readonly logger = new Logger('QuizzesService');

  constructor(
    @InjectRepository(OnlineQuiz) private readonly quizzes: Repository<OnlineQuiz>,
    @InjectRepository(QuizQuestion) private readonly questions: Repository<QuizQuestion>,
    @InjectRepository(QuizSubmission) private readonly submissions: Repository<QuizSubmission>,
    @InjectRepository(QuizAnswer) private readonly answers: Repository<QuizAnswer>,
    private readonly notifications: NotificationsService,
    private readonly assignments: AssignmentsService,
    private readonly dataSource: DataSource,
  ) {}

  async create(schoolId: number, teacherUserId: number, dto: CreateQuizDto): Promise<OnlineQuiz> {
    const start = new Date(dto.start_at);
    const end = new Date(dto.end_at);
    assertSchedule(start, end, dto.duration_minutes, true);
    const normalized = dto.questions.map((q, index) => normalizeQuestion(q, index));

    const academicYearId = dto.academic_year_id ?? (await this.currentAcademicYearId(schoolId));
    await this.assertTeacherCanQuiz(schoolId, teacherUserId, dto.section_id, dto.subject_id);

    const totalMarks = dto.questions.reduce((sum, q) => sum + (q.marks ?? 1), 0);
    const passMarks = dto.pass_marks ?? null;
    assertPassMarks(passMarks, totalMarks);

    const quiz = this.quizzes.create({
      school_id: schoolId,
      academic_year_id: academicYearId,
      subject_id: dto.subject_id,
      section_id: dto.section_id,
      teacher_user_id: teacherUserId,
      title: dto.title.trim(),
      description: dto.description?.trim() ?? null,
      instructions: dto.instructions?.trim() ?? null,
      total_marks: totalMarks,
      pass_marks: passMarks,
      duration_minutes: dto.duration_minutes,
      start_at: start,
      end_at: end,
      expire_on_exit: dto.expire_on_exit ?? false,
      require_camera: dto.require_camera ?? false,
      require_microphone: dto.require_microphone ?? false,
      status: 'draft',
    });

    const savedQuiz = await this.quizzes.save(quiz);

    const questionEntities = dto.questions.map((q, idx) =>
      this.questions.create({
        quiz_id: savedQuiz.id,
        sequence: q.sequence ?? idx + 1,
        question_text: q.question_text.trim(),
        ...normalized[idx],
        explanation: q.explanation?.trim() ?? null,
        marks: q.marks ?? 1,
      }),
    );

    savedQuiz.questions = await this.questions.save(questionEntities);
    return savedQuiz;
  }

  private async assertTeacherCanQuiz(
    schoolId: number,
    teacherUserId: number,
    sectionId: number,
    subjectId: number,
  ): Promise<void> {
    const subjects: { id: number }[] = await this.dataSource.query(
      `SELECT id FROM subjects WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [subjectId, schoolId],
    );
    if (!subjects.length) throw AppException.notFound('Subject not found', 'SUBJECT_NOT_FOUND');
    const classes = await this.assignments.teacherClasses(schoolId, teacherUserId);
    const mine = classes.find((item) => item.section_id === sectionId);
    if (!mine) throw AppException.forbidden('You do not teach this section', 'NOT_YOUR_SECTION');
    if (!mine.is_class_teacher && !mine.subjects.some((subject) => subject.id === subjectId)) {
      throw AppException.forbidden('You do not teach this subject in this section', 'NOT_YOUR_SUBJECT');
    }
  }

  private async currentAcademicYearId(schoolId: number): Promise<number> {
    const rows: { id: number }[] = await this.dataSource.query(
      'SELECT id FROM academic_years WHERE school_id = $1 AND is_current = true LIMIT 1',
      [schoolId],
    );
    if (!rows.length) throw AppException.badRequest('No current academic year is set', 'NO_CURRENT_ACADEMIC_YEAR');
    return Number(rows[0].id);
  }

  async listTeacherQuizzes(
    schoolId: number,
    teacherUserId: number,
    query: QuizQueryDto,
  ): Promise<{ items: (OnlineQuiz & { questions_count: number })[]; total: number }> {
    const qb = this.quizzes
      .createQueryBuilder('q')
      .leftJoinAndSelect('q.subject', 'sub')
      .leftJoinAndSelect('q.section', 'sec')
      .leftJoinAndSelect('sec.school_class', 'cls')
      .where('q.school_id = :schoolId', { schoolId })
      .andWhere('q.teacher_user_id = :teacherUserId', { teacherUserId });

    if (query.status) {
      qb.andWhere('q.status = :status', { status: query.status });
    }
    if (query.section_id) {
      qb.andWhere('q.section_id = :sectionId', { sectionId: query.section_id });
    }
    if (query.subject_id) {
      qb.andWhere('q.subject_id = :subjectId', { subjectId: query.subject_id });
    }

    qb.orderBy('q.created_at', 'DESC');
    const [rows, total] = await qb.getManyAndCount();
    const countOf = await this.questionCounts(rows.map((row) => row.id));
    const items = rows.map((row) => Object.assign(row, { questions_count: countOf.get(row.id) ?? 0 }));
    return { items, total };
  }

  async getTeacherQuiz(schoolId: number, teacherUserId: number, id: number): Promise<OnlineQuiz> {
    const quiz = await this.quizzes.findOne({
      where: { id, school_id: schoolId, teacher_user_id: teacherUserId },
      relations: ['questions', 'subject', 'section', 'section.school_class'],
      order: { questions: { sequence: 'ASC' } },
    });
    if (!quiz) throw AppException.notFound('Quiz not found', 'QUIZ_NOT_FOUND');
    return quiz;
  }

  async update(schoolId: number, teacherUserId: number, id: number, dto: UpdateQuizDto): Promise<OnlineQuiz> {
    const quiz = await this.quizzes.findOne({
      where: { id, school_id: schoolId, teacher_user_id: teacherUserId },
      relations: ['questions'],
    });
    if (!quiz) throw AppException.notFound('Quiz not found', 'QUIZ_NOT_FOUND');
    if (quiz.status !== 'draft' && quiz.status !== 'rejected') {
      throw AppException.badRequest('Only draft or rejected quizzes can be edited by teachers', 'QUIZ_LOCKED');
    }

    if (dto.title) quiz.title = dto.title.trim();
    if (dto.description !== undefined) quiz.description = dto.description?.trim() ?? null;
    if (dto.instructions !== undefined) quiz.instructions = dto.instructions?.trim() ?? null;
    if (dto.duration_minutes) quiz.duration_minutes = dto.duration_minutes;
    if (dto.start_at) quiz.start_at = new Date(dto.start_at);
    if (dto.end_at) quiz.end_at = new Date(dto.end_at);
    if (dto.expire_on_exit !== undefined) quiz.expire_on_exit = dto.expire_on_exit;
    if (dto.require_camera !== undefined) quiz.require_camera = dto.require_camera;
    if (dto.require_microphone !== undefined) quiz.require_microphone = dto.require_microphone;
    assertSchedule(quiz.start_at, quiz.end_at, quiz.duration_minutes, Boolean(dto.start_at));

    if (dto.questions && dto.questions.length) {
      const normalized = dto.questions.map((q, index) => normalizeQuestion(q, index));
      await this.questions.delete({ quiz_id: id });
      const questionEntities = dto.questions.map((q, idx) =>
        this.questions.create({
          quiz_id: id,
          sequence: q.sequence ?? idx + 1,
          question_text: q.question_text.trim(),
          ...normalized[idx],
          explanation: q.explanation?.trim() ?? null,
          marks: q.marks ?? 1,
        }),
      );
      quiz.questions = await this.questions.save(questionEntities);
      quiz.total_marks = dto.questions.reduce((sum, q) => sum + (q.marks ?? 1), 0);
      if (dto.pass_marks !== undefined) quiz.pass_marks = dto.pass_marks;
      assertPassMarks(quiz.pass_marks, quiz.total_marks);
    } else if (dto.pass_marks !== undefined) {
      assertPassMarks(dto.pass_marks, Number(quiz.total_marks));
      quiz.pass_marks = dto.pass_marks;
    }

    quiz.status = 'draft';
    quiz.rejection_reason = null;
    return this.quizzes.save(quiz);
  }

  async submitForApproval(schoolId: number, teacherUserId: number, id: number): Promise<OnlineQuiz> {
    const quiz = await this.quizzes.findOne({
      where: { id, school_id: schoolId, teacher_user_id: teacherUserId },
      relations: ['questions'],
    });
    if (!quiz) throw AppException.notFound('Quiz not found', 'QUIZ_NOT_FOUND');
    if (!quiz.questions || quiz.questions.length === 0) {
      throw AppException.badRequest('Cannot submit quiz without questions', 'QUIZ_HAS_NO_QUESTIONS');
    }
    assertPassMarks(quiz.pass_marks, Number(quiz.total_marks));
    quiz.status = 'pending_approval';
    quiz.rejection_reason = null;
    return this.quizzes.save(quiz);
  }

  async delete(schoolId: number, teacherUserId: number, id: number): Promise<void> {
    const quiz = await this.quizzes.findOne({
      where: { id, school_id: schoolId, teacher_user_id: teacherUserId },
    });
    if (!quiz) throw AppException.notFound('Quiz not found', 'QUIZ_NOT_FOUND');
    if (quiz.status !== 'draft' && quiz.status !== 'rejected') {
      throw AppException.badRequest('Only draft or rejected quizzes can be deleted', 'QUIZ_LOCKED');
    }
    await this.quizzes.delete(id);
  }

  async listAdminQuizzes(schoolId: number, query: QuizQueryDto) {
    const qb = this.quizzes
      .createQueryBuilder('q')
      .leftJoinAndSelect('q.subject', 'sub')
      .leftJoinAndSelect('q.section', 'sec')
      .leftJoinAndSelect('sec.school_class', 'cls')
      .leftJoinAndSelect('q.teacher', 't')
      .leftJoinAndSelect('q.approved_by', 'ap')
      .where('q.school_id = :schoolId', { schoolId });

    if (query.status) {
      qb.andWhere('q.status = :status', { status: query.status });
    }
    if (query.section_id) {
      qb.andWhere('q.section_id = :sectionId', { sectionId: query.section_id });
    }
    if (query.subject_id) {
      qb.andWhere('q.subject_id = :subjectId', { subjectId: query.subject_id });
    }
    if (query.search) {
      qb.andWhere('(q.title ILIKE :search OR sub.name ILIKE :search)', { search: `%${query.search}%` });
    }

    qb.orderBy('q.created_at', 'DESC');
    const [rows, total] = await qb.getManyAndCount();
    const ids = rows.map((row) => row.id);
    const [counts, attempts] = await Promise.all([this.questionCounts(ids), this.attemptCounts(ids)]);
    return {
      items: rows.map((row) => presentAdminQuiz(row, counts.get(row.id) ?? 0, attempts.get(row.id) ?? 0)),
      total,
    };
  }

  private async attemptCounts(quizIds: number[]): Promise<Map<number, number>> {
    if (!quizIds.length) return new Map();
    const rows: { quiz_id: number; count: string }[] = await this.dataSource.query(
      `SELECT quiz_id, COUNT(*) AS count FROM quiz_submissions WHERE quiz_id = ANY($1) GROUP BY quiz_id`,
      [quizIds],
    );
    return new Map(rows.map((row) => [Number(row.quiz_id), Number(row.count)]));
  }

  private async questionCounts(quizIds: number[]): Promise<Map<number, number>> {
    if (!quizIds.length) return new Map();
    const rows: { quiz_id: number; count: string }[] = await this.dataSource.query(
      `SELECT quiz_id, COUNT(*) AS count FROM quiz_questions WHERE quiz_id = ANY($1) GROUP BY quiz_id`,
      [quizIds],
    );
    return new Map(rows.map((row) => [Number(row.quiz_id), Number(row.count)]));
  }

  async getAdminQuiz(schoolId: number, id: number) {
    const quiz = await this.quizzes.findOne({
      where: { id, school_id: schoolId },
      relations: ['questions', 'subject', 'section', 'section.school_class', 'teacher', 'approved_by'],
      order: { questions: { sequence: 'ASC' } },
    });
    if (!quiz) throw AppException.notFound('Quiz not found', 'QUIZ_NOT_FOUND');
    return presentAdminQuiz(quiz, undefined, (await this.attemptCounts([quiz.id])).get(quiz.id) ?? 0);
  }

  async adminDelete(schoolId: number, id: number): Promise<{ deleted: true; attempts: number }> {
    const quiz = await this.quizzes.findOne({ where: { id, school_id: schoolId } });
    if (!quiz) throw AppException.notFound('Quiz not found', 'QUIZ_NOT_FOUND');
    const attempts = (await this.attemptCounts([id])).get(id) ?? 0;
    await this.quizzes.softDelete(id);
    this.logger.warn(`Quiz ${id} "${quiz.title}" (${quiz.status}) deleted by an admin with ${attempts} attempt(s)`);
    return { deleted: true, attempts };
  }

  async adminUpdate(schoolId: number, id: number, dto: UpdateQuizDto): Promise<OnlineQuiz> {
    const quiz = await this.quizzes.findOne({
      where: { id, school_id: schoolId },
      relations: ['questions'],
    });
    if (!quiz) throw AppException.notFound('Quiz not found', 'QUIZ_NOT_FOUND');

    if (dto.title) quiz.title = dto.title.trim();
    if (dto.description !== undefined) quiz.description = dto.description?.trim() ?? null;
    if (dto.instructions !== undefined) quiz.instructions = dto.instructions?.trim() ?? null;
    if (dto.duration_minutes) quiz.duration_minutes = dto.duration_minutes;
    if (dto.start_at) quiz.start_at = new Date(dto.start_at);
    if (dto.end_at) quiz.end_at = new Date(dto.end_at);
    if (dto.expire_on_exit !== undefined) quiz.expire_on_exit = dto.expire_on_exit;
    if (dto.require_camera !== undefined) quiz.require_camera = dto.require_camera;
    if (dto.require_microphone !== undefined) quiz.require_microphone = dto.require_microphone;
    if (quiz.end_at <= quiz.start_at) {
      throw AppException.badRequest('End time must be after start time', 'INVALID_QUIZ_DATES');
    }

    if (dto.questions && dto.questions.length) {
      const attempts = await this.submissions.count({ where: { quiz_id: id } });
      if (attempts > 0) {
        throw AppException.conflict(
          'Students have already attempted this quiz: questions cannot change',
          'QUIZ_HAS_ATTEMPTS',
        );
      }
      const normalized = dto.questions.map((q, index) => normalizeQuestion(q, index));
      await this.questions.delete({ quiz_id: id });
      const questionEntities = dto.questions.map((q, idx) =>
        this.questions.create({
          quiz_id: id,
          sequence: q.sequence ?? idx + 1,
          question_text: q.question_text.trim(),
          ...normalized[idx],
          explanation: q.explanation?.trim() ?? null,
          marks: q.marks ?? 1,
        }),
      );
      quiz.questions = await this.questions.save(questionEntities);
      quiz.total_marks = dto.questions.reduce((sum, q) => sum + (q.marks ?? 1), 0);
      if (dto.pass_marks !== undefined) quiz.pass_marks = dto.pass_marks;
      assertPassMarks(quiz.pass_marks, quiz.total_marks);
    } else if (dto.pass_marks !== undefined) {
      assertPassMarks(dto.pass_marks, Number(quiz.total_marks));
      quiz.pass_marks = dto.pass_marks;
    }

    return this.quizzes.save(quiz);
  }

  async approve(schoolId: number, adminUserId: number, id: number): Promise<OnlineQuiz> {
    const quiz = await this.quizzes.findOne({
      where: { id, school_id: schoolId },
      relations: ['questions', 'subject', 'section', 'section.school_class'],
    });
    if (!quiz) throw AppException.notFound('Quiz not found', 'QUIZ_NOT_FOUND');
    if (quiz.status === 'approved') {
      throw AppException.conflict('Quiz is already approved', 'QUIZ_ALREADY_APPROVED');
    }
    if (quiz.status !== 'pending_approval') {
      throw AppException.conflict('Only a quiz waiting for approval can be approved', 'QUIZ_NOT_PENDING');
    }
    if (!quiz.questions || quiz.questions.length === 0) {
      throw AppException.badRequest('Cannot approve quiz without questions', 'QUIZ_HAS_NO_QUESTIONS');
    }
    assertPassMarks(quiz.pass_marks, Number(quiz.total_marks));
    if (quiz.end_at.getTime() <= Date.now()) {
      throw AppException.badRequest(
        'The quiz window has already closed: move the end time first',
        'QUIZ_WINDOW_PASSED',
      );
    }

    quiz.status = 'approved';
    quiz.approved_by_user_id = adminUserId;
    quiz.approved_at = new Date();
    quiz.rejection_reason = null;

    const saved = await this.quizzes.save(quiz);

    this.notifyParentsOfQuiz(schoolId, saved).catch((err) =>
      this.logger.warn(`Failed to notify parents of quiz ${id}: ${err.message}`),
    );

    return saved;
  }

  async reject(schoolId: number, adminUserId: number, id: number, dto: RejectQuizDto): Promise<OnlineQuiz> {
    const quiz = await this.quizzes.findOne({
      where: { id, school_id: schoolId },
    });
    if (!quiz) throw AppException.notFound('Quiz not found', 'QUIZ_NOT_FOUND');
    if (quiz.status !== 'pending_approval') {
      throw AppException.conflict('Only a quiz waiting for approval can be rejected', 'QUIZ_NOT_PENDING');
    }
    quiz.status = 'rejected';
    quiz.rejection_reason = dto.reason.trim();
    return this.quizzes.save(quiz);
  }

  private async notifyParentsOfQuiz(schoolId: number, quiz: OnlineQuiz): Promise<void> {
    const rows: { user_id: number; student_id: number }[] = await this.dataSource.query(
      `SELECT DISTINCT g.user_id, sg.student_id FROM guardians g
       JOIN student_guardians sg ON sg.guardian_id = g.id
       JOIN student_enrollments se ON se.student_id = sg.student_id
       WHERE se.section_id = $1 AND se.academic_year_id = $2 AND g.user_id IS NOT NULL`,
      [quiz.section_id, quiz.academic_year_id],
    );
    if (!rows.length) return;
    const studentIds = [...new Set(rows.map((r) => Number(r.student_id)))];

    const startDateStr = new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(quiz.start_at);

    const startTimeStr = new Intl.DateTimeFormat('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(quiz.start_at);

    for (const studentId of studentIds) {
      await this.notifications.dispatch({
        template: TEMPLATES.QUIZ_SCHEDULED,
        audience: { user_ids: rows.filter((r) => Number(r.student_id) === studentId).map((r) => Number(r.user_id)) },
        data: {
          subject: quiz.subject?.name ?? 'Subject',
          title: quiz.title,
          date: startDateStr,
          time: startTimeStr,
          duration: String(quiz.duration_minutes),
          quiz_id: String(quiz.id),
          student_id: String(studentId),
        },
      });
    }
  }

  async listStudentQuizzes(schoolId: number, studentId: number) {
    const enrollment = await this.dataSource.query(
      `SELECT e.section_id, e.academic_year_id FROM student_enrollments e
       JOIN academic_years y ON y.id = e.academic_year_id AND y.is_current = true
       WHERE e.student_id = $1 LIMIT 1`,
      [studentId],
    );
    if (!enrollment.length) return [];
    const sectionId = Number(enrollment[0].section_id);

    const quizzes = await this.quizzes
      .createQueryBuilder('q')
      .leftJoinAndSelect('q.subject', 'sub')
      .leftJoinAndSelect('q.section', 'sec')
      .loadRelationCountAndMap('q.questions_count', 'q.questions')
      .where('q.school_id = :schoolId', { schoolId })
      .andWhere('q.section_id = :sectionId', { sectionId })
      .andWhere('q.status = :status', { status: 'approved' })
      .orderBy('q.start_at', 'DESC')
      .getMany();

    const submissions = await this.submissions.find({
      where: { school_id: schoolId, student_id: studentId, quiz_id: In(quizzes.map((q) => q.id)) },
    });
    const subMap = new Map(submissions.map((s) => [s.quiz_id, s]));

    const now = new Date();

    return quizzes.map((q) => {
      const sub = subMap.get(q.id);
      let studentState = 'upcoming';

      if (sub && isFinished(sub.status)) {
        studentState = 'completed';
      } else if (now > q.end_at) {
        studentState = 'expired';
      } else if (now >= q.start_at && now <= q.end_at) {
        if (sub && sub.status === 'in_progress') {
          const elapsed = (now.getTime() - new Date(sub.started_at).getTime()) / 1000;
          if (elapsed > q.duration_minutes * 60) {
            studentState = 'completed';
          } else {
            studentState = 'in_progress';
          }
        } else {
          studentState = 'active';
        }
      }

      return {
        id: q.id,
        title: q.title,
        description: q.description,
        instructions: q.instructions,
        subject: { id: q.subject_id, name: q.subject?.name ?? '' },
        total_marks: Number(q.total_marks),
        pass_marks: passMarksOf(q),
        pass_percentage: passPercentage(q),
        questions_count: (q as OnlineQuiz & { questions_count?: number }).questions_count ?? 0,
        duration_minutes: q.duration_minutes,
        start_at: q.start_at,
        end_at: q.end_at,
        status: q.status,
        expire_on_exit: q.expire_on_exit,
        require_camera: q.require_camera,
        require_microphone: q.require_microphone,
        student_state: studentState,
        submission: sub
          ? {
              status: sub.status,
              score: Number(sub.score),
              percentage: Number(sub.percentage),
              passed: sub.passed,
              started_at: sub.started_at,
              submitted_at: sub.submitted_at,
              auto_submitted: sub.auto_submitted,
            }
          : null,
      };
    });
  }

  async startQuiz(schoolId: number, studentId: number, quizId: number) {
    const quiz = await this.quizzes.findOne({
      where: { id: quizId, school_id: schoolId, status: 'approved' },
      relations: ['questions', 'subject'],
      order: { questions: { sequence: 'ASC' } },
    });
    if (!quiz) throw AppException.notFound('Quiz not found or not published', 'QUIZ_NOT_FOUND');

    const enrolled = await this.dataSource.query(
      `SELECT 1 FROM student_enrollments WHERE student_id = $1 AND section_id = $2 AND academic_year_id = $3 LIMIT 1`,
      [studentId, quiz.section_id, quiz.academic_year_id],
    );
    if (!enrolled.length) throw AppException.notFound('Quiz not found or not published', 'QUIZ_NOT_FOUND');

    const now = new Date();
    if (now < quiz.start_at) {
      throw AppException.badRequest('Quiz has not started yet', 'QUIZ_NOT_STARTED');
    }
    if (now > quiz.end_at) {
      throw AppException.badRequest('Quiz has already ended', 'QUIZ_EXPIRED');
    }

    let sub = await this.submissions.findOne({
      where: { quiz_id: quizId, student_id: studentId },
    });

    if (sub && isFinished(sub.status)) {
      throw AppException.conflict('You have already completed this quiz', 'QUIZ_ALREADY_COMPLETED');
    }

    if (!sub) {
      sub = this.submissions.create({
        school_id: schoolId,
        quiz_id: quizId,
        student_id: studentId,
        status: 'in_progress',
        started_at: now,
        total_marks: quiz.total_marks,
      });
      sub = await this.submissions.save(sub);
    }

    const elapsedSeconds = Math.floor((now.getTime() - new Date(sub.started_at).getTime()) / 1000);
    const maxSecondsByDuration = quiz.duration_minutes * 60 - elapsedSeconds;
    const maxSecondsByEndTime = Math.floor((quiz.end_at.getTime() - now.getTime()) / 1000);
    const remainingSeconds = Math.max(0, Math.min(maxSecondsByDuration, maxSecondsByEndTime));

    if (remainingSeconds <= 0) {
      sub.status = 'completed';
      sub.submitted_at = now;
      sub.auto_submitted = true;
      await this.submissions.save(sub);
      throw AppException.badRequest('Quiz duration has expired', 'QUIZ_EXPIRED');
    }

    const questionsWithoutAnswers = (quiz.questions ?? []).map((q) => ({
      id: q.id,
      sequence: q.sequence,
      question_text: q.question_text,
      question_type: q.question_type,
      options: q.options,
      marks: Number(q.marks),
    }));

    return {
      quiz: {
        id: quiz.id,
        title: quiz.title,
        subject: { id: quiz.subject_id, name: quiz.subject?.name ?? '' },
        instructions: quiz.instructions,
        duration_minutes: quiz.duration_minutes,
        total_marks: Number(quiz.total_marks),
        pass_marks: passMarksOf(quiz),
        pass_percentage: passPercentage(quiz),
        expire_on_exit: quiz.expire_on_exit,
        require_camera: quiz.require_camera,
        require_microphone: quiz.require_microphone,
      },
      submission: {
        id: sub.id,
        started_at: sub.started_at,
        remaining_seconds: remainingSeconds,
      },
      questions: questionsWithoutAnswers,
    };
  }

  async submitQuiz(schoolId: number, studentId: number, quizId: number, dto: SubmitQuizDto) {
    const quiz = await this.quizzes.findOne({
      where: { id: quizId, school_id: schoolId },
      relations: ['questions', 'subject'],
    });
    if (!quiz) throw AppException.notFound('Quiz not found', 'QUIZ_NOT_FOUND');

    const sub = await this.submissions.findOne({
      where: { quiz_id: quizId, student_id: studentId },
    });
    if (!sub) throw AppException.badRequest('Quiz has not been started yet', 'QUIZ_NOT_STARTED');
    if (isFinished(sub.status)) {
      throw AppException.conflict('Quiz has already been submitted', 'QUIZ_ALREADY_COMPLETED');
    }

    const questionMap = new Map((quiz.questions ?? []).map((q) => [q.id, q]));
    let totalScore = 0;
    const answerEntities: QuizAnswer[] = [];
    const deadline =
      Math.min(new Date(sub.started_at).getTime() + quiz.duration_minutes * 60000, quiz.end_at.getTime()) +
      SUBMIT_GRACE_MS;
    const tooLate = Date.now() > deadline;

    for (const ans of tooLate ? [] : dto.answers) {
      const q = questionMap.get(ans.question_id);
      if (!q) continue;

      const isCorrect = isCorrectAnswer(q.correct_option, ans.selected_option);

      const marksAwarded = isCorrect ? Number(q.marks) : 0;
      totalScore += marksAwarded;

      answerEntities.push(
        this.answers.create({
          submission_id: sub.id,
          question_id: q.id,
          selected_option: ans.selected_option ? answerKeys(ans.selected_option).join(',') || null : null,
          is_correct: isCorrect,
          marks_awarded: marksAwarded,
        }),
      );
    }

    if (answerEntities.length) {
      await this.answers.save(answerEntities);
    }

    const totalMarks = Number(quiz.total_marks);
    const percentage = totalMarks > 0 ? Math.round((totalScore / totalMarks) * 1000) / 10 : 0;
    const passed = quiz.pass_marks === null ? null : totalScore >= Number(quiz.pass_marks);
    const isExitTerminated = dto.exit_terminated ?? false;

    sub.score = totalScore;
    sub.percentage = percentage;
    sub.passed = passed;
    sub.status = isExitTerminated ? 'expired' : 'completed';
    sub.submitted_at = new Date();
    sub.auto_submitted = tooLate || (dto.auto_submitted ?? isExitTerminated);
    sub.exit_terminated = isExitTerminated;

    const savedSub = await this.submissions.save(sub);

    this.notifyParentOfQuizResult(schoolId, studentId, quiz, savedSub).catch((err) =>
      this.logger.warn(`Failed to notify parent of quiz result: ${err.message}`),
    );

    return {
      submission_id: savedSub.id,
      score: totalScore,
      total_marks: totalMarks,
      percentage,
      passed,
      submitted_at: savedSub.submitted_at,
      auto_submitted: savedSub.auto_submitted,
      exit_terminated: savedSub.exit_terminated,
      status: savedSub.status,
    };
  }

  private async notifyParentOfQuizResult(
    schoolId: number,
    studentId: number,
    quiz: OnlineQuiz,
    sub: QuizSubmission,
  ): Promise<void> {
    const rows: { user_id: number; student_name: string }[] = await this.dataSource.query(
      `SELECT DISTINCT g.user_id, concat_ws(' ', s.first_name, s.last_name) AS student_name FROM guardians g
       JOIN student_guardians sg ON sg.guardian_id = g.id
       JOIN students s ON s.id = sg.student_id
       WHERE s.id = $1 AND g.user_id IS NOT NULL`,
      [studentId],
    );

    const userIds = rows.map((r) => Number(r.user_id));
    if (!userIds.length) return;
    const studentName = rows[0]?.student_name ?? 'Student';

    await this.notifications.dispatch({
      template: TEMPLATES.QUIZ_RESULT_AVAILABLE,
      audience: { user_ids: userIds },
      data: {
        student: studentName,
        subject: quiz.subject?.name ?? 'Subject',
        title: quiz.title,
        score: String(sub.score),
        total: String(sub.total_marks),
        percent: String(sub.percentage),
        quiz_id: String(quiz.id),
        student_id: String(studentId),
      },
    });
  }

  async getQuizResult(schoolId: number, studentId: number, quizId: number) {
    const quiz = await this.quizzes.findOne({
      where: { id: quizId, school_id: schoolId },
      relations: ['questions', 'subject'],
      order: { questions: { sequence: 'ASC' } },
    });
    if (!quiz) throw AppException.notFound('Quiz not found', 'QUIZ_NOT_FOUND');

    const sub = await this.submissions.findOne({
      where: { quiz_id: quizId, student_id: studentId },
      relations: ['answers'],
    });
    if (!sub || !isFinished(sub.status)) {
      throw AppException.badRequest('Quiz has not been completed', 'QUIZ_NOT_COMPLETED');
    }

    const answerMap = new Map((sub.answers ?? []).map((a) => [a.question_id, a]));

    const answersVisible = new Date() >= quiz.end_at;
    const reviewQuestions = (quiz.questions ?? []).map((q) => {
      const ans = answerMap.get(q.id);
      return {
        id: q.id,
        sequence: q.sequence,
        question_text: q.question_text,
        question_type: q.question_type,
        options: q.options,
        correct_option: answersVisible ? q.correct_option : null,
        explanation: answersVisible ? q.explanation : null,
        marks: Number(q.marks),
        student_answer: ans ? ans.selected_option : null,
        is_correct: answersVisible ? (ans ? ans.is_correct : false) : null,
        marks_awarded: ans ? Number(ans.marks_awarded) : 0,
      };
    });

    return {
      quiz: {
        id: quiz.id,
        title: quiz.title,
        subject: { id: quiz.subject_id, name: quiz.subject?.name ?? '' },
        end_at: quiz.end_at,
        total_marks: Number(quiz.total_marks),
        pass_marks: passMarksOf(quiz),
        expire_on_exit: quiz.expire_on_exit,
        require_camera: quiz.require_camera,
        require_microphone: quiz.require_microphone,
      },
      submission: {
        id: sub.id,
        score: Number(sub.score),
        total_marks: Number(sub.total_marks),
        percentage: Number(sub.percentage),
        passed: sub.passed,
        started_at: sub.started_at,
        submitted_at: sub.submitted_at,
        auto_submitted: sub.auto_submitted,
      },
      answers_visible: answersVisible,
      questions: reviewQuestions,
    };
  }

  async childSchoolForParent(userId: number, studentId: number): Promise<number> {
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

  async getQuizAnalytics(schoolId: number, quizId: number) {
    const quiz = await this.quizzes.findOne({
      where: { id: quizId, school_id: schoolId },
      relations: ['questions', 'subject', 'section', 'section.school_class'],
      order: { questions: { sequence: 'ASC' } },
    });
    if (!quiz) throw AppException.notFound('Quiz not found', 'QUIZ_NOT_FOUND');

    const enrolledStudents: { id: number; full_name: string; roll_number: string }[] = await this.dataSource.query(
      `SELECT s.id, concat_ws(' ', s.first_name, s.last_name) AS full_name, e.roll_no AS roll_number FROM students s
       JOIN student_enrollments e ON e.student_id = s.id
       WHERE e.section_id = $1 AND e.academic_year_id = $2
       ORDER BY e.roll_no ASC, full_name ASC`,
      [quiz.section_id, quiz.academic_year_id],
    );

    const subs = await this.submissions.find({
      where: { quiz_id: quizId },
      relations: ['student'],
    });
    const subMap = new Map(subs.map((s) => [s.student_id, s]));

    const answers = await this.answers
      .createQueryBuilder('ans')
      .innerJoin('ans.submission', 'sub')
      .where('sub.quiz_id = :quizId', { quizId })
      .getMany();

    const now = new Date();
    let completedCount = 0;
    let inProgressCount = 0;
    let expiredCount = 0;
    let attendedCount = 0;
    let totalScoreSum = 0;
    let highestScore = 0;

    const studentRoster = enrolledStudents.map((st) => {
      const sub = subMap.get(st.id);
      let status = 'not_started';
      const attendance = !sub ? 'not_attended' : isFinished(sub.status) ? 'attended' : 'in_progress';
      if (attendance === 'attended') attendedCount++;
      if (sub) {
        status = sub.status;
        if (sub.status === 'completed') {
          completedCount++;
          totalScoreSum += Number(sub.score);
          if (Number(sub.score) > highestScore) highestScore = Number(sub.score);
        } else if (sub.status === 'in_progress') {
          inProgressCount++;
        }
      } else if (now > quiz.end_at) {
        status = 'expired';
        expiredCount++;
      }

      return {
        student_id: st.id,
        full_name: st.full_name,
        roll_number: st.roll_number,
        status,
        attendance,
        score: sub ? Number(sub.score) : 0,
        percentage: sub ? Number(sub.percentage) : 0,
        passed: sub ? sub.passed : null,
        submitted_at: sub ? sub.submitted_at : null,
        auto_submitted: sub ? sub.auto_submitted : false,
      };
    });

    const averageScore = completedCount > 0 ? Math.round((totalScoreSum / completedCount) * 10) / 10 : 0;

    const questionStats = (quiz.questions ?? []).map((q) => {
      const qAnswers = answers.filter((a) => a.question_id === q.id);
      const correctCount = qAnswers.filter((a) => a.is_correct).length;
      const totalAnswers = qAnswers.length;
      const accuracyPercent = totalAnswers > 0 ? Math.round((correctCount / totalAnswers) * 100) : 0;

      return {
        question_id: q.id,
        sequence: q.sequence,
        question_text: q.question_text,
        correct_option: q.correct_option,
        total_answers: totalAnswers,
        correct_count: correctCount,
        accuracy_percent: accuracyPercent,
      };
    });

    return {
      quiz: {
        id: quiz.id,
        title: quiz.title,
        status: quiz.status,
        subject: quiz.subject?.name,
        class_section: `${quiz.section?.school_class?.name ?? ''} - ${quiz.section?.name ?? ''}`,
        class_name: quiz.section?.school_class?.name ?? '',
        section_name: quiz.section?.name ?? '',
        total_marks: Number(quiz.total_marks),
        pass_marks: passMarksOf(quiz),
        duration_minutes: quiz.duration_minutes,
        start_at: quiz.start_at,
        end_at: quiz.end_at,
      },
      summary: {
        total_enrolled: enrolledStudents.length,
        attended_count: attendedCount,
        not_attended_count: enrolledStudents.length - attendedCount - inProgressCount,
        completed_count: completedCount,
        in_progress_count: inProgressCount,
        expired_count: expiredCount,
        average_score: averageScore,
        highest_score: highestScore,
        pass_percent:
          quiz.pass_marks === null
            ? null
            : completedCount > 0
              ? Math.round((studentRoster.filter((r) => r.passed).length / completedCount) * 100)
              : 0,
      },
      students: studentRoster,
      questions: questionStats,
    };
  }
}

function isFinished(status: string): boolean {
  return status === 'completed' || status === 'expired';
}

const SCHEDULE_GRACE_MS = 5 * 60 * 1000;
const SUBMIT_GRACE_MS = 2 * 60 * 1000;

function assertSchedule(start: Date, end: Date, durationMinutes: number, checkStart: boolean): void {
  if (end <= start) {
    throw AppException.badRequest('End time must be after start time', 'INVALID_QUIZ_DATES');
  }
  if (checkStart && start.getTime() < Date.now() - SCHEDULE_GRACE_MS) {
    throw AppException.badRequest('The quiz cannot start in the past', 'QUIZ_START_IN_PAST');
  }
  if ((end.getTime() - start.getTime()) / 60000 < durationMinutes) {
    throw AppException.badRequest(
      'The time window is shorter than the quiz duration: extend the end time or shorten the duration',
      'QUIZ_WINDOW_TOO_SHORT',
    );
  }
}
