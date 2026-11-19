import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AppException } from '@app/common';
import { NotificationsService } from '../notifications/notifications.service';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import { OnlineQuiz } from './entities/online-quiz.entity';
import { QuizQuestion } from './entities/quiz-question.entity';
import { QuizSubmission } from './entities/quiz-submission.entity';
import { QuizAnswer } from './entities/quiz-answer.entity';
import { CreateQuizDto, QuizQueryDto, RejectQuizDto, SubmitQuizDto, UpdateQuizDto } from './dto/quiz.dto';

@Injectable()
export class QuizzesService {
  private readonly logger = new Logger('QuizzesService');

  constructor(
    @InjectRepository(OnlineQuiz) private readonly quizzes: Repository<OnlineQuiz>,
    @InjectRepository(QuizQuestion) private readonly questions: Repository<QuizQuestion>,
    @InjectRepository(QuizSubmission) private readonly submissions: Repository<QuizSubmission>,
    @InjectRepository(QuizAnswer) private readonly answers: Repository<QuizAnswer>,
    private readonly notifications: NotificationsService,
    private readonly dataSource: DataSource,
  ) {}

  async create(schoolId: number, teacherUserId: number, dto: CreateQuizDto): Promise<OnlineQuiz> {
    const start = new Date(dto.start_at);
    const end = new Date(dto.end_at);
    if (end <= start) {
      throw AppException.badRequest('End time must be after start time', 'INVALID_QUIZ_DATES');
    }

    const totalMarks = dto.questions.reduce((sum, q) => sum + (q.marks ?? 1), 0);
    const passMarks = dto.pass_marks !== undefined ? dto.pass_marks : Math.round(totalMarks * 0.35 * 10) / 10;

    const quiz = this.quizzes.create({
      school_id: schoolId,
      academic_year_id: dto.academic_year_id,
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
      status: 'draft',
    });

    const savedQuiz = await this.quizzes.save(quiz);

    const questionEntities = dto.questions.map((q, idx) =>
      this.questions.create({
        quiz_id: savedQuiz.id,
        sequence: q.sequence ?? idx + 1,
        question_text: q.question_text.trim(),
        options: q.options,
        correct_option: q.correct_option.trim().toUpperCase(),
        explanation: q.explanation?.trim() ?? null,
        marks: q.marks ?? 1,
      }),
    );

    savedQuiz.questions = await this.questions.save(questionEntities);
    return savedQuiz;
  }

  async listTeacherQuizzes(
    schoolId: number,
    teacherUserId: number,
    query: QuizQueryDto,
  ): Promise<{ items: OnlineQuiz[]; total: number }> {
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
    const [items, total] = await qb.getManyAndCount();
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
    if (quiz.end_at <= quiz.start_at) {
      throw AppException.badRequest('End time must be after start time', 'INVALID_QUIZ_DATES');
    }

    if (dto.questions && dto.questions.length) {
      await this.questions.delete({ quiz_id: id });
      const questionEntities = dto.questions.map((q, idx) =>
        this.questions.create({
          quiz_id: id,
          sequence: q.sequence ?? idx + 1,
          question_text: q.question_text.trim(),
          options: q.options,
          correct_option: q.correct_option.trim().toUpperCase(),
          explanation: q.explanation?.trim() ?? null,
          marks: q.marks ?? 1,
        }),
      );
      quiz.questions = await this.questions.save(questionEntities);
      quiz.total_marks = dto.questions.reduce((sum, q) => sum + (q.marks ?? 1), 0);
      quiz.pass_marks = dto.pass_marks !== undefined ? dto.pass_marks : Math.round(quiz.total_marks * 0.35 * 10) / 10;
    } else if (dto.pass_marks !== undefined) {
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

  async listAdminQuizzes(schoolId: number, query: QuizQueryDto): Promise<{ items: OnlineQuiz[]; total: number }> {
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
    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  async getAdminQuiz(schoolId: number, id: number): Promise<OnlineQuiz> {
    const quiz = await this.quizzes.findOne({
      where: { id, school_id: schoolId },
      relations: ['questions', 'subject', 'section', 'section.school_class', 'teacher', 'approved_by'],
      order: { questions: { sequence: 'ASC' } },
    });
    if (!quiz) throw AppException.notFound('Quiz not found', 'QUIZ_NOT_FOUND');
    return quiz;
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
    if (quiz.end_at <= quiz.start_at) {
      throw AppException.badRequest('End time must be after start time', 'INVALID_QUIZ_DATES');
    }

    if (dto.questions && dto.questions.length) {
      await this.questions.delete({ quiz_id: id });
      const questionEntities = dto.questions.map((q, idx) =>
        this.questions.create({
          quiz_id: id,
          sequence: q.sequence ?? idx + 1,
          question_text: q.question_text.trim(),
          options: q.options,
          correct_option: q.correct_option.trim().toUpperCase(),
          explanation: q.explanation?.trim() ?? null,
          marks: q.marks ?? 1,
        }),
      );
      quiz.questions = await this.questions.save(questionEntities);
      quiz.total_marks = dto.questions.reduce((sum, q) => sum + (q.marks ?? 1), 0);
      quiz.pass_marks = dto.pass_marks !== undefined ? dto.pass_marks : Math.round(quiz.total_marks * 0.35 * 10) / 10;
    } else if (dto.pass_marks !== undefined) {
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
    if (!quiz.questions || quiz.questions.length === 0) {
      throw AppException.badRequest('Cannot approve quiz without questions', 'QUIZ_HAS_NO_QUESTIONS');
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
    quiz.status = 'rejected';
    quiz.rejection_reason = dto.reason.trim();
    return this.quizzes.save(quiz);
  }

  private async notifyParentsOfQuiz(schoolId: number, quiz: OnlineQuiz): Promise<void> {
    const rows: { user_id: number }[] = await this.dataSource.query(
      `SELECT DISTINCT g.user_id FROM guardians g
       JOIN student_guardians sg ON sg.guardian_id = g.id
       JOIN student_enrollments se ON se.student_id = sg.student_id
       WHERE se.section_id = $1 AND se.academic_year_id = $2 AND g.user_id IS NOT NULL`,
      [quiz.section_id, quiz.academic_year_id],
    );

    const userIds = rows.map((r) => Number(r.user_id));
    if (!userIds.length) return;

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

    await this.notifications.dispatch({
      template: TEMPLATES.QUIZ_SCHEDULED,
      audience: { user_ids: userIds },
      data: {
        subject: quiz.subject?.name ?? 'Subject',
        title: quiz.title,
        date: startDateStr,
        time: startTimeStr,
        duration: String(quiz.duration_minutes),
      },
    });
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

      if (sub && sub.status === 'completed') {
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
        pass_marks: Number(q.pass_marks),
        duration_minutes: q.duration_minutes,
        start_at: q.start_at,
        end_at: q.end_at,
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

    if (sub && sub.status === 'completed') {
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
        pass_marks: Number(quiz.pass_marks),
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
    if (sub.status === 'completed') {
      throw AppException.conflict('Quiz has already been submitted', 'QUIZ_ALREADY_COMPLETED');
    }

    const questionMap = new Map((quiz.questions ?? []).map((q) => [q.id, q]));
    let totalScore = 0;
    const answerEntities: QuizAnswer[] = [];

    for (const ans of dto.answers) {
      const q = questionMap.get(ans.question_id);
      if (!q) continue;

      const isCorrect =
        ans.selected_option !== undefined &&
        ans.selected_option !== null &&
        ans.selected_option.trim().toUpperCase() === q.correct_option.trim().toUpperCase();

      const marksAwarded = isCorrect ? Number(q.marks) : 0;
      totalScore += marksAwarded;

      answerEntities.push(
        this.answers.create({
          submission_id: sub.id,
          question_id: q.id,
          selected_option: ans.selected_option ? ans.selected_option.trim().toUpperCase() : null,
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
    const passed = totalScore >= Number(quiz.pass_marks);

    sub.score = totalScore;
    sub.percentage = percentage;
    sub.passed = passed;
    sub.status = 'completed';
    sub.submitted_at = new Date();
    sub.auto_submitted = dto.auto_submitted ?? false;

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
    };
  }

  private async notifyParentOfQuizResult(
    schoolId: number,
    studentId: number,
    quiz: OnlineQuiz,
    sub: QuizSubmission,
  ): Promise<void> {
    const rows: { user_id: number; student_name: string }[] = await this.dataSource.query(
      `SELECT DISTINCT g.user_id, s.full_name AS student_name FROM guardians g
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
    if (!sub || sub.status !== 'completed') {
      throw AppException.badRequest('Quiz has not been completed', 'QUIZ_NOT_COMPLETED');
    }

    const answerMap = new Map((sub.answers ?? []).map((a) => [a.question_id, a]));

    const reviewQuestions = (quiz.questions ?? []).map((q) => {
      const ans = answerMap.get(q.id);
      return {
        id: q.id,
        sequence: q.sequence,
        question_text: q.question_text,
        options: q.options,
        correct_option: q.correct_option,
        explanation: q.explanation,
        marks: Number(q.marks),
        student_answer: ans ? ans.selected_option : null,
        is_correct: ans ? ans.is_correct : false,
        marks_awarded: ans ? Number(ans.marks_awarded) : 0,
      };
    });

    return {
      quiz: {
        id: quiz.id,
        title: quiz.title,
        subject: { id: quiz.subject_id, name: quiz.subject?.name ?? '' },
        total_marks: Number(quiz.total_marks),
        pass_marks: Number(quiz.pass_marks),
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
      questions: reviewQuestions,
    };
  }

  async getQuizAnalytics(schoolId: number, quizId: number) {
    const quiz = await this.quizzes.findOne({
      where: { id: quizId, school_id: schoolId },
      relations: ['questions', 'subject', 'section', 'section.school_class'],
      order: { questions: { sequence: 'ASC' } },
    });
    if (!quiz) throw AppException.notFound('Quiz not found', 'QUIZ_NOT_FOUND');

    const enrolledStudents: { id: number; full_name: string; roll_number: string }[] = await this.dataSource.query(
      `SELECT s.id, s.full_name, e.roll_number FROM students s
       JOIN student_enrollments e ON e.student_id = s.id
       WHERE e.section_id = $1 AND e.academic_year_id = $2
       ORDER BY e.roll_number ASC, s.full_name ASC`,
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
    let totalScoreSum = 0;
    let highestScore = 0;

    const studentRoster = enrolledStudents.map((st) => {
      const sub = subMap.get(st.id);
      let status = 'not_started';
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
        score: sub ? Number(sub.score) : 0,
        percentage: sub ? Number(sub.percentage) : 0,
        passed: sub ? sub.passed : false,
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
        total_marks: Number(quiz.total_marks),
        pass_marks: Number(quiz.pass_marks),
        duration_minutes: quiz.duration_minutes,
      },
      summary: {
        total_enrolled: enrolledStudents.length,
        completed_count: completedCount,
        in_progress_count: inProgressCount,
        expired_count: expiredCount,
        average_score: averageScore,
        highest_score: highestScore,
        pass_percent:
          completedCount > 0 ? Math.round((studentRoster.filter((r) => r.passed).length / completedCount) * 100) : 0,
      },
      students: studentRoster,
      questions: questionStats,
    };
  }
}
