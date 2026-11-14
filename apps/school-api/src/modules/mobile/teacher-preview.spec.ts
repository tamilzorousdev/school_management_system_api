import { DataSource } from 'typeorm';
import { FilesService } from '../files/files.service';
import { AnnouncementsService } from '../announcements/announcements.service';
import { ChatService } from '../chat/chat.service';
import { DiaryService } from '../diary/diary.service';
import { MeetingsService } from '../meetings/meetings.service';
import { AssignmentsService } from '../staff/assignments.service';
import { TeacherAppService } from './teacher-app.service';
import { TeacherPreviewService } from './teacher-preview.service';

const TEACHER = {
  id: '14',
  user_id: '52',
  staff_type: 'teaching',
  designation: 'TGT Mathematics',
  employee_no: 'EMP-014',
  name: 'Priya',
  status: 'active',
};

const build = (rows: unknown[]) => {
  const query = jest.fn().mockResolvedValue(rows);
  const teacherApp = { today: jest.fn().mockResolvedValue({ periods: [] }) };
  const assignments = { teacherClasses: jest.fn().mockResolvedValue([{ section_id: 4 }]) };
  const diary = { listForTeacher: jest.fn().mockResolvedValue({ items: [], total: 2 }) };
  const meetings = { listForParty: jest.fn().mockResolvedValue({ items: [], total: 3 }) };
  const chat = {
    unreadTotal: jest.fn().mockResolvedValue(4),
    myThreads: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    previewHistory: jest.fn().mockResolvedValue({ items: [], has_more: false }),
  };
  const announcements = {
    unreadCount: jest.fn().mockResolvedValue({ unread: 1 }),
    mine: jest.fn().mockResolvedValue({ items: [], total: 0 }),
  };
  const files = {
    linkFor: jest.fn().mockReturnValue(null),
  };
  const service = new TeacherPreviewService(
    teacherApp as unknown as TeacherAppService,
    assignments as unknown as AssignmentsService,
    diary as unknown as DiaryService,
    meetings as unknown as MeetingsService,
    chat as unknown as ChatService,
    announcements as unknown as AnnouncementsService,
    files as unknown as FilesService,
    { query } as unknown as DataSource,
  );
  return { service, teacherApp, diary, meetings, chat };
};

describe('TeacherPreviewService', () => {
  it('builds the teacher home with today, classes and badge counts', async () => {
    const { service, teacherApp, diary } = build([TEACHER]);
    const home = await service.home(1, 14);
    expect(home.teacher).toEqual({
      staff_id: 14,
      user_id: 52,
      name: 'Priya',
      designation: 'TGT Mathematics',
      employee_no: 'EMP-014',
      can_sign_in: true,
      photo_file_id: null,
      photo_url: null,
    });
    expect(home.counts).toEqual({ diary_pending: 2, meetings_upcoming: 3, chat_unread: 4, announcements_unread: 1 });
    expect(home.classes).toEqual([{ section_id: 4 }]);
    const asTeacher = expect.objectContaining({ id: 52, school_id: 1, roles: ['TEACHER'] });
    expect(teacherApp.today).toHaveBeenCalledWith(1, asTeacher);
    expect(diary.listForTeacher).toHaveBeenCalledWith(asTeacher, expect.objectContaining({ status: 'pending_review' }));
  });

  it('opens meetings and chat as that teacher and logs the admin reading a thread', async () => {
    const { service, meetings, chat } = build([TEACHER]);
    await service.meetings(1, 14, { page: 1, limit: 10, scope: 'past' });
    expect(meetings.listForParty).toHaveBeenCalledWith(expect.objectContaining({ id: 52 }), 'teacher', {
      page: 1,
      limit: 10,
      scope: 'past',
    });
    const viewer = { id: 2 } as never;
    await service.chatMessages(1, 14, 9, {}, viewer);
    expect(chat.previewHistory).toHaveBeenCalledWith(viewer, expect.objectContaining({ id: 52 }), 'teacher', 9, {});
  });

  it('marks a switched-off login', async () => {
    const { service } = build([{ ...TEACHER, status: 'inactive' }]);
    expect((await service.home(1, 14)).teacher.can_sign_in).toBe(false);
  });

  it('rejects non-teaching staff and staff of another school', async () => {
    await expect(build([{ ...TEACHER, staff_type: 'non_teaching' }]).service.home(1, 14)).rejects.toMatchObject({
      response: { code: 'NOT_A_TEACHER' },
    });
    await expect(build([]).service.diary(1, 14, { page: 1, limit: 10 })).rejects.toMatchObject({
      response: { code: 'STAFF_NOT_FOUND' },
    });
  });
});
