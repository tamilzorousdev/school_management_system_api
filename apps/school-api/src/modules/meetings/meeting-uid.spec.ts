import { agoraUid, fromAgoraUid, participantOf } from './meeting-uid';

describe('Agora uid', () => {
  it('gives the same person a different uid on each side of a call', () => {
    expect(agoraUid(229, 'teacher')).toBe(458);
    expect(agoraUid(229, 'parent')).toBe(459);
  });

  it('reads the person and side back from the uid', () => {
    expect(fromAgoraUid(458)).toEqual({ user_id: 229, party: 'teacher' });
    expect(fromAgoraUid(459)).toEqual({ user_id: 229, party: 'parent' });
  });

  it('accepts only the two people of the meeting', () => {
    const meeting = { teacher_user_id: 5, parent_user_id: 9 };
    expect(participantOf(meeting, 10)).toEqual({ user_id: 5, party: 'teacher' });
    expect(participantOf(meeting, 19)).toEqual({ user_id: 9, party: 'parent' });
    expect(participantOf(meeting, 11)).toBeNull();
    expect(participantOf(meeting, 18)).toBeNull();
  });

  it('works when one person is both teacher and parent', () => {
    const meeting = { teacher_user_id: 229, parent_user_id: 229 };
    expect(participantOf(meeting, agoraUid(229, 'teacher'))?.party).toBe('teacher');
    expect(participantOf(meeting, agoraUid(229, 'parent'))?.party).toBe('parent');
  });
});
