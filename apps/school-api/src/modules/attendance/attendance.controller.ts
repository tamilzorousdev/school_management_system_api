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
import { ApiFile } from '../../shared/pdf-response';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import { classReportFile, sectionReportFile, XLSX } from './attendance-export';
import { AttendanceService } from './attendance.service';
import {
  AttendanceBoardDto,
  ClassReportDto,
  BulkSectionMarkDto,
  BulkSectionResultDto,
  LeaveDecisionDto,
  MarkAttendanceDto,
  MarkSomeAttendanceDto,
  MonthlyAttendanceDto,
  MonthQueryDto,
  RosterDto,
  RosterQueryDto,
  SectionReportDto,
  SessionBoardQueryDto,
  StudentLeaveDto,
  StudentLeaveQueryDto,
  AttendanceYearDto,
  DayQueryDto,
  SectionDayDto,
} from './dto/attendance.dto';
import { StudentLeaveService } from './student-leave.service';

@ApiTags('Admin · Attendance')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('board')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_VIEW)
  @ApiOperation({
    summary: 'Attendance of every section for one date and session (morning or afternoon), with totals',
    description:
      'Attendance is taken twice a day: morning (1st period) and afternoon (5th period). Counts and marked are for the chosen session; each section also has morning_marked and afternoon_marked.',
  })
  @ApiEnvelope(AttendanceBoardDto)
  board(@SchoolId() schoolId: number, @Query() query: SessionBoardQueryDto) {
    return this.attendance.board(schoolId, query.date, query.session);
  }

  @Get('sections/:id')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_VIEW)
  @ApiOperation({
    summary: 'Section roster for a date and session, with saved marks or defaults',
    description:
      'session=morning (1st period, default) or afternoon (5th period). Students on approved leave default to leave; the afternoon starts from the morning marks (absent stays absent), everyone else present. 400 PERIOD_NOT_ALLOWED for any other period.',
  })
  @ApiEnvelope(RosterDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  roster(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Query() query: RosterQueryDto) {
    return this.attendance.roster(schoolId, id, query.date, this.attendance.sessionFor(query));
  }

  @Put('bulk')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_MANAGE)
  @ResponseMessage('Attendance marked')
  @ApiOperation({
    summary: 'Mark many sections at once: every student gets the same status (reason optional)',
    description:
      'Send section_ids, or leave them out for every section not marked yet. Students on approved leave stay on leave. Sections already marked are skipped unless overwrite is true. Parents of absent students get the usual alert (today only). 400 HOLIDAY / NOT_A_SCHOOL_DAY / NOTHING_TO_MARK.',
  })
  @ApiEnvelope(BulkSectionResultDto, { message: 'Attendance marked' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  bulk(@SchoolId() schoolId: number, @Body() dto: BulkSectionMarkDto, @CurrentUser() actor: AuthUser) {
    return this.attendance.bulkMark(schoolId, dto, actor);
  }

  @Put('sections/:id')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_MANAGE)
  @ResponseMessage('Attendance saved')
  @ApiOperation({
    summary: 'Save the morning or afternoon attendance of a section. Parents of absent students get an alert.',
    description:
      'Send session (morning or afternoon) and every student once. Alerts go out today only, once per student per day: a student absent in the morning is not alerted again in the afternoon; one present in the morning and absent in the afternoon is. The office can save any session at any time.',
  })
  @ApiEnvelope(RosterDto, { message: 'Attendance saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  mark(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MarkAttendanceDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.attendance.mark(schoolId, id, dto, actor);
  }

  @Patch('sections/:id')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_MANAGE)
  @ResponseMessage('Attendance saved')
  @ApiOperation({
    summary: 'Mark only some students of a section in one call, each with its own status',
    description:
      'Send only the students to change; everyone else keeps the saved or default status. The office can save any session at any time.',
  })
  @ApiEnvelope(RosterDto, { message: 'Attendance saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  markSome(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MarkSomeAttendanceDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.attendance.markSome(schoolId, id, dto, actor);
  }

  @Get('sections/:id/day')
  @ApiOperation({
    summary: 'Daily report of a section: each student with morning, afternoon and the day status, with counts',
  })
  @ApiEnvelope(SectionDayDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  day(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Query() query: DayQueryDto) {
    return this.attendance.sectionDay(schoolId, id, query.date);
  }

  @Get('sections/:id/report')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_VIEW)
  @ApiOperation({
    summary: 'Monthly attendance % of every student in a section',
    description: 'Each day counts both sessions: absent in one session is a half day.',
  })
  @ApiEnvelope(SectionReportDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  report(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Query() query: MonthQueryDto) {
    return this.attendance.sectionReport(schoolId, id, query.month);
  }

  @Get('sections/:id/report/xlsx')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_VIEW)
  @ApiOperation({ summary: 'Download the monthly section report as Excel' })
  @ApiFile(XLSX, 'Section attendance report')
  @ApiErrors(HttpStatus.NOT_FOUND)
  async reportFile(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Query() query: MonthQueryDto) {
    const report = await this.attendance.sectionReport(schoolId, id, query.month);
    return sectionReportFile(report, await this.attendance.sectionTitle(schoolId, id));
  }

  @Get('classes/:id/report')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_VIEW)
  @ApiOperation({
    summary: 'Class-wise monthly report: every section of a class with its average and students below 75%',
  })
  @ApiEnvelope(ClassReportDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  classReport(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Query() query: MonthQueryDto) {
    return this.attendance.classReport(schoolId, id, query.month);
  }

  @Get('classes/:id/report/xlsx')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_VIEW)
  @ApiOperation({ summary: 'Download the class-wise monthly report as Excel' })
  @ApiFile(XLSX, 'Class attendance report')
  @ApiErrors(HttpStatus.NOT_FOUND)
  async classReportFile(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: MonthQueryDto,
  ) {
    return classReportFile(await this.attendance.classReport(schoolId, id, query.month));
  }

  @Get('students/:id/summary')
  @ApiOperation({ summary: 'One student this academic year: the year % and each month with its %' })
  @ApiEnvelope(AttendanceYearDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  yearSummary(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.attendance.yearSummary(schoolId, id);
  }

  @Get('students/:id')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_VIEW)
  @ApiOperation({ summary: 'One student’s month: each day with morning, afternoon and the day status, and the %' })
  @ApiEnvelope(MonthlyAttendanceDto)
  monthly(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Query() query: MonthQueryDto) {
    return this.attendance.monthly(schoolId, id, query.month);
  }
}

@ApiTags('Admin · Attendance')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/student-leaves')
export class StudentLeavesController {
  constructor(private readonly leaves: StudentLeaveService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ATTENDANCE_VIEW)
  @ApiOperation({
    summary: 'Leave requests sent by parents',
    description: 'search matches student name, admission number and reason. sort: from_date, created_at, status.',
  })
  @ApiEnvelope(StudentLeaveDto, { paginated: true })
  list(@SchoolId() schoolId: number, @Query() query: StudentLeaveQueryDto) {
    return this.leaves.list(schoolId, query);
  }

  @Post(':id/decision')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.ATTENDANCE_MANAGE)
  @ResponseMessage('Decision saved')
  @ApiOperation({ summary: 'Approve or reject a waiting request. The parent is told in the app.' })
  @ApiEnvelope(StudentLeaveDto, { message: 'Decision saved' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  decide(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LeaveDecisionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.leaves.decide(schoolId, id, dto, actor);
  }
}
