import { AppException } from '@app/common';
import { QuizOption } from './entities/quiz-question.entity';

export const QUESTION_TYPES = ['single_choice', 'multiple_choice', 'true_false'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 6;
const KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];

export interface QuestionInput {
  question_type?: QuestionType;
  options: QuizOption[];
  correct_option: string;
}

export interface NormalizedQuestion {
  question_type: QuestionType;
  options: QuizOption[];
  correct_option: string;
}

function invalid(index: number, message: string): never {
  throw AppException.validation([{ field: `questions.${index}`, message }]);
}

export function answerKeys(value: string | null | undefined): string[] {
  return [
    ...new Set(
      (value ?? '')
        .split(',')
        .map((key) => key.trim().toUpperCase())
        .filter(Boolean),
    ),
  ].sort();
}

export function normalizeQuestion(input: QuestionInput, index: number): NormalizedQuestion {
  const type = input.question_type ?? 'single_choice';
  const options = input.options.map((option, position) => ({
    key: KEYS[position],
    text: option.text.trim(),
  }));
  if (options.some((option) => !option.text)) invalid(index, 'Every option needs text');
  if (new Set(options.map((option) => option.text.toLowerCase())).size !== options.length) {
    invalid(index, 'Options must be different from each other');
  }
  if (type === 'true_false' && options.length !== 2) invalid(index, 'A yes/no question has exactly 2 options');
  if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
    invalid(index, `A question needs ${MIN_OPTIONS} to ${MAX_OPTIONS} options`);
  }
  const keys = answerKeys(input.correct_option);
  if (!keys.length) invalid(index, 'Choose the correct answer');
  if (keys.some((key) => !options.some((option) => option.key === key))) {
    invalid(index, 'The correct answer must be one of the options');
  }
  if (type !== 'multiple_choice' && keys.length !== 1) invalid(index, 'This question has exactly one correct answer');
  if (type === 'multiple_choice' && keys.length < 2)
    invalid(index, 'A multiple-choice question needs 2 or more correct answers');
  return { question_type: type, options, correct_option: keys.join(',') };
}

export function isCorrectAnswer(correctOption: string, selected: string | null | undefined): boolean {
  const expected = answerKeys(correctOption);
  const given = answerKeys(selected);
  return given.length > 0 && expected.length === given.length && expected.every((key, i) => key === given[i]);
}
