import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  HostelAdmission,
  HostelAllocation,
  HostelApplication,
  HostelAuditLog,
  HostelCheckout,
  HostelCheckoutItem,
  HostelTransfer,
} from './entities/hostel-admission.entity';
import {
  HostelApprovedVisitor,
  HostelBlocklist,
  HostelLeave,
  HostelRollCall,
  HostelRollCallRecord,
  HostelVisit,
} from './entities/hostel-movement.entity';
import {
  Hostel,
  HostelBed,
  HostelBlock,
  HostelFloor,
  HostelRoom,
  HostelRoomType,
  HostelSettings,
} from './entities/hostel.entity';
import { HostelAdmissionsController } from './hostel-admissions.controller';
import { HostelAdmissionsService } from './hostel-admissions.service';
import { HostelAuditService } from './hostel-audit.service';
import { HostelCheckoutService } from './hostel-checkout.service';
import { HostelLeavesService } from './hostel-leaves.service';
import { HostelMovementController, MobileHostelMovementController } from './hostel-movement.controller';
import { HostelNotifyService } from './hostel-notify.service';
import { HostelParentService } from './hostel-parent.service';
import { HostelRollCallService } from './hostel-roll-call.service';
import { HostelSettingsService } from './hostel-settings.service';
import { HostelSetupController } from './hostel-setup.controller';
import { HostelSetupService } from './hostel-setup.service';
import { HostelVisitorsService } from './hostel-visitors.service';
import { MobileHostelController } from './mobile-hostel.controller';
import { ParentHostelController } from './parent-hostel.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      HostelSettings,
      Hostel,
      HostelBlock,
      HostelFloor,
      HostelRoomType,
      HostelRoom,
      HostelBed,
      HostelApplication,
      HostelAdmission,
      HostelAllocation,
      HostelTransfer,
      HostelCheckout,
      HostelCheckoutItem,
      HostelAuditLog,
      HostelRollCall,
      HostelRollCallRecord,
      HostelLeave,
      HostelVisit,
      HostelApprovedVisitor,
      HostelBlocklist,
    ]),
  ],
  controllers: [
    HostelSetupController,
    HostelAdmissionsController,
    HostelMovementController,
    MobileHostelController,
    MobileHostelMovementController,
    ParentHostelController,
  ],
  providers: [
    HostelSettingsService,
    HostelSetupService,
    HostelAuditService,
    HostelNotifyService,
    HostelAdmissionsService,
    HostelCheckoutService,
    HostelRollCallService,
    HostelLeavesService,
    HostelVisitorsService,
    HostelParentService,
  ],
  exports: [HostelSettingsService, HostelSetupService, HostelAdmissionsService],
})
export class HostelModule {}
