import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CrewModule } from '../crew/crew.module';
import { MobileModule } from '../mobile/mobile.module';
import { StudentLifecycleModule } from '../student-lifecycle/student-lifecycle.module';
import { TransportModule } from '../transport/transport.module';
import { TransportTrip } from '../tracking/entities/transport-trip.entity';
import { TrackingModule } from '../tracking/tracking.module';
import { BusRequestsService } from './bus-requests.service';
import {
  AdminTransportOpsController,
  MobileDriverOpsController,
  MobileParentBusRequestsController,
} from './driver-ops.controller';
import { DriverDutyService } from './driver-duty.service';
import { DriverStudentsService } from './driver-students.service';
import { BusOptOut, BusPickupPerson, DriverDuty, TransportIncident } from './entities/driver-ops.entity';
import { IncidentsService } from './incidents.service';
import { OperationsService } from './operations.service';
import { StudentsTodayService } from './students-today.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([DriverDuty, TransportIncident, BusOptOut, BusPickupPerson, TransportTrip]),
    CrewModule,
    MobileModule,
    TrackingModule,
    TransportModule,
    StudentLifecycleModule,
  ],
  controllers: [MobileDriverOpsController, MobileParentBusRequestsController, AdminTransportOpsController],
  providers: [
    DriverDutyService,
    IncidentsService,
    BusRequestsService,
    OperationsService,
    DriverStudentsService,
    StudentsTodayService,
  ],
  exports: [OperationsService, StudentsTodayService],
})
export class DriverOpsModule {}
