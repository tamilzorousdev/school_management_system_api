import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
import { PERMISSIONS, ROLES } from '../access/access.catalog';
import { CrewListItemDto } from '../crew/dto/crew.dto';
import {
  DriverDayDto,
  DutyMonthQueryDto,
  IncidentDto,
  IncidentInsightsDto,
  IncidentQueryDto,
  OperationsBoardDto,
  OperationsQueryDto,
  ResolveIncidentDto,
  StudentsTodayDto,
} from '../driver-ops/dto/driver-ops.dto';
import { ClearPreTripDto, PreTripCheckDto } from '../fleet-ops/dto/fleet-maintenance.dto';
import { FuelLogDto } from '../fleet-ops/dto/fleet-ops.dto';
import { TRANSPORT_MODULE_TAGS } from '../mobile/transport-modules.catalog';
import { StaffLeaveDecisionDto, StaffLeaveDto } from '../staff-leave/dto/staff-leave.dto';
import { AlertDto, AlertInsightsDto, ResolveAlertDto } from '../tracking/dto/fleet-alert.dto';
import { BusPassDto } from '../transport/dto/bus-pass.dto';
import { AllowedTodayDto, AllowTodayDto, VehicleDto } from '../transport/dto/transport.dto';
import { BusDetailDto, CrewLeaveQueryDto, CrewMemberDto, TransportHomeDto } from './dto/transport-incharge.dto';
import {
  BusRequestsDayDto,
  CrewMonthDto,
  DateQueryDto,
  LateTripsDto,
  MaintenanceDueDto,
  PassesOnHoldQueryDto,
  PreTripFailuresDto,
  TransportAlertQueryDto,
  TransportLiveDto,
  TransportMonthDto,
  TransportRatingsDto,
} from './dto/transport-ops.dto';
import { TransportInchargeService } from './transport-incharge.service';
import { TransportOpsService } from './transport-ops.service';

function schoolOf(user: AuthUser): number {
  if (!user.school_id) throw AppException.forbidden('Your account is not linked to a school', 'NO_SCHOOL');
  return user.school_id;
}

@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@RequireRoles(ROLES.TRANSPORT_INCHARGE)
@Controller('mobile/transport')
export class MobileTransportController {
  constructor(
    private readonly incharge: TransportInchargeService,
    private readonly ops: TransportOpsService,
  ) {}

  @Get('home')
  @ApiTags(TRANSPORT_MODULE_TAGS.MODULE_1)
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Home: trips today, SOS, drivers on duty, bus students, papers expiring, fuel and crew leave waiting',
    description:
      'One call for the home screen. ops has the counts for the operations tiles (Modules 4 and 5). papers counts bus and crew papers expired or due in 30 days, with the ten most urgent. crew_on_leave lists drivers and attendants on approved leave that day. date defaults to today.',
  })
  @ApiEnvelope(TransportHomeDto)
  home(@CurrentUser() user: AuthUser, @Query() query: OperationsQueryDto) {
    return this.incharge.home(schoolOf(user), query.date);
  }

  @Get('trips')
  @ApiTags(TRANSPORT_MODULE_TAGS.MODULE_1)
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({ summary: 'Every route’s pickup and drop for the day with status, progress, boarded and exceptions' })
  @ApiEnvelope(OperationsBoardDto)
  trips(@CurrentUser() user: AuthUser, @Query() query: OperationsQueryDto) {
    return this.incharge.trips(schoolOf(user), query.date);
  }

  @Get('students-today')
  @ApiTags(TRANSPORT_MODULE_TAGS.MODULE_1)
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({ summary: 'Bus students of the day: early leaves (gate passes), not coming per trip, passes on hold' })
  @ApiEnvelope(StudentsTodayDto)
  studentsToday(@CurrentUser() user: AuthUser, @Query() query: OperationsQueryDto) {
    return this.incharge.students(schoolOf(user), query.date);
  }

  @Get('buses')
  @ApiTags(TRANSPORT_MODULE_TAGS.MODULE_2)
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({ summary: 'Every bus with its crew, seats, road-worthiness and paper expiries' })
  @ApiEnvelope(VehicleDto, { paginated: true })
  buses(@CurrentUser() user: AuthUser) {
    return this.incharge.buses(schoolOf(user));
  }

  @Get('buses/:id')
  @ApiTags(TRANSPORT_MODULE_TAGS.MODULE_2)
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({ summary: 'One bus with the current copy of each paper (RC, insurance, fitness, permit, PUC…)' })
  @ApiEnvelope(BusDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  bus(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.incharge.bus(schoolOf(user), id);
  }

  @Get('crew')
  @ApiTags(TRANSPORT_MODULE_TAGS.MODULE_2)
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({ summary: 'Drivers and attendants with their bus, licence and paper expiries' })
  @ApiEnvelope(CrewListItemDto, { paginated: true })
  crew(@CurrentUser() user: AuthUser) {
    return this.incharge.crewList(schoolOf(user));
  }

  @Get('crew/:id')
  @ApiTags(TRANSPORT_MODULE_TAGS.MODULE_2)
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'One driver or attendant: details, experience, licence, checks, documents and the parents’ rating',
  })
  @ApiEnvelope(CrewMemberDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  crewMember(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.incharge.crewMember(schoolOf(user), id);
  }

  @Get('sos')
  @ApiTags(TRANSPORT_MODULE_TAGS.MODULE_3)
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({ summary: 'SOS still open or acknowledged, newest first' })
  @ApiEnvelope(AlertDto, { isArray: true })
  sos(@CurrentUser() user: AuthUser) {
    return this.incharge.activeSos(schoolOf(user));
  }

  @Post('sos/:id/acknowledge')
  @HttpCode(HttpStatus.OK)
  @ApiTags(TRANSPORT_MODULE_TAGS.MODULE_3)
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('SOS acknowledged')
  @ApiOperation({ summary: 'I have seen this SOS and I am handling it; the driver and the office see my name' })
  @ApiEnvelope(AlertDto, { message: 'SOS acknowledged' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  acknowledge(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.incharge.acknowledgeSos(schoolOf(user), id, user);
  }

  @Get('fuel')
  @ApiTags(TRANSPORT_MODULE_TAGS.MODULE_3)
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({ summary: 'Fuel entries drivers added that are waiting for review, newest first' })
  @ApiEnvelope(FuelLogDto, { paginated: true })
  fuel(@CurrentUser() user: AuthUser) {
    return this.incharge.pendingFuel(schoolOf(user));
  }

  @Get('leaves')
  @ApiTags(TRANSPORT_MODULE_TAGS.MODULE_3)
  @ApiOperation({
    summary: 'Driver and attendant leave requests: waiting (default), approved or rejected',
    description: 'Only bus crew. A driver or attendant’s leave comes to the transport in-charge first.',
  })
  @ApiEnvelope(StaffLeaveDto, { isArray: true })
  leaves(@CurrentUser() user: AuthUser, @Query() query: CrewLeaveQueryDto) {
    return this.incharge.crewLeaves(schoolOf(user), query.status);
  }

  @Post('leaves/:id/decision')
  @HttpCode(HttpStatus.OK)
  @ApiTags(TRANSPORT_MODULE_TAGS.MODULE_3)
  @ResponseMessage('Decision saved')
  @ApiOperation({
    summary: 'Approve or reject a driver or attendant leave (final). A note is needed to reject.',
    description: '403 NOT_CREW_LEAVE for anyone else’s leave, NOT_APPROVER, 409 LEAVE_NOT_PENDING.',
  })
  @ApiEnvelope(StaffLeaveDto, { message: 'Decision saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  decide(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: StaffLeaveDecisionDto) {
    return this.incharge.decideLeave(user, id, dto);
  }

  @Get('incidents/insights')
  @ApiTags(TRANSPORT_MODULE_TAGS.MODULE_4)
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({ summary: 'Incident counts: open, today, this month and breakdowns this month' })
  @ApiEnvelope(IncidentInsightsDto)
  incidentInsights(@CurrentUser() user: AuthUser) {
    return this.ops.incidentInsights(schoolOf(user));
  }

  @Get('incidents')
  @ApiTags(TRANSPORT_MODULE_TAGS.MODULE_4)
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Incidents and breakdowns reported by drivers, newest first',
    description: 'Same list as GET /admin/transport/incidents. Filters: status (open, resolved), type, vehicle_id.',
  })
  @ApiEnvelope(IncidentDto, { paginated: true })
  incidents(@CurrentUser() user: AuthUser, @Query() query: IncidentQueryDto) {
    return this.ops.incidents(schoolOf(user), query);
  }

  @Get('incidents/:id')
  @ApiTags(TRANSPORT_MODULE_TAGS.MODULE_4)
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({ summary: 'One incident with photos, students, bus, reporter, place and resolution' })
  @ApiEnvelope(IncidentDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  incident(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.ops.incident(schoolOf(user), id);
  }

  @Post('incidents/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiTags(TRANSPORT_MODULE_TAGS.MODULE_4)
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Incident resolved')
  @ApiOperation({
    summary: 'Close an incident with what was done; the driver who reported it is told',
    description: '409 INCIDENT_RESOLVED when already closed.',
  })
  @ApiEnvelope(IncidentDto, { message: 'Incident resolved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  resolveIncident(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResolveIncidentDto,
  ) {
    return this.ops.resolveIncident(schoolOf(user), id, dto.note, user);
  }

  @Post('buses/:id/allow-today')
  @HttpCode(HttpStatus.OK)
  @ApiTags(TRANSPORT_MODULE_TAGS.MODULE_4)
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Allowed to run today')
  @ApiOperation({
    summary: 'Let a bus that is not road-worthy run trips today only, with a written reason',
    description: 'Ends at midnight. Saved with who allowed it; sending it again the same day replaces the reason.',
  })
  @ApiEnvelope(AllowedTodayDto, { message: 'Allowed to run today' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  allowBusToday(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: AllowTodayDto) {
    return this.ops.allowBusToday(schoolOf(user), id, dto.reason, user);
  }

  @Post('crew/:id/approve-duty')
  @HttpCode(HttpStatus.OK)
  @ApiTags(TRANSPORT_MODULE_TAGS.MODULE_4)
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Approved for duty')
  @ApiOperation({
    summary: 'Approve a driver or attendant for duty when every check is clear',
    description:
      'id is the same as GET crew/{id}; returns the same shape. 400 CREW_NOT_CLEAR lists the failing checks; 400 CREW_INACTIVE for crew on leave or resigned.',
  })
  @ApiEnvelope(CrewMemberDto, { message: 'Approved for duty' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  approveDuty(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.incharge.approveDuty(schoolOf(user), id, user);
  }

  @Get('live')
  @ApiTags(TRANSPORT_MODULE_TAGS.MODULE_4)
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Live map: every bus with position, speed, state, last seen and the trip running now',
    description:
      'State and position come from the Telematics service. When it cannot be reached the call still succeeds: telematics_available is false, state is no_data and the position is the last one saved on the running trip (position_source trip).',
  })
  @ApiEnvelope(TransportLiveDto)
  live(@CurrentUser() user: AuthUser) {
    return this.ops.live(schoolOf(user));
  }

  @Get('trips/late')
  @ApiTags(TRANSPORT_MODULE_TAGS.MODULE_4)
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Late, not started and missed-stop trips of the day, most delayed first',
    description:
      'Threshold 10 minutes. not_started: no trip 10+ min after the first stop time. late_start: started 10+ min after it. running_late: running with a reported delay of 10+ min. missed_stops: completed with skipped stops. date defaults to today; for an earlier day a trip that never ran counts to 23:59.',
  })
  @ApiEnvelope(LateTripsDto)
  lateTrips(@CurrentUser() user: AuthUser, @Query() query: DateQueryDto) {
    return this.ops.lateTrips(schoolOf(user), query.date);
  }

  @Get('pre-trip-checks')
  @ApiTags(TRANSPORT_MODULE_TAGS.MODULE_4)
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Pre-trip checks of the day with at least one item not OK, plus counts',
    description:
      'blocked = a critical item is not OK and not cleared yet; clear it with POST pre-trip-checks/{id}/clear.',
  })
  @ApiEnvelope(PreTripFailuresDto)
  preTripFailures(@CurrentUser() user: AuthUser, @Query() query: DateQueryDto) {
    return this.ops.preTripFailures(schoolOf(user), query.date);
  }

  @Post('pre-trip-checks/:id/clear')
  @HttpCode(HttpStatus.OK)
  @ApiTags(TRANSPORT_MODULE_TAGS.MODULE_4)
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Bus cleared to run')
  @ApiOperation({
    summary: 'Clear a check with a critical failure so the bus can run today (409 CHECK_NOT_BLOCKED)',
    description: 'Clear it after the problem is fixed or checked. The repair ticket stays open until it is closed.',
  })
  @ApiEnvelope(PreTripCheckDto, { message: 'Bus cleared to run' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  clearPreTrip(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: ClearPreTripDto) {
    return this.ops.clearPreTrip(schoolOf(user), id, dto.note, user);
  }

  @Get('driver-attendance')
  @ApiTags(TRANSPORT_MODULE_TAGS.MODULE_4)
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Driver duty attendance for a day: every driver with bus, check-in, selfie, late minutes and check-out',
    description: 'Same as GET /admin/transport/driver-attendance. duty is null when the driver has not checked in.',
  })
  @ApiEnvelope(DriverDayDto, { isArray: true })
  driverAttendance(@CurrentUser() user: AuthUser, @Query() query: DateQueryDto) {
    return this.ops.driverAttendance(schoolOf(user), query.date);
  }

  @Get('driver-attendance/month')
  @ApiTags(TRANSPORT_MODULE_TAGS.MODULE_4)
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Month view per driver and attendant: days present, late days, absent days and leave days',
    description:
      'Bus days are the days the school ran at least one trip, up to today. absent_days = bus days with no check-in and no approved leave. month defaults to this month.',
  })
  @ApiEnvelope(CrewMonthDto)
  crewMonth(@CurrentUser() user: AuthUser, @Query() query: DutyMonthQueryDto) {
    return this.ops.crewMonth(schoolOf(user), query.month);
  }

  @Get('alerts/insights')
  @ApiTags(TRANSPORT_MODULE_TAGS.MODULE_4)
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({ summary: 'Alert counts: open, SOS active, high severity, acknowledged, today and per kind' })
  @ApiEnvelope(AlertInsightsDto)
  alertInsights(@CurrentUser() user: AuthUser) {
    return this.ops.alertInsights(schoolOf(user));
  }

  @Get('alerts')
  @ApiTags(TRANSPORT_MODULE_TAGS.MODULE_4)
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Fleet alerts (overspeed, harsh braking, route deviation, idle, SOS …), newest first',
    description: 'Same items as GET /admin/fleet/alerts. type filters the kind; status: open, acknowledged, resolved.',
  })
  @ApiEnvelope(AlertDto, { paginated: true })
  alerts(@CurrentUser() user: AuthUser, @Query() query: TransportAlertQueryDto) {
    return this.ops.alertList(schoolOf(user), query);
  }

  @Post('alerts/:id/acknowledge')
  @HttpCode(HttpStatus.OK)
  @ApiTags(TRANSPORT_MODULE_TAGS.MODULE_4)
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Alert acknowledged')
  @ApiOperation({ summary: 'I have seen this alert and I am handling it' })
  @ApiEnvelope(AlertDto, { message: 'Alert acknowledged' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  acknowledgeAlert(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.ops.acknowledgeAlert(schoolOf(user), id, user);
  }

  @Post('alerts/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiTags(TRANSPORT_MODULE_TAGS.MODULE_4)
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Alert resolved')
  @ApiOperation({ summary: 'Close an alert with what was done (resolution_note, 3 to 500 characters)' })
  @ApiEnvelope(AlertDto, { message: 'Alert resolved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  resolveAlert(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: ResolveAlertDto) {
    return this.ops.resolveAlert(schoolOf(user), id, dto, user);
  }

  @Get('bus-requests')
  @ApiTags(TRANSPORT_MODULE_TAGS.MODULE_4)
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Parent bus requests of the day: no-bus trips and one-time pickup persons (view only)',
    description: 'They apply by themselves; there is nothing to approve. date defaults to today.',
  })
  @ApiEnvelope(BusRequestsDayDto)
  busRequests(@CurrentUser() user: AuthUser, @Query() query: DateQueryDto) {
    return this.ops.busRequests(schoolOf(user), query.date);
  }

  @Get('passes-on-hold')
  @ApiTags(TRANSPORT_MODULE_TAGS.MODULE_4)
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({ summary: 'Bus passes on hold this academic year (same items as GET /admin/transport/bus-passes)' })
  @ApiEnvelope(BusPassDto, { paginated: true })
  passesOnHold(@CurrentUser() user: AuthUser, @Query() query: PassesOnHoldQueryDto) {
    return this.ops.passesOnHold(schoolOf(user), query);
  }

  @Get('ratings')
  @ApiTags(TRANSPORT_MODULE_TAGS.MODULE_5)
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({ summary: 'Parent ratings: summary per driver and the 20 latest ratings, lowest first' })
  @ApiEnvelope(TransportRatingsDto)
  ratings(@CurrentUser() user: AuthUser) {
    return this.ops.ratings(schoolOf(user));
  }

  @Get('maintenance-due')
  @ApiTags(TRANSPORT_MODULE_TAGS.MODULE_5)
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Service rules overdue or due soon on active buses, overdue first',
    description: 'due_soon = due in 30 days or 1000 km. From the service rules of GET /admin/fleet/schedules.',
  })
  @ApiEnvelope(MaintenanceDueDto)
  maintenanceDue(@CurrentUser() user: AuthUser) {
    return this.ops.maintenanceDue(schoolOf(user));
  }

  @Get('summary')
  @ApiTags(TRANSPORT_MODULE_TAGS.MODULE_5)
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Monthly summary: trips run and on time, incidents, crew leave days and fuel, per bus',
    description:
      'On time = started less than 10 min after the first stop time and a reported delay under 10 min. Fuel counts approved entries; km_per_litre is the fill-to-fill figure of the mileage report. month defaults to this month.',
  })
  @ApiEnvelope(TransportMonthDto)
  summary(@CurrentUser() user: AuthUser, @Query() query: DutyMonthQueryDto) {
    return this.ops.summary(schoolOf(user), query.month);
  }
}
