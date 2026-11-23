import { createHash } from 'crypto';
import { FieldChanges, SubmissionType } from './entities/alumni-records.entity';

export const UPDATE_LINK_DAYS = 14;
export const MAX_PENDING_PER_MOBILE = 3;
export const MAX_PUBLIC_PER_HOUR = 50;

export const CONTACT_FIELDS = [
  'mobile',
  'alt_mobile',
  'email',
  'address_line',
  'city',
  'state',
  'pincode',
  'country',
  'linkedin_url',
  'contact_consent',
] as const;

export const CAREER_FIELDS = ['occupation_status', 'institution', 'course', 'organization', 'designation'] as const;

export const IDENTITY_FIELDS = [
  'first_name',
  'last_name',
  'gender',
  'dob',
  'admission_no',
  'batch_year',
  'final_class_name',
] as const;

export const SELF_UPDATE_FIELDS = [...CONTACT_FIELDS, ...CAREER_FIELDS] as const;
export const SELF_REGISTER_FIELDS = [...IDENTITY_FIELDS, ...CONTACT_FIELDS, ...CAREER_FIELDS] as const;

export const PROFILE_FIELDS = [
  ...IDENTITY_FIELDS,
  ...CONTACT_FIELDS,
  ...CAREER_FIELDS,
  'photo_file_id',
  'admission_date',
  'left_on',
  'exit_type',
  'final_academic_year_name',
  'final_section_name',
  'final_percent',
  'final_grade',
  'final_result',
  'tc_no',
  'notes',
] as const;

export function batchYearOf(date: string): number {
  return Number(date.slice(0, 4));
}

export function alumniNumber(schoolCode: string, batchYear: number, sequence: number): string {
  return `${schoolCode}-AL-${batchYear}-${String(sequence).padStart(4, '0')}`;
}

export function finalGradeLevel(classes: { grade_level: number | null }[]): number | null {
  const levels = classes.map((row) => row.grade_level).filter((level): level is number => level !== null);
  return levels.length ? Math.max(...levels) : null;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function linkExpiry(now: Date, days = UPDATE_LINK_DAYS): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

export function linkUsable(link: { expires_at: Date; used_at: Date | null }, now: Date): boolean {
  return link.used_at === null && link.expires_at.getTime() > now.getTime();
}

export function submissionBlock(pendingForMobile: number, schoolLastHour: number): string | null {
  if (schoolLastHour >= MAX_PUBLIC_PER_HOUR) return 'TOO_MANY_SUBMISSIONS';
  if (pendingForMobile >= MAX_PENDING_PER_MOBILE) return 'SUBMISSION_PENDING';
  return null;
}

export function allowedFields(type: SubmissionType): readonly string[] {
  return type === 'registration' ? SELF_REGISTER_FIELDS : SELF_UPDATE_FIELDS;
}

export function pickFields(source: object, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const value = (source as Record<string, unknown>)[field];
    if (value !== undefined) out[field] = value;
  }
  return out;
}

function comparable(value: unknown): unknown {
  if (value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

export function diffFields(before: object, after: Record<string, unknown>): FieldChanges {
  const changes: FieldChanges = {};
  for (const [field, next] of Object.entries(after)) {
    if (next === undefined) continue;
    const prev = comparable((before as Record<string, unknown>)[field]);
    const value = comparable(next);
    const same =
      typeof prev === 'string' && typeof value === 'number' ? Number(prev) === value : String(prev) === String(value);
    if (!same || (prev === null) !== (value === null)) changes[field] = [prev, value];
  }
  return changes;
}

export function fullName(first: string, last: string | null): string {
  return [first, last].filter(Boolean).join(' ');
}

export function isReachable(row: { mobile: string | null; email: string | null; contact_consent: boolean }): boolean {
  return row.contact_consent && Boolean(row.mobile || row.email);
}
