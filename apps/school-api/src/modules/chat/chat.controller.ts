import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import { ChatService } from './chat.service';
import {
  AddGroupMembersDto,
  AuditMessageDto,
  AuditThreadDetailDto,
  AuditThreadsQueryDto,
  ChatDirectoryUserDto,
  ChatInsightsDto,
  ChatMemberDto,
  ChatThreadDto,
  CreateGroupChatDto,
  FlaggedMessageDto,
  FlaggedQueryDto,
  HideMessageDto,
} from './dto/chat.dto';

@ApiTags('Admin · Chat audit')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@RequirePermissions(PERMISSIONS.CHAT_AUDIT)
@Controller('admin/chat')
export class ChatAuditController {
  constructor(private readonly chat: ChatService) {}

  @Get('threads')
  @ApiOperation({
    summary: 'Teacher and parent conversations of the current academic year',
    description:
      'Read-only list. Sort: last_message_at (default), created_at, message_count, open_flags. flagged=true for reported ones.',
  })
  @ApiEnvelope(ChatThreadDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  threads(@SchoolId() schoolId: number, @Query() query: AuditThreadsQueryDto) {
    return this.chat.auditThreads(schoolId, query);
  }

  @Get('directory')
  @ApiOperation({ summary: 'Searchable staff and parents to add to groups' })
  @ApiEnvelope(ChatDirectoryUserDto, { isArray: true })
  directory(@SchoolId() schoolId: number, @Query('search') search?: string) {
    return this.chat.directory(schoolId, search);
  }

  @Post('groups')
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Group created')
  @ApiOperation({ summary: 'Create a group chat' })
  @ApiEnvelope(ChatThreadDto, { status: HttpStatus.CREATED, message: 'Group created' })
  createGroup(@SchoolId() schoolId: number, @Body() dto: CreateGroupChatDto, @CurrentUser() actor: AuthUser) {
    return this.chat.createGroup(actor, dto, schoolId);
  }

  @Post('groups/:id/members')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Members added')
  @ApiOperation({ summary: 'Add members to a group chat' })
  @ApiEnvelope(ChatMemberDto, { isArray: true, message: 'Members added' })
  addMembers(@Param('id', ParseIntPipe) id: number, @Body() dto: AddGroupMembersDto, @CurrentUser() actor: AuthUser) {
    return this.chat.addGroupMembers(actor, id, dto);
  }

  @Get('groups/:id/members')
  @ApiOperation({ summary: 'List members of a group chat' })
  @ApiEnvelope(ChatMemberDto, { isArray: true })
  members(@Param('id', ParseIntPipe) id: number) {
    return this.chat.groupMembers(id);
  }

  @Get('insights')
  @ApiOperation({ summary: 'Conversations, activity today, open reports, hidden and held messages' })
  @ApiEnvelope(ChatInsightsDto)
  insights(@SchoolId() schoolId: number) {
    return this.chat.insights(schoolId);
  }

  @Get('flagged')
  @ApiOperation({ summary: 'Messages a teacher or parent reported, newest first' })
  @ApiEnvelope(FlaggedMessageDto, { paginated: true })
  flagged(@SchoolId() schoolId: number, @Query() query: FlaggedQueryDto) {
    return this.chat.flagged(schoolId, query);
  }

  @Get('threads/:id')
  @ApiOperation({
    summary: 'The whole conversation, including hidden text, and who in the office opened it',
    description: 'Opening it is recorded in the audit log.',
  })
  @ApiEnvelope(AuditThreadDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  thread(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthUser) {
    return this.chat.auditThread(schoolId, id, actor);
  }

  @Post('messages/:id/hide')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Message hidden')
  @ApiOperation({ summary: 'Hide a message from both people; it shows as removed by the school' })
  @ApiEnvelope(AuditMessageDto, { message: 'Message hidden' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  hide(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: HideMessageDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.chat.hide(schoolId, id, dto.reason, actor);
  }

  @Post('messages/:id/unhide')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Message shown again')
  @ApiOperation({ summary: 'Show a hidden message again' })
  @ApiEnvelope(AuditMessageDto, { message: 'Message shown again' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  unhide(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthUser) {
    return this.chat.unhide(schoolId, id, actor);
  }

  @Post('messages/:id/dismiss-flag')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Report closed')
  @ApiOperation({ summary: 'Close a report without hiding the message' })
  @ApiEnvelope(AuditMessageDto, { message: 'Report closed' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  dismiss(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthUser) {
    return this.chat.dismissFlag(schoolId, id, actor);
  }
}
