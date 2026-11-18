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
import {
  CreateEmergencyDto,
  EmergencyAudienceDto,
  EmergencyBroadcastDto,
  EmergencyInsightsDto,
  EmergencyPreviewDto,
  EmergencyQueryDto,
  EmergencyRecipientDto,
  EmergencyTemplateDto,
  EmergencyTemplateInputDto,
  EmergencyTemplateUpdateDto,
  MyEmergencyDto,
  MyEmergencyQueryDto,
  RecipientsQueryDto,
  ResendDto,
  ResendResultDto,
  ReviewEmergencyDto,
  TemplateQueryDto,
} from './dto/emergency.dto';
import { EmergencyService } from './emergency.service';

@ApiTags('Admin · Emergency broadcast')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/emergency-broadcasts')
export class EmergencyController {
  constructor(private readonly emergency: EmergencyService) {}

  @Get('templates')
  @RequirePermissions(PERMISSIONS.EMERGENCY_VIEW)
  @ApiOperation({
    summary: "The school's ready messages in English and Tamil",
    description:
      'Starts with the standard set (rain, early closure, security, bus delay, health, all clear); the school can change them. all=true also lists the switched-off ones.',
  })
  @ApiEnvelope(EmergencyTemplateDto, { isArray: true })
  templates(@SchoolId() schoolId: number, @Query() query: TemplateQueryDto) {
    return this.emergency.templates(schoolId, query.all);
  }

  @Post('templates')
  @RequirePermissions(PERMISSIONS.EMERGENCY_SEND)
  @ResponseMessage('Ready message added')
  @ApiOperation({ summary: 'Add a ready message (English, and Tamil if typed)' })
  @ApiEnvelope(EmergencyTemplateDto, { status: HttpStatus.CREATED, message: 'Ready message added' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  addTemplate(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number, @Body() dto: EmergencyTemplateInputDto) {
    return this.emergency.createTemplate(user, schoolId, dto);
  }

  @Patch('templates/:templateId')
  @RequirePermissions(PERMISSIONS.EMERGENCY_SEND)
  @ResponseMessage('Ready message saved')
  @ApiOperation({ summary: 'Change a ready message, or switch it off with is_active false' })
  @ApiEnvelope(EmergencyTemplateDto, { message: 'Ready message saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  updateTemplate(
    @SchoolId() schoolId: number,
    @Param('templateId', ParseIntPipe) templateId: number,
    @Body() dto: EmergencyTemplateUpdateDto,
  ) {
    return this.emergency.updateTemplate(schoolId, templateId, dto);
  }

  @Delete('templates/:templateId')
  @RequirePermissions(PERMISSIONS.EMERGENCY_SEND)
  @ResponseMessage('Ready message removed')
  @ApiOperation({ summary: 'Remove a ready message' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  async removeTemplate(@SchoolId() schoolId: number, @Param('templateId', ParseIntPipe) templateId: number) {
    await this.emergency.removeTemplate(schoolId, templateId);
    return null;
  }

  @Get('insights')
  @RequirePermissions(PERMISSIONS.EMERGENCY_VIEW)
  @ApiOperation({ summary: 'This month: broadcasts, people reached and acknowledged, and the last broadcast' })
  @ApiEnvelope(EmergencyInsightsDto)
  insights(@SchoolId() schoolId: number) {
    return this.emergency.insights(schoolId);
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.EMERGENCY_SEND)
  @ApiOperation({
    summary: 'How many people an audience reaches, before sending',
    description: 'Counts parents and staff, who has the app, who gets SMS only and who cannot be reached.',
  })
  @ApiEnvelope(EmergencyPreviewDto)
  @ApiErrors(HttpStatus.BAD_REQUEST)
  preview(@SchoolId() schoolId: number, @Body() dto: EmergencyAudienceDto) {
    return this.emergency.preview(schoolId, dto);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.EMERGENCY_SEND)
  @ResponseMessage('Emergency broadcast sent')
  @ApiOperation({
    summary: 'Send an emergency broadcast now, later (send_at) or for approval',
    description:
      'Saves every recipient first, then delivers in the background: in-app at once, push to app users and SMS to every mobile number, with up to 3 tries each. Each person gets one message even with several children; Tamil readers get the Tamil text when given. expires_in { value, unit } (seconds to years) takes it off the screen when the time is up. Without the emergency.approve permission a whole-school or SMS broadcast waits for the principal (status pending_approval). Send client_id so a double click does not send twice. 400 NO_RECIPIENTS, AUDIENCE_INVALID, VALIDATION_FAILED (expires_in, send_at).',
  })
  @ApiEnvelope(EmergencyBroadcastDto, { status: HttpStatus.CREATED, message: 'Emergency broadcast sent' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  create(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number, @Body() dto: CreateEmergencyDto) {
    return this.emergency.create(user, schoolId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.EMERGENCY_VIEW)
  @ApiOperation({
    summary: 'Broadcast history with delivery, read and acknowledgement counts',
    description: 'Search title or message. sort = sent_at (default) or title. from and to are dates.',
  })
  @ApiEnvelope(EmergencyBroadcastDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  list(@SchoolId() schoolId: number, @Query() query: EmergencyQueryDto) {
    return this.emergency.list(schoolId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.EMERGENCY_VIEW)
  @ApiOperation({ summary: 'One broadcast with live counts per channel; poll while status is sending' })
  @ApiEnvelope(EmergencyBroadcastDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  detail(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.emergency.detail(schoolId, id);
  }

  @Get(':id/recipients')
  @RequirePermissions(PERMISSIONS.EMERGENCY_VIEW)
  @ApiOperation({
    summary: 'Who it went to, with push and SMS status, read and acknowledged',
    description:
      'filter = all, failed, not_read, not_acknowledged, sms_only or unreachable. search = name, mobile or child.',
  })
  @ApiEnvelope(EmergencyRecipientDto, { paginated: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  recipients(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Query() query: RecipientsQueryDto) {
    return this.emergency.recipientsOf(schoolId, id, query);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.EMERGENCY_APPROVE)
  @ResponseMessage('Approved')
  @ApiOperation({
    summary: 'Approve a waiting broadcast: it goes out now, or at its send_at time',
    description: '409 NOT_PENDING_APPROVAL. The sender is told.',
  })
  @ApiEnvelope(EmergencyBroadcastDto, { message: 'Approved' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  approve(
    @CurrentUser() user: AuthUser,
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReviewEmergencyDto,
  ) {
    return this.emergency.approve(user, schoolId, id, dto);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.EMERGENCY_APPROVE)
  @ResponseMessage('Rejected')
  @ApiOperation({
    summary: 'Reject a waiting broadcast with a note for the sender',
    description: '400 VALIDATION_FAILED without a note, 409 NOT_PENDING_APPROVAL.',
  })
  @ApiEnvelope(EmergencyBroadcastDto, { message: 'Rejected' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  reject(
    @CurrentUser() user: AuthUser,
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReviewEmergencyDto,
  ) {
    return this.emergency.reject(user, schoolId, id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.EMERGENCY_SEND)
  @ResponseMessage('Cancelled')
  @ApiOperation({
    summary: 'Cancel a scheduled or waiting broadcast before it goes out',
    description: '409 NOT_CANCELLABLE.',
  })
  @ApiEnvelope(EmergencyBroadcastDto, { message: 'Cancelled' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  cancel(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.emergency.cancel(schoolId, id);
  }

  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.EMERGENCY_SEND)
  @ResponseMessage('Taken off the screen')
  @ApiOperation({
    summary: 'End now: take it off every screen before its time is up',
    description:
      'Pushes and SMS not yet sent are dropped, the in-app message leaves the bell list and apps get the emergency.ended socket event. 409 NOT_ACTIVE.',
  })
  @ApiEnvelope(EmergencyBroadcastDto, { message: 'Taken off the screen' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  end(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.emergency.end(user, schoolId, id);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.EMERGENCY_APPROVE)
  @ResponseMessage('Removed from the history')
  @ApiOperation({
    summary: 'Remove an ended, expired, cancelled or rejected broadcast from the history and the counts',
    description: 'Kept in the database for the record. 409 STILL_ACTIVE while it is on screen, scheduled or waiting.',
  })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async remove(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.emergency.remove(schoolId, id);
    return null;
  }

  @Post(':id/resend')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.EMERGENCY_SEND)
  @ResponseMessage('Sending again')
  @ApiOperation({
    summary: 'Send again to people it failed for, or to everyone who has not acknowledged',
    description:
      'channels picks push, SMS or both, for example ["sms"] to text only the people who have not seen it. 409 STILL_SENDING while it is going out, NOT_SENT_YET, NOT_ACTIVE once it has ended.',
  })
  @ApiEnvelope(ResendResultDto, { message: 'Sending again' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  resend(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: ResendDto) {
    return this.emergency.resend(schoolId, id, dto);
  }
}

@ApiTags('Me · Emergency')
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED)
@Controller('me/emergency-broadcasts')
export class MeEmergencyController {
  constructor(private readonly emergency: EmergencyService) {}

  @Get()
  @ApiOperation({
    summary: 'Emergency messages sent to me (Parent and Staff apps), newest first',
    description:
      'Only messages still on screen; include_ended=true adds expired and ended ones. pending=true lists only the ones I have not acknowledged: show them as a full-screen alert on app open. Hide the red strip when is_active is false, at expires_at, or on the emergency.ended socket event.',
  })
  @ApiEnvelope(MyEmergencyDto, { paginated: true })
  mine(@CurrentUser() user: AuthUser, @Query() query: MyEmergencyQueryDto) {
    return this.emergency.mine(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One emergency message; opening it marks it read' })
  @ApiEnvelope(MyEmergencyDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  one(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.emergency.mineOne(user, id);
  }

  @Post(':id/acknowledge')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Thank you, the school knows you have seen this')
  @ApiOperation({ summary: 'The "I have seen this" button; safe to press more than once' })
  @ApiEnvelope(MyEmergencyDto, { message: 'Thank you, the school knows you have seen this' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  acknowledge(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.emergency.acknowledge(user, id);
  }
}
