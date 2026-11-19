import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiFile, ApiPdf, pdfFile } from '../../shared/pdf-response';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import { XLSX } from '../attendance/attendance-export';
import { FeeReportDto } from '../fees/dto/fees.dto';
import { feeReportFile } from '../fees/fee-reports.export';
import { AccountsReportsService } from './accounts-reports.service';
import { AccountsService } from './accounts.service';
import {
  ACCOUNT_REPORT_TYPES,
  AccountInsightsDto,
  AccountReportQueryDto,
  AccountReportType,
  CategoryDto,
  CategoryInputDto,
  CategoryQueryDto,
  DecisionDto,
  EntryDto,
  EntryInputDto,
  EntryQueryDto,
  UpdateCategoryDto,
  UpdateEntryDto,
  VoidEntryDto,
} from './dto/accounts.dto';

const TAG = 'Admin · Accounts';
const REPORT_TYPES = Object.fromEntries(ACCOUNT_REPORT_TYPES.map((type) => [type, type])) as Record<
  AccountReportType,
  AccountReportType
>;

@ApiTags(TAG)
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/accounts/categories')
export class AccountCategoriesController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ACCOUNTS_VIEW)
  @ApiOperation({
    summary: 'Expense and income categories',
    description:
      'A school starts with a standard list (electricity, stationery, donations, uniform sales…). Switched-off categories are left out unless include_inactive=true.',
  })
  @ApiEnvelope(CategoryDto, { isArray: true })
  list(@SchoolId() schoolId: number, @Query() query: CategoryQueryDto) {
    return this.accounts.listCategories(schoolId, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ACCOUNTS_APPROVE)
  @ResponseMessage('Category added')
  @ApiOperation({ summary: 'Add a category (409 CATEGORY_EXISTS)' })
  @ApiEnvelope(CategoryDto, { status: HttpStatus.CREATED, message: 'Category added' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  create(@SchoolId() schoolId: number, @Body() dto: CategoryInputDto) {
    return this.accounts.createCategory(schoolId, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.ACCOUNTS_APPROVE)
  @ResponseMessage('Category updated')
  @ApiOperation({ summary: 'Rename a category or switch it on or off' })
  @ApiEnvelope(CategoryDto, { message: 'Category updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  update(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCategoryDto) {
    return this.accounts.updateCategory(schoolId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.ACCOUNTS_APPROVE)
  @ResponseMessage('Category deleted')
  @ApiOperation({ summary: 'Delete an unused category (409 CATEGORY_IN_USE: switch it off instead)' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async remove(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.accounts.removeCategory(schoolId, id);
    return null;
  }
}

@ApiTags(TAG)
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/accounts/reports')
export class AccountReportsController {
  constructor(
    private readonly reports: AccountsReportsService,
    private readonly dataSource: DataSource,
  ) {}

  @Get(':type')
  @RequirePermissions(PERMISSIONS.ACCOUNTS_VIEW)
  @ApiParam({ name: 'type', enum: ACCOUNT_REPORT_TYPES })
  @ApiOperation({
    summary: 'Income and expense report: columns, rows and a totals row',
    description:
      'monthly: per month, fees (less refunds), library fines, other income, school expenses, bus fuel and expenses, salaries (only with payroll.view) and the surplus. categories: the same split by category with each one’s share. register: every approved entry (kind filters). from and to default to the academic year start and today.',
  })
  @ApiEnvelope(FeeReportDto)
  @ApiErrors(HttpStatus.BAD_REQUEST)
  report(
    @SchoolId() schoolId: number,
    @Param('type', new ParseEnumPipe(REPORT_TYPES)) type: AccountReportType,
    @Query() query: AccountReportQueryDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.reports.report(schoolId, type, query, actor);
  }

  @Get(':type/xlsx')
  @RequirePermissions(PERMISSIONS.ACCOUNTS_VIEW)
  @ApiParam({ name: 'type', enum: ACCOUNT_REPORT_TYPES })
  @ApiOperation({ summary: 'Download an income and expense report as Excel (same filters as the report)' })
  @ApiFile(XLSX, 'Income and expense report')
  @ApiErrors(HttpStatus.BAD_REQUEST)
  async file(
    @SchoolId() schoolId: number,
    @Param('type', new ParseEnumPipe(REPORT_TYPES)) type: AccountReportType,
    @Query() query: AccountReportQueryDto,
    @CurrentUser() actor: AuthUser,
  ) {
    const report = await this.reports.report(schoolId, type, query, actor);
    const [school] = await this.dataSource.query(`SELECT name FROM schools WHERE id = $1`, [schoolId]);
    return feeReportFile(report, school?.name ?? 'School');
  }
}

@ApiTags(TAG)
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/accounts/entries')
export class AccountEntriesController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ACCOUNTS_VIEW)
  @ApiOperation({
    summary: 'School expenses and other income, newest first',
    description:
      'Filters: kind, status, category_id, payment_mode, from, to. search matches entry no., paid to / received from, reference, note and category. sort: entry_date, amount, created_at, entry_no.',
  })
  @ApiEnvelope(EntryDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  list(@SchoolId() schoolId: number, @Query() query: EntryQueryDto, @CurrentUser() actor: AuthUser) {
    return this.accounts.list(schoolId, query, actor);
  }

  @Get('insights')
  @RequirePermissions(PERMISSIONS.ACCOUNTS_VIEW)
  @ApiOperation({ summary: 'This month’s approved income and expenses by category, and entries waiting for approval' })
  @ApiEnvelope(AccountInsightsDto)
  insights(@SchoolId() schoolId: number) {
    return this.accounts.insights(schoolId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.ACCOUNTS_VIEW)
  @ApiOperation({ summary: 'One entry' })
  @ApiEnvelope(EntryDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthUser) {
    return this.accounts.get(schoolId, id, actor);
  }

  @Get(':id/voucher')
  @RequirePermissions(PERMISSIONS.ACCOUNTS_VIEW)
  @ApiOperation({ summary: 'Payment voucher (expense) or income receipt PDF, with the amount in words' })
  @ApiPdf('Voucher PDF')
  @ApiErrors(HttpStatus.NOT_FOUND)
  async voucher(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return pdfFile(await this.accounts.voucher(schoolId, id));
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ACCOUNTS_MANAGE)
  @ResponseMessage('Entry added')
  @ApiOperation({
    summary: 'Add an expense or other income',
    description:
      'Entries from someone with accounts.approve are approved at once; others wait for approval and are not counted in reports until then. entry_date cannot be in the future. The entry no. (SCH-EXP-2026-0001 / SCH-INC-2026-0001) is given by the server.',
  })
  @ApiEnvelope(EntryDto, { status: HttpStatus.CREATED, message: 'Entry added' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  create(@SchoolId() schoolId: number, @Body() dto: EntryInputDto, @CurrentUser() actor: AuthUser) {
    return this.accounts.create(schoolId, dto, actor);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.ACCOUNTS_MANAGE)
  @ResponseMessage('Entry updated')
  @ApiOperation({
    summary: 'Edit an entry waiting for approval (by who added it or an approver)',
    description: '409 ENTRY_LOCKED once decided: void an approved entry and add a new one. 403 NOT_ENTRY_OWNER.',
  })
  @ApiEnvelope(EntryDto, { message: 'Entry updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  update(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEntryDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.accounts.update(schoolId, id, dto, actor);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.ACCOUNTS_MANAGE)
  @ResponseMessage('Entry deleted')
  @ApiOperation({ summary: 'Delete a pending or rejected entry (409 ENTRY_LOCKED for an approved one: void it)' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async remove(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthUser) {
    await this.accounts.remove(schoolId, id, actor);
    return null;
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.ACCOUNTS_APPROVE)
  @ResponseMessage('Entry approved')
  @ApiOperation({ summary: 'Approve a pending entry (409 ENTRY_ALREADY_DECIDED)' })
  @ApiEnvelope(EntryDto, { message: 'Entry approved' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  approve(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DecisionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.accounts.approve(schoolId, id, dto, actor);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.ACCOUNTS_APPROVE)
  @ResponseMessage('Entry rejected')
  @ApiOperation({ summary: 'Reject a pending entry with an optional note (409 ENTRY_ALREADY_DECIDED)' })
  @ApiEnvelope(EntryDto, { message: 'Entry rejected' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  reject(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DecisionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.accounts.reject(schoolId, id, dto, actor);
  }

  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.ACCOUNTS_APPROVE)
  @ResponseMessage('Entry voided')
  @ApiOperation({
    summary: 'Void an approved entry with a reason; it stays on record but leaves the reports (409 ENTRY_NOT_APPROVED)',
  })
  @ApiEnvelope(EntryDto, { message: 'Entry voided' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  voidEntry(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: VoidEntryDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.accounts.void(schoolId, id, dto, actor);
  }
}
