import { Exam } from './entities/exam.entity';
import { examPhase } from './exams.service';

const exam = { start_date: '2026-12-07', end_date: '2026-12-18' } as Exam;

describe('examPhase', () => {
  it('is upcoming before the first paper', () => {
    expect(examPhase(exam, '2026-12-06', false)).toBe('upcoming');
  });

  it('is ongoing from the first to the last day', () => {
    expect(examPhase(exam, '2026-12-07', false)).toBe('ongoing');
    expect(examPhase(exam, '2026-12-18', false)).toBe('ongoing');
  });

  it('awaits results once the exam is over and marks are not published', () => {
    expect(examPhase(exam, '2026-12-19', false)).toBe('awaiting_results');
  });

  it('is results_published whenever the child has a result', () => {
    expect(examPhase(exam, '2026-12-10', true)).toBe('results_published');
  });
});
