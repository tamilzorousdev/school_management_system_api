import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiPdf, pdfFile } from '../../shared/pdf-response';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import {
  CancelInvoiceDto,
  CollectionResultDto,
  CopyPlanDto,
  CopyPlanResultDto,
  CopyYearDto,
  DiscountDto,
  FeeAuditLogDto,
  FeeAuditQueryDto,
  FeeHeadDto,
  FeeHeadInputDto,
  FeeHeadQueryDto,
  FeeInsightsDto,
  FeeInvoiceDetailDto,
  FeeInvoiceDto,
  FeePaymentDto,
  FeeRequestDto,
  FeePlanDto,
  FeePlanInputDto,
  FeePlanSummaryDto,
  FeePlanVersionDto,
  GenerateInvoicesDto,
  GenerateResultDto,
  InstallmentTotalDto,
  InvoiceQueryDto,
  PaymentInputDto,
  PaymentQueryDto,
  PaymentSummaryDto,
  PaymentSummaryQueryDto,
  ReconciliationDto,
  RefundInputDto,
  RescheduleInputDto,
  RejectPlanDto,
  ReminderRunDto,
  ReversePaymentDto,
  ReviewPlanDto,
  StudentFeesDto,
  SubmitPlanDto,
  UpdateFeeHeadDto,
  YearQueryDto,
} from './dto/fees.dto';
import { FeeRequestsService } from './fee-requests.service';
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
    private readonly requests: FeeRequestsService,
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
  @RequirePermissions(PERMISSIONS.FEES_CONFIGURE)
  @ResponseMessage('Fee head added')
  @ApiOperation({ summary: 'Add a fee head. Only one active head can be the transport head.' })
  @ApiEnvelope(FeeHeadDto, { status: HttpStatus.CREATED, message: 'Fee head added' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  createHead(@SchoolId() schoolId: number, @Body() dto: FeeHeadInputDto, @CurrentUser() actor: AuthUser) {
    return this.fees.createHead(schoolId, dto, actor);
  }

  @Patch('heads/:id')
  @RequirePermissions(PERMISSIONS.FEES_CONFIGURE)
  @ResponseMessage('Fee head saved')
  @ApiOperation({ summary: 'Rename, recode or switch a fee head on or off' })
  @ApiEnvelope(FeeHeadDto, { message: 'Fee head saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  updateHead(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFeeHeadDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.fees.updateHead(schoolId, id, dto, actor);
  }

  @Delete('heads/:id')
  @RequirePermissions(PERMISSIONS.FEES_CONFIGURE)
  @ResponseMessage('Fee head deleted')
  @ApiOperation({ summary: 'Delete a fee head that is on no plan or invoice (409 FEE_HEAD_IN_USE otherwise)' })
  @ApiEnvelope(undefined, { message: 'Fee head deleted' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async removeHead(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() actor: AuthUser,
  ) {
    await this.fees.removeHead(schoolId, id, actor);
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
  @RequirePermissions(PERMISSIONS.FEES_CONFIGURE)
  @ResponseMessage('Fee plan draft saved')
  @ApiOperation({
    summary: 'Save the draft of a class’s fee plan for the year',
    description:
      'Creates or replaces the draft. The published plan, and so invoices, change only when the draft is submitted and approved (409 PLAN_PENDING_APPROVAL while one is waiting). Lines of one installment share a due date inside the academic year. The transport head is not allowed: transport is charged from the bus stop.',
  })
  @ApiEnvelope(FeePlanDto, { message: 'Fee plan draft saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  setPlan(
    @SchoolId() schoolId: number,
    @Param('classId', ParseIntPipe) classId: number,
    @Body() dto: FeePlanInputDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.fees.setPlan(schoolId, classId, dto, actor);
  }

  @Post('plans/copy-year')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FEES_CONFIGURE)
  @ResponseMessage('Plans copied as drafts')
  @ApiOperation({
    summary: 'Copy last year’s plans into this year as drafts',
    description:
      'Every class with a plan in use in from_academic_year_id gets a draft in the target year, due dates moved by the difference in years and kept inside the target year. Classes that already have a draft or a change waiting are skipped. Drafts still need approval.',
  })
  @ApiEnvelope(CopyPlanResultDto, { message: 'Plans copied as drafts' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  copyYear(@SchoolId() schoolId: number, @Body() dto: CopyYearDto, @CurrentUser() actor: AuthUser) {
    return this.fees.copyYear(schoolId, dto, actor);
  }

  @Post('plans/:classId/copy')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FEES_CONFIGURE)
  @ResponseMessage('Plan copied as drafts')
  @ApiOperation({
    summary: 'Copy a class’s plan in use to other classes as drafts',
    description:
      'Heads that are switched off, transport, or not for the target class are left out. Classes that already have a draft or a change waiting are skipped. Drafts still need approval.',
  })
  @ApiEnvelope(CopyPlanResultDto, { message: 'Plan copied as drafts' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  copyPlan(
    @SchoolId() schoolId: number,
    @Param('classId', ParseIntPipe) classId: number,
    @Body() dto: CopyPlanDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.fees.copyPlan(schoolId, classId, dto, actor);
  }

  @Get('plans/:classId/versions')
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiOperation({ summary: 'Every version of a class’s fee plan for the year, newest first' })
  @ApiEnvelope(FeePlanVersionDto, { isArray: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  planVersions(
    @SchoolId() schoolId: number,
    @Param('classId', ParseIntPipe) classId: number,
    @Query() query: YearQueryDto,
  ) {
    return this.fees.planVersions(schoolId, classId, query.academic_year_id);
  }

  @Delete('plans/:classId/draft')
  @RequirePermissions(PERMISSIONS.FEES_CONFIGURE)
  @ResponseMessage('Draft discarded')
  @ApiOperation({ summary: 'Throw away the draft. A change waiting for approval must be sent back first.' })
  @ApiEnvelope(FeePlanDto, { message: 'Draft discarded' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  discardPlanDraft(
    @SchoolId() schoolId: number,
    @Param('classId', ParseIntPipe) classId: number,
    @Query() query: YearQueryDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.fees.discardPlanDraft(schoolId, classId, actor, query.academic_year_id);
  }

  @Post('plans/:classId/submit')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FEES_CONFIGURE)
  @ResponseMessage('Sent for approval')
  @ApiOperation({ summary: 'Send the draft for approval. It cannot be edited while it waits.' })
  @ApiEnvelope(FeePlanDto, { message: 'Sent for approval' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  submitPlan(
    @SchoolId() schoolId: number,
    @Param('classId', ParseIntPipe) classId: number,
    @Query() query: YearQueryDto,
    @Body() dto: SubmitPlanDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.fees.submitPlan(schoolId, classId, dto, actor, query.academic_year_id);
  }

  @Post('plans/:classId/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FEES_APPROVE)
  @ResponseMessage('Fee plan approved')
  @ApiOperation({
    summary: 'Approve the waiting change and publish it',
    description:
      'The approved lines become the class’s fee plan, used for invoices raised from now on; the previous version is kept as superseded. The person who sent it cannot approve it (403 SELF_APPROVAL). Invoices already raised keep their amounts.',
  })
  @ApiEnvelope(FeePlanDto, { message: 'Fee plan approved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  approvePlan(
    @SchoolId() schoolId: number,
    @Param('classId', ParseIntPipe) classId: number,
    @Query() query: YearQueryDto,
    @Body() dto: ReviewPlanDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.fees.approvePlan(schoolId, classId, dto, actor, query.academic_year_id);
  }

  @Post('plans/:classId/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FEES_APPROVE)
  @ResponseMessage('Sent back as a draft')
  @ApiOperation({ summary: 'Send the waiting change back as a draft, with the reason' })
  @ApiEnvelope(FeePlanDto, { message: 'Sent back as a draft' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  rejectPlan(
    @SchoolId() schoolId: number,
    @Param('classId', ParseIntPipe) classId: number,
    @Query() query: YearQueryDto,
    @Body() dto: RejectPlanDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.fees.rejectPlan(schoolId, classId, dto, actor, query.academic_year_id);
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
  @RequirePermissions(PERMISSIONS.FEES_ASSIGN)
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
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(PERMISSIONS.FEES_ADJUST)
  @ResponseMessage('Sent for approval')
  @ApiOperation({
    summary: 'Ask for a discount on an invoice (needs approval)',
    description:
      'Creates a pending request; the invoice changes only when someone with fees.approve approves it (POST /admin/fees/requests/{id}/approve). discount is the new total discount (0 removes it) and cannot bring the total below what is paid. 409 REQUEST_PENDING if one is already waiting.',
  })
  @ApiEnvelope(FeeRequestDto, { status: HttpStatus.ACCEPTED, message: 'Sent for approval' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  discount(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DiscountDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.requests.requestDiscount(schoolId, id, dto, actor);
  }

  @Post('invoices/:id/cancel')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(PERMISSIONS.FEES_ADJUST)
  @ResponseMessage('Sent for approval')
  @ApiOperation({
    summary: 'Ask to cancel an invoice with no payments (needs approval)',
    description:
      '409 INVOICE_HAS_PAYMENTS if a payment is recorded. The invoice is cancelled when the request is approved.',
  })
  @ApiEnvelope(FeeRequestDto, { status: HttpStatus.ACCEPTED, message: 'Sent for approval' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  cancel(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CancelInvoiceDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.requests.requestCancel(schoolId, id, dto, actor);
  }

  @Post('invoices/:id/write-off')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(PERMISSIONS.FEES_ADJUST)
  @ResponseMessage('Sent for approval')
  @ApiOperation({
    summary: 'Ask to write off the unpaid balance of an invoice (needs approval)',
    description:
      'For dues that will not be collected, for example after a TC. On approval the balance is added to the discount with “Written off: <reason>”, so the invoice becomes paid. 409 INVOICE_PAID or REQUEST_PENDING.',
  })
  @ApiEnvelope(FeeRequestDto, { status: HttpStatus.ACCEPTED, message: 'Sent for approval' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  writeOff(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CancelInvoiceDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.requests.requestWriteOff(schoolId, id, dto, actor);
  }

  @Post('invoices/:id/reschedule')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(PERMISSIONS.FEES_ADJUST)
  @ResponseMessage('Sent for approval')
  @ApiOperation({
    summary: 'Ask to move an invoice’s due date (needs approval)',
    description:
      'The new date must be inside the invoice’s academic year. On approval the due date changes, original_due_date keeps the first one, and the parent is told. 409 INVOICE_PAID, INVOICE_CANCELLED or REQUEST_PENDING.',
  })
  @ApiEnvelope(FeeRequestDto, { status: HttpStatus.ACCEPTED, message: 'Sent for approval' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  reschedule(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RescheduleInputDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.requests.requestReschedule(schoolId, id, dto, actor);
  }

  @Post('invoices/:id/refunds')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(PERMISSIONS.FEES_ADJUST)
  @ResponseMessage('Sent for approval')
  @ApiOperation({
    summary: 'Ask to refund money on an invoice (needs approval)',
    description:
      'Only the paid amount of refundable fee heads, less earlier refunds (409 NOTHING_TO_REFUND, 400 REFUND_TOO_HIGH). On approval a refund with its own number is recorded; the invoice keeps what was paid and shows refunded.',
  })
  @ApiEnvelope(FeeRequestDto, { status: HttpStatus.ACCEPTED, message: 'Sent for approval' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  refund(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RefundInputDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.requests.requestRefund(schoolId, id, dto, actor);
  }

  @Post('students/:studentId/payments')
  @RequirePermissions(PERMISSIONS.FEES_COLLECT)
  @ResponseMessage('Payment recorded')
  @ApiOperation({
    summary: 'Record one payment for a student across invoices',
    description:
      'Pays the student’s unpaid invoices oldest due date first (earlier years included, archived years left out), one receipt per invoice. Anything left over is kept as advance credit with its own receipt number and is used automatically on the next invoices raised. Send an Idempotency-Key so a retry returns the first result.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Same rules as for invoice payments' })
  @ApiEnvelope(CollectionResultDto, { status: HttpStatus.CREATED, message: 'Payment recorded' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  collect(
    @SchoolId() schoolId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Body() dto: PaymentInputDto,
    @CurrentUser() actor: AuthUser,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.fees.collect(schoolId, studentId, dto, idempotencyKey, actor);
  }

  @Post('students/:studentId/apply-credit')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FEES_COLLECT)
  @ResponseMessage('Advance credit used')
  @ApiOperation({ summary: 'Use the student’s advance credit on unpaid invoices now, oldest first' })
  @ApiEnvelope(CollectionResultDto, { message: 'Advance credit used' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  applyCredit(
    @SchoolId() schoolId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.fees.applyCreditNow(schoolId, studentId, actor);
  }

  @Post('invoices/:id/payments')
  @RequirePermissions(PERMISSIONS.FEES_COLLECT)
  @ResponseMessage('Payment recorded')
  @ApiOperation({
    summary: 'Record a payment and issue a receipt',
    description:
      'paid_on defaults to today. More than the balance is refused with 400 PAYMENT_EXCEEDS_BALANCE. Send an Idempotency-Key (one per payment form) so a retry or double click returns the first payment instead of recording it twice; the same key with another invoice or amount is refused with 409 IDEMPOTENCY_CONFLICT.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: '8 to 80 letters, digits, _ . : or -, for example a UUID made when the payment form opens',
  })
  @ApiEnvelope(FeePaymentDto, { status: HttpStatus.CREATED, message: 'Payment recorded' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  pay(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PaymentInputDto,
    @CurrentUser() actor: AuthUser,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.fees.pay(schoolId, id, dto, actor, idempotencyKey);
  }

  @Get('payments')
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiOperation({
    summary: 'Collections',
    description:
      'search: student name, admission no., receipt no., invoice no., reference. sort: paid_on, amount, receipt_no, created_at. Reversed payments are listed with status reversed; filter with status.',
  })
  @ApiEnvelope(FeePaymentDto, { paginated: true })
  payments(@SchoolId() schoolId: number, @Query() query: PaymentQueryDto) {
    return this.fees.listPayments(schoolId, query);
  }

  @Get('payments/summary')
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiOperation({
    summary:
      'Total collected for the same filters as the collections list, by payment mode (reversed payments left out)',
  })
  @ApiEnvelope(PaymentSummaryDto)
  paymentSummary(@SchoolId() schoolId: number, @Query() query: PaymentSummaryQueryDto) {
    return this.fees.paymentSummary(schoolId, query);
  }

  @Get('payments/:id/receipt')
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiOperation({ summary: 'Receipt PDF with the amount in words; a reversed payment is marked REVERSED' })
  @ApiPdf('Fee receipt PDF')
  @ApiErrors(HttpStatus.NOT_FOUND)
  async receipt(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return pdfFile(await this.fees.receipt(schoolId, id));
  }

  @Get('collections/:id/advance-receipt')
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiOperation({
    summary: 'Advance receipt PDF for the part of a payment kept as advance credit',
    description: 'id is collection_id from POST students/{id}/payments or advances[] in the student fee summary.',
  })
  @ApiPdf('Advance receipt PDF')
  @ApiErrors(HttpStatus.NOT_FOUND)
  async advanceReceipt(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return pdfFile(await this.fees.advanceReceipt(schoolId, id));
  }

  @Post('payments/:id/reverse')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(PERMISSIONS.FEES_ADJUST)
  @ResponseMessage('Sent for approval')
  @ApiOperation({
    summary: 'Ask to reverse a recorded payment (needs approval)',
    description:
      'For a bounced cheque or a payment entered by mistake. On approval the payment stays on record with status reversed and the invoice balance goes back up. 409 PAYMENT_ALREADY_REVERSED or REQUEST_PENDING.',
  })
  @ApiEnvelope(FeeRequestDto, { status: HttpStatus.ACCEPTED, message: 'Sent for approval' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  reverse(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReversePaymentDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.requests.requestReversal(schoolId, id, dto, actor);
  }

  @Get('audit-logs')
  @RequirePermissions(PERMISSIONS.FEES_AUDIT)
  @ApiOperation({
    summary: 'Fee audit log: every change to heads, plans, invoices and payments with the values before and after',
    description:
      'Newest first. Filter by entity (fee_head, fee_plan, fee_invoice, fee_payment, invoice_run), entity_id (class id for fee_plan), action, user_id, from, to. search: reason, user name.',
  })
  @ApiEnvelope(FeeAuditLogDto, { paginated: true })
  auditLogs(@SchoolId() schoolId: number, @Query() query: FeeAuditQueryDto) {
    return this.fees.listAuditLogs(schoolId, query);
  }

  @Get('reconciliation')
  @RequirePermissions(PERMISSIONS.FEES_AUDIT)
  @ApiOperation({
    summary: 'Balance check: invoices whose paid, total or balance do not match their payments',
    description: 'Read only; nothing is fixed automatically. The same check runs every night at 02:30.',
  })
  @ApiEnvelope(ReconciliationDto)
  reconciliation(@SchoolId() schoolId: number) {
    return this.fees.reconciliation(schoolId);
  }

  @Post('overdue-reminders')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FEES_COLLECT)
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
