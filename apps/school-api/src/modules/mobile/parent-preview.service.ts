import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppException, AuthUser, paginate, Paginated, PaginationDto } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { AchievementsService } from '../achievements/achievements.service';
import { AchievementDto } from '../achievements/dto/achievement.dto';
import { ROLES } from '../access/access.catalog';
import { AnnouncementsService } from '../announcements/announcements.service';
import { MyAnnouncementDto, MyAnnouncementsQueryDto } from '../announcements/dto/announcement.dto';
import { ChatService } from '../chat/chat.service';
import { ChatThreadDto, MessagesPageDto, MessagesQueryDto } from '../chat/dto/chat.dto';
import { DiaryService } from '../diary/diary.service';
import { DiaryFeedItemDto, ParentDiaryQueryDto } from '../diary/dto/diary.dto';
import { MeetingDto, MobileMeetingQueryDto } from '../meetings/dto/meeting.dto';
import { MeetingsService } from '../meetings/meetings.service';
import { AttendanceService } from '../attendance/attendance.service';
import { MyNotificationDto, MyNotificationsQueryDto } from '../notifications/dto/notification.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { ChildBusDto } from '../tracking/dto/tracking.dto';
import { TripsService } from '../tracking/trips.service';
import { ParentPreviewDto, PreviewParentDto } from './dto/parent-preview.dto';
import { MobileAccessService } from './mobile-access.service';
import { viewAs } from './preview-user';

@Injectable()
export class ParentPreviewService {
  constructor(
    private readonly access: MobileAccessService,
    private readonly attendance: AttendanceService,
    private readonly tracking: TripsService,
    private readonly achievementsService: AchievementsService,
    private readonly notificationsService: NotificationsService,
    private readonly diaryService: DiaryService,
    private readonly meetingsService: MeetingsService,
    private readonly chatService: ChatService,
    private readonly announcementsService: AnnouncementsService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async home(schoolId: number, studentId: number): Promise<ParentPreviewDto> {
    await this.assertStudent(schoolId, studentId);
    const parent = await this.parentOf(schoolId, studentId);
    const [child, sessions] = await Promise.all([
      parent ? this.access.childCard(parent.user_id, studentId) : null,
      this.attendance.todaySessions(studentId, schoolId),
    ]);
    return { parent, child, today: { date: todayIn(this.app.timeZone), ...sessions } };
  }

  async bus(schoolId: number, studentId: number): Promise<ChildBusDto | null> {
    await this.assertStudent(schoolId, studentId);
    return this.tracking.childBus(schoolId, studentId);
  }

  achievements(schoolId: number, studentId: number): Promise<AchievementDto[]> {
    return this.achievementsService.list(schoolId, studentId, { parent: true });
  }

  async notifications(
    schoolId: number,
    studentId: number,
    query: MyNotificationsQueryDto,
  ): Promise<Paginated<MyNotificationDto>> {
    await this.assertStudent(schoolId, studentId);
    const parent = await this.parentOf(schoolId, studentId);
    if (!parent) return paginate([[], 0], query.page, query.limit);
    return this.notificationsService.mine(parent.user_id, query);
  }

  async diary(schoolId: number, studentId: number, query: ParentDiaryQueryDto): Promise<Paginated<DiaryFeedItemDto>> {
    await this.assertStudent(schoolId, studentId);
    return this.diaryService.feed(schoolId, studentId, query);
  }

  async meetings(schoolId: number, studentId: number, query: MobileMeetingQueryDto): Promise<Paginated<MeetingDto>> {
    const parent = await this.parentLogin(schoolId, studentId);
    if (!parent) return paginate([[], 0], query.page, query.limit);
    return this.meetingsService.listForParty(parent, 'parent', { ...query, student_id: studentId });
  }

  async chatThreads(schoolId: number, studentId: number, query: PaginationDto): Promise<Paginated<ChatThreadDto>> {
    const parent = await this.parentLogin(schoolId, studentId);
    if (!parent) return paginate([[], 0], query.page, query.limit);
    return this.chatService.myThreads(parent, 'parent', { ...query, student_id: studentId });
  }

  async chatMessages(
    schoolId: number,
    studentId: number,
    threadId: number,
    query: MessagesQueryDto,
    viewer: AuthUser,
  ): Promise<MessagesPageDto> {
    const parent = await this.parentLogin(schoolId, studentId);
    if (!parent) throw AppException.notFound('Conversation not found', 'THREAD_NOT_FOUND');
    return this.chatService.previewHistory(viewer, parent, 'parent', threadId, query);
  }

  async announcements(
    schoolId: number,
    studentId: number,
    query: MyAnnouncementsQueryDto,
  ): Promise<Paginated<MyAnnouncementDto>> {
    const parent = await this.parentLogin(schoolId, studentId);
    if (!parent) return paginate([[], 0], query.page, query.limit);
    return this.announcementsService.mine(parent, query);
  }

  private async parentLogin(schoolId: number, studentId: number): Promise<AuthUser | null> {
    await this.assertStudent(schoolId, studentId);
    const parent = await this.parentOf(schoolId, studentId);
    return parent ? viewAs(parent.user_id, parent.name, schoolId, ROLES.PARENT) : null;
  }

  private async assertStudent(schoolId: number, studentId: number): Promise<void> {
    const [row] = await this.dataSource.query(
      `SELECT id FROM students WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [studentId, schoolId],
    );
    if (!row) throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');
  }

  private async parentOf(schoolId: number, studentId: number): Promise<PreviewParentDto | null> {
    const [row] = await this.dataSource.query(
      `SELECT g.user_id, g.name, sg.relation FROM student_guardians sg
       JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL AND g.user_id IS NOT NULL
       JOIN students s ON s.id = sg.student_id AND s.school_id = $2 AND s.deleted_at IS NULL AND s.status = 'active'
       WHERE sg.student_id = $1
       ORDER BY sg.is_primary DESC, g.id
       LIMIT 1`,
      [studentId, schoolId],
    );
    return row ? { user_id: Number(row.user_id), name: row.name, relation: row.relation } : null;
  }
}
