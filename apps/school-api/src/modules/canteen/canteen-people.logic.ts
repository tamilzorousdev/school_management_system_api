import { AppException } from '@app/common';
import { money } from './canteen.logic';
import { FeedbackStatus } from './entities/canteen-people.entity';

export const MAX_REPORT_DAYS = 366;
export const DEFAULT_REPORT_DAYS = 30;

const DAY_MS = 86_400_000;

const toUtc = (date: string): number => {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year!, month! - 1, day);
};

export const addDays = (date: string, days: number): string =>
  new Date(toUtc(date) + days * DAY_MS).toISOString().slice(0, 10);

export const daysBetween = (from: string, to: string): number => Math.round((toUtc(to) - toUtc(from)) / DAY_MS);

export interface DateRange {
  from: string;
  to: string;
}

export function resolveRange(from: string | undefined, to: string | undefined, today: string): DateRange {
  const end = to ?? today;
  const start = from ?? addDays(end, -(DEFAULT_REPORT_DAYS - 1));
  if (start > end) throw AppException.badRequest('from must not be after to', 'REPORT_RANGE_INVALID');
  if (daysBetween(start, end) + 1 > MAX_REPORT_DAYS) {
    throw AppException.badRequest(`The range can cover at most ${MAX_REPORT_DAYS} days`, 'REPORT_RANGE_INVALID');
  }
  return { from: start, to: end };
}

export function datesInRange(range: DateRange): string[] {
  const days = daysBetween(range.from, range.to);
  return Array.from({ length: days + 1 }, (_, index) => addDays(range.from, index));
}

export function monthRange(month: string): DateRange {
  const [year, number] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year!, number!, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

export const percent = (part: number, total: number): number => (total <= 0 ? 0 : money((part / total) * 100));

export function ratingDistribution(ratings: number[]): Record<'1' | '2' | '3' | '4' | '5', number> {
  const counts = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  for (const rating of ratings) {
    const key = String(rating) as keyof typeof counts;
    if (key in counts) counts[key] += 1;
  }
  return counts;
}

export function averageRating(ratings: number[]): number | null {
  if (ratings.length === 0) return null;
  return money(ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length);
}

export interface WageInput {
  present: number;
  half_day: number;
  daily_wage: number | null;
}

export function wageEstimate({ present, half_day, daily_wage }: WageInput): number {
  if (!daily_wage) return 0;
  return money(present * daily_wage + (half_day * daily_wage) / 2);
}

export interface ResolutionSpan {
  created_at: Date;
  resolved_at: Date | null;
}

export function averageResolutionHours(spans: ResolutionSpan[]): number | null {
  const done = spans.filter((span) => span.resolved_at !== null);
  if (done.length === 0) return null;
  const hours = done.map((span) => (span.resolved_at!.getTime() - span.created_at.getTime()) / 3_600_000);
  return money(hours.reduce((sum, value) => sum + value, 0) / hours.length);
}

const FEEDBACK_FLOW: Record<FeedbackStatus, FeedbackStatus[]> = {
  open: ['in_progress', 'resolved'],
  in_progress: ['resolved'],
  resolved: ['closed', 'open'],
  closed: [],
};

export const canMoveFeedback = (from: FeedbackStatus, to: FeedbackStatus): boolean =>
  FEEDBACK_FLOW[from]?.includes(to) ?? false;

export function withShare<T>(rows: T[], amountOf: (row: T) => number): (T & { share_percent: number })[] {
  const total = rows.reduce((sum, row) => sum + amountOf(row), 0);
  return rows.map((row) => ({ ...row, share_percent: percent(amountOf(row), total) }));
}

const csvCell = (value: string | number | null): string => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

export function profitOf(revenue: number, purchases: number, waste: number, wages: number): number {
  return money(revenue - purchases - waste - wages);
}
