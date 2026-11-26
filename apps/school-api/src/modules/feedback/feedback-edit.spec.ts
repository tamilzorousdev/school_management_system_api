import { AppException, AuthUser } from '@app/common';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../setup/entities/academic-year.entity';
import { Term } from '../setup/entities/term.entity';
import { StudentFeedback } from './entities/feedback.entity';
import { FeedbackService } from './feedback.service';

const teacher = { id: 6, school_id: 1 } as AuthUser;
const input = { studies: 5, behaviour: 4, sports: 3, remark: '  Well done  ' };

function build(options: { enabled?: boolean; terms?: object[]; existing?: Partial<StudentFeedback> | null } = {}) {
  const saved: StudentFeedback[] = [];
  const existing =
    options.existing === undefined
      ? { id: 9, studies: 2, behaviour: 2, sports: null, remark: null, edited_at: null }
      : options.existing;
  const repos = new Map<unknown, object>([
    [School, { findOneBy: jest.fn().mockResolvedValue({ id: 1, student_feedback_enabled: options.enabled ?? true }) }],
    [
      AcademicYear,
      {
        findOneBy: jest
          .fn()
          .mockResolvedValue({ id: 3, name: '2026-27', start_date: '2026-06-01', end_date: '2027-03-31' }),
      },
    ],
    [
      Term,
      {
        find: jest
          .fn()
          .mockResolvedValue(
            options.terms ?? [
              { id: 2, name: 'Term 2', start_date: '2000-01-01', end_date: '2999-12-31', sort_order: 2 },
            ],
          ),
      },
    ],
    [
      StudentFeedback,
      {
        findOneBy: jest.fn().mockResolvedValue(existing),
        save: jest.fn().mockImplementation(async (row: StudentFeedback) => {
          saved.push(row);
          return row;
        }),
      },
    ],
  ]);
  const dataSource = { getRepository: (entity: unknown) => repos.get(entity) };
  const assignments = { assertTeachesStudent: jest.fn().mockResolvedValue(undefined) };
  const service = new FeedbackService(
    dataSource as never,
    {} as never,
    assignments as never,
    { timeZone: 'Asia/Kolkata' } as never,
  );
  const dto = { id: 9, student: { id: 4, name: 'Kavin' }, edited_at: new Date() };
  jest.spyOn(service as never, 'presentFeedback').mockResolvedValue([dto] as never);
  const tell = jest.spyOn(service as never, 'tellParents').mockResolvedValue(undefined as never);
  return { service, saved, tell, assignments, dto };
}

describe('updateFeedback', () => {
  it('replaces the stars and remark, stamps edited_at and tells the parents it was updated', async () => {
    const { service, saved, tell, dto } = build();
    const result = await service.updateFeedback(teacher, 4, input);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ studies: 5, behaviour: 4, sports: 3, remark: 'Well done' });
    expect(saved[0]!.edited_at).toBeInstanceOf(Date);
    expect(tell).toHaveBeenCalledWith(dto, true);
    expect(result).toBe(dto);
  });

  it('clears sports and the remark when they are left out', async () => {
    const { service, saved } = build({ existing: { id: 9, studies: 2, behaviour: 2, sports: 4, remark: 'old' } });
    await service.updateFeedback(teacher, 4, { studies: 3, behaviour: 3 });
    expect(saved[0]).toMatchObject({ sports: null, remark: null });
  });

  it('answers FEEDBACK_NOT_FOUND when nothing was given this term', async () => {
    const { service } = build({ existing: null });
    await expect(service.updateFeedback(teacher, 4, input)).rejects.toMatchObject({
      response: { code: 'FEEDBACK_NOT_FOUND' },
    });
  });

  it('answers FEEDBACK_CLOSED when the school has student feedback off', async () => {
    const { service } = build({ enabled: false });
    await expect(service.updateFeedback(teacher, 4, input)).rejects.toMatchObject({
      response: { code: 'FEEDBACK_CLOSED' },
    });
  });

  it('answers NO_TERM_NOW when today is outside every term', async () => {
    const { service } = build({
      terms: [{ id: 1, name: 'Term 1', start_date: '2000-01-01', end_date: '2000-02-01', sort_order: 1 }],
    });
    await expect(service.updateFeedback(teacher, 4, input)).rejects.toMatchObject({
      response: { code: 'NO_TERM_NOW' },
    });
  });

  it('checks the teacher teaches the student', async () => {
    const { service, assignments } = build();
    assignments.assertTeachesStudent.mockRejectedValue(AppException.forbidden('no', 'NOT_YOUR_SECTION'));
    await expect(service.updateFeedback(teacher, 4, input)).rejects.toMatchObject({
      response: { code: 'NOT_YOUR_SECTION' },
    });
  });

  it('has a notification template for the update', () => {
    expect(TEMPLATES.STUDENT_FEEDBACK_UPDATED).toBe('STUDENT_FEEDBACK_UPDATED');
  });
});

describe('tellParents', () => {
  it('names the screen the parent app opens and the child it is about', async () => {
    const dispatch = jest.fn().mockResolvedValue(undefined);
    const dataSource = { query: jest.fn().mockResolvedValue([{ user_ids: [7, 8] }]) };
    const service = new FeedbackService(dataSource as never, { dispatch } as never, {} as never, {} as never);
    const feedback = {
      id: 9,
      term: { name: 'Term 2' },
      teacher: { name: 'Priya' },
      student: { id: 4, name: 'Kavin' },
      studies: 5,
      studies_label: 'Excellent',
      behaviour: 4,
      behaviour_label: 'Very good',
      sports: null,
      remark: null,
    };
    await (service as never as { tellParents: (f: unknown, updated?: boolean) => Promise<void> }).tellParents(
      feedback,
      true,
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        template: TEMPLATES.STUDENT_FEEDBACK_UPDATED,
        audience: { user_ids: [7, 8] },
        data: expect.objectContaining({ screen: 'child_feedback', student_id: '4', feedback_id: '9' }),
      }),
    );
  });
});
