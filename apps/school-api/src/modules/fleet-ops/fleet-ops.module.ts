import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TransportTrip } from '../tracking/entities/transport-trip.entity';
import { TrackingModule } from '../tracking/tracking.module';
import { Vehicle } from '../transport/entities/vehicle.entity';
import { DriverVehicleService } from './driver-vehicle.service';
import {
  FleetEntryChange,
  FleetSettings,
  FleetVendor,
  MaintenanceSchedule,
  PreTripCheck,
  VehicleExpense,
} from './entities/fleet-maintenance.entity';
import { FuelLog } from './entities/fuel-log.entity';
import { MaintenanceTicket } from './entities/maintenance-ticket.entity';
import { FleetBooksService } from './fleet-books.service';
import { FleetHealthService } from './fleet-health.service';
import { FleetJobsService } from './fleet-jobs.service';
import {
  FleetChangesController,
  FleetReportsController,
  FleetSettingsController,
  FleetVehicleController,
  FleetVendorsController,
  MaintenanceSchedulesController,
  PreTripChecksController,
  VehicleExpensesController,
} from './fleet-maintenance.controller';
import { FleetHealthController, FuelController, MaintenanceController } from './fleet-ops.controller';
import { FleetReportsService } from './fleet-reports.service';
import { FleetVendorsService } from './fleet-vendors.service';
import { FuelService } from './fuel.service';
import { MaintenanceSchedulesService } from './maintenance-schedules.service';
import { MaintenanceService } from './maintenance.service';
import { MobileDriverPreTripController, MobileDriverVehicleController } from './mobile-driver-vehicle.controller';
import { PreTripChecksService } from './pre-trip-checks.service';
import { VehicleExpensesService } from './vehicle-expenses.service';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      MaintenanceTicket,
      FuelLog,
      Vehicle,
      TransportTrip,
      FleetSettings,
      MaintenanceSchedule,
      VehicleExpense,
      FleetVendor,
      PreTripCheck,
      FleetEntryChange,
    ]),
    TrackingModule,
  ],
  controllers: [
    MaintenanceController,
    FuelController,
    FleetHealthController,
    FleetSettingsController,
    FleetChangesController,
    FleetVehicleController,
    FleetVendorsController,
    MaintenanceSchedulesController,
    VehicleExpensesController,
    PreTripChecksController,
    FleetReportsController,
    MobileDriverVehicleController,
    MobileDriverPreTripController,
  ],
  providers: [
    MaintenanceService,
    FuelService,
    FleetHealthService,
    FleetBooksService,
    FleetVendorsService,
    MaintenanceSchedulesService,
    VehicleExpensesService,
    PreTripChecksService,
    FleetReportsService,
    FleetJobsService,
    DriverVehicleService,
  ],
  exports: [MaintenanceService, FuelService, PreTripChecksService, MaintenanceSchedulesService, FleetReportsService],
})
export class FleetOpsModule {}
