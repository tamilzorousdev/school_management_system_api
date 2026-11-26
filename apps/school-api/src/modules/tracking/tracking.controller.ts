import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiExcludeEndpoint, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import {
  ApiEnvelope,
  ApiErrors,
  AppException,
  AuthUser,
  CurrentUser,
  Public,
  RequirePermissions,
  RequireRoles,
  ResponseMessage,
} from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS, ROLES } from '../access/access.catalog';
import { DRIVER_MODULE_TAGS } from '../mobile/driver-modules.catalog';
import {
  DriverTodayDto,
  PhonePositionDto,
  StartTripDto,
  StopAction,
  StopActionInputDto,
  TripDetailDto,
  TripSweepInputDto,
  BusDelayInputDto,
  HandoverInputDto,
  HandoverResultDto,
  TripDto,
  TripListItemDto,
  TripQueryDto,
} from './dto/tracking.dto';
import { TripDelayService } from './trip-delay.service';
import { TripHandoverService } from './trip-handover.service';
import { BoardingChecklistService } from './boarding-checklist.service';
import { BoardingHistoryQueryDto, StudentTripDto, TripChecklistDto, TripHistoryDto } from './dto/checklist.dto';
import { TripEventsService } from './trip-events.service';
import { TripsService } from './trips.service';

@ApiTags('Admin · Trips')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/transport/trips')
export class AdminTripsController {
  constructor(
    private readonly trips: TripsService,
    private readonly checklist: BoardingChecklistService,
    private readonly handovers: TripHandoverService,
    private readonly events: TripEventsService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Bus trips, newest first. Filter by date, status, route, bus and flag.',
    description:
      'Ended trips have flags { not_boarded, not_alighted }; running trips have flags null. flag=not_alighted lists trips where a child was left marked on the bus.',
  })
  @ApiEnvelope(TripListItemDto, { paginated: true })
  list(@SchoolId() schoolId: number, @Query() query: TripQueryDto) {
    return this.trips.list(schoolId, query);
  }

  @Get(':id/checklist')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Boarding checklist of a trip: every student in stop order with status, marks, flag, bus pass and parents',
    description:
      'Same as the attendant sees. status: waiting, on_bus, off_bus or away. flag after the trip ends: not_boarded or not_alighted.',
  })
  @ApiEnvelope(TripChecklistDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  tripChecklist(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.checklist.officeChecklist(schoolId, id);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'One trip: stops in travel order with live status and ETA, event timeline, riders and not-boarded list',
    description:
      'Follow it live over the socket: connect to /live with { auth: { token } } and emit trip.subscribe { trip_id }.',
  })
  @ApiEnvelope(TripDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  detail(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.trips.detail(schoolId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Trip started')
  @ApiOperation({
    summary: 'Start a trip for a route (normally the driver does this in the app)',
    description:
      'Errors: NO_TRACKER, ROUTE_HAS_NO_BUS, ROUTE_HAS_NO_STOPS, SCHOOL_LOCATION_MISSING (400); TRIP_ALREADY_ACTIVE (409); TELEMATICS_UNAVAILABLE (503).',
  })
  @ApiEnvelope(TripDetailDto, { status: HttpStatus.CREATED, message: 'Trip started' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT, HttpStatus.SERVICE_UNAVAILABLE)
  async start(@SchoolId() schoolId: number, @Body() dto: StartTripDto, @CurrentUser() actor: AuthUser) {
    const started = await this.trips.start(schoolId, dto, actor);
    await this.events.phoneStarted(await this.trips.find(schoolId, started.id));
    return this.trips.detail(schoolId, started.id);
  }

  @Post(':id/handover')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Handed over to the new bus')
  @ApiOperation({
    summary: 'Breakdown on the road: hand the running trip over to another bus',
    description:
      'Starts a trip on the new bus for the stops not passed yet (it needs a GPS tracker and must not be on another trip), copies the children already on board, and ends this trip with end_reason breakdown without the end-of-trip alerts. Parents of children on board get BUS_HANDOVER_ONBOARD, parents still waiting, both crews and the office get BUS_HANDOVER. keep_for_today also runs the route with the new bus for the rest of the day. 409 TRIP_ENDED, TRIP_ALREADY_ACTIVE; 400 SAME_BUS, NO_TRACKER.',
  })
  @ApiEnvelope(HandoverResultDto, { message: 'Handed over to the new bus' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  handover(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: HandoverInputDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.handovers.handover(schoolId, id, dto, actor);
  }

  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Trip ended')
  @ApiOperation({ summary: 'End a trip from the office' })
  @ApiEnvelope(TripDetailDto, { message: 'Trip ended' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  async end(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.trips.end(schoolId, id, 'admin');
    await this.events.afterManualEnd(await this.trips.find(schoolId, id), 'admin');
    return this.trips.detail(schoolId, id);
  }
}

@ApiTags('Admin · Trips')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/students/:id/bus-history')
export class AdminStudentBusController {
  constructor(private readonly checklist: BoardingChecklistService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Bus boarding history of a student: each trip with when and where they got on and off',
    description: 'Newest first. from and to default to the last 30 days. status and flag as in the trip checklist.',
  })
  @ApiEnvelope(StudentTripDto, { paginated: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  history(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: BoardingHistoryQueryDto,
  ) {
    return this.checklist.studentHistory(schoolId, id, query);
  }
}

@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@RequireRoles(ROLES.DRIVER, ROLES.ATTENDANT)
@Controller('mobile/driver/trips')
export class DriverTripsController {
  constructor(
    private readonly trips: TripsService,
    private readonly checklist: BoardingChecklistService,
    private readonly delays: TripDelayService,
    private readonly events: TripEventsService,
  ) {}

  @Get('today')
  @ApiTags(DRIVER_MODULE_TAGS.MODULE_1)
  @ApiOperation({
    summary: 'Home screen: my bus, the trip running now, and each route with today’s trips',
    description: 'Show a Start button per route (Morning pickup / Evening drop) when active_trip is null.',
  })
  @ApiEnvelope(DriverTodayDto)
  today(@CurrentUser() user: AuthUser) {
    return this.trips.driverToday(user);
  }

  @Get('history')
  @ApiTags(DRIVER_MODULE_TAGS.MODULE_3)
  @ApiOperation({
    summary: 'Boarding history: past trips of my bus with boarded, got-off and flagged counts',
    description:
      'from and to default to the last 30 days. Open a trip with GET /mobile/driver/trips/{id}/checklist to see each student.',
  })
  @ApiEnvelope(TripHistoryDto, { paginated: true })
  async history(@CurrentUser() user: AuthUser, @Query() query: BoardingHistoryQueryDto) {
    return this.checklist.vehicleHistory(user.school_id!, await this.vehicleOf(user), query);
  }

  @Post(':id/delay')
  @ApiTags(DRIVER_MODULE_TAGS.MODULE_2)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Parents told the bus is late')
  @ApiOperation({
    summary: 'Bus delayed: tell the parents of this trip the bus is about N minutes late',
    description:
      'Buttons 10, 20, 30 minutes (any 5 to 180) and an optional reason. Parents of the trip and the transport office get a push; live screens get trip.event type trip.delayed. 409 TRIP_ENDED, 403 NOT_YOUR_TRIP, 429 DELAY_TOO_SOON (once every 3 minutes).',
  })
  @ApiEnvelope(TripDto, { message: 'Parents told the bus is late' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT, HttpStatus.TOO_MANY_REQUESTS)
  async delay(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: BusDelayInputDto) {
    return this.delays.report(user, id, await this.vehicleOf(user), dto);
  }

  @Get(':id/checklist')
  @ApiTags(DRIVER_MODULE_TAGS.MODULE_3)
  @ApiOperation({
    summary: 'Boarding checklist: every student of the trip in stop order with status, times and flag',
    description:
      'status: waiting, on_bus, off_bus or away (on leave or absent today). Mark with POST /mobile/driver/trips/{id}/boardings { action, student_id }. ' +
      'After the trip ends, flag shows not_boarded or not_alighted. Works for past trips too. Lighter than the trip screen, so poll it freely.',
  })
  @ApiEnvelope(TripChecklistDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  async tripChecklist(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.checklist.crewChecklist(user.school_id!, id, await this.vehicleOf(user));
  }

  @Post()
  @ApiTags(DRIVER_MODULE_TAGS.MODULE_2)
  @ResponseMessage('Trip started')
  @ApiOperation({
    summary: 'Start a trip on my bus',
    description:
      'pickup = stops to school, drop = school to stops. Parents of the route get "Bus has started". ' +
      'tracking telematics: the GPS tracker moves the stops and ends the trip by itself. ' +
      'tracking phone (no tracker, or tracking is down): tap Reached, Left or Skip on each stop and End at the last one; send the phone location every 10 s.',
  })
  @ApiEnvelope(TripDetailDto, { status: HttpStatus.CREATED, message: 'Trip started' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async start(@CurrentUser() user: AuthUser, @Body() dto: StartTripDto) {
    const vehicle = await this.vehicleOf(user);
    const started = await this.trips.start(user.school_id!, dto, user, vehicle);
    await this.events.phoneStarted(await this.trips.find(user.school_id!, started.id));
    return this.trips.detail(user.school_id!, started.id);
  }

  @Post(':id/stops/:stopId/arrived')
  @ApiTags(DRIVER_MODULE_TAGS.MODULE_2)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Stop reached')
  @ApiOperation({
    summary: 'Reached this stop (phone trips): parents of this stop get "Bus has arrived"',
    description: '409 TRIP_ENDED, TRIP_TRACKED_BY_GPS (the tracker does this); 404 STOP_NOT_FOUND.',
  })
  @ApiEnvelope(TripDetailDto, { message: 'Stop reached' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async arrived(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('stopId', ParseIntPipe) stopId: number,
  ) {
    return this.stopAction(user, id, stopId, 'arrived');
  }

  @Post(':id/stops/:stopId/departed')
  @ApiTags(DRIVER_MODULE_TAGS.MODULE_2)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Left the stop')
  @ApiOperation({
    summary: 'Left this stop (phone trips): parents of the next stop get "Bus is coming"',
    description:
      'Earlier stops not reached are marked skipped. 409 TRIP_ENDED, TRIP_TRACKED_BY_GPS; 404 STOP_NOT_FOUND.',
  })
  @ApiEnvelope(TripDetailDto, { message: 'Left the stop' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async departed(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('stopId', ParseIntPipe) stopId: number,
  ) {
    return this.stopAction(user, id, stopId, 'departed');
  }

  @Post(':id/stops/:stopId/skip')
  @ApiTags(DRIVER_MODULE_TAGS.MODULE_2)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Stop skipped')
  @ApiOperation({
    summary: 'Skip this stop (phone trips): parents of this stop get "Bus did not stop" with the reason',
    description: 'The next stop then gets "Bus is coming". 409 TRIP_ENDED, TRIP_TRACKED_BY_GPS; 404 STOP_NOT_FOUND.',
  })
  @ApiEnvelope(TripDetailDto, { message: 'Stop skipped' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async skip(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('stopId', ParseIntPipe) stopId: number,
    @Body() dto: StopActionInputDto,
  ) {
    return this.stopAction(user, id, stopId, 'skipped', dto.reason);
  }

  @Post(':id/sweep')
  @ApiTags(DRIVER_MODULE_TAGS.MODULE_4)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('No child left on the bus')
  @ApiOperation({
    summary: 'End-of-trip sweep: I walked the bus and no child is left (a photo of the empty bus is optional)',
    description: 'Do it before or after ending the trip. The office board shows trips ended without a sweep.',
  })
  @ApiEnvelope(TripDetailDto, { message: 'No child left on the bus' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  async sweep(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: TripSweepInputDto) {
    return this.trips.sweep(user.school_id!, id, dto.photo_file_id ?? null, user, await this.vehicleOf(user));
  }

  @Get(':id')
  @ApiTags(DRIVER_MODULE_TAGS.MODULE_2)
  @ApiOperation({
    summary: 'Trip screen: stops with status and ETA, the route path, students per stop and not-boarded list',
  })
  @ApiEnvelope(TripDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  async detail(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const vehicle = await this.vehicleOf(user);
    const trip = await this.trips.detail(user.school_id!, id);
    if (trip.vehicle.id !== vehicle) throw AppException.forbidden('This trip is not on your bus', 'NOT_YOUR_TRIP');
    return trip;
  }

  @Post(':id/end')
  @ApiTags(DRIVER_MODULE_TAGS.MODULE_2)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Trip ended')
  @ApiOperation({ summary: 'End my trip by hand (it also ends by itself at school or after the last stop)' })
  @ApiEnvelope(TripDetailDto, { message: 'Trip ended' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  async end(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.trips.end(user.school_id!, id, 'driver', await this.vehicleOf(user));
    await this.events.afterManualEnd(await this.trips.find(user.school_id!, id), 'driver');
    return this.trips.detail(user.school_id!, id);
  }

  @Post(':id/positions')
  @ApiTags(DRIVER_MODULE_TAGS.MODULE_2)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Phone GPS fallback: send the phone location every 5–10 s while the trip runs',
    description:
      'Used by the tracking engine only when the bus GPS tracker has been silent for 60 s, so it is safe to send always.',
  })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async position(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: PhonePositionDto) {
    const local = await this.trips.phonePosition(user.school_id!, id, dto, await this.vehicleOf(user));
    if (local) await this.events.phonePosition(await this.trips.find(user.school_id!, id), local);
    return null;
  }

  private async stopAction(user: AuthUser, tripId: number, stopId: number, action: StopAction, reason?: string) {
    const vehicle = await this.vehicleOf(user);
    const trip = await this.trips.find(user.school_id!, tripId);
    if (trip.vehicle_id !== vehicle) throw AppException.forbidden('This trip is not on your bus', 'NOT_YOUR_TRIP');
    await this.events.driverStop(trip, stopId, action, reason);
    return this.trips.detail(user.school_id!, tripId);
  }

  private async vehicleOf(user: AuthUser): Promise<number> {
    const vehicle = await this.trips.crewVehicle(user);
    if (!vehicle) throw AppException.forbidden('You are not the driver or attendant of any bus', 'NO_BUS');
    return vehicle.id;
  }
}

@ApiTags('Integrations')
@Controller('integrations/telematics')
export class TelematicsWebhookController {
  constructor(private readonly events: TripEventsService) {}

  @Post('events')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: 'X-Telematics-Signature', required: true, description: 'sha256=<HMAC-SHA256 of the raw body>' })
  @ApiOperation({
    summary: 'Trip events from the Telematics service (trip.started, trip.position, stop.*, trip.ended)',
    description: 'Server to server only. Signed with TELEMATICS_WEBHOOK_SECRET.',
  })
  @ApiBody({ schema: { type: 'object' } })
  @ApiExcludeEndpoint(process.env.NODE_ENV === 'production')
  receive(@Req() request: RawBodyRequest<Request>, @Headers('x-telematics-signature') signature?: string) {
    return this.events.receive(request.rawBody, signature);
  }
}
