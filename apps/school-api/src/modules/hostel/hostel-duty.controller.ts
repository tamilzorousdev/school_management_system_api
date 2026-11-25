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
  UseGuards,
} from '@nestjs/common';
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
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS, ROLES } from '../access/access.catalog';
import { PARENT_MODULE_TAGS } from '../mobile/parent-modules.catalog';
import { TEACHER_MODULE_TAGS } from '../mobile/teacher-modules.catalog';
import {
  AutoAssignDto,
  AutoAssignResultDto,
  DateRangeQueryDto,
  DutyReportQueryDto,
  DutyReportRowDto,
  DutyShiftDto,
  DutyShiftInputDto,
  DutyShiftPatchDto,
  DutyShiftQueryDto,
  HallQueryDto,
  NightRoundDto,
  NightRoundInputDto,
  ParentStudyDto,
  RosterInputDto,
  RosterQueryDto,
  RosterRowDto,
  RoundQueryDto,
  SeatAllocateDto,
  SeatMapDto,
  StudyHallDto,
  StudyHallInputDto,
  StudyHallPatchDto,
  StudyHistoryItemDto,
  StudyMarkDto,
  StudyReportQueryDto,
  StudyReportRowDto,
  StudyScheduleDto,
  StudyScheduleInputDto,
  StudySchedulePatchDto,
  StudyScheduleQueryDto,
  StudySheetDto,
  StudySheetQueryDto,
  StudyTodayDto,
  SwapDto,
  SwapInputDto,
  SwapQueryDto,
} from './dto/hostel-duty.dto';
import { HostelIdQueryDto } from './dto/hostel-setup.dto';
import { HostelDutyService } from './hostel-duty.service';
import { HostelModuleGate, HostelModuleGuard } from './hostel-module.guard';
import { HostelParentService } from './hostel-parent.service';
import { HostelStudyHallService } from './hostel-study-hall.service';
import { HostelStudyService } from './hostel-study.service';

const ADMIN_TAG = 'Admin · Hostel duty & study';

const schoolOf = (user: AuthUser): number => {
  if (!user.school_id) throw AppException.forbidden('Your account is not linked to a school', 'NO_SCHOOL');
  return user.school_id;
};

@ApiTags(ADMIN_TAG)
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@UseGuards(HostelModuleGuard)
@HostelModuleGate('staff_duty')
@Controller('admin/hostel')
export class HostelDutyController {
  constructor(private readonly duty: HostelDutyService) {}

  @Get('duty/shifts')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Duty shifts (morning, evening, night...) ordered by start time' })
  @ApiEnvelope(DutyShiftDto, { isArray: true })
  shifts(@SchoolId() schoolId: number, @Query() query: DutyShiftQueryDto) {
    return this.duty.shifts(schoolId, query);
  }

  @Post('duty/shifts')
  @RequirePermissions(PERMISSIONS.HOSTEL_STAFF_DUTY)
  @ResponseMessage('Shift added')
  @ApiOperation({ summary: 'Add a shift; an end time before the start time means it ends the next day' })
  @ApiEnvelope(DutyShiftDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  createShift(@SchoolId() schoolId: number, @Body() dto: DutyShiftInputDto, @CurrentUser() user: AuthUser) {
    return this.duty.createShift(schoolId, dto, user);
  }

  @Patch('duty/shifts/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_STAFF_DUTY)
  @ResponseMessage('Shift updated')
  @ApiOperation({ summary: 'Rename, retime or turn a shift on/off' })
  @ApiEnvelope(DutyShiftDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  updateShift(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: DutyShiftPatchDto) {
    return this.duty.updateShift(schoolId, id, dto);
  }

  @Delete('duty/shifts/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_STAFF_DUTY)
  @ResponseMessage('Shift deleted')
  @ApiOperation({ summary: 'Delete a shift that is not on the roster for today or later' })
  @ApiEnvelope()
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async deleteShift(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.duty.deleteShift(schoolId, id);
  }

  @Get('duty/roster')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Duty roster for a date range (default: 7 days from today, at most 31 days)' })
  @ApiEnvelope(RosterRowDto, { isArray: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  roster(@SchoolId() schoolId: number, @Query() query: RosterQueryDto) {
    return this.duty.roster(schoolId, query);
  }

  @Post('duty/roster')
  @RequirePermissions(PERMISSIONS.HOSTEL_STAFF_DUTY)
  @ResponseMessage('Duties added')
  @ApiOperation({
    summary: 'Put staff on duty (up to 200 at a time)',
    description: 'Each person gets HOSTEL_DUTY_ASSIGNED. A person cannot be on the same shift twice on a day.',
  })
  @ApiEnvelope(RosterRowDto, { isArray: true, status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  addRoster(@SchoolId() schoolId: number, @Body() dto: RosterInputDto, @CurrentUser() user: AuthUser) {
    return this.duty.addRoster(schoolId, dto, user);
  }

  @Delete('duty/roster/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_STAFF_DUTY)
  @ResponseMessage('Duty removed')
  @ApiOperation({ summary: 'Remove a duty that has not started (status scheduled)' })
  @ApiEnvelope()
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async removeDuty(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    await this.duty.removeDuty(schoolId, id, user);
  }

  @Post('duty/roster/:id/absent')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_STAFF_DUTY)
  @ResponseMessage('Marked absent')
  @ApiOperation({ summary: 'Mark a scheduled duty of today or earlier as absent' })
  @ApiEnvelope(RosterRowDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  absent(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.duty.markAbsent(schoolId, id, user);
  }

  @Get('duty/today')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Today’s duty board (with last night’s shifts still running), status and late minutes' })
  @ApiEnvelope(RosterRowDto, { isArray: true })
  today(@SchoolId() schoolId: number, @Query() query: HostelIdQueryDto) {
    return this.duty.todayBoard(schoolId, query.hostel_id);
  }

  @Get('duty/mine')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'My duties (default: 14 days from today)' })
  @ApiEnvelope(RosterRowDto, { isArray: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  mine(@SchoolId() schoolId: number, @CurrentUser() user: AuthUser, @Query() query: DateRangeQueryDto) {
    return this.duty.mine(schoolId, user, query);
  }

  @Post('duty/roster/:id/check-in')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ResponseMessage('Checked in')
  @ApiOperation({ summary: 'Check in to my duty: from 30 minutes before the start until the shift ends' })
  @ApiEnvelope(RosterRowDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  checkIn(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.duty.checkIn(schoolId, id, user);
  }

  @Post('duty/roster/:id/check-out')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ResponseMessage('Checked out')
  @ApiOperation({ summary: 'Check out of my duty (completes it)' })
  @ApiEnvelope(RosterRowDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  checkOut(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.duty.checkOut(schoolId, id, user);
  }

  @Post('duty/roster/:id/swap')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ResponseMessage('Swap requested')
  @ApiOperation({ summary: 'Ask to hand my duty to someone else; the other person gets HOSTEL_SWAP_REQUEST' })
  @ApiEnvelope(SwapDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  swap(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SwapInputDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.duty.requestSwap(schoolId, id, dto, user);
  }

  @Get('duty/swaps')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Duty swap requests (only my own unless I manage the roster). sort: created_at' })
  @ApiEnvelope(SwapDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  swaps(@SchoolId() schoolId: number, @Query() query: SwapQueryDto, @CurrentUser() user: AuthUser) {
    return this.duty.swaps(schoolId, query, user);
  }

  @Post('duty/swaps/:id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_STAFF_DUTY)
  @ResponseMessage('Swap approved')
  @ApiOperation({ summary: 'Approve a swap: the duty moves to the other person (HOSTEL_DUTY_ASSIGNED)' })
  @ApiEnvelope(SwapDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  approveSwap(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.duty.decideSwap(schoolId, id, true, user);
  }

  @Post('duty/swaps/:id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_STAFF_DUTY)
  @ResponseMessage('Swap rejected')
  @ApiOperation({ summary: 'Reject a swap request' })
  @ApiEnvelope(SwapDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  rejectSwap(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.duty.decideSwap(schoolId, id, false, user);
  }

  @Post('duty/swaps/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ResponseMessage('Swap cancelled')
  @ApiOperation({ summary: 'Cancel my own pending swap request' })
  @ApiEnvelope(SwapDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  cancelSwap(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.duty.cancelSwap(schoolId, id, user);
  }

  @Post('duty/rounds')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ResponseMessage('Night round recorded')
  @ApiOperation({ summary: 'Record a night round; issues are required when all_ok is false' })
  @ApiEnvelope(NightRoundDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  addRound(@SchoolId() schoolId: number, @Body() dto: NightRoundInputDto, @CurrentUser() user: AuthUser) {
    return this.duty.addRound(schoolId, dto, user);
  }

  @Get('duty/rounds')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Night rounds of a day (default today), newest first' })
  @ApiEnvelope(NightRoundDto, { isArray: true })
  rounds(@SchoolId() schoolId: number, @Query() query: RoundQueryDto) {
    return this.duty.rounds(schoolId, query);
  }

  @Get('duty/report')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({
    summary: 'Staff duty attendance per person (default: last 30 days)',
    description: 'average_late_minutes is over the late duties only.',
  })
  @ApiEnvelope(DutyReportRowDto, { isArray: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  report(@SchoolId() schoolId: number, @Query() query: DutyReportQueryDto) {
    return this.duty.report(schoolId, query);
  }
}

@ApiTags(ADMIN_TAG)
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/hostel')
export class HostelStudyController {
  constructor(private readonly study: HostelStudyService) {}

  @Get('study/schedules')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Study hour schedules' })
  @ApiEnvelope(StudyScheduleDto, { isArray: true })
  schedules(@SchoolId() schoolId: number, @Query() query: StudyScheduleQueryDto) {
    return this.study.schedules(schoolId, query);
  }

  @Post('study/schedules')
  @RequirePermissions(PERMISSIONS.HOSTEL_STUDY)
  @ResponseMessage('Study schedule added')
  @ApiOperation({ summary: 'Add study hours for a hostel, a block or a study hall' })
  @ApiEnvelope(StudyScheduleDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  createSchedule(@SchoolId() schoolId: number, @Body() dto: StudyScheduleInputDto, @CurrentUser() user: AuthUser) {
    return this.study.createSchedule(schoolId, dto, user);
  }

  @Patch('study/schedules/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_STUDY)
  @ResponseMessage('Study schedule updated')
  @ApiOperation({ summary: 'Change a study schedule' })
  @ApiEnvelope(StudyScheduleDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  updateSchedule(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: StudySchedulePatchDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.study.updateSchedule(schoolId, id, dto, user);
  }

  @Delete('study/schedules/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_STUDY)
  @ResponseMessage('Study schedule deleted')
  @ApiOperation({ summary: 'Delete a study schedule (marks already taken are kept)' })
  @ApiEnvelope()
  @ApiErrors(HttpStatus.NOT_FOUND)
  async removeSchedule(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    await this.study.removeSchedule(schoolId, id, user);
  }

  @Get('study/today')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Study sessions running today with marked, present and absent counts' })
  @ApiEnvelope(StudyTodayDto, { isArray: true })
  today(@SchoolId() schoolId: number, @Query() query: HostelIdQueryDto) {
    return this.study.todayList(schoolId, query.hostel_id);
  }

  @Get('study/sheet')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Study attendance sheet; students away on leave are suggested excused' })
  @ApiEnvelope(StudySheetDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  sheet(@SchoolId() schoolId: number, @Query() query: StudySheetQueryDto) {
    return this.study.sheet(schoolId, query);
  }

  @Post('study/mark')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_STUDY)
  @ResponseMessage('Study attendance saved')
  @ApiOperation({ summary: 'Mark study attendance for today or the last 2 days (marking again overwrites)' })
  @ApiEnvelope(StudySheetDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  mark(@SchoolId() schoolId: number, @Body() dto: StudyMarkDto, @CurrentUser() user: AuthUser) {
    return this.study.mark(schoolId, dto, user);
  }

  @Get('study/report')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({
    summary: 'Study attendance per resident (default: last 30 days). sort: name, percent, absent, sessions',
  })
  @ApiEnvelope(StudyReportRowDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  report(@SchoolId() schoolId: number, @Query() query: StudyReportQueryDto) {
    return this.study.report(schoolId, query);
  }

  @Get('admissions/:id/study')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'One resident’s study attendance (default: last 30 days)' })
  @ApiEnvelope(StudyHistoryItemDto, { isArray: true })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  history(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Query() query: DateRangeQueryDto) {
    return this.study.history(schoolId, id, query);
  }
}

@ApiTags(ADMIN_TAG)
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@UseGuards(HostelModuleGuard)
@HostelModuleGate('study_hall')
@Controller('admin/hostel')
export class HostelStudyHallController {
  constructor(private readonly halls: HostelStudyHallService) {}

  @Get('study/halls')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Study halls with seats in use, taken and free' })
  @ApiEnvelope(StudyHallDto, { isArray: true })
  list(@SchoolId() schoolId: number, @Query() query: HallQueryDto) {
    return this.halls.halls(schoolId, query);
  }

  @Post('study/halls')
  @RequirePermissions(PERMISSIONS.HOSTEL_STUDY_HALL)
  @ResponseMessage('Study hall added')
  @ApiOperation({ summary: 'Add a study hall; seats S1..Sn are created for the capacity' })
  @ApiEnvelope(StudyHallDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  create(@SchoolId() schoolId: number, @Body() dto: StudyHallInputDto, @CurrentUser() user: AuthUser) {
    return this.halls.create(schoolId, dto, user);
  }

  @Patch('study/halls/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_STUDY_HALL)
  @ResponseMessage('Study hall updated')
  @ApiOperation({ summary: 'Change a hall; a lower capacity turns off free seats only (409 when seats are taken)' })
  @ApiEnvelope(StudyHallDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  update(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: StudyHallPatchDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.halls.update(schoolId, id, dto, user);
  }

  @Delete('study/halls/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_STUDY_HALL)
  @ResponseMessage('Study hall deleted')
  @ApiOperation({ summary: 'Delete a hall with no seated students and no study schedule' })
  @ApiEnvelope()
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async remove(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    await this.halls.remove(schoolId, id, user);
  }

  @Get('study/halls/:id/seats')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Seat map with the student in each seat and since when' })
  @ApiEnvelope(SeatMapDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  seats(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.halls.seatMap(schoolId, id);
  }

  @Post('study/halls/:id/allocate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_STUDY_HALL)
  @ResponseMessage('Seat given')
  @ApiOperation({ summary: 'Give a free seat to a resident of this hostel (one seat per hall)' })
  @ApiEnvelope(SeatMapDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  allocate(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SeatAllocateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.halls.allocate(schoolId, id, dto, user);
  }

  @Post('study/seat-allocations/:id/release')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_STUDY_HALL)
  @ResponseMessage('Seat released')
  @ApiOperation({ summary: 'Free a seat' })
  @ApiEnvelope(SeatMapDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  release(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.halls.release(schoolId, id, user);
  }

  @Post('study/halls/:id/auto-assign')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_STUDY_HALL)
  @ResponseMessage('Seats assigned')
  @ApiOperation({
    summary: 'Fill free seats in seat order',
    description:
      'Residents without a seat in this hall, in admission_ids order or by block, room and bed. Lists who got which seat and who was skipped.',
  })
  @ApiEnvelope(AutoAssignResultDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  autoAssign(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AutoAssignDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.halls.autoAssign(schoolId, id, dto, user);
  }
}

@ApiTags(TEACHER_MODULE_TAGS.MODULE_14)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@UseGuards(HostelModuleGuard)
@HostelModuleGate('staff_duty')
@Controller('mobile/teacher/hostel/duty')
export class MobileHostelDutyController {
  constructor(private readonly duty: HostelDutyService) {}

  @Get('shifts')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Duty shifts' })
  @ApiEnvelope(DutyShiftDto, { isArray: true })
  shifts(@CurrentUser() user: AuthUser, @Query() query: DutyShiftQueryDto) {
    return this.duty.shifts(schoolOf(user), query);
  }

  @Get('mine')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'My duties (default: 14 days from today)' })
  @ApiEnvelope(RosterRowDto, { isArray: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  mine(@CurrentUser() user: AuthUser, @Query() query: DateRangeQueryDto) {
    return this.duty.mine(schoolOf(user), user, query);
  }

  @Get('today')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Today’s duty board: who is on, checked in, late or not yet in' })
  @ApiEnvelope(RosterRowDto, { isArray: true })
  today(@CurrentUser() user: AuthUser, @Query() query: HostelIdQueryDto) {
    return this.duty.todayBoard(schoolOf(user), query.hostel_id);
  }

  @Get('roster')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Duty roster for a date range (default: 7 days from today)' })
  @ApiEnvelope(RosterRowDto, { isArray: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  roster(@CurrentUser() user: AuthUser, @Query() query: RosterQueryDto) {
    return this.duty.roster(schoolOf(user), query);
  }

  @Post('roster/:id/check-in')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ResponseMessage('Checked in')
  @ApiOperation({ summary: 'Check in to my duty: from 30 minutes before the start until the shift ends' })
  @ApiEnvelope(RosterRowDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  checkIn(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.duty.checkIn(schoolOf(user), id, user);
  }

  @Post('roster/:id/check-out')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ResponseMessage('Checked out')
  @ApiOperation({ summary: 'Check out of my duty' })
  @ApiEnvelope(RosterRowDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  checkOut(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.duty.checkOut(schoolOf(user), id, user);
  }

  @Post('roster/:id/absent')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_STAFF_DUTY)
  @ResponseMessage('Marked absent')
  @ApiOperation({ summary: 'Mark a scheduled duty as absent (roster managers)' })
  @ApiEnvelope(RosterRowDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  absent(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.duty.markAbsent(schoolOf(user), id, user);
  }

  @Post('roster/:id/swap')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ResponseMessage('Swap requested')
  @ApiOperation({ summary: 'Ask someone to take my duty' })
  @ApiEnvelope(SwapDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  swap(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: SwapInputDto) {
    return this.duty.requestSwap(schoolOf(user), id, dto, user);
  }

  @Get('swaps')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Swap requests (mine, or all for roster managers)' })
  @ApiEnvelope(SwapDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  swaps(@CurrentUser() user: AuthUser, @Query() query: SwapQueryDto) {
    return this.duty.swaps(schoolOf(user), query, user);
  }

  @Post('swaps/:id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_STAFF_DUTY)
  @ResponseMessage('Swap approved')
  @ApiOperation({ summary: 'Approve a swap request' })
  @ApiEnvelope(SwapDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  approveSwap(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.duty.decideSwap(schoolOf(user), id, true, user);
  }

  @Post('swaps/:id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_STAFF_DUTY)
  @ResponseMessage('Swap rejected')
  @ApiOperation({ summary: 'Reject a swap request' })
  @ApiEnvelope(SwapDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  rejectSwap(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.duty.decideSwap(schoolOf(user), id, false, user);
  }

  @Post('swaps/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ResponseMessage('Swap cancelled')
  @ApiOperation({ summary: 'Cancel my pending swap request' })
  @ApiEnvelope(SwapDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  cancelSwap(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.duty.cancelSwap(schoolOf(user), id, user);
  }

  @Post('rounds')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ResponseMessage('Night round recorded')
  @ApiOperation({ summary: 'Record a night round (issues required when all_ok is false)' })
  @ApiEnvelope(NightRoundDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  addRound(@CurrentUser() user: AuthUser, @Body() dto: NightRoundInputDto) {
    return this.duty.addRound(schoolOf(user), dto, user);
  }

  @Get('rounds')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Night rounds of a day (default today)' })
  @ApiEnvelope(NightRoundDto, { isArray: true })
  rounds(@CurrentUser() user: AuthUser, @Query() query: RoundQueryDto) {
    return this.duty.rounds(schoolOf(user), query);
  }
}

@ApiTags(TEACHER_MODULE_TAGS.MODULE_14)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('mobile/teacher/hostel/study')
export class MobileHostelStudyController {
  constructor(private readonly study: HostelStudyService) {}

  @Get('schedules')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Study hour schedules' })
  @ApiEnvelope(StudyScheduleDto, { isArray: true })
  schedules(@CurrentUser() user: AuthUser, @Query() query: StudyScheduleQueryDto) {
    return this.study.schedules(schoolOf(user), query);
  }

  @Get('today')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Study sessions running today with counts' })
  @ApiEnvelope(StudyTodayDto, { isArray: true })
  today(@CurrentUser() user: AuthUser, @Query() query: HostelIdQueryDto) {
    return this.study.todayList(schoolOf(user), query.hostel_id);
  }

  @Get('sheet')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Study attendance sheet (away students suggested excused)' })
  @ApiEnvelope(StudySheetDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  sheet(@CurrentUser() user: AuthUser, @Query() query: StudySheetQueryDto) {
    return this.study.sheet(schoolOf(user), query);
  }

  @Post('mark')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_STUDY)
  @ResponseMessage('Study attendance saved')
  @ApiOperation({ summary: 'Mark study attendance for today or the last 2 days' })
  @ApiEnvelope(StudySheetDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  mark(@CurrentUser() user: AuthUser, @Body() dto: StudyMarkDto) {
    return this.study.mark(schoolOf(user), dto, user);
  }

  @Get('residents/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'One resident’s study attendance (default: last 30 days)' })
  @ApiEnvelope(StudyHistoryItemDto, { isArray: true })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  history(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() query: DateRangeQueryDto) {
    return this.study.history(schoolOf(user), id, query);
  }
}

@ApiTags(TEACHER_MODULE_TAGS.MODULE_14)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@UseGuards(HostelModuleGuard)
@HostelModuleGate('study_hall')
@Controller('mobile/teacher/hostel/study')
export class MobileHostelStudyHallController {
  constructor(private readonly halls: HostelStudyHallService) {}

  @Get('halls')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Study halls with free seats' })
  @ApiEnvelope(StudyHallDto, { isArray: true })
  list(@CurrentUser() user: AuthUser, @Query() query: HallQueryDto) {
    return this.halls.halls(schoolOf(user), query);
  }

  @Get('halls/:id/seats')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Seat map of a study hall' })
  @ApiEnvelope(SeatMapDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  seats(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.halls.seatMap(schoolOf(user), id);
  }

  @Post('halls/:id/allocate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_STUDY_HALL)
  @ResponseMessage('Seat given')
  @ApiOperation({ summary: 'Give a free seat to a resident' })
  @ApiEnvelope(SeatMapDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  allocate(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: SeatAllocateDto) {
    return this.halls.allocate(schoolOf(user), id, dto, user);
  }

  @Post('seat-allocations/:id/release')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_STUDY_HALL)
  @ResponseMessage('Seat released')
  @ApiOperation({ summary: 'Free a seat' })
  @ApiEnvelope(SeatMapDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  release(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.halls.release(schoolOf(user), id, user);
  }
}

@ApiTags(PARENT_MODULE_TAGS.MODULE_11)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND)
@RequireRoles(ROLES.PARENT)
@Controller('mobile/parent/children/:id/hostel')
export class ParentHostelStudyController {
  constructor(
    private readonly parent: HostelParentService,
    private readonly study: HostelStudyService,
  ) {}

  @Get('study')
  @ApiOperation({
    summary: 'My child’s study hours, study attendance of the last 30 days and study hall seat',
    description: 'seat is null when my child has no seat or study halls are turned off.',
  })
  @ApiEnvelope(ParentStudyDto)
  async studyOverview(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const stay = await this.parent.resident(user, id);
    return this.study.parentStudy(stay.school_id, stay.admission_id);
  }
}
