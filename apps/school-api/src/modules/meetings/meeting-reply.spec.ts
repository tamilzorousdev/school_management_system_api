import { AppException } from '@app/common';
import { replyError } from './meeting-reply';

const codeOf = (fn: () => void) => {
  try {
    fn();
    return null;
  } catch (error) {
    return ((error as AppException).getResponse() as { code: string }).code;
  }
};

describe('meeting reply', () => {
  it('lets the invited side reply to a meeting that has not started', () => {
    expect(codeOf(() => replyError({ scheduled_by: 'parent', status: 'scheduled' }, 'teacher'))).toBeNull();
    expect(codeOf(() => replyError({ scheduled_by: 'teacher', status: 'scheduled' }, 'parent'))).toBeNull();
  });

  it('does not let the side that booked reply to its own meeting', () => {
    expect(codeOf(() => replyError({ scheduled_by: 'parent', status: 'scheduled' }, 'parent'))).toBe(
      'NOT_MEETING_INVITEE',
    );
  });

  it.each(['in_progress', 'time_exceeded', 'completed', 'missed', 'cancelled'] as const)(
    'closes replies once the meeting is %s',
    (status) => {
      expect(codeOf(() => replyError({ scheduled_by: 'teacher', status }, 'parent'))).toBe('MEETING_REPLY_CLOSED');
    },
  );
});
