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
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiPdf, pdfFile } from '../../shared/pdf-response';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import {
  CancelInvoiceDto,
  DiscountDto,
  FeeHeadDto,
  FeeHeadInputDto,
  FeeHeadQueryDto,
  FeeInsightsDto,
  FeeInvoiceDetailDto,
  FeeInvoiceDto,
  FeePaymentDto,
  FeePlanDto,
  FeePlanInputDto,
  FeePlanSummaryDto,
  GenerateInvoicesDto,
  GenerateResultDto,
  InstallmentTotalDto,
  InvoiceQueryDto,
  PaymentInputDto,
  PaymentQueryDto,
  PaymentSummaryDto,
  PaymentSummaryQueryDto,
  ReminderRunDto,
  StudentFeesDto,
  UpdateFeeHeadDto,
  YearQueryDto,
} from './dto/fees.dto';
import { FeesService } from './fees.service';
import { TransportFeesReportService } from './transport-fees-report.service';
import {
  TransportFeeQueryDto,
  TransportFeeRowDto,
  TransportFeeSummaryDto,
  TransportFeeSummaryQueryDto,
} from './dto/transport-fees.dto';

@ApiTags('Admin · Fees')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/fees')
export class FeesController {
  constructor(
    private readonly fees: FeesService,
    private readonly transportFees: TransportFeesReportService,
  ) {}

  @Get('transport/summary')
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiOperation({
    summary: 'Bus fee billed, collected, pending and overdue this year, route-wise with each stop',
    description:
      'Collected is the bus line’s share of what was paid on each invoice (amount × paid ÷ gross). Bus-change adjustments count to the student’s current stop.',
  })
  @ApiEnvelope(TransportFeeSummaryDto)
  transportSummary(@SchoolId() schoolId: number, @Query() query: TransportFeeSummaryQueryDto) {
    return this.transportFees.summary(schoolId, query);
  }

  @Get('transport')
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiOperation({
    summary: 'Students on the bus with their bus fee: billed, paid, pending, next due and status',
    description:
      'stop_id matches the pickup or drop stop. status: paid, pending, overdue, not_billed. sort: name, pending, billed.',
  })
  @ApiEnvelope(TransportFeeRowDto, { paginated: true })
  transportStudents(@SchoolId() schoolId: number, @Query() query: TransportFeeQueryDto) {
    return this.transportFees.students(schoolId, query);
  }

  @Get('insights')
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiOperation({ summary: 'Dues cards for the current year: billed, collected, outstanding, overdue, today' })
  @ApiEnvelope(FeeInsightsDto)
  insights(@SchoolId() schoolId: number) {
    return this.fees.insights(schoolId);
  }

  @Get('heads')
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiOperation({
    summary: 'Fee heads such as tuition, books and transport. search: name, code. sort: name, code, created_at.',
  })
  @ApiEnvelope(FeeHeadDto, { paginated: true })
  heads(@SchoolId() schoolId: number, @Query() query: FeeHeadQueryDto) {
    return this.fees.listHeads(schoolId, query);
  }

  @Post('heads')
  @RequirePermissions(PERMISSIONS.FEES_MANAGE)
  @ResponseMessage('Fee head added')
  @ApiOperation({ summary: 'Add a fee head. Only one active head can be the transport head.' })
  @ApiEnvelope(FeeHeadDto, { status: HttpStatus.CREATED, message: 'Fee head added' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  createHead(@SchoolId() schoolId: number, @Body() dto: FeeHeadInputDto) {
    return this.fees.createHead(schoolId, dto);
  }

  @Patch('heads/:id')
  @RequirePermissions(PERMISSIONS.FEES_MANAGE)
  @ResponseMessage('Fee head saved')
  @ApiOperation({ summary: 'Rename, recode or switch a fee head on or off' })
  @ApiEnvelope(FeeHeadDto, { message: 'Fee head saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  updateHead(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateFeeHeadDto) {
    return this.fees.updateHead(schoolId, id, dto);
  }

  @Delete('heads/:id')
  @RequirePermissions(PERMISSIONS.FEES_MANAGE)
  @ResponseMessage('Fee head deleted')
  @ApiOperation({ summary: 'Delete a fee head that is on no plan or invoice (409 FEE_HEAD_IN_USE otherwise)' })
  @ApiEnvelope(undefined, { message: 'Fee head deleted' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async removeHead(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.fees.removeHead(schoolId, id);
    return null;
  }

  @Get('plans')
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiOperation({ summary: 'Every class with its installments and year total (without transport)' })
  @ApiEnvelope(FeePlanSummaryDto, { isArray: true })
  plans(@SchoolId() schoolId: number, @Query() query: YearQueryDto) {
    return this.fees.planSummaries(schoolId, query.academic_year_id);
  }

  @Get('plans/:classId')
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiOperation({ summary: 'Fee plan of one class: a line per head and installment with amount and due date' })
  @ApiEnvelope(FeePlanDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  plan(@SchoolId() schoolId: number, @Param('classId', ParseIntPipe) classId: number, @Query() query: YearQueryDto) {
    return this.fees.getPlan(schoolId, classId, query.academic_year_id);
  }

  @Put('plans/:classId')
  @RequirePermissions(PERMISSIONS.FEES_MANAGE)
  @ResponseMessage('Fee plan saved')
  @ApiOperation({
    summary: 'Replace the fee plan of a class for the year',
    description:
      'Lines of one installment share a due date inside the academic year. The transport head is not allowed: transport is charged from the bus stop. Invoices already raised keep their amounts.',
  })
  @ApiEnvelope(FeePlanDto, { message: 'Fee plan saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  setPlan(@SchoolId() schoolId: number, @Param('classId', ParseIntPipe) classId: number, @Body() dto: FeePlanInputDto) {
    return this.fees.setPlan(schoolId, classId, dto);
  }

  @Get('installments')
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiOperation({ summary: 'Installments used this year in plans and invoices, by due date, with the billed amount' })
  @ApiEnvelope(InstallmentTotalDto, { isArray: true })
  installments(@SchoolId() schoolId: number, @Query() query: YearQueryDto) {
    return this.fees.installments(schoolId, query.academic_year_id);
  }

  @Post('invoices/generate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FEES_MANAGE)
  @ResponseMessage('Invoices generated')
  @ApiOperation({
    summary: 'Raise invoices for an installment',
    description:
      'Bills every active student of the class (or of every class whose plan has the installment) who has no invoice for it yet, so running it again is safe. due_date defaults to the plan. Students on the bus get a transport line: stop monthly fee × months since the previous installment’s due date (the year start for the first), at least 1. Parents get FEE_DUE.',
  })
  @ApiEnvelope(GenerateResultDto, { message: 'Invoices generated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  generate(@SchoolId() schoolId: number, @Body() dto: GenerateInvoicesDto, @CurrentUser() actor: AuthUser) {
    return this.fees.generate(schoolId, dto, actor);
  }

  @Get('invoices')
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiOperation({
    summary: 'Invoices this year',
    description:
      'search: student name, admission no., invoice no. Cancelled invoices are left out unless status=cancelled. sort: due_date, invoice_no, balance, total, student, created_at.',
  })
  @ApiEnvelope(FeeInvoiceDto, { paginated: true })
  invoices(@SchoolId() schoolId: number, @Query() query: InvoiceQueryDto) {
    return this.fees.listInvoices(schoolId, query);
  }

  @Get('invoices/:id')
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiOperation({ summary: 'Invoice with its lines and payments' })
  @ApiEnvelope(FeeInvoiceDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  invoice(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.fees.getInvoice(schoolId, id);
  }

  @Patch('invoices/:id/discount')
  @RequirePermissions(PERMISSIONS.FEES_MANAGE)
  @ResponseMessage('Discount saved')
  @ApiOperation({ summary: 'Set a concession on an invoice. It cannot bring the total below what is paid.' })
  @ApiEnvelope(FeeInvoiceDetailDto, { message: 'Discount saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  discount(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: DiscountDto) {
    return this.fees.setDiscount(schoolId, id, dto);
  }

  @Post('invoices/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FEES_MANAGE)
  @ResponseMessage('Invoice cancelled')
  @ApiOperation({ summary: 'Cancel an invoice with no payments (409 INVOICE_HAS_PAYMENTS otherwise)' })
  @ApiEnvelope(FeeInvoiceDetailDto, { message: 'Invoice cancelled' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  cancel(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CancelInvoiceDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.fees.cancel(schoolId, id, dto, actor);
  }

  @Post('invoices/:id/payments')
  @RequirePermissions(PERMISSIONS.FEES_MANAGE)
  @ResponseMessage('Payment recorded')
  @ApiOperation({
    summary: 'Record a payment and issue a receipt',
    description: 'paid_on defaults to today. More than the balance is refused with 400 PAYMENT_EXCEEDS_BALANCE.',
  })
  @ApiEnvelope(FeePaymentDto, { status: HttpStatus.CREATED, message: 'Payment recorded' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  pay(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PaymentInputDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.fees.pay(schoolId, id, dto, actor);
  }

  @Get('payments')
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiOperation({
    summary: 'Collections',
    description:
      'search: student name, admission no., receipt no., invoice no., reference. sort: paid_on, amount, receipt_no, created_at.',
  })
  @ApiEnvelope(FeePaymentDto, { paginated: true })
  payments(@SchoolId() schoolId: number, @Query() query: PaymentQueryDto) {
    return this.fees.listPayments(schoolId, query);
  }

  @Get('payments/summary')
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiOperation({ summary: 'Total collected for the same filters as the collections list, by payment mode' })
  @ApiEnvelope(PaymentSummaryDto)
  paymentSummary(@SchoolId() schoolId: number, @Query() query: PaymentSummaryQueryDto) {
    return this.fees.paymentSummary(schoolId, query);
  }

  @Get('payments/:id/receipt')
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiOperation({ summary: 'Receipt PDF with the amount in words' })
  @ApiPdf('Fee receipt PDF')
  @ApiErrors(HttpStatus.NOT_FOUND)
  async receipt(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return pdfFile(await this.fees.receipt(schoolId, id));
  }

  @Post('overdue-reminders')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FEES_MANAGE)
  @ResponseMessage('Reminders sent')
  @ApiOperation({
    summary: 'Send FEE_OVERDUE to parents now',
    description: 'The same check runs every day at 08:00. Each overdue invoice is reminded at most once in 7 days.',
  })
  @ApiEnvelope(ReminderRunDto, { message: 'Reminders sent' })
  async overdueReminders(@SchoolId() schoolId: number) {
    return { sent: await this.fees.sendOverdueReminders(schoolId) };
  }
}

@ApiTags('Admin · Fees')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/students')
export class StudentFeesController {
  constructor(private readonly fees: FeesService) {}

  @Get(':id/fees')
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiOperation({ summary: 'Student fee summary: status, totals, next due date, invoices and payments' })
  @ApiEnvelope(StudentFeesDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  studentFees(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.fees.summary(schoolId, id);
  }
}
