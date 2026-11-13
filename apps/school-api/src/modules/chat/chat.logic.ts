import { addDays } from '../../shared/school-days';

export const PREVIEW_LENGTH = 120;
export const LOOKAHEAD_DAYS = 21;
export const PAGE_SIZE = 30;

export interface OfficeHours {
  start: string;
  end: string;
}

export interface ZonedParts {
  date: string;
  time: string;
  weekday: number;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    weekday: WEEKDAYS[parts.weekday] ?? 0,
  };
}

export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const seen = zonedParts(guess, timeZone);
  const [seenHour, seenMinute] = seen.time.split(':').map(Number);
  const seenUtc = Date.UTC(
    Number(seen.date.slice(0, 4)),
    Number(seen.date.slice(5, 7)) - 1,
    Number(seen.date.slice(8, 10)),
    seenHour,
    seenMinute,
  );
  return new Date(guess.getTime() - (seenUtc - guess.getTime()));
}

function weekdayOf(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function isWorkingDay(date: string, holidays: Set<string>): boolean {
  return weekdayOf(date) <= 6 && !holidays.has(date);
}

export function officeStatus(
  now: Date,
  timeZone: string,
  hours: OfficeHours,
  holidays: Set<string>,
): { open: boolean; next_open_at: Date | null } {
  const today = zonedParts(now, timeZone);
  if (isWorkingDay(today.date, holidays) && today.time >= hours.start && today.time < hours.end) {
    return { open: true, next_open_at: null };
  }
  if (isWorkingDay(today.date, holidays) && today.time < hours.start) {
    return { open: false, next_open_at: zonedToUtc(today.date, hours.start, timeZone) };
  }
  for (let offset = 1; offset <= LOOKAHEAD_DAYS; offset += 1) {
    const day = addDays(today.date, offset);
    if (isWorkingDay(day, holidays)) return { open: false, next_open_at: zonedToUtc(day, hours.start, timeZone) };
  }
  return { open: false, next_open_at: null };
}

export const DELETE_WINDOW_HOURS = 24;
export const EDIT_WINDOW_HOURS = 24;
export const UNDO_SECONDS = 10;
export const VIDEO_MAX_SECONDS = 120;

const KIND_PREVIEW: Record<string, string> = {
  image: 'Photo',
  voice: 'Voice message',
  video: 'Video',
  file: 'Sent a file',
};

export function messageKind(mime: string | null | undefined): 'text' | 'image' | 'file' | 'voice' | 'video' {
  if (!mime) return 'text';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'voice';
  if (mime.startsWith('video/')) return 'video';
  return 'file';
}

export function canDeleteForEveryone(sentAt: Date, now = new Date()): boolean {
  return now.getTime() - sentAt.getTime() <= DELETE_WINDOW_HOURS * 3600 * 1000;
}

export function canEditMessage(sentAt: Date, now = new Date()): boolean {
  return now.getTime() - sentAt.getTime() <= EDIT_WINDOW_HOURS * 3600 * 1000;
}

export function undoUntil(deletedAt: Date | null): Date | null {
  return deletedAt ? new Date(deletedAt.getTime() + UNDO_SECONDS * 1000) : null;
}

export function messagePreview(body: string | null, hasFile: boolean, kind?: string): string {
  if (!body) return hasFile ? (KIND_PREVIEW[kind ?? 'file'] ?? 'Sent a file') : '';
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH - 1).trimEnd()}…` : flat;
}
