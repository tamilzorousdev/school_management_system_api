import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelope,
  ApiErrors,
  AppException,
  AuthUser,
  CurrentUser,
  RequireRoles,
  ResponseMessage,
} from '@app/common';
import { ROLES } from '../access/access.catalog';
import { DRIVER_MODULE_TAGS } from '../mobile/driver-modules.catalog';
import { BoardingChecklistService } from './boarding-checklist.service';
import { BoardingService } from './boarding.service';
import { BoardingResultDto, RecordBoardingDto } from './dto/boarding.dto';
import { TripChecklistDto } from './dto/checklist.dto';
import { AlertDto, CancelSosDto, RaiseSosDto, SosLocationDto, SosResultDto } from './dto/fleet-alert.dto';
import { FleetAlertsService } from './fleet-alerts.service';
import { TripsService } from './trips.service';

@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@RequireRoles(ROLES.DRIVER, ROLES.ATTENDANT)
@Controller('mobile/driver')
export class DriverSafetyController {
  constructor(
    private readonly trips: TripsService,
    private readonly boarding: BoardingService,
    private readonly checklist: BoardingChecklistService,
    private readonly alerts: FleetAlertsService,
  ) {}

  @Post('trips/:id/boardings')
  @ApiTags(DRIVER_MODULE_TAGS.MODULE_3)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Saved')
  @ApiOperation({
    summary: 'Mark a student boarded or got off: scan the ID card QR or tap the student in the trip list',
    description:
      'Send { action, qr_token } after a scan or { action, student_id } for a manual tap. The student’s parents get a push within seconds. ' +
      'A second scan of the same student and action is safe: already_recorded is true and nothing is sent again. ' +
      'Errors: QR_INVALID (400), QR_OTHER_SCHOOL, STUDENT_NOT_FOUND (404), QR_REPLACED (old card), NOT_ON_THIS_ROUTE, NOT_ON_THIS_TRIP, NOT_BOARDED (got off before boarding), TRIP_ENDED, STUDENT_NOT_ACTIVE (409), NOT_YOUR_TRIP (403).',
  })
  @ApiEnvelope(BoardingResultDto, { message: 'Saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async board(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RecordBoardingDto,
  ): Promise<BoardingResultDto> {
    return this.boarding.record(user, id, dto, await this.vehicleOf(user));
  }

  @Delete('trips/:id/boardings/:boardingId')
  @ApiTags(DRIVER_MODULE_TAGS.MODULE_3)
  @ResponseMessage('Mark removed')
  @ApiOperation({
    summary: 'Undo a wrong tap while the trip runs (boarding_id from the checklist)',
    description:
      'Removes the boarded or got-off mark and returns the updated checklist. No message goes to the parent. ' +
      'Undo got off before boarded: UNDO_ALIGHTED_FIRST (409). Errors: BOARDING_NOT_FOUND (404), TRIP_ENDED (409), NOT_YOUR_TRIP (403).',
  })
  @ApiEnvelope(TripChecklistDto, { message: 'Mark removed' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async undo(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('boardingId', ParseIntPipe) boardingId: number,
  ): Promise<TripChecklistDto> {
    return this.checklist.undo(user, id, boardingId, await this.vehicleOf(user));
  }

  @Post('sos')
  @ApiTags(DRIVER_MODULE_TAGS.MODULE_4)
  @ResponseMessage('SOS sent to the school office')
  @ApiOperation({
    summary: 'SOS: tell the school office and the transport in-charge right now (push and SMS)',
    description:
      'Everything is optional and an active trip is not required: trip_id defaults to the trip running on my bus, lat/lng to the bus’s last position. ' +
      'The school admin, transport in-charge and teachers get a push and an SMS. ' +
      'A press by me or the other crew member of my bus within 2 minutes returns the same alert with already_raised true and does not send again.',
  })
  @ApiEnvelope(SosResultDto, { status: HttpStatus.CREATED, message: 'SOS sent to the school office' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  sos(@CurrentUser() user: AuthUser, @Body() dto: RaiseSosDto): Promise<SosResultDto> {
    return this.alerts.raiseSos(user, dto);
  }

  @Get('sos/active')
  @ApiTags(DRIVER_MODULE_TAGS.MODULE_4)
  @ApiOperation({
    summary: 'The SOS my bus raised that is still open or acknowledged, or null',
    description:
      'Poll every 10 s while an SOS is open. status open = waiting for the office; acknowledged = acknowledged_by has seen it. ' +
      'The app also gets a push (SOS_ACKNOWLEDGED, SOS_RESOLVED) and a /comm socket event sos.updated.',
  })
  @ApiEnvelope(AlertDto, { description: 'data is null when no SOS is open' })
  activeSos(@CurrentUser() user: AuthUser): Promise<AlertDto | null> {
    return this.alerts.activeSos(user);
  }

  @Post('sos/:id/location')
  @ApiTags(DRIVER_MODULE_TAGS.MODULE_4)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Location updated')
  @ApiOperation({
    summary: 'Send the phone location every 15 s while the SOS is open',
    description: 'The office map moves live. 409 SOS_CLOSED after it is resolved; 403 NOT_YOUR_SOS for another bus.',
  })
  @ApiEnvelope(AlertDto, { message: 'Location updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  sosLocation(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SosLocationDto,
  ): Promise<AlertDto> {
    return this.alerts.updateSosLocation(user, id, dto);
  }

  @Post('sos/:id/cancel')
  @ApiTags(DRIVER_MODULE_TAGS.MODULE_4)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('SOS cancelled')
  @ApiOperation({
    summary: 'Cancel a false alarm',
    description:
      'Closes the SOS as resolved with the note "Cancelled by …" and data.cancelled true. The office and teachers get SOS_CANCELLED.',
  })
  @ApiEnvelope(AlertDto, { message: 'SOS cancelled' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  cancelSos(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CancelSosDto,
  ): Promise<AlertDto> {
    return this.alerts.cancelSos(user, id, dto);
  }

  private async vehicleOf(user: AuthUser): Promise<number> {
    const vehicle = await this.trips.crewVehicle(user);
    if (!vehicle) throw AppException.forbidden('You are not the driver or attendant of any bus', 'NO_BUS');
    return vehicle.id;
  }
}
