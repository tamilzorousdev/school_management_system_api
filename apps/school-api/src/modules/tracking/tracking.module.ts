import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { CrewModule } from '../crew/crew.module';
import { StudentLifecycleModule } from '../student-lifecycle/student-lifecycle.module';
import { TransportModule } from '../transport/transport.module';
import { BoardingChecklistService } from './boarding-checklist.service';
import { BoardingService } from './boarding.service';
import { DriverSafetyController } from './driver-safety.controller';
import { FleetAlert } from './entities/fleet-alert.entity';
import { TransportTrip } from './entities/transport-trip.entity';
import { TripBoarding } from './entities/trip-boarding.entity';
import { TripEvent } from './entities/trip-event.entity';
import { FleetAlertsController } from './fleet-alerts.controller';
import { FleetAlertsService } from './fleet-alerts.service';
import { LiveGateway } from './live.gateway';
import { TripAccessService } from './trip-access.service';
import { TripEventsService } from './trip-events.service';
import {
  AdminStudentBusController,
  AdminTripsController,
  DriverTripsController,
  TelematicsWebhookController,
} from './tracking.controller';
import { TripDelayService } from './trip-delay.service';
import { TripHandoverService } from './trip-handover.service';
import { TripsService } from './trips.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TransportTrip, TripEvent, TripBoarding, FleetAlert]),
    AuthModule,
    StudentLifecycleModule,
    CrewModule,
    TransportModule,
  ],
  controllers: [
    AdminTripsController,
    AdminStudentBusController,
    DriverTripsController,
    TelematicsWebhookController,
    DriverSafetyController,
    FleetAlertsController,
  ],
  providers: [
    TripsService,
    TripEventsService,
    TripAccessService,
    LiveGateway,
    BoardingService,
    BoardingChecklistService,
    FleetAlertsService,
    TripDelayService,
    TripHandoverService,
  ],
  exports: [TripsService, TripAccessService, LiveGateway, FleetAlertsService, BoardingChecklistService],
})
export class TrackingModule {}
