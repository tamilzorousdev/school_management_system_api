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
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import { CanteenStaffAttendanceService } from './canteen-staff-attendance.service';
import { CanteenStaffService } from './canteen-staff.service';
import {
  AttendanceClockDto,
  AttendanceDateQueryDto,
  AttendanceDayDto,
  AttendanceMonthQueryDto,
  AttendanceRangeQueryDto,
  AttendanceSummaryDto,
  CanteenStaffDto,
  CanteenStaffInputDto,
  CanteenStaffInsightsDto,
  CanteenStaffQueryDto,
  CanteenStaffUpdateDto,
  RosterDto,
  RosterRowDto,
  StaffMonthDto,
} from './dto/canteen-people.dto';

const P = PERMISSIONS;

@ApiTags('Admin · Canteen staff')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/canteen/staff')
export class CanteenStaffController {
  constructor(private readonly staff: CanteenStaffService) {}

  @Get()
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({
    summary: 'List canteen staff',
    description: 'Filters: role, status, search (name, mobile). Sort: created_at, name, role, joined_on, daily_wage.',
  })
  @ApiEnvelope(CanteenStaffDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  list(@SchoolId() schoolId: number, @Query() query: CanteenStaffQueryDto) {
    return this.staff.list(schoolId, query);
  }

  @Get('insights')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'Canteen staff counts by role and active or inactive' })
  @ApiEnvelope(CanteenStaffInsightsDto)
  insights(@SchoolId() schoolId: number) {
    return this.staff.insights(schoolId);
  }

  @Get(':id')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'One canteen staff member' })
  @ApiEnvelope(CanteenStaffDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.staff.get(schoolId, id);
  }

  @Post()
  @RequirePermissions(P.CANTEEN_MANAGE)
  @ResponseMessage('Canteen staff added')
  @ApiOperation({ summary: 'Add a canteen staff member, optionally linked to a school staff record' })
  @ApiEnvelope(CanteenStaffDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  create(@SchoolId() schoolId: number, @Body() dto: CanteenStaffInputDto) {
    return this.staff.create(schoolId, dto);
  }

  @Patch(':id')
  @RequirePermissions(P.CANTEEN_MANAGE)
  @ResponseMessage('Canteen staff updated')
  @ApiOperation({ summary: 'Update a canteen staff member' })
  @ApiEnvelope(CanteenStaffDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  update(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: CanteenStaffUpdateDto) {
    return this.staff.update(schoolId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.CANTEEN_MANAGE)
  @ResponseMessage('Canteen staff removed')
  @ApiOperation({ summary: 'Remove a canteen staff member (soft delete, attendance history is kept)' })
  @ApiEnvelope()
  @ApiErrors(HttpStatus.NOT_FOUND)
  remove(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.staff.remove(schoolId, id);
  }
}

@ApiTags('Admin · Canteen staff attendance')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/canteen/staff-attendance')
export class CanteenStaffAttendanceController {
  constructor(private readonly attendance: CanteenStaffAttendanceService) {}

  @Get()
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({
    summary: 'Roster of all active canteen staff with their mark for the day',
    description: 'Unmarked staff are included with status null. date defaults to today.',
  })
  @ApiEnvelope(RosterDto)
  roster(@SchoolId() schoolId: number, @Query() query: AttendanceDateQueryDto) {
    return this.attendance.roster(schoolId, query.date);
  }

  @Put()
  @RequirePermissions(P.CANTEEN_MANAGE)
  @ResponseMessage('Attendance saved')
  @ApiOperation({
    summary: 'Mark attendance for a date in bulk',
    description: 'Upserts one mark per staff member. Future dates are refused. Returns the updated roster.',
  })
  @ApiEnvelope(RosterDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  mark(@SchoolId() schoolId: number, @Body() dto: AttendanceDayDto) {
    return this.attendance.markDay(schoolId, dto);
  }

  @Post('check-in')
  @RequirePermissions(P.CANTEEN_MANAGE)
  @ResponseMessage('Checked in')
  @ApiOperation({ summary: 'Check a staff member in now (marks present for today)' })
  @ApiEnvelope(RosterRowDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  checkIn(@SchoolId() schoolId: number, @Body() dto: AttendanceClockDto) {
    return this.attendance.checkIn(schoolId, dto.canteen_staff_id);
  }

  @Post('check-out')
  @RequirePermissions(P.CANTEEN_MANAGE)
  @ResponseMessage('Checked out')
  @ApiOperation({ summary: 'Check a staff member out now' })
  @ApiEnvelope(RosterRowDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  checkOut(@SchoolId() schoolId: number, @Body() dto: AttendanceClockDto) {
    return this.attendance.checkOut(schoolId, dto.canteen_staff_id);
  }

  @Get('summary')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({
    summary: 'Days present, half day, absent and on leave per staff member with the attendance rate',
    description: 'from and to default to the last 30 days, at most 366 days.',
  })
  @ApiEnvelope(AttendanceSummaryDto)
  @ApiErrors(HttpStatus.BAD_REQUEST)
  summary(@SchoolId() schoolId: number, @Query() query: AttendanceRangeQueryDto) {
    return this.attendance.summary(schoolId, query.from, query.to);
  }

  @Get('staff/:id')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({
    summary: 'Monthly attendance calendar of one staff member with a wage estimate',
    description: 'Wage estimate is present days x daily wage plus half days x daily wage / 2.',
  })
  @ApiEnvelope(StaffMonthDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  month(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Query() query: AttendanceMonthQueryDto) {
    return this.attendance.staffMonth(schoolId, id, query.month);
  }
}
