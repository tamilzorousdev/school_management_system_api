import {
  attachmentError,
  audienceErrors,
  canChangeContent,
  canEdit,
  isVisible,
  preview,
  readPercent,
  sameIds,
  statusForPublish,
  timingErrors,
} from './announcements.logic';

const at = (time: string) => new Date(`2026-11-10T${time}:00+05:30`);

describe('announcement audience', () => {
  it('needs a class or section when sent to classes', () => {
    expect(audienceErrors('classes', [], [])[0]?.field).toBe('class_ids');
    expect(audienceErrors('classes', [3], undefined)).toEqual([]);
    expect(audienceErrors('classes', undefined, [4])).toEqual([]);
    expect(audienceErrors('parents', undefined, undefined)).toEqual([]);
  });
});

describe('scheduling', () => {
  const now = at('09:00');

  it('schedules a future time and publishes now or a moment ago', () => {
    expect(statusForPublish(at('10:00'), now)).toBe('scheduled');
    expect(statusForPublish(null, now)).toBe('published');
    expect(statusForPublish(at('09:00'), now)).toBe('published');
  });

  it('refuses a past publish time, more than 60 days ahead, or an expiry before it goes out', () => {
    expect(timingErrors(at('08:00'), null, now)[0]?.field).toBe('publish_at');
    expect(timingErrors(new Date('2027-02-01T09:00:00+05:30'), null, now)[0]?.field).toBe('publish_at');
    expect(timingErrors(at('10:00'), at('09:30'), now)[0]?.field).toBe('expires_at');
    expect(timingErrors(null, at('08:30'), now)[0]?.field).toBe('expires_at');
    expect(timingErrors(at('10:00'), at('18:00'), now)).toEqual([]);
  });

  it('can edit only drafts and scheduled ones', () => {
    expect(canEdit('draft')).toBe(true);
    expect(canEdit('scheduled')).toBe(true);
    expect(canEdit('published')).toBe(false);
    expect(canEdit('archived')).toBe(false);
  });
});

describe('feed', () => {
  it('shows only published announcements that have not expired', () => {
    const now = at('12:00');
    expect(isVisible({ status: 'published', expires_at: null }, now)).toBe(true);
    expect(isVisible({ status: 'published', expires_at: at('13:00') }, now)).toBe(true);
    expect(isVisible({ status: 'published', expires_at: at('11:00') }, now)).toBe(false);
    expect(isVisible({ status: 'archived', expires_at: null }, now)).toBe(false);
  });

  it('builds a one-line push preview', () => {
    expect(preview('Short\n\nnote')).toBe('Short note');
    const long = preview('word '.repeat(60));
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long.endsWith('…')).toBe(true);
  });

  it('works out the read percent', () => {
    expect(readPercent(200, 50)).toBe(25);
    expect(readPercent(0, 0)).toBe(0);
  });
});

describe('individual audience and attachments', () => {
  it('needs at least one student or staff member', () => {
    expect(audienceErrors('individuals', undefined, undefined, [], [])).toEqual([
      { field: 'student_ids', message: 'Choose at least one student or staff member' },
    ]);
    expect(audienceErrors('individuals', undefined, undefined, [12], [])).toEqual([]);
    expect(audienceErrors('individuals', undefined, undefined, [], [31])).toEqual([]);
  });

  it('allows only PDF and images', () => {
    expect(attachmentError('application/pdf')).toBeNull();
    expect(attachmentError('image/png')).toBeNull();
    expect(attachmentError('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(
      'Attach a PDF or an image (JPG, PNG or WEBP)',
    );
  });

  it('lets a sent announcement change its content until it is archived', () => {
    expect(canChangeContent('published')).toBe(true);
    expect(canChangeContent('draft')).toBe(true);
    expect(canChangeContent('archived')).toBe(false);
  });

  it('compares target lists in any order', () => {
    expect(sameIds([3, 1, 2], [1, 2, 3])).toBe(true);
    expect(sameIds([1, 1, 2], [2, 1])).toBe(true);
    expect(sameIds([1, 2], [1, 2, 4])).toBe(false);
  });
});
