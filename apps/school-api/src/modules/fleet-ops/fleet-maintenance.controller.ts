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
import { ApiFile } from '../../shared/pdf-response';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import {
  ApplyStandardDto,
  ApplyStandardResultDto,
  ChangeDto,
  ChangeQueryDto,
  ClearPreTripDto,
  CostRowDto,
  DueReportDto,
  ExpenseDto,
  ExpenseInputDto,
  ExpenseInsightsDto,
  ExpenseQueryDto,
  FleetInsightsDto,
  FleetSettingsDto,
  IdleRowDto,
  MileageRowDto,
  PreTripCheckDto,
  PreTripQueryDto,
  PreTripTodayRowDto,
  ReasonDto,
  ReimbursementRowDto,
  ReportName,
  REPORTS,
  ReportRangeDto,
  ScheduleDto,
  ScheduleInputDto,
  ScheduleQueryDto,
  SpendQueryDto,
  SpendRowDto,
  UpdateExpenseDto,
  UpdateFleetSettingsDto,
  UpdateScheduleDto,
  UpdateVehiclePlanDto,
  UpdateVendorDto,
  VehicleLogEntryDto,
  VehicleLogQueryDto,
  VehicleSummaryDto,
  VendorDto,
  VendorInputDto,
  VendorQueryDto,
} from './dto/fleet-maintenance.dto';
import { BusFilterDto } from './dto/fleet-ops.dto';
import { FleetBooksService } from './fleet-books.service';
import {
  costsTable,
  dueTables,
  idleTable,
  logTable,
  mileageTable,
  reimbursementTable,
  spendTable,
  workbook,
  XLSX,
} from './fleet-export';
import { FleetReportsService } from './fleet-reports.service';
import { FleetVendorsService } from './fleet-vendors.service';
import { MaintenanceSchedulesService } from './maintenance-schedules.service';
import { PreTripChecksService } from './pre-trip-checks.service';
import { VehicleExpensesService } from './vehicle-expenses.service';

const TAG = 'Admin · Fleet maintenance';

@ApiTags(TAG)
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/fleet/maintenance-settings')
export class FleetSettingsController {
  constructor(private readonly books: FleetBooksService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Maintenance settings: due-soon window, alert levels, idle burn, pre-trip rule and month lock',
  })
  @ApiEnvelope(FleetSettingsDto)
  get(@SchoolId() schoolId: number) {
    return this.books.view(schoolId);
  }

  @Patch()
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Settings saved')
  @ApiOperation({
    summary: 'Change maintenance settings or lock a closed month',
    description:
      'locked_until must be the last day of a month that has ended; fuel, expenses and closed tickets dated on or before it cannot be added, changed or deleted (409 MONTH_LOCKED). null unlocks. Every change is kept in the change history.',
  })
  @ApiEnvelope(FleetSettingsDto, { message: 'Settings saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  update(@SchoolId() schoolId: number, @Body() dto: UpdateFleetSettingsDto, @CurrentUser() actor: AuthUser) {
    return this.books.update(schoolId, dto, actor);
  }
}

@ApiTags(TAG)
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/fleet/changes')
export class FleetChangesController {
  constructor(private readonly books: FleetBooksService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Change history: every edit, delete, approval and pay-back of fuel, expenses, ticket costs and settings',
    description: 'Filters: entity (fuel, expense, ticket, settings), entity_id, vehicle_id. Newest first.',
  })
  @ApiEnvelope(ChangeDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  list(@SchoolId() schoolId: number, @Query() query: ChangeQueryDto) {
    return this.books.changes(schoolId, query);
  }
}

@ApiTags(TAG)
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@ApiParam({ name: 'id', description: 'The bus (vehicles.id)' })
@Controller('admin/fleet/vehicles/:id')
export class FleetVehicleController {
  constructor(
    private readonly books: FleetBooksService,
    private readonly reports: FleetReportsService,
  ) {}

  @Get('summary')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Header of the bus log: current km, next service, spend and km/l this month, budget, off-road',
    description:
      'odometer_source: tracker (GPS tracker reading), entries (highest km typed in fuel, service or checks) or none.',
  })
  @ApiEnvelope(VehicleSummaryDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  summary(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.reports.summary(schoolId, id);
  }

  @Get('log')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Everything that happened to a bus, newest first: fuel, services, repairs, expenses and pre-trip checks',
    description: 'Filters: type (fuel, service, repair, expense, check), from, to, search. order=asc for oldest first.',
  })
  @ApiEnvelope(VehicleLogEntryDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  log(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Query() query: VehicleLogQueryDto) {
    return this.reports.log(schoolId, id, query);
  }

  @Get('log/xlsx')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({ summary: 'Download the bus log as Excel (same filters, up to 5000 rows)' })
  @ApiFile(XLSX, 'Bus log')
  @ApiErrors(HttpStatus.NOT_FOUND)
  async logFile(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: VehicleLogQueryDto,
  ) {
    const bus = await this.books.bus(schoolId, id);
    const page = await this.reports.log(schoolId, id, Object.assign(query, { page: 1, limit: 5000 }));
    const range = `${query.from ?? 'Start'} to ${query.to ?? this.books.today()}`;
    return workbook(`bus-log-${bus.registration_no}`, [
      logTable(page.items, `${bus.name} (${bus.registration_no})`, range),
    ]);
  }

  @Patch('plan')
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Bus plan saved')
  @ApiOperation({
    summary: 'Set the fuel tank size and the monthly budget of a bus',
    description:
      'Fuel entries above the tank size are refused. When the month’s spend first goes over the budget, the office gets BUS_BUDGET_EXCEEDED.',
  })
  @ApiEnvelope(VehicleSummaryDto, { message: 'Bus plan saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  async plan(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateVehiclePlanDto) {
    await this.books.updatePlan(schoolId, id, dto);
    return this.reports.summary(schoolId, id);
  }
}

@ApiTags(TAG)
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/fleet/vendors')
export class FleetVendorsController {
  constructor(private readonly vendors: FleetVendorsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Saved garages and fuel stations with the total spent with each',
    description: 'Filters: kind (garage, fuel_station, other), active. search matches name, phone, GST and address.',
  })
  @ApiEnvelope(VendorDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  list(@SchoolId() schoolId: number, @Query() query: VendorQueryDto) {
    return this.vendors.list(schoolId, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Saved')
  @ApiOperation({ summary: 'Save a garage or fuel station (409 VENDOR_EXISTS for the same name and kind)' })
  @ApiEnvelope(VendorDto, { status: HttpStatus.CREATED, message: 'Saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  create(@SchoolId() schoolId: number, @Body() dto: VendorInputDto, @CurrentUser() actor: AuthUser) {
    return this.vendors.create(schoolId, dto, actor);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Saved')
  @ApiOperation({ summary: 'Edit or switch off a garage or fuel station' })
  @ApiEnvelope(VendorDto, { message: 'Saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  update(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateVendorDto) {
    return this.vendors.update(schoolId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Removed')
  @ApiOperation({ summary: 'Remove a garage or fuel station (old entries keep its name)' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  async remove(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.vendors.remove(schoolId, id);
    return null;
  }
}

@ApiTags(TAG)
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/fleet/schedules')
export class MaintenanceSchedulesController {
  constructor(private readonly schedules: MaintenanceSchedulesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Service rules of every bus with the next due date and km, most urgent first',
    description:
      'status: ok, due_soon (within the due-soon km or days of Maintenance settings) or overdue. Filters: vehicle_id, status, category, search (title, bus).',
  })
  @ApiEnvelope(ScheduleDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  list(@SchoolId() schoolId: number, @Query() query: ScheduleQueryDto) {
    return this.schedules.list(schoolId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({ summary: 'One service rule' })
  @ApiEnvelope(ScheduleDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.schedules.get(schoolId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Service rule added')
  @ApiOperation({
    summary: 'Add a service rule to one or more buses',
    description:
      'every_km, every_months or both (whichever comes first). last_done_on defaults to today and last_done_km to the bus’s current km. 409 SCHEDULE_EXISTS when a bus already has a rule for the category.',
  })
  @ApiEnvelope(ScheduleDto, { status: HttpStatus.CREATED, message: 'Service rule added', isArray: true })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  create(@SchoolId() schoolId: number, @Body() dto: ScheduleInputDto, @CurrentUser() actor: AuthUser) {
    return this.schedules.create(schoolId, dto, actor);
  }

  @Post('apply-standard')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Standard plan applied')
  @ApiOperation({
    summary:
      'Give buses the standard plan: engine oil 10,000 km or 6 months, tyres 15,000 km, brakes 3 months, general service 6 months',
    description: 'A bus that already has a rule for a category keeps it. Leave vehicle_ids out for every active bus.',
  })
  @ApiEnvelope(ApplyStandardResultDto, { message: 'Standard plan applied' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  applyStandard(@SchoolId() schoolId: number, @Body() dto: ApplyStandardDto, @CurrentUser() actor: AuthUser) {
    return this.schedules.applyStandard(schoolId, dto, actor);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Service rule updated')
  @ApiOperation({ summary: 'Edit a service rule or switch it off (is_active false)' })
  @ApiEnvelope(ScheduleDto, { message: 'Service rule updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  update(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateScheduleDto) {
    return this.schedules.update(schoolId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Service rule removed')
  @ApiOperation({ summary: 'Remove a service rule' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  async remove(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.schedules.remove(schoolId, id);
    return null;
  }
}

@ApiTags(TAG)
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/fleet/expenses')
export class VehicleExpensesController {
  constructor(private readonly expenses: VehicleExpensesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Other bus expenses (tyres, insurance, permit, tax, fines, toll, parking, cleaning…), newest first',
    description:
      'Filters: vehicle_id, category, payment_mode, reimbursed (driver-paid entries), from, to. search matches paid to, note, category and bus. sort: spent_on, amount, created_at.',
  })
  @ApiEnvelope(ExpenseDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  list(@SchoolId() schoolId: number, @Query() query: ExpenseQueryDto) {
    return this.expenses.list(schoolId, query);
  }

  @Get('insights')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({ summary: 'Expenses this month by category and driver-paid amounts not yet paid back' })
  @ApiEnvelope(ExpenseInsightsDto)
  insights(@SchoolId() schoolId: number, @Query() query: BusFilterDto) {
    return this.expenses.insights(schoolId, query.vehicle_id);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({ summary: 'One expense' })
  @ApiEnvelope(ExpenseDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.expenses.get(schoolId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Expense added')
  @ApiOperation({
    summary: 'Add an expense',
    description:
      'For a document renewal (category insurance, fitness, permit, puc, road_tax, rc, speed_governor, fire_extinguisher or first_aid) send renewed_until: the bus’s expiry in Vehicle Master is updated in the same step. spent_on cannot be in the future; 409 MONTH_LOCKED for a locked month.',
  })
  @ApiEnvelope(ExpenseDto, { status: HttpStatus.CREATED, message: 'Expense added' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  create(@SchoolId() schoolId: number, @Body() dto: ExpenseInputDto, @CurrentUser() actor: AuthUser) {
    return this.expenses.create(schoolId, dto, actor);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Expense updated')
  @ApiOperation({ summary: 'Edit an expense; the old values and the reason go to the change history' })
  @ApiEnvelope(ExpenseDto, { message: 'Expense updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  update(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateExpenseDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.expenses.update(schoolId, id, dto, actor);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Expense deleted')
  @ApiOperation({ summary: 'Delete an expense (kept in the change history with the reason)' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async remove(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ReasonDto,
    @CurrentUser() actor: AuthUser,
  ) {
    await this.expenses.remove(schoolId, id, actor, query.reason ?? null);
    return null;
  }

  @Post(':id/reimburse')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Marked as paid back')
  @ApiOperation({ summary: 'Mark a driver-paid expense as paid back (409 NOT_DRIVER_PAID, ALREADY_REIMBURSED)' })
  @ApiEnvelope(ExpenseDto, { message: 'Marked as paid back' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  reimburse(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthUser) {
    return this.expenses.reimburse(schoolId, id, actor);
  }
}

@ApiTags(TAG)
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/fleet/pre-trip-checks')
export class PreTripChecksController {
  constructor(private readonly checks: PreTripChecksService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Pre-trip checks done by drivers, newest first',
    description:
      'Filters: vehicle_id, date, state (ok, failed, blocked = critical item not OK and not cleared). search matches the bus.',
  })
  @ApiEnvelope(PreTripCheckDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  list(@SchoolId() schoolId: number, @Query() query: PreTripQueryDto) {
    return this.checks.list(schoolId, query);
  }

  @Get('today')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Every active bus with today’s check (null when not done yet) and whether it is off the road',
  })
  @ApiEnvelope(PreTripTodayRowDto, { isArray: true })
  today(@SchoolId() schoolId: number) {
    return this.checks.board(schoolId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({ summary: 'One pre-trip check' })
  @ApiEnvelope(PreTripCheckDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.checks.get(schoolId, id);
  }

  @Post(':id/clear')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Bus cleared to run')
  @ApiOperation({
    summary: 'Clear a check with a critical failure so the bus can run today (409 CHECK_NOT_BLOCKED)',
    description: 'Clear it after the problem is fixed or checked. The repair ticket stays open until it is closed.',
  })
  @ApiEnvelope(PreTripCheckDto, { message: 'Bus cleared to run' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  clear(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ClearPreTripDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.checks.clear(schoolId, id, dto.note, actor);
  }
}

@ApiTags(TAG)
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@RequirePermissions(PERMISSIONS.FLEET_VIEW)
@Controller('admin/fleet/reports')
export class FleetReportsController {
  constructor(
    private readonly reports: FleetReportsService,
    private readonly books: FleetBooksService,
  ) {}

  @Get('insights')
  @ApiOperation({
    summary:
      'Cards for the Maintenance page: spend this month, services due, km/l, off-road, approvals, blocked checks, pay-backs, over budget',
  })
  @ApiEnvelope(FleetInsightsDto)
  insights(@SchoolId() schoolId: number) {
    return this.reports.insights(schoolId);
  }

  @Get('costs')
  @ApiOperation({
    summary: 'Cost per bus by month: fuel, service, repair, other, total, km, cost per km and per seat, budget',
    description: 'from and to default to the academic year being viewed (X-Academic-Year-Id), up to today.',
  })
  @ApiEnvelope(CostRowDto, { isArray: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  costs(@SchoolId() schoolId: number, @Query() query: ReportRangeDto) {
    return this.reports.costs(schoolId, query);
  }

  @Get('mileage')
  @ApiOperation({ summary: 'km per litre of each bus by month against its normal, low months flagged' })
  @ApiEnvelope(MileageRowDto, { isArray: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  mileage(@SchoolId() schoolId: number, @Query() query: ReportRangeDto) {
    return this.reports.mileage(schoolId, query);
  }

  @Get('due')
  @ApiOperation({ summary: 'Services due soon or overdue, and documents expired or expiring in 30 days' })
  @ApiEnvelope(DueReportDto)
  due(@SchoolId() schoolId: number) {
    return this.reports.due(schoolId);
  }

  @Get('spend')
  @ApiOperation({ summary: 'Spend by category (default) or by garage and fuel station (group=vendor)' })
  @ApiEnvelope(SpendRowDto, { isArray: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  spend(@SchoolId() schoolId: number, @Query() query: SpendQueryDto) {
    return this.reports.spend(schoolId, query);
  }

  @Get('idle')
  @ApiOperation({
    summary: 'Estimated fuel lost to engine idling per bus, from the idle alerts',
    description:
      'litres = idle minutes ÷ 60 × idle_litres_per_hour (Maintenance settings); amount uses the bus’s average price per litre.',
  })
  @ApiEnvelope(IdleRowDto, { isArray: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  idle(@SchoolId() schoolId: number, @Query() query: ReportRangeDto) {
    return this.reports.idle(schoolId, query);
  }

  @Get('reimbursements')
  @ApiOperation({ summary: 'Fuel and expenses paid by drivers that are not yet paid back' })
  @ApiEnvelope(ReimbursementRowDto, { isArray: true })
  reimbursements(@SchoolId() schoolId: number) {
    return this.reports.reimbursements(schoolId);
  }

  @Get(':report/xlsx')
  @ApiParam({ name: 'report', enum: REPORTS })
  @ApiOperation({ summary: 'Download a report as Excel (same filters as the report)' })
  @ApiFile(XLSX, 'Fleet report')
  @ApiErrors(HttpStatus.BAD_REQUEST)
  async file(@SchoolId() schoolId: number, @Param('report') report: string, @Query() query: SpendQueryDto) {
    if (!REPORTS.includes(report as ReportName)) {
      throw AppException.badRequest(`report must be one of: ${REPORTS.join(', ')}`, 'UNKNOWN_REPORT');
    }
    const range = await this.reports.range(schoolId, query);
    const label = `${range.from} to ${range.to}`;
    const today = this.books.today();
    switch (report as ReportName) {
      case 'costs':
        return workbook(`bus-costs-${range.from}`, [costsTable(await this.reports.costs(schoolId, query), label)]);
      case 'mileage':
        return workbook(`bus-mileage-${range.from}`, [
          mileageTable(await this.reports.mileage(schoolId, query), label),
        ]);
      case 'due':
        return workbook(`bus-due-${today}`, dueTables(await this.reports.due(schoolId), today));
      case 'spend':
        return workbook(`bus-spend-${range.from}`, [
          spendTable(await this.reports.spend(schoolId, query), label, query.group ?? 'category'),
        ]);
      case 'idle': {
        const settings = await this.books.view(schoolId);
        return workbook(`bus-idle-${range.from}`, [
          idleTable(await this.reports.idle(schoolId, query), label, settings.idle_litres_per_hour),
        ]);
      }
      case 'reimbursements':
        return workbook(`to-pay-back-${today}`, [
          reimbursementTable(await this.reports.reimbursements(schoolId), today),
        ]);
    }
  }
}
