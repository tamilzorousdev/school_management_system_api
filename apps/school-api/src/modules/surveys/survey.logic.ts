import type { FieldError } from '@app/common';
import type { MergedRecipient } from '../emergency/emergency.logic';
import { share } from '../emergency/emergency.logic';
import type { RecipientKind, RecipientStudent } from '../emergency/entities/emergency.entity';
import type { AnswerValue, QuestionType, SurveyStatus, TemplateQuestion } from './entities/survey.entity';

export const CHOICE_TYPES: QuestionType[] = ['single_choice', 'multi_choice'];
export const TEXT_TYPES: QuestionType[] = ['short_text', 'long_text'];
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 10;
export const MAX_QUESTIONS = 50;
export const SHORT_TEXT_MAX = 200;
export const LONG_TEXT_MAX = 2000;
export const MIN_OPEN_MINUTES = 15;
export const MAX_OPEN_DAYS = 180;
export const REMINDER_LEAD_MS = 24 * 3600_000;
export const SENT_EDITABLE_FIELDS = ['title', 'description', 'questions'];

export const isChoice = (type: QuestionType) => CHOICE_TYPES.includes(type);

export interface QuestionInput {
  type: QuestionType;
  text: string;
  options?: string[];
  is_required?: boolean;
}

export interface QuestionRule {
  id: number;
  type: QuestionType;
  options: string[];
  is_required: boolean;
}

export function questionProblems(questions: QuestionInput[]): FieldError[] {
  return questions.flatMap((question, index) => {
    const field = `questions.${index}.options`;
    const options = (question.options ?? []).map((option) => option.trim());
    if (!isChoice(question.type)) {
      return options.length ? [{ field, message: 'Only choice questions have options' }] : [];
    }
    if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
      return [{ field, message: `Give ${MIN_OPTIONS} to ${MAX_OPTIONS} options` }];
    }
    if (options.some((option) => !option)) return [{ field, message: 'Options cannot be blank' }];
    if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) {
      return [{ field, message: 'Each option must be different' }];
    }
    return [];
  });
}

export function normalizeQuestions(questions: QuestionInput[]): TemplateQuestion[] {
  return questions.map((question) => ({
    type: question.type,
    text: question.text.trim(),
    options: isChoice(question.type) ? (question.options ?? []).map((option) => option.trim()) : [],
    is_required: question.is_required ?? true,
  }));
}

export interface AnswerInput {
  question_id: number;
  value?: unknown;
}

export interface AnswerCheck {
  values: { question_id: number; value: AnswerValue }[];
  code: 'SURVEY_ANSWER_INVALID' | 'SURVEY_ANSWER_REQUIRED' | null;
  errors: FieldError[];
}

const isEmpty = (value: unknown) =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && !value.trim()) ||
  (Array.isArray(value) && !value.length);

const asNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value.trim());
  return null;
};

const validDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
};

type Cleaned = { value: AnswerValue } | { error: string };

export function cleanAnswer(question: QuestionRule, value: unknown): Cleaned {
  const fail = (error: string): Cleaned => ({ error });
  switch (question.type) {
    case 'single_choice':
      return typeof value === 'string' && question.options.includes(value)
        ? { value }
        : fail('Pick one of the options');
    case 'multi_choice': {
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
        return fail('Pick one or more options');
      if (new Set(value).size !== value.length) return fail('Each option can be picked once');
      if (value.some((item) => !question.options.includes(item as string))) return fail('Pick from the options given');
      return { value: question.options.filter((option) => value.includes(option)) };
    }
    case 'rating': {
      const stars = asNumber(value);
      return stars !== null && Number.isInteger(stars) && stars >= 1 && stars <= 5
        ? { value: stars }
        : fail('Give 1 to 5 stars');
    }
    case 'number': {
      const number = asNumber(value);
      return number !== null && Math.abs(number) <= 1e9 ? { value: number } : fail('Enter a number');
    }
    case 'date':
      return typeof value === 'string' && validDate(value.trim())
        ? { value: value.trim() }
        : fail('Enter a date as YYYY-MM-DD');
    default: {
      if (typeof value !== 'string') return fail('Write an answer');
      const limit = question.type === 'short_text' ? SHORT_TEXT_MAX : LONG_TEXT_MAX;
      return value.trim().length <= limit ? { value: value.trim() } : fail(`Keep it within ${limit} characters`);
    }
  }
}

export function checkAnswers(questions: QuestionRule[], answers: AnswerInput[]): AnswerCheck {
  const invalid: FieldError[] = [];
  const missing: FieldError[] = [];
  const values: AnswerCheck['values'] = [];
  const seen = new Set<number>();
  for (const answer of answers) {
    const field = `answers.${answer.question_id}`;
    const question = questions.find((item) => item.id === answer.question_id);
    if (!question || seen.has(answer.question_id)) {
      invalid.push({ field, message: question ? 'Answer each question once' : 'This question is not in the form' });
      continue;
    }
    seen.add(answer.question_id);
    if (isEmpty(answer.value)) continue;
    const cleaned = cleanAnswer(question, answer.value);
    if ('error' in cleaned) invalid.push({ field, message: cleaned.error });
    else values.push({ question_id: question.id, value: cleaned.value });
  }
  for (const question of questions) {
    const field = `answers.${question.id}`;
    const answered = values.some((item) => item.question_id === question.id);
    if (question.is_required && !answered && !invalid.some((error) => error.field === field)) {
      missing.push({ field, message: 'This question needs an answer' });
    }
  }
  const code = invalid.length ? 'SURVEY_ANSWER_INVALID' : missing.length ? 'SURVEY_ANSWER_REQUIRED' : null;
  return { values, code, errors: [...invalid, ...missing] };
}

export interface RecipientSlot {
  user_id: number;
  student_id: number | null;
  kind: RecipientKind;
  name: string;
  students: RecipientStudent[];
}

export function expandRecipients(people: MergedRecipient[], perChild: boolean): RecipientSlot[] {
  return people
    .filter((person) => person.user_id)
    .flatMap((person): RecipientSlot[] => {
      const base = { user_id: person.user_id!, name: person.name.slice(0, 150) };
      if (!perChild || !person.students.length) {
        return [{ ...base, student_id: null, kind: person.kind, students: person.students }];
      }
      const children = person.students.map((student) => ({
        ...base,
        student_id: student.id,
        kind: 'parent' as const,
        students: [student],
      }));
      return person.kind === 'both'
        ? [...children, { ...base, student_id: null, kind: 'staff' as const, students: [] }]
        : children;
    });
}

export type AppRole = 'parent' | 'staff';

export function recipientRole(kind: RecipientKind, studentId: number | null): AppRole | null {
  if (studentId !== null || kind === 'parent') return 'parent';
  return kind === 'staff' ? 'staff' : null;
}

export function pushRole(roles: (AppRole | null)[]): AppRole | null {
  const distinct = [...new Set(roles)];
  return distinct.length === 1 ? distinct[0]! : null;
}

export interface EditProblem {
  code: 'SURVEY_CLOSED' | 'SURVEY_LOCKED';
  message: string;
}

export function editProblem(status: SurveyStatus, locked: boolean, changed: string[]): EditProblem | null {
  if (status === 'closed') return { code: 'SURVEY_CLOSED', message: 'This form is closed and cannot be changed' };
  if (status === 'draft') return null;
  if (locked) {
    return {
      code: 'SURVEY_LOCKED',
      message: 'Answers have come in, so the form cannot change any more. You can still extend the close date.',
    };
  }
  if (changed.some((field) => !SENT_EDITABLE_FIELDS.includes(field))) {
    return { code: 'SURVEY_LOCKED', message: 'After sending, only the title, description and questions can change' };
  }
  return null;
}

export function closesProblem(closesAt: Date, opensAt: Date): string | null {
  if (closesAt.getTime() < opensAt.getTime() + MIN_OPEN_MINUTES * 60_000) {
    return `Close it at least ${MIN_OPEN_MINUTES} minutes after it opens`;
  }
  if (closesAt.getTime() > opensAt.getTime() + MAX_OPEN_DAYS * 86400_000) {
    return `Close it within ${MAX_OPEN_DAYS} days`;
  }
  return null;
}

export interface ReminderState {
  status: SurveyStatus;
  sent_at: Date | null;
  closes_at: Date | null;
  reminder_sent_at: Date | null;
}

export function reminderDue(survey: ReminderState, now = new Date()): boolean {
  if (survey.status !== 'open' || survey.reminder_sent_at || !survey.closes_at || !survey.sent_at) return false;
  const remindAt = survey.closes_at.getTime() - REMINDER_LEAD_MS;
  return now.getTime() >= remindAt && now.getTime() < survey.closes_at.getTime() && survey.sent_at.getTime() < remindAt;
}

export interface AnswerRow {
  question_id: number;
  value: AnswerValue;
  name: string | null;
  class_section: string | null;
}

export interface ChoiceResult {
  option: string;
  count: number;
  percent: number;
}

export interface QuestionResult {
  id: number;
  type: QuestionType;
  text: string;
  answered: number;
  choices?: ChoiceResult[];
  rating?: { average: number | null; counts: Record<string, number> };
  number?: { average: number | null; min: number | null; max: number | null };
  answers?: { value: string; name?: string; class_section?: string | null }[];
}

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

export function summarize(
  questions: (QuestionRule & { text: string })[],
  rows: AnswerRow[],
  options: { anonymous: boolean; search?: string },
): QuestionResult[] {
  const needle = options.search?.trim().toLowerCase();
  return questions.map((question) => {
    const values = rows.filter((row) => row.question_id === question.id);
    const base = { id: question.id, type: question.type, text: question.text, answered: values.length };
    if (isChoice(question.type)) {
      const picked = values.flatMap((row) => (Array.isArray(row.value) ? row.value : [row.value]));
      return {
        ...base,
        choices: question.options.map((option) => {
          const count = picked.filter((value) => value === option).length;
          return { option, count, percent: share(count, values.length) ?? 0 };
        }),
      };
    }
    const numbers = values.map((row) => Number(row.value)).filter((value) => Number.isFinite(value));
    const average = numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
    if (question.type === 'rating') {
      const counts = Object.fromEntries(
        [1, 2, 3, 4, 5].map((stars) => [String(stars), numbers.filter((value) => value === stars).length]),
      );
      return { ...base, rating: { average: average === null ? null : round(average, 1), counts } };
    }
    if (question.type === 'number') {
      return {
        ...base,
        number: {
          average: average === null ? null : round(average, 2),
          min: numbers.length ? Math.min(...numbers) : null,
          max: numbers.length ? Math.max(...numbers) : null,
        },
      };
    }
    const listed = values
      .filter(
        (row) => !needle || !TEXT_TYPES.includes(question.type) || String(row.value).toLowerCase().includes(needle),
      )
      .map((row) => ({
        value: String(row.value),
        ...(options.anonymous || !row.name ? {} : { name: row.name }),
        ...(options.anonymous ? {} : { class_section: row.class_section }),
      }));
    if (question.type === 'date') listed.sort((a, b) => a.value.localeCompare(b.value));
    return { ...base, answers: listed };
  });
}

export const formatAnswer = (value: AnswerValue | undefined) =>
  value === undefined ? '' : Array.isArray(value) ? value.join(', ') : String(value);

export interface ReadyForm {
  key: string;
  title: string;
  description: string;
  questions: TemplateQuestion[];
}

const ask = (type: QuestionType, text: string, options: string[] = [], is_required = true): TemplateQuestion => ({
  type,
  text,
  options,
  is_required,
});

export const READY_FORMS: ReadyForm[] = [
  {
    key: 'ptm_feedback',
    title: 'Parent-teacher meeting feedback',
    description: 'Tell us how the parent-teacher meeting went for you.',
    questions: [
      ask('rating', 'How useful was the meeting with the teacher?'),
      ask('single_choice', 'Did you get enough time to talk about your child?', ['Yes', 'Somewhat', 'No']),
      ask(
        'multi_choice',
        'Which topics were covered?',
        ['Studies and marks', 'Behaviour', 'Attendance', 'Health', 'Activities'],
        false,
      ),
      ask('long_text', 'What can we do better at the next meeting?', [], false),
    ],
  },
  {
    key: 'event_feedback',
    title: 'Event feedback',
    description: 'Thank you for joining us. Please tell us what you thought of the event.',
    questions: [
      ask('rating', 'How would you rate the event overall?'),
      ask('single_choice', 'How well was the event organised?', ['Very well', 'Well', 'Average', 'Poorly']),
      ask(
        'multi_choice',
        'What did you enjoy most?',
        ['Performances', 'Food', 'Seating', 'Timing', "Children's participation"],
        false,
      ),
      ask('long_text', 'Any suggestions for the next event?', [], false),
    ],
  },
  {
    key: 'transport_feedback',
    title: 'School transport feedback',
    description: 'Help us make the school bus service safer and more reliable.',
    questions: [
      ask('rating', 'How satisfied are you with the school bus service?'),
      ask('single_choice', 'Is the bus usually on time?', ['Always', 'Mostly', 'Sometimes', 'Rarely']),
      ask('single_choice', 'Do you feel your child is safe on the bus?', ['Yes', 'Not sure', 'No']),
      ask('long_text', 'Tell us about any problem with the bus, route or stop', [], false),
    ],
  },
  {
    key: 'canteen_feedback',
    title: 'Canteen feedback',
    description: 'Tell us what you and your child think of the school canteen.',
    questions: [
      ask('rating', 'How would you rate the canteen food?'),
      ask('single_choice', 'How often does your child eat at the canteen?', [
        'Every day',
        'A few days a week',
        'Rarely',
        'Never',
      ]),
      ask('multi_choice', 'What should improve?', ['Taste', 'Hygiene', 'Variety', 'Price', 'Quantity'], false),
      ask('short_text', 'Which dish would you like added?', [], false),
    ],
  },
  {
    key: 'annual_parent_satisfaction',
    title: 'Annual parent satisfaction survey',
    description: 'Once a year we ask every family how the school is doing. It takes about three minutes.',
    questions: [
      ask('rating', 'Overall, how satisfied are you with the school?'),
      ask('rating', 'How would you rate the quality of teaching?'),
      ask('rating', 'How would you rate communication from the school?'),
      ask('single_choice', 'Would you recommend the school to other parents?', ['Yes', 'Maybe', 'No']),
      ask('long_text', 'What do you like most about the school?', [], false),
      ask('long_text', 'What should the school improve?', [], false),
    ],
  },
  {
    key: 'staff_satisfaction',
    title: 'Staff satisfaction survey',
    description: 'Your answers help the management make the school a better place to work.',
    questions: [
      ask('rating', 'How satisfied are you working at the school?'),
      ask('single_choice', 'Do you have the resources you need to do your job?', [
        'Always',
        'Mostly',
        'Sometimes',
        'Rarely',
      ]),
      ask('rating', 'How well does the management listen to staff?'),
      ask(
        'multi_choice',
        'Where would you like more support?',
        ['Training', 'Classroom resources', 'Workload', 'Communication', 'Wellbeing'],
        false,
      ),
      ask('long_text', 'Any suggestions for the management?', [], false),
    ],
  },
];
