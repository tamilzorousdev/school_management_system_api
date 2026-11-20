import { Repository } from 'typeorm';
import { AuthUser } from '@app/common';
import { AppraisalsService, calculateRating } from './appraisals.service';
import { StaffAppraisal } from './entities/staff-appraisal.entity';
import { Staff } from './entities/staff.entity';
import { User } from '../users/entities/user.entity';

describe('AppraisalsService - calculateRating', () => {
  it('returns outstanding for score >= 4.6', () => {
    expect(calculateRating(4.8)).toBe('outstanding');
    expect(calculateRating(4.6)).toBe('outstanding');
  });

  it('returns exceeds_expectations for score >= 3.8 and < 4.6', () => {
    expect(calculateRating(4.5)).toBe('exceeds_expectations');
    expect(calculateRating(3.8)).toBe('exceeds_expectations');
  });

  it('returns meets_expectations for score >= 3.0 and < 3.8', () => {
    expect(calculateRating(3.5)).toBe('meets_expectations');
    expect(calculateRating(3.0)).toBe('meets_expectations');
  });

  it('returns needs_improvement for score >= 2.0 and < 3.0', () => {
    expect(calculateRating(2.5)).toBe('needs_improvement');
    expect(calculateRating(2.0)).toBe('needs_improvement');
  });

  it('returns unsatisfactory for score < 2.0', () => {
    expect(calculateRating(1.8)).toBe('unsatisfactory');
    expect(calculateRating(1.0)).toBe('unsatisfactory');
  });
});

describe('AppraisalsService - teacher hike requests & lifecycle', () => {
  let service: AppraisalsService;
  let appraisalsRepo: Partial<Repository<StaffAppraisal>>;
  let staffRepo: Partial<Repository<Staff>>;
  let usersRepo: Partial<Repository<User>>;

  const mockReviewer: AuthUser = {
    id: 1,
    session_id: 1,
    school_id: 1,
    name: 'Principal Skinner',
    mobile: '9000000001',
    roles: ['PRINCIPAL'],
    permissions: [],
  };

  beforeEach(() => {
    appraisalsRepo = {
      create: jest.fn().mockImplementation((val) => val),
      save: jest.fn().mockImplementation((val) => Promise.resolve({ id: 10, created_at: new Date(), ...val })),
      findOne: jest.fn(),
      find: jest.fn(),
    };
    staffRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 99, user_id: 229, employee_no: 'EMP-01', designation: 'Teacher' }),
      find: jest.fn().mockResolvedValue([{ id: 99, user_id: 229, employee_no: 'EMP-01', designation: 'Teacher' }]),
    };
    usersRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 229, name: 'Alice Teacher' }),
      find: jest.fn().mockResolvedValue([
        { id: 229, name: 'Alice Teacher' },
        { id: 1, name: 'Principal Skinner' },
      ]),
    };

    service = new AppraisalsService(
      appraisalsRepo as Repository<StaffAppraisal>,
      staffRepo as Repository<Staff>,
      usersRepo as Repository<User>,
    );
  });

  it('creates an appraisal preserving expected_increment_percent and hike_justification', async () => {
    const res = await service.create(1, mockReviewer, {
      academic_year_id: 2,
      staff_id: 99,
      period: '2026-27 Annual Review',
      review_date: '2026-10-25',
      teaching_effectiveness: 4.8,
      student_outcomes: 4.6,
      classroom_management: 4.5,
      professional_conduct: 4.9,
      extracurricular_contribution: 4.2,
      expected_increment_percent: 12.0,
      hike_justification: 'Completed M.Ed and produced 100% board exam pass rate',
      recommendation: 'increment',
      increment_percent: 10.0,
    });

    expect(res.expected_increment_percent).toBe(12.0);
    expect(res.hike_justification).toBe('Completed M.Ed and produced 100% board exam pass rate');
    expect(res.overall_rating).toBe('outstanding');
    expect(res.overall_score).toBe(4.6);
    expect(res.status).toBe('draft');
  });

  it('allows a teacher to submit hike request moving status to submitted', async () => {
    const existing = {
      id: 10,
      school_id: 1,
      user_id: 229,
      staff_id: 99,
      reviewer_user_id: 1,
      academic_year_id: 2,
      status: 'draft' as const,
      period: '2026-27 Annual Review',
      review_date: '2026-10-25',
      teaching_effectiveness: 4.0,
      student_outcomes: 4.0,
      classroom_management: 4.0,
      professional_conduct: 4.0,
      extracurricular_contribution: 4.0,
      overall_score: 4.0,
      overall_rating: 'exceeds_expectations' as const,
      recommendation: 'increment' as const,
      increment_percent: 0.0,
      created_at: new Date(),
    };

    (appraisalsRepo.findOne as jest.Mock).mockResolvedValue(existing);

    const res = await service.submitHikeRequest(1, 229, 10, {
      expected_increment_percent: 15.0,
      hike_justification: 'Led school robotics team to national finals',
    });

    expect(res.status).toBe('submitted');
    expect(res.expected_increment_percent).toBe(15.0);
    expect(res.hike_justification).toBe('Led school robotics team to national finals');
  });

  it('rejects submitting a hike request if appraisal is already finalized', async () => {
    (appraisalsRepo.findOne as jest.Mock).mockResolvedValue({
      id: 10,
      school_id: 1,
      user_id: 229,
      status: 'finalized',
    });

    await expect(
      service.submitHikeRequest(1, 229, 10, {
        expected_increment_percent: 15.0,
        hike_justification: 'Attempt after finalization',
      }),
    ).rejects.toThrow('Cannot submit hike request for finalized appraisal');
  });

  it('finalizes an appraisal and sets finalized_at and finalized_by', async () => {
    const existing = {
      id: 10,
      school_id: 1,
      user_id: 229,
      staff_id: 99,
      reviewer_user_id: 1,
      academic_year_id: 2,
      status: 'submitted' as const,
      teaching_effectiveness: 4.5,
      student_outcomes: 4.5,
      classroom_management: 4.5,
      professional_conduct: 4.5,
      extracurricular_contribution: 4.5,
      overall_score: 4.5,
      overall_rating: 'exceeds_expectations' as const,
      recommendation: 'increment' as const,
      increment_percent: 10.0,
      created_at: new Date(),
    };

    (appraisalsRepo.findOne as jest.Mock).mockResolvedValue(existing);

    const res = await service.finalize(1, 10, mockReviewer);
    expect(res.status).toBe('finalized');
    expect(res.finalized_at).toBeInstanceOf(Date);
  });
});
