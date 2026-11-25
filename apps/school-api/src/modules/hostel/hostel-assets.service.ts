import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppException, AuthUser, Paginated, paginate } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import {
  AssetApplyDto,
  AssetApplyResultDto,
  AssetQueryDto,
  BelongingDto,
  BelongingInputDto,
  BelongingUpdateDto,
  RoomAssetDto,
  RoomAssetInputDto,
  RoomAssetUpdateDto,
} from './dto/hostel-rooms.dto';
import { HostelAdmission } from './entities/hostel-admission.entity';
import { HostelBelonging, HostelRoomAsset } from './entities/hostel-rooms.entity';
import { HostelRoom } from './entities/hostel.entity';
import { escapeLike } from './hostel-sql';
import { HostelAuditService } from './hostel-audit.service';
import { HostelParentService } from './hostel-parent.service';
import { assetsToAdd } from './hostel-rooms.logic';

const ASSET_SORTS: Record<string, string> = {
  room_no: 'r.room_no',
  item_name: 'a.item_name',
  condition: 'a.condition',
  updated_at: 'a.updated_at',
};

@Injectable()
export class HostelAssetsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly parent: HostelParentService,
    private readonly audit: HostelAuditService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async roomAssets(schoolId: number, roomId: number): Promise<RoomAssetDto[]> {
    await this.room(schoolId, roomId);
    return this.dataSource.query(
      `SELECT ${this.assetColumns()} ${this.assetFrom()}
       WHERE a.school_id = $1 AND a.room_id = $2 AND a.deleted_at IS NULL ORDER BY a.item_name, a.id`,
      [schoolId, roomId],
    );
  }

  async list(schoolId: number, query: AssetQueryDto): Promise<Paginated<RoomAssetDto>> {
    const params: unknown[] = [schoolId];
    const where = ['a.school_id = $1', 'a.deleted_at IS NULL', 'r.deleted_at IS NULL'];
    if (query.hostel_id) where.push(`a.hostel_id = $${params.push(query.hostel_id)}`);
    if (query.block_id) where.push(`r.block_id = $${params.push(query.block_id)}`);
    if (query.room_id) where.push(`a.room_id = $${params.push(query.room_id)}`);
    if (query.condition) where.push(`a.condition = $${params.push(query.condition)}`);
    for (const word of (query.search ?? '').split(/\s+/).filter(Boolean)) {
      const slot = `$${params.push(`%${escapeLike(word)}%`)}`;
      where.push(`(a.item_name ILIKE ${slot} OR r.room_no ILIKE ${slot} OR ia.asset_tag ILIKE ${slot})`);
    }
    const sort = ASSET_SORTS[query.sort ?? 'room_no'];
    if (!sort)
      throw AppException.badRequest(`sort must be one of ${Object.keys(ASSET_SORTS).join(', ')}`, 'INVALID_SORT');
    const order = query.order === 'asc' ? 'ASC' : 'DESC';
    const from = `${this.assetFrom()} WHERE ${where.join(' AND ')}`;
    const [{ total }] = await this.dataSource.query(`SELECT COUNT(*)::int AS total ${from}`, params);
    const rows: RoomAssetDto[] = await this.dataSource.query(
      `SELECT ${this.assetColumns()} ${from} ORDER BY ${sort} ${order}, a.id ${order}
       LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      params,
    );
    return paginate([rows, total], query.page, query.limit);
  }

  async addAsset(schoolId: number, roomId: number, dto: RoomAssetInputDto, actor: AuthUser): Promise<RoomAssetDto> {
    const room = await this.room(schoolId, roomId);
    if (dto.inventory_asset_id) await this.ensureInventoryAsset(schoolId, dto.inventory_asset_id);
    const id = await this.dataSource.transaction(async (manager) => {
      const saved = await manager.save(
        manager.create(HostelRoomAsset, {
          school_id: schoolId,
          hostel_id: room.hostel_id,
          room_id: room.id,
          item_name: dto.item_name,
          quantity: dto.quantity,
          condition: dto.condition ?? 'good',
          inventory_asset_id: dto.inventory_asset_id ?? null,
          notes: dto.notes ?? null,
          last_checked_at: new Date(),
          created_by: actor.id,
        }),
      );
      await this.audit.record(manager, schoolId, actor, {
        entity: 'room_asset',
        entity_id: saved.id,
        action: 'create',
        changes: { room_id: room.id, item_name: saved.item_name, quantity: saved.quantity, condition: saved.condition },
      });
      return saved.id;
    });
    return this.asset(schoolId, id);
  }

  async updateAsset(schoolId: number, id: number, dto: RoomAssetUpdateDto, actor: AuthUser): Promise<RoomAssetDto> {
    if (dto.inventory_asset_id) await this.ensureInventoryAsset(schoolId, dto.inventory_asset_id);
    await this.dataSource.transaction(async (manager) => {
      const row = await manager.findOne(HostelRoomAsset, {
        where: { school_id: schoolId, id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) throw AppException.notFound('Room asset not found', 'HOSTEL_ASSET_NOT_FOUND');
      const changes = Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined));
      Object.assign(row, changes);
      if (dto.condition !== undefined) row.last_checked_at = new Date();
      await manager.save(row);
      await this.audit.record(manager, schoolId, actor, {
        entity: 'room_asset',
        entity_id: id,
        action: 'update',
        changes,
      });
    });
    return this.asset(schoolId, id);
  }

  async removeAsset(schoolId: number, id: number, actor: AuthUser): Promise<void> {
    const row = await this.dataSource.manager.findOneBy(HostelRoomAsset, { school_id: schoolId, id });
    if (!row) throw AppException.notFound('Room asset not found', 'HOSTEL_ASSET_NOT_FOUND');
    await this.dataSource.transaction(async (manager) => {
      await manager.softDelete(HostelRoomAsset, { id, school_id: schoolId });
      await this.audit.record(manager, schoolId, actor, {
        entity: 'room_asset',
        entity_id: id,
        action: 'delete',
        changes: { room_id: row.room_id, item_name: row.item_name, quantity: row.quantity },
      });
    });
  }

  async apply(schoolId: number, dto: AssetApplyDto, actor: AuthUser): Promise<AssetApplyResultDto> {
    if (!dto.room_ids?.length && !dto.room_type_id && !dto.hostel_id) {
      throw AppException.validation([{ field: 'room_ids', message: 'Choose rooms, a room type or a hostel' }]);
    }
    const params: unknown[] = [schoolId];
    const where = ['r.school_id = $1', 'r.deleted_at IS NULL'];
    const roomIds = [...new Set(dto.room_ids ?? [])];
    if (roomIds.length) where.push(`r.id = ANY($${params.push(roomIds)})`);
    if (dto.room_type_id) where.push(`r.room_type_id = $${params.push(dto.room_type_id)}`);
    if (dto.hostel_id) where.push(`r.hostel_id = $${params.push(dto.hostel_id)}`);
    const rooms: { id: number; hostel_id: number }[] = await this.dataSource.query(
      `SELECT r.id, r.hostel_id FROM hostel_rooms r WHERE ${where.join(' AND ')} ORDER BY r.id`,
      params,
    );
    if (roomIds.length && rooms.length !== roomIds.length && !dto.room_type_id && !dto.hostel_id) {
      throw AppException.notFound('Room not found', 'HOSTEL_ROOM_NOT_FOUND');
    }
    if (!rooms.length) return { rooms: 0, added: 0 };
    const existing: { room_id: number; item_name: string }[] = await this.dataSource.query(
      `SELECT room_id, item_name FROM hostel_room_assets WHERE school_id = $1 AND deleted_at IS NULL AND room_id = ANY($2)`,
      [schoolId, rooms.map((room) => room.id)],
    );
    const byRoom = new Map<number, string[]>();
    for (const row of existing) byRoom.set(row.room_id, [...(byRoom.get(row.room_id) ?? []), row.item_name]);
    const now = new Date();
    const added = await this.dataSource.transaction(async (manager) => {
      const rows = rooms.flatMap((room) =>
        assetsToAdd(byRoom.get(room.id) ?? [], dto.items).map((item) =>
          manager.create(HostelRoomAsset, {
            school_id: schoolId,
            hostel_id: room.hostel_id,
            room_id: room.id,
            item_name: item.item_name,
            quantity: item.quantity,
            condition: 'good',
            inventory_asset_id: null,
            notes: null,
            last_checked_at: now,
            created_by: actor.id,
          }),
        ),
      );
      if (!rows.length) return 0;
      await manager.save(rows, { chunk: 200 });
      await this.audit.record(manager, schoolId, actor, {
        entity: 'room_asset',
        entity_id: rows[0].id,
        action: 'apply',
        changes: {
          rooms: rooms.length,
          added: rows.length,
          items: dto.items.map((item) => `${item.item_name} x${item.quantity}`),
        },
      });
      return rows.length;
    });
    return { rooms: rooms.length, added };
  }

  async belongings(schoolId: number, admissionId: number): Promise<BelongingDto[]> {
    await this.admission(schoolId, admissionId);
    return this.dataSource.query(
      `SELECT ${this.belongingColumns()} FROM hostel_belongings bl LEFT JOIN users u ON u.id = bl.created_by
       WHERE bl.school_id = $1 AND bl.admission_id = $2 AND bl.deleted_at IS NULL
       ORDER BY bl.declared_on DESC, bl.id DESC`,
      [schoolId, admissionId],
    );
  }

  async addBelonging(
    schoolId: number,
    admissionId: number,
    dto: BelongingInputDto,
    actor: AuthUser,
  ): Promise<BelongingDto> {
    const admission = await this.admission(schoolId, admissionId);
    if (admission.status === 'checked_out') {
      throw AppException.conflict('This student has checked out of the hostel', 'HOSTEL_ADMISSION_CLOSED');
    }
    const today = todayIn(this.app.timeZone);
    if (dto.declared_on && dto.declared_on > today) {
      throw AppException.validation([{ field: 'declared_on', message: 'Cannot be in the future' }]);
    }
    const id = await this.dataSource.transaction(async (manager) => {
      const saved = await manager.save(
        manager.create(HostelBelonging, {
          school_id: schoolId,
          admission_id: admission.id,
          student_id: admission.student_id,
          item: dto.item,
          description: dto.description ?? null,
          serial_no: dto.serial_no ?? null,
          quantity: dto.quantity ?? 1,
          declared_on: dto.declared_on ?? today,
          status: 'with_student',
          photo_file_id: dto.photo_file_id ?? null,
          notes: dto.notes ?? null,
          created_by: actor.id,
        }),
      );
      await this.audit.record(manager, schoolId, actor, {
        entity: 'belonging',
        entity_id: saved.id,
        action: 'create',
        student_id: admission.student_id,
        changes: { item: saved.item, quantity: saved.quantity, serial_no: saved.serial_no },
      });
      return saved.id;
    });
    return this.belonging(schoolId, id);
  }

  async updateBelonging(schoolId: number, id: number, dto: BelongingUpdateDto, actor: AuthUser): Promise<BelongingDto> {
    await this.dataSource.transaction(async (manager) => {
      const row = await manager.findOne(HostelBelonging, {
        where: { school_id: schoolId, id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) throw AppException.notFound('Belonging not found', 'HOSTEL_BELONGING_NOT_FOUND');
      const changes = Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined));
      Object.assign(row, changes);
      await manager.save(row);
      await this.audit.record(manager, schoolId, actor, {
        entity: 'belonging',
        entity_id: id,
        action: 'update',
        student_id: row.student_id,
        changes,
      });
    });
    return this.belonging(schoolId, id);
  }

  async removeBelonging(schoolId: number, id: number, actor: AuthUser): Promise<void> {
    const row = await this.dataSource.manager.findOneBy(HostelBelonging, { school_id: schoolId, id });
    if (!row) throw AppException.notFound('Belonging not found', 'HOSTEL_BELONGING_NOT_FOUND');
    await this.dataSource.transaction(async (manager) => {
      await manager.softDelete(HostelBelonging, { id, school_id: schoolId });
      await this.audit.record(manager, schoolId, actor, {
        entity: 'belonging',
        entity_id: id,
        action: 'delete',
        student_id: row.student_id,
        changes: { item: row.item },
      });
    });
  }

  async parentBelongings(user: AuthUser, studentId: number): Promise<BelongingDto[]> {
    const stay = await this.parent.resident(user, studentId);
    return this.belongings(stay.school_id, stay.admission_id);
  }

  async parentDeclare(user: AuthUser, studentId: number, dto: BelongingInputDto): Promise<BelongingDto> {
    const stay = await this.parent.resident(user, studentId);
    return this.addBelonging(stay.school_id, stay.admission_id, dto, user);
  }

  private async asset(schoolId: number, id: number): Promise<RoomAssetDto> {
    const [row] = await this.dataSource.query(
      `SELECT ${this.assetColumns()} ${this.assetFrom()} WHERE a.school_id = $1 AND a.id = $2 AND a.deleted_at IS NULL`,
      [schoolId, id],
    );
    if (!row) throw AppException.notFound('Room asset not found', 'HOSTEL_ASSET_NOT_FOUND');
    return row;
  }

  private async belonging(schoolId: number, id: number): Promise<BelongingDto> {
    const [row] = await this.dataSource.query(
      `SELECT ${this.belongingColumns()} FROM hostel_belongings bl LEFT JOIN users u ON u.id = bl.created_by
       WHERE bl.school_id = $1 AND bl.id = $2 AND bl.deleted_at IS NULL`,
      [schoolId, id],
    );
    if (!row) throw AppException.notFound('Belonging not found', 'HOSTEL_BELONGING_NOT_FOUND');
    return row;
  }

  private async room(schoolId: number, roomId: number): Promise<HostelRoom> {
    const room = await this.dataSource.manager.findOneBy(HostelRoom, { school_id: schoolId, id: roomId });
    if (!room) throw AppException.notFound('Room not found', 'HOSTEL_ROOM_NOT_FOUND');
    return room;
  }

  private async admission(schoolId: number, admissionId: number): Promise<HostelAdmission> {
    const admission = await this.dataSource.manager.findOneBy(HostelAdmission, {
      school_id: schoolId,
      id: admissionId,
    });
    if (!admission) throw AppException.notFound('Hostel admission not found', 'HOSTEL_ADMISSION_NOT_FOUND');
    return admission;
  }

  private async ensureInventoryAsset(schoolId: number, assetId: number): Promise<void> {
    const [row] = await this.dataSource.query(
      `SELECT 1 FROM assets WHERE school_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [schoolId, assetId],
    );
    if (!row) throw AppException.notFound('Inventory asset not found', 'ASSET_NOT_FOUND');
  }

  private assetColumns(): string {
    return `a.id, a.hostel_id, h.name AS hostel_name, a.room_id, r.room_no, b.name AS block_name, a.item_name,
         a.quantity, a.condition, a.inventory_asset_id, ia.asset_tag, a.notes, a.last_checked_at, a.updated_at`;
  }

  private assetFrom(): string {
    return `FROM hostel_room_assets a
       JOIN hostels h ON h.id = a.hostel_id
       JOIN hostel_rooms r ON r.id = a.room_id
       LEFT JOIN hostel_blocks b ON b.id = r.block_id
       LEFT JOIN assets ia ON ia.id = a.inventory_asset_id`;
  }

  private belongingColumns(): string {
    return `bl.id, bl.admission_id, bl.student_id, bl.item, bl.description, bl.serial_no, bl.quantity,
         bl.declared_on::text AS declared_on, bl.status, bl.photo_file_id, bl.notes, u.name AS declared_by_name,
         bl.created_at`;
  }
}
