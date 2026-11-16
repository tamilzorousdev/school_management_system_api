import {
  afterFailure,
  EMERGENCY_TEMPLATES,
  MAX_ATTEMPTS,
  mergeRecipients,
  rollupStatus,
  share,
  startingStatus,
  textFor,
} from './emergency.logic';

const zero = { pending: 0, sending: 0, sent: 0, failed: 0, skipped: 0 };

describe('mergeRecipients', () => {
  it('sends one message per parent even with several children, and lists every child', () => {
    const merged = mergeRecipients([
      {
        kind: 'parent',
        user_id: 9,
        guardian_id: 3,
        name: 'Lakshmi',
        mobile: '9000000005',
        language: 'ta',
        student_id: 1,
        student_name: 'Kavin',
        section: '6 - A',
      },
      {
        kind: 'parent',
        user_id: 9,
        guardian_id: 3,
        name: 'Lakshmi',
        mobile: '9000000005',
        language: 'ta',
        student_id: 2,
        student_name: 'Nila',
        section: '3 - B',
      },
      {
        kind: 'parent',
        user_id: 9,
        guardian_id: 3,
        name: 'Lakshmi',
        mobile: '9000000005',
        language: 'ta',
        student_id: 2,
        student_name: 'Nila',
        section: '3 - B',
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.students.map((student) => student.name)).toEqual(['Kavin', 'Nila']);
    expect(merged[0]!.language).toBe('ta');
  });

  it('marks a teacher who is also a parent once, as both', () => {
    const merged = mergeRecipients([
      { kind: 'staff', user_id: 7, guardian_id: null, name: 'Arun', mobile: '9000000006', language: 'en' },
      {
        kind: 'parent',
        user_id: 7,
        guardian_id: 4,
        name: 'Arun',
        mobile: '9000000006',
        language: 'en',
        student_id: 5,
        student_name: 'Mithran',
        section: '2 - A',
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.kind).toBe('both');
    expect(merged[0]!.guardian_id).toBe(4);
  });

  it('keeps parents without the app by mobile number, and drops people with no way to reach them', () => {
    const merged = mergeRecipients([
      {
        kind: 'parent',
        user_id: null,
        guardian_id: 11,
        name: 'Selvi',
        mobile: '+91 98765 43210',
        language: null,
        student_id: 8,
        student_name: 'Ravi',
        section: '1 - A',
      },
      {
        kind: 'parent',
        user_id: null,
        guardian_id: 12,
        name: 'Selvi',
        mobile: '9876543210',
        language: null,
        student_id: 9,
        student_name: 'Rani',
        section: '4 - A',
      },
      { kind: 'parent', user_id: null, guardian_id: null, name: 'Nobody', mobile: null, language: null },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.mobile).toBe('9876543210');
    expect(merged[0]!.students).toHaveLength(2);
  });
});

describe('delivery rules', () => {
  const withApp = {
    kind: 'parent' as const,
    user_id: 1,
    guardian_id: 1,
    name: 'A',
    mobile: '9000000001',
    language: 'en' as const,
    students: [],
  };
  const smsOnly = { ...withApp, user_id: null };

  it('queues push only for app users and SMS only when there is a mobile number', () => {
    expect(startingStatus('push', withApp, ['push', 'sms'])).toBe('pending');
    expect(startingStatus('push', smsOnly, ['push', 'sms'])).toBe('none');
    expect(startingStatus('sms', smsOnly, ['push', 'sms'])).toBe('pending');
    expect(startingStatus('sms', { ...withApp, mobile: null }, ['push', 'sms'])).toBe('none');
    expect(startingStatus('sms', withApp, ['push'])).toBe('none');
  });

  it('retries with growing gaps, then fails after the last attempt', () => {
    const now = 1_000_000;
    expect(afterFailure(1, now)).toEqual({ status: 'pending', next_at: new Date(now + 10_000) });
    expect(afterFailure(2, now)).toEqual({ status: 'pending', next_at: new Date(now + 30_000) });
    expect(afterFailure(MAX_ATTEMPTS, now)).toEqual({ status: 'failed', next_at: null });
  });

  it('is sending while anything is waiting, then sent or partly failed', () => {
    expect(rollupStatus({ ...zero, pending: 1 }, zero)).toBe('sending');
    expect(rollupStatus({ ...zero, sent: 5, skipped: 1 }, { ...zero, sent: 3 })).toBe('sent');
    expect(rollupStatus({ ...zero, sent: 5 }, { ...zero, failed: 1 })).toBe('partly_failed');
  });

  it('uses Tamil when the person reads Tamil and a Tamil text exists', () => {
    expect(textFor('ta', 'Closed', 'விடுமுறை')).toBe('விடுமுறை');
    expect(textFor('ta', 'Closed', null)).toBe('Closed');
    expect(textFor('en', 'Closed', 'விடுமுறை')).toBe('Closed');
  });

  it('gives shares with one decimal', () => {
    expect(share(1, 3)).toBe(33.3);
    expect(share(0, 0)).toBeNull();
  });

  it('has ready-made messages in English and Tamil', () => {
    expect(EMERGENCY_TEMPLATES.length).toBeGreaterThanOrEqual(5);
    expect(EMERGENCY_TEMPLATES.every((item) => item.title && item.message && item.title_ta && item.message_ta)).toBe(
      true,
    );
  });
});
