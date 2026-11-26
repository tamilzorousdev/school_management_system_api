import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelope,
  ApiErrors,
  AuthUser,
  CurrentUser,
  ListQueryDto,
  RequireRoles,
  ResponseMessage,
} from '@app/common';
import { ROLES } from '../access/access.catalog';
import { PARENT_MODULE_TAGS } from '../mobile/parent-modules.catalog';
import {
  ApprovedVisitorDto,
  ApprovedVisitorInputDto,
  ConsentDto,
  LeaveDto,
  LeaveInputDto,
  ParentHostelDto,
  RollHistoryItemDto,
  RollHistoryQueryDto,
  VisitDto,
} from './dto/hostel-movement.dto';
import {
  CaseDto,
  ComplaintDetailDto,
  ComplaintDto,
  ParentComplaintInputDto,
  RatingDto,
} from './dto/hostel-conduct.dto';
import { HostelParentService } from './hostel-parent.service';

@ApiTags(PARENT_MODULE_TAGS.MODULE_11)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND)
@RequireRoles(ROLES.PARENT)
@Controller('mobile/parent/children/:id/hostel')
export class ParentHostelController {
  constructor(private readonly parent: HostelParentService) {}

  @Get()
  @ApiOperation({
    summary: 'Hostel card: room and bed, warden to call, today’s roll calls, current leave',
    description: 'in_hostel false when my child does not stay in the hostel; the other fields are then empty.',
  })
  @ApiEnvelope(ParentHostelDto)
  overview(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.parent.overview(user, id);
  }

  @Get('attendance')
  @ApiOperation({ summary: 'Hostel roll call history (default: last 30 days)' })
  @ApiEnvelope(RollHistoryItemDto, { isArray: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  attendance(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: RollHistoryQueryDto,
  ) {
    return this.parent.attendance(user, id, query);
  }

  @Get('leaves')
  @ApiOperation({
    summary: 'Hostel leave and outings of my child, newest first',
    description: 'An approved or running leave carries qr_token: show it as the pass at the hostel gate.',
  })
  @ApiEnvelope(LeaveDto, { paginated: true })
  leaves(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() query: ListQueryDto) {
    return this.parent.leaveList(user, id, query);
  }

  @Post('leaves')
  @ResponseMessage('Hostel leave requested')
  @ApiOperation({
    summary: 'Ask for home leave or an outing',
    description:
      'outing: same day, depart_time and return_time inside the hostel outing window. The warden approves; I get HOSTEL_LEAVE_DECIDED.',
  })
  @ApiEnvelope(LeaveDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  apply(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: LeaveInputDto) {
    return this.parent.apply(user, id, dto);
  }

  @Post('leaves/:leaveId/consent')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Answer sent')
  @ApiOperation({ summary: 'Agree or refuse a leave the warden asked for (HOSTEL_LEAVE_CONSENT_NEEDED)' })
  @ApiEnvelope(LeaveDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  consent(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('leaveId', ParseIntPipe) leaveId: number,
    @Body() dto: ConsentDto,
  ) {
    return this.parent.consent(user, id, leaveId, dto);
  }

  @Post('leaves/:leaveId/cancel')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Hostel leave cancelled')
  @ApiOperation({ summary: 'Cancel a leave before my child leaves the hostel' })
  @ApiEnvelope(LeaveDto)
  @ApiErrors(HttpStatus.CONFLICT)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('leaveId', ParseIntPipe) leaveId: number,
  ) {
    return this.parent.cancel(user, id, leaveId);
  }

  @Get('complaints')
  @ApiOperation({ summary: 'Hostel complaints I raised for my child, newest first' })
  @ApiEnvelope(ComplaintDto, { paginated: true })
  complaints(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() query: ListQueryDto) {
    return this.parent.complaints(user, id, query);
  }

  @Get('complaints/:complaintId')
  @ApiOperation({ summary: 'One complaint with its progress timeline' })
  @ApiEnvelope(ComplaintDetailDto)
  complaint(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('complaintId', ParseIntPipe) complaintId: number,
  ) {
    return this.parent.complaint(user, id, complaintId);
  }

  @Post('complaints')
  @ResponseMessage('Complaint sent to the warden')
  @ApiOperation({ summary: 'Raise a hostel complaint (room, food, water, cleanliness, ...) for my child' })
  @ApiEnvelope(ComplaintDetailDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  raiseComplaint(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ParentComplaintInputDto,
  ) {
    return this.parent.raiseComplaint(user, id, dto);
  }

  @Post('complaints/:complaintId/rate')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Thank you')
  @ApiOperation({ summary: 'Rate a resolved complaint (closes it), or send reopen=true if it is not fixed' })
  @ApiEnvelope(ComplaintDetailDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  rate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('complaintId', ParseIntPipe) complaintId: number,
    @Body() dto: RatingDto,
  ) {
    return this.parent.rateComplaint(user, id, complaintId, dto);
  }

  @Get('conduct')
  @ApiOperation({ summary: 'Hostel conduct notes the school shares with me' })
  @ApiEnvelope(CaseDto, { paginated: true })
  conduct(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() query: ListQueryDto) {
    return this.parent.conduct(user, id, query);
  }

  @Get('visits')
  @ApiOperation({ summary: 'Who visited my child, newest first' })
  @ApiEnvelope(VisitDto, { paginated: true })
  visits(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() query: ListQueryDto) {
    return this.parent.visits(user, id, query);
  }

  @Get('visitors')
  @ApiOperation({ summary: 'People I allow to visit my child (besides the parents)' })
  @ApiEnvelope(ApprovedVisitorDto, { isArray: true })
  approved(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.parent.approvedVisitors(user, id);
  }

  @Post('visitors')
  @ResponseMessage('Visitor added')
  @ApiOperation({ summary: 'Allow someone to visit my child (up to 10 people)' })
  @ApiEnvelope(ApprovedVisitorDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  addApproved(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApprovedVisitorInputDto,
  ) {
    return this.parent.addApprovedVisitor(user, id, dto);
  }

  @Delete('visitors/:visitorId')
  @ResponseMessage('Visitor removed')
  @ApiOperation({ summary: 'Remove someone from my approved visitors' })
  @ApiEnvelope()
  async removeApproved(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('visitorId', ParseIntPipe) visitorId: number,
  ) {
    await this.parent.removeApprovedVisitor(user, id, visitorId);
  }
}
