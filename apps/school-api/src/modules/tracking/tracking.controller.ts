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
  TripDetailDto,
  TripDto,
  TripQueryDto,
} from './dto/tracking.dto';
import { BoardingChecklistService } from './boarding-checklist.service';
import { BoardingHistoryQueryDto, TripChecklistDto, TripHistoryDto } from './dto/checklist.dto';
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
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({ summary: 'Bus trips, newest first. Filter by date, status and route.' })
  @ApiEnvelope(TripDto, { paginated: true })
  list(@SchoolId() schoolId: number, @Query() query: TripQueryDto) {
    return this.trips.list(schoolId, query);
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
  start(@SchoolId() schoolId: number, @Body() dto: StartTripDto, @CurrentUser() actor: AuthUser) {
    return this.trips.start(schoolId, dto, actor);
  }

  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Trip ended')
  @ApiOperation({ summary: 'End a trip from the office' })
  @ApiEnvelope(TripDetailDto, { message: 'Trip ended' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  async end(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    const detail = await this.trips.end(schoolId, id, 'admin');
    await this.checklist.afterTripEnded(await this.trips.find(schoolId, id));
    return detail;
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
      'pickup = stops to school, drop = school to stops. Parents of the route get "Bus has started". The trip ends by itself inside the school gate (pickup) or after the last stop (drop).',
  })
  @ApiEnvelope(TripDetailDto, { status: HttpStatus.CREATED, message: 'Trip started' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT, HttpStatus.SERVICE_UNAVAILABLE)
  async start(@CurrentUser() user: AuthUser, @Body() dto: StartTripDto) {
    const vehicle = await this.vehicleOf(user);
    return this.trips.start(user.school_id!, dto, user, vehicle);
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
    const detail = await this.trips.end(user.school_id!, id, 'driver', await this.vehicleOf(user));
    await this.checklist.afterTripEnded(await this.trips.find(user.school_id!, id));
    return detail;
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
    await this.trips.phonePosition(user.school_id!, id, dto, await this.vehicleOf(user));
    return null;
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
