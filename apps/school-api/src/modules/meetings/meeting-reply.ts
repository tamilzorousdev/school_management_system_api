import { AppException } from '@app/common';
import { Meeting, MeetingParty } from './entities/meeting.entity';

export function replyError(meeting: Pick<Meeting, 'scheduled_by' | 'status'>, party: MeetingParty): void {
  if (meeting.scheduled_by === party) {
    throw AppException.forbidden(
      'You booked this meeting. The other side accepts or declines it.',
      'NOT_MEETING_INVITEE',
    );
  }
  if (meeting.status !== 'scheduled') {
    throw AppException.conflict(
      `You can reply only before the meeting starts. This one is ${meeting.status.replace('_', ' ')}.`,
      'MEETING_REPLY_CLOSED',
    );
  }
}
