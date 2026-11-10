import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelope,
  ApiErrors,
  AppException,
  AuthUser,
  CurrentUser,
  Public,
  RequirePermissions,
  ResponseMessage,
} from '@app/common';
import { securityConfig, SecurityConfig } from '../../config/configuration';
import { safeEqual } from '../../shared/crypto';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import { MonthQueryDto } from '../attendance/dto/attendance.dto';
import {
  BiometricPunchesDto,
  BulkStaffMarkDto,
  BulkStaffResultDto,
  ManualMarkDto,
  PunchResultDto,
  StaffBoardPageDto,
  StaffBoardQueryDto,
  StaffDayDto,
  StaffMonthDto,
} from './dto/staff-attendance.dto';
import { StaffAttendanceService } from './staff-attendance.service';

@ApiTags('Admin · Staff attendance')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/staff-attendance')
export class StaffAttendanceController {
  constructor(private readonly attendance: StaffAttendanceService) {}

  @Get('board')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_VIEW)
  @ApiOperation({
    summary: 'Staff for one date, a page at a time: checked in, late, on leave or not yet in, with times and distance',
    description:
      'The counts (total, present, late, on_leave, not_checked_in) are for the whole school; staff is one page after search and status. Default 20 per page, up to 100.',
  })
  @ApiEnvelope(StaffBoardPageDto)
  @ApiErrors(HttpStatus.BAD_REQUEST)
  board(@SchoolId() schoolId: number, @Query() query: StaffBoardQueryDto) {
    return this.attendance.boardPage(schoolId, query);
  }

  @Put('bulk')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_MANAGE)
  @ResponseMessage('Attendance marked')
  @ApiOperation({
    summary: 'Mark many staff at once (reason optional, saved as manual)',
    description:
      'Send user_ids, or all_not_checked_in: true for everyone without a check-in. Staff on approved leave are skipped unless the status is absent. Optional check-in and check-out times apply to everyone. 400 NOTHING_TO_MARK when nobody is left.',
  })
  @ApiEnvelope(BulkStaffResultDto, { message: 'Attendance marked' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  bulk(@SchoolId() schoolId: number, @Body() dto: BulkStaffMarkDto, @CurrentUser() actor: AuthUser) {
    return this.attendance.bulkMark(schoolId, dto, actor);
  }

  @Get(':userId/month')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_VIEW)
  @ApiOperation({ summary: 'One staff member’s month, day by day' })
  @ApiEnvelope(StaffMonthDto)
  month(@SchoolId() schoolId: number, @Param('userId', ParseIntPipe) userId: number, @Query() query: MonthQueryDto) {
    return this.attendance.month(schoolId, userId, query.month);
  }

  @Put(':userId')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_MANAGE)
  @ResponseMessage('Attendance corrected')
  @ApiOperation({ summary: 'Correct a staff member’s attendance for a day (reason required, saved as manual)' })
  @ApiEnvelope(StaffDayDto, { message: 'Attendance corrected' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  mark(
    @SchoolId() schoolId: number,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: ManualMarkDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.attendance.manualMark(schoolId, userId, dto, actor);
  }
}

@ApiTags('Integrations')
@Controller('integrations/biometric')
export class BiometricController {
  constructor(
    private readonly attendance: StaffAttendanceService,
    @Inject(securityConfig.KEY) private readonly security: SecurityConfig,
  ) {}

  @Post('punches')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: 'X-Device-Key', required: true, description: 'BIOMETRIC_WEBHOOK_KEY from .env' })
  @ApiOperation({
    summary: 'Fingerprint or face machine pushes punches',
    description:
      'The first punch of the day is the check-in and the last is the check-out. Employee numbers come from the staff list.',
  })
  @ApiEnvelope(PunchResultDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.UNAUTHORIZED, HttpStatus.NOT_FOUND, HttpStatus.SERVICE_UNAVAILABLE)
  punches(@Headers('x-device-key') key: string | undefined, @Body() dto: BiometricPunchesDto) {
    if (!this.security.biometricWebhookKey) {
      throw AppException.unavailable('The biometric webhook is switched off', 'BIOMETRIC_OFF');
    }
    if (!key || !safeEqual(key, this.security.biometricWebhookKey)) {
      throw AppException.unauthorized('Device key is missing or wrong', 'DEVICE_KEY_INVALID');
    }
    return this.attendance.ingestPunches(dto);
  }
}
