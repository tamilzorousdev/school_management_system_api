import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AppException, listQuery, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { bookingConflicts, partyFits } from './canteen-supply.logic';
import {
  CanteenBookingDto,
  CanteenBookingInputDto,
  CanteenBookingQueryDto,
  CanteenBookingReleaseDto,
  CanteenTableDto,
  CanteenTableInputDto,
  CanteenTableLayoutQueryDto,
  CanteenTableLayoutRowDto,
  CanteenTableQueryDto,
  CanteenTablesInsightsDto,
  CanteenTableUpdateDto,
} from './dto/canteen-supply.dto';
import { CanteenDiner } from './entities/canteen-sales.entity';
import { CanteenTable, TableBooking, TableStatus } from './entities/canteen-supply.entity';

const TABLE_SORTS = { name: 't.name', seats: 't.seats', area: 't.area', created_at: 't.created_at' };
const BOOKING_SORTS = { booking_date: 'b.booking_date', slot: 'b.slot', created_at: 'b.created_at' };
const LIVE_STATUSES = ['reserved', 'seated'];

const tableDto = (row: CanteenTable): CanteenTableDto => ({
  id: row.id,
  name: row.name,
  area: row.area,
  seats: row.seats,
  status: row.status,
  active: row.active,
});

@Injectable()
export class CanteenTablesService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
    @InjectRepository(CanteenTable) private readonly tables: Repository<CanteenTable>,
    @InjectRepository(TableBooking) private readonly bookings: Repository<TableBooking>,
  ) {}

  private today(): string {
    return todayIn(this.app.timeZone);
  }

  private async findTable(schoolId: number, id: number): Promise<CanteenTable> {
    const table = await this.tables.findOne({ where: { id, school_id: schoolId } });
    if (!table) throw AppException.notFound('Table not found', 'TABLE_NOT_FOUND');
    return table;
  }

  private async assertTableName(schoolId: number, name: string, exceptId?: number): Promise<void> {
    const clash = await this.tables
      .createQueryBuilder('t')
      .where('t.school_id = :schoolId AND LOWER(t.name) = LOWER(:name)', { schoolId, name })
      .andWhere(exceptId ? 't.id <> :exceptId' : '1=1', { exceptId })
      .getExists();
    if (clash) throw AppException.conflict('A table with this name already exists', 'TABLE_EXISTS');
  }

  async list(schoolId: number, query: CanteenTableQueryDto): Promise<Paginated<CanteenTableDto>> {
    const qb = this.tables.createQueryBuilder('t').where('t.school_id = :schoolId', { schoolId });
    if (query.status) qb.andWhere('t.status = :status', { status: query.status });
    if (query.area) qb.andWhere('t.area = :area', { area: query.area });
    if (query.active !== undefined) qb.andWhere('t.active = :active', { active: query.active });
    const page = await listQuery(qb, query, {
      searchable: ['t.name', 't.area'],
      sortable: TABLE_SORTS,
      defaultSort: 'name',
    });
    return { ...page, items: page.items.map(tableDto) };
  }

  async get(schoolId: number, id: number): Promise<CanteenTableDto> {
    return tableDto(await this.findTable(schoolId, id));
  }

  async create(schoolId: number, dto: CanteenTableInputDto): Promise<CanteenTableDto> {
    await this.assertTableName(schoolId, dto.name);
    const saved = await this.tables.save(
      this.tables.create({
        school_id: schoolId,
        name: dto.name,
        area: dto.area ?? null,
        seats: dto.seats,
        status: 'free',
        active: dto.active ?? true,
      }),
    );
    return tableDto(saved);
  }

  async update(schoolId: number, id: number, dto: CanteenTableUpdateDto): Promise<CanteenTableDto> {
    await this.findTable(schoolId, id);
    if (dto.name !== undefined) await this.assertTableName(schoolId, dto.name, id);
    const changes = Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined));
    await this.tables.update({ id, school_id: schoolId }, changes);
    return this.get(schoolId, id);
  }

  async setStatus(schoolId: number, id: number, status: TableStatus): Promise<CanteenTableDto> {
    await this.findTable(schoolId, id);
    await this.tables.update({ id, school_id: schoolId }, { status });
    return this.get(schoolId, id);
  }

  async remove(schoolId: number, id: number): Promise<void> {
    await this.findTable(schoolId, id);
    const live = await this.bookings.exists({
      where: { school_id: schoolId, table_id: id, status: In(LIVE_STATUSES) },
    });
    if (live) throw AppException.conflict('This table has active bookings', 'TABLE_IN_USE');
    await this.tables.softDelete({ id, school_id: schoolId });
  }

  private async toBookingDtos(schoolId: number, rows: TableBooking[]): Promise<CanteenBookingDto[]> {
    if (!rows.length) return [];
    const tables = await this.tables.find({
      where: { school_id: schoolId, id: In([...new Set(rows.map((row) => row.table_id))]) },
      withDeleted: true,
    });
    const names = new Map(tables.map((table) => [table.id, table.name]));
    return rows.map((row) => ({
      id: row.id,
      table_id: row.table_id,
      table_name: names.get(row.table_id) ?? '',
      booking_date: row.booking_date,
      slot: row.slot,
      party_size: row.party_size,
      diner_id: row.diner_id,
      guest_name: row.guest_name,
      status: row.status,
      seated_at: row.seated_at,
      released_at: row.released_at,
    }));
  }

  async layout(schoolId: number, query: CanteenTableLayoutQueryDto): Promise<CanteenTableLayoutRowDto[]> {
    const date = query.date ?? this.today();
    const tables = await this.tables.find({ where: { school_id: schoolId, active: true }, order: { name: 'ASC' } });
    const bookingQb = this.bookings
      .createQueryBuilder('b')
      .where('b.school_id = :schoolId AND b.booking_date = :date AND b.status IN (:...live)', {
        schoolId,
        date,
        live: LIVE_STATUSES,
      })
      .orderBy('b.id', 'ASC');
    if (query.slot) bookingQb.andWhere('b.slot = :slot', { slot: query.slot });
    const bookings = await this.toBookingDtos(schoolId, await bookingQb.getMany());
    const byTable = new Map<number, CanteenBookingDto>();
    for (const booking of bookings) {
      const current = byTable.get(booking.table_id);
      if (!current || (current.status === 'reserved' && booking.status === 'seated'))
        byTable.set(booking.table_id, booking);
    }
    return tables.map((table) => ({ ...tableDto(table), booking: byTable.get(table.id) ?? null }));
  }

  async listBookings(schoolId: number, query: CanteenBookingQueryDto): Promise<Paginated<CanteenBookingDto>> {
    const qb = this.bookings
      .createQueryBuilder('b')
      .leftJoin(CanteenTable, 't', 't.id = b.table_id')
      .where('b.school_id = :schoolId', { schoolId });
    if (query.date) qb.andWhere('b.booking_date = :date', { date: query.date });
    if (query.slot) qb.andWhere('b.slot = :slot', { slot: query.slot });
    if (query.status) qb.andWhere('b.status = :status', { status: query.status });
    if (query.table_id) qb.andWhere('b.table_id = :tableId', { tableId: query.table_id });
    const page = await listQuery(qb, query, {
      searchable: ['b.guest_name', 't.name'],
      sortable: BOOKING_SORTS,
      defaultSort: 'booking_date',
    });
    return { ...page, items: await this.toBookingDtos(schoolId, page.items) };
  }

  private async findBooking(manager: EntityManager, schoolId: number, id: number): Promise<TableBooking> {
    const booking = await manager.findOne(TableBooking, {
      where: { id, school_id: schoolId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!booking) throw AppException.notFound('Booking not found', 'BOOKING_NOT_FOUND');
    return booking;
  }

  async book(schoolId: number, dto: CanteenBookingInputDto): Promise<CanteenBookingDto> {
    if (!dto.diner_id && !dto.guest_name) {
      throw AppException.badRequest('Give a diner or a guest name', 'BOOKING_GUEST_REQUIRED');
    }
    if (dto.diner_id) {
      const diner = await this.dataSource
        .getRepository(CanteenDiner)
        .exists({ where: { id: dto.diner_id, school_id: schoolId } });
      if (!diner) throw AppException.badRequest('Diner not found', 'DINER_NOT_FOUND');
    }
    const id = await this.dataSource.transaction(async (manager) => {
      const table = await manager.findOne(CanteenTable, {
        where: { id: dto.table_id, school_id: schoolId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!table) throw AppException.notFound('Table not found', 'TABLE_NOT_FOUND');
      if (!table.active) throw AppException.conflict('This table is not in use', 'TABLE_INACTIVE');
      if (!partyFits(dto.party_size, table.seats)) {
        throw AppException.badRequest(`This table seats ${table.seats}`, 'PARTY_TOO_LARGE');
      }
      const existing = await manager.find(TableBooking, {
        where: {
          school_id: schoolId,
          table_id: table.id,
          booking_date: dto.booking_date,
          slot: dto.slot,
          status: In(LIVE_STATUSES),
        },
      });
      const candidate = { table_id: table.id, booking_date: dto.booking_date, slot: dto.slot, status: 'reserved' };
      if (bookingConflicts(existing, candidate)) {
        throw AppException.conflict('This table is already booked for that slot', 'TABLE_BOOKED');
      }
      const saved = await manager.save(
        manager.create(TableBooking, {
          school_id: schoolId,
          table_id: table.id,
          booking_date: dto.booking_date,
          slot: dto.slot,
          party_size: dto.party_size,
          diner_id: dto.diner_id ?? null,
          guest_name: dto.guest_name ?? null,
          status: 'reserved',
        }),
      );
      return saved.id;
    });
    return this.bookingDto(schoolId, id);
  }

  private async bookingDto(schoolId: number, id: number): Promise<CanteenBookingDto> {
    const booking = await this.bookings.findOneByOrFail({ id, school_id: schoolId });
    const [dto] = await this.toBookingDtos(schoolId, [booking]);
    return dto!;
  }

  async seat(schoolId: number, id: number): Promise<CanteenBookingDto> {
    await this.dataSource.transaction(async (manager) => {
      const booking = await this.findBooking(manager, schoolId, id);
      if (booking.status !== 'reserved') {
        throw AppException.conflict('Only a reserved booking can be seated', 'BOOKING_STATE_INVALID');
      }
      const table = await manager.findOneOrFail(CanteenTable, {
        where: { id: booking.table_id, school_id: schoolId },
        lock: { mode: 'pessimistic_write' },
      });
      if (table.status === 'occupied') throw AppException.conflict('This table is occupied', 'TABLE_OCCUPIED');
      await manager.update(CanteenTable, table.id, { status: 'occupied' });
      await manager.update(TableBooking, booking.id, { status: 'seated', seated_at: new Date() });
    });
    return this.bookingDto(schoolId, id);
  }

  async release(schoolId: number, id: number, dto: CanteenBookingReleaseDto): Promise<CanteenBookingDto> {
    await this.dataSource.transaction(async (manager) => {
      const booking = await this.findBooking(manager, schoolId, id);
      if (booking.status !== 'seated') {
        throw AppException.conflict('Only a seated booking can be released', 'BOOKING_STATE_INVALID');
      }
      await manager.update(TableBooking, booking.id, { status: 'completed', released_at: new Date() });
      await manager.update(CanteenTable, booking.table_id, { status: dto.needs_cleaning ? 'cleaning' : 'free' });
    });
    return this.bookingDto(schoolId, id);
  }

  async cancelBooking(schoolId: number, id: number): Promise<CanteenBookingDto> {
    await this.dataSource.transaction(async (manager) => {
      const booking = await this.findBooking(manager, schoolId, id);
      if (!LIVE_STATUSES.includes(booking.status)) {
        throw AppException.conflict('This booking is already finished', 'BOOKING_STATE_INVALID');
      }
      if (booking.status === 'seated') await manager.update(CanteenTable, booking.table_id, { status: 'free' });
      await manager.update(TableBooking, booking.id, { status: 'cancelled' });
    });
    return this.bookingDto(schoolId, id);
  }

  async insights(schoolId: number): Promise<CanteenTablesInsightsDto> {
    const [row] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total_tables,
        COALESCE(SUM(seats), 0)::int AS total_seats,
        COALESCE(SUM(seats) FILTER (WHERE status = 'occupied'), 0)::int AS occupied_seats,
        COALESCE(SUM(seats) FILTER (WHERE status = 'free'), 0)::int AS free_seats,
        COUNT(*) FILTER (WHERE status = 'occupied')::int AS occupied_tables,
        COUNT(*) FILTER (WHERE status = 'free')::int AS free_tables
       FROM canteen_tables WHERE school_id = $1 AND deleted_at IS NULL AND active = true`,
      [schoolId],
    );
    const reserved = await this.bookings.count({
      where: { school_id: schoolId, booking_date: this.today(), status: 'reserved' },
    });
    return { ...row, reserved_today: reserved };
  }
}
