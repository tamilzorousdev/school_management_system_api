import { randomBytes } from 'node:crypto';
import { MeetingParty } from './entities/meeting.entity';

export const RING_TIMEOUT_SECONDS = 45;

export const CALL_CANCEL_REASONS = ['answered', 'declined', 'caller_left', 'ended', 'timeout'] as const;
export type CallCancelReason = (typeof CALL_CANCEL_REASONS)[number];
export type CallEvent = 'ring' | 'cancel';

export interface RingState {
  ring_call_id: string | null;
  ring_to: MeetingParty | null;
  ring_started_at: Date | null;
}

export interface CallDetails {
  call_id: string;
  meeting_id: number;
  channel_name: string;
  caller_name: string;
  caller_role: MeetingParty;
  student_name: string;
}

export function newCallId(): string {
  return `c_${randomBytes(6).toString('hex')}`;
}

export function otherParty(party: MeetingParty): MeetingParty {
  return party === 'teacher' ? 'parent' : 'teacher';
}

export function isRinging(meeting: RingState): boolean {
  return Boolean(meeting.ring_call_id);
}

export function ringExpired(meeting: RingState, now: Date): boolean {
  return (
    isRinging(meeting) &&
    meeting.ring_started_at !== null &&
    now.getTime() - new Date(meeting.ring_started_at).getTime() >= RING_TIMEOUT_SECONDS * 1000
  );
}

export function joinOutcome(
  meeting: RingState,
  joiner: MeetingParty,
  otherInCall: boolean,
): 'answer' | 'ring' | 'none' {
  if (isRinging(meeting)) return meeting.ring_to === joiner ? 'answer' : 'none';
  return otherInCall ? 'none' : 'ring';
}

export function callerLeft(meeting: RingState, leaver: MeetingParty): boolean {
  return isRinging(meeting) && meeting.ring_to !== leaver;
}

export function canReject(meeting: RingState, party: MeetingParty): boolean {
  return isRinging(meeting) && meeting.ring_to === party;
}

export function callPayload(event: CallEvent, call: CallDetails, reason?: CallCancelReason): Record<string, string> {
  return {
    category: 'call',
    event,
    call_id: call.call_id,
    meeting_id: String(call.meeting_id),
    channel_name: call.channel_name,
    caller_name: call.caller_name,
    caller_role: call.caller_role,
    student_name: call.student_name,
    ...(event === 'ring' ? { timeout_seconds: String(RING_TIMEOUT_SECONDS) } : {}),
    ...(reason ? { reason } : {}),
  };
}
