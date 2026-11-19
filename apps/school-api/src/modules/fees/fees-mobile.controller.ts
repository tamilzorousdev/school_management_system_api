import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AppException, AuthUser, CurrentUser, RequireRoles } from '@app/common';
import { ApiPdf, pdfFile } from '../../shared/pdf-response';
import { ROLES } from '../access/access.catalog';
import {
  CollectionResultDto,
  OnlinePaymentStartDto,
  OnlinePaymentVerifyDto,
  SectionFeesDto,
  StartedOrderDto,
  StudentFeesDto,
} from './dto/fees.dto';
import { FeesService } from './fees.service';
import { feesForParent } from './fee-views';
import { OnlinePaymentsService } from './online-payments.service';
import { TEACHER_MODULE_TAGS } from '../mobile/teacher-modules.catalog';
import { PARENT_MODULE_TAGS } from '../mobile/parent-modules.catalog';

const teacherSchool = (user: AuthUser): number => {
  if (!user.school_id) throw AppException.forbidden('Your account is not linked to a school', 'NO_SCHOOL');
  return user.school_id;
};

@ApiTags(TEACHER_MODULE_TAGS.MODULE_9)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND)
@RequireRoles(ROLES.TEACHER, ROLES.HOD, ROLES.PRINCIPAL)
@Controller('mobile/teacher')
export class MobileTeacherFeesController {
  constructor(private readonly fees: FeesService) {}

  @Get('sections/:id/fees')
  @ApiOperation({
    summary: 'Fee status of every student in my section (class teacher only, read-only)',
    description:
      'status is paid, partly_paid, due or overdue. Another teacher’s section returns 403 NOT_CLASS_TEACHER.',
  })
  @ApiEnvelope(SectionFeesDto)
  section(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.fees.sectionFees(teacherSchool(user), id, user.id);
  }

  @Get('students/:id/fees')
  @ApiOperation({
    summary: 'Fee summary of a student in my class-teacher section (read-only)',
    description:
      'Amounts, due dates and statuses only: concession names, reasons, waiting requests, payment references, notes and staff names are left out.',
  })
  @ApiEnvelope(StudentFeesDto)
  student(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.fees.teacherStudentFees(teacherSchool(user), id, user.id);
  }
}

@ApiTags(PARENT_MODULE_TAGS.MODULE_7)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND)
@RequireRoles(ROLES.PARENT)
@Controller('mobile/parent/children/:id/fees')
export class MobileParentFeesController {
  constructor(
    private readonly fees: FeesService,
    private readonly online: OnlinePaymentsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Fees of my child: status, balance, next due date, invoices with their lines and payments',
  })
  @ApiEnvelope(StudentFeesDto)
  async summary(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return feesForParent(await this.fees.summary(await this.fees.childSchool(user.id, id), id));
  }

  @Post('invoices/:invoiceId/pay-online')
  @ApiOperation({
    summary: 'Start paying an invoice online (Razorpay)',
    description:
      'Returns what the Razorpay checkout needs (key_id, order_id, amount_paise, prefill). After the checkout succeeds, send its three values to online-payments/verify. 503 ONLINE_PAYMENTS_OFF when the school has not switched online payment on.',
  })
  @ApiEnvelope(StartedOrderDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT, HttpStatus.SERVICE_UNAVAILABLE)
  payOnline(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('invoiceId', ParseIntPipe) invoiceId: number,
    @Body() dto: OnlinePaymentStartDto,
  ) {
    return this.online.start(user.id, id, invoiceId, dto);
  }

  @Post('online-payments/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm an online payment after the Razorpay checkout',
    description:
      'Checks the Razorpay signature and records the payment with receipts. Safe to send twice; the Razorpay webhook records it too if the app could not.',
  })
  @ApiEnvelope(CollectionResultDto)
  @ApiErrors(HttpStatus.BAD_REQUEST)
  verify(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: OnlinePaymentVerifyDto) {
    return this.online.verify(user.id, id, dto);
  }

  @Get('advance-receipts/:collectionId')
  @ApiOperation({ summary: 'Download the advance receipt PDF (collection_id from advances[] in the fee summary)' })
  @ApiPdf('Advance receipt PDF')
  async advanceReceipt(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('collectionId', ParseIntPipe) collectionId: number,
  ) {
    return pdfFile(await this.fees.advanceReceipt(await this.fees.childSchool(user.id, id), collectionId, id), true);
  }

  @Get('receipts/:paymentId')
  @ApiOperation({ summary: 'Download a receipt PDF of my child’s payment' })
  @ApiPdf('Fee receipt PDF')
  async receipt(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('paymentId', ParseIntPipe) paymentId: number,
  ) {
    return pdfFile(await this.fees.receipt(await this.fees.childSchool(user.id, id), paymentId, id), true);
  }
}
