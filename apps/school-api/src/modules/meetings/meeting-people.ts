import { AppException } from '@app/common';
import { CallSide } from '../notifications/call-devices';
import { MeetingParty } from './entities/meeting.entity';

export function appOf(party: MeetingParty): CallSide {
  return party === 'teacher' ? 'staff' : 'parent';
}

export function samePersonError(): AppException {
  return AppException.badRequest('You cannot book a meeting or chat with yourself', 'SAME_PERSON');
}

export function withoutSelf<T extends { id: number }>(people: T[], selfId: number): T[] {
  return people.filter((person) => person.id !== selfId);
}
