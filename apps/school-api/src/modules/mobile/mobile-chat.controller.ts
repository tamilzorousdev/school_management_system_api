import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequireRoles, ResponseMessage } from '@app/common';
import { ROLES } from '../access/access.catalog';
import { ChatService } from '../chat/chat.service';
import {
  AddGroupMembersDto,
  ChatDirectoryUserDto,
  ChatMemberDto,
  ChatMessageDto,
  ChatThreadDto,
  ClearChatResultDto,
  CreateGroupChatDto,
  DeleteMessageDto,
  DeleteMessageResultDto,
  EditMessageDto,
  FlagMessageDto,
  MessagesPageDto,
  MessagesQueryDto,
  ParentThreadInputDto,
  ReadReceiptDto,
  SendMessageDto,
  TeacherThreadInputDto,
  ThreadsQueryDto,
} from '../chat/dto/chat.dto';
import { MobileAccessService } from './mobile-access.service';
import { TEACHER_MODULE_TAGS } from './teacher-modules.catalog';
import { PARENT_MODULE_TAGS } from './parent-modules.catalog';

const REALTIME =
  'Live updates on socket.io namespace /comm with { auth: { token } }: chat.message, chat.read, chat.updated, chat.deleted, chat.restored, chat.edited, chat.typing ' +
  '(send chat.typing { thread_id }).';

@ApiTags(TEACHER_MODULE_TAGS.MODULE_6)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@RequireRoles(ROLES.TEACHER, ROLES.HOD, ROLES.PRINCIPAL)
@Controller('mobile/teacher/chat')
export class MobileTeacherChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('directory')
  @ApiOperation({ summary: 'Directory of teachers and parents to add to groups' })
  @ApiEnvelope(ChatDirectoryUserDto, { isArray: true })
  directory(@CurrentUser() user: AuthUser, @Query('search') search?: string) {
    return this.chat.directory(user.school_id!, search);
  }

  @Post('groups')
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Group created')
  @ApiOperation({ summary: 'Create a group chat' })
  @ApiEnvelope(ChatThreadDto, { status: HttpStatus.CREATED, message: 'Group created' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  createGroup(@CurrentUser() user: AuthUser, @Body() dto: CreateGroupChatDto) {
    return this.chat.createGroup(user, dto);
  }

  @Post('groups/:id/members')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Members added')
  @ApiOperation({ summary: 'Add members to a group chat' })
  @ApiEnvelope(ChatMemberDto, { isArray: true, message: 'Members added' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.FORBIDDEN)
  addMembers(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: AddGroupMembersDto) {
    return this.chat.addGroupMembers(user, id, dto);
  }

  @Get('groups/:id/members')
  @ApiOperation({ summary: 'List members of a group chat' })
  @ApiEnvelope(ChatMemberDto, { isArray: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  members(@Param('id', ParseIntPipe) id: number) {
    return this.chat.groupMembers(id);
  }

  @Get('threads')
  @ApiOperation({
    summary: 'My conversations with parents this academic year, latest first, with unread counts',
    description: REALTIME,
  })
  @ApiEnvelope(ChatThreadDto, { paginated: true })
  threads(@CurrentUser() user: AuthUser, @Query() query: ThreadsQueryDto) {
    return this.chat.myThreads(user, 'teacher', query);
  }

  @Post('threads')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Open (or reuse) the conversation with a parent of a student I teach',
    description: '403 NOT_YOUR_SECTION; 409 NO_PARENT_ACCOUNT',
  })
  @ApiEnvelope(ChatThreadDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  open(@CurrentUser() user: AuthUser, @Body() dto: TeacherThreadInputDto) {
    return this.chat.openAsTeacher(user, dto);
  }

  @Get('threads/:id')
  @ApiOperation({ summary: 'One conversation' })
  @ApiEnvelope(ChatThreadDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  thread(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.chat.thread(user, 'teacher', id);
  }

  @Get('threads/:id/messages')
  @ApiOperation({ summary: 'Messages, newest first; pass before_id to load older ones' })
  @ApiEnvelope(MessagesPageDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  messages(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() query: MessagesQueryDto) {
    return this.chat.history(user, 'teacher', id, query);
  }

  @Post('threads/:id/messages')
  @ResponseMessage('Message sent')
  @ApiOperation({
    summary: 'Send a message, photo, file, voice message or video to the parent (push to the parent at once)',
    description:
      'Upload first with POST /files, then send file_id. Voice (m4a, aac, mp3, ogg, wav, webm) and video (mp4, mov, 3gp, webm) up to 25 MB; send duration_seconds (required for a video, at most 120 s). kind in the reply is text, image, file, voice or video. 400 VIDEO_TOO_LONG.',
  })
  @ApiEnvelope(ChatMessageDto, { status: HttpStatus.CREATED, message: 'Message sent' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  send(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: SendMessageDto) {
    return this.chat.send(user, 'teacher', id, dto);
  }

  @Post('threads/:id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'I opened the conversation: parent messages get read receipts' })
  @ApiEnvelope(ReadReceiptDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  read(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.chat.markRead(user, 'teacher', id);
  }

  @Post('threads/:id/messages/:messageId/flag')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Message reported to the office')
  @ApiOperation({ summary: 'Report a parent message to the office' })
  @ApiEnvelope(ChatMessageDto, { message: 'Message reported to the office' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  flag(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('messageId', ParseIntPipe) messageId: number,
    @Body() dto: FlagMessageDto,
  ) {
    return this.chat.flag(user, 'teacher', id, messageId, dto.reason);
  }

  @Post('threads/:id/messages/:messageId/delete')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Message deleted')
  @ApiOperation({
    summary: 'Delete a message for me, or for everyone',
    description:
      'Body { "for": "me" } removes it from my chat only; the parent still sees it. { "for": "everyone" } works on my own message within 24 hours: both sides then see "This message was deleted" (deleted true, body and file null) and the office can still read it. undo_until is the time Undo stays available (10 seconds). Socket event chat.deleted { thread_id, message_id }. 403 NOT_YOUR_MESSAGE, 400 DELETE_WINDOW_PASSED, 409 ALREADY_DELETED.',
  })
  @ApiEnvelope(DeleteMessageResultDto, { message: 'Message deleted' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  deleteMessage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('messageId', ParseIntPipe) messageId: number,
    @Body() dto: DeleteMessageDto,
  ) {
    return this.chat.deleteMessage(user, 'teacher', id, messageId, dto.for);
  }

  @Post('threads/:id/messages/:messageId/undo-delete')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Message restored')
  @ApiOperation({
    summary: 'Undo my delete for everyone (within 10 seconds)',
    description:
      'Brings the message back for both sides. Socket event chat.restored with the message. 400 UNDO_EXPIRED after 10 seconds, 409 NOTHING_TO_UNDO.',
  })
  @ApiEnvelope(ChatMessageDto, { message: 'Message restored' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  undoDelete(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('messageId', ParseIntPipe) messageId: number,
  ) {
    return this.chat.undoDelete(user, 'teacher', id, messageId);
  }

  @Post('threads/:id/messages/:messageId/edit')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Message edited')
  @ApiOperation({
    summary: 'Edit my message (within 24 hours)',
    description:
      'Edits the message text. Socket event chat.edited with the updated message. 403 NOT_YOUR_MESSAGE, 400 EDIT_WINDOW_PASSED, 409 ALREADY_DELETED.',
  })
  @ApiEnvelope(ChatMessageDto, { message: 'Message edited' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT, HttpStatus.FORBIDDEN)
  editMessage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('messageId', ParseIntPipe) messageId: number,
    @Body() dto: EditMessageDto,
  ) {
    return this.chat.editMessage(user, 'teacher', id, messageId, dto);
  }

  @Post('threads/:id/clear')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Chat cleared')
  @ApiOperation({
    summary: 'Clear this chat for me',
    description:
      'Every message up to now is gone from my chat; the parent keeps the full history and new messages show as usual. The office can still read everything.',
  })
  @ApiEnvelope(ClearChatResultDto, { message: 'Chat cleared' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  clear(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.chat.clearChat(user, 'teacher', id);
  }
}

@ApiTags(PARENT_MODULE_TAGS.MODULE_5)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@RequireRoles(ROLES.PARENT)
@Controller('mobile/parent')
export class MobileParentChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly access: MobileAccessService,
  ) {}

  @Get('chat/directory')
  @ApiOperation({ summary: 'Directory of teachers and parents to add to groups' })
  @ApiEnvelope(ChatDirectoryUserDto, { isArray: true })
  async parentDirectory(@CurrentUser() user: AuthUser, @Query('search') search?: string) {
    const schoolId = await this.chat.resolveActorSchool(user);
    return this.chat.directory(schoolId, search);
  }

  @Post('chat/groups')
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Group created')
  @ApiOperation({ summary: 'Create a group chat' })
  @ApiEnvelope(ChatThreadDto, { status: HttpStatus.CREATED, message: 'Group created' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  async createGroup(@CurrentUser() user: AuthUser, @Body() dto: CreateGroupChatDto) {
    const schoolId = await this.chat.resolveActorSchool(user);
    return this.chat.createGroup(user, dto, schoolId);
  }

  @Post('chat/groups/:id/members')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Members added')
  @ApiOperation({ summary: 'Add members to a group chat' })
  @ApiEnvelope(ChatMemberDto, { isArray: true, message: 'Members added' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.FORBIDDEN)
  addMembers(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: AddGroupMembersDto) {
    return this.chat.addGroupMembers(user, id, dto);
  }

  @Get('chat/groups/:id/members')
  @ApiOperation({ summary: 'List members of a group chat' })
  @ApiEnvelope(ChatMemberDto, { isArray: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  members(@Param('id', ParseIntPipe) id: number) {
    return this.chat.groupMembers(id);
  }

  @Get('chat/threads')
  @ApiOperation({ summary: 'My conversations with teachers this academic year, every child', description: REALTIME })
  @ApiEnvelope(ChatThreadDto, { paginated: true })
  threads(@CurrentUser() user: AuthUser, @Query() query: ThreadsQueryDto) {
    return this.chat.myThreads(user, 'parent', query);
  }

  @Post('children/:id/chat/threads')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Open (or reuse) the conversation with one of the child’s teachers',
    description: 'office_hours says when the teacher will be told about messages sent now.',
  })
  @ApiEnvelope(ChatThreadDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  async open(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: ParentThreadInputDto) {
    return this.chat.openAsParent(await this.access.childSchool(user.id, id), id, dto, user);
  }

  @Get('chat/threads/:id')
  @ApiOperation({ summary: 'One conversation with office hours' })
  @ApiEnvelope(ChatThreadDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  thread(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.chat.thread(user, 'parent', id);
  }

  @Get('chat/threads/:id/messages')
  @ApiOperation({ summary: 'Messages, newest first; pass before_id to load older ones' })
  @ApiEnvelope(MessagesPageDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  messages(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() query: MessagesQueryDto) {
    return this.chat.history(user, 'parent', id, query);
  }

  @Post('chat/threads/:id/messages')
  @ResponseMessage('Message sent')
  @ApiOperation({
    summary: 'Send a message, photo, file, voice message or video to the teacher',
    description:
      'Outside office hours (Monday to Saturday, not holidays) the message is saved and the teacher is told when office hours start: held_for_office_hours is true.',
  })
  @ApiEnvelope(ChatMessageDto, { status: HttpStatus.CREATED, message: 'Message sent' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  send(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: SendMessageDto) {
    return this.chat.send(user, 'parent', id, dto);
  }

  @Post('chat/threads/:id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'I opened the conversation: teacher messages get read receipts' })
  @ApiEnvelope(ReadReceiptDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  read(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.chat.markRead(user, 'parent', id);
  }

  @Post('chat/threads/:id/messages/:messageId/flag')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Message reported to the office')
  @ApiOperation({ summary: 'Report a teacher message to the office' })
  @ApiEnvelope(ChatMessageDto, { message: 'Message reported to the office' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  flag(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('messageId', ParseIntPipe) messageId: number,
    @Body() dto: FlagMessageDto,
  ) {
    return this.chat.flag(user, 'parent', id, messageId, dto.reason);
  }

  @Post('chat/threads/:id/messages/:messageId/delete')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Message deleted')
  @ApiOperation({
    summary: 'Delete a message for me, or for everyone',
    description:
      'Body { "for": "me" } removes it from my chat only; the teacher still sees it. { "for": "everyone" } works on my own message within 24 hours: both sides then see "This message was deleted" (deleted true, body and file null) and the office can still read it. undo_until is the time Undo stays available (10 seconds). Socket event chat.deleted { thread_id, message_id }. 403 NOT_YOUR_MESSAGE, 400 DELETE_WINDOW_PASSED, 409 ALREADY_DELETED.',
  })
  @ApiEnvelope(DeleteMessageResultDto, { message: 'Message deleted' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  deleteMessage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('messageId', ParseIntPipe) messageId: number,
    @Body() dto: DeleteMessageDto,
  ) {
    return this.chat.deleteMessage(user, 'parent', id, messageId, dto.for);
  }

  @Post('chat/threads/:id/messages/:messageId/undo-delete')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Message restored')
  @ApiOperation({
    summary: 'Undo my delete for everyone (within 10 seconds)',
    description:
      'Brings the message back for both sides. Socket event chat.restored with the message. 400 UNDO_EXPIRED after 10 seconds, 409 NOTHING_TO_UNDO.',
  })
  @ApiEnvelope(ChatMessageDto, { message: 'Message restored' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  undoDelete(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('messageId', ParseIntPipe) messageId: number,
  ) {
    return this.chat.undoDelete(user, 'parent', id, messageId);
  }

  @Post('chat/threads/:id/messages/:messageId/edit')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Message edited')
  @ApiOperation({
    summary: 'Edit my message (within 24 hours)',
    description:
      'Edits the message text. Socket event chat.edited with the updated message. 403 NOT_YOUR_MESSAGE, 400 EDIT_WINDOW_PASSED, 409 ALREADY_DELETED.',
  })
  @ApiEnvelope(ChatMessageDto, { message: 'Message edited' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT, HttpStatus.FORBIDDEN)
  editMessage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('messageId', ParseIntPipe) messageId: number,
    @Body() dto: EditMessageDto,
  ) {
    return this.chat.editMessage(user, 'parent', id, messageId, dto);
  }

  @Post('chat/threads/:id/clear')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Chat cleared')
  @ApiOperation({
    summary: 'Clear this chat for me',
    description:
      'Every message up to now is gone from my chat; the teacher keeps the full history and new messages show as usual. The office can still read everything.',
  })
  @ApiEnvelope(ClearChatResultDto, { message: 'Chat cleared' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  clear(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.chat.clearChat(user, 'parent', id);
  }
}
