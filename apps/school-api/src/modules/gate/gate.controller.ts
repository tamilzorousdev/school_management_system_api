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
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelope,
  ApiErrors,
  AppException,
  AuthUser,
  CurrentUser,
  RequirePermissions,
  RequireRoles,
  ResponseMessage,
} from '@app/common';
import { ApiFile } from '../../shared/pdf-response';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS, ROLES } from '../access/access.catalog';
import { PARENT_MODULE_TAGS } from '../mobile/parent-modules.catalog';
import { TEACHER_MODULE_TAGS } from '../mobile/teacher-modules.catalog';
import {
  AuthorisedPickupDto,
  AuthorisedPickupInputDto,
  BlockDto,
  BlockInputDto,
  CheckDto,
  CheckResultDto,
  ConsentCodeDto,
  ConsentRequestDto,
  DecisionDto,
  EmergencyDto,
  EventQueryDto,
  GateEventDto,
  GatePassDto,
  GateReportDto,
  GateSettingsDto,
  GateStudentCardDto,
  GateTodayDto,
  GateVisitorsTodayDto,
  InviteDto,
  PassQueryDto,
  PassRequestDto,
  RangeDto,
  ReleaseDto,
  StaffOptionDto,
  StaffPassDto,
  StudentSearchDto,
  UpdateAuthorisedPickupDto,
  UpdateBlockDto,
  UpdateGateSettingsDto,
  VisitDecisionDto,
  VisitDto,
  VisitMoveDto,
  VisitQueryDto,
  WalkInDto,
} from './dto/gate.dto';
import { GateBoardService, XLSX } from './gate-board.service';
import { GateCoreService } from './gate-core.service';
import { GatePassesService } from './gate-passes.service';
import { GateVisitsService } from './gate-visits.service';

const schoolOf = (user: AuthUser): number => {
  if (!user.school_id) throw AppException.forbidden('Your account is not linked to a school', 'NO_SCHOOL');
  return user.school_id;
};

@ApiTags('Admin · Gate & visitors')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/gate')
export class AdminGateController {
  constructor(
    private readonly board: GateBoardService,
    private readonly core: GateCoreService,
    private readonly passes: GatePassesService,
    private readonly visits: GateVisitsService,
  ) {}

  @Get('today')
  @RequirePermissions(PERMISSIONS.GATE_VIEW)
  @ApiOperation({
    summary:
      'Live gate board: counts, passes due today, emergencies waiting, visitors inside and coming, latest events',
  })
  @ApiEnvelope(GateTodayDto)
  today(@SchoolId() schoolId: number) {
    return this.board.today(schoolId);
  }

  @Get('events')
  @RequirePermissions(PERMISSIONS.GATE_VIEW)
  @ApiOperation({
    summary:
      'Gate log: every request, decision, check (also refused ones), release and visitor in or out, newest first',
    description: 'Filters: kind, pass_id, visit_id, from, to. search matches the note, kind and who did it.',
  })
  @ApiEnvelope(GateEventDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  events(@SchoolId() schoolId: number, @Query() query: EventQueryDto) {
    return this.board.events(schoolId, query);
  }

  @Get('report')
  @RequirePermissions(PERMISSIONS.GATE_VIEW)
  @ApiOperation({
    summary: 'Gate report by day, class, check method, visit purpose and hour (default the last 30 days)',
  })
  @ApiEnvelope(GateReportDto)
  @ApiErrors(HttpStatus.BAD_REQUEST)
  report(@SchoolId() schoolId: number, @Query() query: RangeDto) {
    return this.board.report(schoolId, query);
  }

  @Get('settings')
  @RequirePermissions(PERMISSIONS.GATE_VIEW)
  @ApiOperation({ summary: 'Gate settings' })
  @ApiEnvelope(GateSettingsDto)
  settings(@SchoolId() schoolId: number) {
    return this.core.viewSettings(schoolId);
  }

  @Patch('settings')
  @RequirePermissions(PERMISSIONS.GATE_MANAGE)
  @ResponseMessage('Settings saved')
  @ApiOperation({ summary: 'Change gate settings' })
  @ApiEnvelope(GateSettingsDto, { message: 'Settings saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  updateSettings(@SchoolId() schoolId: number, @Body() dto: UpdateGateSettingsDto, @CurrentUser() actor: AuthUser) {
    return this.core.updateSettings(schoolId, dto, actor);
  }

  @Get('passes')
  @RequirePermissions(PERMISSIONS.GATE_VIEW)
  @ApiOperation({
    summary: 'Gate passes, newest first',
    description:
      'Filters: from, to (pass date), status, source, method (how it was checked at release), emergency, class_id, section_id. search matches pass number, student, admission number, pickup person and reason. sort: pass_date, created_at, released_at.',
  })
  @ApiEnvelope(GatePassDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  passList(@SchoolId() schoolId: number, @Query() query: PassQueryDto) {
    return this.passes.list(schoolId, query);
  }

  @Get('passes/xlsx')
  @RequirePermissions(PERMISSIONS.GATE_VIEW)
  @ApiOperation({ summary: 'Download gate passes as Excel (same filters, up to 5000)' })
  @ApiFile(XLSX, 'Gate passes')
  passFile(@SchoolId() schoolId: number, @Query() query: PassQueryDto) {
    return this.board.passesFile(schoolId, query);
  }

  @Get('passes/:id')
  @RequirePermissions(PERMISSIONS.GATE_VIEW)
  @ApiOperation({ summary: 'One gate pass with QR text and code while approved' })
  @ApiEnvelope(GatePassDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  passGet(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.passes.get(schoolId, id, true);
  }

  @Post('passes')
  @RequirePermissions(PERMISSIONS.GATE_APPROVE)
  @ResponseMessage('Gate pass created')
  @ApiOperation({
    summary: 'Create a gate pass for a parent who phoned or came to the office',
    description: 'approve_now approves it at once and sends the parent the code. pass_date today to 30 days ahead.',
  })
  @ApiEnvelope(GatePassDto, { status: HttpStatus.CREATED, message: 'Gate pass created' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  passCreate(@SchoolId() schoolId: number, @Body() dto: StaffPassDto, @CurrentUser() actor: AuthUser) {
    return this.passes.createByStaff(schoolId, dto, actor, 'office');
  }

  @Post('passes/:id/decision')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.GATE_APPROVE)
  @ResponseMessage('Decision saved')
  @ApiOperation({
    summary: 'Approve or reject a gate pass or emergency request; the first answer wins',
    description:
      '409 PASS_ALREADY_DECIDED; 409 CONSENT_PENDING when a parent has not agreed for someone not registered.',
  })
  @ApiEnvelope(GatePassDto, { message: 'Decision saved' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  passDecide(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DecisionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.passes.decide(schoolId, id, dto, actor);
  }

  @Post('passes/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.GATE_MANAGE)
  @ResponseMessage('Gate pass cancelled')
  @ApiOperation({ summary: 'Cancel a waiting or approved pass (409 PASS_NOT_CANCELLABLE)' })
  @ApiEnvelope(GatePassDto, { message: 'Gate pass cancelled' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  passCancel(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthUser) {
    return this.passes.cancelByStaff(schoolId, id, actor);
  }

  @Get('students')
  @RequirePermissions(PERMISSIONS.GATE_VIEW)
  @ApiOperation({ summary: 'Find students: photo, class, registered pickup people with photos, today’s passes' })
  @ApiEnvelope(GateStudentCardDto, { isArray: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  studentSearch(@SchoolId() schoolId: number, @Query() query: StudentSearchDto) {
    return this.passes.searchStudents(schoolId, query.search);
  }

  @Get('students/:id/pickups')
  @RequirePermissions(PERMISSIONS.GATE_VIEW)
  @ApiOperation({ summary: 'Authorised pickup persons of a student' })
  @ApiEnvelope(AuthorisedPickupDto, { isArray: true })
  pickups(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.passes.authorisedFor(schoolId, id);
  }

  @Post('students/:id/pickups')
  @RequirePermissions(PERMISSIONS.GATE_MANAGE)
  @ResponseMessage('Pickup person added')
  @ApiOperation({ summary: 'Add an authorised pickup person (up to 6 per student)' })
  @ApiEnvelope(AuthorisedPickupDto, { status: HttpStatus.CREATED, message: 'Pickup person added' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  addPickup(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AuthorisedPickupInputDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.passes.addAuthorised(schoolId, id, dto, actor);
  }

  @Patch('pickups/:id')
  @RequirePermissions(PERMISSIONS.GATE_MANAGE)
  @ResponseMessage('Pickup person updated')
  @ApiOperation({ summary: 'Edit or switch off an authorised pickup person' })
  @ApiEnvelope(AuthorisedPickupDto, { message: 'Pickup person updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  updatePickup(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAuthorisedPickupDto,
  ) {
    return this.passes.updateAuthorised(schoolId, null, id, dto);
  }

  @Delete('pickups/:id')
  @RequirePermissions(PERMISSIONS.GATE_MANAGE)
  @ResponseMessage('Pickup person removed')
  @ApiOperation({ summary: 'Remove an authorised pickup person' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  async removePickup(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.passes.removeAuthorised(schoolId, null, id);
    return null;
  }

  @Get('visits')
  @RequirePermissions(PERMISSIONS.GATE_VIEW)
  @ApiOperation({
    summary: 'Visitor log, newest first',
    description:
      'Filters: from, to (visit date), status, purpose, host_user_id. search matches name, mobile, slip number, company, note and vehicle.',
  })
  @ApiEnvelope(VisitDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  visitList(@SchoolId() schoolId: number, @Query() query: VisitQueryDto) {
    return this.visits.list(schoolId, query);
  }

  @Get('visits/xlsx')
  @RequirePermissions(PERMISSIONS.GATE_VIEW)
  @ApiOperation({ summary: 'Download the visitor log as Excel (same filters, up to 5000)' })
  @ApiFile(XLSX, 'Visitors')
  visitFile(@SchoolId() schoolId: number, @Query() query: VisitQueryDto) {
    return this.board.visitsFile(schoolId, query);
  }

  @Get('visits/:id')
  @RequirePermissions(PERMISSIONS.GATE_VIEW)
  @ApiOperation({ summary: 'One visit' })
  @ApiEnvelope(VisitDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  visitGet(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.visits.view(schoolId, id, true);
  }

  @Post('visits/invite')
  @RequirePermissions(PERMISSIONS.GATE_MANAGE)
  @ResponseMessage('Visitor invited')
  @ApiOperation({
    summary: 'Invite a visitor for a date: they get an SMS with the slip number and a 4-digit code',
    description: '409 PERSON_BLOCKED for someone on the blocked list.',
  })
  @ApiEnvelope(VisitDto, { status: HttpStatus.CREATED, message: 'Visitor invited' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  invite(@SchoolId() schoolId: number, @Body() dto: InviteDto, @CurrentUser() actor: AuthUser) {
    return this.visits.invite(schoolId, dto, actor);
  }

  @Post('visits/:id/decision')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.GATE_MANAGE)
  @ResponseMessage('Decision saved')
  @ApiOperation({ summary: 'Allow or decline a waiting visitor (409 VISIT_ANSWERED)' })
  @ApiEnvelope(VisitDto, { message: 'Decision saved' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  visitDecide(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: VisitDecisionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.visits.decide(schoolId, id, dto, actor);
  }

  @Post('visits/:id/out')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.GATE_MANAGE)
  @ResponseMessage('Checked out')
  @ApiOperation({ summary: 'Check a visitor out from the office (409 VISIT_NOT_INSIDE)' })
  @ApiEnvelope(VisitDto, { message: 'Checked out' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  visitOut(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthUser) {
    return this.visits.checkOut(schoolId, id, 'manual', actor);
  }

  @Post('visits/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.GATE_MANAGE)
  @ResponseMessage('Visit cancelled')
  @ApiOperation({ summary: 'Cancel an invited or waiting visit' })
  @ApiEnvelope(VisitDto, { message: 'Visit cancelled' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  visitCancel(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthUser) {
    return this.visits.cancel(schoolId, id, actor);
  }

  @Get('blocklist')
  @RequirePermissions(PERMISSIONS.GATE_VIEW)
  @ApiOperation({ summary: 'Blocked people' })
  @ApiEnvelope(BlockDto, { isArray: true })
  blocklist(@SchoolId() schoolId: number) {
    return this.visits.blocklist(schoolId);
  }

  @Post('blocklist')
  @RequirePermissions(PERMISSIONS.GATE_MANAGE)
  @ResponseMessage('Added to the blocked list')
  @ApiOperation({ summary: 'Block a person by name and mobile; the gate and the office are warned when they come' })
  @ApiEnvelope(BlockDto, { status: HttpStatus.CREATED, message: 'Added to the blocked list', isArray: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  addBlock(@SchoolId() schoolId: number, @Body() dto: BlockInputDto, @CurrentUser() actor: AuthUser) {
    return this.visits.addBlock(schoolId, dto, actor);
  }

  @Patch('blocklist/:id')
  @RequirePermissions(PERMISSIONS.GATE_MANAGE)
  @ResponseMessage('Blocked list updated')
  @ApiOperation({ summary: 'Edit or switch off a blocked entry' })
  @ApiEnvelope(BlockDto, { message: 'Blocked list updated', isArray: true })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  updateBlock(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBlockDto) {
    return this.visits.updateBlock(schoolId, id, dto);
  }

  @Delete('blocklist/:id')
  @RequirePermissions(PERMISSIONS.GATE_MANAGE)
  @ResponseMessage('Removed from the blocked list')
  @ApiOperation({ summary: 'Remove a blocked entry' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  async removeBlock(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.visits.removeBlock(schoolId, id);
    return null;
  }

  @Get('staff')
  @RequirePermissions(PERMISSIONS.GATE_VIEW)
  @ApiOperation({ summary: 'Staff a visitor can meet (for the host picker)' })
  @ApiQuery({ name: 'search', required: false })
  @ApiEnvelope(StaffOptionDto, { isArray: true })
  staff(@SchoolId() schoolId: number, @Query('search') search?: string) {
    return this.visits.staffOptions(schoolId, search?.slice(0, 60));
  }
}

@ApiTags(TEACHER_MODULE_TAGS.MODULE_12)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('mobile/teacher/gate')
export class MobileGateController {
  constructor(
    private readonly board: GateBoardService,
    private readonly passes: GatePassesService,
    private readonly visits: GateVisitsService,
  ) {}

  @Get('today')
  @RequirePermissions(PERMISSIONS.GATE_OPERATE)
  @ApiOperation({ summary: 'Gate home: counts, passes due today, emergencies waiting, visitors inside and coming' })
  @ApiEnvelope(GateTodayDto)
  today(@CurrentUser() user: AuthUser) {
    return this.board.today(schoolOf(user));
  }

  @Post('check')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.GATE_OPERATE)
  @ApiOperation({
    summary: 'Check a gate pass or visitor slip: scan the QR, type the 4-digit code or type the number',
    description:
      'Send one of qr, code or number. ok true = green; verdict and message say why when red. Nothing is changed: release with POST passes/{id}/release, let visitors in or out with visitors/{id}/in|out. 5 wrong codes in 10 minutes gives 429 TOO_MANY_TRIES.',
  })
  @ApiEnvelope(CheckResultDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.TOO_MANY_REQUESTS)
  check(@CurrentUser() user: AuthUser, @Body() dto: CheckDto) {
    return this.passes.check(schoolOf(user), dto, user);
  }

  @Get('students')
  @RequirePermissions(PERMISSIONS.GATE_OPERATE)
  @ApiOperation({
    summary: 'Manual check: find a student by name, admission number or class (5A)',
    description:
      'Each card has the student photo, registered parents and pickup persons with photos, and today’s passes.',
  })
  @ApiEnvelope(GateStudentCardDto, { isArray: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  students(@CurrentUser() user: AuthUser, @Query() query: StudentSearchDto) {
    return this.passes.searchStudents(schoolOf(user), query.search);
  }

  @Get('passes/:id')
  @RequirePermissions(PERMISSIONS.GATE_OPERATE)
  @ApiOperation({ summary: 'One pass (poll it while an emergency request waits)' })
  @ApiEnvelope(GatePassDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  pass(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.passes.get(schoolOf(user), id, false);
  }

  @Post('passes/:id/release')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.GATE_OPERATE)
  @ResponseMessage('Student released')
  @ApiOperation({
    summary: 'Release the student',
    description:
      'method: qr, code or manual. manual also needs photo_file_id (photo of the person), id_proof_kind and id_proof_last4. The pass is checked again (409 PASS_USED, PASS_EXPIRED, PASS_NOT_APPROVED, PASS_CONSENT_NEEDED…). Parents are told; before the afternoon attendance the student gets an approved afternoon half-day leave (the evening bus also shows them away).',
  })
  @ApiEnvelope(GatePassDto, { message: 'Student released' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  release(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: ReleaseDto) {
    return this.passes.release(schoolOf(user), id, dto, user);
  }

  @Post('emergency')
  @RequirePermissions(PERMISSIONS.GATE_OPERATE)
  @ResponseMessage('Emergency request sent')
  @ApiOperation({
    summary: 'Ask for an emergency release without a pass',
    description:
      'pickup kind guardian or authorised: a registered person; the class teacher and the office get an urgent push and the first to answer decides. kind other (not registered): also needs a photo; the parents are asked in the app and the gate must enter the code the parent gives (POST passes/{id}/consent-code) before release. 403 PERSON_BLOCKED; 409 EMERGENCY_WAITING. If nobody answers in time the gate gets GATE_NO_ANSWER: call the office.',
  })
  @ApiEnvelope(GatePassDto, { status: HttpStatus.CREATED, message: 'Emergency request sent' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  emergency(@CurrentUser() user: AuthUser, @Body() dto: EmergencyDto) {
    return this.passes.emergency(schoolOf(user), dto, user);
  }

  @Post('passes/:id/consent-code')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.GATE_OPERATE)
  @ResponseMessage('Parent code checked')
  @ApiOperation({
    summary: 'Enter the code the parent gave the person (400 WRONG_CODE, 409 CONSENT_PENDING, 429 TOO_MANY_TRIES)',
  })
  @ApiEnvelope(GatePassDto, { message: 'Parent code checked' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT, HttpStatus.TOO_MANY_REQUESTS)
  consentCode(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: ConsentCodeDto) {
    return this.passes.verifyConsent(schoolOf(user), id, dto.code, user);
  }

  @Post('visitors')
  @RequirePermissions(PERMISSIONS.GATE_OPERATE)
  @ResponseMessage('Visitor registered')
  @ApiOperation({
    summary: 'Register a walk-in visitor',
    description:
      'The person to meet (or the office when none) gets VISITOR_WAITING; the gate gets VISITOR_ANSWERED. A blocked person is saved as declined with blocked true and the office is warned.',
  })
  @ApiEnvelope(VisitDto, { status: HttpStatus.CREATED, message: 'Visitor registered' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  walkIn(@CurrentUser() user: AuthUser, @Body() dto: WalkInDto) {
    return this.visits.walkIn(schoolOf(user), dto, user);
  }

  @Get('visitors')
  @RequirePermissions(PERMISSIONS.GATE_OPERATE)
  @ApiOperation({ summary: 'Today’s visitors: inside now and coming (waiting, allowed, expected)' })
  @ApiEnvelope(GateVisitorsTodayDto)
  visitorsToday(@CurrentUser() user: AuthUser) {
    return this.visits.today(schoolOf(user));
  }

  @Post('visitors/:id/in')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.GATE_OPERATE)
  @ResponseMessage('Visitor in')
  @ApiOperation({
    summary: 'Let an allowed or invited visitor in (409 VISIT_WAITING, VISIT_NOT_OPEN, VISIT_NOT_TODAY)',
  })
  @ApiEnvelope(VisitDto, { message: 'Visitor in' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  visitIn(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: VisitMoveDto) {
    return this.visits.checkIn(schoolOf(user), id, dto.method, user);
  }

  @Post('visitors/:id/out')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.GATE_OPERATE)
  @ResponseMessage('Visitor out')
  @ApiOperation({ summary: 'Check a visitor out (409 VISIT_NOT_INSIDE)' })
  @ApiEnvelope(VisitDto, { message: 'Visitor out' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  visitOut(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: VisitMoveDto) {
    return this.visits.checkOut(schoolOf(user), id, dto.method, user);
  }

  @Get('staff')
  @RequirePermissions(PERMISSIONS.GATE_OPERATE)
  @ApiOperation({ summary: 'Staff a visitor can meet (for the host picker)' })
  @ApiQuery({ name: 'search', required: false })
  @ApiEnvelope(StaffOptionDto, { isArray: true })
  staff(@CurrentUser() user: AuthUser, @Query('search') search?: string) {
    return this.visits.staffOptions(schoolOf(user), search?.slice(0, 60));
  }

  @Get('approvals')
  @RequirePermissions(PERMISSIONS.GATE_APPROVE)
  @ApiOperation({
    summary: 'Teacher: gate passes and emergency requests of my class waiting for a decision (emergencies first)',
  })
  @ApiEnvelope(GatePassDto, { isArray: true })
  approvals(@CurrentUser() user: AuthUser) {
    return this.passes.toApprove(schoolOf(user), user);
  }

  @Post('passes/:id/decision')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.GATE_APPROVE)
  @ResponseMessage('Decision saved')
  @ApiOperation({
    summary:
      'Teacher: approve or reject a pass of my class (403 NOT_CLASS_TEACHER, 409 PASS_ALREADY_DECIDED, CONSENT_PENDING)',
  })
  @ApiEnvelope(GatePassDto, { message: 'Decision saved' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  decide(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: DecisionDto) {
    return this.passes.decide(schoolOf(user), id, dto, user);
  }

  @Post('passes')
  @RequirePermissions(PERMISSIONS.GATE_APPROVE)
  @ResponseMessage('Gate pass created')
  @ApiOperation({ summary: 'Teacher: create a pass for a parent who phoned (approve_now for my own class)' })
  @ApiEnvelope(GatePassDto, { status: HttpStatus.CREATED, message: 'Gate pass created' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  create(@CurrentUser() user: AuthUser, @Body() dto: StaffPassDto) {
    return this.passes.createByStaff(schoolOf(user), dto, user, 'staff');
  }
}

@ApiTags(PARENT_MODULE_TAGS.MODULE_2)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@RequireRoles(ROLES.PARENT)
@Controller('mobile/parent')
export class ParentGateController {
  constructor(private readonly passes: GatePassesService) {}

  @Get('children/:id/gate-passes')
  @ApiOperation({
    summary: 'Gate passes of my child, newest first',
    description:
      'An approved pass has qr_token (show it as a QR), code (4 digits) and pass_no; any one works at the gate.',
  })
  @ApiEnvelope(GatePassDto, { isArray: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  list(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.passes.forParent(user, id);
  }

  @Post('children/:id/gate-passes')
  @ResponseMessage('Gate pass requested')
  @ApiOperation({
    summary: 'Ask for a gate pass to take my child early',
    description:
      'pickup: guardian (a parent allowed to pick up), authorised (a saved pickup person) or other (name, relation, mobile). The class teacher or the office approves; I get GATE_PASS_DECIDED with the code. pass_date today to 30 days ahead; until_time defaults to 2 hours after from_time.',
  })
  @ApiEnvelope(GatePassDto, { status: HttpStatus.CREATED, message: 'Gate pass requested' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  request(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: PassRequestDto) {
    return this.passes.requestByParent(user, id, dto);
  }

  @Post('children/:id/gate-passes/:passId/cancel')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Gate pass cancelled')
  @ApiOperation({ summary: 'Cancel my request or an approved pass not used yet' })
  @ApiEnvelope(GatePassDto, { message: 'Gate pass cancelled' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('passId', ParseIntPipe) passId: number,
  ) {
    return this.passes.cancelByParent(user, id, passId);
  }

  @Get('children/:id/pickups')
  @ApiOperation({ summary: 'People I allow to pick up my child (with photos)' })
  @ApiEnvelope(AuthorisedPickupDto, { isArray: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  pickups(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.passes.authorisedForParent(user, id);
  }

  @Post('children/:id/pickups')
  @ResponseMessage('Pickup person added')
  @ApiOperation({ summary: 'Add a person who may pick up my child (photo from POST /files; up to 6)' })
  @ApiEnvelope(AuthorisedPickupDto, { status: HttpStatus.CREATED, message: 'Pickup person added' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  addPickup(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AuthorisedPickupInputDto,
  ) {
    return this.passes.addAuthorisedByParent(user, id, dto);
  }

  @Patch('children/:id/pickups/:pickupId')
  @ResponseMessage('Pickup person updated')
  @ApiOperation({ summary: 'Edit or switch off a pickup person' })
  @ApiEnvelope(AuthorisedPickupDto, { message: 'Pickup person updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  updatePickup(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('pickupId', ParseIntPipe) pickupId: number,
    @Body() dto: UpdateAuthorisedPickupDto,
  ) {
    return this.passes.updateAuthorisedByParent(user, id, pickupId, dto);
  }

  @Delete('children/:id/pickups/:pickupId')
  @ResponseMessage('Pickup person removed')
  @ApiOperation({ summary: 'Remove a pickup person' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  async removePickup(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('pickupId', ParseIntPipe) pickupId: number,
  ) {
    await this.passes.removeAuthorisedByParent(user, id, pickupId);
    return null;
  }

  @Get('gate-consents')
  @ApiOperation({
    summary: 'Someone not registered is at the gate to take my child today: agree or refuse',
    description: 'After agreeing, code is shown: read it to the person over the phone; the gate needs it to release.',
  })
  @ApiEnvelope(ConsentRequestDto, { isArray: true })
  consents(@CurrentUser() user: AuthUser) {
    return this.passes.consents(user);
  }

  @Post('gate-consents/:passId/decision')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Answer sent')
  @ApiOperation({ summary: 'Agree (approve true) or refuse; refusing stops the release (409 CONSENT_ANSWERED)' })
  @ApiEnvelope(ConsentRequestDto, { message: 'Answer sent' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  decide(@CurrentUser() user: AuthUser, @Param('passId', ParseIntPipe) passId: number, @Body() dto: DecisionDto) {
    return this.passes.consentDecision(user, passId, dto.approve);
  }
}

@ApiTags('Me · Visitors')
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('me/visitors')
export class MeVisitorsController {
  constructor(private readonly visits: GateVisitsService) {}

  @Get()
  @ApiOperation({
    summary: 'Visitors who came to meet me today and are waiting, allowed or inside (Staff app and admin web)',
  })
  @ApiEnvelope(VisitDto, { isArray: true })
  mine(@CurrentUser() user: AuthUser) {
    return this.visits.pendingForHost(schoolOf(user), user);
  }

  @Post(':id/decision')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Answer sent')
  @ApiOperation({
    summary: 'Allow or decline a visitor waiting at the gate to meet me (403 NOT_YOUR_VISITOR, 409 VISIT_ANSWERED)',
  })
  @ApiEnvelope(VisitDto, { message: 'Answer sent' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  decide(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: VisitDecisionDto) {
    return this.visits.decide(schoolOf(user), id, dto, user);
  }
}
