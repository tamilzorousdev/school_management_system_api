import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeeAuditLog } from './entities/fee-audit-log.entity';
import { FeeFineType } from './entities/fee-fine-type.entity';
import { FeeFine } from './entities/fee-fine.entity';
import { FeeFinesController } from './fee-fines.controller';
import { FeeFinesService } from './fee-fines.service';
import { FeeBenefit } from './entities/fee-benefit.entity';
import { FeeHead } from './entities/fee-head.entity';
import { FeeInvoiceBenefit } from './entities/fee-invoice-benefit.entity';
import { FeeInvoiceLine } from './entities/fee-invoice-line.entity';
import { FeeInvoice } from './entities/fee-invoice.entity';
import { FeePayment } from './entities/fee-payment.entity';
import { FeePlanVersion } from './entities/fee-plan-version.entity';
import { FeePlan } from './entities/fee-plan.entity';
import { StudentFeeBenefit } from './entities/student-fee-benefit.entity';
import { FeeBenefitsController } from './fee-benefits.controller';
import { FeeBenefitsService } from './fee-benefits.service';
import { FeeReportsController } from './fee-reports.controller';
import { FeeRequestsController } from './fee-requests.controller';
import { FeeRequestsService } from './fee-requests.service';
import { FeeSettingsService } from './fee-settings.service';
import { FeeRefund } from './entities/fee-refund.entity';
import { FeeRequest } from './entities/fee-request.entity';
import { FeeSettings } from './entities/fee-settings.entity';
import { FeeCollection } from './entities/fee-collection.entity';
import { FeeCredit } from './entities/fee-credit.entity';
import { FeePaymentOrder } from './entities/fee-payment-order.entity';
import { OnlinePaymentsController, RazorpayWebhookController } from './online-payments.controller';
import { OnlinePaymentsService } from './online-payments.service';
import { RazorpayClient } from './razorpay.client';
import { FeeReportsService } from './fee-reports.service';
import { TransportFeeAdjustment } from './entities/transport-fee-adjustment.entity';
import { MobileParentFeesController, MobileTeacherFeesController } from './fees-mobile.controller';
import { FeesController, StudentFeesController } from './fees.controller';
import { FeesService } from './fees.service';
import { TransportFeeSyncService } from './transport-fee-sync.service';
import { TransportFeesReportService } from './transport-fees-report.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FeeHead,
      FeePlan,
      FeePlanVersion,
      FeeInvoice,
      FeeInvoiceLine,
      FeeInvoiceBenefit,
      FeePayment,
      FeeAuditLog,
      FeeBenefit,
      StudentFeeBenefit,
      FeeRequest,
      FeeRefund,
      FeeSettings,
      FeeCollection,
      FeeCredit,
      FeePaymentOrder,
      FeeFine,
      FeeFineType,
      TransportFeeAdjustment,
    ]),
  ],
  controllers: [
    FeesController,
    FeeBenefitsController,
    FeeReportsController,
    FeeRequestsController,
    FeeFinesController,
    OnlinePaymentsController,
    RazorpayWebhookController,
    StudentFeesController,
    MobileTeacherFeesController,
    MobileParentFeesController,
  ],
  providers: [
    FeesService,
    FeeBenefitsService,
    FeeReportsService,
    FeeRequestsService,
    FeeFinesService,
    FeeSettingsService,
    OnlinePaymentsService,
    RazorpayClient,
    TransportFeeSyncService,
    TransportFeesReportService,
  ],
  exports: [FeesService, FeeFinesService, TransportFeeSyncService, TransportFeesReportService],
})
export class FeesModule {}
