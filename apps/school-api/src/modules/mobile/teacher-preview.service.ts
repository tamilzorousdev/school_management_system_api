import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppException, AuthUser, Paginated } from '@app/common';
import { ROLES } from '../access/access.catalog';
import { AnnouncementsService } from '../announcements/announcements.service';
import { MyAnnouncementDto, MyAnnouncementsQueryDto } from '../announcements/dto/announcement.dto';
import { ChatService } from '../chat/chat.service';
import { ChatThreadDto, MessagesPageDto, MessagesQueryDto, ThreadsQueryDto } from '../chat/dto/chat.dto';
import { DiaryService } from '../diary/diary.service';
import { DiaryEntryDto, TeacherDiaryQueryDto } from '../diary/dto/diary.dto';
import { MeetingDto, MobileMeetingQueryDto } from '../meetings/dto/meeting.dto';
import { MeetingsService } from '../meetings/meetings.service';
import { AssignmentsService } from '../staff/assignments.service';
import { FilesService } from '../files/files.service';
import { PreviewTeacherDto, TeacherPreviewDto } from './dto/teacher-preview.dto';
import { viewAs } from './preview-user';
import { TeacherAppService } from './teacher-app.service';

interface PreviewTeacher {
  profile: PreviewTeacherDto;
  user: AuthUser;
}

@Injectable()
export class TeacherPreviewService {
  constructor(
    private readonly teacherApp: TeacherAppService,
    private readonly assignments: AssignmentsService,
    private readonly diaryService: DiaryService,
    private readonly meetingsService: MeetingsService,
    private readonly chatService: ChatService,
    private readonly announcementsService: AnnouncementsService,
    private readonly files: FilesService,
    private readonly dataSource: DataSource,
  ) {}

  async home(schoolId: number, staffId: number): Promise<TeacherPreviewDto> {
    const { profile, user } = await this.teacher(schoolId, staffId);
    const [today, classes, pending, upcoming, chatUnread, news] = await Promise.all([
      this.teacherApp.today(schoolId, user),
      this.assignments.teacherClasses(schoolId, user.id),
      this.diaryService.listForTeacher(user, { page: 1, limit: 1, status: 'pending_review' }),
      this.meetingsService.listForParty(user, 'teacher', { page: 1, limit: 1, scope: 'upcoming' }),
      this.chatService.unreadTotal(user, 'teacher'),
      this.announcementsService.unreadCount(user),
    ]);
    return {
      teacher: profile,
      today,
      classes,
      counts: {
        diary_pending: pending.total,
        meetings_upcoming: upcoming.total,
        chat_unread: chatUnread,
        announcements_unread: news.unread,
      },
    };
  }

  async diary(schoolId: number, staffId: number, query: TeacherDiaryQueryDto): Promise<Paginated<DiaryEntryDto>> {
    return this.diaryService.listForTeacher((await this.teacher(schoolId, staffId)).user, query);
  }

  async meetings(schoolId: number, staffId: number, query: MobileMeetingQueryDto): Promise<Paginated<MeetingDto>> {
    return this.meetingsService.listForParty((await this.teacher(schoolId, staffId)).user, 'teacher', query);
  }

  async chatThreads(schoolId: number, staffId: number, query: ThreadsQueryDto): Promise<Paginated<ChatThreadDto>> {
    return this.chatService.myThreads((await this.teacher(schoolId, staffId)).user, 'teacher', query);
  }

  async chatMessages(
    schoolId: number,
    staffId: number,
    threadId: number,
    query: MessagesQueryDto,
    viewer: AuthUser,
  ): Promise<MessagesPageDto> {
    const { user } = await this.teacher(schoolId, staffId);
    return this.chatService.previewHistory(viewer, user, 'teacher', threadId, query);
  }

  async announcements(
    schoolId: number,
    staffId: number,
    query: MyAnnouncementsQueryDto,
  ): Promise<Paginated<MyAnnouncementDto>> {
    return this.announcementsService.mine((await this.teacher(schoolId, staffId)).user, query);
  }

  private async teacher(schoolId: number, staffId: number): Promise<PreviewTeacher> {
    const [row] = await this.dataSource.query(
      `SELECT st.id, st.user_id, st.staff_type, st.designation, st.employee_no, u.name, u.status, u.photo_file_id
         FROM staff st JOIN users u ON u.id = st.user_id
        WHERE st.id = $1 AND st.school_id = $2 AND st.deleted_at IS NULL AND u.deleted_at IS NULL`,
      [staffId, schoolId],
    );
    if (!row) throw AppException.notFound('Staff member not found', 'STAFF_NOT_FOUND');
    if (row.staff_type !== 'teaching') {
      throw AppException.badRequest('Only teaching staff use the teacher app', 'NOT_A_TEACHER');
    }
    const userId = Number(row.user_id);
    return {
      profile: {
        staff_id: Number(row.id),
        user_id: userId,
        name: row.name,
        designation: row.designation,
        employee_no: row.employee_no,
        can_sign_in: row.status === 'active',
        photo_file_id: row.photo_file_id ? Number(row.photo_file_id) : null,
        photo_url: this.files.linkFor(row.photo_file_id ? Number(row.photo_file_id) : null),
      },
      user: viewAs(userId, row.name, schoolId, ROLES.TEACHER),
    };
  }
}
