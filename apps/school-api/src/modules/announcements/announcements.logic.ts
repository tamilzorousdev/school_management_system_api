import { FieldError } from '@app/common';
import { AnnouncementAudience, AnnouncementStatus } from './entities/announcement.entity';

export const MAX_ATTACHMENTS = 5;
export const MAX_SCHEDULE_DAYS = 60;
export const PREVIEW_LENGTH = 120;
export const EDITABLE_STATUSES: AnnouncementStatus[] = ['draft', 'scheduled'];
export const MAX_INDIVIDUALS = 200;
export const ATTACHMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

const MINUTE_MS = 60_000;

export function canEdit(status: AnnouncementStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}

export function canChangeContent(status: AnnouncementStatus): boolean {
  return status !== 'archived';
}

export function attachmentError(mimeType: string): string | null {
  return ATTACHMENT_TYPES.includes(mimeType) ? null : 'Attach a PDF or an image (JPG, PNG or WEBP)';
}

export function sameIds(a: number[], b: number[]): boolean {
  const left = [...new Set(a)].sort((x, y) => x - y);
  const right = [...new Set(b)].sort((x, y) => x - y);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function audienceErrors(
  audience: AnnouncementAudience,
  classIds: number[] | undefined,
  sectionIds: number[] | undefined,
  studentIds: number[] | undefined = undefined,
  staffIds: number[] | undefined = undefined,
): FieldError[] {
  if (audience === 'individuals') {
    return studentIds?.length || staffIds?.length
      ? []
      : [{ field: 'student_ids', message: 'Choose at least one student or staff member' }];
  }
  if (audience !== 'classes') return [];
  if (!(classIds?.length || sectionIds?.length)) {
    return [{ field: 'class_ids', message: 'Choose at least one class or section' }];
  }
  return [];
}

export function timingErrors(publishAt: Date | null, expiresAt: Date | null, now: Date): FieldError[] {
  const errors: FieldError[] = [];
  if (publishAt) {
    if (publishAt.getTime() < now.getTime() - MINUTE_MS) {
      errors.push({ field: 'publish_at', message: 'The publish time has already passed' });
    } else if (publishAt.getTime() > now.getTime() + MAX_SCHEDULE_DAYS * 24 * 60 * MINUTE_MS) {
      errors.push({ field: 'publish_at', message: `Schedule up to ${MAX_SCHEDULE_DAYS} days ahead` });
    }
  }
  if (expiresAt && expiresAt <= (publishAt ?? now)) {
    errors.push({ field: 'expires_at', message: 'The expiry must be after the announcement goes out' });
  }
  return errors;
}

export function statusForPublish(publishAt: Date | null, now: Date): AnnouncementStatus {
  return publishAt && publishAt.getTime() > now.getTime() + MINUTE_MS ? 'scheduled' : 'published';
}

export function isVisible(announcement: { status: AnnouncementStatus; expires_at: Date | null }, now: Date): boolean {
  return announcement.status === 'published' && (!announcement.expires_at || announcement.expires_at > now);
}

export function preview(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH - 1).trimEnd()}…` : flat;
}

export function readPercent(recipients: number, read: number): number {
  return recipients ? Math.round((read / recipients) * 100) : 0;
}
