import type { MergedRecipient } from '../emergency/emergency.logic';
import {
  AnswerRow,
  checkAnswers,
  closesProblem,
  editProblem,
  expandRecipients,
  normalizeQuestions,
  pushRole,
  QuestionRule,
  questionProblems,
  READY_FORMS,
  recipientRole,
  reminderDue,
  summarize,
} from './survey.logic';

const questions: (QuestionRule & { text: string })[] = [
  { id: 1, type: 'single_choice', text: 'Organised?', options: ['Very well', 'Well', 'Poorly'], is_required: true },
  { id: 2, type: 'multi_choice', text: 'Enjoyed', options: ['Food', 'Music', 'Games'], is_required: false },
  { id: 3, type: 'rating', text: 'Overall', options: [], is_required: true },
  { id: 4, type: 'short_text', text: 'One word', options: [], is_required: false },
  { id: 5, type: 'long_text', text: 'Suggestions', options: [], is_required: false },
  { id: 6, type: 'date', text: 'Day attended', options: [], is_required: false },
  { id: 7, type: 'number', text: 'Family members', options: [], is_required: false },
];

const person = (overrides: Partial<MergedRecipient>): MergedRecipient => ({
  kind: 'parent',
  user_id: 10,
  guardian_id: 3,
  name: 'Lakshmi',
  mobile: '9000000005',
  language: 'ta',
  students: [],
  ...overrides,
});

describe('checkAnswers', () => {
  it('accepts one valid answer of every type and keeps multi choices in option order', () => {
    const result = checkAnswers(questions, [
      { question_id: 1, value: 'Well' },
      { question_id: 2, value: ['Games', 'Food'] },
      { question_id: 3, value: 4 },
      { question_id: 4, value: '  Lovely ' },
      { question_id: 5, value: 'More shade please' },
      { question_id: 6, value: '2026-11-15' },
      { question_id: 7, value: '3' },
    ]);
    expect(result.code).toBeNull();
    expect(result.values).toEqual([
      { question_id: 1, value: 'Well' },
      { question_id: 2, value: ['Food', 'Games'] },
      { question_id: 3, value: 4 },
      { question_id: 4, value: 'Lovely' },
      { question_id: 5, value: 'More shade please' },
      { question_id: 6, value: '2026-11-15' },
      { question_id: 7, value: 3 },
    ]);
  });

  it('needs every required question and lets optional ones be blank', () => {
    const result = checkAnswers(questions, [
      { question_id: 1, value: 'Well' },
      { question_id: 2, value: [] },
      { question_id: 4, value: '  ' },
    ]);
    expect(result.code).toBe('SURVEY_ANSWER_REQUIRED');
    expect(result.errors).toEqual([{ field: 'answers.3', message: 'This question needs an answer' }]);
    expect(result.values).toEqual([{ question_id: 1, value: 'Well' }]);
  });

  it.each([
    [1, 'Excellent', 'Pick one of the options'],
    [2, ['Food', 'Food'], 'Each option can be picked once'],
    [2, ['Dance'], 'Pick from the options given'],
    [3, 6, 'Give 1 to 5 stars'],
    [3, 3.5, 'Give 1 to 5 stars'],
    [6, '2026-02-30', 'Enter a date as YYYY-MM-DD'],
    [7, 'many', 'Enter a number'],
    [4, 'x'.repeat(201), 'Keep it within 200 characters'],
  ])('refuses question %i given %p', (id, value, message) => {
    const answers = [
      { question_id: 1, value: 'Well' },
      { question_id: 3, value: 5 },
    ].filter((answer) => answer.question_id !== id);
    const result = checkAnswers(questions, [...answers, { question_id: id, value }]);
    expect(result.code).toBe('SURVEY_ANSWER_INVALID');
    expect(result.errors).toEqual([{ field: `answers.${id}`, message }]);
  });

  it('refuses unknown and repeated questions', () => {
    const result = checkAnswers(questions, [
      { question_id: 1, value: 'Well' },
      { question_id: 1, value: 'Poorly' },
      { question_id: 3, value: 5 },
      { question_id: 99, value: 'x' },
    ]);
    expect(result.code).toBe('SURVEY_ANSWER_INVALID');
    expect(result.errors.map((error) => error.field)).toEqual(['answers.1', 'answers.99']);
  });
});

describe('questionProblems', () => {
  it('needs 2 to 10 different options for choice questions and none for the others', () => {
    expect(
      questionProblems([
        { type: 'single_choice', text: 'A', options: ['Yes'] },
        { type: 'multi_choice', text: 'B', options: ['Tea', 'tea'] },
        { type: 'rating', text: 'C', options: ['x'] },
        { type: 'single_choice', text: 'D', options: ['Yes', ' '] },
        { type: 'single_choice', text: 'E', options: ['Yes', 'No'] },
      ]),
    ).toEqual([
      { field: 'questions.0.options', message: 'Give 2 to 10 options' },
      { field: 'questions.1.options', message: 'Each option must be different' },
      { field: 'questions.2.options', message: 'Only choice questions have options' },
      { field: 'questions.3.options', message: 'Options cannot be blank' },
    ]);
  });

  it('trims text and options and makes questions required unless told otherwise', () => {
    expect(normalizeQuestions([{ type: 'single_choice', text: ' Ok? ', options: [' Yes', 'No '] }])).toEqual([
      { type: 'single_choice', text: 'Ok?', options: ['Yes', 'No'], is_required: true },
    ]);
  });

  it('ships six valid ready-made forms, including Event feedback', () => {
    expect(READY_FORMS.map((form) => form.key)).toEqual([
      'ptm_feedback',
      'event_feedback',
      'transport_feedback',
      'canteen_feedback',
      'annual_parent_satisfaction',
      'staff_satisfaction',
    ]);
    for (const form of READY_FORMS) expect(questionProblems(form.questions)).toEqual([]);
  });
});

describe('expandRecipients', () => {
  const kavin = { id: 1, name: 'Kavin', section: '6 - A' };
  const nila = { id: 2, name: 'Nila', section: '3 - A' };

  it('gives a family one answer by default', () => {
    const slots = expandRecipients([person({ students: [kavin, nila] })], false);
    expect(slots).toEqual([
      { user_id: 10, student_id: null, kind: 'parent', name: 'Lakshmi', students: [kavin, nila] },
    ]);
  });

  it('gives a parent one answer per child when per_child is on', () => {
    const slots = expandRecipients([person({ students: [kavin, nila] })], true);
    expect(slots.map((slot) => [slot.student_id, slot.students])).toEqual([
      [1, [kavin]],
      [2, [nila]],
    ]);
  });

  it('keeps one staff answer for a teacher who is also a parent, and one for plain staff', () => {
    const slots = expandRecipients(
      [person({ kind: 'both', user_id: 11, students: [kavin] }), person({ kind: 'staff', user_id: 12, students: [] })],
      true,
    );
    expect(slots.map((slot) => [slot.user_id, slot.student_id, slot.kind])).toEqual([
      [11, 1, 'parent'],
      [11, null, 'staff'],
      [12, null, 'staff'],
    ]);
  });

  it('leaves out people without the app, who cannot answer', () => {
    expect(expandRecipients([person({ user_id: null, students: [kavin] })], true)).toEqual([]);
  });
});

describe('editProblem (the lock rule)', () => {
  it('lets a draft change anything', () => {
    expect(editProblem('draft', false, ['audience', 'questions'])).toBeNull();
  });

  it('lets a sent form change only its title, description and questions until the first answer', () => {
    expect(editProblem('open', false, ['questions', 'title'])).toBeNull();
    expect(editProblem('scheduled', false, ['audience'])?.code).toBe('SURVEY_LOCKED');
  });

  it('locks the form once any answer exists, and refuses changes once closed', () => {
    expect(editProblem('open', true, ['questions'])?.code).toBe('SURVEY_LOCKED');
    expect(editProblem('closed', false, ['title'])?.code).toBe('SURVEY_CLOSED');
  });
});

describe('closesProblem', () => {
  const start = new Date('2026-11-18T10:00:00Z');
  it('needs at least 15 minutes and at most 180 days', () => {
    expect(closesProblem(new Date('2026-11-18T10:10:00Z'), start)).toMatch(/15 minutes/);
    expect(closesProblem(new Date('2026-11-20T10:00:00Z'), start)).toBeNull();
    expect(closesProblem(new Date('2027-06-01T10:00:00Z'), start)).toMatch(/180 days/);
  });
});

describe('reminderDue', () => {
  const closes = new Date('2026-11-20T12:00:00Z');
  const open = {
    status: 'open' as const,
    sent_at: new Date('2026-11-18T09:00:00Z'),
    closes_at: closes,
    reminder_sent_at: null,
  };

  it('waits until 24 hours before the close', () => {
    expect(reminderDue(open, new Date('2026-11-19T11:59:00Z'))).toBe(false);
    expect(reminderDue(open, new Date('2026-11-19T12:00:00Z'))).toBe(true);
    expect(reminderDue(open, new Date('2026-11-20T11:00:00Z'))).toBe(true);
  });

  it('sends once, never after the close, and only to an open form', () => {
    const now = new Date('2026-11-19T18:00:00Z');
    expect(reminderDue({ ...open, reminder_sent_at: new Date('2026-11-19T12:00:30Z') }, now)).toBe(false);
    expect(reminderDue(open, new Date('2026-11-20T12:00:00Z'))).toBe(false);
    expect(reminderDue({ ...open, status: 'closed' }, now)).toBe(false);
  });

  it('skips a form sent less than a day before it closes', () => {
    expect(reminderDue({ ...open, sent_at: new Date('2026-11-19T20:00:00Z') }, new Date('2026-11-19T21:00:00Z'))).toBe(
      false,
    );
  });
});

describe('summarize (results maths)', () => {
  const rows: AnswerRow[] = [
    { question_id: 1, value: 'Very well', name: 'Lakshmi', class_section: '6 - A' },
    { question_id: 1, value: 'Well', name: 'Arun', class_section: '7 - A' },
    { question_id: 1, value: 'Very well', name: 'Deepa', class_section: '7 - A' },
    { question_id: 2, value: ['Food', 'Music'], name: 'Lakshmi', class_section: '6 - A' },
    { question_id: 2, value: ['Food'], name: 'Arun', class_section: '7 - A' },
    { question_id: 3, value: 5, name: 'Lakshmi', class_section: '6 - A' },
    { question_id: 3, value: 4, name: 'Arun', class_section: '7 - A' },
    { question_id: 3, value: 4, name: 'Deepa', class_section: '7 - A' },
    { question_id: 5, value: 'More shade for parents', name: 'Lakshmi', class_section: '6 - A' },
    { question_id: 5, value: 'Start on time', name: 'Arun', class_section: '7 - A' },
    { question_id: 6, value: '2026-11-16', name: 'Arun', class_section: '7 - A' },
    { question_id: 6, value: '2026-11-15', name: 'Deepa', class_section: '7 - A' },
    { question_id: 7, value: 2, name: 'Lakshmi', class_section: '6 - A' },
    { question_id: 7, value: 5, name: 'Arun', class_section: '7 - A' },
  ];
  const results = summarize(questions, rows, { anonymous: false });

  it('counts each option with its share of the people who answered', () => {
    expect(results[0]!.choices).toEqual([
      { option: 'Very well', count: 2, percent: 66.7 },
      { option: 'Well', count: 1, percent: 33.3 },
      { option: 'Poorly', count: 0, percent: 0 },
    ]);
    expect(results[1]!.choices?.map((choice) => choice.percent)).toEqual([100, 50, 0]);
  });

  it('averages ratings and counts each star', () => {
    expect(results[2]).toMatchObject({
      answered: 3,
      rating: { average: 4.3, counts: { '1': 0, '2': 0, '3': 0, '4': 2, '5': 1 } },
    });
  });

  it('gives average, lowest and highest for numbers, and sorts dates', () => {
    expect(results[6]!.number).toEqual({ average: 3.5, min: 2, max: 5 });
    expect(results[5]!.answers?.map((answer) => answer.value)).toEqual(['2026-11-15', '2026-11-16']);
  });

  it('lists written answers with names, and never names when anonymous', () => {
    expect(results[4]!.answers?.[0]).toEqual({
      value: 'More shade for parents',
      name: 'Lakshmi',
      class_section: '6 - A',
    });
    const hidden = summarize(questions, rows, { anonymous: true });
    const listed = hidden.flatMap((result) => result.answers ?? []);
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.some((answer) => 'name' in answer || 'class_section' in answer)).toBe(false);
  });

  it('narrows written answers by search and reports empty questions safely', () => {
    const searched = summarize(questions, rows, { anonymous: false, search: 'SHADE' });
    expect(searched[4]!.answers?.map((answer) => answer.value)).toEqual(['More shade for parents']);
    const empty = summarize(questions, [], { anonymous: false });
    expect(empty[2]!.rating?.average).toBeNull();
    expect(empty[6]!.number).toEqual({ average: null, min: null, max: null });
    expect(empty[0]!.choices?.every((choice) => choice.percent === 0)).toBe(true);
  });
});

describe('recipientRole and pushRole', () => {
  it('names the app a recipient row belongs to', () => {
    expect(recipientRole('parent', null)).toBe('parent');
    expect(recipientRole('staff', null)).toBe('staff');
    expect(recipientRole('both', 41)).toBe('parent');
    expect(recipientRole('both', null)).toBeNull();
  });

  it('gives a push one role only when every row of the person agrees', () => {
    expect(pushRole(['parent', 'parent'])).toBe('parent');
    expect(pushRole(['staff'])).toBe('staff');
    expect(pushRole(['parent', 'staff'])).toBeNull();
    expect(pushRole([null])).toBeNull();
  });
});
