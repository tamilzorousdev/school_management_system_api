import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AppException, AuthUser, ListQueryDto, Paginated, paginate } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { SequencesService } from '../schools/sequences.service';
import {
  LaundryBatchDto,
  LaundryDetailDto,
  LaundryInputDto,
  LaundryItemDto,
  LaundryItemInputDto,
  LaundryItemsInputDto,
  LaundryMissingDto,
  LaundryMissingQueryDto,
  LaundryQueryDto,
  LaundryReturnDto,
  LaundrySentDto,
  ParentLaundryDto,
} from './dto/hostel-care.dto';
import { HostelLaundryBatch } from './entities/hostel-care.entity';
import { duplicateIds, LaundryAction, laundryMove, missingItems } from './hostel-care.logic';
import { BED_COLUMN, bedJoins, careHostel, pageClause, sortColumn } from './hostel-care-sql';
import { escapeLike, STUDENT_COLUMNS, studentFromRow, studentJoins } from './hostel-sql';
import { HostelAuditService } from './hostel-audit.service';
import { addDays, serialNumber } from './hostel.logic';

const BATCH_SORTS: Record<string, string> = { collected_on: 'lb.collected_on', created_at: 'lb.created_at' };
const RESIDENT_SORTS: Record<string, string> = { collected_on: 'lb.collected_on' };
const MISSING_ROWS = 500;

@Injectable()
export class HostelLaundryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly sequences: SequencesService,
    private readonly audit: HostelAuditService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  today(): string {
    return todayIn(this.app.timeZone);
  }

  async list(schoolId: number, query: LaundryQueryDto): Promise<Paginated<LaundryBatchDto>> {
    const sort = sortColumn(BATCH_SORTS, query.sort, 'collected_on');
    const params: unknown[] = [schoolId];
    const where = ['lb.school_id = $1', 'lb.deleted_at IS NULL'];
    if (query.hostel_id) where.push(`lb.hostel_id = $${params.push(query.hostel_id)}`);
    if (query.status) where.push(`lb.status = $${params.push(query.status)}`);
    if (query.admission_id) {
      where.push(
        `EXISTS (SELECT 1 FROM hostel_laundry_items x WHERE x.batch_id = lb.id AND x.admission_id = $${params.push(query.admission_id)})`,
      );
    }
    for (const word of (query.search ?? '').split(/\s+/).filter(Boolean)) {
      const slot = `$${params.push(`%${escapeLike(word)}%`)}`;
      where.push(`(lb.batch_no ILIKE ${slot} OR lb.vendor_name ILIKE ${slot})`);
    }
    const order = query.order === 'asc' ? 'ASC' : 'DESC';
    const [{ total }] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM hostel_laundry_batches lb WHERE ${where.join(' AND ')}`,
      params,
    );
    const rows = await this.dataSource.query(
      `${this.batchSelect()} WHERE ${where.join(' AND ')}
       ORDER BY ${sort} ${order}, lb.id ${order} ${pageClause(query)}`,
      params,
    );
    return paginate([rows.map((row: Record<string, unknown>) => this.toBatch(row)), total], query.page, query.limit);
  }

  async get(schoolId: number, id: number): Promise<LaundryDetailDto> {
    const [row] = await this.dataSource.query(
      `${this.batchSelect()} WHERE lb.school_id = $1 AND lb.id = $2 AND lb.deleted_at IS NULL`,
      [schoolId, id],
    );
    if (!row) throw AppException.notFound('Laundry batch not found', 'HOSTEL_LAUNDRY_NOT_FOUND');
    const items = await this.dataSource.query(
      `SELECT li.id, li.admission_id, li.items_given, li.items_returned, li.missing_note, ${BED_COLUMN}, ${STUDENT_COLUMNS}
       FROM hostel_laundry_items li
       JOIN students s ON s.id = li.student_id
       ${studentJoins('s')}
       ${bedJoins('li.admission_id')}
       WHERE li.batch_id = $1
       ORDER BY r.room_no NULLS LAST, bd.bed_no, s.first_name, li.id`,
      [id],
    );
    return { ...this.toBatch(row), items: items.map((item: Record<string, unknown>) => this.toItem(item)) };
  }

  async create(schoolId: number, dto: LaundryInputDto, actor: AuthUser): Promise<LaundryDetailDto> {
    await careHostel(this.dataSource, schoolId, dto.hostel_id);
    const today = this.today();
    const collectedOn = dto.collected_on ?? today;
    if (collectedOn > today) {
      throw AppException.validation([{ field: 'collected_on', message: 'Cannot be in the future' }]);
    }
    const students = await this.residentStudents(this.dataSource.manager, schoolId, dto.hostel_id, dto.items);
    const year = today.slice(0, 4);
    const id = await this.dataSource.transaction(async (manager) => {
      const value = await this.sequences.next(manager, schoolId, `hostel_laundry:${year}`);
      const saved = await manager.save(
        manager.create(HostelLaundryBatch, {
          school_id: schoolId,
          hostel_id: dto.hostel_id,
          batch_no: serialNumber('HLB', year, value),
          collected_on: collectedOn,
          vendor_name: dto.vendor_name ?? null,
          status: 'collected',
          sent_on: null,
          returned_on: null,
          notes: dto.notes ?? null,
          created_by: actor.id,
        }),
      );
      await this.insertItems(manager, schoolId, saved.id, dto.items, students);
      await this.audit.record(manager, schoolId, actor, {
        entity: 'laundry',
        entity_id: saved.id,
        action: 'create',
        changes: { batch_no: saved.batch_no, students: dto.items.length, items: this.totalGiven(dto.items) },
      });
      return saved.id;
    });
    return this.get(schoolId, id);
  }

  async replaceItems(
    schoolId: number,
    id: number,
    dto: LaundryItemsInputDto,
    actor: AuthUser,
  ): Promise<LaundryDetailDto> {
    await this.dataSource.transaction(async (manager) => {
      const batch = await this.lock(manager, schoolId, id, 'items');
      const students = await this.residentStudents(manager, schoolId, batch.hostel_id, dto.items);
      await manager.query(`DELETE FROM hostel_laundry_items WHERE batch_id = $1`, [id]);
      await this.insertItems(manager, schoolId, id, dto.items, students);
      await this.audit.record(manager, schoolId, actor, {
        entity: 'laundry',
        entity_id: id,
        action: 'items',
        changes: { students: dto.items.length, items: this.totalGiven(dto.items) },
      });
    });
    return this.get(schoolId, id);
  }

  async sent(schoolId: number, id: number, dto: LaundrySentDto, actor: AuthUser): Promise<LaundryDetailDto> {
    await this.dataSource.transaction(async (manager) => {
      const batch = await this.lock(manager, schoolId, id, 'sent');
      const sentOn = dto.sent_on ?? this.today();
      if (sentOn > this.today() || sentOn < batch.collected_on) {
        throw AppException.validation([
          { field: 'sent_on', message: `Must be between ${batch.collected_on} and today` },
        ]);
      }
      await manager.update(
        HostelLaundryBatch,
        { id },
        {
          status: 'sent',
          sent_on: sentOn,
          ...(dto.vendor_name !== undefined ? { vendor_name: dto.vendor_name } : {}),
        },
      );
      await this.audit.record(manager, schoolId, actor, {
        entity: 'laundry',
        entity_id: id,
        action: 'sent',
        changes: { sent_on: sentOn, vendor_name: dto.vendor_name ?? batch.vendor_name },
      });
    });
    return this.get(schoolId, id);
  }

  async returned(schoolId: number, id: number, dto: LaundryReturnDto, actor: AuthUser): Promise<LaundryDetailDto> {
    await this.dataSource.transaction(async (manager) => {
      const batch = await this.lock(manager, schoolId, id, 'returned');
      const today = this.today();
      const returnedOn = dto.returned_on ?? today;
      const earliest = batch.sent_on ?? batch.collected_on;
      if (returnedOn > today || returnedOn < earliest) {
        throw AppException.validation([{ field: 'returned_on', message: `Must be between ${earliest} and today` }]);
      }
      const twice = duplicateIds(dto.items.map((item) => item.admission_id));
      if (twice.length) {
        throw AppException.badRequest(`Listed twice: admission ${twice.join(', ')}`, 'HOSTEL_LAUNDRY_DUPLICATE');
      }
      const given: { admission_id: number; items_given: number }[] = await manager.query(
        `SELECT admission_id, items_given FROM hostel_laundry_items WHERE batch_id = $1`,
        [id],
      );
      const handedIn = new Map(given.map((row) => [Number(row.admission_id), Number(row.items_given)]));
      const outside = dto.items.filter((item) => !handedIn.has(item.admission_id)).map((item) => item.admission_id);
      if (outside.length) {
        throw AppException.badRequest(
          `Not in this batch: admission ${outside.join(', ')}`,
          'HOSTEL_LAUNDRY_NOT_IN_BATCH',
        );
      }
      const tooMany = dto.items.filter((item) => item.items_returned > handedIn.get(item.admission_id)!);
      if (tooMany.length) {
        throw AppException.validation([
          {
            field: 'items',
            message: `More returned than given for admission ${tooMany.map((item) => item.admission_id).join(', ')}`,
          },
        ]);
      }
      await manager.query(
        `UPDATE hostel_laundry_items SET items_returned = items_given, missing_note = NULL WHERE batch_id = $1`,
        [id],
      );
      if (dto.items.length) {
        await manager.query(
          `UPDATE hostel_laundry_items li SET items_returned = x.items_returned, missing_note = x.missing_note
           FROM unnest($2::int[], $3::int[], $4::varchar[]) AS x(admission_id, items_returned, missing_note)
           WHERE li.batch_id = $1 AND li.admission_id = x.admission_id`,
          [
            id,
            dto.items.map((item) => item.admission_id),
            dto.items.map((item) => item.items_returned),
            dto.items.map((item) => item.missing_note ?? null),
          ],
        );
      }
      await manager.update(HostelLaundryBatch, { id }, { status: 'returned', returned_on: returnedOn });
      const missing = dto.items.reduce(
        (sum, item) => sum + missingItems(handedIn.get(item.admission_id)!, item.items_returned),
        0,
      );
      await this.audit.record(manager, schoolId, actor, {
        entity: 'laundry',
        entity_id: id,
        action: 'returned',
        changes: { returned_on: returnedOn, items_missing: missing },
      });
    });
    return this.get(schoolId, id);
  }

  async close(schoolId: number, id: number, actor: AuthUser): Promise<LaundryDetailDto> {
    await this.dataSource.transaction(async (manager) => {
      await this.lock(manager, schoolId, id, 'close');
      await manager.update(HostelLaundryBatch, { id }, { status: 'closed' });
      await this.audit.record(manager, schoolId, actor, { entity: 'laundry', entity_id: id, action: 'close' });
    });
    return this.get(schoolId, id);
  }

  async missing(schoolId: number, query: LaundryMissingQueryDto): Promise<LaundryMissingDto> {
    const to = query.to ?? this.today();
    const from = query.from ?? addDays(to, -90);
    if (from > to) throw AppException.validation([{ field: 'from', message: 'Must be on or before to' }]);
    const params: unknown[] = [schoolId, from, to];
    const where = [
      'lb.school_id = $1',
      'lb.deleted_at IS NULL',
      `lb.status IN ('returned', 'closed')`,
      'lb.collected_on BETWEEN $2::date AND $3::date',
    ];
    if (query.hostel_id) where.push(`lb.hostel_id = $${params.push(query.hostel_id)}`);
    const joined = `FROM hostel_laundry_batches lb JOIN hostel_laundry_items li ON li.batch_id = lb.id
       WHERE ${where.join(' AND ')}`;
    const [totals] = await this.dataSource.query(
      `SELECT COUNT(DISTINCT lb.id)::int AS batches, COALESCE(SUM(li.items_given), 0)::int AS items_given,
         COALESCE(SUM(GREATEST(li.items_given - COALESCE(li.items_returned, li.items_given), 0)), 0)::int AS items_missing
       ${joined}`,
      params,
    );
    const rows = await this.dataSource.query(
      `SELECT lb.id AS batch_id, lb.batch_no, lb.returned_on::text AS returned_on, li.admission_id, li.items_given,
         li.items_returned, li.missing_note, ${STUDENT_COLUMNS}
       FROM hostel_laundry_batches lb
       JOIN hostel_laundry_items li ON li.batch_id = lb.id
       JOIN students s ON s.id = li.student_id
       ${studentJoins('s')}
       WHERE ${where.join(' AND ')} AND li.items_returned < li.items_given
       ORDER BY lb.collected_on DESC, lb.id DESC, s.first_name
       LIMIT ${MISSING_ROWS}`,
      params,
    );
    return {
      from,
      to,
      batches: totals.batches,
      items_given: totals.items_given,
      items_missing: totals.items_missing,
      rows: rows.map((row: Record<string, unknown>) => ({
        batch_id: row.batch_id as number,
        batch_no: row.batch_no as string,
        returned_on: (row.returned_on as string | null) ?? null,
        admission_id: row.admission_id as number,
        student: studentFromRow(row),
        items_given: row.items_given as number,
        items_returned: row.items_returned as number,
        missing: missingItems(row.items_given as number, row.items_returned as number),
        missing_note: (row.missing_note as string | null) ?? null,
      })),
    };
  }

  async residentItems(
    schoolId: number,
    admissionId: number,
    query: ListQueryDto,
  ): Promise<Paginated<ParentLaundryDto>> {
    const sort = sortColumn(RESIDENT_SORTS, query.sort, 'collected_on');
    const order = query.order === 'asc' ? 'ASC' : 'DESC';
    const from = `FROM hostel_laundry_items li
       JOIN hostel_laundry_batches lb ON lb.id = li.batch_id AND lb.deleted_at IS NULL
       WHERE li.school_id = $1 AND li.admission_id = $2`;
    const [{ total }] = await this.dataSource.query(`SELECT COUNT(*)::int AS total ${from}`, [schoolId, admissionId]);
    const rows = await this.dataSource.query(
      `SELECT lb.id AS batch_id, lb.batch_no, lb.collected_on::text AS collected_on, lb.status,
         lb.sent_on::text AS sent_on, lb.returned_on::text AS returned_on, li.items_given, li.items_returned,
         li.missing_note
       ${from} ORDER BY ${sort} ${order}, lb.id ${order} ${pageClause(query)}`,
      [schoolId, admissionId],
    );
    return paginate(
      [
        rows.map((row: Record<string, unknown>) => ({
          batch_id: row.batch_id as number,
          batch_no: row.batch_no as string,
          collected_on: row.collected_on as string,
          status: row.status as ParentLaundryDto['status'],
          sent_on: (row.sent_on as string | null) ?? null,
          returned_on: (row.returned_on as string | null) ?? null,
          items_given: row.items_given as number,
          items_returned: (row.items_returned as number | null) ?? null,
          missing: missingItems(row.items_given as number, (row.items_returned as number | null) ?? null),
          missing_note: (row.missing_note as string | null) ?? null,
        })),
        total,
      ],
      query.page,
      query.limit,
    );
  }

  private async lock(
    manager: EntityManager,
    schoolId: number,
    id: number,
    action: LaundryAction,
  ): Promise<HostelLaundryBatch> {
    const batch = await manager.findOne(HostelLaundryBatch, {
      where: { school_id: schoolId, id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!batch) throw AppException.notFound('Laundry batch not found', 'HOSTEL_LAUNDRY_NOT_FOUND');
    if (!laundryMove(batch.status, action)) {
      throw AppException.conflict(`A ${batch.status} laundry batch cannot be changed this way`, 'HOSTEL_LAUNDRY_STATE');
    }
    return batch;
  }

  private async residentStudents(
    manager: EntityManager,
    schoolId: number,
    hostelId: number,
    items: LaundryItemInputDto[],
  ): Promise<Map<number, number>> {
    const ids = items.map((item) => item.admission_id);
    const twice = duplicateIds(ids);
    if (twice.length) {
      throw AppException.badRequest(`Listed twice: admission ${twice.join(', ')}`, 'HOSTEL_LAUNDRY_DUPLICATE');
    }
    const live: { id: number; student_id: number }[] = await manager.query(
      `SELECT id, student_id FROM hostel_admissions
       WHERE school_id = $1 AND hostel_id = $2 AND id = ANY($3::int[]) AND deleted_at IS NULL
         AND status <> 'checked_out'`,
      [schoolId, hostelId, ids],
    );
    const students = new Map(live.map((row) => [Number(row.id), Number(row.student_id)]));
    const missing = ids.filter((id) => !students.has(id));
    if (missing.length) {
      throw AppException.badRequest(
        `Not residents of this hostel: admission ${missing.join(', ')}`,
        'HOSTEL_NOT_RESIDENT',
      );
    }
    return students;
  }

  private async insertItems(
    manager: EntityManager,
    schoolId: number,
    batchId: number,
    items: LaundryItemInputDto[],
    students: Map<number, number>,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO hostel_laundry_items (school_id, batch_id, admission_id, student_id, items_given)
       SELECT $1, $2, x.admission_id, x.student_id, x.items_given
       FROM unnest($3::int[], $4::int[], $5::int[]) AS x(admission_id, student_id, items_given)`,
      [
        schoolId,
        batchId,
        items.map((item) => item.admission_id),
        items.map((item) => students.get(item.admission_id)!),
        items.map((item) => item.items_given),
      ],
    );
  }

  private totalGiven(items: LaundryItemInputDto[]): number {
    return items.reduce((sum, item) => sum + item.items_given, 0);
  }

  private batchSelect(): string {
    return `SELECT lb.id, lb.batch_no, lb.hostel_id, h.name AS hostel_name, lb.collected_on::text AS collected_on,
         lb.vendor_name, lb.status, lb.sent_on::text AS sent_on, lb.returned_on::text AS returned_on, lb.notes,
         u.name AS created_by_name, lb.created_at, t.students, t.items_given, t.items_returned, t.items_missing
       FROM hostel_laundry_batches lb
       JOIN hostels h ON h.id = lb.hostel_id
       LEFT JOIN users u ON u.id = lb.created_by
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS students, COALESCE(SUM(li.items_given), 0)::int AS items_given,
           CASE WHEN COUNT(li.items_returned) = 0 THEN NULL ELSE SUM(li.items_returned)::int END AS items_returned,
           COALESCE(SUM(GREATEST(li.items_given - COALESCE(li.items_returned, li.items_given), 0)), 0)::int
             AS items_missing
         FROM hostel_laundry_items li WHERE li.batch_id = lb.id
       ) t ON true`;
  }

  private toBatch(row: Record<string, unknown>): LaundryBatchDto {
    return {
      id: row.id as number,
      batch_no: row.batch_no as string,
      hostel_id: row.hostel_id as number,
      hostel_name: row.hostel_name as string,
      collected_on: row.collected_on as string,
      vendor_name: (row.vendor_name as string | null) ?? null,
      status: row.status as LaundryBatchDto['status'],
      sent_on: (row.sent_on as string | null) ?? null,
      returned_on: (row.returned_on as string | null) ?? null,
      notes: (row.notes as string | null) ?? null,
      students: Number(row.students ?? 0),
      items_given: Number(row.items_given ?? 0),
      items_returned: row.items_returned === null ? null : Number(row.items_returned),
      items_missing: Number(row.items_missing ?? 0),
      created_by_name: (row.created_by_name as string | null) ?? null,
      created_at: row.created_at as Date,
    };
  }

  private toItem(row: Record<string, unknown>): LaundryItemDto {
    const returned = (row.items_returned as number | null) ?? null;
    return {
      id: row.id as number,
      admission_id: row.admission_id as number,
      student: studentFromRow(row),
      bed: (row.bed as string | null) ?? null,
      items_given: row.items_given as number,
      items_returned: returned,
      missing: missingItems(row.items_given as number, returned),
      missing_note: (row.missing_note as string | null) ?? null,
    };
  }
}
