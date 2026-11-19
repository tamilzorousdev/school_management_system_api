import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AppException, AuthUser, listQuery, Paginated } from '@app/common';
import { FilesService } from '../files/files.service';
import { Vehicle } from '../transport/entities/vehicle.entity';
import { PreTripCheckDto, PreTripInputDto, PreTripQueryDto, PreTripTodayRowDto } from './dto/fleet-maintenance.dto';
import { CRITICAL_PRE_TRIP_ITEMS, PreTripCheck, PreTripItem } from './entities/fleet-maintenance.entity';
import { FleetBooksService } from './fleet-books.service';
import { preTripResult } from './maintenance-plan.logic';
import { MaintenanceService } from './maintenance.service';

export const PRE_TRIP_LABELS: Record<PreTripItem, string> = {
  tyres: 'Tyres',
  brakes: 'Brakes',
  lights: 'Lights and indicators',
  horn: 'Horn',
  wipers: 'Wipers',
  mirrors: 'Mirrors',
  doors: 'Doors and emergency exit',
  first_aid: 'First-aid box',
  fire_extinguisher: 'Fire extinguisher',
  cleanliness: 'Clean inside',
};

@Injectable()
export class PreTripChecksService {
  constructor(
    @InjectRepository(PreTripCheck) private readonly checks: Repository<PreTripCheck>,
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    private readonly books: FleetBooksService,
    private readonly maintenance: MaintenanceService,
    private readonly files: FilesService,
  ) {}

  async list(schoolId: number, query: PreTripQueryDto): Promise<Paginated<PreTripCheckDto>> {
    const qb = this.checks
      .createQueryBuilder('c')
      .leftJoin(Vehicle, 'v', 'v.id = c.vehicle_id')
      .where('c.school_id = :schoolId', { schoolId });
    if (query.vehicle_id) qb.andWhere('c.vehicle_id = :vehicleId', { vehicleId: query.vehicle_id });
    if (query.date) qb.andWhere('c.check_date = :date', { date: query.date });
    if (query.state === 'ok') qb.andWhere('c.failed_count = 0');
    if (query.state === 'failed') qb.andWhere('c.failed_count > 0');
    if (query.state === 'blocked') qb.andWhere('c.critical_failed = true AND c.cleared_at IS NULL');
    const page = await listQuery(qb, query, {
      searchable: ['v.registration_no', 'v.name'],
      sortable: { check_date: 'c.check_date', created_at: 'c.created_at' },
      defaultSort: 'check_date',
    });
    return { ...page, items: await this.present(page.items) };
  }

  async board(schoolId: number): Promise<PreTripTodayRowDto[]> {
    const buses = await this.vehicles.find({
      where: { school_id: schoolId, status: 'active' },
      order: { name: 'ASC' },
    });
    if (!buses.length) return [];
    const today = this.books.today();
    const rows = await this.checks.find({ where: { school_id: schoolId, check_date: today } });
    const views = new Map((await this.present(rows)).map((view) => [view.vehicle.id, view]));
    const offRoad = await Promise.all(buses.map((bus) => this.maintenance.isOffRoad(schoolId, bus.id)));
    return buses.map((bus, index) => ({
      vehicle: { id: bus.id, registration_no: bus.registration_no, name: bus.name },
      check: views.get(bus.id) ?? null,
      off_road: offRoad[index]!,
    }));
  }

  async get(schoolId: number, id: number): Promise<PreTripCheckDto> {
    return (await this.present([await this.find(schoolId, id)]))[0]!;
  }

  async today(schoolId: number, vehicleId: number): Promise<PreTripCheckDto | null> {
    const row = await this.checks.findOneBy({
      school_id: schoolId,
      vehicle_id: vehicleId,
      check_date: this.books.today(),
    });
    return row ? (await this.present([row]))[0]! : null;
  }

  async submit(schoolId: number, vehicle: Vehicle, dto: PreTripInputDto, actor: AuthUser): Promise<PreTripCheckDto> {
    const today = this.books.today();
    const existing = await this.checks.findOneBy({ school_id: schoolId, vehicle_id: vehicle.id, check_date: today });
    if (existing?.critical_failed && !existing.cleared_at) {
      throw AppException.conflict(
        'Today’s check found a safety problem. Wait for the transport office to clear it before checking again.',
        'CHECK_BLOCKED',
      );
    }
    if (dto.photo_file_id) await this.files.assertAttachable(dto.photo_file_id, schoolId, 'photo_file_id');
    const result = preTripResult(dto.items);
    let ticketId = existing?.ticket_id ?? null;
    if (result.failed.length && !ticketId) {
      const notes = result.items
        .filter((mark) => !mark.ok)
        .map((mark) => `${PRE_TRIP_LABELS[mark.item]}${mark.note ? `: ${mark.note}` : ''}`);
      ticketId = await this.maintenance.openFromCheck(
        schoolId,
        vehicle,
        {
          title: `Pre-trip check: ${result.failed.map((item) => PRE_TRIP_LABELS[item]).join(', ')} not OK`,
          description: notes.join('\n'),
          photo_file_id: dto.photo_file_id ?? null,
          odometer_km: dto.odometer_km ?? null,
        },
        actor,
      );
    }
    const values = {
      school_id: schoolId,
      vehicle_id: vehicle.id,
      check_date: today,
      checked_by: actor.id,
      items: result.items,
      odometer_km: dto.odometer_km ?? null,
      failed_count: result.failed.length,
      critical_failed: result.critical_failed,
      ticket_id: ticketId,
      photo_file_id: dto.photo_file_id ?? null,
      cleared_by: null,
      cleared_at: null,
      clear_note: null,
      created_by: actor.id,
    };
    const saved = existing
      ? await this.checks.save(this.checks.merge(existing, values))
      : await this.checks.save(this.checks.create(values));
    return (await this.present([saved]))[0]!;
  }

  async clear(schoolId: number, id: number, note: string, actor: AuthUser): Promise<PreTripCheckDto> {
    const check = await this.find(schoolId, id);
    if (!check.critical_failed || check.cleared_at) {
      throw AppException.conflict('This check is not blocking the bus', 'CHECK_NOT_BLOCKED');
    }
    await this.checks.update(check.id, { cleared_by: actor.id, cleared_at: new Date(), clear_note: note });
    return this.get(schoolId, id);
  }

  async blockedCount(schoolId: number): Promise<number> {
    return this.checks.count({
      where: { school_id: schoolId, check_date: this.books.today(), critical_failed: true, cleared_at: IsNull() },
    });
  }

  private async find(schoolId: number, id: number): Promise<PreTripCheck> {
    const check = await this.checks.findOneBy({ id, school_id: schoolId });
    if (!check) throw AppException.notFound('Pre-trip check not found', 'CHECK_NOT_FOUND');
    return check;
  }

  private async present(rows: PreTripCheck[]): Promise<PreTripCheckDto[]> {
    if (!rows.length) return [];
    const [buses, people, files] = await Promise.all([
      this.books.busRefs(rows.map((row) => row.vehicle_id)),
      this.books.people(rows.flatMap((row) => [row.checked_by, row.cleared_by])),
      this.files.presentMany(rows.map((row) => row.photo_file_id)),
    ]);
    return rows.map((row) => ({
      id: row.id,
      vehicle: buses.get(row.vehicle_id) ?? { id: row.vehicle_id, registration_no: '', name: '' },
      check_date: row.check_date,
      checked_by: people.get(row.checked_by) ?? { id: row.checked_by, name: '' },
      items: row.items.map((mark) => ({
        item: mark.item,
        label: PRE_TRIP_LABELS[mark.item],
        ok: mark.ok,
        note: mark.note,
        critical: CRITICAL_PRE_TRIP_ITEMS.includes(mark.item),
      })),
      odometer_km: row.odometer_km,
      failed_count: row.failed_count,
      critical_failed: row.critical_failed,
      blocked: row.critical_failed && !row.cleared_at,
      ticket_id: row.ticket_id,
      photo_file: row.photo_file_id ? (files.get(row.photo_file_id) ?? null) : null,
      cleared_by: row.cleared_by ? (people.get(row.cleared_by) ?? null) : null,
      cleared_at: row.cleared_at,
      clear_note: row.clear_note,
      created_at: row.created_at,
    }));
  }
}
