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
import { ReasonDto, RejectFuelDto, ReviewFuelDto } from './dto/fleet-maintenance.dto';
import {
  BusFilterDto,
  BusHealthDto,
  CloseTicketDto,
  CreateTicketDto,
  FuelInputDto,
  FuelInsightsDto,
  FuelLogDto,
  FuelQueryDto,
  ObdLogDto,
  ObdLogQueryDto,
  PlaybackQueryDto,
  TicketDto,
  TicketInsightsDto,
  TicketQueryDto,
  TripPlaybackDto,
  UpdateFuelDto,
  UpdateTicketDto,
} from './dto/fleet-ops.dto';
import { FleetHealthService } from './fleet-health.service';
import { FuelService } from './fuel.service';
import { MaintenanceService } from './maintenance.service';

@ApiTags('Admin · Fleet maintenance')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/fleet/maintenance')
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Service history: planned services and repairs, newest first',
    description:
      'Filters: status, source (obd, manual, driver), kind (service, repair), category, off_road, vehicle_id. search matches title, fault code, vendor and bus. sort: opened_at, closed_at, cost, status. warranty_claim is set when the same part was fitted earlier and is still under warranty.',
  })
  @ApiEnvelope(TicketDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  list(@SchoolId() schoolId: number, @Query() query: TicketQueryDto) {
    return this.maintenance.list(schoolId, query);
  }

  @Get('insights')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({ summary: 'Ticket counts by status, open OBD tickets and cost closed this month' })
  @ApiEnvelope(TicketInsightsDto)
  insights(@SchoolId() schoolId: number, @Query() query: BusFilterDto) {
    return this.maintenance.insights(schoolId, query.vehicle_id);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({ summary: 'One maintenance ticket' })
  @ApiEnvelope(TicketDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.maintenance.get(schoolId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Ticket opened')
  @ApiOperation({
    summary: 'Open a maintenance ticket by hand',
    description: 'OBD faults open tickets by themselves (source obd). 404 VEHICLE_NOT_FOUND.',
  })
  @ApiEnvelope(TicketDto, { status: HttpStatus.CREATED, message: 'Ticket opened' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  create(@SchoolId() schoolId: number, @Body() dto: CreateTicketDto, @CurrentUser() actor: AuthUser) {
    return this.maintenance.create(schoolId, dto, actor);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Ticket updated')
  @ApiOperation({
    summary: 'Edit a ticket or move its status',
    description:
      'status done sets closed_at, takes the bus back on the road and, for a service, resets its service rule; moving a done ticket back to open or in_progress clears closed_at. parts_cost + labour_cost make the cost. Cost and garage changes go to the change history. 409 MONTH_LOCKED for a ticket closed in a locked month.',
  })
  @ApiEnvelope(TicketDto, { message: 'Ticket updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  update(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTicketDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.maintenance.update(schoolId, id, dto, actor);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Ticket closed')
  @ApiOperation({
    summary: 'Close a ticket with the final cost, garage, bill and warranty (409 TICKET_CLOSED when done)',
    description:
      'Takes the bus back on the road. Closing a service (kind service) resets its service rule to today and the odometer given (or the bus’s current km).',
  })
  @ApiEnvelope(TicketDto, { message: 'Ticket closed' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  close(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CloseTicketDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.maintenance.close(schoolId, id, dto, actor);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Ticket deleted')
  @ApiOperation({
    summary: 'Delete a ticket added by mistake (kept in the change history with the reason)',
    description:
      'A deleted off-road ticket no longer keeps the bus off the road. 409 MONTH_LOCKED for a ticket closed in a locked month.',
  })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async remove(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ReasonDto,
    @CurrentUser() actor: AuthUser,
  ) {
    await this.maintenance.remove(schoolId, id, actor, query.reason ?? null);
    return null;
  }
}

@ApiTags('Admin · Fleet maintenance')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/fleet/fuel')
export class FuelController {
  constructor(private readonly fuel: FuelService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Fuel log, newest first, with km since the last fill and km/l',
    description:
      'Filters: vehicle_id, from, to (filled_on dates), status (approved, pending, rejected), payment_mode, reimbursed. search matches station and bus. sort: filled_on, amount, litres, odometer_km. km_per_litre is worked out between full fills. price_warning and gps_check flag entries to look at.',
  })
  @ApiEnvelope(FuelLogDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  list(@SchoolId() schoolId: number, @Query() query: FuelQueryDto) {
    return this.fuel.list(schoolId, query);
  }

  @Get('insights')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Fuel this month, the average km/l over the last 90 days, entries waiting and driver pay-backs',
  })
  @ApiEnvelope(FuelInsightsDto)
  insights(@SchoolId() schoolId: number, @Query() query: BusFilterDto) {
    return this.fuel.insights(schoolId, query.vehicle_id);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({ summary: 'One fuel entry' })
  @ApiEnvelope(FuelLogDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.fuel.get(schoolId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Fuel entry added')
  @ApiOperation({
    summary: 'Add a fuel entry',
    description:
      'filled_on cannot be in the future; odometer_km must sit between the readings of the fills before and after it; litres cannot be more than the bus tank (VALIDATION_FAILED on the field). 409 FUEL_DUPLICATE for the same bus, date and odometer; 409 MONTH_LOCKED for a locked month. 404 VEHICLE_NOT_FOUND. A full fill whose km/l is far below the bus normal sends BUS_LOW_MILEAGE.',
  })
  @ApiEnvelope(FuelLogDto, { status: HttpStatus.CREATED, message: 'Fuel entry added' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  create(@SchoolId() schoolId: number, @Body() dto: FuelInputDto, @CurrentUser() actor: AuthUser) {
    return this.fuel.create(schoolId, dto, actor);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Fuel entry updated')
  @ApiOperation({
    summary: 'Edit a fuel entry (same rules as adding); old values and the reason go to the change history',
  })
  @ApiEnvelope(FuelLogDto, { message: 'Fuel entry updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  update(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFuelDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.fuel.update(schoolId, id, dto, actor);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Fuel entry deleted')
  @ApiOperation({ summary: 'Delete a fuel entry (kept in the change history with the reason)' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async remove(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ReasonDto,
    @CurrentUser() actor: AuthUser,
  ) {
    await this.fuel.remove(schoolId, id, actor, query.reason ?? null);
    return null;
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Fuel entry approved')
  @ApiOperation({
    summary: 'Approve a fuel entry added by a driver (409 FUEL_NOT_PENDING)',
    description: 'Only approved entries count in km/l, reports and budgets. The driver gets FUEL_ENTRY_REVIEWED.',
  })
  @ApiEnvelope(FuelLogDto, { message: 'Fuel entry approved' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  approve(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReviewFuelDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.fuel.review(schoolId, id, 'approved', dto.note ?? null, actor);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Fuel entry rejected')
  @ApiOperation({ summary: 'Reject a fuel entry added by a driver, with the reason (409 FUEL_NOT_PENDING)' })
  @ApiEnvelope(FuelLogDto, { message: 'Fuel entry rejected' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  reject(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectFuelDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.fuel.review(schoolId, id, 'rejected', dto.note, actor);
  }

  @Post(':id/reimburse')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Marked as paid back')
  @ApiOperation({
    summary: 'Mark a driver-paid fuel entry as paid back (409 NOT_DRIVER_PAID, FUEL_NOT_APPROVED, ALREADY_REIMBURSED)',
  })
  @ApiEnvelope(FuelLogDto, { message: 'Marked as paid back' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  reimburse(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthUser) {
    return this.fuel.reimburse(schoolId, id, actor);
  }
}

@ApiTags('Admin · Fleet')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN, HttpStatus.SERVICE_UNAVAILABLE)
@RequirePermissions(PERMISSIONS.FLEET_VIEW)
@Controller('admin/fleet')
export class FleetHealthController {
  constructor(private readonly health: FleetHealthService) {}

  @Get('buses/:id/health')
  @ApiOperation({
    summary: 'Vehicle health card of a school bus: engine readings, active fault codes and status',
    description:
      'id is the school bus (vehicles.id). Read from the Telematics service; health is null when the bus has no tracker. status: good, warning, critical or unknown.',
  })
  @ApiEnvelope(BusHealthDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  busHealth(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.health.health(schoolId, id);
  }

  @Get('buses/:id/obd')
  @ApiOperation({
    summary: 'OBD log of a school bus, newest first',
    description: 'id is the school bus (vehicles.id). 400 NO_TRACKER when it has no tracker.',
  })
  @ApiEnvelope(ObdLogDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  obd(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Query() query: ObdLogQueryDto) {
    return this.health.obdLog(schoolId, id, query);
  }

  @Get('trips/:id/playback')
  @ApiOperation({
    summary: 'Trip playback: GPS track, planned route, stop arrivals and safety events',
    description:
      'id is the school trip (admin/transport/trips). Points are oldest first, thinned to max_points (default 1500). 404 TRIP_NOT_FOUND, 404 TRACK_NOT_FOUND when the trip never reached the tracker.',
  })
  @ApiEnvelope(TripPlaybackDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  playback(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Query() query: PlaybackQueryDto) {
    return this.health.playback(schoolId, id, query.max_points);
  }
}
