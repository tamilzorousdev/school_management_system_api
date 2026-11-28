import { Inject, Injectable } from '@nestjs/common';
import { AppException, AuthUser, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { CrewService } from '../crew/crew.service';
import { CrewQueryDto } from '../crew/dto/crew.dto';
import { OperationsService } from '../driver-ops/operations.service';
import { StudentsTodayService } from '../driver-ops/students-today.service';
import { FuelQueryDto } from '../fleet-ops/dto/fleet-ops.dto';
import { FuelService } from '../fleet-ops/fuel.service';
import { StaffLeaveDecisionDto } from '../staff-leave/dto/staff-leave.dto';
import { StaffLeaveService } from '../staff-leave/staff-leave.service';
import { AlertDto, AlertQueryDto } from '../tracking/dto/fleet-alert.dto';
import { FleetAlertsService } from '../tracking/fleet-alerts.service';
import { VehicleQueryDto } from '../transport/dto/transport.dto';
import { DriverRatingsService } from '../transport/driver-ratings.service';
import { VehicleDocumentsService } from '../transport/vehicle-documents.service';
import { VehiclesService } from '../transport/vehicles.service';
import { BusDetailDto, CrewLeaveFilter, CrewMemberDto, TransportHomeDto } from './dto/transport-incharge.dto';
import { paperCounts } from './transport-incharge.logic';
import { TransportOpsService } from './transport-ops.service';

const PAPER_WINDOW_DAYS = 30;

@Injectable()
export class TransportInchargeService {
  constructor(
    private readonly operations: OperationsService,
    private readonly studentsToday: StudentsTodayService,
    private readonly vehicles: VehiclesService,
    private readonly vehicleDocuments: VehicleDocumentsService,
    private readonly crew: CrewService,
    private readonly ratings: DriverRatingsService,
    private readonly alerts: FleetAlertsService,
    private readonly fuel: FuelService,
    private readonly leaves: StaffLeaveService,
    private readonly ops: TransportOpsService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async home(schoolId: number, date?: string): Promise<TransportHomeDto> {
    const day = date ?? todayIn(this.app.timeZone);
    const [board, students, sos, papers, fuel, leavesPending, onLeave] = await Promise.all([
      this.operations.board(schoolId, day),
      this.studentsToday.today(schoolId, day),
      this.activeSos(schoolId),
      this.vehicles.upcoming(schoolId, PAPER_WINDOW_DAYS),
      this.fuel.list(schoolId, { status: 'pending', page: 1, limit: 1 } as FuelQueryDto),
      this.leaves.crewWaiting(schoolId),
      this.leaves.crewOnLeave(schoolId, day),
    ]);
    const ops = await this.ops.opsCounts(schoolId, board);
    return {
      date: day,
      trips: board.summary,
      drivers: board.drivers,
      sos,
      exceptions: board.exceptions.slice(0, 5),
      students: students.summary,
      papers: paperCounts(papers),
      fuel_pending: fuel.total,
      leaves_pending: leavesPending,
      crew_on_leave: onLeave,
      ops,
    };
  }

  trips(schoolId: number, date?: string) {
    return this.operations.board(schoolId, date);
  }

  students(schoolId: number, date?: string) {
    return this.studentsToday.today(schoolId, date);
  }

  buses(schoolId: number) {
    return this.vehicles.list(schoolId, { page: 1, limit: 100, sort: 'name', order: 'asc' } as VehicleQueryDto);
  }

  async bus(schoolId: number, id: number): Promise<BusDetailDto> {
    const [vehicle, documents] = await Promise.all([
      this.vehicles.get(schoolId, id),
      this.vehicleDocuments.list(schoolId, id),
    ]);
    return { vehicle, documents: documents.filter((document) => document.current) };
  }

  crewList(schoolId: number) {
    return this.crew.list(schoolId, { page: 1, limit: 100 } as CrewQueryDto);
  }

  async crewMember(schoolId: number, id: number): Promise<CrewMemberDto> {
    const [crew, summary] = await Promise.all([this.crew.get(schoolId, id), this.ratings.summary(schoolId)]);
    const rating = crew.role === 'driver' ? summary.find((row) => row.driver.id === crew.user_id) : undefined;
    return {
      crew,
      rating: rating
        ? {
            average: rating.average,
            count: rating.count,
            month_average: rating.month_average,
            low_count: rating.low_count,
          }
        : null,
    };
  }

  async approveDuty(schoolId: number, id: number, actor: AuthUser): Promise<CrewMemberDto> {
    await this.crew.approve(schoolId, id, actor);
    return this.crewMember(schoolId, id);
  }

  activeSos(schoolId: number): Promise<AlertDto[]> {
    return this.alerts
      .list(schoolId, { kind: 'sos', active: true, page: 1, limit: 20 } as AlertQueryDto)
      .then((page: Paginated<AlertDto>) => page.items);
  }

  acknowledgeSos(schoolId: number, id: number, actor: AuthUser) {
    return this.alerts.acknowledge(schoolId, id, actor);
  }

  pendingFuel(schoolId: number) {
    return this.fuel.list(schoolId, { status: 'pending', page: 1, limit: 50 } as FuelQueryDto);
  }

  crewLeaves(schoolId: number, status: CrewLeaveFilter = 'waiting') {
    return this.leaves.crewLeaves(schoolId, status);
  }

  decideLeave(actor: AuthUser, id: number, dto: StaffLeaveDecisionDto) {
    if (!actor.school_id) throw AppException.forbidden('Your account is not linked to a school', 'NO_SCHOOL');
    return this.leaves.decideCrew(actor, id, dto);
  }
}
