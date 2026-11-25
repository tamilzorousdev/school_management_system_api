import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import { BusPassService } from './bus-pass.service';
import {
  BusPassActionDto,
  BusPassActionResultDto,
  BusPassDto,
  BusPassInsightsDto,
  BusPassQrDto,
  BusPassQueryDto,
  BusPassSettingsDto,
  BusPassSettingsInputDto,
  BusPassValidityDto,
} from './dto/bus-pass.dto';

@ApiTags('Admin · Transport')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/transport/bus-passes')
export class BusPassController {
  constructor(private readonly passes: BusPassService) {}

  @Get('settings')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({ summary: 'Bus pass settings: grace days after a bus fee due date, and the default pass end date' })
  @ApiEnvelope(BusPassSettingsDto)
  settings(@SchoolId() schoolId: number) {
    return this.passes.settings(schoolId);
  }

  @Put('settings')
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Bus pass settings saved')
  @ApiOperation({
    summary: 'Change the grace days and the default pass end date',
    description:
      'The bus fee cycle is the fee plan installments. A new valid_until applies to passes issued from now on.',
  })
  @ApiEnvelope(BusPassSettingsDto, { message: 'Bus pass settings saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  updateSettings(@SchoolId() schoolId: number, @Body() dto: BusPassSettingsInputDto, @CurrentUser() actor: AuthUser) {
    return this.passes.updateSettings(schoolId, dto, actor);
  }

  @Get(':studentId/qr')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'QR for the printed bus pass: the student QR token and an SVG image',
    description:
      'The driver scans it to mark boarding and see the pass status. It is the ID card QR, so replacing the ID card (card_version) also invalidates the printed pass. 404 TRANSPORT_NOT_FOUND.',
  })
  @ApiEnvelope(BusPassQrDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  qr(@SchoolId() schoolId: number, @Param('studentId', ParseIntPipe) studentId: number) {
    return this.passes.qrFor(schoolId, studentId);
  }

  @Get('insights')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Pass cards: active, waiting for payment, on hold, fee due, fee pending past the grace days',
  })
  @ApiEnvelope(BusPassInsightsDto)
  insights(@SchoolId() schoolId: number) {
    return this.passes.insights(schoolId);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Bus passes of this academic year with the bus fee position',
    description:
      'A pass is waiting for payment until the first bus fee invoice is paid (free stops are active at once). fee=past_grace is the fee pending list: the oldest unpaid bus fee is past its due date plus the grace days. search: name, admission number or pass number.',
  })
  @ApiEnvelope(BusPassDto, { paginated: true })
  list(@SchoolId() schoolId: number, @Query() query: BusPassQueryDto) {
    return this.passes.list(schoolId, query);
  }

  @Post('restrict')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Bus passes put on hold')
  @ApiOperation({
    summary: 'Put passes on hold (one or many)',
    description:
      'With a bus fee pending the hold is a fee hold: it lifts by itself once the fee is paid. Parents get BUS_PASS_HELD; the crew sees "Pass on hold – fee pending, contact office" but still takes the child.',
  })
  @ApiEnvelope(BusPassActionResultDto, { message: 'Bus passes put on hold' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  restrict(@SchoolId() schoolId: number, @Body() dto: BusPassActionDto, @CurrentUser() actor: AuthUser) {
    return this.passes.restrict(schoolId, dto, actor);
  }

  @Post('activate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Bus passes active again')
  @ApiOperation({ summary: 'Make held passes active again; parents get BUS_PASS_ACTIVE' })
  @ApiEnvelope(BusPassActionResultDto, { message: 'Bus passes active again' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  activate(@SchoolId() schoolId: number, @Body() dto: BusPassActionDto, @CurrentUser() actor: AuthUser) {
    return this.passes.activate(schoolId, dto, actor);
  }

  @Post('check-payments')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ApiOperation({
    summary: 'Run the bus pass check now (it also runs every 10 minutes)',
    description:
      'Issues passes for paid bus fees, sends the grace-ending reminders and reactivates fee holds that are paid.',
  })
  checkPayments(@SchoolId() schoolId: number) {
    return this.passes.syncSchool(schoolId);
  }

  @Get(':studentId')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({ summary: 'One student’s bus pass, for the pass card and printing' })
  @ApiEnvelope(BusPassDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  one(@SchoolId() schoolId: number, @Param('studentId', ParseIntPipe) studentId: number) {
    return this.passes.forStudent(schoolId, studentId);
  }

  @Patch(':studentId')
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Pass end date saved')
  @ApiOperation({ summary: 'Change one pass’s end date' })
  @ApiEnvelope(BusPassDto, { message: 'Pass end date saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  validity(
    @SchoolId() schoolId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Body() dto: BusPassValidityDto,
  ) {
    return this.passes.setValidity(schoolId, studentId, dto.valid_until);
  }
}
