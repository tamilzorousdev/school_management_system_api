import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequireRoles, ResponseMessage } from '@app/common';
import { ROLES } from '../access/access.catalog';
import {
  CancelMeetingDto,
  ExtendMeetingDto,
  JoinMeetingDto,
  MeetingDetailDto,
  MeetingDto,
  MeetingJoinDto,
  MeetingParentOptionDto,
  MeetingTeacherOptionDto,
  MobileMeetingQueryDto,
  ParentMeetingInputDto,
  RespondMeetingDto,
  TeacherMeetingInputDto,
} from '../meetings/dto/meeting.dto';
import { MeetingsService } from '../meetings/meetings.service';
import { AssignmentsService } from '../staff/assignments.service';
import { MobileAccessService } from './mobile-access.service';
import { TEACHER_MODULE_TAGS } from './teacher-modules.catalog';
import { PARENT_MODULE_TAGS } from './parent-modules.catalog';

const JOIN_DESCRIPTION =
  'Returns the Agora app_id, channel_name, uid and RTC token for the Flutter agora_rtc_engine. ' +
  'Opens 10 minutes before the start. The first join makes it in_progress; past the scheduled end it becomes time_exceeded and ' +
  'stays joinable until the host ends it. A meeting nobody joins becomes missed 30 minutes after its end. ' +
  'Tokens are short-lived: renew with POST .../token. ' +
  '409 MEETING_NOT_OPEN, MEETING_ENDED or MEETING_CANCELLED; 503 VIDEO_NOT_CONFIGURED when the Agora keys are not set.';

@ApiTags(TEACHER_MODULE_TAGS.MODULE_7)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@RequireRoles(ROLES.TEACHER, ROLES.HOD, ROLES.PRINCIPAL)
@Controller('mobile/teacher')
export class MobileTeacherMeetingsController {
  constructor(
    private readonly meetings: MeetingsService,
    private readonly access: MobileAccessService,
    private readonly assignments: AssignmentsService,
  ) {}

  @Get('meetings')
  @ApiOperation({ summary: 'My video meetings with parents. scope=upcoming (default), past or all' })
  @ApiEnvelope(MeetingDto, { paginated: true })
  list(@CurrentUser() user: AuthUser, @Query() query: MobileMeetingQueryDto) {
    return this.meetings.listForParty(user, 'teacher', query);
  }

  @Get('students/:id/parents')
  @ApiOperation({ summary: 'Parents of a student who have the app, primary first: pick one to meet' })
  @ApiEnvelope(MeetingParentOptionDto, { isArray: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  async parents(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const schoolId = this.access.teacherSchool(user);
    await this.assignments.assertTeachesStudent(schoolId, user.id, id);
    return this.meetings.parentsForStudent(schoolId, id);
  }

  @Post('meetings')
  @ResponseMessage('Meeting booked')
  @ApiOperation({
    summary: 'Book a video meeting with a parent of a student I teach. The parent is told in the Parent app.',
    description:
      '403 NOT_YOUR_SECTION; 409 NO_PARENT_ACCOUNT when no parent has the app; 409 MEETING_CLASH when either person is busy.',
  })
  @ApiEnvelope(MeetingDto, { status: HttpStatus.CREATED, message: 'Meeting booked' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  schedule(@CurrentUser() user: AuthUser, @Body() dto: TeacherMeetingInputDto) {
    return this.meetings.scheduleByTeacher(user, dto);
  }

  @Get('meetings/:meetingId')
  @ApiOperation({ summary: 'One meeting with its call log' })
  @ApiEnvelope(MeetingDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  detail(@CurrentUser() user: AuthUser, @Param('meetingId', ParseIntPipe) meetingId: number) {
    return this.meetings.getForParty(user, 'teacher', meetingId);
  }

  @Post('meetings/:meetingId/join')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Joining the meeting')
  @ApiOperation({ summary: 'Join the call: Agora channel and token', description: JOIN_DESCRIPTION })
  @ApiEnvelope(MeetingJoinDto, { message: 'Joining the meeting' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT, HttpStatus.SERVICE_UNAVAILABLE)
  join(
    @CurrentUser() user: AuthUser,
    @Param('meetingId', ParseIntPipe) meetingId: number,
    @Body() dto: JoinMeetingDto,
  ) {
    return this.meetings.join(user, 'teacher', meetingId, dto);
  }

  @Post('meetings/:meetingId/token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fresh Agora token for a call in progress (onTokenPrivilegeWillExpire). Not logged.' })
  @ApiEnvelope(MeetingJoinDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT, HttpStatus.SERVICE_UNAVAILABLE)
  token(@CurrentUser() user: AuthUser, @Param('meetingId', ParseIntPipe) meetingId: number) {
    return this.meetings.renewToken(user, 'teacher', meetingId);
  }

  @Post('meetings/:meetingId/leave')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Left the meeting')
  @ApiOperation({ summary: 'I left the call. The meeting stays open so I can join again.' })
  @ApiEnvelope(MeetingDto, { message: 'Left the meeting' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  leave(@CurrentUser() user: AuthUser, @Param('meetingId', ParseIntPipe) meetingId: number) {
    return this.meetings.leave(user, 'teacher', meetingId);
  }

  @Post('meetings/:meetingId/extend')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Meeting extended')
  @ApiOperation({
    summary:
      'Host only: add minutes to the scheduled end (also after time_exceeded). The parent sees the new end time.',
    description: '409 MEETING_NOT_LIVE unless in_progress or time_exceeded; up to 120 extra minutes in total',
  })
  @ApiEnvelope(MeetingDto, { message: 'Meeting extended' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  extend(
    @CurrentUser() user: AuthUser,
    @Param('meetingId', ParseIntPipe) meetingId: number,
    @Body() dto: ExtendMeetingDto,
  ) {
    return this.meetings.extend(user, meetingId, dto);
  }

  @Post('meetings/:meetingId/end')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Meeting ended')
  @ApiOperation({
    summary: 'Host only: end the meeting for everyone',
    description:
      'Marks it completed, stops new tokens, and removes everyone from the Agora channel (kicking rule) when AGORA_CUSTOMER_ID is set. 409 MEETING_NOT_LIVE when nobody joined.',
  })
  @ApiEnvelope(MeetingDto, { message: 'Meeting ended' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  end(@CurrentUser() user: AuthUser, @Param('meetingId', ParseIntPipe) meetingId: number) {
    return this.meetings.end(user, meetingId);
  }

  @Post('meetings/:meetingId/cancel')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Meeting cancelled')
  @ApiOperation({
    summary: 'Cancel a meeting that has not started. The parent is told.',
    description: '409 MEETING_NOT_CANCELLABLE once it is live or over',
  })
  @ApiEnvelope(MeetingDto, { message: 'Meeting cancelled' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('meetingId', ParseIntPipe) meetingId: number,
    @Body() dto: CancelMeetingDto,
  ) {
    return this.meetings.cancel(user, 'teacher', meetingId, dto);
  }

  @Post('meetings/:meetingId/accept')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Meeting accepted')
  @ApiOperation({
    summary: 'Accept a meeting the parent booked. The parent is told.',
    description:
      'Only the invited side can reply (403 NOT_MEETING_INVITEE for the side that booked), and only before it starts (409 MEETING_REPLY_CLOSED). You can change a decline to accept. Joining does not need a reply, like a Teams invite.',
  })
  @ApiEnvelope(MeetingDto, { message: 'Meeting accepted' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  accept(
    @CurrentUser() user: AuthUser,
    @Param('meetingId', ParseIntPipe) meetingId: number,
    @Body() dto: RespondMeetingDto,
  ) {
    return this.meetings.respond(user, 'teacher', meetingId, 'accepted', dto);
  }

  @Post('meetings/:meetingId/decline')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Meeting declined')
  @ApiOperation({
    summary: 'Decline a meeting the parent booked, with an optional note. The parent is told.',
    description:
      'The meeting is not cancelled: both can still join at that time, and the parent can cancel or book another time. Same rules as accept.',
  })
  @ApiEnvelope(MeetingDto, { message: 'Meeting declined' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  decline(
    @CurrentUser() user: AuthUser,
    @Param('meetingId', ParseIntPipe) meetingId: number,
    @Body() dto: RespondMeetingDto,
  ) {
    return this.meetings.respond(user, 'teacher', meetingId, 'declined', dto);
  }
}

@ApiTags(PARENT_MODULE_TAGS.MODULE_6)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@RequireRoles(ROLES.PARENT)
@Controller('mobile/parent')
export class MobileParentMeetingsController {
  constructor(
    private readonly meetings: MeetingsService,
    private readonly access: MobileAccessService,
  ) {}

  @Get('meetings')
  @ApiOperation({ summary: 'My video meetings with teachers, every child. scope=upcoming (default), past or all' })
  @ApiEnvelope(MeetingDto, { paginated: true })
  list(@CurrentUser() user: AuthUser, @Query() query: MobileMeetingQueryDto) {
    return this.meetings.listForParty(user, 'parent', query);
  }

  @Get('children/:id/teachers')
  @ApiOperation({ summary: 'Teachers of this child I can book a meeting with: class teacher first, with subjects' })
  @ApiEnvelope(MeetingTeacherOptionDto, { isArray: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  async teachers(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.meetings.teachersForStudent(await this.access.childSchool(user.id, id), id);
  }

  @Post('children/:id/meetings')
  @ResponseMessage('Meeting booked')
  @ApiOperation({
    summary: 'Book a video meeting with one of the child’s teachers. The teacher is told in the Staff app.',
    description: '404 CHILD_NOT_FOUND; 409 MEETING_CLASH when either person is busy.',
  })
  @ApiEnvelope(MeetingDto, { status: HttpStatus.CREATED, message: 'Meeting booked' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async schedule(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ParentMeetingInputDto,
  ) {
    return this.meetings.scheduleByParent(await this.access.childSchool(user.id, id), id, dto, user);
  }

  @Get('meetings/:meetingId')
  @ApiOperation({ summary: 'One meeting with its call log' })
  @ApiEnvelope(MeetingDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  detail(@CurrentUser() user: AuthUser, @Param('meetingId', ParseIntPipe) meetingId: number) {
    return this.meetings.getForParty(user, 'parent', meetingId);
  }

  @Post('meetings/:meetingId/join')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Joining the meeting')
  @ApiOperation({ summary: 'Join the call: Agora channel and token', description: JOIN_DESCRIPTION })
  @ApiEnvelope(MeetingJoinDto, { message: 'Joining the meeting' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT, HttpStatus.SERVICE_UNAVAILABLE)
  join(
    @CurrentUser() user: AuthUser,
    @Param('meetingId', ParseIntPipe) meetingId: number,
    @Body() dto: JoinMeetingDto,
  ) {
    return this.meetings.join(user, 'parent', meetingId, dto);
  }

  @Post('meetings/:meetingId/token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fresh Agora token for a call in progress (onTokenPrivilegeWillExpire). Not logged.' })
  @ApiEnvelope(MeetingJoinDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT, HttpStatus.SERVICE_UNAVAILABLE)
  token(@CurrentUser() user: AuthUser, @Param('meetingId', ParseIntPipe) meetingId: number) {
    return this.meetings.renewToken(user, 'parent', meetingId);
  }

  @Post('meetings/:meetingId/leave')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Left the meeting')
  @ApiOperation({ summary: 'I left the call. The meeting stays open so I can join again.' })
  @ApiEnvelope(MeetingDto, { message: 'Left the meeting' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  leave(@CurrentUser() user: AuthUser, @Param('meetingId', ParseIntPipe) meetingId: number) {
    return this.meetings.leave(user, 'parent', meetingId);
  }

  @Post('meetings/:meetingId/cancel')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Meeting cancelled')
  @ApiOperation({
    summary: 'Cancel a meeting that has not started. The teacher is told.',
    description: '409 MEETING_NOT_CANCELLABLE once it is live or over',
  })
  @ApiEnvelope(MeetingDto, { message: 'Meeting cancelled' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('meetingId', ParseIntPipe) meetingId: number,
    @Body() dto: CancelMeetingDto,
  ) {
    return this.meetings.cancel(user, 'parent', meetingId, dto);
  }

  @Post('meetings/:meetingId/accept')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Meeting accepted')
  @ApiOperation({
    summary: 'Accept a meeting the teacher booked. The teacher is told.',
    description:
      'Only the invited side can reply (403 NOT_MEETING_INVITEE for the side that booked), and only before it starts (409 MEETING_REPLY_CLOSED). You can change a decline to accept. Joining does not need a reply, like a Teams invite.',
  })
  @ApiEnvelope(MeetingDto, { message: 'Meeting accepted' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  accept(
    @CurrentUser() user: AuthUser,
    @Param('meetingId', ParseIntPipe) meetingId: number,
    @Body() dto: RespondMeetingDto,
  ) {
    return this.meetings.respond(user, 'parent', meetingId, 'accepted', dto);
  }

  @Post('meetings/:meetingId/decline')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Meeting declined')
  @ApiOperation({
    summary: 'Decline a meeting the teacher booked, with an optional note. The teacher is told.',
    description:
      'The meeting is not cancelled: both can still join at that time, and the teacher can cancel or book another time. Same rules as accept.',
  })
  @ApiEnvelope(MeetingDto, { message: 'Meeting declined' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  decline(
    @CurrentUser() user: AuthUser,
    @Param('meetingId', ParseIntPipe) meetingId: number,
    @Body() dto: RespondMeetingDto,
  ) {
    return this.meetings.respond(user, 'parent', meetingId, 'declined', dto);
  }
}
