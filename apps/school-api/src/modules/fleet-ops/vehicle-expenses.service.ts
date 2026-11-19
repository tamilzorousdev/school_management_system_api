import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppException, AuthUser, FieldError, listQuery, Paginated } from '@app/common';
import { monthStartIn } from '../../shared/dates';
import { FilesService } from '../files/files.service';
import { VehicleExpiryKind } from '../transport/entities/expiry-alert.entity';
import { VEHICLE_EXPIRY_FIELDS } from '../transport/entities/vehicle-document.entity';
import { Vehicle } from '../transport/entities/vehicle.entity';
import {
  ExpenseDto,
  ExpenseInputDto,
  ExpenseInsightsDto,
  ExpenseQueryDto,
  UpdateExpenseDto,
} from './dto/fleet-maintenance.dto';
import { ExpenseCategory, VehicleExpense } from './entities/fleet-maintenance.entity';
import { changedFields, FleetBooksService } from './fleet-books.service';
import { FleetVendorsService } from './fleet-vendors.service';
import { assertReimbursable } from './fuel.service';

const AUDITED = [
  'spent_on',
  'category',
  'amount',
  'vendor_id',
  'paid_to',
  'payment_mode',
  'bill_file_id',
  'renewed_until',
] as const;

export function renewalField(category: ExpenseCategory): string | null {
  return VEHICLE_EXPIRY_FIELDS[category as VehicleExpiryKind] ?? null;
}

@Injectable()
export class VehicleExpensesService {
  constructor(
    @InjectRepository(VehicleExpense) private readonly expenses: Repository<VehicleExpense>,
    private readonly books: FleetBooksService,
    private readonly vendors: FleetVendorsService,
    private readonly files: FilesService,
    private readonly dataSource: DataSource,
  ) {}

  async list(schoolId: number, query: ExpenseQueryDto): Promise<Paginated<ExpenseDto>> {
    const qb = this.expenses
      .createQueryBuilder('e')
      .leftJoin(Vehicle, 'v', 'v.id = e.vehicle_id')
      .where('e.school_id = :schoolId', { schoolId });
    if (query.vehicle_id) qb.andWhere('e.vehicle_id = :vehicleId', { vehicleId: query.vehicle_id });
    if (query.category) qb.andWhere('e.category = :category', { category: query.category });
    if (query.payment_mode) qb.andWhere('e.payment_mode = :mode', { mode: query.payment_mode });
    if (query.reimbursed !== undefined) {
      qb.andWhere(`e.payment_mode = 'driver_paid' AND e.reimbursed_at IS ${query.reimbursed ? 'NOT NULL' : 'NULL'}`);
    }
    if (query.from) qb.andWhere('e.spent_on >= :from', { from: query.from });
    if (query.to) qb.andWhere('e.spent_on <= :to', { to: query.to });
    const page = await listQuery(qb, query, {
      searchable: ['e.paid_to', 'e.note', 'e.category', 'v.registration_no', 'v.name'],
      sortable: { spent_on: 'e.spent_on', amount: 'e.amount', created_at: 'e.created_at' },
      defaultSort: 'spent_on',
    });
    return { ...page, items: await this.present(page.items) };
  }

  async insights(schoolId: number, vehicleId?: number): Promise<ExpenseInsightsDto> {
    const params: unknown[] = [schoolId, monthStartIn(this.books.timeZone)];
    const busFilter = vehicleId ? `AND vehicle_id = $${params.push(vehicleId)}` : '';
    const [totals] = await this.dataSource.query(
      `SELECT COUNT(*) FILTER (WHERE spent_on >= $2)::int AS entries,
              COALESCE(SUM(amount) FILTER (WHERE spent_on >= $2), 0)::float AS amount,
              COALESCE(SUM(amount) FILTER (WHERE payment_mode = 'driver_paid' AND reimbursed_at IS NULL), 0)::float AS unpaid
       FROM vehicle_expenses WHERE school_id = $1 AND deleted_at IS NULL ${busFilter}`,
      params,
    );
    const byCategory: { category: string; amount: number }[] = await this.dataSource.query(
      `SELECT category, SUM(amount)::float AS amount FROM vehicle_expenses
       WHERE school_id = $1 AND deleted_at IS NULL AND spent_on >= $2 ${busFilter}
       GROUP BY category ORDER BY amount DESC`,
      params,
    );
    return {
      entries_this_month: totals.entries,
      amount_this_month: Math.round(totals.amount * 100) / 100,
      by_category: byCategory.map((row) => ({ category: row.category, amount: Math.round(row.amount * 100) / 100 })),
      driver_paid_pending: Math.round(totals.unpaid * 100) / 100,
    };
  }

  async get(schoolId: number, id: number): Promise<ExpenseDto> {
    return (await this.present([await this.find(schoolId, id)]))[0]!;
  }

  async create(schoolId: number, dto: ExpenseInputDto, actor: AuthUser): Promise<ExpenseDto> {
    const vehicle = await this.books.bus(schoolId, dto.vehicle_id);
    await this.validate(schoolId, dto);
    const saved = await this.dataSource.transaction(async (manager) => {
      const row = await manager.getRepository(VehicleExpense).save(
        manager.getRepository(VehicleExpense).create({
          school_id: schoolId,
          vehicle_id: vehicle.id,
          spent_on: dto.spent_on,
          category: dto.category,
          amount: dto.amount,
          vendor_id: dto.vendor_id ?? null,
          paid_to: (await this.vendorName(dto.vendor_id)) ?? dto.paid_to ?? null,
          payment_mode: dto.payment_mode ?? 'cash',
          bill_file_id: dto.bill_file_id ?? null,
          note: dto.note ?? null,
          renewed_until: dto.renewed_until ?? null,
          created_by: actor.id,
        }),
      );
      await this.renew(manager.getRepository(Vehicle), vehicle, dto.category, dto.renewed_until ?? null);
      return row;
    });
    await this.books.checkBudget(schoolId, vehicle.id, dto.spent_on);
    return this.get(schoolId, saved.id);
  }

  async update(schoolId: number, id: number, dto: UpdateExpenseDto, actor: AuthUser): Promise<ExpenseDto> {
    const expense = await this.find(schoolId, id);
    await this.books.assertOpen(schoolId, [expense.spent_on, dto.spent_on], 'spent_on');
    const merged = {
      spent_on: dto.spent_on ?? expense.spent_on,
      category: dto.category ?? expense.category,
      vendor_id: dto.vendor_id === undefined ? undefined : dto.vendor_id,
      bill_file_id: dto.bill_file_id === undefined ? undefined : dto.bill_file_id,
      renewed_until: expense.renewed_until,
    };
    await this.validate(schoolId, merged, expense);
    const changes: Partial<VehicleExpense> = {};
    for (const key of [
      'spent_on',
      'category',
      'amount',
      'vendor_id',
      'paid_to',
      'payment_mode',
      'bill_file_id',
      'note',
    ] as const) {
      if (dto[key] !== undefined) Object.assign(changes, { [key]: dto[key] });
    }
    if (dto.vendor_id) changes.paid_to = await this.vendorName(dto.vendor_id);
    const diff = changedFields(
      expense as unknown as Record<string, unknown>,
      Object.fromEntries(AUDITED.filter((key) => changes[key] !== undefined).map((key) => [key, changes[key]])),
    );
    if (diff) {
      await this.books.record(schoolId, {
        entity: 'expense',
        entity_id: expense.id,
        vehicle_id: expense.vehicle_id,
        action: 'update',
        ...diff,
        note: dto.reason ?? null,
        actor,
      });
    }
    await this.expenses.save(this.expenses.merge(expense, changes));
    await this.books.checkBudget(schoolId, expense.vehicle_id, merged.spent_on);
    return this.get(schoolId, id);
  }

  async remove(schoolId: number, id: number, actor: AuthUser, reason: string | null): Promise<void> {
    const expense = await this.find(schoolId, id);
    await this.books.assertOpen(schoolId, [expense.spent_on], 'spent_on');
    await this.books.record(schoolId, {
      entity: 'expense',
      entity_id: expense.id,
      vehicle_id: expense.vehicle_id,
      action: 'delete',
      before: Object.fromEntries(AUDITED.map((key) => [key, expense[key]])),
      after: null,
      note: reason,
      actor,
    });
    await this.expenses.softDelete(expense.id);
  }

  async reimburse(schoolId: number, id: number, actor: AuthUser): Promise<ExpenseDto> {
    const expense = await this.find(schoolId, id);
    assertReimbursable(expense.payment_mode, expense.reimbursed_at);
    await this.expenses.update(expense.id, { reimbursed_at: new Date(), reimbursed_by: actor.id });
    await this.books.record(schoolId, {
      entity: 'expense',
      entity_id: expense.id,
      vehicle_id: expense.vehicle_id,
      action: 'reimburse',
      before: { reimbursed: false },
      after: { reimbursed: true, amount: expense.amount },
      actor,
    });
    return this.get(schoolId, id);
  }

  private async renew(
    vehicles: Repository<Vehicle>,
    vehicle: Vehicle,
    category: ExpenseCategory,
    renewedUntil: string | null,
  ): Promise<void> {
    const field = renewalField(category);
    if (!field || !renewedUntil) return;
    await vehicles.update(vehicle.id, { [field]: renewedUntil } as Partial<Vehicle>);
  }

  private async validate(
    schoolId: number,
    dto: {
      spent_on: string;
      category: ExpenseCategory;
      vendor_id?: number | null;
      bill_file_id?: number | null;
      renewed_until?: string | null;
    },
    current?: VehicleExpense,
  ): Promise<void> {
    await this.books.assertOpen(schoolId, [dto.spent_on], 'spent_on');
    const errors: FieldError[] = [];
    if (dto.spent_on > this.books.today())
      errors.push({ field: 'spent_on', message: 'spent_on cannot be in the future' });
    if (!current && dto.renewed_until) {
      if (!renewalField(dto.category)) {
        errors.push({
          field: 'renewed_until',
          message: 'renewed_until is only for document renewals (insurance, fitness, permit…)',
        });
      } else if (dto.renewed_until <= dto.spent_on) {
        errors.push({ field: 'renewed_until', message: 'renewed_until must be after spent_on' });
      }
    }
    if (errors.length) throw AppException.validation(errors);
    await this.vendors.assertUsable(schoolId, dto.vendor_id, ['garage', 'other', 'fuel_station'], 'vendor_id');
    if (dto.bill_file_id && dto.bill_file_id !== current?.bill_file_id) {
      await this.files.assertAttachable(dto.bill_file_id, schoolId, 'bill_file_id');
    }
  }

  private async vendorName(vendorId: number | null | undefined): Promise<string | null> {
    if (!vendorId) return null;
    return (await this.vendors.refs([vendorId])).get(vendorId)?.name ?? null;
  }

  private async find(schoolId: number, id: number): Promise<VehicleExpense> {
    const expense = await this.expenses.findOneBy({ id, school_id: schoolId });
    if (!expense) throw AppException.notFound('Expense not found', 'EXPENSE_NOT_FOUND');
    return expense;
  }

  private async present(rows: VehicleExpense[]): Promise<ExpenseDto[]> {
    if (!rows.length) return [];
    const [buses, vendors, files, people] = await Promise.all([
      this.books.busRefs(rows.map((row) => row.vehicle_id)),
      this.vendors.refs(rows.map((row) => row.vendor_id)),
      this.files.presentMany(rows.map((row) => row.bill_file_id)),
      this.books.people(rows.map((row) => row.created_by)),
    ]);
    return rows.map((row) => ({
      id: row.id,
      vehicle: buses.get(row.vehicle_id) ?? { id: row.vehicle_id, registration_no: '', name: '' },
      spent_on: row.spent_on,
      category: row.category,
      amount: row.amount,
      vendor: row.vendor_id ? (vendors.get(row.vendor_id) ?? null) : null,
      paid_to: row.paid_to,
      payment_mode: row.payment_mode,
      reimbursed_at: row.reimbursed_at,
      bill_file: row.bill_file_id ? (files.get(row.bill_file_id) ?? null) : null,
      note: row.note,
      renewed_until: row.renewed_until,
      created_by: row.created_by ? (people.get(row.created_by) ?? null) : null,
      created_at: row.created_at,
    }));
  }
}
