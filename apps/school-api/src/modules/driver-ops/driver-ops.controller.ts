import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelope,
  ApiErrors,
  AuthUser,
  CurrentUser,
  RequirePermissions,
  RequireRoles,
  ResponseMessage,
} from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS, ROLES } from '../access/access.catalog';
import { DRIVER_MODULE_TAGS } from '../mobile/driver-modules.catalog';
import { PARENT_MODULE_TAGS } from '../mobile/parent-modules.catalog';
import { BusRequestsService } from './bus-requests.service';
import { DriverDutyService } from './driver-duty.service';
import {
  BreakdownInputDto,
  BusAttendanceQueryDto,
  BusAttendanceRowDto,
  ChildBusTodayDto,
  DriverDayDto,
  DutyCheckInDto,
  DutyCheckOutDto,
  DutyListQueryDto,
  DutyMonthDto,
  DutyMonthQueryDto,
  DutyTodayDto,
  IncidentDto,
  IncidentInputDto,
  IncidentInsightsDto,
  IncidentQueryDto,
  OperationsBoardDto,
  StudentsTodayDto,
  OperationsQueryDto,
  OptOutInputDto,
  PickupPersonInputDto,
  ResolveIncidentDto,
  StudentHandoverDto,
} from './dto/driver-ops.dto';
import { DriverStudentsService } from './driver-students.service';
import { MyStudentsDto, ScanInputDto, ScanResultDto } from './dto/driver-students.dto';
import { IncidentsService } from './incidents.service';
import { OperationsService } from './operations.service';
import { StudentsTodayService } from './students-today.service';

@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@RequireRoles(ROLES.DRIVER, ROLES.ATTENDANT)
@Controller('mobile/driver')
export class MobileDriverOpsController {
  constructor(
    private readonly duty: DriverDutyService,
    private readonly incidents: IncidentsService,
    private readonly requests: BusRequestsService,
    private readonly students: DriverStudentsService,
  ) {}

  @Get('my-students')
  @ApiTags(DRIVER_MODULE_TAGS.MODULE_3)
  @ApiOperation({
    summary: 'My Students: everyone on my bus today, grouped by stop, with today’s status and pass state',
    description:
      'today.pickup / today.drop: coming, away (leave, absent, OD or the parent said no bus; see the note) or not_riding. pass.state on_hold shows the reason. pickup_person is the parent’s one-time person for today. parents[] with can_pickup for hand-over and mobile to call.',
  })
  @ApiEnvelope(MyStudentsDto)
  myStudents(@CurrentUser() user: AuthUser) {
    return this.students.myStudents(user);
  }

  @Post('scan')
  @ApiTags(DRIVER_MODULE_TAGS.MODULE_3)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Scan a bus pass or ID card: who it is, the pass status, wrong-bus check and what to mark',
    description:
      'Nothing is marked here. Show the warnings, then mark with POST /mobile/driver/trips/{id}/boardings { action: trip.suggested_action, qr_token }. A child with the pass on hold may still board (confirm first); the parent and the office are told. 400 QR_INVALID, 409 QR_REPLACED, 404 PASS_NOT_FOUND, TRANSPORT_NOT_FOUND.',
  })
  @ApiEnvelope(ScanResultDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  scan(@CurrentUser() user: AuthUser, @Body() dto: ScanInputDto) {
    return this.students.scan(user, dto);
  }

  @Get('attendance/today')
  @ApiTags(DRIVER_MODULE_TAGS.MODULE_1)
  @ApiOperation({
    summary: 'My duty today: bus, attendant, reporting time, check-in and check-out, and whether I am blocked',
    description:
      'reporting_time is the first stop time of my routes minus 15 minutes; checking in after it counts as late. blocked is true when my documents or the bus papers have expired.',
  })
  @ApiEnvelope(DutyTodayDto)
  today(@CurrentUser() user: AuthUser) {
    return this.duty.today(user);
  }

  @Post('attendance/check-in')
  @ApiTags(DRIVER_MODULE_TAGS.MODULE_1)
  @ResponseMessage('Checked in')
  @ApiOperation({
    summary: 'Check in for duty with a selfie and my location, and say if the attendant is with me',
    description:
      'Upload the selfie first with POST /files. check_in_place is school, stop (a stop of my route), other or unknown; it does not block. attendant_present false tells the transport office. 409 ALREADY_CHECKED_IN; 403 NO_BUS.',
  })
  @ApiEnvelope(DutyTodayDto, { status: HttpStatus.CREATED, message: 'Checked in' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  checkIn(@CurrentUser() user: AuthUser, @Body() dto: DutyCheckInDto) {
    return this.duty.checkIn(user, dto);
  }

  @Post('attendance/check-out')
  @ApiTags(DRIVER_MODULE_TAGS.MODULE_1)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Checked out')
  @ApiOperation({
    summary: 'Check out at the end of the day',
    description: '409 NOT_CHECKED_IN, ALREADY_CHECKED_OUT, TRIP_RUNNING (end the trip first).',
  })
  @ApiEnvelope(DutyTodayDto, { message: 'Checked out' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  checkOut(@CurrentUser() user: AuthUser, @Body() dto: DutyCheckOutDto) {
    return this.duty.checkOut(user, dto);
  }

  @Get('attendance')
  @ApiTags(DRIVER_MODULE_TAGS.MODULE_5)
  @ApiOperation({ summary: 'My duty attendance for a month: days on duty, late days and each day' })
  @ApiEnvelope(DutyMonthDto)
  month(@CurrentUser() user: AuthUser, @Query() query: DutyMonthQueryDto) {
    return this.duty.month(user, query.month);
  }

  @Get('trips/:id/handover')
  @ApiTags(DRIVER_MODULE_TAGS.MODULE_3)
  @ApiOperation({
    summary: 'Who may collect each child of this trip: parents allowed to pick up, plus today’s one-time person',
    description:
      'Hand the child only to one of persons[]; send their name as handed_to when marking alighted. medical_note shows allergies and conditions.',
  })
  @ApiEnvelope(StudentHandoverDto, { isArray: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  handover(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.requests.handoverList(user, id);
  }

  @Post('trips/:id/breakdown')
  @ApiTags(DRIVER_MODULE_TAGS.MODULE_4)
  @ResponseMessage('Breakdown reported to the office')
  @ApiOperation({
    summary: 'The bus broke down on the road: tell the transport office so they send another bus',
    description:
      'The office moves the trip to another bus with POST /admin/transport/trips/{id}/handover. 409 TRIP_ENDED; 403 NOT_YOUR_TRIP.',
  })
  @ApiEnvelope(IncidentDto, { status: HttpStatus.CREATED, message: 'Breakdown reported to the office' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  breakdown(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: BreakdownInputDto) {
    return this.incidents.breakdown(user, id, dto);
  }

  @Post('incidents')
  @ApiTags(DRIVER_MODULE_TAGS.MODULE_4)
  @ResponseMessage('Incident reported to the office')
  @ApiOperation({
    summary: 'Report an incident: accident, injury, medical, misbehaviour, fight or other, with photos and students',
    description: 'Upload photos first with POST /files. The office and the principal get a push.',
  })
  @ApiEnvelope(IncidentDto, { status: HttpStatus.CREATED, message: 'Incident reported to the office' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  report(@CurrentUser() user: AuthUser, @Body() dto: IncidentInputDto) {
    return this.incidents.report(user, dto);
  }

  @Get('incidents')
  @ApiTags(DRIVER_MODULE_TAGS.MODULE_4)
  @ApiOperation({ summary: 'Incidents I reported, newest first, with status and the office note' })
  @ApiEnvelope(IncidentDto, { isArray: true })
  mine(@CurrentUser() user: AuthUser) {
    return this.incidents.mine(user);
  }
}

@ApiTags(PARENT_MODULE_TAGS.MODULE_2)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND)
@RequireRoles(ROLES.PARENT)
@Controller('mobile/parent/children/:id/bus')
export class MobileParentBusRequestsController {
  constructor(private readonly requests: BusRequestsService) {}

  @Get('requests')
  @ApiOperation({
    summary: 'Bus requests for my child: days without the bus and one-time pickup persons, today onwards',
  })
  @ApiEnvelope(ChildBusTodayDto)
  list(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.requests.childBus(user, id);
  }

  @Post('opt-outs')
  @ResponseMessage('The driver is told')
  @ApiOperation({
    summary: 'My child will not take the bus on a day: morning pickup, evening drop or both',
    description:
      'Up to 30 days ahead. The driver sees it in the boarding list and gets a push; the child is not counted as not-boarded. 409 NO_BUS_ASSIGNED, ALREADY_ON_BUS.',
  })
  @ApiEnvelope(ChildBusTodayDto, { status: HttpStatus.CREATED, message: 'The driver is told' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  optOut(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: OptOutInputDto) {
    return this.requests.optOut(user, id, dto);
  }

  @Delete('opt-outs/:optOutId')
  @ResponseMessage('My child takes the bus again')
  @ApiOperation({ summary: 'Undo a no-bus day', description: '409 OPT_OUT_PAST once the day is over.' })
  @ApiEnvelope(ChildBusTodayDto, { message: 'My child takes the bus again' })
  @ApiErrors(HttpStatus.CONFLICT)
  cancelOptOut(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('optOutId', ParseIntPipe) optOutId: number,
  ) {
    return this.requests.cancelOptOut(user, id, optOutId);
  }

  @Post('pickup-person')
  @ResponseMessage('The driver is told')
  @ApiOperation({
    summary: 'Someone else collects my child from the bus on a day (one-time pickup person)',
    description:
      'Name, relation, mobile and an optional photo (upload with POST /files). Up to 7 days ahead; one per day, a new one replaces the old. The driver sees it in the hand-over list.',
  })
  @ApiEnvelope(ChildBusTodayDto, { status: HttpStatus.CREATED, message: 'The driver is told' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  pickupPerson(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PickupPersonInputDto,
  ) {
    return this.requests.setPickupPerson(user, id, dto);
  }

  @Delete('pickup-person/:personId')
  @ResponseMessage('Pickup person removed')
  @ApiOperation({ summary: 'Remove a one-time pickup person' })
  @ApiEnvelope(ChildBusTodayDto, { message: 'Pickup person removed' })
  removePickupPerson(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('personId', ParseIntPipe) personId: number,
  ) {
    return this.requests.removePickupPerson(user, id, personId);
  }
}

@ApiTags('Admin · Transport operations')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/transport')
export class AdminTransportOpsController {
  constructor(
    private readonly operations: OperationsService,
    private readonly duty: DriverDutyService,
    private readonly incidents: IncidentsService,
    private readonly studentsToday: StudentsTodayService,
  ) {}

  @Get('students-today')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Bus children today: early leaves (gate passes), who is not coming per trip, and passes on hold',
    description:
      'View only. early_leaves: gate passes for the day that are approved (waiting at the gate) or released, for children with a bus. away: riders with a reason for the pickup and or the drop (leave, half_day, od, absent, no_bus, early_leave). on_hold: bus passes on hold. date defaults to today.',
  })
  @ApiEnvelope(StudentsTodayDto)
  studentsTodayList(@SchoolId() schoolId: number, @Query() query: OperationsQueryDto) {
    return this.studentsToday.today(schoolId, query.date);
  }

  @Get('operations')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Today’s board: every route’s pickup and drop with status, progress, boarded vs expected, and exceptions',
    description:
      'status: not_started, late_start (10 min past the first stop time), running, delayed, completed. exceptions: sos, late_start, delayed, no_sweep, not_boarded, attendant_absent, driver_not_checked_in, open_incident.',
  })
  @ApiEnvelope(OperationsBoardDto)
  board(@SchoolId() schoolId: number, @Query() query: OperationsQueryDto) {
    return this.operations.board(schoolId, query.date);
  }

  @Get('driver-attendance')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Driver duty attendance for a day: every driver with bus, check-in, selfie, late minutes and check-out',
  })
  @ApiEnvelope(DriverDayDto, { isArray: true })
  driverAttendance(@SchoolId() schoolId: number, @Query() query: DutyListQueryDto) {
    return this.duty.dayList(schoolId, query.date);
  }

  @Get('bus-attendance')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Student bus attendance for a day: morning and evening status per student, hand-over and class mismatch',
    description:
      'pickup: boarded, not_boarded, waiting, away, no_trip or not_riding. drop: dropped, on_bus, not_boarded, waiting, away, no_trip or not_riding. mismatch is true when the bus and the class register disagree.',
  })
  @ApiEnvelope(BusAttendanceRowDto, { isArray: true })
  busAttendance(@SchoolId() schoolId: number, @Query() query: BusAttendanceQueryDto) {
    return this.operations.busAttendance(schoolId, query.date, query.route_id);
  }

  @Get('incidents/insights')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({ summary: 'Incident counts: open, today, this month and breakdowns this month' })
  @ApiEnvelope(IncidentInsightsDto)
  incidentInsights(@SchoolId() schoolId: number) {
    return this.incidents.insights(schoolId);
  }

  @Get('incidents')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({ summary: 'Incidents and breakdowns reported by drivers, newest first' })
  @ApiEnvelope(IncidentDto, { paginated: true })
  incidentList(@SchoolId() schoolId: number, @Query() query: IncidentQueryDto) {
    return this.incidents.list(schoolId, query);
  }

  @Get('incidents/:id')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({ summary: 'One incident with photos and students' })
  @ApiEnvelope(IncidentDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  incident(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.incidents.detail(schoolId, id);
  }

  @Post('incidents/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Incident resolved')
  @ApiOperation({
    summary: 'Close an incident with what was done; the driver who reported it is told',
    description: '409 INCIDENT_RESOLVED when already closed.',
  })
  @ApiEnvelope(IncidentDto, { message: 'Incident resolved' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  resolve(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResolveIncidentDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.incidents.resolve(schoolId, id, dto.note, actor);
  }
}
