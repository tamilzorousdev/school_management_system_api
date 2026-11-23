import { Test, TestingModule } from '@nestjs/testing';
import { AuthUser } from '@app/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AssignmentsService } from '../staff/assignments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OnlineQuiz } from './entities/online-quiz.entity';
import { QuizAnswer } from './entities/quiz-answer.entity';
import { QuizQuestion } from './entities/quiz-question.entity';
import { QuizSubmission } from './entities/quiz-submission.entity';
import { QuizzesService } from './quizzes.service';

const OPENS = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const CLOSES = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();

describe('QuizzesService', () => {
  let service: QuizzesService;

  const mockQuizRepo = {
    softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
    create: jest.fn().mockImplementation((dto) => ({ id: 1, ...dto })),
    save: jest.fn().mockImplementation((quiz) => Promise.resolve({ id: 1, ...quiz })),
    findOne: jest.fn(),
    find: jest.fn(),
    createQueryBuilder: jest.fn(),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  };

  const mockQuestionRepo = {
    create: jest.fn().mockImplementation((dto) => ({ id: 10, ...dto })),
    save: jest.fn().mockImplementation((q) => Promise.resolve(q)),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  };

  const mockSubmissionRepo = {
    create: jest.fn().mockImplementation((dto) => ({ id: 100, ...dto })),
    save: jest.fn().mockImplementation((sub) => Promise.resolve({ id: 100, ...sub })),
    findOne: jest.fn(),
    find: jest.fn(),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  };

  const mockAnswerRepo = {
    create: jest.fn().mockImplementation((dto) => ({ id: 500, ...dto })),
    save: jest.fn().mockImplementation((ans) => Promise.resolve(ans)),
    createQueryBuilder: jest.fn(),
  };

  const mockNotifications = {
    dispatch: jest.fn().mockResolvedValue(true),
  };

  const mockDataSource = {
    query: jest.fn(),
  };

  const mockAssignments = {
    teacherClasses: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuizzesService,
        { provide: getRepositoryToken(OnlineQuiz), useValue: mockQuizRepo },
        { provide: getRepositoryToken(QuizQuestion), useValue: mockQuestionRepo },
        { provide: getRepositoryToken(QuizSubmission), useValue: mockSubmissionRepo },
        { provide: getRepositoryToken(QuizAnswer), useValue: mockAnswerRepo },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: AssignmentsService, useValue: mockAssignments },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<QuizzesService>(QuizzesService);
    jest.clearAllMocks();
    mockDataSource.query.mockReset();
    mockDataSource.query.mockResolvedValue([{ id: 2 }]);
    mockAssignments.teacherClasses.mockResolvedValue([
      { section_id: 3, is_class_teacher: false, subjects: [{ id: 2, name: 'Science' }] },
    ]);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('creates a draft quiz with questions and computes total marks', async () => {
      const dto = {
        academic_year_id: 1,
        subject_id: 2,
        section_id: 3,
        title: 'Science Quiz',
        duration_minutes: 30,
        start_at: OPENS,
        end_at: CLOSES,
        questions: [
          {
            sequence: 1,
            question_text: 'What is H2O?',
            options: [
              { key: 'A', text: 'Water' },
              { key: 'B', text: 'Oxygen' },
            ],
            correct_option: 'A',
            marks: 2,
          },
        ],
      };

      const result = await service.create(1, 10, dto);
      expect(result).toBeDefined();
      expect(result.status).toBe('draft');
      expect(result.total_marks).toBe(2);
      expect(mockQuizRepo.save).toHaveBeenCalled();
      expect(mockQuestionRepo.save).toHaveBeenCalled();
    });

    it('defaults academic_year_id to the current academic year', async () => {
      mockDataSource.query.mockResolvedValueOnce([{ id: 7 }]);
      const result = await service.create(1, 10, {
        subject_id: 2,
        section_id: 3,
        title: 'Science Quiz',
        duration_minutes: 30,
        start_at: OPENS,
        end_at: CLOSES,
        questions: [
          {
            question_text: 'What is H2O?',
            options: [
              { key: 'A', text: 'Water' },
              { key: 'B', text: 'Oxygen' },
            ],
            correct_option: 'A',
          },
        ],
      });
      expect(result.academic_year_id).toBe(7);
    });

    it('rejects when no current academic year exists', async () => {
      mockDataSource.query.mockResolvedValueOnce([]);
      await expect(
        service.create(1, 10, {
          subject_id: 2,
          section_id: 3,
          title: 'Science Quiz',
          duration_minutes: 30,
          start_at: OPENS,
          end_at: CLOSES,
          questions: [],
        }),
      ).rejects.toThrow();
    });

    it('throws bad request when end time is before start time', async () => {
      const dto = {
        academic_year_id: 1,
        subject_id: 2,
        section_id: 3,
        title: 'Invalid Quiz',
        duration_minutes: 30,
        start_at: '2026-11-20T18:00:00.000Z',
        end_at: '2026-11-20T10:00:00.000Z',
        questions: [],
      };

      await expect(service.create(1, 10, dto)).rejects.toThrow();
    });
  });

  describe('create assignment rules', () => {
    const dto = {
      academic_year_id: 1,
      subject_id: 2,
      section_id: 3,
      title: 'Assigned',
      duration_minutes: 30,
      start_at: OPENS,
      end_at: CLOSES,
      questions: [
        {
          question_text: 'Q1',
          options: [
            { key: 'A', text: 'x' },
            { key: 'B', text: 'y' },
          ],
          correct_option: 'A',
        },
      ],
    };

    it('refuses a section the teacher does not teach', async () => {
      await expect(service.create(1, 10, { ...dto, section_id: 99 })).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'NOT_YOUR_SECTION' }),
      });
    });

    it('refuses a subject the teacher does not teach in that section', async () => {
      mockDataSource.query.mockResolvedValue([{ id: 7 }]);
      await expect(service.create(1, 10, { ...dto, subject_id: 7 })).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'NOT_YOUR_SUBJECT' }),
      });
    });

    it('lets the class teacher set a quiz in any subject', async () => {
      mockAssignments.teacherClasses.mockResolvedValue([{ section_id: 3, is_class_teacher: true, subjects: [] }]);
      mockDataSource.query.mockResolvedValue([{ id: 7 }]);
      await expect(service.create(1, 10, { ...dto, subject_id: 7 })).resolves.toBeDefined();
    });

    it('does not tie an admin or a permitted non-teaching staff member to their own classes', async () => {
      const admin = { id: 2, roles: ['ADMIN'], permissions: [] } as unknown as AuthUser;
      const staff = { id: 3, roles: ['STAFF'], permissions: [] } as unknown as AuthUser;
      mockDataSource.query.mockResolvedValue([{ id: 7 }]);

      await expect(service.create(1, 2, { ...dto, section_id: 99, subject_id: 7 }, admin)).resolves.toBeDefined();
      await expect(service.create(1, 3, { ...dto, section_id: 99, subject_id: 7 }, staff)).resolves.toBeDefined();
    });

    it('still ties a teacher to the classes they teach', async () => {
      const teacher = { id: 4, roles: ['TEACHER'], permissions: [] } as unknown as AuthUser;
      await expect(service.create(1, 4, { ...dto, section_id: 99 }, teacher)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'NOT_YOUR_SECTION' }),
      });
    });

    it('refuses an unknown subject', async () => {
      mockDataSource.query.mockResolvedValue([]);
      await expect(service.create(1, 10, dto)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'SUBJECT_NOT_FOUND' }),
      });
    });
  });

  describe('pass marks', () => {
    const base = {
      academic_year_id: 1,
      subject_id: 2,
      section_id: 3,
      title: 'Pass marks',
      duration_minutes: 30,
      start_at: OPENS,
      end_at: CLOSES,
      questions: [
        {
          question_text: 'Q1',
          options: [
            { key: 'A', text: 'x' },
            { key: 'B', text: 'y' },
          ],
          correct_option: 'A',
          marks: 4,
        },
      ],
    };

    it('has no pass mark unless the teacher sets one', async () => {
      const result = await service.create(1, 10, base);
      expect(result.pass_marks).toBeNull();
    });

    it('keeps the pass mark the teacher sets', async () => {
      const result = await service.create(1, 10, { ...base, pass_marks: 3 });
      expect(result.pass_marks).toBe(3);
    });

    it('refuses a pass mark above the total marks', async () => {
      await expect(service.create(1, 10, { ...base, pass_marks: 5 })).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'INVALID_PASS_MARKS' }),
      });
    });

    it('refuses to submit or approve a quiz whose pass mark is above its total marks', async () => {
      mockQuizRepo.findOne.mockResolvedValue({
        id: 1,
        status: 'pending_approval',
        total_marks: 1,
        pass_marks: 30,
        end_at: new Date(Date.now() + 60 * 60 * 1000),
        questions: [{ id: 10 }],
      });

      await expect(service.submitForApproval(1, 10, 1)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'INVALID_PASS_MARKS' }),
      });
      await expect(service.approve(1, 5, 1)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'INVALID_PASS_MARKS' }),
      });
    });

    it('does not mark a student pass or fail when the quiz has no pass mark', async () => {
      mockQuizRepo.findOne.mockResolvedValue({
        id: 1,
        total_marks: 2,
        pass_marks: null,
        duration_minutes: 30,
        end_at: new Date(Date.now() + 60 * 60 * 1000),
        questions: [{ id: 10, correct_option: 'A', marks: 2 }],
      });
      mockSubmissionRepo.findOne.mockResolvedValue({ id: 100, status: 'in_progress', started_at: new Date() });

      const res = await service.submitQuiz(1, 50, 1, { answers: [{ question_id: 10, selected_option: 'A' }] });

      expect(res.score).toBe(2);
      expect(res.percentage).toBe(100);
      expect(res.passed).toBeNull();
    });
  });

  describe('create schedule rules', () => {
    const base = { academic_year_id: 1, subject_id: 2, section_id: 3, title: 'Timing', questions: [] };

    it('rejects a quiz that starts in the past', async () => {
      await expect(
        service.create(1, 10, {
          ...base,
          duration_minutes: 30,
          start_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          end_at: CLOSES,
        }),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'QUIZ_START_IN_PAST' }) });
    });

    it('rejects a window shorter than the duration', async () => {
      await expect(
        service.create(1, 10, {
          ...base,
          duration_minutes: 60,
          start_at: OPENS,
          end_at: new Date(Date.parse(OPENS) + 30 * 60 * 1000).toISOString(),
        }),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'QUIZ_WINDOW_TOO_SHORT' }) });
    });
  });

  describe('submitForApproval and approve', () => {
    it('allows teacher to submit draft quiz with questions', async () => {
      mockQuizRepo.findOne.mockResolvedValue({
        id: 1,
        status: 'draft',
        questions: [{ id: 10, question_text: 'Q1' }],
      });

      const res = await service.submitForApproval(1, 10, 1);
      expect(res.status).toBe('pending_approval');
    });

    it('allows admin to approve quiz and dispatches parent notifications', async () => {
      mockQuizRepo.findOne.mockResolvedValue({
        id: 1,
        status: 'pending_approval',
        section_id: 3,
        academic_year_id: 1,
        title: 'Math Quiz',
        duration_minutes: 30,
        start_at: new Date(OPENS),
        end_at: new Date(CLOSES),
        subject: { name: 'Mathematics' },
        questions: [{ id: 10 }],
      });
      mockDataSource.query.mockResolvedValue([{ user_id: 99, student_id: 50 }]);

      const res = await service.approve(1, 5, 1);
      expect(res.status).toBe('approved');
      expect(res.approved_by_user_id).toBe(5);
    });

    it('refuses to approve a quiz whose window has closed', async () => {
      mockQuizRepo.findOne.mockResolvedValue({
        id: 1,
        status: 'pending_approval',
        start_at: new Date('2026-01-01T10:00:00.000Z'),
        end_at: new Date('2026-01-01T12:00:00.000Z'),
        questions: [{ id: 10 }],
      });
      await expect(service.approve(1, 5, 1)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'QUIZ_WINDOW_PASSED' }),
      });
    });

    it('refuses to approve a quiz that is not waiting for approval', async () => {
      mockQuizRepo.findOne.mockResolvedValue({ id: 1, status: 'draft', questions: [{ id: 10 }] });
      await expect(service.approve(1, 5, 1)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'QUIZ_NOT_PENDING' }),
      });
    });
  });

  describe('adminDelete', () => {
    it('deletes a live quiz and reports how many students had attempted it', async () => {
      mockQuizRepo.findOne.mockResolvedValue({ id: 5, title: 'Wrong quiz', status: 'approved' });
      mockDataSource.query.mockResolvedValue([{ quiz_id: 5, count: '3' }]);

      await expect(service.adminDelete(1, 5)).resolves.toEqual({ deleted: true, attempts: 3 });
      expect(mockQuizRepo.softDelete).toHaveBeenCalledWith(5);
    });

    it('deletes a quiz nobody attempted', async () => {
      mockQuizRepo.findOne.mockResolvedValue({ id: 6, title: 'Draft', status: 'draft' });
      mockDataSource.query.mockResolvedValue([]);

      await expect(service.adminDelete(1, 6)).resolves.toEqual({ deleted: true, attempts: 0 });
    });

    it('returns not found for a quiz of another school or one already deleted', async () => {
      mockQuizRepo.findOne.mockResolvedValue(null);

      await expect(service.adminDelete(1, 99)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'QUIZ_NOT_FOUND' }),
      });
      expect(mockQuizRepo.softDelete).not.toHaveBeenCalled();
    });
  });

  describe('reject', () => {
    it('returns a waiting quiz to the teacher with the reason', async () => {
      mockQuizRepo.findOne.mockResolvedValue({ id: 1, status: 'pending_approval' });

      const res = await service.reject(1, 5, 1, { reason: '  Question 3 is ambiguous  ' });
      expect(res.status).toBe('rejected');
      expect(res.rejection_reason).toBe('Question 3 is ambiguous');
    });

    it('refuses to reject a quiz that is not waiting for approval', async () => {
      mockQuizRepo.findOne.mockResolvedValue({ id: 1, status: 'approved' });

      await expect(service.reject(1, 5, 1, { reason: 'Too late' })).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'QUIZ_NOT_PENDING' }),
      });
    });
  });

  describe('submitQuiz', () => {
    it('evaluates answers and calculates score and percentage', async () => {
      mockQuizRepo.findOne.mockResolvedValue({
        id: 1,
        total_marks: 2,
        pass_marks: 1,
        duration_minutes: 30,
        end_at: new Date(Date.now() + 60 * 60 * 1000),
        questions: [
          {
            id: 10,
            correct_option: 'A',
            marks: 2,
          },
        ],
      });
      mockSubmissionRepo.findOne.mockResolvedValue({
        id: 100,
        status: 'in_progress',
        started_at: new Date(),
      });
      mockDataSource.query.mockResolvedValue([{ user_id: 99, student_name: 'Rahul' }]);

      const res = await service.submitQuiz(1, 50, 1, {
        answers: [{ question_id: 10, selected_option: 'A' }],
      });

      expect(res.score).toBe(2);
      expect(res.percentage).toBe(100);
      expect(res.passed).toBe(true);
    });

    it('scores nothing when the answers arrive long after the time is up', async () => {
      mockQuizRepo.findOne.mockResolvedValue({
        id: 1,
        total_marks: 2,
        pass_marks: 1,
        duration_minutes: 10,
        end_at: new Date(Date.now() + 60 * 60 * 1000),
        questions: [{ id: 10, correct_option: 'A', marks: 2 }],
      });
      mockSubmissionRepo.findOne.mockResolvedValue({
        id: 100,
        status: 'in_progress',
        started_at: new Date(Date.now() - 30 * 60 * 1000),
      });

      const res = await service.submitQuiz(1, 50, 1, {
        answers: [{ question_id: 10, selected_option: 'A' }],
      });

      expect(res.score).toBe(0);
      expect(res.auto_submitted).toBe(true);
    });
  });

  describe('adminCreate and adminDelete', () => {
    it('allows admin / principal to create an approved quiz and notify parents', async () => {
      mockQuizRepo.save.mockImplementation((quiz) => Promise.resolve({ id: 5, ...quiz }));
      mockQuizRepo.findOne.mockResolvedValue({
        id: 5,
        status: 'approved',
        total_marks: 5,
        title: 'Mid-term Science Test',
        questions: [{ id: 20 }],
      });
      mockDataSource.query.mockResolvedValue([{ user_id: 101 }]);

      const adminUser = {
        id: 2,
        school_id: 1,
        roles: ['ADMIN'],
        permissions: ['exams.manage'],
      } as unknown as AuthUser;

      const dto = {
        academic_year_id: 1,
        subject_id: 10,
        section_id: 20,
        title: 'Mid-term Science Test',
        duration_minutes: 45,
        start_at: OPENS,
        end_at: CLOSES,
        questions: [
          {
            sequence: 1,
            question_text: 'What is photosynthesis?',
            options: [
              { key: 'A', text: 'Process by which plants make food' },
              { key: 'B', text: 'Respiration in animals' },
            ],
            correct_option: 'A',
            marks: 5,
          },
        ],
      };

      const result = await service.adminCreate(1, adminUser, dto);
      expect(result).toBeDefined();
      expect(result.id).toBe(5);
      expect(result.status).toBe('approved');
      expect(mockQuizRepo.save).toHaveBeenCalled();
    });

    it('allows admin to delete a quiz without removing its records', async () => {
      mockQuizRepo.findOne.mockResolvedValue({ id: 5, school_id: 1, title: 'Wrong', status: 'approved' });
      mockDataSource.query.mockResolvedValue([]);
      await service.adminDelete(1, 5);
      expect(mockQuizRepo.softDelete).toHaveBeenCalledWith(5);
    });
  });

  describe('quiz permissions', () => {
    it('always allows admin and principal to create quizzes', async () => {
      const admin = { id: 1, roles: ['ADMIN'], permissions: [] } as unknown as AuthUser;
      const principal = { id: 2, roles: ['PRINCIPAL'], permissions: [] } as unknown as AuthUser;
      expect(await service.canUserCreateQuiz(1, admin)).toBe(true);
      expect(await service.canUserCreateQuiz(1, principal)).toBe(true);
    });

    it('allows staff in permitted_user_ids to create quizzes', async () => {
      mockDataSource.query.mockResolvedValueOnce([{ allow_all_teachers: false, permitted_user_ids: [15, 20] }]);
      const permittedStaff = { id: 20, roles: ['STAFF'], permissions: [] } as unknown as AuthUser;
      expect(await service.canUserCreateQuiz(1, permittedStaff)).toBe(true);

      mockDataSource.query.mockResolvedValueOnce([{ allow_all_teachers: false, permitted_user_ids: [15, 20] }]);
      const otherStaff = { id: 99, roles: ['STAFF'], permissions: [] } as unknown as AuthUser;
      expect(await service.canUserCreateQuiz(1, otherStaff)).toBe(false);
    });

    it('allows all teachers when allow_all_teachers is true', async () => {
      mockDataSource.query.mockResolvedValueOnce([{ allow_all_teachers: true, permitted_user_ids: [] }]);
      const teacher = { id: 45, roles: ['TEACHER'], permissions: [] } as unknown as AuthUser;
      expect(await service.canUserCreateQuiz(1, teacher)).toBe(true);
    });

    it('updates quiz permissions when requested by admin', async () => {
      mockDataSource.query
        .mockResolvedValueOnce([]) // insert query
        .mockResolvedValueOnce([{ allow_all_teachers: true, permitted_user_ids: [10] }]) // fetch perm
        .mockResolvedValueOnce([]); // fetch staff
      const admin = { id: 1, roles: ['ADMIN'], permissions: ['exams.manage'] } as unknown as AuthUser;

      const res = await service.updateQuizPermissions(1, admin, {
        allow_all_teachers: true,
        permitted_user_ids: [10],
      });
      expect(res.allow_all_teachers).toBe(true);
      expect(mockDataSource.query).toHaveBeenCalled();
    });
  });
});
