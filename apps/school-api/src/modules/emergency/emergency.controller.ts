import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
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
  MyEmergencyDto,
  MyEmergencyQueryDto,
  RecipientsQueryDto,
  ResendDto,
  ResendResultDto,
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
  @ApiOperation({ summary: 'Ready-made emergency messages in English and Tamil' })
  @ApiEnvelope(EmergencyTemplateDto, { isArray: true })
  templates() {
    return this.emergency.templates();
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
    summary: 'Send an emergency broadcast now',
    description:
      'Saves every recipient first, then delivers in the background: in-app at once, push to app users and SMS to every mobile number, with up to 3 tries each. Each person gets one message even with several children; Tamil readers get the Tamil text when given. Send client_id so a double click does not send twice. 400 NO_RECIPIENTS, AUDIENCE_INVALID.',
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

  @Post(':id/resend')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.EMERGENCY_SEND)
  @ResponseMessage('Sending again')
  @ApiOperation({
    summary: 'Send again to people it failed for, or to everyone who has not acknowledged',
    description: '409 STILL_SENDING while the broadcast is still going out.',
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
      'pending=true lists only the ones I have not acknowledged: show them as a full-screen alert on app open.',
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
