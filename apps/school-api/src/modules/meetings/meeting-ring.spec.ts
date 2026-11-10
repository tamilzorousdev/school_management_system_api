import {
  callerLeft,
  callPayload,
  canReject,
  joinOutcome,
  newCallId,
  otherParty,
  RING_TIMEOUT_SECONDS,
  ringExpired,
  RingState,
} from './meeting-ring';

const idle: RingState = { ring_call_id: null, ring_to: null, ring_started_at: null };
const ringingParent: RingState = {
  ring_call_id: 'c_1a2b3c4d5e6f',
  ring_to: 'parent',
  ring_started_at: new Date('2026-11-10T10:00:00Z'),
};

describe('meeting ring', () => {
  it('rings the other side when the first person joins', () => {
    expect(joinOutcome(idle, 'teacher', false)).toBe('ring');
  });

  it('does not ring when the other side is already in the call', () => {
    expect(joinOutcome(idle, 'teacher', true)).toBe('none');
  });

  it('treats the rung side joining as an answer', () => {
    expect(joinOutcome(ringingParent, 'parent', false)).toBe('answer');
  });

  it('does not ring again when the caller rejoins while it is still ringing', () => {
    expect(joinOutcome(ringingParent, 'teacher', false)).toBe('none');
  });

  it('cancels when the caller leaves, not when the rung side leaves', () => {
    expect(callerLeft(ringingParent, 'teacher')).toBe(true);
    expect(callerLeft(ringingParent, 'parent')).toBe(false);
    expect(callerLeft(idle, 'teacher')).toBe(false);
  });

  it('lets only the rung side reject the call', () => {
    expect(canReject(ringingParent, 'parent')).toBe(true);
    expect(canReject(ringingParent, 'teacher')).toBe(false);
    expect(canReject(idle, 'parent')).toBe(false);
  });

  it('times out after the ring window', () => {
    const start = ringingParent.ring_started_at!.getTime();
    expect(ringExpired(ringingParent, new Date(start + (RING_TIMEOUT_SECONDS - 1) * 1000))).toBe(false);
    expect(ringExpired(ringingParent, new Date(start + RING_TIMEOUT_SECONDS * 1000))).toBe(true);
    expect(ringExpired(idle, new Date(start + 600_000))).toBe(false);
  });

  it('builds a push with string values only and the role of the caller', () => {
    const call = {
      call_id: 'c_8f21a3',
      meeting_id: 11,
      channel_name: 'tzs_1_62b42c63d586b740',
      caller_name: 'Arun Prakash',
      caller_role: 'teacher' as const,
      student_name: 'Harini Arun',
    };
    const ring = callPayload('ring', call);
    expect(ring).toEqual({
      category: 'call',
      event: 'ring',
      call_id: 'c_8f21a3',
      meeting_id: '11',
      channel_name: 'tzs_1_62b42c63d586b740',
      caller_name: 'Arun Prakash',
      caller_role: 'teacher',
      student_name: 'Harini Arun',
      timeout_seconds: String(RING_TIMEOUT_SECONDS),
    });
    expect(Object.values(ring).every((value) => typeof value === 'string')).toBe(true);
    expect(callPayload('cancel', call, 'declined')).toMatchObject({
      event: 'cancel',
      reason: 'declined',
      call_id: 'c_8f21a3',
    });
  });

  it('makes short unique call ids', () => {
    const first = newCallId();
    expect(first).toMatch(/^c_[0-9a-f]{12}$/);
    expect(newCallId()).not.toBe(first);
    expect(otherParty('teacher')).toBe('parent');
  });
});
