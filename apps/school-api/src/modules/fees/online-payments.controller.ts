import { Controller, Get, Headers, HttpCode, HttpStatus, Post, Query, Req, type RawBodyRequest } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiEnvelope, ApiErrors, Public, RequirePermissions } from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import { OnlineOrderDto, OnlineOrderQueryDto } from './dto/fees.dto';
import { OnlinePaymentsService } from './online-payments.service';

@ApiTags('Admin · Fees')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/fees/online-payments')
export class OnlinePaymentsController {
  constructor(private readonly online: OnlinePaymentsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiOperation({
    summary: 'Online payments started by parents (Razorpay), newest first',
    description:
      'status: created (started, not finished), paid, failed. search: invoice no., Razorpay order or payment id.',
  })
  @ApiEnvelope(OnlineOrderDto, { paginated: true })
  list(@SchoolId() schoolId: number, @Query() query: OnlineOrderQueryDto) {
    return this.online.list(schoolId, query);
  }
}

@ApiTags('Integrations')
@Controller('integrations/razorpay')
export class RazorpayWebhookController {
  constructor(private readonly online: OnlinePaymentsService) {}

  @Post('webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiHeader({
    name: 'X-Razorpay-Signature',
    required: true,
    description: 'HMAC-SHA256 (hex) of the raw body with RAZORPAY_WEBHOOK_SECRET',
  })
  @ApiOperation({
    summary: 'Razorpay webhook: payment.captured, order.paid and payment.failed',
    description:
      'Server to server only. Records the payment if the app could not confirm it (closed app, lost network). Safe to receive twice: a payment is recorded once.',
  })
  @ApiBody({ schema: { type: 'object' } })
  receive(@Req() request: RawBodyRequest<Request>, @Headers('x-razorpay-signature') signature?: string) {
    return this.online.webhook(request.rawBody, signature);
  }
}
