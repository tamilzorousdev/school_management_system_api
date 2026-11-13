import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Version,
} from '@nestjs/common';
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
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { ROLES } from '../access/access.catalog';
import { AttendanceService } from '../attendance/attendance.service';
import {
  AttendanceYearDto,
  CurrentMarkDto,
  CurrentMarkSomeDto,
  DayQueryDto,
  LeaveDecisionDto,
  MarkAttendanceDto,
  MarkSomeAttendanceDto,
  MonthlyAttendanceDto,
  MonthQueryDto,
  RosterDto,
  RosterQueryDto,
  SectionDayDto,
  SectionReportDto,
  StudentLeaveDto,
  StudentLeaveInputDto,
  StudentLeaveQueryDto,
} from '../attendance/dto/attendance.dto';
import { ordinal } from '../attendance/attendance-sessions';
import { StudentLeaveService } from '../attendance/student-leave.service';
import { AssignmentsService } from '../staff/assignments.service';
import { CheckInStatusDto, LocationDto, StaffMonthDto } from '../staff-attendance/dto/staff-attendance.dto';
import { StaffAttendanceService } from '../staff-attendance/staff-attendance.service';
import {
  LeaveBalanceDto,
  StaffLeaveDecisionDto,
  StaffLeaveDto,
  StaffLeaveInputDto,
} from '../staff-leave/dto/staff-leave.dto';
import { StaffLeaveService } from '../staff-leave/staff-leave.service';
import { LeavePreviewDto, LeavePreviewQueryDto, StaffLeaveApprovalDto } from './dto/teacher-insights.dto';
import { TeacherInsightsService } from './teacher-insights.service';
import { MySubstitutionDto } from '../substitutes/dto/substitute.dto';
import { SubstitutesService } from '../substitutes/substitutes.service';
import { TeacherTimetableDto } from '../timetable/dto/timetable.dto';
import { ChildBusDto, ChildBusV2Dto } from '../tracking/dto/tracking.dto';
import { TripsService } from '../tracking/trips.service';
import { ParentTransportDto } from '../transport/dto/transport.dto';
import { RoutesService } from '../transport/routes.service';
import { TimetableService } from '../timetable/timetable.service';
import { TodayAttendanceDto } from './dto/mobile.dto';
import { MobileAccessService } from './mobile-access.service';
import { TEACHER_MODULE_TAGS } from './teacher-modules.catalog';
import { PARENT_MODULE_TAGS } from './parent-modules.catalog';

@ApiTags(PARENT_MODULE_TAGS.MODULE_2)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND)
@RequireRoles(ROLES.PARENT)
@Controller('mobile/parent/children/:id')
export class MobileParentAttendanceController {
  constructor(
    private readonly access: MobileAccessService,
    private readonly attendance: AttendanceService,
    private readonly leaves: StudentLeaveService,
    private readonly transport: RoutesService,
    private readonly tracking: TripsService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  @Get('bus')
  @ApiOperation({
    summary:
      'Live bus for this child: status, ready-to-show headline, ETA to the child’s stop, position (or last known)',
    description:
      'status: no_trip, on_the_way, approaching, at_stop, passed, trip_ended. When trip is not null, follow it live: connect to the /live socket with { auth: { token } } and emit trip.subscribe { trip_id }; you get trip.position and trip.event. null when the child does not use the bus.',
  })
  @ApiEnvelope(ChildBusDto)
  async bus(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.tracking.childBus(await this.access.childSchool(user.id, id), id);
  }

  @Get('bus')
  @Version('2')
  @ApiOperation({
    summary: 'Live bus for this child with the stop timeline (v2: everything in v1 plus timeline)',
    description:
      'Same access and fields as v1, plus boarding_status (not_yet, boarded, alighted), last_position_at and timeline. timeline.source is live while a trip runs: every stop in travel order with planned time, status (pending, approaching, arrived, departed, skipped), eta_seconds and eta_at for upcoming stops, arrived_at and departed_at for past ones, is_child_stop and minutes_late. With no trip running, source is scheduled: the next planned trip for the child’s route with its planned stops. null when the child does not use the bus.',
  })
  @ApiEnvelope(ChildBusV2Dto)
  async busV2(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.tracking.childBusWithTimeline(await this.access.childSchool(user.id, id), id);
  }

  @Get('transport')
  @ApiOperation({
    summary: 'Bus route, stop with pickup and drop time, bus, driver and attendant; null when the child walks',
  })
  @ApiEnvelope(ParentTransportDto)
  async transportCard(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.transport.forParent(await this.access.childSchool(user.id, id), id);
  }

  @Get('attendance')
  @ApiOperation({
    summary: 'Attendance calendar for a month: each day with morning, afternoon and the day status, and the %',
    description:
      'Attendance is taken in the 1st period (morning) and the 5th period (afternoon). Absent in one session = half_day.',
  })
  @ApiEnvelope(MonthlyAttendanceDto)
  async month(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() query: MonthQueryDto) {
    return this.attendance.monthly(await this.access.childSchool(user.id, id), id, query.month);
  }

  @Get('attendance/summary')
  @ApiOperation({
    summary: 'This academic year: the year % and each month with its % (present, late, half day, absent, leave)',
  })
  @ApiEnvelope(AttendanceYearDto)
  async yearSummary(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.attendance.yearSummary(await this.access.childSchool(user.id, id), id);
  }

  @Get('attendance/today')
  @ApiOperation({ summary: 'Today’s attendance for the home screen badge: the day, morning and afternoon' })
  @ApiEnvelope(TodayAttendanceDto)
  async today(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number): Promise<TodayAttendanceDto> {
    const schoolId = await this.access.childSchool(user.id, id);
    return { date: todayIn(this.app.timeZone), ...(await this.attendance.todaySessions(id, schoolId)) };
  }

  @Get('leaves')
  @ApiOperation({ summary: 'Leave requests sent for this child, newest first' })
  @ApiEnvelope(StudentLeaveDto, { isArray: true })
  async leaveList(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.leaves.forStudent(await this.access.childSchool(user.id, id), id);
  }

  @Post('leaves')
  @ResponseMessage('Leave request sent')
  @ApiOperation({
    summary: 'Ask for leave. The class teacher approves it in the Staff app.',
    description: 'Up to 7 days back and 30 days long. 409 LEAVE_OVERLAP when another request covers these days.',
  })
  @ApiEnvelope(StudentLeaveDto, { status: HttpStatus.CREATED, message: 'Leave request sent' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  async apply(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: StudentLeaveInputDto) {
    return this.leaves.apply(await this.access.childSchool(user.id, id), id, dto, user);
  }

  @Post('leaves/:leaveId/cancel')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Leave request cancelled')
  @ApiOperation({ summary: 'Cancel a request that is still waiting' })
  @ApiEnvelope(StudentLeaveDto, { message: 'Leave request cancelled' })
  @ApiErrors(HttpStatus.CONFLICT)
  async cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('leaveId', ParseIntPipe) leaveId: number,
  ) {
    return this.leaves.cancel(await this.access.childSchool(user.id, id), id, leaveId);
  }
}

@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@RequireRoles(ROLES.TEACHER, ROLES.HOD, ROLES.PRINCIPAL)
@Controller('mobile/teacher')
export class MobileTeacherAttendanceController {
  constructor(
    private readonly access: MobileAccessService,
    private readonly assignments: AssignmentsService,
    private readonly attendance: AttendanceService,
    private readonly studentLeaves: StudentLeaveService,
    private readonly staffAttendance: StaffAttendanceService,
    private readonly staffLeaves: StaffLeaveService,
    private readonly timetable: TimetableService,
    private readonly substitutes: SubstitutesService,
    private readonly insights: TeacherInsightsService,
  ) {}

  @Get('check-in')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_2)
  @ApiOperation({ summary: 'My check-in today: time in, time out, late or not, and how far from school' })
  @ApiEnvelope(CheckInStatusDto)
  checkInStatus(@CurrentUser() user: AuthUser) {
    return this.staffAttendance.status(user);
  }

  @Post('check-in')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_2)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Checked in')
  @ApiOperation({
    summary: 'Check in with the phone location',
    description: '400 OUTSIDE_SCHOOL when the phone is outside the school radius; 409 ALREADY_CHECKED_IN.',
  })
  @ApiEnvelope(CheckInStatusDto, { message: 'Checked in' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  checkIn(@CurrentUser() user: AuthUser, @Body() dto: LocationDto) {
    return this.staffAttendance.checkIn(user, dto);
  }

  @Post('check-out')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_2)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Checked out')
  @ApiOperation({ summary: 'Check out with the phone location' })
  @ApiEnvelope(CheckInStatusDto, { message: 'Checked out' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  checkOut(@CurrentUser() user: AuthUser, @Body() dto: LocationDto) {
    return this.staffAttendance.checkOut(user, dto);
  }

  @Get('my-attendance')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_2)
  @ApiOperation({ summary: 'My attendance for a month' })
  @ApiEnvelope(StaffMonthDto)
  myAttendance(@CurrentUser() user: AuthUser, @Query() query: MonthQueryDto) {
    return this.staffAttendance.month(this.access.teacherSchool(user), user.id, query.month);
  }

  @Get('sections/:id/attendance')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_2)
  @ApiOperation({
    summary: 'Attendance roster of my section for a date and session (morning = 1st period, afternoon = 5th period)',
    description:
      'Session mode (school attendance_mode = session): session=morning (default) or afternoon; any other period gives 400 PERIOD_NOT_ALLOWED. Period mode: send period=1..last period; the teacher of that period in the timetable can mark it. open is true only today during that period (opens_at to closes_at); otherwise show the list read-only. A later list starts from the marks of the period before.',
  })
  @ApiEnvelope(RosterDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND)
  async roster(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() query: RosterQueryDto) {
    const schoolId = this.access.teacherSchool(user);
    const slot = await this.attendance.slotFor(schoolId, query);
    await this.assertCanMark(schoolId, user.id, id, query.date, slot.period);
    return this.attendance.roster(schoolId, id, query.date, slot, { teacher: true });
  }

  @Put('sections/:id/attendance')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_2)
  @ResponseMessage('Attendance saved')
  @ApiOperation({
    summary: 'Save the morning (1st period) or afternoon (5th period) attendance of my section',
    description:
      'Body: { date, session: "morning" | "afternoon", items: [{ student_id, status, remarks }] } with every student once. Teachers can save a session only today during its period (1st period for morning, 5th for afternoon): 400 SESSION_NOT_OPEN before, 400 SESSION_CLOSED after (the office marks it then), 400 PERIOD_NOT_ALLOWED for other periods. Parents of absent students get an alert once per day (a child present in the morning and absent in the afternoon is alerted for the afternoon).',
  })
  @ApiEnvelope(RosterDto, { message: 'Attendance saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND)
  async mark(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: MarkAttendanceDto) {
    const schoolId = this.access.teacherSchool(user);
    await this.assertCanMark(schoolId, user.id, id, dto.date, (await this.attendance.slotFor(schoolId, dto)).period);
    return this.attendance.mark(schoolId, id, dto, user, { teacher: true });
  }

  @Patch('sections/:id/attendance')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_2)
  @ResponseMessage('Attendance saved')
  @ApiOperation({
    summary: 'Mark only some students in one call: each with its own status (present, absent, late, half_day, leave)',
    description:
      'Body: { date, session, items: [{ student_id, status, remarks }] } with only the students to change. Everyone else keeps the saved status, or the default when the session is not saved yet (present; leave for approved leave; the afternoon starts from the morning). Same rules as PUT: only during the 1st or 5th period (SESSION_NOT_OPEN / SESSION_CLOSED), parents of newly absent students get the alert. 400 STUDENT_NOT_IN_SECTION, DUPLICATE_STUDENT.',
  })
  @ApiEnvelope(RosterDto, { message: 'Attendance saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND)
  async markSome(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MarkSomeAttendanceDto,
  ) {
    const schoolId = this.access.teacherSchool(user);
    await this.assertCanMark(schoolId, user.id, id, dto.date, (await this.attendance.slotFor(schoolId, dto)).period);
    return this.attendance.markSome(schoolId, id, dto, user, { teacher: true });
  }

  @Get('sections/:id/attendance/current')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_2)
  @ApiOperation({
    summary: 'Roster for the session open right now. The API picks today and morning or afternoon from its own clock.',
    description:
      'No date, session or period to send. Session mode: during the 1st period plus grace it is the morning list, during the 5th period plus grace the afternoon list. Period mode: the period running now (mode and period are in the reply). Outside those times open is false: show the list read-only with opens_at and closes_at (closes_at already includes grace_minutes). The proxy teacher of that period can also use it.',
  })
  @ApiEnvelope(RosterDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND)
  async currentRoster(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const schoolId = this.access.teacherSchool(user);
    const now = await this.attendance.current(schoolId);
    await this.assertCanMark(schoolId, user.id, id, now.date, now.period);
    return this.attendance.rosterCurrent(schoolId, id);
  }

  @Put('sections/:id/attendance/current')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_2)
  @ResponseMessage('Attendance saved')
  @ApiOperation({
    summary: 'Save the open session for every student. The API sets today and morning or afternoon.',
    description:
      'Body: { items: [{ student_id, status, remarks }] } with every student once; status P, A, L or the full word. The phone time is never used. 400 SESSION_NOT_OPEN before the 1st or 5th period starts, 400 SESSION_CLOSED after the period plus grace (the office marks it then).',
  })
  @ApiEnvelope(RosterDto, { message: 'Attendance saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND)
  async markCurrent(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: CurrentMarkDto) {
    const schoolId = this.access.teacherSchool(user);
    const now = await this.attendance.current(schoolId);
    await this.assertCanMark(schoolId, user.id, id, now.date, now.period);
    return this.attendance.markCurrent(schoolId, id, dto, user);
  }

  @Patch('sections/:id/attendance/current')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_2)
  @ResponseMessage('Attendance saved')
  @ApiOperation({
    summary: 'Mark only some students in the open session. The API sets today and morning or afternoon.',
    description:
      'Body: { items: [{ student_id, status, remarks }] } with only the students to change; everyone else keeps the saved status or the default. Same time rules as PUT .../current.',
  })
  @ApiEnvelope(RosterDto, { message: 'Attendance saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND)
  async markSomeCurrent(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CurrentMarkSomeDto,
  ) {
    const schoolId = this.access.teacherSchool(user);
    const now = await this.attendance.current(schoolId);
    await this.assertCanMark(schoolId, user.id, id, now.date, now.period);
    return this.attendance.markSomeCurrent(schoolId, id, dto, user);
  }

  private async assertCanMark(
    schoolId: number,
    userId: number,
    sectionId: number,
    date: string,
    period: number,
  ): Promise<void> {
    if (await this.attendance.isProxyFor(schoolId, userId, sectionId, date, period)) return;
    if (await this.attendance.isPeriodTeacher(schoolId, userId, sectionId, date, period)) return;
    const { mode } = await this.attendance.modeOf(schoolId);
    if (mode === 'session') {
      const classTeacherSections = await this.access.classTeacherSections(schoolId, userId);
      if (classTeacherSections.includes(sectionId)) return;
      await this.assignments.assertTeachesSection(schoolId, userId, sectionId);
      throw AppException.forbidden(
        `Only the class teacher or the teacher assigned to ${period === 1 ? '1st period (morning)' : '5th period (afternoon)'} can take attendance for this section`,
        'NOT_PERIOD_TEACHER',
      );
    }
    await this.assignments.assertTeachesSection(schoolId, userId, sectionId);
    throw AppException.forbidden(
      `You are not scheduled to teach ${ordinal(period)} period for this section`,
      'NOT_PERIOD_TEACHER',
    );
  }

  @Get('sections/:id/attendance/day')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_2)
  @ApiOperation({
    summary: 'Daily report of my class: each student with morning, afternoon and the day status, with counts',
    description: 'Class teacher only (403 NOT_CLASS_TEACHER). Any date, read-only.',
  })
  @ApiEnvelope(SectionDayDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  async sectionDay(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() query: DayQueryDto) {
    const schoolId = this.access.teacherSchool(user);
    await this.attendance.assertClassTeacherOfSection(schoolId, id, user.id);
    return this.attendance.sectionDay(schoolId, id, query.date);
  }

  @Get('sections/:id/attendance/report')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_2)
  @ApiOperation({
    summary: 'Monthly report of my class: every student with present, late, half day, absent, leave and %',
    description: 'Class teacher only (403 NOT_CLASS_TEACHER). percent is over the days attendance was taken.',
  })
  @ApiEnvelope(SectionReportDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  async sectionReport(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: MonthQueryDto,
  ) {
    const schoolId = this.access.teacherSchool(user);
    await this.attendance.assertClassTeacherOfSection(schoolId, id, user.id);
    return this.attendance.sectionReport(schoolId, id, query.month);
  }

  @Get('students/:id/attendance')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_2)
  @ApiOperation({
    summary: 'One student of my class for a month: each day with morning, afternoon, the day status and the %',
    description: 'Class teacher only (403 NOT_CLASS_TEACHER).',
  })
  @ApiEnvelope(MonthlyAttendanceDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  async studentMonth(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: MonthQueryDto,
  ) {
    const schoolId = this.access.teacherSchool(user);
    await this.attendance.assertClassTeacherOfStudent(schoolId, id, user.id);
    return this.attendance.monthly(schoolId, id, query.month);
  }

  @Get('students/:id/attendance/summary')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_2)
  @ApiOperation({
    summary: 'One student of my class this academic year: the year % and each month with its %',
    description: 'Class teacher only (403 NOT_CLASS_TEACHER).',
  })
  @ApiEnvelope(AttendanceYearDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  async studentYear(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const schoolId = this.access.teacherSchool(user);
    await this.attendance.assertClassTeacherOfStudent(schoolId, id, user.id);
    return this.attendance.yearSummary(schoolId, id);
  }

  @Get('timetable')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_3)
  @ApiOperation({ summary: 'My weekly timetable' })
  @ApiEnvelope(TeacherTimetableDto)
  myTimetable(@CurrentUser() user: AuthUser) {
    return this.timetable.teacherGrid(this.access.teacherSchool(user), user.id);
  }

  @Get('substitutions')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_3)
  @ApiOperation({ summary: 'Classes I take in place of absent teachers, today and the next 7 days' })
  @ApiEnvelope(MySubstitutionDto, { isArray: true })
  mySubstitutions(@CurrentUser() user: AuthUser) {
    return this.substitutes.mine(user);
  }

  @Get('leave-balances')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_2)
  @ApiOperation({ summary: 'My leave balance per leave type this year' })
  @ApiEnvelope(LeaveBalanceDto, { isArray: true })
  balances(@CurrentUser() user: AuthUser) {
    return this.staffLeaves.balances(this.access.teacherSchool(user), user.id);
  }

  @Get('leaves')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_2)
  @ApiOperation({ summary: 'My leave requests, newest first' })
  @ApiEnvelope(StaffLeaveDto, { isArray: true })
  myLeaves(@CurrentUser() user: AuthUser) {
    return this.staffLeaves.mine(user);
  }

  @Post('leaves')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_2)
  @ResponseMessage('Leave request sent')
  @ApiOperation({
    summary: 'Apply for leave. It goes to the HOD of my department first, then the principal.',
    description: '400 LEAVE_BALANCE_LOW or NO_WORKING_DAYS; 409 LEAVE_OVERLAP.',
  })
  @ApiEnvelope(StaffLeaveDto, { status: HttpStatus.CREATED, message: 'Leave request sent' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  apply(@CurrentUser() user: AuthUser, @Body() dto: StaffLeaveInputDto) {
    return this.staffLeaves.apply(user, dto);
  }

  @Post('leaves/:id/cancel')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_2)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Leave request cancelled')
  @ApiOperation({ summary: 'Cancel my request while it is still waiting' })
  @ApiEnvelope(StaffLeaveDto, { message: 'Leave request cancelled' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.staffLeaves.cancel(user, id);
  }

  @Get('leaves/preview')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_2)
  @ApiOperation({
    summary: 'Before applying: working days, balance after, and my periods on those days',
    description:
      'Sundays and holidays are left out. periods lists my timetable periods on those days and morning_attendance my class-teacher sections; message is a ready-made line such as "You have 11 periods, including 6 - A morning attendance on these days." enough_balance false and overlaps_existing true tell the app that applying would be refused.',
  })
  @ApiEnvelope(LeavePreviewDto)
  @ApiErrors(HttpStatus.BAD_REQUEST)
  preview(@CurrentUser() user: AuthUser, @Query() query: LeavePreviewQueryDto) {
    return this.insights.leavePreview(user, query);
  }

  @Get('leave-approvals')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_2)
  @ApiOperation({
    summary: 'Staff leave requests waiting for me (HOD or principal)',
    description:
      'Each request also has balance_remaining (days of that leave type the person has left), affected_periods and affected_sections (classes that will need a proxy).',
  })
  @ApiEnvelope(StaffLeaveApprovalDto, { isArray: true })
  approvals(@CurrentUser() user: AuthUser) {
    return this.insights.approvals(user);
  }

  @Post('leave-approvals/:id/decision')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_2)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Decision saved')
  @ApiOperation({ summary: 'Approve or reject a staff leave request waiting for me' })
  @ApiEnvelope(StaffLeaveDto, { message: 'Decision saved' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  decideStaff(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: StaffLeaveDecisionDto,
  ) {
    return this.staffLeaves.decide(user, id, dto);
  }

  @Get('student-leaves')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_2)
  @ApiOperation({ summary: 'Leave requests from parents of my class-teacher sections' })
  @ApiEnvelope(StudentLeaveDto, { paginated: true })
  async parentRequests(@CurrentUser() user: AuthUser, @Query() query: StudentLeaveQueryDto) {
    const schoolId = this.access.teacherSchool(user);
    return this.studentLeaves.list(schoolId, query, await this.access.classTeacherSections(schoolId, user.id));
  }

  @Post('student-leaves/:id/decision')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_2)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Decision saved')
  @ApiOperation({ summary: 'Approve or reject a parent’s leave request (class teacher only). The parent is told.' })
  @ApiEnvelope(StudentLeaveDto, { message: 'Decision saved' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async decideStudent(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LeaveDecisionDto,
  ) {
    const schoolId = this.access.teacherSchool(user);
    return this.studentLeaves.decide(
      schoolId,
      id,
      dto,
      user,
      await this.access.classTeacherSections(schoolId, user.id),
    );
  }
}
