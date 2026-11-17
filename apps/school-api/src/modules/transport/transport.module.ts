import { VehicleDocument } from './entities/vehicle-document.entity';
import { VehicleDocumentsService } from './vehicle-documents.service';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CrewModule } from '../crew/crew.module';
import { ExpiryAlert } from './entities/expiry-alert.entity';
import { RouteChange } from './entities/route-change.entity';
import { RouteStop } from './entities/route-stop.entity';
import { StudentTransportChange } from './entities/student-transport-change.entity';
import { StudentTransport } from './entities/student-transport.entity';
import { TransportRoute } from './entities/transport-route.entity';
import { Vehicle } from './entities/vehicle.entity';
import { RoutesService } from './routes.service';
import { MobileDriverController, StudentTransportController, TransportController } from './transport.controller';
import { VehiclesService } from './vehicles.service';
import { DriverProfileService } from './driver-profile.service';
import { DriverRatingsController } from './driver-ratings.controller';
import { DriverRatingsService } from './driver-ratings.service';
import { DriverRating } from './entities/driver-rating.entity';
import { RouteBusSwap } from './entities/route-bus-swap.entity';
import { MobileDriverProfileController } from './mobile-driver-profile.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Vehicle,
      TransportRoute,
      RouteStop,
      StudentTransport,
      StudentTransportChange,
      ExpiryAlert,
      VehicleDocument,
      RouteChange,
      DriverRating,
      RouteBusSwap,
    ]),
    CrewModule,
  ],
  controllers: [
    TransportController,
    StudentTransportController,
    MobileDriverController,
    MobileDriverProfileController,
    DriverRatingsController,
  ],
  providers: [VehicleDocumentsService, VehiclesService, RoutesService, DriverProfileService, DriverRatingsService],
  exports: [VehiclesService, RoutesService, DriverRatingsService],
})
export class TransportModule {}
