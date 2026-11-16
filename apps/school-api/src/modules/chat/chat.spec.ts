import {
  canDeleteForEveryone,
  canEditMessage,
  isWorkingDay,
  messageKind,
  messagePreview,
  officeStatus,
  undoUntil,
  zonedParts,
  zonedToUtc,
  directoryDetail,
  groupEventText,
  groupParty,
  NO_LONGER_MEMBER,
} from './chat.logic';

const TZ = 'Asia/Kolkata';
const hours = { start: '08:00', end: '17:00' };
const ist = (value: string) => new Date(`${value}+05:30`);

describe('office hours (Monday to Saturday, not on holidays)', () => {
  it('is open on a Wednesday afternoon', () => {
    expect(officeStatus(ist('2026-11-11T14:00:00'), TZ, hours, new Set())).toEqual({ open: true, next_open_at: null });
  });

  it('holds a message sent before 8 am until 8 am the same day', () => {
    const status = officeStatus(ist('2026-11-11T06:30:00'), TZ, hours, new Set());
    expect(status.open).toBe(false);
    expect(status.next_open_at?.toISOString()).toBe(ist('2026-11-11T08:00:00').toISOString());
  });

  it('holds an evening message until 8 am the next day', () => {
    const status = officeStatus(ist('2026-11-11T19:45:00'), TZ, hours, new Set());
    expect(status.next_open_at?.toISOString()).toBe(ist('2026-11-12T08:00:00').toISOString());
  });

  it('treats 5 pm as closed', () => {
    expect(officeStatus(ist('2026-11-11T17:00:00'), TZ, hours, new Set()).open).toBe(false);
  });

  it('skips Sunday: a Saturday evening message reaches the teacher on Monday', () => {
    const status = officeStatus(ist('2026-11-14T18:00:00'), TZ, hours, new Set());
    expect(status.next_open_at?.toISOString()).toBe(ist('2026-11-16T08:00:00').toISOString());
  });

  it('skips holidays', () => {
    const holidays = new Set(['2026-11-12', '2026-11-13']);
    expect(officeStatus(ist('2026-11-12T10:00:00'), TZ, hours, holidays).open).toBe(false);
    const status = officeStatus(ist('2026-11-11T20:00:00'), TZ, hours, holidays);
    expect(status.next_open_at?.toISOString()).toBe(ist('2026-11-14T08:00:00').toISOString());
  });

  it('knows working days', () => {
    expect(isWorkingDay('2026-11-14', new Set())).toBe(true);
    expect(isWorkingDay('2026-11-15', new Set())).toBe(false);
  });
});

describe('time zone helpers', () => {
  it('reads the school date, time and weekday', () => {
    expect(zonedParts(new Date('2026-11-11T20:00:00Z'), TZ)).toEqual({ date: '2026-11-12', time: '01:30', weekday: 4 });
  });

  it('turns a school wall-clock time into UTC', () => {
    expect(zonedToUtc('2026-11-12', '08:00', TZ).toISOString()).toBe('2026-11-12T02:30:00.000Z');
  });
});

describe('message preview', () => {
  it('flattens the text and shows files', () => {
    expect(messagePreview('Hello\n\nthere', false)).toBe('Hello there');
    expect(messagePreview(null, true)).toBe('Sent a file');
    expect(messagePreview('x'.repeat(200), false).length).toBeLessThanOrEqual(120);
  });
});

describe('chat delete and media', () => {
  it('tells the kind of message from the file type', () => {
    expect(messageKind(null)).toBe('text');
    expect(messageKind('image/jpeg')).toBe('image');
    expect(messageKind('audio/mp4')).toBe('voice');
    expect(messageKind('video/mp4')).toBe('video');
    expect(messageKind('application/pdf')).toBe('file');
  });

  it('shows a preview for voice and video', () => {
    expect(messagePreview(null, true, 'voice')).toBe('Voice message');
    expect(messagePreview(null, true, 'video')).toBe('Video');
    expect(messagePreview(null, true, 'image')).toBe('Photo');
    expect(messagePreview(null, true)).toBe('Sent a file');
  });

  it('allows delete for everyone within 24 hours and undo within 10 seconds', () => {
    const now = new Date('2026-11-12T12:00:00Z');
    expect(canDeleteForEveryone(new Date('2026-11-11T12:30:00Z'), now)).toBe(true);
    expect(canDeleteForEveryone(new Date('2026-11-11T11:30:00Z'), now)).toBe(false);
    expect(undoUntil(now)?.toISOString()).toBe('2026-11-12T12:00:10.000Z');
    expect(undoUntil(null)).toBeNull();
  });

  it('allows edit within 24 hours', () => {
    const now = new Date('2026-11-12T12:00:00Z');
    expect(canEditMessage(new Date('2026-11-11T12:30:00Z'), now)).toBe(true);
    expect(canEditMessage(new Date('2026-11-11T11:30:00Z'), now)).toBe(false);
  });
});

describe('group notices', () => {
  const arun = { id: 7, name: 'Arun Prakash' };
  const kala = { id: 9, name: 'Kala Prabhu' };

  it('words a removal for the remover, the removed person and everyone else', () => {
    expect(groupEventText('member_removed', arun, kala, 7)).toBe('You removed Kala Prabhu');
    expect(groupEventText('member_removed', arun, kala, 9)).toBe(
      `Arun Prakash removed you from this group. ${NO_LONGER_MEMBER}`,
    );
    expect(groupEventText('member_removed', arun, kala, 3)).toBe('Arun Prakash removed Kala Prabhu');
    expect(groupEventText('member_removed', arun, kala, null)).toBe('Arun Prakash removed Kala Prabhu');
  });

  it('words leaving, adding and a new admin', () => {
    expect(groupEventText('member_left', kala, null, 9)).toBe(`You left this group. ${NO_LONGER_MEMBER}`);
    expect(groupEventText('member_left', kala, null, 7)).toBe('Kala Prabhu left the group');
    expect(groupEventText('member_added', arun, kala, 9)).toBe('Arun Prakash added you');
    expect(groupEventText('member_added', arun, kala, 7)).toBe('You added Kala Prabhu');
    expect(groupEventText('admin_changed', arun, kala, 9)).toBe('You are now the group admin');
    expect(groupEventText('admin_changed', arun, kala, 7)).toBe('Kala Prabhu is now the group admin');
  });

  it('sends staff as the teacher side and parents as the parent side', () => {
    expect(groupParty({ roles: ['TEACHER', 'PARENT'] })).toBe('teacher');
    expect(groupParty({ roles: ['PARENT'] })).toBe('parent');
  });
});

describe('directory detail line', () => {
  it('lists classes led, classes taught and children', () => {
    expect(
      directoryDetail(
        [{ name: 'Nila Narayanan', class_section: '7 - A' }],
        [
          { class_section: '7 - A', class_teacher: true },
          { class_section: '3 - A', class_teacher: false },
        ],
      ),
    ).toBe('Class teacher 7 - A · Teaches 3 - A · Parent of Nila Narayanan (7 - A)');
    expect(directoryDetail([], [])).toBeNull();
  });
});
