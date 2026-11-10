import { DataSource } from 'typeorm';
import { AppConfig } from '../../config/configuration';
import { AchievementsService } from '../achievements/achievements.service';
import { AnnouncementsService } from '../announcements/announcements.service';
import { AttendanceService } from '../attendance/attendance.service';
import { ChatService } from '../chat/chat.service';
import { DiaryService } from '../diary/diary.service';
import { MeetingsService } from '../meetings/meetings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TripsService } from '../tracking/trips.service';
import { MobileAccessService } from './mobile-access.service';
import { ParentPreviewService } from './parent-preview.service';

const PARENT = [{ user_id: '42', name: 'Lakshmi', relation: 'mother' }];

const build = (rows: { student: unknown[]; parent: unknown[] }) => {
  const query = jest.fn((sql: string) =>
    Promise.resolve(sql.includes('student_guardians') ? rows.parent : rows.student),
  );
  const access = { childCard: jest.fn().mockResolvedValue({ id: 7, full_name: 'Kavin' }) };
  const attendance = {
    todaySessions: jest.fn().mockResolvedValue({ status: 'present', morning: 'present', afternoon: null }),
  };
  const notifications = { mine: jest.fn().mockResolvedValue({ items: [{ id: 1 }], total: 1 }) };
  const diary = { feed: jest.fn().mockResolvedValue({ items: [{ id: 3 }], total: 1 }) };
  const meetings = { listForParty: jest.fn().mockResolvedValue({ items: [{ id: 4 }], total: 1 }) };
  const chat = {
    myThreads: jest.fn().mockResolvedValue({ items: [{ id: 5 }], total: 1 }),
    previewHistory: jest.fn().mockResolvedValue({ items: [], has_more: false }),
  };
  const announcements = { mine: jest.fn().mockResolvedValue({ items: [{ id: 6 }], total: 1 }) };
  const service = new ParentPreviewService(
    access as unknown as MobileAccessService,
    attendance as unknown as AttendanceService,
    {} as TripsService,
    {} as AchievementsService,
    notifications as unknown as NotificationsService,
    diary as unknown as DiaryService,
    meetings as unknown as MeetingsService,
    chat as unknown as ChatService,
    announcements as unknown as AnnouncementsService,
    { query } as unknown as DataSource,
    { timeZone: 'Asia/Kolkata' } as AppConfig,
  );
  return { service, access, notifications, diary, meetings, chat, announcements };
};

describe('ParentPreviewService', () => {
  it('shows the child card of the primary parent with today’s attendance', async () => {
    const { service, access } = build({ student: [{ id: 7 }], parent: PARENT });
    const home = await service.home(1, 7);
    expect(access.childCard).toHaveBeenCalledWith(42, 7);
    expect(home.parent).toEqual({ user_id: 42, name: 'Lakshmi', relation: 'mother' });
    expect(home.child).toMatchObject({ full_name: 'Kavin' });
    expect(home.today.status).toBe('present');
  });

  it('returns no child card and no notifications when no parent can sign in', async () => {
    const { service, access, notifications } = build({ student: [{ id: 7 }], parent: [] });
    expect((await service.home(1, 7)).child).toBeNull();
    expect(access.childCard).not.toHaveBeenCalled();
    const page = await service.notifications(1, 7, { page: 1, limit: 10 });
    expect(page.items).toEqual([]);
    expect(notifications.mine).not.toHaveBeenCalled();
  });

  it('rejects a student of another school', async () => {
    const { service } = build({ student: [], parent: [] });
    await expect(service.home(1, 7)).rejects.toMatchObject({ response: { code: 'STUDENT_NOT_FOUND' } });
  });

  it('opens meetings, chat and announcements as the primary parent of that child', async () => {
    const { service, meetings, chat, announcements } = build({ student: [{ id: 7 }], parent: PARENT });
    const parent = expect.objectContaining({ id: 42, school_id: 1, roles: ['PARENT'] });
    await service.meetings(1, 7, { page: 1, limit: 10, scope: 'upcoming' });
    expect(meetings.listForParty).toHaveBeenCalledWith(parent, 'parent', expect.objectContaining({ student_id: 7 }));
    await service.chatThreads(1, 7, { page: 1, limit: 10 });
    expect(chat.myThreads).toHaveBeenCalledWith(parent, 'parent', expect.objectContaining({ student_id: 7 }));
    await service.announcements(1, 7, { page: 1, limit: 10 });
    expect(announcements.mine).toHaveBeenCalledWith(parent, expect.anything());
  });

  it('logs the admin who reads a parent conversation', async () => {
    const { service, chat } = build({ student: [{ id: 7 }], parent: PARENT });
    const viewer = { id: 2 } as never;
    await service.chatMessages(1, 7, 9, {}, viewer);
    expect(chat.previewHistory).toHaveBeenCalledWith(viewer, expect.objectContaining({ id: 42 }), 'parent', 9, {});
  });

  it('shows empty lists and no conversation when no parent can sign in', async () => {
    const { service, meetings, chat } = build({ student: [{ id: 7 }], parent: [] });
    expect((await service.meetings(1, 7, { page: 1, limit: 10, scope: 'upcoming' })).items).toEqual([]);
    expect((await service.chatThreads(1, 7, { page: 1, limit: 10 })).items).toEqual([]);
    expect(meetings.listForParty).not.toHaveBeenCalled();
    await expect(service.chatMessages(1, 7, 9, {}, { id: 2 } as never)).rejects.toMatchObject({
      response: { code: 'THREAD_NOT_FOUND' },
    });
    expect(chat.previewHistory).not.toHaveBeenCalled();
  });

  it('reads the diary feed of the child itself', async () => {
    const { service, diary } = build({ student: [{ id: 7 }], parent: [] });
    await service.diary(1, 7, { page: 1, limit: 10 });
    expect(diary.feed).toHaveBeenCalledWith(1, 7, { page: 1, limit: 10 });
  });
});
