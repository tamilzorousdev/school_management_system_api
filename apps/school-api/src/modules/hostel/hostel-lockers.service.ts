import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { AppException, AuthUser, Paginated, paginate } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import {
  LockerAllocateDto,
  LockerAllocationDto,
  LockerBulkDto,
  LockerBulkResultDto,
  LockerDetailDto,
  LockerDto,
  LockerInputDto,
  LockerQueryDto,
  LockerReturnDto,
  LockerSummaryDto,
  LockerUpdateDto,
  ParentLockerDto,
} from './dto/hostel-rooms.dto';
import { HostelAdmission } from './entities/hostel-admission.entity';
import { HostelLocker, HostelLockerAllocation } from './entities/hostel-rooms.entity';
import { STUDENT_COLUMNS, studentFromRow, studentJoins, escapeLike } from './hostel-sql';
import { HostelAuditService } from './hostel-audit.service';
import { HostelParentService } from './hostel-parent.service';
import { HostelSettingsService } from './hostel-settings.service';
import {
  canChangeLockerStatus,
  lockerAfterReturn,
  lockerCounts,
  lockerNumbers,
  missingKeys,
  returnNote,
} from './hostel-rooms.logic';

const LOCKER_SORTS: Record<string, string> = {
  locker_no: 'k.locker_no',
  created_at: 'k.created_at',
  status: 'k.status',
};

interface LockerPlace {
  block_id: number | null;
  room_id: number | null;
}

@Injectable()
export class HostelLockersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly settings: HostelSettingsService,
    private readonly parent: HostelParentService,
    private readonly audit: HostelAuditService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async list(schoolId: number, query: LockerQueryDto): Promise<Paginated<LockerDto>> {
    const params: unknown[] = [schoolId];
    const where = ['k.school_id = $1', 'k.deleted_at IS NULL'];
    if (query.hostel_id) where.push(`k.hostel_id = $${params.push(query.hostel_id)}`);
    if (query.block_id) where.push(`k.block_id = $${params.push(query.block_id)}`);
    if (query.room_id) where.push(`k.room_id = $${params.push(query.room_id)}`);
    if (query.status) where.push(`k.status = $${params.push(query.status)}`);
    if (query.available !== undefined)
      where.push(query.available ? `k.status = 'available'` : `k.status <> 'available'`);
    for (const word of (query.search ?? '').split(/\s+/).filter(Boolean)) {
      const slot = `$${params.push(`%${escapeLike(word)}%`)}`;
      where.push(
        `(k.locker_no ILIKE ${slot} OR s.first_name ILIKE ${slot} OR s.last_name ILIKE ${slot} OR s.admission_no ILIKE ${slot})`,
      );
    }
    const sort = LOCKER_SORTS[query.sort ?? 'locker_no'];
    if (!sort)
      throw AppException.badRequest(`sort must be one of ${Object.keys(LOCKER_SORTS).join(', ')}`, 'INVALID_SORT');
    const order = query.order === 'asc' ? 'ASC' : 'DESC';
    const from = `${this.lockerFrom()} WHERE ${where.join(' AND ')}`;
    const [{ total }] = await this.dataSource.query(`SELECT COUNT(*)::int AS total ${from}`, params);
    const rows = await this.dataSource.query(
      `SELECT ${this.lockerColumns()} ${from} ORDER BY ${sort} ${order}, k.id ${order}
       LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      params,
    );
    return paginate([rows.map((row: Record<string, unknown>) => this.toLocker(row)), total], query.page, query.limit);
  }

  async get(schoolId: number, id: number): Promise<LockerDetailDto> {
    const rows = await this.dataSource.query(
      `SELECT ${this.lockerColumns()} ${this.lockerFrom()} WHERE k.school_id = $1 AND k.id = $2 AND k.deleted_at IS NULL`,
      [schoolId, id],
    );
    if (!rows.length) throw AppException.notFound('Locker not found', 'HOSTEL_LOCKER_NOT_FOUND');
    return { ...this.toLocker(rows[0]), history: await this.history(schoolId, id) };
  }

  async summary(schoolId: number, hostelId?: number): Promise<LockerSummaryDto> {
    const params: unknown[] = [schoolId];
    const filter = hostelId ? ` AND hostel_id = $${params.push(hostelId)}` : '';
    const rows = await this.dataSource.query(
      `SELECT status, COUNT(*)::int AS count FROM hostel_lockers
       WHERE school_id = $1 AND deleted_at IS NULL${filter} GROUP BY status`,
      params,
    );
    return lockerCounts(rows);
  }

  async create(schoolId: number, dto: LockerInputDto, actor: AuthUser): Promise<LockerDetailDto> {
    const place = await this.place(schoolId, dto.hostel_id, dto.block_id, dto.room_id);
    await this.ensureFreeNumbers(schoolId, dto.hostel_id, [dto.locker_no]);
    const id = await this.dataSource.transaction(async (manager) => {
      const saved = await manager.save(
        manager.create(HostelLocker, {
          school_id: schoolId,
          hostel_id: dto.hostel_id,
          ...place,
          locker_no: dto.locker_no,
          size: dto.size ?? null,
          status: 'available',
          notes: dto.notes ?? null,
          created_by: actor.id,
        }),
      );
      await this.audit.record(manager, schoolId, actor, {
        entity: 'locker',
        entity_id: saved.id,
        action: 'create',
        changes: { locker_no: saved.locker_no, hostel_id: saved.hostel_id },
      });
      return saved.id;
    });
    return this.get(schoolId, id);
  }

  async bulk(schoolId: number, dto: LockerBulkDto, actor: AuthUser): Promise<LockerBulkResultDto> {
    const place = await this.place(schoolId, dto.hostel_id, dto.block_id, dto.room_id);
    const numbers = lockerNumbers(dto.prefix ?? '', dto.start_no, dto.count, dto.pad ?? 0);
    if (numbers.some((value) => value.length > 20)) {
      throw AppException.validation([{ field: 'prefix', message: 'Locker numbers can be at most 20 characters' }]);
    }
    await this.ensureFreeNumbers(schoolId, dto.hostel_id, numbers);
    await this.dataSource.transaction(async (manager) => {
      const saved = await manager.save(
        numbers.map((lockerNo) =>
          manager.create(HostelLocker, {
            school_id: schoolId,
            hostel_id: dto.hostel_id,
            ...place,
            locker_no: lockerNo,
            size: dto.size ?? null,
            status: 'available',
            notes: null,
            created_by: actor.id,
          }),
        ),
      );
      await this.audit.record(manager, schoolId, actor, {
        entity: 'locker',
        entity_id: saved[0].id,
        action: 'bulk_create',
        changes: { hostel_id: dto.hostel_id, count: numbers.length, from: numbers[0], to: numbers[numbers.length - 1] },
      });
    });
    return { created: numbers.length, locker_nos: numbers };
  }

  async update(schoolId: number, id: number, dto: LockerUpdateDto, actor: AuthUser): Promise<LockerDetailDto> {
    await this.dataSource.transaction(async (manager) => {
      const locker = await this.lock(manager, schoolId, id);
      if (dto.status && dto.status !== locker.status && !canChangeLockerStatus(locker.status)) {
        throw AppException.conflict('Take the locker back from the student first', 'HOSTEL_LOCKER_ALLOTTED');
      }
      const changes: Record<string, unknown> = {};
      if (dto.block_id !== undefined || dto.room_id !== undefined) {
        const roomId = dto.room_id !== undefined ? dto.room_id : locker.room_id;
        const blockId = dto.block_id !== undefined ? dto.block_id : dto.room_id ? undefined : locker.block_id;
        Object.assign(changes, await this.place(schoolId, locker.hostel_id, blockId, roomId));
      }
      if (dto.status !== undefined) changes.status = dto.status;
      if (dto.size !== undefined) changes.size = dto.size;
      if (dto.notes !== undefined) changes.notes = dto.notes;
      Object.assign(locker, changes);
      await manager.save(locker);
      await this.audit.record(manager, schoolId, actor, {
        entity: 'locker',
        entity_id: id,
        action: 'update',
        changes,
      });
    });
    return this.get(schoolId, id);
  }

  async remove(schoolId: number, id: number, actor: AuthUser): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const locker = await this.lock(manager, schoolId, id);
      if (locker.status === 'allotted') {
        throw AppException.conflict('Take the locker back from the student first', 'HOSTEL_LOCKER_ALLOTTED');
      }
      await manager.softDelete(HostelLocker, { id, school_id: schoolId });
      await this.audit.record(manager, schoolId, actor, {
        entity: 'locker',
        entity_id: id,
        action: 'delete',
        changes: { locker_no: locker.locker_no },
      });
    });
  }

  async allocate(schoolId: number, id: number, dto: LockerAllocateDto, actor: AuthUser): Promise<LockerDetailDto> {
    await this.dataSource.transaction(async (manager) => {
      const locker = await this.lock(manager, schoolId, id);
      if (locker.status !== 'available') {
        throw AppException.conflict(`This locker is ${locker.status}`, 'HOSTEL_LOCKER_NOT_AVAILABLE');
      }
      const admission = await manager.findOne(HostelAdmission, {
        where: { school_id: schoolId, id: dto.admission_id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!admission) throw AppException.notFound('Hostel admission not found', 'HOSTEL_ADMISSION_NOT_FOUND');
      if (admission.status === 'checked_out') {
        throw AppException.conflict('This student has checked out of the hostel', 'HOSTEL_ADMISSION_CLOSED');
      }
      if (admission.hostel_id !== locker.hostel_id) {
        throw AppException.validation([{ field: 'admission_id', message: 'This student stays in another hostel' }]);
      }
      if (await this.liveLocker(manager, admission.id)) {
        throw AppException.conflict('This student already has a locker', 'HOSTEL_LOCKER_HELD');
      }
      const lockType = dto.lock_type ?? 'school';
      await manager.save(
        manager.create(HostelLockerAllocation, {
          school_id: schoolId,
          locker_id: locker.id,
          admission_id: admission.id,
          student_id: admission.student_id,
          from_date: this.today(),
          to_date: null,
          keys_given: dto.keys_given ?? 1,
          keys_returned: null,
          lock_type: lockType,
          deposit: dto.deposit ?? null,
          created_by: actor.id,
        }),
      );
      locker.status = 'allotted';
      await manager.save(locker);
      await this.audit.record(manager, schoolId, actor, {
        entity: 'locker',
        entity_id: locker.id,
        action: 'allocate',
        student_id: admission.student_id,
        changes: { admission_id: admission.id, keys_given: dto.keys_given ?? 1, lock_type: lockType },
      });
    });
    return this.get(schoolId, id);
  }

  async returnAllocation(
    schoolId: number,
    allocationId: number,
    dto: LockerReturnDto,
    actor: AuthUser,
  ): Promise<LockerDetailDto> {
    const lockerId = await this.dataSource.transaction(async (manager) => {
      const allocation = await manager.findOne(HostelLockerAllocation, {
        where: { school_id: schoolId, id: allocationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!allocation) throw AppException.notFound('Locker allocation not found', 'HOSTEL_LOCKER_ALLOCATION_NOT_FOUND');
      if (allocation.to_date) {
        throw AppException.conflict('This locker was already returned', 'HOSTEL_LOCKER_RETURNED');
      }
      await this.closeAllocation(manager, schoolId, allocation, dto, actor);
      return allocation.locker_id;
    });
    return this.get(schoolId, lockerId);
  }

  async closeAllocation(
    manager: EntityManager,
    schoolId: number,
    allocation: HostelLockerAllocation,
    dto: LockerReturnDto,
    actor: AuthUser,
  ): Promise<void> {
    if (dto.keys_returned > allocation.keys_given) {
      throw AppException.validation([
        { field: 'keys_returned', message: `Only ${allocation.keys_given} key(s) were given` },
      ]);
    }
    const missing = missingKeys(allocation.keys_given, dto.keys_returned);
    const status = lockerAfterReturn(Boolean(dto.damaged));
    Object.assign(allocation, {
      to_date: this.today(),
      keys_returned: dto.keys_returned,
      return_note: returnNote(missing, dto.note),
      returned_by: actor.id,
    });
    await manager.save(allocation);
    await manager.update(HostelLocker, { id: allocation.locker_id, school_id: schoolId }, { status });
    await this.audit.record(manager, schoolId, actor, {
      entity: 'locker',
      entity_id: allocation.locker_id,
      action: 'return',
      student_id: allocation.student_id,
      changes: { allocation_id: allocation.id, keys_returned: dto.keys_returned, keys_missing: missing, status },
      note: dto.note ?? null,
    });
  }

  async liveLocker(manager: EntityManager, admissionId: number): Promise<HostelLockerAllocation | null> {
    return manager.findOne(HostelLockerAllocation, { where: { admission_id: admissionId, to_date: IsNull() } });
  }

  async parentLocker(user: AuthUser, studentId: number): Promise<ParentLockerDto | null> {
    const stay = await this.parent.resident(user, studentId);
    await this.settings.ensureEnabled(stay.school_id, 'lockers');
    const [row] = await this.dataSource.query(
      `SELECT k.id AS locker_id, k.locker_no, h.name AS hostel_name, b.name AS block_name, r.room_no, k.size,
         la.from_date::text AS from_date, la.keys_given, la.lock_type
       FROM hostel_locker_allocations la
       JOIN hostel_lockers k ON k.id = la.locker_id
       JOIN hostels h ON h.id = k.hostel_id
       LEFT JOIN hostel_blocks b ON b.id = k.block_id
       LEFT JOIN hostel_rooms r ON r.id = k.room_id
       WHERE la.school_id = $1 AND la.admission_id = $2 AND la.to_date IS NULL`,
      [stay.school_id, stay.admission_id],
    );
    return row ?? null;
  }

  private today(): string {
    return todayIn(this.app.timeZone);
  }

  private async lock(manager: EntityManager, schoolId: number, id: number): Promise<HostelLocker> {
    const locker = await manager.findOne(HostelLocker, {
      where: { school_id: schoolId, id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!locker) throw AppException.notFound('Locker not found', 'HOSTEL_LOCKER_NOT_FOUND');
    return locker;
  }

  private async place(
    schoolId: number,
    hostelId: number,
    blockId: number | null | undefined,
    roomId: number | null | undefined,
  ): Promise<LockerPlace> {
    const [hostel] = await this.dataSource.query(
      `SELECT 1 FROM hostels WHERE school_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [schoolId, hostelId],
    );
    if (!hostel) throw AppException.notFound('Hostel not found', 'HOSTEL_NOT_FOUND');
    let block = blockId ?? null;
    if (roomId) {
      const [room] = await this.dataSource.query(
        `SELECT hostel_id, block_id FROM hostel_rooms WHERE school_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [schoolId, roomId],
      );
      if (!room) throw AppException.notFound('Room not found', 'HOSTEL_ROOM_NOT_FOUND');
      if (Number(room.hostel_id) !== hostelId) {
        throw AppException.validation([{ field: 'room_id', message: 'This room is in another hostel' }]);
      }
      if (block && block !== Number(room.block_id)) {
        throw AppException.validation([{ field: 'block_id', message: 'This room is in another block' }]);
      }
      block = Number(room.block_id);
    }
    if (block && !roomId) {
      const [row] = await this.dataSource.query(
        `SELECT hostel_id FROM hostel_blocks WHERE school_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [schoolId, block],
      );
      if (!row) throw AppException.notFound('Block not found', 'HOSTEL_BLOCK_NOT_FOUND');
      if (Number(row.hostel_id) !== hostelId) {
        throw AppException.validation([{ field: 'block_id', message: 'This block is in another hostel' }]);
      }
    }
    return { block_id: block, room_id: roomId ?? null };
  }

  private async ensureFreeNumbers(schoolId: number, hostelId: number, numbers: string[]): Promise<void> {
    const taken: { locker_no: string }[] = await this.dataSource.query(
      `SELECT locker_no FROM hostel_lockers
       WHERE school_id = $1 AND hostel_id = $2 AND deleted_at IS NULL AND locker_no = ANY($3)`,
      [schoolId, hostelId, numbers],
    );
    if (taken.length) {
      throw AppException.conflict(
        `Locker number already used: ${taken.map((row) => row.locker_no).join(', ')}`,
        'HOSTEL_LOCKER_NO_TAKEN',
      );
    }
  }

  private async history(schoolId: number, lockerId: number): Promise<LockerAllocationDto[]> {
    const rows = await this.dataSource.query(
      `SELECT la.id, la.locker_id, k.locker_no, la.admission_id, la.from_date::text AS from_date,
         la.to_date::text AS to_date, la.keys_given, la.keys_returned, la.lock_type, la.deposit::float AS deposit,
         la.return_note, gu.name AS given_by_name, ru.name AS returned_by_name, la.created_at, ${STUDENT_COLUMNS}
       FROM hostel_locker_allocations la
       JOIN hostel_lockers k ON k.id = la.locker_id
       JOIN students s ON s.id = la.student_id
       ${studentJoins('s')}
       LEFT JOIN users gu ON gu.id = la.created_by
       LEFT JOIN users ru ON ru.id = la.returned_by
       WHERE la.school_id = $1 AND la.locker_id = $2
       ORDER BY la.created_at DESC, la.id DESC`,
      [schoolId, lockerId],
    );
    return rows.map((row: Record<string, unknown>) => ({
      id: row.id as number,
      locker_id: row.locker_id as number,
      locker_no: row.locker_no as string,
      admission_id: row.admission_id as number,
      student: studentFromRow(row),
      from_date: row.from_date as string,
      to_date: (row.to_date as string | null) ?? null,
      keys_given: row.keys_given as number,
      keys_returned: (row.keys_returned as number | null) ?? null,
      lock_type: row.lock_type as LockerAllocationDto['lock_type'],
      deposit: (row.deposit as number | null) ?? null,
      return_note: (row.return_note as string | null) ?? null,
      given_by_name: (row.given_by_name as string | null) ?? null,
      returned_by_name: (row.returned_by_name as string | null) ?? null,
      created_at: row.created_at as Date,
    }));
  }

  private lockerColumns(): string {
    return `k.id, k.hostel_id, h.name AS hostel_name, k.block_id, b.name AS block_name, k.room_id, r.room_no,
         k.locker_no, k.size, k.status, k.notes, k.created_at,
         la.id AS allocation_id, la.admission_id, la.from_date::text AS from_date, la.keys_given, la.lock_type,
         la.deposit::float AS deposit, ${STUDENT_COLUMNS}`;
  }

  private lockerFrom(): string {
    return `FROM hostel_lockers k
       JOIN hostels h ON h.id = k.hostel_id
       LEFT JOIN hostel_blocks b ON b.id = k.block_id
       LEFT JOIN hostel_rooms r ON r.id = k.room_id
       LEFT JOIN hostel_locker_allocations la ON la.locker_id = k.id AND la.to_date IS NULL
       LEFT JOIN students s ON s.id = la.student_id
       ${studentJoins('s')}`;
  }

  private toLocker(row: Record<string, unknown>): LockerDto {
    return {
      id: row.id as number,
      hostel_id: row.hostel_id as number,
      hostel_name: row.hostel_name as string,
      block_id: (row.block_id as number | null) ?? null,
      block_name: (row.block_name as string | null) ?? null,
      room_id: (row.room_id as number | null) ?? null,
      room_no: (row.room_no as string | null) ?? null,
      locker_no: row.locker_no as string,
      size: (row.size as LockerDto['size']) ?? null,
      status: row.status as LockerDto['status'],
      notes: (row.notes as string | null) ?? null,
      holder: row.allocation_id
        ? {
            allocation_id: row.allocation_id as number,
            admission_id: row.admission_id as number,
            student: studentFromRow(row),
            from_date: row.from_date as string,
            keys_given: row.keys_given as number,
            lock_type: row.lock_type as LockerAllocationDto['lock_type'],
            deposit: (row.deposit as number | null) ?? null,
          }
        : null,
      created_at: row.created_at as Date,
    };
  }
}
