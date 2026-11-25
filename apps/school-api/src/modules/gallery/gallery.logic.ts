import type {
  AlbumScope,
  AlbumStatus,
  CleanupFrequency,
  ImageFormat,
  MediaType,
  PolicyTarget,
  RetentionUnit,
  VideoFormat,
  Visibility,
} from './entities/gallery.entity';

export const DAY_MS = 86_400_000;

export interface SniffedFormat {
  media_type: MediaType;
  format: ImageFormat | VideoFormat;
  mime_type: string;
  extension: string;
}

const ascii = (buffer: Buffer, start: number, end: number) => buffer.subarray(start, end).toString('latin1');

export function sniffFormat(buffer: Buffer): SniffedFormat | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { media_type: 'image', format: 'jpeg', mime_type: 'image/jpeg', extension: '.jpg' };
  }
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { media_type: 'image', format: 'png', mime_type: 'image/png', extension: '.png' };
  }
  if (ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 12) === 'WEBP') {
    return { media_type: 'image', format: 'webp', mime_type: 'image/webp', extension: '.webp' };
  }
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return { media_type: 'video', format: 'webm', mime_type: 'video/webm', extension: '.webm' };
  }
  if (ascii(buffer, 4, 8) === 'ftyp') {
    const brand = ascii(buffer, 8, 12);
    if (/^(heic|heix|hevc|heim|heis|mif1|msf1|avif|avis)$/.test(brand)) return null;
    if (brand === 'qt  ')
      return { media_type: 'video', format: 'mov', mime_type: 'video/quicktime', extension: '.mov' };
    if (brand.startsWith('3g'))
      return { media_type: 'video', format: '3gp', mime_type: 'video/3gpp', extension: '.3gp' };
    return { media_type: 'video', format: 'mp4', mime_type: 'video/mp4', extension: '.mp4' };
  }
  return null;
}

interface Box {
  type: string;
  start: number;
  end: number;
}

function boxes(buffer: Buffer, from: number, to: number): Box[] {
  const found: Box[] = [];
  let offset = from;
  while (offset + 8 <= to) {
    let size = buffer.readUInt32BE(offset);
    const type = ascii(buffer, offset + 4, offset + 8);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > to) break;
      size = Number(buffer.readBigUInt64BE(offset + 8));
      header = 16;
    } else if (size === 0) {
      size = to - offset;
    }
    if (size < header || offset + size > to) break;
    found.push({ type, start: offset + header, end: offset + size });
    offset += size;
  }
  return found;
}

export function isoVideoSeconds(buffer: Buffer): number | null {
  try {
    const moov = boxes(buffer, 0, buffer.length).find((box) => box.type === 'moov');
    if (!moov) return null;
    const mvhd = boxes(buffer, moov.start, moov.end).find((box) => box.type === 'mvhd');
    if (!mvhd) return null;
    const version = buffer[mvhd.start];
    const timescale = version === 1 ? buffer.readUInt32BE(mvhd.start + 20) : buffer.readUInt32BE(mvhd.start + 12);
    const duration =
      version === 1 ? Number(buffer.readBigUInt64BE(mvhd.start + 24)) : buffer.readUInt32BE(mvhd.start + 16);
    if (!timescale) return null;
    return Math.round(duration / timescale);
  } catch {
    return null;
  }
}

export function addPeriod(from: Date, value: number, unit: RetentionUnit): Date {
  if (unit === 'days') return new Date(from.getTime() + value * DAY_MS);
  const months = unit === 'years' ? value * 12 : value;
  const target = new Date(from.getTime());
  const day = target.getUTCDate();
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

export interface PolicyRule {
  id: number;
  target: PolicyTarget;
  album_id: number | null;
  category_id: number | null;
  academic_year_id: number | null;
  scope: AlbumScope | null;
  media_type: MediaType | null;
  retention_value: number | null;
  retention_unit: RetentionUnit | null;
  keep_forever: boolean;
  is_active: boolean;
}

export interface RetentionSubject {
  album_id: number;
  album_status: AlbumStatus;
  category_id: number | null;
  academic_year_id: number;
  scope: AlbumScope;
  media_type: MediaType;
}

export interface RetentionDefault {
  retention_value: number;
  retention_unit: RetentionUnit;
}

export interface Retention {
  forever: boolean;
  value: number | null;
  unit: RetentionUnit | null;
  source: string;
}

const PRECEDENCE: PolicyTarget[] = ['album', 'archived', 'category', 'academic_year', 'scope', 'media_type'];

function policyMatches(policy: PolicyRule, subject: RetentionSubject): boolean {
  switch (policy.target) {
    case 'album':
      return policy.album_id === subject.album_id;
    case 'archived':
      return subject.album_status === 'archived';
    case 'category':
      return subject.category_id !== null && policy.category_id === subject.category_id;
    case 'academic_year':
      return policy.academic_year_id === subject.academic_year_id;
    case 'scope':
      return policy.scope === subject.scope;
    case 'media_type':
      return policy.media_type === subject.media_type;
  }
}

export function resolveRetention(
  subject: RetentionSubject,
  policies: PolicyRule[],
  fallback: RetentionDefault,
): Retention {
  const active = policies.filter((policy) => policy.is_active);
  for (const target of PRECEDENCE) {
    const policy = active.find((item) => item.target === target && policyMatches(item, subject));
    if (!policy) continue;
    if (policy.keep_forever) return { forever: true, value: null, unit: null, source: `policy:${policy.id}` };
    return {
      forever: false,
      value: policy.retention_value,
      unit: policy.retention_unit,
      source: `policy:${policy.id}`,
    };
  }
  return { forever: false, value: fallback.retention_value, unit: fallback.retention_unit, source: 'default' };
}

export function expiryFor(uploadedAt: Date, retention: Retention): Date | null {
  if (retention.forever || !retention.value || !retention.unit) return null;
  return addPeriod(uploadedAt, retention.value, retention.unit);
}

export function trashDateFor(expiresAt: Date, now: Date, noticeDays: number): Date {
  const earliest = now.getTime() + noticeDays * DAY_MS;
  return new Date(Math.max(expiresAt.getTime(), earliest));
}

export function retentionDays(value: number, unit: RetentionUnit): number {
  if (unit === 'days') return value;
  return unit === 'months' ? value * 30 : value * 365;
}

export interface HoldWindow {
  keep_until: string | null;
  released_at: Date | null;
}

export function holdActive(hold: HoldWindow, today: string): boolean {
  return hold.released_at === null && (hold.keep_until === null || hold.keep_until >= today);
}

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return { year: +parts.year, month: +parts.month, day: +parts.day, hour: +parts.hour, minute: +parts.minute };
}

function offsetMs(instant: number, timeZone: string): number {
  const parts = zonedParts(new Date(instant), timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return asUtc - Math.floor(instant / 60_000) * 60_000;
}

export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, zone: string) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetMs(guess, zone);
  return new Date(guess - offsetMs(first, zone));
}

export interface Schedule {
  cleanup_frequency: CleanupFrequency;
  cleanup_time: string;
  cleanup_weekday: number;
  cleanup_month_day: number;
  time_zone: string;
}

export function nextRunAfter(schedule: Schedule, from: Date): Date {
  const [hour, minute] = schedule.cleanup_time.split(':').map(Number);
  const today = zonedParts(from, schedule.time_zone);
  for (let offset = 0; offset <= 62; offset += 1) {
    const local = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    const isoWeekday = local.getUTCDay() === 0 ? 7 : local.getUTCDay();
    const due =
      schedule.cleanup_frequency === 'daily' ||
      (schedule.cleanup_frequency === 'weekly' && isoWeekday === schedule.cleanup_weekday) ||
      (schedule.cleanup_frequency === 'monthly' && local.getUTCDate() === schedule.cleanup_month_day);
    if (!due) continue;
    const instant = zonedToUtc(
      local.getUTCFullYear(),
      local.getUTCMonth() + 1,
      local.getUTCDate(),
      hour!,
      minute!,
      schedule.time_zone,
    );
    if (instant.getTime() > from.getTime()) return instant;
  }
  return new Date(from.getTime() + DAY_MS);
}

export interface AlbumAccessFacts {
  scope: AlbumScope;
  status: AlbumStatus;
  visibility: Visibility;
  academic_year_id: number;
  class_id: number | null;
  section_id: number | null;
  class_ids: number[] | null;
  section_ids: number[] | null;
  created_by: number | null;
}

export interface Viewer {
  user_id: number;
  can_view_all: boolean;
  can_manage_all: boolean;
  is_staff: boolean;
  is_parent: boolean;
  teaching_sections: number[];
  teaching_classes: string[];
  class_teacher_sections: number[];
  class_teacher_classes: string[];
  child_sections: number[];
  child_classes: string[];
}

export const classKey = (yearId: number, classId: number) => `${yearId}:${classId}`;

function teaches(album: AlbumAccessFacts, viewer: Viewer): boolean {
  if (album.scope === 'section')
    return album.section_id !== null && viewer.teaching_sections.includes(album.section_id);
  if (album.scope === 'class') {
    return (
      album.class_id !== null && viewer.teaching_classes.includes(classKey(album.academic_year_id, album.class_id))
    );
  }
  return false;
}

function leadsClass(album: AlbumAccessFacts, viewer: Viewer): boolean {
  if (album.scope === 'section') {
    return album.section_id !== null && viewer.class_teacher_sections.includes(album.section_id);
  }
  if (album.scope === 'class') {
    return (
      album.class_id !== null && viewer.class_teacher_classes.includes(classKey(album.academic_year_id, album.class_id))
    );
  }
  return false;
}

function childIn(album: AlbumAccessFacts, viewer: Viewer): boolean {
  if (album.scope === 'section') return album.section_id !== null && viewer.child_sections.includes(album.section_id);
  if (album.scope === 'class') {
    return album.class_id !== null && viewer.child_classes.includes(classKey(album.academic_year_id, album.class_id));
  }
  if (album.visibility !== 'classes') return true;
  const inClass = (album.class_ids ?? []).some((id) =>
    viewer.child_classes.includes(classKey(album.academic_year_id, id)),
  );
  const inSection = (album.section_ids ?? []).some((id) => viewer.child_sections.includes(id));
  return inClass || inSection;
}

export function canManageAlbum(album: AlbumAccessFacts, viewer: Viewer): boolean {
  if (viewer.can_manage_all) return true;
  if (!viewer.is_staff || album.scope === 'school') return false;
  if (leadsClass(album, viewer)) return true;
  return album.created_by === viewer.user_id && teaches(album, viewer);
}

export function canViewAlbum(album: AlbumAccessFacts, viewer: Viewer): boolean {
  if (viewer.can_view_all || viewer.can_manage_all) return true;
  if (album.status === 'draft') return canManageAlbum(album, viewer);
  const staffSees =
    viewer.is_staff &&
    (album.scope === 'school' ? album.visibility !== 'parents' : teaches(album, viewer) || leadsClass(album, viewer));
  if (staffSees) return true;
  if (!viewer.is_parent || album.status === 'archived') return false;
  if (album.visibility === 'staff') return false;
  return childIn(album, viewer);
}

export function canUploadTo(
  target: { scope: AlbumScope; academic_year_id: number; class_id: number | null; section_id: number | null },
  viewer: Viewer,
): boolean {
  if (viewer.can_manage_all) return true;
  if (!viewer.is_staff || target.scope === 'school') return false;
  const facts: AlbumAccessFacts = {
    ...target,
    status: 'published',
    visibility: 'everyone',
    class_ids: null,
    section_ids: null,
    created_by: null,
  };
  return teaches(facts, viewer) || leadsClass(facts, viewer);
}

export function canDeleteMedia(
  album: AlbumAccessFacts,
  media: { created_by: number | null },
  viewer: Viewer,
  teachersDeleteOwn: boolean,
): boolean {
  if (viewer.can_manage_all) return true;
  if (!viewer.is_staff) return false;
  if (leadsClass(album, viewer)) return true;
  return teachersDeleteOwn && media.created_by === viewer.user_id && teaches(album, viewer);
}

export function visibilityProblem(
  scope: AlbumScope,
  visibility: Visibility,
  classIds: number[] | null | undefined,
  sectionIds: number[] | null | undefined,
): string | null {
  if (scope !== 'school' && !['everyone', 'staff'].includes(visibility)) {
    return 'Class and section albums can be seen by everyone in that class or section, or by staff only';
  }
  if (scope === 'school' && visibility === 'classes' && !classIds?.length && !sectionIds?.length) {
    return 'Choose at least one class or section for this album';
  }
  return null;
}

export function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const clean = tag.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40);
    if (clean) seen.add(clean);
  }
  return [...seen].slice(0, 20);
}

export function safeFileName(name: string, extension: string): string {
  const base =
    name
      .replace(/[^\w.\- ]+/g, '')
      .trim()
      .slice(0, 200) || 'media';
  return base.toLowerCase().endsWith(extension) ? base : `${base.replace(/\.[^.]*$/, '')}${extension}`;
}

export function storageLevel(usedBytes: number, quotaMb: number, warningPercent: number): 'ok' | 'warning' | 'full' {
  const quota = quotaMb * 1024 * 1024;
  if (quota <= 0) return 'ok';
  if (usedBytes >= quota) return 'full';
  return usedBytes >= (quota * warningPercent) / 100 ? 'warning' : 'ok';
}

export const DEFAULT_CATEGORIES: { key: string; name: string }[] = [
  { key: 'school_events', name: 'School events' },
  { key: 'sports', name: 'Sports' },
  { key: 'cultural', name: 'Cultural activities' },
  { key: 'annual_day', name: 'Annual day' },
  { key: 'independence_day', name: 'Independence Day' },
  { key: 'republic_day', name: 'Republic Day' },
  { key: 'educational', name: 'Educational activities' },
  { key: 'classroom', name: 'Classroom activities' },
  { key: 'excursions', name: 'Excursions' },
  { key: 'achievements', name: 'Achievements' },
  { key: 'other', name: 'Other' },
];

const RANGE = /^bytes=(\d*)-(\d*)$/;

export function parseRange(header: string, size: number): { start: number; end: number } | 'invalid' | null {
  const match = header.trim().match(RANGE);
  if (!match || size <= 0) return null;
  const [, from, to] = match;
  if (!from && !to) return 'invalid';
  const start = from ? Number(from) : Math.max(size - Number(to), 0);
  const end = from ? (to ? Math.min(Number(to), size - 1) : size - 1) : size - 1;
  if (start > end || start >= size) return 'invalid';
  return { start, end };
}

const NAMED = /(?<!:):([a-z][a-z_]*)\b/g;

export function bindNamed(sql: string, values: Record<string, unknown>): [string, unknown[]] {
  const params: unknown[] = [];
  const positions = new Map<string, number>();
  const text = sql.replace(NAMED, (whole, name: string) => {
    if (!(name in values)) return whole;
    if (!positions.has(name)) {
      params.push(values[name]);
      positions.set(name, params.length);
    }
    return `$${positions.get(name)}`;
  });
  return [text, params];
}
