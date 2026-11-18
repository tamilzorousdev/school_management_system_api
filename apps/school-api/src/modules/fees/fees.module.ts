import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeeHead } from './entities/fee-head.entity';
import { FeeInvoiceLine } from './entities/fee-invoice-line.entity';
import { FeeInvoice } from './entities/fee-invoice.entity';
import { FeePayment } from './entities/fee-payment.entity';
import { FeePlan } from './entities/fee-plan.entity';
import { TransportFeeAdjustment } from './entities/transport-fee-adjustment.entity';
import { MobileParentFeesController, MobileTeacherFeesController } from './fees-mobile.controller';
import { FeesController, StudentFeesController } from './fees.controller';
import { FeesService } from './fees.service';
import { TransportFeeSyncService } from './transport-fee-sync.service';
import { TransportFeesReportService } from './transport-fees-report.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([FeeHead, FeePlan, FeeInvoice, FeeInvoiceLine, FeePayment, TransportFeeAdjustment]),
  ],
  controllers: [FeesController, StudentFeesController, MobileTeacherFeesController, MobileParentFeesController],
  providers: [FeesService, TransportFeeSyncService, TransportFeesReportService],
  exports: [FeesService, TransportFeeSyncService, TransportFeesReportService],
})
export class FeesModule {}
