import { VehicleDocument } from './entities/vehicle-document.entity';
import { VehicleDocumentsService } from './vehicle-documents.service';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CrewModule } from '../crew/crew.module';
import { FeesModule } from '../fees/fees.module';
import { ExpiryAlert } from './entities/expiry-alert.entity';
import { RouteStop } from './entities/route-stop.entity';
import { StudentTransportChange } from './entities/student-transport-change.entity';
import { StudentTransport } from './entities/student-transport.entity';
import { TransportRoute } from './entities/transport-route.entity';
import { Vehicle } from './entities/vehicle.entity';
import { RoutesService } from './routes.service';
import { MobileDriverController, StudentTransportController, TransportController } from './transport.controller';
import { VehiclesService } from './vehicles.service';
import { DriverProfileService } from './driver-profile.service';
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
    ]),
    CrewModule,
    FeesModule,
  ],
  controllers: [TransportController, StudentTransportController, MobileDriverController, MobileDriverProfileController],
  providers: [VehicleDocumentsService, VehiclesService, RoutesService, DriverProfileService],
  exports: [VehiclesService, RoutesService],
})
export class TransportModule {}
