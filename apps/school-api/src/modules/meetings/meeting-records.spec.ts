import { DataSource, Repository } from 'typeorm';
import { AuthUser } from '@app/common';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { MeetingMessage } from './entities/meeting-message.entity';
import { MeetingNote } from './entities/meeting-note.entity';
import { Meeting, MeetingStatus } from './entities/meeting.entity';
import {
  attendanceOf,
  chatBlockReason,
  noteBlockReason,
  recapBlockReason,
  visibleToParty,
} from './meeting-records.logic';
import { MeetingRecordsService } from './meeting-records.service';
import { MeetingsService } from './meetings.service';

const at = (time: string) => new Date(`2026-11-05T${time}:00+05:30`);
const timing = (status: MeetingStatus) => ({ status, scheduled_at: at('17:30'), scheduled_end_at: at('17:45') });

describe('meeting record rules', () => {
  it('allows notes on any meeting except a cancelled one', () => {
    expect(noteBlockReason({ status: 'scheduled' })).toBeNull();
    expect(noteBlockReason({ status: 'completed' })).toBeNull();
    expect(noteBlockReason({ status: 'cancelled' })?.code).toBe('MEETING_CANCELLED');
  });

  it('opens the meeting chat with the join window and closes it when the meeting ends', () => {
    expect(chatBlockReason(timing('scheduled'), at('17:00'))?.code).toBe('MEETING_NOT_OPEN');
    expect(chatBlockReason(timing('scheduled'), at('17:21'))).toBeNull();
    expect(chatBlockReason(timing('time_exceeded'), at('17:55'))).toBeNull();
    expect(chatBlockReason(timing('time_exceeded'), at('17:56'))?.code).toBe('MEETING_CHAT_CLOSED');
    expect(chatBlockReason(timing('completed'), at('18:30'))?.code).toBe('MEETING_CHAT_CLOSED');
    expect(chatBlockReason(timing('cancelled'), at('17:31'))?.code).toBe('MEETING_CANCELLED');
  });

  it('has a recap only after a completed or missed meeting', () => {
    expect(recapBlockReason({ status: 'completed' })).toBeNull();
    expect(recapBlockReason({ status: 'missed' })).toBeNull();
    expect(recapBlockReason({ status: 'in_progress' })?.code).toBe('MEETING_NOT_OVER');
    expect(recapBlockReason({ status: 'scheduled' })?.code).toBe('MEETING_NOT_OVER');
    expect(recapBlockReason({ status: 'cancelled' })?.code).toBe('MEETING_CANCELLED');
  });

  it('shows my notes and the shared ones, never the other person’s private notes', () => {
    const notes = [
      { id: 1, author_user_id: 7, shared: false },
      { id: 2, author_user_id: 7, shared: true },
      { id: 3, author_user_id: 9, shared: false },
    ];
    expect(visibleToParty(notes, 9).map((note) => note.id)).toEqual([2, 3]);
    expect(visibleToParty(notes, 7).map((note) => note.id)).toEqual([1, 2]);
  });

  it('counts overlapping app and Agora records once and keeps reconnects as sessions', () => {
    const totals = attendanceOf(
      [
        { user_id: 7, joined_at: at('17:30'), left_at: at('17:40') },
        { user_id: 7, joined_at: at('17:31'), left_at: at('17:39') },
        { user_id: 7, joined_at: at('17:42'), left_at: at('17:48') },
        { user_id: 9, joined_at: at('17:33'), left_at: null },
      ],
      at('17:50'),
    );
    expect(totals.get(7)).toEqual({
      minutes: 16,
      sessions: 2,
      first_joined_at: at('17:30'),
      last_left_at: at('17:48'),
    });
    expect(totals.get(9)?.minutes).toBe(17);
    expect(attendanceOf([{ user_id: 9, joined_at: at('17:33'), left_at: null }], null).size).toBe(0);
  });
});

const TEACHER = { id: 7, name: 'Priya', school_id: 1 } as AuthUser;
const PARENT = { id: 9, name: 'Lakshmi', school_id: 1 } as AuthUser;

function build(status: MeetingStatus = 'in_progress') {
  const meeting = {
    id: 52,
    school_id: 1,
    student_id: 3,
    teacher_user_id: 7,
    parent_user_id: 9,
    title: 'Maths progress',
    status,
    scheduled_at: new Date(Date.now() - 5 * 60_000),
    scheduled_end_at: new Date(Date.now() + 10 * 60_000),
    ended_at: status === 'completed' ? at('17:50') : null,
  } as Meeting;
  const stored: MeetingNote[] = [];
  const notes = {
    create: jest.fn((row: Partial<MeetingNote>) => row),
    save: jest.fn((row: MeetingNote) => {
      if (!row.id) {
        Object.assign(row, { id: stored.length + 1, created_at: at('17:40') });
        stored.push(row);
      }
      row.updated_at = at('17:41');
      return Promise.resolve(row);
    }),
    find: jest.fn(() => Promise.resolve(stored)),
    findOneBy: jest.fn((where: { id: number; author_user_id: number }) =>
      Promise.resolve(
        stored.find((note) => note.id === where.id && note.author_user_id === where.author_user_id) ?? null,
      ),
    ),
    softRemove: jest.fn(),
  };
  const messages = {
    create: jest.fn((row: Partial<MeetingMessage>) => row),
    save: jest.fn((row: MeetingMessage) => Promise.resolve(Object.assign(row, { id: 300, created_at: at('17:41') }))),
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  };
  const meetings = {
    findForParty: jest.fn().mockResolvedValue(meeting),
    getForParty: jest.fn().mockResolvedValue({
      id: 52,
      call_minutes: 20,
      teacher: { id: 7, name: 'Priya' },
      parent: { id: 9, name: 'Lakshmi' },
      call_log: [
        { user: { id: 7 }, platform: 'android', joined_at: at('17:30'), left_at: at('17:50') },
        { user: { id: 7 }, platform: 'android', joined_at: at('17:31'), left_at: at('17:49') },
      ],
    }),
  };
  const files = { assertAttachable: jest.fn(), presentMany: jest.fn().mockResolvedValue(new Map()) };
  const notifications = { dispatch: jest.fn().mockResolvedValue(undefined) };
  const realtime = { toUsers: jest.fn() };
  const query = jest.fn((sql: string) =>
    Promise.resolve(
      sql.includes('FROM students')
        ? [{ name: 'Kavin N' }]
        : [
            { id: 7, name: 'Priya' },
            { id: 9, name: 'Lakshmi' },
          ],
    ),
  );
  const service = new MeetingRecordsService(
    notes as unknown as Repository<MeetingNote>,
    messages as unknown as Repository<MeetingMessage>,
    meetings as unknown as MeetingsService,
    files as unknown as FilesService,
    notifications as unknown as NotificationsService,
    realtime as unknown as RealtimeGateway,
    { query } as unknown as DataSource,
  );
  return { service, notes, messages, notifications, realtime, files };
}

describe('MeetingRecordsService', () => {
  it('tells the parent when the teacher shares a note, and not for private notes', async () => {
    const { service, notifications, realtime } = build();
    const own = await service.addNote(TEACHER, 'teacher', 52, { body: 'Private plan' });
    expect(own.shared).toBe(false);
    expect(notifications.dispatch).not.toHaveBeenCalled();
    const shared = await service.addNote(TEACHER, 'teacher', 52, { body: 'Practise fractions', shared: true });
    expect(shared).toMatchObject({ shared: true, mine: true, author: { id: 7, name: 'Priya' } });
    expect(notifications.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        template: 'MEETING_NOTES_SHARED',
        audience: { user_ids: [9] },
        data: expect.objectContaining({ student: 'Kavin N', host: 'Priya', title: 'Maths progress' }),
      }),
    );
    expect(realtime.toUsers).toHaveBeenCalledWith([9], 'meeting.note', { meeting_id: 52, note_id: shared.id });
  });

  it('never lets a parent share a note', async () => {
    const { service, notifications } = build();
    const note = await service.addNote(PARENT, 'parent', 52, { body: 'Ask about exams', shared: true } as never);
    expect(note.shared).toBe(false);
    expect(notifications.dispatch).not.toHaveBeenCalled();
  });

  it('shares an existing note once and only edits my own notes', async () => {
    const { service, notifications } = build();
    const note = await service.addNote(TEACHER, 'teacher', 52, { body: 'Draft' });
    await service.updateNote(TEACHER, 'teacher', 52, note.id, { shared: true });
    await service.updateNote(TEACHER, 'teacher', 52, note.id, { body: 'Final', shared: true });
    expect(notifications.dispatch).toHaveBeenCalledTimes(1);
    await expect(service.updateNote(PARENT, 'parent', 52, note.id, { body: 'Hack' })).rejects.toMatchObject({
      response: { code: 'NOTE_NOT_FOUND' },
    });
    await expect(service.updateNote(TEACHER, 'teacher', 52, note.id, {})).rejects.toMatchObject({
      response: { code: 'VALIDATION_FAILED' },
    });
  });

  it('refuses notes on a cancelled meeting', async () => {
    const { service } = build('cancelled');
    await expect(service.addNote(TEACHER, 'teacher', 52, { body: 'x' })).rejects.toMatchObject({
      response: { code: 'MEETING_CANCELLED' },
    });
  });

  it('sends a chat message live to both people and checks the file', async () => {
    const { service, realtime, files } = build();
    const message = await service.send(PARENT, 'parent', 52, { body: 'Hello', file_id: 4 });
    expect(files.assertAttachable).toHaveBeenCalledWith(4, 1, 'file_id');
    expect(message).toMatchObject({ meeting_id: 52, body: 'Hello', sender_party: 'parent', mine: true });
    expect(realtime.toUsers).toHaveBeenCalledWith([7, 9], 'meeting.message', expect.objectContaining({ mine: false }));
    await expect(service.send(PARENT, 'parent', 52, {})).rejects.toMatchObject({
      response: { code: 'VALIDATION_FAILED' },
    });
  });

  it('closes the chat once the meeting ends', async () => {
    const { service } = build('completed');
    await expect(service.send(TEACHER, 'teacher', 52, { body: 'late' })).rejects.toMatchObject({
      response: { code: 'MEETING_CHAT_CLOSED' },
    });
  });

  it('builds the recap with attendance for both people', async () => {
    const { service } = build('completed');
    const recap = await service.recap(PARENT, 'parent', 52);
    expect(recap.attendance).toEqual([
      expect.objectContaining({
        user: { id: 7, name: 'Priya' },
        attended: true,
        minutes: 20,
        sessions: 1,
        platforms: ['android'],
      }),
      expect.objectContaining({ user: { id: 9, name: 'Lakshmi' }, attended: false, minutes: 0, first_joined_at: null }),
    ]);
    expect(recap.meeting).not.toHaveProperty('call_log');
    expect(recap.call_minutes).toBe(20);
  });

  it('has no recap while the meeting is open', async () => {
    const { service } = build('in_progress');
    await expect(service.recap(TEACHER, 'teacher', 52)).rejects.toMatchObject({
      response: { code: 'MEETING_NOT_OVER' },
    });
  });
});
