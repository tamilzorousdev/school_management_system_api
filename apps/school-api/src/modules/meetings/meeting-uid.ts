import { Meeting, MeetingParty } from './entities/meeting.entity';

export function agoraUid(userId: number, party: MeetingParty): number {
  return userId * 2 + (party === 'parent' ? 1 : 0);
}

export function fromAgoraUid(uid: number): { user_id: number; party: MeetingParty } {
  return { user_id: Math.floor(uid / 2), party: uid % 2 === 1 ? 'parent' : 'teacher' };
}

export function participantOf(
  meeting: Pick<Meeting, 'teacher_user_id' | 'parent_user_id'>,
  uid: number,
): { user_id: number; party: MeetingParty } | null {
  const decoded = fromAgoraUid(uid);
  const expected = decoded.party === 'teacher' ? meeting.teacher_user_id : meeting.parent_user_id;
  return Number(expected) === decoded.user_id ? decoded : null;
}
