import { addDays, WEEKLY_OFF, weekday } from '../../shared/school-days';
import { FineStatus } from './entities/library-fine.entity';
import { IssueStatus } from './entities/library-issue.entity';
import { MemberStatus, MemberType } from './entities/library-member.entity';
import { CopyStatus } from './entities/book.entity';

export const LOAN_STATES = ['on_loan', 'due_soon', 'due_today', 'overdue', 'returned', 'lost'] as const;
export type LoanState = (typeof LOAN_STATES)[number];

export interface Refusal {
  code: string;
  message: string;
}

export interface LoanRules {
  student_loan_days: number;
  staff_loan_days: number;
  student_max_books: number;
  staff_max_books: number;
  fine_per_day: number;
  grace_days: number;
  max_fine_per_book: number | null;
  lost_processing_fee: number;
  max_renewals: number;
  block_issue_above_fine: number;
  skip_holidays: boolean;
  charge_staff_fines: boolean;
  due_soon_days: number;
  escalate_after_days: number;
  long_overdue_days: number;
}

export const DEFAULT_RULES: LoanRules = {
  student_loan_days: 14,
  staff_loan_days: 30,
  student_max_books: 2,
  staff_max_books: 5,
  fine_per_day: 1,
  grace_days: 0,
  max_fine_per_book: 100,
  lost_processing_fee: 50,
  max_renewals: 1,
  block_issue_above_fine: 50,
  skip_holidays: true,
  charge_staff_fines: false,
  due_soon_days: 2,
  escalate_after_days: 7,
  long_overdue_days: 30,
};

export const round2 = (value: number): number => Math.round(value * 100) / 100;

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

export function isOffDay(date: string, holidays: Set<string>): boolean {
  return WEEKLY_OFF.includes(weekday(date)) || holidays.has(date);
}

export function nextOpenDay(date: string, holidays: Set<string>): string {
  let value = date;
  for (let step = 0; step < 60 && isOffDay(value, holidays); step += 1) value = addDays(value, 1);
  return value;
}

export function loanDays(rules: LoanRules, type: MemberType, override: number | null): number {
  if (override && override > 0) return override;
  return type === 'staff' ? rules.staff_loan_days : rules.student_loan_days;
}

export function bookLimit(rules: LoanRules, type: MemberType, override: number | null): number {
  if (override !== null && override >= 0) return override;
  return type === 'staff' ? rules.staff_max_books : rules.student_max_books;
}

export function dueDateFor(from: string, days: number, skipHolidays: boolean, holidays: Set<string>): string {
  const due = addDays(from, Math.max(1, days));
  return skipHolidays ? nextOpenDay(due, holidays) : due;
}

export function chargeableDays(
  dueDate: string,
  returnedOn: string,
  graceDays: number,
  skipHolidays: boolean,
  holidays: Set<string>,
): number {
  const late = daysBetween(dueDate, returnedOn);
  if (late <= graceDays) return 0;
  let days = 0;
  for (let offset = graceDays + 1; offset <= late; offset += 1) {
    const date = addDays(dueDate, offset);
    if (!skipHolidays || !isOffDay(date, holidays)) days += 1;
  }
  return days;
}

export function overdueFine(days: number, perDay: number, cap: number | null): number {
  const amount = round2(Math.max(0, days) * Math.max(0, perDay));
  return cap !== null && cap > 0 ? Math.min(amount, round2(cap)) : amount;
}

export function lostFine(price: number | null, processingFee: number): number {
  return round2(Math.max(0, Number(price ?? 0)) + Math.max(0, processingFee));
}

export function finesApply(rules: Pick<LoanRules, 'charge_staff_fines'>, type: MemberType): boolean {
  return type === 'student' || rules.charge_staff_fines;
}

export function loanState(
  issue: { status: IssueStatus; due_date: string },
  today: string,
  dueSoonDays: number,
): LoanState {
  if (issue.status === 'returned') return 'returned';
  if (issue.status === 'lost') return 'lost';
  const left = daysBetween(today, issue.due_date);
  if (left < 0) return 'overdue';
  if (left === 0) return 'due_today';
  if (left <= dueSoonDays) return 'due_soon';
  return 'on_loan';
}

export function fineStatus(amount: number, waived: number, paid: number): FineStatus {
  const balance = round2(amount - waived - paid);
  if (balance > 0) return paid > 0 ? 'partly_paid' : 'unpaid';
  return paid > 0 || waived < amount ? 'paid' : 'waived';
}

export function fineAmounts(amount: number, waived: number, paid: number) {
  const balance = round2(Math.max(0, amount - waived - paid));
  return {
    amount: round2(amount),
    waived: round2(waived),
    paid: round2(paid),
    balance,
    status: fineStatus(amount, waived, paid),
  };
}

export interface IssueCheck {
  member_status: MemberStatus;
  person_active: boolean;
  open_loans: number;
  limit: number;
  unpaid_fines: number;
  block_above: number;
  copy_status: CopyStatus;
  is_reference: boolean;
  holds_same_title: boolean;
  basket_size: number;
}

export function issueRefusal(check: IssueCheck): Refusal | null {
  if (check.member_status !== 'active') {
    return { code: 'MEMBER_NOT_ACTIVE', message: `This member is ${check.member_status}` };
  }
  if (!check.person_active) return { code: 'MEMBER_LEFT', message: 'This person has left the school' };
  if (check.copy_status !== 'available') {
    return { code: 'COPY_NOT_AVAILABLE', message: `This copy is ${check.copy_status.replace('_', ' ')}` };
  }
  if (check.is_reference) return { code: 'REFERENCE_ONLY', message: 'Reference books are read in the library only' };
  if (check.holds_same_title) {
    return { code: 'SAME_TITLE_HELD', message: 'The member already has a copy of this book' };
  }
  if (check.open_loans + check.basket_size > check.limit) {
    return {
      code: 'BOOK_LIMIT_REACHED',
      message: `The member can hold ${check.limit} ${check.limit === 1 ? 'book' : 'books'} and already has ${check.open_loans}`,
    };
  }
  if (check.block_above > 0 && check.unpaid_fines > check.block_above) {
    return {
      code: 'FINE_PENDING',
      message: `Unpaid library fines of Rs. ${check.unpaid_fines.toFixed(2)}. Collect the fine before issuing.`,
    };
  }
  return null;
}

export function renewRefusal(
  issue: { status: IssueStatus; due_date: string; renew_count: number },
  today: string,
  rules: Pick<LoanRules, 'max_renewals' | 'grace_days'>,
): Refusal | null {
  if (issue.status !== 'issued') return { code: 'LOAN_CLOSED', message: 'This book is not on loan' };
  if (issue.renew_count >= rules.max_renewals) {
    return {
      code: 'RENEW_LIMIT_REACHED',
      message: `This loan can be renewed ${rules.max_renewals} ${rules.max_renewals === 1 ? 'time' : 'times'}`,
    };
  }
  if (daysBetween(issue.due_date, today) > rules.grace_days) {
    return { code: 'LOAN_OVERDUE', message: 'Overdue books must be returned and the fine settled first' };
  }
  return null;
}

export function reminderKind(
  dueDate: string,
  today: string,
  rules: Pick<LoanRules, 'due_soon_days' | 'escalate_after_days' | 'long_overdue_days'>,
): string | null {
  const late = daysBetween(dueDate, today);
  if (late < 0) return -late <= rules.due_soon_days ? 'due_soon' : null;
  if (late === 0) return 'due_today';
  if (late >= rules.long_overdue_days) return 'long_overdue';
  if (late >= rules.escalate_after_days) {
    const week = Math.floor((late - rules.escalate_after_days) / 7);
    return week === 0 ? 'escalated' : `escalated_w${week}`;
  }
  return 'overdue';
}

export function normalizeIsbn(value: string): string | null {
  const raw = value.replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{13}$/.test(raw)) return isbn13Valid(raw) ? raw : null;
  if (/^\d{9}[\dX]$/.test(raw)) return isbn10Valid(raw) ? isbn10To13(raw) : null;
  return null;
}

function isbn13Valid(code: string): boolean {
  if (!code.startsWith('978') && !code.startsWith('979')) return false;
  const sum = code
    .slice(0, 12)
    .split('')
    .reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === Number(code[12]);
}

function isbn10Valid(code: string): boolean {
  const sum = code
    .split('')
    .reduce((total, char, index) => total + (char === 'X' ? 10 : Number(char)) * (10 - index), 0);
  return sum % 11 === 0;
}

function isbn10To13(code: string): string {
  const body = `978${code.slice(0, 9)}`;
  const sum = body.split('').reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return `${body}${(10 - (sum % 10)) % 10}`;
}

export function accessionNumber(schoolCode: string, value: number): string {
  return `${schoolCode}-${String(value).padStart(6, '0')}`;
}

export function cardNumber(schoolCode: string, type: MemberType, value: number): string {
  return `${schoolCode}-L${type === 'staff' ? 'T' : 'S'}-${String(value).padStart(5, '0')}`;
}

export function fineReason(kind: 'overdue' | 'lost' | 'damage', title: string, days?: number): string {
  if (kind === 'overdue') return `${days} ${days === 1 ? 'day' : 'days'} late: ${title}`.slice(0, 200);
  if (kind === 'lost') return `Lost book: ${title}`.slice(0, 200);
  return `Damaged book: ${title}`.slice(0, 200);
}

export function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60000));
}
