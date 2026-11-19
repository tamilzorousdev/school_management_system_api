import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import { AnnouncementsService } from './announcements.service';
import {
  AnnouncementDto,
  AnnouncementInputDto,
  AnnouncementInsightsDto,
  AnnouncementPublishDto,
  AnnouncementQueryDto,
  AnnouncementReaderDto,
  AnnouncementReadersQueryDto,
  MyAnnouncementDto,
  MyAnnouncementsQueryDto,
  UnreadCountDto,
} from './dto/announcement.dto';

@ApiTags('Admin · Announcements')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/announcements')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ANNOUNCEMENTS_VIEW)
  @ApiOperation({
    summary: 'Announcements of the current academic year with read counts',
    description:
      'Sort: created_at (default), published_at, publish_at, title, status. Older academic years are not shown.',
  })
  @ApiEnvelope(AnnouncementDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  list(@SchoolId() schoolId: number, @Query() query: AnnouncementQueryDto) {
    return this.announcements.list(schoolId, query);
  }

  @Get('insights')
  @RequirePermissions(PERMISSIONS.ANNOUNCEMENTS_VIEW)
  @ApiOperation({ summary: 'Drafts, scheduled, published, archived, live urgent ones and the average read rate' })
  @ApiEnvelope(AnnouncementInsightsDto)
  insights(@SchoolId() schoolId: number) {
    return this.announcements.insights(schoolId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ANNOUNCEMENTS_MANAGE)
  @ResponseMessage('Announcement saved')
  @ApiOperation({
    summary: 'Write an announcement: save a draft, schedule it with publish_at, or send it now with publish_now',
    description: 'Urgent announcements also go by SMS when push does not reach the phone.',
  })
  @ApiEnvelope(AnnouncementDto, { status: HttpStatus.CREATED, message: 'Announcement saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  create(@SchoolId() schoolId: number, @Body() dto: AnnouncementInputDto, @CurrentUser() actor: AuthUser) {
    return this.announcements.create(schoolId, dto, actor);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.ANNOUNCEMENTS_VIEW)
  @ApiOperation({ summary: 'One announcement' })
  @ApiEnvelope(AnnouncementDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.announcements.get(schoolId, id);
  }

  @Get(':id/readers')
  @RequirePermissions(PERMISSIONS.ANNOUNCEMENTS_VIEW)
  @ApiOperation({
    summary: 'Who received it and who has read it',
    description:
      'state=read|unread, segment=parent|staff, class_id (parents of that class), search (name or mobile). Parents show the children they got it for.',
  })
  @ApiEnvelope(AnnouncementReaderDto, { paginated: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  readers(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: AnnouncementReadersQueryDto,
  ) {
    return this.announcements.readers(schoolId, id, query);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.ANNOUNCEMENTS_MANAGE)
  @ResponseMessage('Announcement updated')
  @ApiOperation({
    summary: 'Edit an announcement. A published one can change its title, message, urgency, expiry and files only.',
    description:
      'A published edit is marked edited_at. notify_again: true sends ANNOUNCEMENT_UPDATED to every recipient. ' +
      'Changing who receives it after sending: 409 ANNOUNCEMENT_AUDIENCE_LOCKED. Archived: 409 ANNOUNCEMENT_NOT_EDITABLE.',
  })
  @ApiEnvelope(AnnouncementDto, { message: 'Announcement updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  update(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AnnouncementInputDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.announcements.update(schoolId, id, dto, actor);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.ANNOUNCEMENTS_MANAGE)
  @ResponseMessage('Announcement published')
  @ApiOperation({ summary: 'Send a draft now, or schedule it with publish_at' })
  @ApiEnvelope(AnnouncementDto, { message: 'Announcement published' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  publish(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AnnouncementPublishDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.announcements.publish(schoolId, id, dto, actor);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.ANNOUNCEMENTS_MANAGE)
  @ResponseMessage('Announcement archived')
  @ApiOperation({ summary: 'Take a published announcement out of every feed' })
  @ApiEnvelope(AnnouncementDto, { message: 'Announcement archived' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  archive(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.announcements.archive(schoolId, id);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.ANNOUNCEMENTS_MANAGE)
  @ResponseMessage('Announcement deleted')
  @ApiOperation({ summary: 'Delete an announcement at any stage; a sent one disappears from every feed' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async remove(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.announcements.remove(schoolId, id);
    return null;
  }
}

@ApiTags('Me · Announcements')
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED)
@Controller('me/announcements')
export class MyAnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get()
  @ApiOperation({
    summary: 'Announcements sent to me this academic year (every app: parent, staff and driver), newest first',
    description:
      'Filters: unread, search (title and message), priority, from / to (sent date), student_id (parents: only those sent for that child).',
  })
  @ApiEnvelope(MyAnnouncementDto, { paginated: true })
  list(@CurrentUser() user: AuthUser, @Query() query: MyAnnouncementsQueryDto) {
    return this.announcements.mine(user, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Badge count of unread announcements' })
  @ApiEnvelope(UnreadCountDto)
  unread(@CurrentUser() user: AuthUser) {
    return this.announcements.unreadCount(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One announcement' })
  @ApiEnvelope(MyAnnouncementDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  one(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.announcements.myOne(user, id);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark it read; the office sees the read count go up' })
  @ApiEnvelope(MyAnnouncementDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  read(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.announcements.markRead(user, id);
  }
}
