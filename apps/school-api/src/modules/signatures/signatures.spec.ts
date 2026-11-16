import {
  actionOf,
  canUseAgain,
  changeImage,
  PARENT_COPY_MESSAGE,
  PARENT_KEPT_MESSAGE,
  shouldCopyToParent,
  signedCaption,
  teacherSaveMessage,
} from './signatures.logic';

describe('actionOf', () => {
  it('names what happened to a signature', () => {
    expect(actionOf(null, 5)).toBe('added');
    expect(actionOf(5, 6)).toBe('changed');
    expect(actionOf(5, null)).toBe('removed');
    expect(actionOf(5, 5)).toBeNull();
    expect(actionOf(null, null)).toBeNull();
  });
});

describe('teacher who is also a parent', () => {
  it('copies the first teacher signature to the parent side only when the parent side is empty', () => {
    expect(shouldCopyToParent(9, null, true)).toBe(true);
    expect(shouldCopyToParent(9, 4, true)).toBe(false);
    expect(shouldCopyToParent(null, null, true)).toBe(false);
    expect(shouldCopyToParent(9, null, false)).toBe(false);
  });

  it('tells them what happened to their Parent app signature', () => {
    expect(teacherSaveMessage(true, true)).toBe(PARENT_COPY_MESSAGE);
    expect(teacherSaveMessage(true, false)).toBe(PARENT_KEPT_MESSAGE);
    expect(teacherSaveMessage(false, false)).toBeNull();
  });
});

describe('signedCaption', () => {
  it('shows the signed date, and the update date when the signature changed later', () => {
    const signed = new Date('2026-11-12T05:00:00Z');
    expect(signedCaption(signed, null, 'Asia/Kolkata')).toBe('Signed 12 Nov 2026');
    expect(signedCaption(signed, new Date('2026-11-16T05:00:00Z'), 'Asia/Kolkata')).toBe(
      'Signed 12 Nov 2026 · updated 16 Nov 2026',
    );
    expect(signedCaption(signed, new Date('2026-11-10T05:00:00Z'), 'Asia/Kolkata')).toBe('Signed 12 Nov 2026');
    expect(signedCaption(null, null, 'Asia/Kolkata')).toBeNull();
  });
});

describe('use an earlier signature again', () => {
  it('offers rows whose image is not the current signature', () => {
    expect(canUseAgain({ old_file_id: null, new_file_id: 4 }, 9)).toBe(true);
    expect(canUseAgain({ old_file_id: null, new_file_id: 9 }, 9)).toBe(false);
    expect(canUseAgain({ old_file_id: 4, new_file_id: null }, null)).toBe(true);
    expect(canUseAgain({ old_file_id: null, new_file_id: null }, null)).toBe(false);
  });

  it('takes the new image, or the removed one for a removal', () => {
    expect(changeImage({ old_file_id: 3, new_file_id: 7 })).toBe(7);
    expect(changeImage({ old_file_id: 3, new_file_id: null })).toBe(3);
  });
});
