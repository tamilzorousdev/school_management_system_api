import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppException, AuthUser } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { Staff } from '../staff/entities/staff.entity';
import { DutyOverride, OverrideSubject } from '../transport/entities/duty-override.entity';
import { VehicleExpiryKind } from '../transport/entities/expiry-alert.entity';
import { VEHICLE_EXPIRY_FIELDS } from '../transport/entities/vehicle-document.entity';
import { Vehicle } from '../transport/entities/vehicle.entity';
import { expiryState, ROAD_KINDS, roadBlockers } from '../transport/transport.logic';
import { CrewService } from './crew.service';
import { OverrideView, readOverrides } from './overrides';

@Injectable()
export class ClearanceService {
  constructor(
    @InjectRepository(DutyOverride) private readonly overrides: Repository<DutyOverride>,
    private readonly crew: CrewService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  todayOverrides(schoolId: number, subject: OverrideSubject, ids: number[]): Promise<Map<number, OverrideView>> {
    return readOverrides(this.dataSource, schoolId, subject, ids, todayIn(this.app.timeZone));
  }

  async allowVehicle(schoolId: number, vehicleId: number, reason: string, actor: AuthUser): Promise<OverrideView> {
    const vehicle = await this.dataSource.getRepository(Vehicle).findOneBy({ id: vehicleId, school_id: schoolId });
    if (!vehicle) throw AppException.notFound('Bus not found', 'VEHICLE_NOT_FOUND');
    return this.grant(schoolId, 'vehicle', vehicle.id, reason, actor);
  }

  async allowCrew(schoolId: number, staffId: number, reason: string, actor: AuthUser): Promise<OverrideView> {
    const staff = await this.dataSource.getRepository(Staff).findOneBy({ id: staffId, school_id: schoolId });
    if (!staff) throw AppException.notFound('Crew member not found', 'CREW_NOT_FOUND');
    return this.grant(schoolId, 'crew', staff.user_id, reason, actor);
  }

  async assertCanRun(schoolId: number, vehicle: Vehicle): Promise<void> {
    const blockers = this.vehicleBlockers(vehicle);
    if (blockers.length && !(await this.todayOverrides(schoolId, 'vehicle', [vehicle.id])).has(vehicle.id)) {
      throw AppException.forbidden(
        `${vehicle.registration_no} is not road-worthy: ${blockers.join(', ')} expired. Renew it, or allow it for today with a reason.`,
        'VEHICLE_NOT_ROADWORTHY',
      );
    }
    const crew = [vehicle.driver_user_id, vehicle.attendant_user_id].filter((id): id is number => !!id);
    const allowed = await this.todayOverrides(schoolId, 'crew', crew);
    for (const userId of crew) {
      if (allowed.has(userId)) continue;
      const duty = await this.crew.dutyOf(schoolId, userId);
      if (duty.status !== 'approved') {
        throw AppException.forbidden(
          `${duty.name} is not cleared for duty. Renew their documents and approve them in Drivers and attendants, or allow them for today with a reason.`,
          'CREW_NOT_APPROVED',
        );
      }
    }
  }

  vehicleBlockers(vehicle: Vehicle): string[] {
    const today = todayIn(this.app.timeZone);
    return roadBlockers(
      ROAD_KINDS.map((kind: VehicleExpiryKind) =>
        expiryState(kind, vehicle[VEHICLE_EXPIRY_FIELDS[kind] as keyof Vehicle] as string | null, today),
      ),
    );
  }

  private async grant(
    schoolId: number,
    subject: OverrideSubject,
    subjectId: number,
    reason: string,
    actor: AuthUser,
  ): Promise<OverrideView> {
    const onDate = todayIn(this.app.timeZone);
    await this.overrides
      .createQueryBuilder()
      .insert()
      .values({ school_id: schoolId, subject, subject_id: subjectId, on_date: onDate, reason, created_by: actor.id })
      .orUpdate(['reason', 'created_by'], ['subject', 'subject_id', 'on_date'])
      .execute();
    return (await this.todayOverrides(schoolId, subject, [subjectId])).get(subjectId)!;
  }
}
