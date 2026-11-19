import { Injectable } from '@nestjs/common';
import { AppException, AuthUser } from '@app/common';
import { TripsService } from '../tracking/trips.service';
import { Vehicle } from '../transport/entities/vehicle.entity';
import {
  DriverFuelInputDto,
  DriverMaintenanceDto,
  DriverProblemDto,
  PreTripFormDto,
  PreTripInputDto,
} from './dto/fleet-maintenance.dto';
import { FuelLogDto, TicketDto } from './dto/fleet-ops.dto';
import { CRITICAL_PRE_TRIP_ITEMS, PRE_TRIP_ITEMS } from './entities/fleet-maintenance.entity';
import { FleetBooksService } from './fleet-books.service';
import { FuelService } from './fuel.service';
import { MaintenanceSchedulesService } from './maintenance-schedules.service';
import { MaintenanceService } from './maintenance.service';
import { PRE_TRIP_LABELS, PreTripChecksService } from './pre-trip-checks.service';

@Injectable()
export class DriverVehicleService {
  constructor(
    private readonly trips: TripsService,
    private readonly books: FleetBooksService,
    private readonly schedules: MaintenanceSchedulesService,
    private readonly maintenance: MaintenanceService,
    private readonly fuel: FuelService,
    private readonly checks: PreTripChecksService,
  ) {}

  async maintenanceView(user: AuthUser): Promise<DriverMaintenanceDto> {
    const vehicle = await this.myBus(user);
    const schoolId = vehicle.school_id;
    const [km, services, last, open, check, settings, offRoad] = await Promise.all([
      this.books.currentKm([vehicle.id]),
      this.schedules.forBuses(schoolId, [vehicle.id]),
      this.maintenance.forBus(schoolId, vehicle.id, false, 1),
      this.maintenance.forBus(schoolId, vehicle.id, true, 10),
      this.checks.today(schoolId, vehicle.id),
      this.books.settings(schoolId),
      this.maintenance.isOffRoad(schoolId, vehicle.id),
    ]);
    return {
      vehicle: { id: vehicle.id, registration_no: vehicle.registration_no, name: vehicle.name },
      current_km: km.get(vehicle.id)?.km ?? null,
      services,
      last_service: last[0] ?? null,
      open_problems: open,
      today_check: check,
      check_required: settings.pre_trip_check_required,
      off_road: offRoad,
    };
  }

  async checkForm(user: AuthUser): Promise<PreTripFormDto> {
    const vehicle = await this.myBus(user);
    const settings = await this.books.settings(vehicle.school_id);
    return {
      vehicle: { id: vehicle.id, registration_no: vehicle.registration_no, name: vehicle.name },
      items: PRE_TRIP_ITEMS.map((item) => ({
        item,
        label: PRE_TRIP_LABELS[item],
        critical: CRITICAL_PRE_TRIP_ITEMS.includes(item),
      })),
      required: settings.pre_trip_check_required,
      today: await this.checks.today(vehicle.school_id, vehicle.id),
    };
  }

  async submitCheck(user: AuthUser, dto: PreTripInputDto) {
    const vehicle = await this.myBus(user);
    return this.checks.submit(vehicle.school_id, vehicle, dto, user);
  }

  async addFuel(user: AuthUser, dto: DriverFuelInputDto): Promise<FuelLogDto> {
    const vehicle = await this.myBus(user);
    return this.fuel.createFromDriver(vehicle.school_id, vehicle, dto, user);
  }

  async myFuel(user: AuthUser): Promise<FuelLogDto[]> {
    const vehicle = await this.myBus(user);
    return this.fuel.forDriver(vehicle.school_id, vehicle.id, user.id);
  }

  async reportProblem(user: AuthUser, dto: DriverProblemDto): Promise<TicketDto> {
    const vehicle = await this.myBus(user);
    return this.maintenance.reportFromDriver(vehicle.school_id, vehicle, dto, user);
  }

  private async myBus(user: AuthUser): Promise<Vehicle> {
    const vehicle = await this.trips.crewVehicle(user);
    if (!vehicle) throw AppException.forbidden('You are not the driver or attendant of any bus', 'NO_BUS');
    return vehicle;
  }
}
