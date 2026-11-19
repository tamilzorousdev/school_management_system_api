import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AppException, AuthUser, FieldError, Paginated, paginate } from '@app/common';
import { ROLES } from '../access/access.catalog';
import { NotificationsService } from '../notifications/notifications.service';
import { Vehicle } from '../transport/entities/vehicle.entity';
import {
  ApplyStandardDto,
  ApplyStandardResultDto,
  ScheduleDto,
  ScheduleInputDto,
  ScheduleQueryDto,
  UpdateScheduleDto,
} from './dto/fleet-maintenance.dto';
import { MaintenanceSchedule, ServiceCategory } from './entities/fleet-maintenance.entity';
import { FleetBooksService } from './fleet-books.service';
import { scheduleState, STANDARD_SCHEDULES } from './maintenance-plan.logic';

export const SERVICE_DUE_SOON_TEMPLATE = 'SERVICE_DUE_SOON';
export const SERVICE_OVERDUE_TEMPLATE = 'SERVICE_OVERDUE';

export const CATEGORY_LABELS: Record<string, string> = {
  engine_oil: 'Engine oil',
  tyres: 'Tyres',
  brakes: 'Brakes',
  battery: 'Battery',
  ac: 'AC',
  body: 'Body',
  electrical: 'Electrical',
  general_service: 'General service',
  other: 'Other',
};

const URGENCY = { overdue: 0, due_soon: 1, ok: 2 } as const;

@Injectable()
export class MaintenanceSchedulesService {
  private readonly logger = new Logger('MaintenanceSchedules');

  constructor(
    @InjectRepository(MaintenanceSchedule) private readonly schedules: Repository<MaintenanceSchedule>,
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    private readonly books: FleetBooksService,
    private readonly notifications: NotificationsService,
    private readonly dataSource: DataSource,
  ) {}

  async list(schoolId: number, query: ScheduleQueryDto): Promise<Paginated<ScheduleDto>> {
    const qb = this.schedules
      .createQueryBuilder('s')
      .leftJoin(Vehicle, 'v', 'v.id = s.vehicle_id')
      .where('s.school_id = :schoolId', { schoolId });
    if (query.vehicle_id) qb.andWhere('s.vehicle_id = :vehicleId', { vehicleId: query.vehicle_id });
    if (query.category) qb.andWhere('s.category = :category', { category: query.category });
    for (const [index, word] of (query.search ?? '').split(/\s+/).filter(Boolean).entries()) {
      qb.andWhere(`(s.title ILIKE :w${index} OR v.registration_no ILIKE :w${index} OR v.name ILIKE :w${index})`, {
        [`w${index}`]: `%${word.replace(/[\\%_]/g, (match) => `\\${match}`)}%`,
      });
    }
    let items = await this.present(schoolId, await qb.orderBy('s.id', 'ASC').getMany());
    if (query.status) items = items.filter((item) => item.status === query.status);
    items.sort(
      (a, b) =>
        URGENCY[a.status] - URGENCY[b.status] ||
        (a.days_left ?? Infinity) - (b.days_left ?? Infinity) ||
        (a.km_left ?? Infinity) - (b.km_left ?? Infinity) ||
        a.id - b.id,
    );
    const start = (query.page - 1) * query.limit;
    return paginate([items.slice(start, start + query.limit), items.length], query.page, query.limit);
  }

  async get(schoolId: number, id: number): Promise<ScheduleDto> {
    return (await this.present(schoolId, [await this.find(schoolId, id)]))[0]!;
  }

  async forBuses(schoolId: number, vehicleIds: number[]): Promise<ScheduleDto[]> {
    if (!vehicleIds.length) return [];
    const rows = await this.schedules.find({
      where: { school_id: schoolId, vehicle_id: In(vehicleIds), is_active: true },
      order: { id: 'ASC' },
    });
    return (await this.present(schoolId, rows)).sort(
      (a, b) => URGENCY[a.status] - URGENCY[b.status] || (a.days_left ?? Infinity) - (b.days_left ?? Infinity),
    );
  }

  async due(schoolId: number): Promise<ScheduleDto[]> {
    const rows = await this.schedules.find({ where: { school_id: schoolId, is_active: true } });
    return (await this.present(schoolId, rows))
      .filter((item) => item.status !== 'ok')
      .sort(
        (a, b) =>
          URGENCY[a.status] - URGENCY[b.status] ||
          (a.days_left ?? Infinity) - (b.days_left ?? Infinity) ||
          (a.km_left ?? Infinity) - (b.km_left ?? Infinity),
      );
  }

  async create(schoolId: number, dto: ScheduleInputDto, actor: AuthUser): Promise<ScheduleDto[]> {
    this.assertInterval(dto.every_km ?? null, dto.every_months ?? null);
    const lastDoneOn = dto.last_done_on ?? this.books.today();
    if (lastDoneOn > this.books.today()) {
      throw AppException.validation([{ field: 'last_done_on', message: 'last_done_on cannot be in the future' }]);
    }
    const buses = await this.vehicles.findBy({ id: In(dto.vehicle_ids), school_id: schoolId });
    if (buses.length !== dto.vehicle_ids.length) throw AppException.notFound('Bus not found', 'VEHICLE_NOT_FOUND');
    const taken = await this.schedules.find({
      where: { school_id: schoolId, vehicle_id: In(dto.vehicle_ids), category: dto.category, is_active: true },
    });
    if (taken.length) {
      const names = buses
        .filter((bus) => taken.some((row) => row.vehicle_id === bus.id))
        .map((bus) => bus.registration_no);
      throw AppException.conflict(
        `${names.join(', ')} already ${names.length === 1 ? 'has' : 'have'} a ${CATEGORY_LABELS[dto.category]} rule. Edit it instead.`,
        'SCHEDULE_EXISTS',
      );
    }
    const km = await this.books.currentKm(dto.vehicle_ids);
    const saved = await this.schedules.save(
      dto.vehicle_ids.map((vehicleId) =>
        this.schedules.create({
          school_id: schoolId,
          vehicle_id: vehicleId,
          category: dto.category,
          title: dto.title ?? CATEGORY_LABELS[dto.category]!,
          every_km: dto.every_km ?? null,
          every_months: dto.every_months ?? null,
          last_done_on: lastDoneOn,
          last_done_km: dto.last_done_km ?? km.get(vehicleId)?.km ?? null,
          is_active: true,
          created_by: actor.id,
        }),
      ),
    );
    return this.present(schoolId, saved);
  }

  async update(schoolId: number, id: number, dto: UpdateScheduleDto): Promise<ScheduleDto> {
    const schedule = await this.find(schoolId, id);
    const everyKm = dto.every_km === undefined ? schedule.every_km : dto.every_km;
    const everyMonths = dto.every_months === undefined ? schedule.every_months : dto.every_months;
    this.assertInterval(everyKm, everyMonths);
    if (dto.last_done_on && dto.last_done_on > this.books.today()) {
      throw AppException.validation([{ field: 'last_done_on', message: 'last_done_on cannot be in the future' }]);
    }
    const changes: Partial<MaintenanceSchedule> = { alerted_status: null };
    for (const key of ['title', 'every_km', 'every_months', 'last_done_on', 'last_done_km', 'is_active'] as const) {
      if (dto[key] !== undefined) Object.assign(changes, { [key]: dto[key] });
    }
    await this.schedules.save(this.schedules.merge(schedule, changes));
    return this.get(schoolId, id);
  }

  async remove(schoolId: number, id: number): Promise<void> {
    const schedule = await this.find(schoolId, id);
    await this.schedules.softDelete(schedule.id);
  }

  async applyStandard(schoolId: number, dto: ApplyStandardDto, actor: AuthUser): Promise<ApplyStandardResultDto> {
    const buses = await this.vehicles.find({
      where: dto.vehicle_ids
        ? { id: In(dto.vehicle_ids), school_id: schoolId }
        : { school_id: schoolId, status: 'active' },
    });
    if (dto.vehicle_ids && buses.length !== dto.vehicle_ids.length) {
      throw AppException.notFound('Bus not found', 'VEHICLE_NOT_FOUND');
    }
    if (!buses.length) return { added: 0, buses: 0 };
    const existing = await this.schedules.find({
      where: { school_id: schoolId, vehicle_id: In(buses.map((bus) => bus.id)), is_active: true },
    });
    const km = await this.books.currentKm(buses.map((bus) => bus.id));
    const rows = buses.flatMap((bus) =>
      STANDARD_SCHEDULES.filter(
        (rule) => !existing.some((row) => row.vehicle_id === bus.id && row.category === rule.category),
      ).map((rule) =>
        this.schedules.create({
          school_id: schoolId,
          vehicle_id: bus.id,
          category: rule.category,
          title: rule.title,
          every_km: rule.every_km,
          every_months: rule.every_months,
          last_done_on: this.books.today(),
          last_done_km: km.get(bus.id)?.km ?? null,
          is_active: true,
          created_by: actor.id,
        }),
      ),
    );
    if (rows.length) await this.schedules.save(rows);
    return { added: rows.length, buses: buses.length };
  }

  async markDone(
    schoolId: number,
    target: { schedule_id: number | null; vehicle_id: number; category: ServiceCategory | null },
    onDate: string,
    km: number | null,
  ): Promise<void> {
    const schedule = target.schedule_id
      ? await this.schedules.findOneBy({ id: target.schedule_id, school_id: schoolId, vehicle_id: target.vehicle_id })
      : target.category
        ? await this.schedules.findOneBy({
            school_id: schoolId,
            vehicle_id: target.vehicle_id,
            category: target.category,
            is_active: true,
          })
        : null;
    if (!schedule) return;
    const currentKm = km ?? (await this.books.currentKm([target.vehicle_id])).get(target.vehicle_id)?.km ?? null;
    await this.schedules.update(schedule.id, {
      last_done_on: onDate,
      last_done_km: currentKm ?? schedule.last_done_km,
      alerted_status: null,
      alerted_at: null,
    });
  }

  async assertForBus(schoolId: number, scheduleId: number | null | undefined, vehicleId: number): Promise<void> {
    if (!scheduleId) return;
    const found = await this.schedules.findOneBy({ id: scheduleId, school_id: schoolId, vehicle_id: vehicleId });
    if (!found) {
      throw AppException.validation([
        { field: 'schedule_id', message: 'schedule_id must be a service rule of this bus' },
      ]);
    }
  }

  @Cron('0 7 * * *', { name: 'service-due-alerts', timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' })
  async alertDue(): Promise<void> {
    const schools: { school_id: number }[] = await this.dataSource.query(
      `SELECT DISTINCT school_id FROM maintenance_schedules WHERE deleted_at IS NULL AND is_active = true`,
    );
    for (const { school_id: schoolId } of schools) {
      await this.alertSchool(Number(schoolId)).catch((error: Error) =>
        this.logger.warn(`Service alerts for school ${schoolId} failed: ${error.message}`),
      );
    }
  }

  async alertSchool(schoolId: number): Promise<number> {
    const rows = await this.schedules.find({ where: { school_id: schoolId, is_active: true } });
    const states = await this.present(schoolId, rows);
    let sent = 0;
    for (const state of states) {
      const row = rows.find((item) => item.id === state.id)!;
      if (state.status === 'ok' || row.alerted_status === state.status) continue;
      await this.schedules.update(row.id, { alerted_status: state.status, alerted_at: new Date() });
      await this.notifications
        .dispatch({
          template: state.status === 'overdue' ? SERVICE_OVERDUE_TEMPLATE : SERVICE_DUE_SOON_TEMPLATE,
          audience: { roles: [ROLES.TRANSPORT_INCHARGE, ROLES.ADMIN], school_id: schoolId },
          data: {
            bus: `${state.vehicle.name} (${state.vehicle.registration_no})`,
            service: state.title,
            due: dueText(state),
            vehicle_id: state.vehicle.id,
            schedule_id: state.id,
          },
        })
        .then(() => sent++)
        .catch((error: Error) => this.logger.warn(`Service alert ${row.id} not sent: ${error.message}`));
    }
    return sent;
  }

  async present(schoolId: number, rows: MaintenanceSchedule[]): Promise<ScheduleDto[]> {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.vehicle_id);
    const [settings, km, buses] = await Promise.all([
      this.books.settings(schoolId),
      this.books.currentKm(ids),
      this.books.busRefs(ids),
    ]);
    const today = this.books.today();
    return rows.map((row) => {
      const current = km.get(row.vehicle_id)?.km ?? null;
      const state = scheduleState(
        {
          every_km: row.every_km,
          every_months: row.every_months,
          last_done_on: row.last_done_on,
          last_done_km: row.last_done_km,
        },
        row.is_active ? current : null,
        today,
        settings,
      );
      return {
        id: row.id,
        vehicle: buses.get(row.vehicle_id) ?? { id: row.vehicle_id, registration_no: '', name: '' },
        category: row.category,
        title: row.title,
        every_km: row.every_km,
        every_months: row.every_months,
        last_done_on: row.last_done_on,
        last_done_km: row.last_done_km,
        is_active: row.is_active,
        current_km: current,
        ...state,
        status: row.is_active ? state.status : 'ok',
      };
    });
  }

  private assertInterval(everyKm: number | null, everyMonths: number | null): void {
    if (everyKm || everyMonths) return;
    const errors: FieldError[] = [
      { field: 'every_km', message: 'Give every_km, every_months or both' },
      { field: 'every_months', message: 'Give every_km, every_months or both' },
    ];
    throw AppException.validation(errors);
  }

  private async find(schoolId: number, id: number): Promise<MaintenanceSchedule> {
    const schedule = await this.schedules.findOneBy({ id, school_id: schoolId });
    if (!schedule) throw AppException.notFound('Service rule not found', 'SCHEDULE_NOT_FOUND');
    return schedule;
  }
}

export function dueText(
  state: Pick<ScheduleDto, 'status' | 'days_left' | 'km_left' | 'next_due_on' | 'next_due_km'>,
): string {
  const parts: string[] = [];
  if (state.days_left !== null) {
    parts.push(
      state.days_left < 0 ? `${-state.days_left} days late` : `in ${state.days_left} days (${state.next_due_on})`,
    );
  }
  if (state.km_left !== null) {
    parts.push(state.km_left < 0 ? `${Math.round(-state.km_left)} km over` : `in ${Math.round(state.km_left)} km`);
  }
  return parts.join(', ') || 'now';
}
