import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelope,
  ApiErrors,
  AppException,
  AuthUser,
  CurrentUser,
  RequirePermissions,
  ResponseMessage,
} from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import { TEACHER_MODULE_TAGS } from '../mobile/teacher-modules.catalog';
import {
  BillDto,
  BillResultDto,
  CaseActionDto,
  CaseCloseDto,
  CaseDto,
  CaseInputDto,
  CaseQueryDto,
  ComplaintActionDto,
  ComplaintDetailDto,
  ComplaintDto,
  ComplaintInputDto,
  ComplaintPatchDto,
  ComplaintQueryDto,
  ConductInsightsDto,
  DepositSettleDto,
  DuesQueryDto,
  DuesRowDto,
  FeesInsightsDto,
  ResidentFeesDto,
  ScheduleDto,
  ScheduleInputDto,
  TicketChangeDto,
  TicketChargeDto,
  TicketDetailDto,
  TicketDto,
  TicketInputDto,
  TicketQueryDto,
} from './dto/hostel-conduct.dto';
import { HostelIdQueryDto } from './dto/hostel-setup.dto';
import { HostelDisciplineService } from './hostel-discipline.service';
import { HostelFeesService } from './hostel-fees.service';
import { HostelTicketsService } from './hostel-tickets.service';
import { ComplaintAction } from './hostel.logic';

export const COMPLAINT_ACTIONS = {
  start: 'start',
  resolve: 'resolve',
  close: 'close',
  reject: 'reject',
  reopen: 'reopen',
} as const;

const schoolOf = (user: AuthUser): number => {
  if (!user.school_id) throw AppException.forbidden('Your account is not linked to a school', 'NO_SCHOOL');
  return user.school_id;
};

@ApiTags('Admin · Hostel fees & conduct')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/hostel')
export class HostelConductController {
  constructor(
    private readonly fees: HostelFeesService,
    private readonly discipline: HostelDisciplineService,
    private readonly tickets: HostelTicketsService,
  ) {}

  @Get('fees/schedule')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Hostel fee instalments of the current year (share of the room type annual fee)' })
  @ApiEnvelope(ScheduleDto)
  @ApiErrors(HttpStatus.BAD_REQUEST)
  schedule(@SchoolId() schoolId: number) {
    return this.fees.schedule(schoolId);
  }

  @Put('fees/schedule')
  @RequirePermissions(PERMISSIONS.HOSTEL_FEES)
  @ResponseMessage('Fee schedule saved')
  @ApiOperation({ summary: 'Replace the instalments (shares add up to 100); once billed only names can change' })
  @ApiEnvelope(ScheduleDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  saveSchedule(@SchoolId() schoolId: number, @Body() dto: ScheduleInputDto, @CurrentUser() user: AuthUser) {
    return this.fees.saveSchedule(schoolId, dto, user);
  }

  @Post('fees/bill')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_FEES)
  @ResponseMessage('Hostel fees billed')
  @ApiOperation({
    summary: 'Bill hostel fee instalments and the caution deposit not billed yet',
    description:
      'Creates normal fee invoices (they show in Fees, the Parent app and online payment). Safe to run again: nothing is billed twice.',
  })
  @ApiEnvelope(BillResultDto)
  @ApiErrors(HttpStatus.BAD_REQUEST)
  bill(@SchoolId() schoolId: number, @Body() dto: BillDto, @CurrentUser() user: AuthUser) {
    return this.fees.bill(schoolId, dto, user);
  }

  @Get('fees/insights')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Hostel fee billed, collected, outstanding, deposits held, residents not billed' })
  @ApiEnvelope(FeesInsightsDto)
  feesInsights(@SchoolId() schoolId: number, @Query() query: HostelIdQueryDto) {
    return this.fees.insights(schoolId, query.hostel_id);
  }

  @Get('fees/dues')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Residents with hostel fee billed, paid and balance. sort: balance, name, billed' })
  @ApiEnvelope(DuesRowDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  dues(@SchoolId() schoolId: number, @Query() query: DuesQueryDto) {
    return this.fees.duesList(schoolId, query);
  }

  @Get('admissions/:id/fees')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'One resident’s hostel invoices and deposit' })
  @ApiEnvelope(ResidentFeesDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  residentFees(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.fees.residentFees(schoolId, id);
  }

  @Post('admissions/:id/deposit/settle')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_FEES)
  @ResponseMessage('Deposit settled')
  @ApiOperation({ summary: 'Refund the caution deposit, keeping any deduction; ticks the checkout item' })
  @ApiEnvelope(ResidentFeesDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  settle(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DepositSettleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.fees.settleDeposit(schoolId, id, dto, user);
  }

  @Get('conduct/insights')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Open discipline cases, complaints and maintenance tickets, overdue counts, rating' })
  @ApiEnvelope(ConductInsightsDto)
  conductInsights(@SchoolId() schoolId: number, @Query() query: HostelIdQueryDto) {
    return this.tickets.insights(schoolId, query.hostel_id);
  }

  @Get('discipline')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Discipline cases. sort: created_at, incident_at, severity' })
  @ApiEnvelope(CaseDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  cases(@SchoolId() schoolId: number, @Query() query: CaseQueryDto) {
    return this.discipline.list(schoolId, query);
  }

  @Get('discipline/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'One discipline case' })
  @ApiEnvelope(CaseDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  getCase(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.discipline.get(schoolId, id);
  }

  @Post('discipline')
  @RequirePermissions(PERMISSIONS.HOSTEL_DISCIPLINE)
  @ResponseMessage('Case recorded')
  @ApiOperation({ summary: 'Record a discipline case; parents are told when visible_to_parent' })
  @ApiEnvelope(CaseDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  createCase(@SchoolId() schoolId: number, @Body() dto: CaseInputDto, @CurrentUser() user: AuthUser) {
    return this.discipline.create(schoolId, dto, user);
  }

  @Post('discipline/:id/action')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_DISCIPLINE)
  @ResponseMessage('Action recorded')
  @ApiOperation({ summary: 'Decide the action; a fine is raised as a fee fine and needs fee approval' })
  @ApiEnvelope(CaseDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  act(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CaseActionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.discipline.act(schoolId, id, dto, user);
  }

  @Post('discipline/:id/close')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_DISCIPLINE)
  @ResponseMessage('Case closed')
  @ApiOperation({ summary: 'Close a case' })
  @ApiEnvelope(CaseDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  closeCase(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CaseCloseDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.discipline.close(schoolId, id, dto, user, false);
  }

  @Post('discipline/:id/withdraw')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_DISCIPLINE)
  @ResponseMessage('Case withdrawn')
  @ApiOperation({ summary: 'Withdraw an open case recorded by mistake' })
  @ApiEnvelope(CaseDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  withdrawCase(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CaseCloseDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.discipline.close(schoolId, id, dto, user, true);
  }

  @Get('complaints')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Hostel complaints. sort: created_at, due_at, priority' })
  @ApiEnvelope(ComplaintDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  complaints(@SchoolId() schoolId: number, @Query() query: ComplaintQueryDto) {
    return this.tickets.complaints(schoolId, query);
  }

  @Get('complaints/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'One complaint with its timeline' })
  @ApiEnvelope(ComplaintDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  complaint(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.tickets.complaint(schoolId, id);
  }

  @Post('complaints')
  @RequirePermissions(PERMISSIONS.HOSTEL_COMPLAINT)
  @ResponseMessage('Complaint recorded')
  @ApiOperation({ summary: 'Record a complaint (for a hostel, room or resident)' })
  @ApiEnvelope(ComplaintDetailDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  createComplaint(@SchoolId() schoolId: number, @Body() dto: ComplaintInputDto, @CurrentUser() user: AuthUser) {
    return this.tickets.createComplaint(schoolId, dto, user);
  }

  @Patch('complaints/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_COMPLAINT)
  @ResponseMessage('Complaint updated')
  @ApiOperation({ summary: 'Change priority, assign to a staff member or add a note' })
  @ApiEnvelope(ComplaintDetailDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  patchComplaint(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ComplaintPatchDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tickets.patchComplaint(schoolId, id, dto, user);
  }

  @Post('complaints/:id/maintenance')
  @RequirePermissions(PERMISSIONS.HOSTEL_MAINTENANCE)
  @ResponseMessage('Maintenance ticket raised')
  @ApiOperation({ summary: 'Turn a complaint into a maintenance ticket; finishing the ticket resolves the complaint' })
  @ApiEnvelope(TicketDetailDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  toMaintenance(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TicketInputDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tickets.toMaintenance(schoolId, id, dto, user);
  }

  @Post('complaints/:id/:action')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_COMPLAINT)
  @ResponseMessage('Complaint updated')
  @ApiParam({ name: 'action', enum: Object.values(COMPLAINT_ACTIONS) })
  @ApiOperation({ summary: 'Start, resolve (note required), close, reject (note required) or reopen' })
  @ApiEnvelope(ComplaintDetailDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  actComplaint(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('action', new ParseEnumPipe(COMPLAINT_ACTIONS)) action: ComplaintAction,
    @Body() dto: ComplaintActionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tickets.actComplaint(schoolId, id, action, dto, user);
  }

  @Get('maintenance')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Maintenance tickets. sort: created_at, due_at, scheduled_on' })
  @ApiEnvelope(TicketDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  maintenance(@SchoolId() schoolId: number, @Query() query: TicketQueryDto) {
    return this.tickets.tickets(schoolId, query);
  }

  @Get('maintenance/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'One maintenance ticket with its timeline' })
  @ApiEnvelope(TicketDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  ticket(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.tickets.ticket(schoolId, id);
  }

  @Post('maintenance')
  @RequirePermissions(PERMISSIONS.HOSTEL_MAINTENANCE)
  @ResponseMessage('Maintenance ticket raised')
  @ApiOperation({ summary: 'Raise a maintenance ticket; blocks_room closes the room for new students until done' })
  @ApiEnvelope(TicketDetailDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  createTicket(@SchoolId() schoolId: number, @Body() dto: TicketInputDto, @CurrentUser() user: AuthUser) {
    return this.tickets.createTicket(schoolId, dto, user);
  }

  @Patch('maintenance/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_MAINTENANCE)
  @ResponseMessage('Ticket updated')
  @ApiOperation({ summary: 'Assign, schedule, change status (done reopens the room), record cost' })
  @ApiEnvelope(TicketDetailDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  changeTicket(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TicketChangeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tickets.changeTicket(schoolId, id, dto, user);
  }

  @Post('maintenance/:id/charge')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_MAINTENANCE)
  @ResponseMessage('Damage charge raised for approval')
  @ApiOperation({ summary: 'Charge the resident who caused the damage (a fee fine that needs approval)' })
  @ApiEnvelope(TicketDetailDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  charge(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TicketChargeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tickets.chargeTicket(schoolId, id, dto, user);
  }
}

@ApiTags(TEACHER_MODULE_TAGS.MODULE_14)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('mobile/teacher/hostel')
export class MobileHostelConductController {
  constructor(
    private readonly fees: HostelFeesService,
    private readonly discipline: HostelDisciplineService,
    private readonly tickets: HostelTicketsService,
  ) {}

  @Get('residents/:id/fees')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'A resident’s hostel fee: billed, paid, balance, deposit' })
  @ApiEnvelope(ResidentFeesDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  residentFees(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.fees.residentFees(schoolOf(user), id);
  }

  @Get('conduct/insights')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Open cases, complaints and tickets for the warden home' })
  @ApiEnvelope(ConductInsightsDto)
  insights(@CurrentUser() user: AuthUser, @Query() query: HostelIdQueryDto) {
    return this.tickets.insights(schoolOf(user), query.hostel_id);
  }

  @Get('discipline')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Discipline cases' })
  @ApiEnvelope(CaseDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  cases(@CurrentUser() user: AuthUser, @Query() query: CaseQueryDto) {
    return this.discipline.list(schoolOf(user), query);
  }

  @Get('discipline/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'One discipline case' })
  @ApiEnvelope(CaseDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  getCase(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.discipline.get(schoolOf(user), id);
  }

  @Post('discipline')
  @RequirePermissions(PERMISSIONS.HOSTEL_DISCIPLINE)
  @ResponseMessage('Case recorded')
  @ApiOperation({ summary: 'Record a discipline case' })
  @ApiEnvelope(CaseDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  createCase(@CurrentUser() user: AuthUser, @Body() dto: CaseInputDto) {
    return this.discipline.create(schoolOf(user), dto, user);
  }

  @Post('discipline/:id/action')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_DISCIPLINE)
  @ResponseMessage('Action recorded')
  @ApiOperation({ summary: 'Decide the action (warning, counselling, parent meeting, fine, suspension...)' })
  @ApiEnvelope(CaseDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  act(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: CaseActionDto) {
    return this.discipline.act(schoolOf(user), id, dto, user);
  }

  @Post('discipline/:id/close')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_DISCIPLINE)
  @ResponseMessage('Case closed')
  @ApiOperation({ summary: 'Close a case' })
  @ApiEnvelope(CaseDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  closeCase(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: CaseCloseDto) {
    return this.discipline.close(schoolOf(user), id, dto, user, false);
  }

  @Get('complaints')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Complaints (status=open for the to-do list, overdue=true)' })
  @ApiEnvelope(ComplaintDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  complaints(@CurrentUser() user: AuthUser, @Query() query: ComplaintQueryDto) {
    return this.tickets.complaints(schoolOf(user), query);
  }

  @Get('complaints/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'One complaint with its timeline' })
  @ApiEnvelope(ComplaintDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  complaint(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.tickets.complaint(schoolOf(user), id);
  }

  @Post('complaints')
  @RequirePermissions(PERMISSIONS.HOSTEL_COMPLAINT)
  @ResponseMessage('Complaint recorded')
  @ApiOperation({ summary: 'Record a complaint' })
  @ApiEnvelope(ComplaintDetailDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  createComplaint(@CurrentUser() user: AuthUser, @Body() dto: ComplaintInputDto) {
    return this.tickets.createComplaint(schoolOf(user), dto, user);
  }

  @Patch('complaints/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_COMPLAINT)
  @ResponseMessage('Complaint updated')
  @ApiOperation({ summary: 'Change priority, assign or add a note' })
  @ApiEnvelope(ComplaintDetailDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  patchComplaint(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: ComplaintPatchDto) {
    return this.tickets.patchComplaint(schoolOf(user), id, dto, user);
  }

  @Post('complaints/:id/maintenance')
  @RequirePermissions(PERMISSIONS.HOSTEL_MAINTENANCE)
  @ResponseMessage('Maintenance ticket raised')
  @ApiOperation({ summary: 'Turn a complaint into a maintenance ticket' })
  @ApiEnvelope(TicketDetailDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  toMaintenance(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: TicketInputDto) {
    return this.tickets.toMaintenance(schoolOf(user), id, dto, user);
  }

  @Post('complaints/:id/:action')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_COMPLAINT)
  @ResponseMessage('Complaint updated')
  @ApiParam({ name: 'action', enum: Object.values(COMPLAINT_ACTIONS) })
  @ApiOperation({ summary: 'Start, resolve, close, reject or reopen a complaint' })
  @ApiEnvelope(ComplaintDetailDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  actComplaint(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('action', new ParseEnumPipe(COMPLAINT_ACTIONS)) action: ComplaintAction,
    @Body() dto: ComplaintActionDto,
  ) {
    return this.tickets.actComplaint(schoolOf(user), id, action, dto, user);
  }

  @Get('maintenance')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Maintenance tickets (open=true for work still to do)' })
  @ApiEnvelope(TicketDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  maintenance(@CurrentUser() user: AuthUser, @Query() query: TicketQueryDto) {
    return this.tickets.tickets(schoolOf(user), query);
  }

  @Get('maintenance/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'One maintenance ticket' })
  @ApiEnvelope(TicketDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  ticket(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.tickets.ticket(schoolOf(user), id);
  }

  @Post('maintenance')
  @RequirePermissions(PERMISSIONS.HOSTEL_MAINTENANCE)
  @ResponseMessage('Maintenance ticket raised')
  @ApiOperation({ summary: 'Raise a maintenance ticket with a photo' })
  @ApiEnvelope(TicketDetailDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  createTicket(@CurrentUser() user: AuthUser, @Body() dto: TicketInputDto) {
    return this.tickets.createTicket(schoolOf(user), dto, user);
  }

  @Patch('maintenance/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_MAINTENANCE)
  @ResponseMessage('Ticket updated')
  @ApiOperation({ summary: 'Update status, assignee, vendor, schedule or cost' })
  @ApiEnvelope(TicketDetailDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  changeTicket(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: TicketChangeDto) {
    return this.tickets.changeTicket(schoolOf(user), id, dto, user);
  }
}
