import { Body, Controller, Get, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import { CanteenBillingService } from './canteen-billing.service';
import {
  PaymentDto,
  PaymentLedgerDto,
  PaymentQueryDto,
  PaymentSummaryDto,
  PaymentSummaryQueryDto,
  PayOrderDto,
  ReceiptDto,
  RefundOrderDto,
} from './dto/canteen-sales.dto';

const P = PERMISSIONS;

@ApiTags('Admin · Canteen billing')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/canteen')
export class CanteenBillingController {
  constructor(private readonly billing: CanteenBillingService) {}

  @Post('orders/:id/pay')
  @RequirePermissions(P.CANTEEN_ORDER)
  @ResponseMessage('Payment received')
  @ApiOperation({ summary: 'Pay an unpaid order in full by wallet, cash, UPI or card' })
  @ApiEnvelope(PaymentDto, { status: HttpStatus.CREATED, message: 'Payment received' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  pay(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PayOrderDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.billing.pay(schoolId, id, dto, actor);
  }

  @Post('orders/:id/refund')
  @RequirePermissions(P.CANTEEN_ORDER)
  @ResponseMessage('Order refunded')
  @ApiOperation({ summary: 'Refund a paid order to the wallet or as a cash-out entry' })
  @ApiEnvelope(PaymentDto, { status: HttpStatus.CREATED, message: 'Order refunded' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  refund(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RefundOrderDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.billing.refund(schoolId, id, dto, actor);
  }

  @Get('orders/:id/receipt')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'Bill of an order: lines, tax, totals, payments and the receipt footer' })
  @ApiEnvelope(ReceiptDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  receipt(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.billing.receipt(schoolId, id);
  }

  @Get('payments/summary')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'Collections, refunds and net by payment mode for a date range (default today)' })
  @ApiEnvelope(PaymentSummaryDto)
  @ApiErrors(HttpStatus.BAD_REQUEST)
  summary(@SchoolId() schoolId: number, @Query() query: PaymentSummaryQueryDto) {
    return this.billing.summary(schoolId, query);
  }

  @Get('payments')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'Payment ledger with filters on date range, mode and refunds' })
  @ApiEnvelope(PaymentLedgerDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  ledger(@SchoolId() schoolId: number, @Query() query: PaymentQueryDto) {
    return this.billing.ledger(schoolId, query);
  }
}
