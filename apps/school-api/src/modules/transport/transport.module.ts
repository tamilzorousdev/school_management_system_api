import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CrewModule } from '../crew/crew.module';
import { ExpiryAlert } from './entities/expiry-alert.entity';
import { RouteStop } from './entities/route-stop.entity';
import { StudentTransport } from './entities/student-transport.entity';
import { TransportRoute } from './entities/transport-route.entity';
import { Vehicle } from './entities/vehicle.entity';
import { RoutesService } from './routes.service';
import { MobileDriverController, StudentTransportController, TransportController } from './transport.controller';
import { VehiclesService } from './vehicles.service';

@Module({
  imports: [TypeOrmModule.forFeature([Vehicle, TransportRoute, RouteStop, StudentTransport, ExpiryAlert]), CrewModule],
  controllers: [TransportController, StudentTransportController, MobileDriverController],
  providers: [VehiclesService, RoutesService],
  exports: [VehiclesService, RoutesService],
})
export class TransportModule {}
