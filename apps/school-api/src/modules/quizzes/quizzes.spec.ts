import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { NotificationsService } from '../notifications/notifications.service';
import { OnlineQuiz } from './entities/online-quiz.entity';
import { QuizAnswer } from './entities/quiz-answer.entity';
import { QuizQuestion } from './entities/quiz-question.entity';
import { QuizSubmission } from './entities/quiz-submission.entity';
import { QuizzesService } from './quizzes.service';

describe('QuizzesService', () => {
  let service: QuizzesService;

  const mockQuizRepo = {
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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuizzesService,
        { provide: getRepositoryToken(OnlineQuiz), useValue: mockQuizRepo },
        { provide: getRepositoryToken(QuizQuestion), useValue: mockQuestionRepo },
        { provide: getRepositoryToken(QuizSubmission), useValue: mockSubmissionRepo },
        { provide: getRepositoryToken(QuizAnswer), useValue: mockAnswerRepo },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<QuizzesService>(QuizzesService);
    jest.clearAllMocks();
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
        start_at: '2026-11-20T10:00:00.000Z',
        end_at: '2026-11-20T18:00:00.000Z',
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
        start_at: new Date('2026-11-20T10:00:00.000Z'),
        end_at: new Date('2026-11-20T18:00:00.000Z'),
        subject: { name: 'Mathematics' },
        questions: [{ id: 10 }],
      });
      mockDataSource.query.mockResolvedValue([{ user_id: 99 }]);

      const res = await service.approve(1, 5, 1);
      expect(res.status).toBe('approved');
      expect(res.approved_by_user_id).toBe(5);
    });
  });

  describe('submitQuiz', () => {
    it('evaluates answers and calculates score and percentage', async () => {
      mockQuizRepo.findOne.mockResolvedValue({
        id: 1,
        total_marks: 2,
        pass_marks: 1,
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
      });
      mockDataSource.query.mockResolvedValue([{ user_id: 99, student_name: 'Rahul' }]);

      const res = await service.submitQuiz(1, 50, 1, {
        answers: [{ question_id: 10, selected_option: 'A' }],
      });

      expect(res.score).toBe(2);
      expect(res.percentage).toBe(100);
      expect(res.passed).toBe(true);
    });
  });
});

