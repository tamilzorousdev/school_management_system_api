import { Module } from '@nestjs/common';
import { CrewModule } from '../crew/crew.module';
import { DriverOpsModule } from '../driver-ops/driver-ops.module';
import { FleetOpsModule } from '../fleet-ops/fleet-ops.module';
import { StaffLeaveModule } from '../staff-leave/staff-leave.module';
import { TrackingModule } from '../tracking/tracking.module';
import { TransportModule } from '../transport/transport.module';
import { MobileTransportController } from './transport-incharge.controller';
import { TransportInchargeService } from './transport-incharge.service';

@Module({
  imports: [DriverOpsModule, TransportModule, CrewModule, TrackingModule, FleetOpsModule, StaffLeaveModule],
  controllers: [MobileTransportController],
  providers: [TransportInchargeService],
})
export class TransportInchargeModule {}
