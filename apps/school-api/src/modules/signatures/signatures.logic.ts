import type { SignatureAction } from './entities/signature-change.entity';

export const PARENT_COPY_MESSAGE = 'This signature is also set for your Parent app. You can change it there anytime.';
export const PARENT_KEPT_MESSAGE = 'Your Parent app signature stays the same. Change it in the Parent app.';
export const TEACHER_KEPT_MESSAGE = 'Your Staff app signature stays the same. Change it in the Staff app.';
export const COPY_NOTE = 'Copied from the teacher signature';
export const REUSE_NOTE = 'Used an earlier signature again';

export function changeImage(change: { old_file_id: number | null; new_file_id: number | null }): number | null {
  return change.new_file_id ?? change.old_file_id;
}

export function canUseAgain(
  change: { old_file_id: number | null; new_file_id: number | null },
  currentFileId: number | null,
): boolean {
  const fileId = changeImage(change);
  return fileId !== null && fileId !== currentFileId;
}

export function actionOf(oldFileId: number | null, newFileId: number | null): SignatureAction | null {
  if (oldFileId === newFileId) return null;
  if (oldFileId === null) return 'added';
  return newFileId === null ? 'removed' : 'changed';
}

export function shouldCopyToParent(newFileId: number | null, parentFileId: number | null, isAlsoParent: boolean) {
  return isAlsoParent && newFileId !== null && parentFileId === null;
}

export function teacherSaveMessage(isAlsoParent: boolean, copied: boolean): string | null {
  if (!isAlsoParent) return null;
  return copied ? PARENT_COPY_MESSAGE : PARENT_KEPT_MESSAGE;
}

export const shortDate = (value: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone }).format(value);

export function signedCaption(signedAt: Date | null, updatedAt: Date | null, timeZone: string): string | null {
  if (!signedAt) return null;
  const signed = `Signed ${shortDate(signedAt, timeZone)}`;
  return updatedAt && updatedAt > signedAt ? `${signed} · updated ${shortDate(updatedAt, timeZone)}` : signed;
}
