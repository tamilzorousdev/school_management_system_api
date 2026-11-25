import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AppException, AuthUser, Paginated, paginate } from '@app/common';
import { escapeLike } from './hostel-sql';
import { yearClause } from '../../shared/year-context';
import { ROLES } from '../access/access.catalog';
import {
  AvailableBedDto,
  BedAvailabilityQueryDto,
  BedDto,
  BedOccupantDto,
  BedUpdateDto,
  BlockDto,
  BlockInputDto,
  BlockQueryDto,
  BlockUpdateDto,
  FloorDto,
  FloorInputDto,
  FloorQueryDto,
  FloorUpdateDto,
  HostelDashboardDto,
  HostelDto,
  HostelIdQueryDto,
  HostelInputDto,
  HostelUpdateDto,
  RoomBulkDto,
  RoomBulkResultDto,
  RoomDetailDto,
  RoomDto,
  RoomInputDto,
  RoomQueryDto,
  RoomTypeDto,
  RoomTypeInputDto,
  RoomTypeUpdateDto,
  RoomUpdateDto,
} from './dto/hostel-setup.dto';
import { Hostel, HostelBed, HostelBlock, HostelFloor, HostelRoom, HostelRoomType } from './entities/hostel.entity';
import { HostelSettingsService } from './hostel-settings.service';
import { bedLabels, occupancyPercent, roomNumbers } from './hostel.logic';

const HOSTEL_STAFF_ROLES = [ROLES.WARDEN, ROLES.ASSISTANT_WARDEN, ROLES.ADMIN, ROLES.PRINCIPAL];
const ROOM_SORTS: Record<string, string> = {
  room_no: 'r.room_no',
  created_at: 'r.created_at',
  capacity: 'r.capacity',
  vacant_beds: 'vacant_beds',
};

interface Counts {
  rooms: number;
  beds: number;
  occupied: number;
}

@Injectable()
export class HostelSetupService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly settings: HostelSettingsService,
    @InjectRepository(Hostel) private readonly hostels: Repository<Hostel>,
    @InjectRepository(HostelBlock) private readonly blocks: Repository<HostelBlock>,
    @InjectRepository(HostelFloor) private readonly floors: Repository<HostelFloor>,
    @InjectRepository(HostelRoomType) private readonly roomTypes: Repository<HostelRoomType>,
    @InjectRepository(HostelRoom) private readonly rooms: Repository<HostelRoom>,
    @InjectRepository(HostelBed) private readonly beds: Repository<HostelBed>,
  ) {}

  async listHostels(schoolId: number): Promise<HostelDto[]> {
    const rows: (Hostel & { warden_name: string | null })[] = await this.dataSource.query(
      `SELECT h.*, u.name AS warden_name FROM hostels h
       LEFT JOIN users u ON u.id = h.warden_user_id AND u.deleted_at IS NULL
       WHERE h.school_id = $1 AND h.deleted_at IS NULL ORDER BY h.name`,
      [schoolId],
    );
    const counts = await this.countsBy(schoolId, 'hostel_id');
    const blockCounts = await this.blockCounts(schoolId);
    return rows.map((row) => this.toHostel(row, row.warden_name, counts.get(row.id), blockCounts.get(row.id) ?? 0));
  }

  async getHostel(schoolId: number, id: number): Promise<HostelDto> {
    const hostel = (await this.listHostels(schoolId)).find((item) => item.id === id);
    if (!hostel) throw AppException.notFound('Hostel not found', 'HOSTEL_NOT_FOUND');
    return hostel;
  }

  async createHostel(schoolId: number, dto: HostelInputDto, actor: AuthUser): Promise<HostelDto> {
    await this.ensureUniqueHostelCode(schoolId, dto.code);
    if (dto.warden_user_id) await this.ensureHostelStaff(schoolId, dto.warden_user_id, 'warden_user_id');
    const saved = await this.hostels.save(
      this.hostels.create({
        school_id: schoolId,
        name: dto.name,
        code: dto.code,
        gender: dto.gender,
        status: dto.status ?? 'active',
        warden_user_id: dto.warden_user_id ?? null,
        phone: dto.phone ?? null,
        address: dto.address ?? null,
        notes: dto.notes ?? null,
        created_by: actor.id,
      }),
    );
    return this.getHostel(schoolId, saved.id);
  }

  async updateHostel(schoolId: number, id: number, dto: HostelUpdateDto): Promise<HostelDto> {
    const hostel = await this.findHostel(schoolId, id);
    if (dto.code && dto.code !== hostel.code) await this.ensureUniqueHostelCode(schoolId, dto.code);
    if (dto.warden_user_id) await this.ensureHostelStaff(schoolId, dto.warden_user_id, 'warden_user_id');
    Object.assign(hostel, this.defined(dto));
    await this.hostels.save(hostel);
    return this.getHostel(schoolId, id);
  }

  async removeHostel(schoolId: number, id: number): Promise<void> {
    await this.findHostel(schoolId, id);
    if (await this.blocks.countBy({ school_id: schoolId, hostel_id: id })) {
      throw AppException.conflict('Remove the blocks of this hostel first', 'HOSTEL_HAS_BLOCKS');
    }
    const [residents] = await this.dataSource.query(
      `SELECT 1 FROM hostel_admissions WHERE school_id = $1 AND hostel_id = $2 AND status <> 'checked_out' AND deleted_at IS NULL LIMIT 1`,
      [schoolId, id],
    );
    if (residents) throw AppException.conflict('Students are still admitted to this hostel', 'HOSTEL_HAS_STUDENTS');
    await this.hostels.softDelete(id);
  }

  async listBlocks(schoolId: number, query: BlockQueryDto): Promise<BlockDto[]> {
    const params: unknown[] = [schoolId];
    let filter = '';
    if (query.hostel_id) {
      params.push(query.hostel_id);
      filter = ` AND b.hostel_id = $2`;
    }
    const rows: (HostelBlock & { incharge_name: string | null; floor_count: string })[] = await this.dataSource.query(
      `SELECT b.*, u.name AS incharge_name,
         (SELECT COUNT(*) FROM hostel_floors f WHERE f.block_id = b.id AND f.deleted_at IS NULL) AS floor_count
       FROM hostel_blocks b
       LEFT JOIN users u ON u.id = b.incharge_user_id AND u.deleted_at IS NULL
       WHERE b.school_id = $1 AND b.deleted_at IS NULL${filter}
       ORDER BY b.hostel_id, b.sort_order, b.name`,
      params,
    );
    const counts = await this.countsBy(schoolId, 'block_id');
    return rows.map((row) => {
      const count = counts.get(row.id);
      return {
        id: row.id,
        hostel_id: row.hostel_id,
        name: row.name,
        code: row.code,
        sort_order: row.sort_order,
        incharge_user_id: row.incharge_user_id,
        incharge_name: row.incharge_name,
        floor_count: Number(row.floor_count),
        room_count: count?.rooms ?? 0,
        bed_count: count?.beds ?? 0,
        occupied_beds: count?.occupied ?? 0,
      };
    });
  }

  async createBlock(schoolId: number, dto: BlockInputDto, actor: AuthUser): Promise<BlockDto> {
    await this.findHostel(schoolId, dto.hostel_id);
    await this.ensureUniqueBlockCode(schoolId, dto.hostel_id, dto.code);
    if (dto.incharge_user_id) await this.ensureHostelStaff(schoolId, dto.incharge_user_id, 'incharge_user_id');
    const saved = await this.blocks.save(
      this.blocks.create({
        school_id: schoolId,
        hostel_id: dto.hostel_id,
        name: dto.name,
        code: dto.code,
        sort_order: dto.sort_order ?? 0,
        incharge_user_id: dto.incharge_user_id ?? null,
        created_by: actor.id,
      }),
    );
    return this.getBlock(schoolId, saved.id);
  }

  async updateBlock(schoolId: number, id: number, dto: BlockUpdateDto): Promise<BlockDto> {
    const block = await this.findBlock(schoolId, id);
    if (dto.hostel_id && dto.hostel_id !== block.hostel_id) {
      throw AppException.badRequest('A block cannot move to another hostel', 'HOSTEL_BLOCK_MOVE');
    }
    if (dto.code && dto.code !== block.code) await this.ensureUniqueBlockCode(schoolId, block.hostel_id, dto.code);
    if (dto.incharge_user_id) await this.ensureHostelStaff(schoolId, dto.incharge_user_id, 'incharge_user_id');
    Object.assign(block, this.defined({ ...dto, hostel_id: undefined }));
    await this.blocks.save(block);
    return this.getBlock(schoolId, id);
  }

  async removeBlock(schoolId: number, id: number): Promise<void> {
    await this.findBlock(schoolId, id);
    if (await this.floors.countBy({ school_id: schoolId, block_id: id })) {
      throw AppException.conflict('Remove the floors of this block first', 'HOSTEL_BLOCK_HAS_FLOORS');
    }
    await this.blocks.softDelete(id);
  }

  async listFloors(schoolId: number, query: FloorQueryDto): Promise<FloorDto[]> {
    const where: Record<string, number> = { school_id: schoolId };
    if (query.hostel_id) where.hostel_id = query.hostel_id;
    if (query.block_id) where.block_id = query.block_id;
    const rows = await this.floors.find({ where, order: { block_id: 'ASC', level: 'ASC' } });
    const counts = await this.countsBy(schoolId, 'floor_id');
    return rows.map((row) => this.toFloor(row, counts.get(row.id)));
  }

  async createFloor(schoolId: number, dto: FloorInputDto, actor: AuthUser): Promise<FloorDto> {
    const block = await this.findBlock(schoolId, dto.block_id);
    await this.ensureUniqueLevel(schoolId, block.id, dto.level);
    const saved = await this.floors.save(
      this.floors.create({
        school_id: schoolId,
        hostel_id: block.hostel_id,
        block_id: block.id,
        name: dto.name,
        level: dto.level,
        created_by: actor.id,
      }),
    );
    return this.toFloor(saved, undefined);
  }

  async updateFloor(schoolId: number, id: number, dto: FloorUpdateDto): Promise<FloorDto> {
    const floor = await this.findFloor(schoolId, id);
    if (dto.block_id && dto.block_id !== floor.block_id) {
      throw AppException.badRequest('A floor cannot move to another block', 'HOSTEL_FLOOR_MOVE');
    }
    if (dto.level !== undefined && dto.level !== floor.level)
      await this.ensureUniqueLevel(schoolId, floor.block_id, dto.level);
    if (dto.name !== undefined) floor.name = dto.name;
    if (dto.level !== undefined) floor.level = dto.level;
    await this.floors.save(floor);
    const counts = await this.countsBy(schoolId, 'floor_id');
    return this.toFloor(floor, counts.get(id));
  }

  async removeFloor(schoolId: number, id: number): Promise<void> {
    await this.findFloor(schoolId, id);
    if (await this.rooms.countBy({ school_id: schoolId, floor_id: id })) {
      throw AppException.conflict('Remove the rooms on this floor first', 'HOSTEL_FLOOR_HAS_ROOMS');
    }
    await this.floors.softDelete(id);
  }

  async listRoomTypes(schoolId: number): Promise<RoomTypeDto[]> {
    const rows: (HostelRoomType & { room_count: string })[] = await this.dataSource.query(
      `SELECT t.*, (SELECT COUNT(*) FROM hostel_rooms r WHERE r.room_type_id = t.id AND r.deleted_at IS NULL) AS room_count
       FROM hostel_room_types t WHERE t.school_id = $1 AND t.deleted_at IS NULL ORDER BY t.name`,
      [schoolId],
    );
    return rows.map((row) => this.toRoomType(row, Number(row.room_count)));
  }

  async createRoomType(schoolId: number, dto: RoomTypeInputDto, actor: AuthUser): Promise<RoomTypeDto> {
    await this.ensureUniqueRoomTypeCode(schoolId, dto.code);
    const saved = await this.roomTypes.save(
      this.roomTypes.create({
        school_id: schoolId,
        name: dto.name,
        code: dto.code,
        default_beds: dto.default_beds,
        is_ac: dto.is_ac ?? false,
        attached_bathroom: dto.attached_bathroom ?? false,
        annual_fee: dto.annual_fee ?? 0,
        amenities: dto.amenities ?? null,
        created_by: actor.id,
      }),
    );
    return this.toRoomType(saved, 0);
  }

  async updateRoomType(schoolId: number, id: number, dto: RoomTypeUpdateDto): Promise<RoomTypeDto> {
    const type = await this.findRoomType(schoolId, id);
    if (dto.code && dto.code !== type.code) await this.ensureUniqueRoomTypeCode(schoolId, dto.code);
    Object.assign(type, this.defined(dto));
    await this.roomTypes.save(type);
    const roomCount = await this.rooms.countBy({ school_id: schoolId, room_type_id: id });
    return this.toRoomType(type, roomCount);
  }

  async removeRoomType(schoolId: number, id: number): Promise<void> {
    await this.findRoomType(schoolId, id);
    if (await this.rooms.countBy({ school_id: schoolId, room_type_id: id })) {
      throw AppException.conflict('Rooms still use this room type', 'HOSTEL_ROOM_TYPE_IN_USE');
    }
    await this.roomTypes.softDelete(id);
  }

  async listRooms(schoolId: number, query: RoomQueryDto): Promise<Paginated<RoomDto>> {
    const params: unknown[] = [schoolId];
    const where = ['r.school_id = $1', 'r.deleted_at IS NULL'];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (query.hostel_id) add('r.hostel_id = ?', query.hostel_id);
    if (query.block_id) add('r.block_id = ?', query.block_id);
    if (query.floor_id) add('r.floor_id = ?', query.floor_id);
    if (query.room_type_id) add('r.room_type_id = ?', query.room_type_id);
    if (query.status) add('r.status = ?', query.status);
    for (const word of (query.search ?? '').split(/\s+/).filter(Boolean)) {
      const slot = `$${params.push(`%${escapeLike(word)}%`)}`;
      where.push(`(r.room_no ILIKE ${slot} OR b.name ILIKE ${slot} OR t.name ILIKE ${slot})`);
    }
    const sortKey = query.sort ?? 'room_no';
    const sort = ROOM_SORTS[sortKey];
    if (!sort)
      throw AppException.badRequest(`sort must be one of ${Object.keys(ROOM_SORTS).join(', ')}`, 'INVALID_SORT');
    const order = query.sort ? (query.order === 'asc' ? 'ASC' : 'DESC') : 'ASC';
    const vacancy = query.has_vacancy ? 'WHERE vacant_beds > 0' : '';
    const base = `SELECT * FROM (${this.roomSelect()} WHERE ${where.join(' AND ')}) x ${vacancy}`;
    const [{ total }] = await this.dataSource.query(`SELECT COUNT(*)::int AS total FROM (${base}) c`, params);
    const rows = await this.dataSource.query(
      `${base} ORDER BY ${sort.replace('r.', '')} ${order}, id ASC LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      params,
    );
    return paginate([rows.map((row: Record<string, unknown>) => this.toRoom(row)), total], query.page, query.limit);
  }

  async getRoom(schoolId: number, id: number): Promise<RoomDetailDto> {
    const rows = await this.dataSource.query(
      `${this.roomSelect()} WHERE r.school_id = $1 AND r.id = $2 AND r.deleted_at IS NULL`,
      [schoolId, id],
    );
    if (!rows.length) throw AppException.notFound('Room not found', 'HOSTEL_ROOM_NOT_FOUND');
    const beds = await this.beds.find({ where: { school_id: schoolId, room_id: id }, order: { bed_no: 'ASC' } });
    const occupants = await this.occupants(schoolId, id);
    return {
      ...this.toRoom(rows[0]),
      beds: beds.map((bed) => ({ ...this.toBed(bed), occupant: occupants.get(bed.id) ?? null })),
    };
  }

  private async occupants(schoolId: number, roomId: number): Promise<Map<number, BedOccupantDto>> {
    const rows: (BedOccupantDto & { bed_id: number })[] = await this.dataSource.query(
      `SELECT al.bed_id, al.admission_id, al.student_id, al.from_date::text AS from_date,
         TRIM(CONCAT(s.first_name, ' ', s.last_name)) AS student_name,
         NULLIF(TRIM(CONCAT(c.name, ' ', sec.name)), '') AS class_section
       FROM hostel_allocations al
       JOIN students s ON s.id = al.student_id
       LEFT JOIN academic_years ay ON ay.school_id = al.school_id AND ay.deleted_at IS NULL AND ${yearClause('ay')}
       LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = ay.id
       LEFT JOIN classes c ON c.id = e.class_id
       LEFT JOIN sections sec ON sec.id = e.section_id
       WHERE al.school_id = $1 AND al.room_id = $2 AND al.to_date IS NULL`,
      [schoolId, roomId],
    );
    return new Map(
      rows.map(({ bed_id, ...occupant }) => [
        bed_id,
        {
          admission_id: occupant.admission_id,
          student_id: occupant.student_id,
          student_name: occupant.student_name,
          class_section: occupant.class_section,
          from_date: occupant.from_date,
        },
      ]),
    );
  }

  async createRoom(schoolId: number, dto: RoomInputDto, actor: AuthUser): Promise<RoomDetailDto> {
    const floor = await this.findFloor(schoolId, dto.floor_id);
    const type = await this.findRoomType(schoolId, dto.room_type_id);
    await this.ensureUniqueRoomNo(schoolId, floor.hostel_id, [dto.room_no]);
    const id = await this.dataSource.transaction((manager) =>
      this.insertRoom(
        manager,
        schoolId,
        floor,
        type,
        dto.room_no,
        dto.capacity ?? type.default_beds,
        dto.notes ?? null,
        actor,
      ),
    );
    return this.getRoom(schoolId, id);
  }

  async bulkRooms(schoolId: number, dto: RoomBulkDto, actor: AuthUser): Promise<RoomBulkResultDto> {
    const floor = await this.findFloor(schoolId, dto.floor_id);
    const type = await this.findRoomType(schoolId, dto.room_type_id);
    const numbers = roomNumbers(dto.prefix ?? '', dto.start_no, dto.count, dto.pad ?? 0);
    await this.ensureUniqueRoomNo(schoolId, floor.hostel_id, numbers);
    await this.dataSource.transaction(async (manager) => {
      for (const roomNo of numbers) {
        await this.insertRoom(manager, schoolId, floor, type, roomNo, type.default_beds, null, actor);
      }
    });
    return { created: numbers.length, room_nos: numbers };
  }

  async updateRoom(schoolId: number, id: number, dto: RoomUpdateDto, actor: AuthUser): Promise<RoomDetailDto> {
    const room = await this.findRoom(schoolId, id);
    if (dto.room_type_id) await this.findRoomType(schoolId, dto.room_type_id);
    if (dto.room_no && dto.room_no !== room.room_no)
      await this.ensureUniqueRoomNo(schoolId, room.hostel_id, [dto.room_no]);
    await this.dataSource.transaction(async (manager) => {
      if (dto.capacity !== undefined && dto.capacity !== room.capacity) {
        await this.resizeBeds(manager, schoolId, room, dto.capacity, actor);
        room.capacity = dto.capacity;
      }
      if (dto.room_type_id !== undefined) room.room_type_id = dto.room_type_id;
      if (dto.room_no !== undefined) room.room_no = dto.room_no;
      if (dto.status !== undefined) room.status = dto.status;
      if (dto.notes !== undefined) room.notes = dto.notes;
      await manager.save(room);
    });
    return this.getRoom(schoolId, id);
  }

  async removeRoom(schoolId: number, id: number): Promise<void> {
    await this.findRoom(schoolId, id);
    const busy = await this.beds.countBy({ school_id: schoolId, room_id: id, status: In(['occupied', 'reserved']) });
    if (busy) throw AppException.conflict('Students still have beds in this room', 'HOSTEL_ROOM_OCCUPIED');
    await this.dataSource.transaction(async (manager) => {
      await manager.softDelete(HostelBed, { school_id: schoolId, room_id: id });
      await manager.softDelete(HostelRoom, id);
    });
  }

  async updateBed(schoolId: number, id: number, dto: BedUpdateDto): Promise<BedDto> {
    const bed = await this.beds.findOneBy({ school_id: schoolId, id });
    if (!bed) throw AppException.notFound('Bed not found', 'HOSTEL_BED_NOT_FOUND');
    if (dto.status && ['occupied', 'reserved'].includes(bed.status)) {
      throw AppException.conflict('Vacate or cancel the student allocation first', 'HOSTEL_BED_OCCUPIED');
    }
    if (dto.status) bed.status = dto.status;
    if (dto.notes !== undefined) bed.notes = dto.notes;
    return this.toBed(await this.beds.save(bed));
  }

  async availableBeds(schoolId: number, query: BedAvailabilityQueryDto): Promise<AvailableBedDto[]> {
    const params: unknown[] = [schoolId];
    const where = [
      'bd.school_id = $1',
      'bd.deleted_at IS NULL',
      "bd.status = 'vacant'",
      "r.status = 'active'",
      "h.status = 'active'",
    ];
    if (query.hostel_id) where.push(`r.hostel_id = $${params.push(query.hostel_id)}`);
    if (query.block_id) where.push(`r.block_id = $${params.push(query.block_id)}`);
    if (query.room_type_id) where.push(`r.room_type_id = $${params.push(query.room_type_id)}`);
    return this.dataSource.query(
      `SELECT bd.id AS bed_id, bd.bed_no, r.id AS room_id, r.room_no, b.name AS block_name, f.name AS floor_name,
         h.name AS hostel_name, t.name AS room_type_name
       FROM hostel_beds bd
       JOIN hostel_rooms r ON r.id = bd.room_id AND r.deleted_at IS NULL
       JOIN hostel_blocks b ON b.id = r.block_id
       JOIN hostel_floors f ON f.id = r.floor_id
       JOIN hostels h ON h.id = r.hostel_id AND h.deleted_at IS NULL
       JOIN hostel_room_types t ON t.id = r.room_type_id
       WHERE ${where.join(' AND ')}
       ORDER BY h.name, b.sort_order, f.level, r.room_no, bd.bed_no
       LIMIT 500`,
      params,
    );
  }

  async dashboard(schoolId: number, query: HostelIdQueryDto): Promise<HostelDashboardDto> {
    const params: unknown[] = [schoolId];
    const hostelFilter = query.hostel_id ? ` AND hostel_id = $${params.push(query.hostel_id)}` : '';
    const [beds] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'occupied')::int AS occupied,
         COUNT(*) FILTER (WHERE status = 'vacant')::int AS vacant,
         COUNT(*) FILTER (WHERE status = 'reserved')::int AS reserved,
         COUNT(*) FILTER (WHERE status IN ('blocked', 'maintenance'))::int AS unavailable
       FROM hostel_beds WHERE school_id = $1 AND deleted_at IS NULL${hostelFilter}`,
      params,
    );
    const [rooms] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'maintenance')::int AS maintenance
       FROM hostel_rooms WHERE school_id = $1 AND deleted_at IS NULL${hostelFilter}`,
      params,
    );
    const [blocks] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM hostel_blocks WHERE school_id = $1 AND deleted_at IS NULL${hostelFilter}`,
      params,
    );
    const hostelCount = query.hostel_id ? 1 : await this.hostels.countBy({ school_id: schoolId });
    return {
      hostels: hostelCount,
      blocks: blocks.total,
      rooms: rooms.total,
      total_beds: beds.total,
      occupied_beds: beds.occupied,
      vacant_beds: beds.vacant,
      reserved_beds: beds.reserved,
      unavailable_beds: beds.unavailable,
      occupancy_percent: occupancyPercent(beds.occupied, beds.total - beds.unavailable),
      rooms_under_maintenance: rooms.maintenance,
      enabled_modules: await this.settings.enabledModules(schoolId),
    };
  }

  private async insertRoom(
    manager: EntityManager,
    schoolId: number,
    floor: HostelFloor,
    type: HostelRoomType,
    roomNo: string,
    capacity: number,
    notes: string | null,
    actor: AuthUser,
  ): Promise<number> {
    const room = await manager.save(
      manager.create(HostelRoom, {
        school_id: schoolId,
        hostel_id: floor.hostel_id,
        block_id: floor.block_id,
        floor_id: floor.id,
        room_type_id: type.id,
        room_no: roomNo,
        capacity,
        status: 'active',
        notes,
        created_by: actor.id,
      }),
    );
    await manager.save(
      bedLabels(capacity).map((label) =>
        manager.create(HostelBed, {
          school_id: schoolId,
          hostel_id: floor.hostel_id,
          room_id: room.id,
          bed_no: label,
          status: 'vacant',
          created_by: actor.id,
        }),
      ),
    );
    return room.id;
  }

  private async resizeBeds(
    manager: EntityManager,
    schoolId: number,
    room: HostelRoom,
    capacity: number,
    actor: AuthUser,
  ): Promise<void> {
    const beds = await manager.find(HostelBed, {
      where: { school_id: schoolId, room_id: room.id },
      order: { bed_no: 'DESC' },
    });
    if (capacity > beds.length) {
      const labels = bedLabels(
        capacity - beds.length,
        beds.map((bed) => bed.bed_no),
      );
      await manager.save(
        labels.map((label) =>
          manager.create(HostelBed, {
            school_id: schoolId,
            hostel_id: room.hostel_id,
            room_id: room.id,
            bed_no: label,
            status: 'vacant',
            created_by: actor.id,
          }),
        ),
      );
      return;
    }
    const removable = beds.filter((bed) => !['occupied', 'reserved'].includes(bed.status));
    const toRemove = beds.length - capacity;
    if (removable.length < toRemove) {
      throw AppException.conflict(
        `Only ${removable.length} bed(s) are free to remove; students use the others`,
        'HOSTEL_ROOM_CAPACITY_BELOW_OCCUPIED',
      );
    }
    await manager.softDelete(
      HostelBed,
      removable.slice(0, toRemove).map((bed) => bed.id),
    );
  }

  private roomSelect(): string {
    return `SELECT r.id, r.hostel_id, h.name AS hostel_name, r.block_id, b.name AS block_name, r.floor_id,
         f.name AS floor_name, r.room_type_id, t.name AS room_type_name, r.room_no, r.capacity, r.status, r.notes,
         r.created_at,
         (SELECT COUNT(*) FROM hostel_beds bd WHERE bd.room_id = r.id AND bd.deleted_at IS NULL AND bd.status IN ('occupied', 'reserved'))::int AS occupied_beds,
         (SELECT COUNT(*) FROM hostel_beds bd WHERE bd.room_id = r.id AND bd.deleted_at IS NULL AND bd.status = 'vacant')::int AS vacant_beds
       FROM hostel_rooms r
       JOIN hostels h ON h.id = r.hostel_id
       JOIN hostel_blocks b ON b.id = r.block_id
       JOIN hostel_floors f ON f.id = r.floor_id
       JOIN hostel_room_types t ON t.id = r.room_type_id`;
  }

  private async countsBy(
    schoolId: number,
    column: 'hostel_id' | 'block_id' | 'floor_id',
  ): Promise<Map<number, Counts>> {
    const rows: { key: number; rooms: number; beds: number; occupied: number }[] = await this.dataSource.query(
      `SELECT r.${column} AS key, COUNT(DISTINCT r.id)::int AS rooms, COUNT(bd.id)::int AS beds,
         COUNT(bd.id) FILTER (WHERE bd.status = 'occupied')::int AS occupied
       FROM hostel_rooms r
       LEFT JOIN hostel_beds bd ON bd.room_id = r.id AND bd.deleted_at IS NULL
       WHERE r.school_id = $1 AND r.deleted_at IS NULL GROUP BY r.${column}`,
      [schoolId],
    );
    return new Map(rows.map((row) => [row.key, { rooms: row.rooms, beds: row.beds, occupied: row.occupied }]));
  }

  private async blockCounts(schoolId: number): Promise<Map<number, number>> {
    const rows: { hostel_id: number; total: number }[] = await this.dataSource.query(
      `SELECT hostel_id, COUNT(*)::int AS total FROM hostel_blocks WHERE school_id = $1 AND deleted_at IS NULL GROUP BY hostel_id`,
      [schoolId],
    );
    return new Map(rows.map((row) => [row.hostel_id, row.total]));
  }

  private async getBlock(schoolId: number, id: number): Promise<BlockDto> {
    const block = (await this.listBlocks(schoolId, {})).find((item) => item.id === id);
    if (!block) throw AppException.notFound('Block not found', 'HOSTEL_BLOCK_NOT_FOUND');
    return block;
  }

  private async findHostel(schoolId: number, id: number): Promise<Hostel> {
    const hostel = await this.hostels.findOneBy({ school_id: schoolId, id });
    if (!hostel) throw AppException.notFound('Hostel not found', 'HOSTEL_NOT_FOUND');
    return hostel;
  }

  private async findBlock(schoolId: number, id: number): Promise<HostelBlock> {
    const block = await this.blocks.findOneBy({ school_id: schoolId, id });
    if (!block) throw AppException.notFound('Block not found', 'HOSTEL_BLOCK_NOT_FOUND');
    return block;
  }

  private async findFloor(schoolId: number, id: number): Promise<HostelFloor> {
    const floor = await this.floors.findOneBy({ school_id: schoolId, id });
    if (!floor) throw AppException.notFound('Floor not found', 'HOSTEL_FLOOR_NOT_FOUND');
    return floor;
  }

  private async findRoomType(schoolId: number, id: number): Promise<HostelRoomType> {
    const type = await this.roomTypes.findOneBy({ school_id: schoolId, id });
    if (!type) throw AppException.notFound('Room type not found', 'HOSTEL_ROOM_TYPE_NOT_FOUND');
    return type;
  }

  private async findRoom(schoolId: number, id: number): Promise<HostelRoom> {
    const room = await this.rooms.findOneBy({ school_id: schoolId, id });
    if (!room) throw AppException.notFound('Room not found', 'HOSTEL_ROOM_NOT_FOUND');
    return room;
  }

  private async ensureUniqueHostelCode(schoolId: number, code: string): Promise<void> {
    if (await this.hostels.existsBy({ school_id: schoolId, code })) {
      throw AppException.conflict('A hostel with this code already exists', 'HOSTEL_CODE_TAKEN');
    }
  }

  private async ensureUniqueBlockCode(schoolId: number, hostelId: number, code: string): Promise<void> {
    if (await this.blocks.existsBy({ school_id: schoolId, hostel_id: hostelId, code })) {
      throw AppException.conflict('This hostel already has a block with this code', 'HOSTEL_BLOCK_CODE_TAKEN');
    }
  }

  private async ensureUniqueLevel(schoolId: number, blockId: number, level: number): Promise<void> {
    if (await this.floors.existsBy({ school_id: schoolId, block_id: blockId, level })) {
      throw AppException.conflict('This block already has a floor at this level', 'HOSTEL_FLOOR_LEVEL_TAKEN');
    }
  }

  private async ensureUniqueRoomTypeCode(schoolId: number, code: string): Promise<void> {
    if (await this.roomTypes.existsBy({ school_id: schoolId, code })) {
      throw AppException.conflict('A room type with this code already exists', 'HOSTEL_ROOM_TYPE_CODE_TAKEN');
    }
  }

  private async ensureUniqueRoomNo(schoolId: number, hostelId: number, roomNos: string[]): Promise<void> {
    const taken = await this.rooms.find({
      where: { school_id: schoolId, hostel_id: hostelId, room_no: In(roomNos) },
      select: { room_no: true },
    });
    if (taken.length) {
      throw AppException.conflict(
        `Room number already used in this hostel: ${taken.map((room) => room.room_no).join(', ')}`,
        'HOSTEL_ROOM_NO_TAKEN',
      );
    }
  }

  private async ensureHostelStaff(schoolId: number, userId: number, field: string): Promise<void> {
    const rows = await this.dataSource.query(
      `SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
       WHERE u.id = $1 AND u.school_id = $2 AND u.deleted_at IS NULL AND u.status = 'active' AND r.code = ANY($3) LIMIT 1`,
      [userId, schoolId, HOSTEL_STAFF_ROLES],
    );
    if (!rows.length) {
      throw AppException.validation([{ field, message: 'Choose an active warden or assistant warden of this school' }]);
    }
  }

  private defined<T extends object>(dto: T): Partial<T> {
    return Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined)) as Partial<T>;
  }

  private toHostel(row: Hostel, wardenName: string | null, counts: Counts | undefined, blocks: number): HostelDto {
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      gender: row.gender,
      status: row.status,
      warden_user_id: row.warden_user_id,
      warden_name: wardenName,
      phone: row.phone,
      address: row.address,
      notes: row.notes,
      block_count: blocks,
      room_count: counts?.rooms ?? 0,
      bed_count: counts?.beds ?? 0,
      occupied_beds: counts?.occupied ?? 0,
    };
  }

  private toFloor(row: HostelFloor, counts: Counts | undefined): FloorDto {
    return {
      id: row.id,
      hostel_id: row.hostel_id,
      block_id: row.block_id,
      name: row.name,
      level: row.level,
      room_count: counts?.rooms ?? 0,
      bed_count: counts?.beds ?? 0,
      occupied_beds: counts?.occupied ?? 0,
    };
  }

  private toRoomType(row: HostelRoomType, roomCount: number): RoomTypeDto {
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      default_beds: row.default_beds,
      is_ac: row.is_ac,
      attached_bathroom: row.attached_bathroom,
      annual_fee: Number(row.annual_fee),
      amenities: row.amenities,
      room_count: roomCount,
    };
  }

  private toRoom(row: Record<string, unknown>): RoomDto {
    return {
      id: row.id as number,
      hostel_id: row.hostel_id as number,
      hostel_name: row.hostel_name as string,
      block_id: row.block_id as number,
      block_name: row.block_name as string,
      floor_id: row.floor_id as number,
      floor_name: row.floor_name as string,
      room_type_id: row.room_type_id as number,
      room_type_name: row.room_type_name as string,
      room_no: row.room_no as string,
      capacity: row.capacity as number,
      status: row.status as RoomDto['status'],
      notes: (row.notes as string | null) ?? null,
      occupied_beds: Number(row.occupied_beds),
      vacant_beds: Number(row.vacant_beds),
    };
  }

  private toBed(bed: HostelBed): BedDto {
    return {
      id: bed.id,
      room_id: bed.room_id,
      bed_no: bed.bed_no,
      status: bed.status,
      notes: bed.notes,
      occupant: null,
    };
  }
}
