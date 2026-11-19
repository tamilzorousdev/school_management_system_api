import { Body, Controller, Get, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequireRoles, ResponseMessage } from '@app/common';
import { ROLES } from '../access/access.catalog';
import { DRIVER_MODULE_TAGS } from '../mobile/driver-modules.catalog';
import { DriverVehicleService } from './driver-vehicle.service';
import {
  DriverFuelInputDto,
  DriverMaintenanceDto,
  DriverProblemDto,
  PreTripCheckDto,
  PreTripFormDto,
  PreTripInputDto,
} from './dto/fleet-maintenance.dto';
import { FuelLogDto, TicketDto } from './dto/fleet-ops.dto';

@ApiTags(DRIVER_MODULE_TAGS.MODULE_5)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@RequireRoles(ROLES.DRIVER, ROLES.ATTENDANT)
@Controller('mobile/driver/vehicle')
export class MobileDriverVehicleController {
  constructor(private readonly driver: DriverVehicleService) {}

  @Get('maintenance')
  @ApiOperation({
    summary:
      'My bus upkeep: current km, services due (most urgent first), last service, open problems and today’s check',
    description: '403 NO_BUS when I am not the driver or attendant of a bus.',
  })
  @ApiEnvelope(DriverMaintenanceDto)
  maintenance(@CurrentUser() user: AuthUser) {
    return this.driver.maintenanceView(user);
  }

  @Get('fuel')
  @ApiOperation({ summary: 'Fuel entries I added for my bus, newest first, with status (pending, approved, rejected)' })
  @ApiEnvelope(FuelLogDto, { isArray: true })
  myFuel(@CurrentUser() user: AuthUser) {
    return this.driver.myFuel(user);
  }

  @Post('fuel')
  @ResponseMessage('Fuel entry sent to the office')
  @ApiOperation({
    summary: 'Add a fuel fill with the bill photo; the office checks it',
    description:
      'Upload the bill first with POST /files. filled_on defaults to today. Saved as pending until the office approves it (I get FUEL_ENTRY_REVIEWED). payment_mode driver_paid when I paid from my own pocket, so the office pays me back. Same checks as the office: odometer order, tank size, no duplicate (409 FUEL_DUPLICATE).',
  })
  @ApiEnvelope(FuelLogDto, { status: HttpStatus.CREATED, message: 'Fuel entry sent to the office' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  addFuel(@CurrentUser() user: AuthUser, @Body() dto: DriverFuelInputDto) {
    return this.driver.addFuel(user, dto);
  }

  @Post('problems')
  @ResponseMessage('Problem reported to the office')
  @ApiOperation({
    summary: 'Report a problem with my bus, with a photo; it opens a repair ticket for the office',
    description: 'Upload the photo first with POST /files. The transport office gets BUS_PROBLEM_REPORTED.',
  })
  @ApiEnvelope(TicketDto, { status: HttpStatus.CREATED, message: 'Problem reported to the office' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  reportProblem(@CurrentUser() user: AuthUser, @Body() dto: DriverProblemDto) {
    return this.driver.reportProblem(user, dto);
  }
}

@ApiTags(DRIVER_MODULE_TAGS.MODULE_4)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@RequireRoles(ROLES.DRIVER, ROLES.ATTENDANT)
@Controller('mobile/driver/pre-trip-check')
export class MobileDriverPreTripController {
  constructor(private readonly driver: DriverVehicleService) {}

  @Get()
  @ApiOperation({
    summary: 'The pre-trip checklist: the 10 items to tick, whether it is required, and today’s check when done',
    description:
      'Show it before the first trip of the day. Critical items (tyres, brakes, doors) block trips when not OK.',
  })
  @ApiEnvelope(PreTripFormDto)
  form(@CurrentUser() user: AuthUser) {
    return this.driver.checkForm(user);
  }

  @Post()
  @ResponseMessage('Check saved')
  @ApiOperation({
    summary: 'Save today’s pre-trip check',
    description:
      'Send every item with ok true or false and a note for problems; a missing item counts as not OK. Any not OK item opens a repair ticket. A critical item not OK blocks trips (POST /mobile/driver/trips gives 403 BUS_CHECK_FAILED) until the office clears it; checking again before that gives 409 CHECK_BLOCKED. Checking again later the same day replaces the check.',
  })
  @ApiEnvelope(PreTripCheckDto, { status: HttpStatus.CREATED, message: 'Check saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  submit(@CurrentUser() user: AuthUser, @Body() dto: PreTripInputDto) {
    return this.driver.submitCheck(user, dto);
  }
}
