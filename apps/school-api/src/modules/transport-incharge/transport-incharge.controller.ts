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
import { OperationsBoardDto, OperationsQueryDto, StudentsTodayDto } from '../driver-ops/dto/driver-ops.dto';
import { FuelLogDto } from '../fleet-ops/dto/fleet-ops.dto';
import { TRANSPORT_MODULE_TAGS } from '../mobile/transport-modules.catalog';
import { StaffLeaveDecisionDto, StaffLeaveDto } from '../staff-leave/dto/staff-leave.dto';
import { AlertDto } from '../tracking/dto/fleet-alert.dto';
import { VehicleDto } from '../transport/dto/transport.dto';
import { BusDetailDto, CrewLeaveQueryDto, CrewMemberDto, TransportHomeDto } from './dto/transport-incharge.dto';
import { TransportInchargeService } from './transport-incharge.service';

function schoolOf(user: AuthUser): number {
  if (!user.school_id) throw AppException.forbidden('Your account is not linked to a school', 'NO_SCHOOL');
  return user.school_id;
}

@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@RequireRoles(ROLES.TRANSPORT_INCHARGE)
@Controller('mobile/transport')
export class MobileTransportController {
  constructor(private readonly incharge: TransportInchargeService) {}

  @Get('home')
  @ApiTags(TRANSPORT_MODULE_TAGS.MODULE_1)
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Home: trips today, SOS, drivers on duty, bus students, papers expiring, fuel and crew leave waiting',
    description:
      'One call for the home screen. papers counts bus and crew papers expired or due in 30 days, with the ten most urgent. crew_on_leave lists drivers and attendants on approved leave that day. date defaults to today.',
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
}
