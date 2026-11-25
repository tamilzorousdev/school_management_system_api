import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AppException, AuthUser, Paginated, paginate } from '@app/common';
import {
  CheckoutDto,
  CheckoutQueryDto,
  CheckoutStartDto,
  ClearanceItemDto,
  ClearanceUpdateDto,
} from './dto/hostel-admission.dto';
import { HostelCheckout, HostelCheckoutItem } from './entities/hostel-admission.entity';
import { HostelAdmissionsService, STUDENT_COLUMNS, studentFromRow, studentJoins } from './hostel-admissions.service';
import { HOSTEL_TEMPLATES } from '../notifications/hostel-templates.catalog';
import { HostelAuditService } from './hostel-audit.service';
import { HostelNotifyService } from './hostel-notify.service';
import { HostelSettingsService } from './hostel-settings.service';
import { checkoutItems } from './hostel.logic';

const CHECKOUT_SORTS: Record<string, string> = {
  created_at: 'k.created_at',
  checkout_date: 'k.checkout_date',
};

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (match) => `\\${match}`);

@Injectable()
export class HostelCheckoutService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly admissions: HostelAdmissionsService,
    private readonly settings: HostelSettingsService,
    private readonly audit: HostelAuditService,
    private readonly notify: HostelNotifyService,
  ) {}

  async list(schoolId: number, query: CheckoutQueryDto): Promise<Paginated<CheckoutDto>> {
    const params: unknown[] = [schoolId];
    const where = ['k.school_id = $1', 'k.deleted_at IS NULL'];
    if (query.status) where.push(`k.status = $${params.push(query.status)}`);
    if (query.hostel_id) where.push(`a.hostel_id = $${params.push(query.hostel_id)}`);
    for (const word of (query.search ?? '').split(/\s+/).filter(Boolean)) {
      const slot = `$${params.push(`%${escapeLike(word)}%`)}`;
      where.push(
        `(a.admission_no ILIKE ${slot} OR s.first_name ILIKE ${slot} OR s.last_name ILIKE ${slot} OR s.admission_no ILIKE ${slot})`,
      );
    }
    const sort = CHECKOUT_SORTS[query.sort ?? 'created_at'];
    if (!sort) {
      throw AppException.badRequest(`sort must be one of ${Object.keys(CHECKOUT_SORTS).join(', ')}`, 'INVALID_SORT');
    }
    const order = query.order === 'asc' ? 'ASC' : 'DESC';
    const from = `${this.checkoutFrom()} WHERE ${where.join(' AND ')}`;
    const [{ total }] = await this.dataSource.query(`SELECT COUNT(*)::int AS total ${from}`, params);
    const rows = await this.dataSource.query(
      `SELECT ${this.checkoutColumns()} ${from} ORDER BY ${sort} ${order}, k.id ${order}
       LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      params,
    );
    const items = await this.itemsFor(rows.map((row: { id: number }) => row.id));
    return paginate(
      [rows.map((row: Record<string, unknown>) => this.toCheckout(row, items.get(row.id as number) ?? [])), total],
      query.page,
      query.limit,
    );
  }

  async get(schoolId: number, id: number): Promise<CheckoutDto> {
    const rows = await this.dataSource.query(
      `SELECT ${this.checkoutColumns()} ${this.checkoutFrom()} WHERE k.school_id = $1 AND k.id = $2 AND k.deleted_at IS NULL`,
      [schoolId, id],
    );
    if (!rows.length) throw AppException.notFound('Checkout not found', 'HOSTEL_CHECKOUT_NOT_FOUND');
    const items = await this.itemsFor([id]);
    return this.toCheckout(rows[0], items.get(id) ?? []);
  }

  async start(schoolId: number, admissionId: number, dto: CheckoutStartDto, actor: AuthUser): Promise<CheckoutDto> {
    const enabled = await this.settings.enabledModules(schoolId);
    const date = dto.checkout_date ?? this.admissions.today();
    const id = await this.dataSource.transaction(async (manager) => {
      const admission = await this.admissions.lockAdmission(manager, schoolId, admissionId);
      if (admission.status === 'checked_out') {
        throw AppException.conflict('This student has already checked out', 'HOSTEL_ADMISSION_CLOSED');
      }
      if (admission.status === 'checking_out') {
        throw AppException.conflict('Checkout has already started for this student', 'HOSTEL_CHECKOUT_OPEN');
      }
      if (date < admission.admitted_on) {
        throw AppException.validation([
          { field: 'checkout_date', message: 'Cannot be before the hostel admission date' },
        ]);
      }
      const checkout = await manager.save(
        manager.create(HostelCheckout, {
          school_id: schoolId,
          admission_id: admission.id,
          student_id: admission.student_id,
          status: 'open',
          reason: dto.reason,
          checkout_date: date,
          forwarding_address: dto.forwarding_address ?? null,
          remarks: dto.remarks ?? null,
          created_by: actor.id,
        }),
      );
      await manager.insert(
        HostelCheckoutItem,
        checkoutItems(enabled).map((item, index) => ({
          school_id: schoolId,
          checkout_id: checkout.id,
          code: item.code,
          label: item.label,
          sort_order: index,
          status: 'pending' as const,
        })),
      );
      const before = admission.status;
      admission.status = 'checking_out';
      await manager.save(admission);
      await this.audit.record(manager, schoolId, actor, {
        entity: 'admission',
        entity_id: admission.id,
        action: 'checkout_start',
        student_id: admission.student_id,
        changes: {
          status: [before, 'checking_out'],
          reason: dto.reason,
          checkout_date: date,
          checkout_id: checkout.id,
        },
      });
      return checkout.id;
    });
    return this.get(schoolId, id);
  }

  async updateItem(
    schoolId: number,
    id: number,
    code: string,
    dto: ClearanceUpdateDto,
    actor: AuthUser,
  ): Promise<CheckoutDto> {
    await this.dataSource.transaction(async (manager) => {
      const checkout = await this.lockOpen(manager, schoolId, id);
      const item = await manager.findOneBy(HostelCheckoutItem, { checkout_id: id, code });
      if (!item) throw AppException.notFound('Clearance item not found', 'HOSTEL_CLEARANCE_ITEM_NOT_FOUND');
      const before = item.status;
      item.status = dto.status;
      if (dto.amount !== undefined) item.amount = dto.amount;
      if (dto.note !== undefined) item.note = dto.note;
      item.cleared_by = dto.status === 'pending' ? null : actor.id;
      item.cleared_at = dto.status === 'pending' ? null : new Date();
      await manager.save(item);
      await this.audit.record(manager, schoolId, actor, {
        entity: 'checkout',
        entity_id: id,
        action: 'clearance',
        student_id: checkout.student_id,
        changes: { code, status: [before, dto.status], amount: item.amount },
        note: item.note,
      });
    });
    return this.get(schoolId, id);
  }

  async complete(schoolId: number, id: number, actor: AuthUser): Promise<CheckoutDto> {
    const done = await this.dataSource.transaction(async (manager) => {
      const checkout = await this.lockOpen(manager, schoolId, id);
      const pending = await manager.countBy(HostelCheckoutItem, { checkout_id: id, status: 'pending' });
      if (pending) {
        throw AppException.conflict(
          `${pending} clearance item(s) are still pending. Clear or waive them first.`,
          'HOSTEL_CLEARANCE_PENDING',
        );
      }
      const admission = await this.admissions.lockAdmission(manager, schoolId, checkout.admission_id);
      const allocation = await this.admissions.liveAllocation(manager, schoolId, admission.id);
      const date =
        allocation && checkout.checkout_date < allocation.from_date ? allocation.from_date : checkout.checkout_date;
      if (allocation) await this.admissions.closeAllocation(manager, allocation, date, 'checkout');
      admission.status = 'checked_out';
      admission.checked_out_on = date;
      await manager.save(admission);
      Object.assign(checkout, { status: 'completed', completed_by: actor.id, completed_at: new Date() });
      await manager.save(checkout);
      await this.audit.record(manager, schoolId, actor, {
        entity: 'admission',
        entity_id: admission.id,
        action: 'checkout_complete',
        student_id: admission.student_id,
        changes: { status: ['checking_out', 'checked_out'], bed_id: allocation?.bed_id ?? null, checked_out_on: date },
      });
      return { admission_id: admission.id, date };
    });
    await this.notify.tellParents(done.admission_id, HOSTEL_TEMPLATES.HOSTEL_CHECKED_OUT, { date: done.date });
    return this.get(schoolId, id);
  }

  async cancel(schoolId: number, id: number, actor: AuthUser): Promise<CheckoutDto> {
    await this.dataSource.transaction(async (manager) => {
      const checkout = await this.lockOpen(manager, schoolId, id);
      const admission = await this.admissions.lockAdmission(manager, schoolId, checkout.admission_id);
      admission.status = 'active';
      await manager.save(admission);
      checkout.status = 'cancelled';
      await manager.save(checkout);
      await this.audit.record(manager, schoolId, actor, {
        entity: 'admission',
        entity_id: admission.id,
        action: 'checkout_cancel',
        student_id: admission.student_id,
        changes: { status: ['checking_out', 'active'], checkout_id: id },
      });
    });
    return this.get(schoolId, id);
  }

  private async lockOpen(manager: EntityManager, schoolId: number, id: number): Promise<HostelCheckout> {
    const checkout = await manager.findOne(HostelCheckout, {
      where: { school_id: schoolId, id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!checkout) throw AppException.notFound('Checkout not found', 'HOSTEL_CHECKOUT_NOT_FOUND');
    if (checkout.status !== 'open') {
      throw AppException.conflict(`This checkout is already ${checkout.status}`, 'HOSTEL_CHECKOUT_CLOSED');
    }
    return checkout;
  }

  private async itemsFor(ids: number[]): Promise<Map<number, ClearanceItemDto[]>> {
    if (!ids.length) return new Map();
    const rows: (ClearanceItemDto & { checkout_id: number })[] = await this.dataSource.query(
      `SELECT i.checkout_id, i.code, i.label, i.status, i.amount::float AS amount, i.note, u.name AS cleared_by_name, i.cleared_at
       FROM hostel_checkout_items i LEFT JOIN users u ON u.id = i.cleared_by
       WHERE i.checkout_id = ANY($1) ORDER BY i.checkout_id, i.sort_order`,
      [ids],
    );
    const map = new Map<number, ClearanceItemDto[]>();
    for (const { checkout_id, ...item } of rows) {
      map.set(checkout_id, [...(map.get(checkout_id) ?? []), item]);
    }
    return map;
  }

  private checkoutColumns(): string {
    return `k.id, k.admission_id, a.admission_no, h.name AS hostel_name, k.status, k.reason,
         k.checkout_date::text AS checkout_date, k.forwarding_address, k.remarks, k.completed_at, k.created_at,
         ${STUDENT_COLUMNS},
         (SELECT CONCAT(r.room_no, ' / ', bd.bed_no) FROM hostel_allocations al
            JOIN hostel_rooms r ON r.id = al.room_id JOIN hostel_beds bd ON bd.id = al.bed_id
            WHERE al.admission_id = a.id ORDER BY al.to_date IS NULL DESC, al.id DESC LIMIT 1) AS bed`;
  }

  private checkoutFrom(): string {
    return `FROM hostel_checkouts k
       JOIN hostel_admissions a ON a.id = k.admission_id
       JOIN hostels h ON h.id = a.hostel_id
       JOIN students s ON s.id = k.student_id
       ${studentJoins('s')}`;
  }

  private toCheckout(row: Record<string, unknown>, items: ClearanceItemDto[]): CheckoutDto {
    return {
      id: row.id as number,
      admission_id: row.admission_id as number,
      admission_no: row.admission_no as string,
      student: studentFromRow(row),
      hostel_name: row.hostel_name as string,
      bed: (row.bed as string | null) ?? null,
      status: row.status as CheckoutDto['status'],
      reason: row.reason as CheckoutDto['reason'],
      checkout_date: row.checkout_date as string,
      forwarding_address: (row.forwarding_address as string | null) ?? null,
      remarks: (row.remarks as string | null) ?? null,
      pending_items: items.filter((item) => item.status === 'pending').length,
      items,
      completed_at: (row.completed_at as Date | null) ?? null,
      created_at: row.created_at as Date,
    };
  }
}
