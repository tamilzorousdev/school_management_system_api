import { answerKeys, isCorrectAnswer, normalizeQuestion } from './quiz-questions.logic';

const opts = (...texts: string[]) => texts.map((text) => ({ key: '?', text }));

describe('normalizeQuestion', () => {
  it('defaults to single choice and assigns keys in order', () => {
    const result = normalizeQuestion({ options: opts('3', '4', '5'), correct_option: 'b' }, 0);
    expect(result).toEqual({
      question_type: 'single_choice',
      options: [
        { key: 'A', text: '3' },
        { key: 'B', text: '4' },
        { key: 'C', text: '5' },
      ],
      correct_option: 'B',
    });
  });

  it('accepts a yes/no question with two options', () => {
    const result = normalizeQuestion(
      { question_type: 'true_false', options: opts('Yes', 'No'), correct_option: 'A' },
      0,
    );
    expect(result.question_type).toBe('true_false');
    expect(result.correct_option).toBe('A');
  });

  it('refuses a yes/no question with three options', () => {
    expect(() =>
      normalizeQuestion({ question_type: 'true_false', options: opts('Yes', 'No', 'Maybe'), correct_option: 'A' }, 0),
    ).toThrow();
  });

  it('keeps several right answers of a multiple-choice question sorted', () => {
    const result = normalizeQuestion(
      { question_type: 'multiple_choice', options: opts('2', '3', '4', '5'), correct_option: 'c, a' },
      0,
    );
    expect(result.correct_option).toBe('A,C');
  });

  it('refuses multiple choice with one right answer and single choice with two', () => {
    expect(() =>
      normalizeQuestion({ question_type: 'multiple_choice', options: opts('a', 'b', 'c'), correct_option: 'A' }, 0),
    ).toThrow();
    expect(() => normalizeQuestion({ options: opts('a', 'b', 'c'), correct_option: 'A,B' }, 0)).toThrow();
  });

  it('refuses an answer that is not an option, empty or repeated options, and too few options', () => {
    expect(() => normalizeQuestion({ options: opts('a', 'b'), correct_option: 'C' }, 0)).toThrow();
    expect(() => normalizeQuestion({ options: opts('a', ' '), correct_option: 'A' }, 0)).toThrow();
    expect(() => normalizeQuestion({ options: opts('a', 'A'), correct_option: 'A' }, 0)).toThrow();
    expect(() => normalizeQuestion({ options: opts('a'), correct_option: 'A' }, 0)).toThrow();
  });
});

describe('isCorrectAnswer', () => {
  it('matches a single answer ignoring case and spaces', () => {
    expect(isCorrectAnswer('B', ' b ')).toBe(true);
    expect(isCorrectAnswer('B', 'A')).toBe(false);
  });

  it('needs every right option and nothing extra for multiple choice', () => {
    expect(isCorrectAnswer('A,C', 'c,a')).toBe(true);
    expect(isCorrectAnswer('A,C', 'A')).toBe(false);
    expect(isCorrectAnswer('A,C', 'A,B,C')).toBe(false);
  });

  it('is wrong when nothing was answered', () => {
    expect(isCorrectAnswer('A', null)).toBe(false);
    expect(isCorrectAnswer('A', '')).toBe(false);
  });
});

describe('answerKeys', () => {
  it('splits, upper-cases, de-duplicates and sorts', () => {
    expect(answerKeys('c, a,a')).toEqual(['A', 'C']);
  });
});
