import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelope,
  ApiErrors,
  AppException,
  AuthUser,
  CurrentUser,
  RequirePermissions,
  ResponseMessage,
} from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import { TEACHER_MODULE_TAGS } from '../mobile/teacher-modules.catalog';
import {
  ApprovedVisitorDto,
  ApprovedVisitorInputDto,
  BlocklistDto,
  BlocklistInputDto,
  LeaveDecisionDto,
  LeaveDto,
  LeaveQueryDto,
  PassCheckDto,
  PassCheckResultDto,
  RollFinishDto,
  RollHistoryItemDto,
  RollHistoryQueryDto,
  RollMarkDto,
  RollScanDto,
  RollScanResultDto,
  RollSessionDto,
  RollSessionQueryDto,
  RollSheetDto,
  RollSheetQueryDto,
  StaffLeaveInputDto,
  VisitDto,
  VisitInputDto,
  VisitorLookupDto,
  VisitorLookupQueryDto,
  VisitQueryDto,
} from './dto/hostel-movement.dto';
import { HostelLeavesService } from './hostel-leaves.service';
import { HostelRollCallService } from './hostel-roll-call.service';
import { HostelVisitorsService } from './hostel-visitors.service';

export const LEAVE_DECISIONS = { approve: 'approve', reject: 'reject', cancel: 'cancel' } as const;
type LeaveDecision = (typeof LEAVE_DECISIONS)[keyof typeof LEAVE_DECISIONS];

const schoolOf = (user: AuthUser): number => {
  if (!user.school_id) throw AppException.forbidden('Your account is not linked to a school', 'NO_SCHOOL');
  return user.school_id;
};

const LEAVE_DECISION_PERMISSION = PERMISSIONS.HOSTEL_LEAVE_APPROVE;

@ApiTags('Admin · Hostel movement')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/hostel')
export class HostelMovementController {
  constructor(
    private readonly rollCalls: HostelRollCallService,
    private readonly leaves: HostelLeavesService,
    private readonly visitors: HostelVisitorsService,
  ) {}

  @Get('roll-calls/sheet')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Roll call sheet: every resident with today’s mark and counts' })
  @ApiEnvelope(RollSheetDto)
  @ApiErrors(HttpStatus.BAD_REQUEST)
  sheet(@SchoolId() schoolId: number, @Query() query: RollSheetQueryDto) {
    return this.rollCalls.sheet(schoolId, query);
  }

  @Get('roll-calls')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Past roll calls with counts. sort: roll_date' })
  @ApiEnvelope(RollSessionDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  sessions(@SchoolId() schoolId: number, @Query() query: RollSessionQueryDto) {
    return this.rollCalls.sessions(schoolId, query);
  }

  @Post('roll-calls/mark')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_ATTENDANCE)
  @ResponseMessage('Roll call saved')
  @ApiOperation({ summary: 'Mark students; parents of anyone marked absent are told once' })
  @ApiEnvelope(RollSheetDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  mark(@SchoolId() schoolId: number, @Body() dto: RollMarkDto, @CurrentUser() user: AuthUser) {
    return this.rollCalls.mark(schoolId, dto, user);
  }

  @Post('roll-calls/finish')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_ATTENDANCE)
  @ResponseMessage('Roll call finished')
  @ApiOperation({ summary: 'Finish: mark everyone left as present or absent' })
  @ApiEnvelope(RollSheetDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  finish(@SchoolId() schoolId: number, @Body() dto: RollFinishDto, @CurrentUser() user: AuthUser) {
    return this.rollCalls.finish(schoolId, dto, user);
  }

  @Get('admissions/:id/roll-calls')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'One resident’s roll call history (default: last 30 days)' })
  @ApiEnvelope(RollHistoryItemDto, { isArray: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  history(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Query() query: RollHistoryQueryDto) {
    return this.rollCalls.history(schoolId, id, query);
  }

  @Get('leaves')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Hostel leave, outings and passes. sort: created_at, from_date, expected_return_at' })
  @ApiEnvelope(LeaveDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  listLeaves(@SchoolId() schoolId: number, @Query() query: LeaveQueryDto) {
    return this.leaves.list(schoolId, query);
  }

  @Get('leaves/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'One hostel leave with its pass QR' })
  @ApiEnvelope(LeaveDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  getLeave(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.leaves.get(schoolId, id);
  }

  @Post('leaves')
  @RequirePermissions(PERMISSIONS.HOSTEL_PASS_OPERATE)
  @ResponseMessage('Hostel leave recorded')
  @ApiOperation({
    summary: 'Record home leave, an outing or medical leave for a resident',
    description: 'When parent consent is on (settings) the parent must agree first, except for medical leave.',
  })
  @ApiEnvelope(LeaveDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  createLeave(@SchoolId() schoolId: number, @Body() dto: StaffLeaveInputDto, @CurrentUser() user: AuthUser) {
    return this.leaves.createByStaff(schoolId, dto, user);
  }

  @Post('leaves/:id/:action')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(LEAVE_DECISION_PERMISSION)
  @ResponseMessage('Hostel leave updated')
  @ApiParam({ name: 'action', enum: Object.values(LEAVE_DECISIONS) })
  @ApiOperation({ summary: 'Approve, reject or cancel a hostel leave' })
  @ApiEnvelope(LeaveDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  decide(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('action', new ParseEnumPipe(LEAVE_DECISIONS)) action: LeaveDecision,
    @Body() dto: LeaveDecisionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.leaves.decide(schoolId, id, action, dto, user);
  }

  @Post('passes/check')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_PASS_OPERATE)
  @ApiOperation({ summary: 'Check a hostel pass by QR or number; nothing changes' })
  @ApiEnvelope(PassCheckResultDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  check(@SchoolId() schoolId: number, @Body() dto: PassCheckDto) {
    return this.leaves.check(schoolId, dto);
  }

  @Post('passes/:id/out')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_PASS_OPERATE)
  @ResponseMessage('Marked out')
  @ApiOperation({ summary: 'The student leaves the hostel on this pass; the parent is told' })
  @ApiEnvelope(LeaveDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  out(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.leaves.goOut(schoolId, id, user);
  }

  @Post('passes/:id/in')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_PASS_OPERATE)
  @ResponseMessage('Marked back in')
  @ApiOperation({ summary: 'The student is back; late minutes are worked out and the parent is told' })
  @ApiEnvelope(LeaveDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  in(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.leaves.comeIn(schoolId, id, user);
  }

  @Get('visits')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Visitor log (status=inside for who is in now). sort: created_at, in_at, out_at' })
  @ApiEnvelope(VisitDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  visits(@SchoolId() schoolId: number, @Query() query: VisitQueryDto) {
    return this.visitors.list(schoolId, query);
  }

  @Get('visitors/lookup')
  @RequirePermissions(PERMISSIONS.HOSTEL_VISITOR)
  @ApiOperation({ summary: 'Before letting someone in: blocked? a known parent or approved visitor?' })
  @ApiEnvelope(VisitorLookupDto)
  @ApiErrors(HttpStatus.BAD_REQUEST)
  lookup(@SchoolId() schoolId: number, @Query() query: VisitorLookupQueryDto) {
    return this.visitors.lookup(schoolId, query.mobile, query.admission_id);
  }

  @Post('visits')
  @RequirePermissions(PERMISSIONS.HOSTEL_VISITOR)
  @ResponseMessage('Visitor recorded')
  @ApiOperation({ summary: 'Let a visitor in (or record them as turned away with deny=true); the parent is told' })
  @ApiEnvelope(VisitDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  checkIn(@SchoolId() schoolId: number, @Body() dto: VisitInputDto, @CurrentUser() user: AuthUser) {
    return this.visitors.checkIn(schoolId, dto, user);
  }

  @Post('visits/:id/out')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_VISITOR)
  @ResponseMessage('Visitor checked out')
  @ApiOperation({ summary: 'The visitor left' })
  @ApiEnvelope(VisitDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  checkOut(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.visitors.checkOut(schoolId, id, user);
  }

  @Get('students/:studentId/approved-visitors')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'People besides the parents who may visit this student' })
  @ApiEnvelope(ApprovedVisitorDto, { isArray: true })
  approved(@SchoolId() schoolId: number, @Param('studentId', ParseIntPipe) studentId: number) {
    return this.visitors.approvedVisitors(schoolId, studentId);
  }

  @Post('students/:studentId/approved-visitors')
  @RequirePermissions(PERMISSIONS.HOSTEL_VISITOR)
  @ResponseMessage('Approved visitor added')
  @ApiOperation({ summary: 'Add an approved visitor' })
  @ApiEnvelope(ApprovedVisitorDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  addApproved(
    @SchoolId() schoolId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Body() dto: ApprovedVisitorInputDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.visitors.addApprovedVisitor(schoolId, studentId, dto, user, 'staff');
  }

  @Delete('students/:studentId/approved-visitors/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_VISITOR)
  @ResponseMessage('Approved visitor removed')
  @ApiOperation({ summary: 'Remove an approved visitor' })
  @ApiEnvelope()
  @ApiErrors(HttpStatus.NOT_FOUND)
  async removeApproved(
    @SchoolId() schoolId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    await this.visitors.removeApprovedVisitor(schoolId, studentId, id, user);
  }

  @Get('blocklist')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Mobile numbers not allowed to visit' })
  @ApiEnvelope(BlocklistDto, { isArray: true })
  blocklist(@SchoolId() schoolId: number) {
    return this.visitors.blocklist(schoolId);
  }

  @Post('blocklist')
  @RequirePermissions(PERMISSIONS.HOSTEL_MANAGE)
  @ResponseMessage('Number blocked')
  @ApiOperation({ summary: 'Block a mobile number from visiting' })
  @ApiEnvelope(BlocklistDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  block(@SchoolId() schoolId: number, @Body() dto: BlocklistInputDto, @CurrentUser() user: AuthUser) {
    return this.visitors.block(schoolId, dto, user);
  }

  @Delete('blocklist/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_MANAGE)
  @ResponseMessage('Number unblocked')
  @ApiOperation({ summary: 'Unblock a mobile number' })
  @ApiEnvelope()
  @ApiErrors(HttpStatus.NOT_FOUND)
  async unblock(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    await this.visitors.unblock(schoolId, id, user);
  }
}

@ApiTags(TEACHER_MODULE_TAGS.MODULE_14)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('mobile/teacher/hostel')
export class MobileHostelMovementController {
  constructor(
    private readonly rollCalls: HostelRollCallService,
    private readonly leaves: HostelLeavesService,
    private readonly visitors: HostelVisitorsService,
  ) {}

  @Get('roll-call')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({
    summary: 'Roll call screen: residents of a hostel (filter block, floor, room) with marks and counts',
    description: 'suggested_status is on_leave or outing when the student is out on a hostel pass.',
  })
  @ApiEnvelope(RollSheetDto)
  @ApiErrors(HttpStatus.BAD_REQUEST)
  sheet(@CurrentUser() user: AuthUser, @Query() query: RollSheetQueryDto) {
    return this.rollCalls.sheet(schoolOf(user), query);
  }

  @Post('roll-call/mark')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_ATTENDANCE)
  @ResponseMessage('Roll call saved')
  @ApiOperation({ summary: 'Mark one or many students; send again to correct a mark' })
  @ApiEnvelope(RollSheetDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  mark(@CurrentUser() user: AuthUser, @Body() dto: RollMarkDto) {
    return this.rollCalls.mark(schoolOf(user), dto, user);
  }

  @Post('roll-call/scan')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_ATTENDANCE)
  @ResponseMessage('Marked present')
  @ApiOperation({ summary: 'Scan the student ID card QR to mark present (or late)' })
  @ApiEnvelope(RollScanResultDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  scan(@CurrentUser() user: AuthUser, @Body() dto: RollScanDto) {
    return this.rollCalls.scan(schoolOf(user), dto, user);
  }

  @Post('roll-call/finish')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_ATTENDANCE)
  @ResponseMessage('Roll call finished')
  @ApiOperation({ summary: 'Finish: everyone left becomes present or absent (students out on a pass are kept away)' })
  @ApiEnvelope(RollSheetDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  finish(@CurrentUser() user: AuthUser, @Body() dto: RollFinishDto) {
    return this.rollCalls.finish(schoolOf(user), dto, user);
  }

  @Get('residents/:id/roll-calls')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'One resident’s roll call history' })
  @ApiEnvelope(RollHistoryItemDto, { isArray: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  history(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() query: RollHistoryQueryDto) {
    return this.rollCalls.history(schoolOf(user), id, query);
  }

  @Get('leaves')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Leave and outing requests (status=pending to approve, overdue=true for late returns)' })
  @ApiEnvelope(LeaveDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  listLeaves(@CurrentUser() user: AuthUser, @Query() query: LeaveQueryDto) {
    return this.leaves.list(schoolOf(user), query);
  }

  @Get('leaves/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'One hostel leave' })
  @ApiEnvelope(LeaveDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  getLeave(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.leaves.get(schoolOf(user), id);
  }

  @Post('leaves')
  @RequirePermissions(PERMISSIONS.HOSTEL_PASS_OPERATE)
  @ResponseMessage('Hostel leave recorded')
  @ApiOperation({ summary: 'Record home leave, an outing or medical leave for a resident' })
  @ApiEnvelope(LeaveDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  createLeave(@CurrentUser() user: AuthUser, @Body() dto: StaffLeaveInputDto) {
    return this.leaves.createByStaff(schoolOf(user), dto, user);
  }

  @Post('leaves/:id/:action')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(LEAVE_DECISION_PERMISSION)
  @ResponseMessage('Hostel leave updated')
  @ApiParam({ name: 'action', enum: Object.values(LEAVE_DECISIONS) })
  @ApiOperation({ summary: 'Approve, reject or cancel a hostel leave' })
  @ApiEnvelope(LeaveDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  decide(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('action', new ParseEnumPipe(LEAVE_DECISIONS)) action: LeaveDecision,
    @Body() dto: LeaveDecisionDto,
  ) {
    return this.leaves.decide(schoolOf(user), id, action, dto, user);
  }

  @Post('passes/check')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_PASS_OPERATE)
  @ApiOperation({ summary: 'Scan a hostel pass QR or type its number: green or red, nothing changes' })
  @ApiEnvelope(PassCheckResultDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  check(@CurrentUser() user: AuthUser, @Body() dto: PassCheckDto) {
    return this.leaves.check(schoolOf(user), dto);
  }

  @Post('passes/:id/out')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_PASS_OPERATE)
  @ResponseMessage('Marked out')
  @ApiOperation({ summary: 'Let the student out on this pass' })
  @ApiEnvelope(LeaveDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  out(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.leaves.goOut(schoolOf(user), id, user);
  }

  @Post('passes/:id/in')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_PASS_OPERATE)
  @ResponseMessage('Marked back in')
  @ApiOperation({ summary: 'The student is back' })
  @ApiEnvelope(LeaveDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  in(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.leaves.comeIn(schoolOf(user), id, user);
  }

  @Get('visits')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Visitor log (status=inside for who is in now)' })
  @ApiEnvelope(VisitDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  visits(@CurrentUser() user: AuthUser, @Query() query: VisitQueryDto) {
    return this.visitors.list(schoolOf(user), query);
  }

  @Get('visitors/lookup')
  @RequirePermissions(PERMISSIONS.HOSTEL_VISITOR)
  @ApiOperation({ summary: 'Type the visitor’s mobile: blocked? known parent or approved visitor?' })
  @ApiEnvelope(VisitorLookupDto)
  @ApiErrors(HttpStatus.BAD_REQUEST)
  lookup(@CurrentUser() user: AuthUser, @Query() query: VisitorLookupQueryDto) {
    return this.visitors.lookup(schoolOf(user), query.mobile, query.admission_id);
  }

  @Post('visits')
  @RequirePermissions(PERMISSIONS.HOSTEL_VISITOR)
  @ResponseMessage('Visitor recorded')
  @ApiOperation({ summary: 'Let a visitor in, or record them as turned away' })
  @ApiEnvelope(VisitDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  checkIn(@CurrentUser() user: AuthUser, @Body() dto: VisitInputDto) {
    return this.visitors.checkIn(schoolOf(user), dto, user);
  }

  @Post('visits/:id/out')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_VISITOR)
  @ResponseMessage('Visitor checked out')
  @ApiOperation({ summary: 'The visitor left' })
  @ApiEnvelope(VisitDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  checkOut(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.visitors.checkOut(schoolOf(user), id, user);
  }

  @Get('students/:studentId/approved-visitors')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Approved visitors of a student' })
  @ApiEnvelope(ApprovedVisitorDto, { isArray: true })
  approved(@CurrentUser() user: AuthUser, @Param('studentId', ParseIntPipe) studentId: number) {
    return this.visitors.approvedVisitors(schoolOf(user), studentId);
  }
}
