import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeesModule } from '../fees/fees.module';
import {
  HostelHealthLog,
  HostelLaundryBatch,
  HostelLaundryItem,
  HostelMealAttendance,
  HostelMealSkip,
  HostelMedication,
  HostelMedicationDose,
  HostelMenuOverride,
  HostelMessFeedback,
  HostelMessMenu,
} from './entities/hostel-care.entity';
import {
  HostelDutyRoster,
  HostelDutyShift,
  HostelDutySwap,
  HostelNightRound,
  HostelSeatAllocation,
  HostelStudyAttendance,
  HostelStudyHall,
  HostelStudySchedule,
  HostelStudySeat,
} from './entities/hostel-duty.entity';
import {
  HostelBelonging,
  HostelInspection,
  HostelInspectionItem,
  HostelLocker,
  HostelLockerAllocation,
  HostelRoomAsset,
} from './entities/hostel-rooms.entity';
import { HostelModuleGuard } from './hostel-module.guard';
import { HostelRuleAck, HostelSosEvent, HostelSosMark } from './entities/hostel-safety.entity';
import {
  HostelSafetyController,
  MobileHostelSafetyController,
  ParentHostelSafetyController,
} from './hostel-safety.controller';
import { HostelSafetyService } from './hostel-safety.service';
import { HostelReportsController } from './hostel-reports.controller';
import { HostelReportsService } from './hostel-reports.service';
import { HostelAssetsService } from './hostel-assets.service';
import { HostelCareParentService } from './hostel-care-parent.service';
import {
  HostelHealthController,
  HostelLaundryController,
  HostelMessController,
  MobileHostelHealthController,
  MobileHostelLaundryController,
  MobileHostelMessController,
  ParentHostelCareController,
} from './hostel-care.controller';
import {
  HostelDutyController,
  HostelStudyController,
  HostelStudyHallController,
  MobileHostelDutyController,
  MobileHostelStudyController,
  MobileHostelStudyHallController,
  ParentHostelStudyController,
} from './hostel-duty.controller';
import { HostelDutyService } from './hostel-duty.service';
import { HostelHealthService } from './hostel-health.service';
import { HostelInspectionsService } from './hostel-inspections.service';
import { HostelLaundryService } from './hostel-laundry.service';
import { HostelLockersService } from './hostel-lockers.service';
import { HostelMessService } from './hostel-mess.service';
import {
  HostelLockersController,
  HostelRoomsController,
  MobileHostelLockersController,
  MobileHostelRoomsController,
  ParentHostelRoomsController,
} from './hostel-rooms.controller';
import { HostelStudyHallService } from './hostel-study-hall.service';
import { HostelStudyService } from './hostel-study.service';
import {
  HostelCharge,
  HostelComplaint,
  HostelDisciplineCase,
  HostelFeeSchedule,
  HostelMaintenanceTicket,
  HostelTicketUpdate,
} from './entities/hostel-conduct.entity';
import { HostelConductController, MobileHostelConductController } from './hostel-conduct.controller';
import { HostelDisciplineService } from './hostel-discipline.service';
import { HostelFeesService } from './hostel-fees.service';
import { HostelTicketsService } from './hostel-tickets.service';
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
      HostelFeeSchedule,
      HostelCharge,
      HostelDisciplineCase,
      HostelComplaint,
      HostelMaintenanceTicket,
      HostelTicketUpdate,
      HostelMessMenu,
      HostelMenuOverride,
      HostelMealAttendance,
      HostelMealSkip,
      HostelMessFeedback,
      HostelHealthLog,
      HostelMedication,
      HostelMedicationDose,
      HostelLaundryBatch,
      HostelLaundryItem,
      HostelDutyShift,
      HostelDutyRoster,
      HostelDutySwap,
      HostelNightRound,
      HostelStudyHall,
      HostelStudySeat,
      HostelSeatAllocation,
      HostelStudySchedule,
      HostelStudyAttendance,
      HostelRoomAsset,
      HostelLocker,
      HostelLockerAllocation,
      HostelInspection,
      HostelInspectionItem,
      HostelBelonging,
      HostelSosEvent,
      HostelSosMark,
      HostelRuleAck,
    ]),
    FeesModule,
  ],
  controllers: [
    HostelSetupController,
    HostelAdmissionsController,
    HostelMovementController,
    MobileHostelController,
    MobileHostelMovementController,
    ParentHostelController,
    HostelConductController,
    MobileHostelConductController,
    HostelMessController,
    HostelHealthController,
    HostelLaundryController,
    MobileHostelMessController,
    MobileHostelHealthController,
    MobileHostelLaundryController,
    ParentHostelCareController,
    HostelDutyController,
    HostelStudyController,
    HostelStudyHallController,
    MobileHostelDutyController,
    MobileHostelStudyController,
    MobileHostelStudyHallController,
    ParentHostelStudyController,
    HostelLockersController,
    HostelRoomsController,
    MobileHostelLockersController,
    MobileHostelRoomsController,
    ParentHostelRoomsController,
    HostelSafetyController,
    MobileHostelSafetyController,
    ParentHostelSafetyController,
    HostelReportsController,
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
    HostelFeesService,
    HostelDisciplineService,
    HostelTicketsService,
    HostelModuleGuard,
    HostelMessService,
    HostelHealthService,
    HostelLaundryService,
    HostelCareParentService,
    HostelDutyService,
    HostelStudyService,
    HostelStudyHallService,
    HostelLockersService,
    HostelAssetsService,
    HostelInspectionsService,
    HostelSafetyService,
    HostelReportsService,
  ],
  exports: [HostelSettingsService, HostelSetupService, HostelAdmissionsService],
})
export class HostelModule {}
