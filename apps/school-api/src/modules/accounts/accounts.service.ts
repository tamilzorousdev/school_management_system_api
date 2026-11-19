import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AppException, AuthUser, FieldError, listQuery, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { monthStartIn, todayIn } from '../../shared/dates';
import { PERMISSIONS } from '../access/access.catalog';
import { FeesService } from '../fees/fees.service';
import { FilesService } from '../files/files.service';
import { schoolInfo } from '../library/copy-events';
import { SequencesService } from '../schools/sequences.service';
import {
  assertDecidable,
  assertDeletable,
  assertEditable,
  DEFAULT_CATEGORIES,
  ENTRY_PREFIX,
  EntryActor,
  initialStatus,
} from './accounts.logic';
import {
  AccountInsightsDto,
  CategoryDto,
  CategoryInputDto,
  CategoryQueryDto,
  DecisionDto,
  EntryDto,
  EntryInputDto,
  EntryQueryDto,
  UpdateCategoryDto,
  UpdateEntryDto,
  VoidEntryDto,
} from './dto/accounts.dto';
import { ACCOUNT_KINDS, AccountCategory, AccountKind } from './entities/account-category.entity';
import { AccountEntry } from './entities/account-entry.entity';
import { voucherPdf } from './voucher.pdf';

const round2 = (value: number) => Math.round(value * 100) / 100;

export function entryActor(actor: AuthUser): EntryActor {
  return { id: actor.id, can_approve: actor.permissions.includes(PERMISSIONS.ACCOUNTS_APPROVE) };
}

@Injectable()
export class AccountsService {
  private readonly sequences = new SequencesService();

  constructor(
    @InjectRepository(AccountCategory) private readonly categories: Repository<AccountCategory>,
    @InjectRepository(AccountEntry) private readonly entries: Repository<AccountEntry>,
    private readonly files: FilesService,
    private readonly fees: FeesService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  today(): string {
    return todayIn(this.app.timeZone);
  }

  async listCategories(schoolId: number, query: CategoryQueryDto): Promise<CategoryDto[]> {
    await this.ensureDefaults(schoolId);
    const rows = await this.categories.find({
      where: {
        school_id: schoolId,
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.include_inactive ? {} : { is_active: true }),
      },
      order: { kind: 'ASC', sort_order: 'ASC', name: 'ASC' },
    });
    const counts: { category_id: number; entries: number }[] = rows.length
      ? await this.dataSource.query(
          `SELECT category_id, count(*)::int AS entries FROM account_entries
           WHERE school_id = $1 AND deleted_at IS NULL AND category_id = ANY($2) GROUP BY category_id`,
          [schoolId, rows.map((row) => row.id)],
        )
      : [];
    const used = new Map(counts.map((row) => [Number(row.category_id), Number(row.entries)]));
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      is_active: row.is_active,
      entries: used.get(row.id) ?? 0,
    }));
  }

  async createCategory(schoolId: number, dto: CategoryInputDto): Promise<CategoryDto> {
    await this.ensureDefaults(schoolId);
    await this.assertUniqueName(schoolId, dto.kind, dto.name);
    const last = await this.categories.findOne({
      where: { school_id: schoolId, kind: dto.kind },
      order: { sort_order: 'DESC' },
    });
    const saved = await this.categories.save(
      this.categories.create({
        school_id: schoolId,
        kind: dto.kind,
        name: dto.name,
        sort_order: (last?.sort_order ?? 0) + 1,
      }),
    );
    return { id: saved.id, kind: saved.kind, name: saved.name, is_active: saved.is_active, entries: 0 };
  }

  async updateCategory(schoolId: number, id: number, dto: UpdateCategoryDto): Promise<CategoryDto> {
    const category = await this.findCategory(schoolId, id);
    if (dto.name !== undefined && dto.name.toLowerCase() !== category.name.toLowerCase()) {
      await this.assertUniqueName(schoolId, category.kind, dto.name, category.id);
    }
    await this.categories.update(category.id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.is_active !== undefined ? { is_active: dto.is_active } : {}),
    });
    const [row] = (await this.listCategories(schoolId, { kind: category.kind, include_inactive: true })).filter(
      (item) => item.id === category.id,
    );
    return row;
  }

  async removeCategory(schoolId: number, id: number): Promise<void> {
    const category = await this.findCategory(schoolId, id);
    const used = await this.entries.countBy({ school_id: schoolId, category_id: category.id });
    if (used > 0) {
      throw AppException.conflict(
        'This category has entries. Switch it off instead so it is not offered for new entries.',
        'CATEGORY_IN_USE',
      );
    }
    await this.categories.softDelete(category.id);
  }

  async list(schoolId: number, query: EntryQueryDto, actor: AuthUser): Promise<Paginated<EntryDto>> {
    const qb = this.entries
      .createQueryBuilder('e')
      .leftJoin(AccountCategory, 'c', 'c.id = e.category_id')
      .where('e.school_id = :schoolId', { schoolId });
    if (query.kind) qb.andWhere('e.kind = :kind', { kind: query.kind });
    if (query.status) qb.andWhere('e.status = :status', { status: query.status });
    if (query.category_id) qb.andWhere('e.category_id = :categoryId', { categoryId: query.category_id });
    if (query.payment_mode) qb.andWhere('e.payment_mode = :mode', { mode: query.payment_mode });
    if (query.from) qb.andWhere('e.entry_date >= :from', { from: query.from });
    if (query.to) qb.andWhere('e.entry_date <= :to', { to: query.to });
    const page = await listQuery(qb, query, {
      searchable: ['e.entry_no', 'e.party', 'e.reference', 'e.note', 'c.name'],
      sortable: { entry_date: 'e.entry_date', amount: 'e.amount', created_at: 'e.created_at', entry_no: 'e.entry_no' },
      defaultSort: 'entry_date',
    });
    return { ...page, items: await this.present(page.items, entryActor(actor)) };
  }

  async insights(schoolId: number): Promise<AccountInsightsDto> {
    const monthStart = monthStartIn(this.app.timeZone);
    const [totals]: {
      income: number;
      expense: number;
      pending: number;
      pending_amount: number;
      pending_expense: number;
      pending_income: number;
    }[] = await this.dataSource.query(
      `SELECT COALESCE(sum(amount) FILTER (WHERE kind = 'income' AND status = 'approved' AND entry_date >= $2), 0)::float AS income,
                COALESCE(sum(amount) FILTER (WHERE kind = 'expense' AND status = 'approved' AND entry_date >= $2), 0)::float AS expense,
                count(*) FILTER (WHERE status = 'pending')::int AS pending,
                COALESCE(sum(amount) FILTER (WHERE status = 'pending'), 0)::float AS pending_amount,
                count(*) FILTER (WHERE status = 'pending' AND kind = 'expense')::int AS pending_expense,
                count(*) FILTER (WHERE status = 'pending' AND kind = 'income')::int AS pending_income
         FROM account_entries WHERE school_id = $1 AND deleted_at IS NULL`,
      [schoolId, monthStart],
    );
    const byCategory: { kind: AccountKind; category: string; amount: number }[] = await this.dataSource.query(
      `SELECT e.kind, c.name AS category, sum(e.amount)::float AS amount
       FROM account_entries e JOIN account_categories c ON c.id = e.category_id
       WHERE e.school_id = $1 AND e.deleted_at IS NULL AND e.status = 'approved' AND e.entry_date >= $2
       GROUP BY e.kind, c.name ORDER BY amount DESC`,
      [schoolId, monthStart],
    );
    const pick = (kind: AccountKind) =>
      byCategory
        .filter((row) => row.kind === kind)
        .map((row) => ({ category: row.category, amount: round2(Number(row.amount)) }));
    return {
      month_start: monthStart,
      income_this_month: round2(totals.income),
      expense_this_month: round2(totals.expense),
      pending: totals.pending,
      pending_amount: round2(totals.pending_amount),
      pending_expense: totals.pending_expense,
      pending_income: totals.pending_income,
      expense_by_category: pick('expense'),
      income_by_category: pick('income'),
    };
  }

  async get(schoolId: number, id: number, actor: AuthUser): Promise<EntryDto> {
    return (await this.present([await this.find(schoolId, id)], entryActor(actor)))[0]!;
  }

  async create(schoolId: number, dto: EntryInputDto, actor: AuthUser): Promise<EntryDto> {
    const who = entryActor(actor);
    await this.validate(schoolId, dto.kind, dto);
    const status = initialStatus(who);
    const id = await this.dataSource.transaction(async (manager) => {
      const year = dto.entry_date.slice(0, 4);
      const school = await schoolInfo(manager, schoolId);
      const value = await this.sequences.next(manager, schoolId, `account_${dto.kind}:${year}`);
      const row = await manager.save(
        manager.create(AccountEntry, {
          school_id: schoolId,
          kind: dto.kind,
          entry_no: SequencesService.format(`${school.code}-${ENTRY_PREFIX[dto.kind]}`, year, value),
          category_id: dto.category_id,
          entry_date: dto.entry_date,
          amount: dto.amount,
          payment_mode: dto.payment_mode ?? 'cash',
          party: dto.party ?? null,
          reference: dto.reference ?? null,
          file_id: dto.file_id ?? null,
          note: dto.note ?? null,
          status,
          decided_by: status === 'approved' ? actor.id : null,
          decided_at: status === 'approved' ? new Date() : null,
          created_by: actor.id,
        }),
      );
      return row.id;
    });
    return this.get(schoolId, id, actor);
  }

  async update(schoolId: number, id: number, dto: UpdateEntryDto, actor: AuthUser): Promise<EntryDto> {
    const entry = await this.find(schoolId, id);
    assertEditable(entry, entryActor(actor));
    await this.validate(
      schoolId,
      entry.kind,
      {
        category_id: dto.category_id ?? entry.category_id,
        entry_date: dto.entry_date ?? entry.entry_date,
        file_id: dto.file_id,
      },
      entry,
    );
    const changes: Partial<AccountEntry> = {};
    for (const key of [
      'category_id',
      'entry_date',
      'amount',
      'payment_mode',
      'party',
      'reference',
      'file_id',
      'note',
    ] as const) {
      if (dto[key] !== undefined) Object.assign(changes, { [key]: dto[key] });
    }
    if (Object.keys(changes).length) await this.entries.update(entry.id, changes);
    return this.get(schoolId, id, actor);
  }

  async remove(schoolId: number, id: number, actor: AuthUser): Promise<void> {
    const entry = await this.find(schoolId, id);
    assertDeletable(entry, entryActor(actor));
    await this.entries.softDelete(entry.id);
  }

  async approve(schoolId: number, id: number, dto: DecisionDto, actor: AuthUser): Promise<EntryDto> {
    return this.decide(schoolId, id, 'approve', dto.note ?? null, actor);
  }

  async reject(schoolId: number, id: number, dto: DecisionDto, actor: AuthUser): Promise<EntryDto> {
    return this.decide(schoolId, id, 'reject', dto.note ?? null, actor);
  }

  async void(schoolId: number, id: number, dto: VoidEntryDto, actor: AuthUser): Promise<EntryDto> {
    return this.decide(schoolId, id, 'void', dto.reason, actor);
  }

  async voucher(schoolId: number, id: number): Promise<{ name: string; pdf: Buffer }> {
    const entry = await this.find(schoolId, id);
    const [school, categories, people] = await Promise.all([
      this.fees.pdfSchool(schoolId),
      this.categoryNames([entry.category_id]),
      this.people([entry.created_by, entry.decided_by]),
    ]);
    const pdf = await voucherPdf({
      ...school,
      kind: entry.kind,
      entry_no: entry.entry_no,
      entry_date: entry.entry_date,
      category: categories.get(entry.category_id) ?? '',
      amount: Number(entry.amount),
      payment_mode: entry.payment_mode,
      party: entry.party,
      reference: entry.reference,
      note: entry.note,
      status: entry.status,
      added_by: entry.created_by ? (people.get(entry.created_by) ?? null) : null,
      decided_by: entry.decided_by ? (people.get(entry.decided_by) ?? null) : null,
      decision_note: entry.decision_note,
    });
    return { name: entry.entry_no, pdf };
  }

  async find(schoolId: number, id: number): Promise<AccountEntry> {
    const entry = await this.entries.findOneBy({ id, school_id: schoolId });
    if (!entry) throw AppException.notFound('Entry not found', 'ENTRY_NOT_FOUND');
    return entry;
  }

  async categoryNames(ids: number[]): Promise<Map<number, string>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows = await this.categories.find({ where: { id: In(unique) }, withDeleted: true });
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  async people(ids: (number | null)[]): Promise<Map<number, string>> {
    const unique = [...new Set(ids.filter((id): id is number => typeof id === 'number'))];
    if (!unique.length) return new Map();
    const rows: { id: number; name: string }[] = await this.dataSource.query(
      `SELECT u.id, u.name FROM users u WHERE u.id = ANY($1)`,
      [unique],
    );
    return new Map(rows.map((row) => [Number(row.id), row.name]));
  }

  private async decide(
    schoolId: number,
    id: number,
    decision: 'approve' | 'reject' | 'void',
    note: string | null,
    actor: AuthUser,
  ): Promise<EntryDto> {
    const entry = await this.find(schoolId, id);
    assertDecidable(entry, decision);
    const status = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'void';
    const result = await this.entries.update(
      { id: entry.id, status: entry.status },
      { status, decided_by: actor.id, decided_at: new Date(), decision_note: note },
    );
    if (!result.affected) {
      throw AppException.conflict('This entry was changed by someone else. Reload and try again.', 'ENTRY_CHANGED');
    }
    return this.get(schoolId, id, actor);
  }

  private async validate(
    schoolId: number,
    kind: AccountKind,
    dto: { category_id: number; entry_date: string; file_id?: number | null },
    current?: AccountEntry,
  ): Promise<void> {
    const errors: FieldError[] = [];
    if (dto.entry_date > this.today())
      errors.push({ field: 'entry_date', message: 'entry_date cannot be in the future' });
    const category = await this.categories.findOneBy({ id: dto.category_id, school_id: schoolId });
    if (!category || category.kind !== kind) {
      errors.push({ field: 'category_id', message: `category_id does not match an ${kind} category` });
    } else if (!category.is_active && category.id !== current?.category_id) {
      errors.push({ field: 'category_id', message: 'This category is switched off' });
    }
    if (errors.length) throw AppException.validation(errors);
    if (dto.file_id && dto.file_id !== current?.file_id) {
      await this.files.assertAttachable(dto.file_id, schoolId, 'file_id');
    }
  }

  private async assertUniqueName(schoolId: number, kind: AccountKind, name: string, exceptId?: number) {
    const clash = await this.categories
      .createQueryBuilder('c')
      .where('c.school_id = :schoolId AND c.kind = :kind AND lower(c.name) = lower(:name)', { schoolId, kind, name })
      .andWhere(exceptId ? 'c.id <> :exceptId' : '1=1', { exceptId })
      .getExists();
    if (clash) {
      throw AppException.conflict(`There is already an ${kind} category called ${name}`, 'CATEGORY_EXISTS');
    }
  }

  private async findCategory(schoolId: number, id: number): Promise<AccountCategory> {
    const category = await this.categories.findOneBy({ id, school_id: schoolId });
    if (!category) throw AppException.notFound('Category not found', 'CATEGORY_NOT_FOUND');
    return category;
  }

  private async ensureDefaults(schoolId: number): Promise<void> {
    if (await this.categories.exists({ where: { school_id: schoolId }, withDeleted: true })) return;
    await this.categories
      .createQueryBuilder()
      .insert()
      .values(
        ACCOUNT_KINDS.flatMap((kind) =>
          DEFAULT_CATEGORIES[kind].map((name, index) => ({ school_id: schoolId, kind, name, sort_order: index + 1 })),
        ),
      )
      .orIgnore()
      .execute();
  }

  private async present(rows: AccountEntry[], actor: EntryActor): Promise<EntryDto[]> {
    if (!rows.length) return [];
    const [categories, people, files] = await Promise.all([
      this.categoryNames(rows.map((row) => row.category_id)),
      this.people(rows.flatMap((row) => [row.created_by, row.decided_by])),
      this.files.presentMany(rows.map((row) => row.file_id)),
    ]);
    const person = (id: number | null) => (id ? { id, name: people.get(id) ?? '' } : null);
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      entry_no: row.entry_no,
      category: { id: row.category_id, name: categories.get(row.category_id) ?? '' },
      entry_date: row.entry_date,
      amount: Number(row.amount),
      payment_mode: row.payment_mode,
      party: row.party,
      reference: row.reference,
      file: row.file_id ? (files.get(row.file_id) ?? null) : null,
      note: row.note,
      status: row.status,
      created_by: person(row.created_by),
      created_at: row.created_at,
      decided_by: person(row.decided_by),
      decided_at: row.decided_at,
      decision_note: row.decision_note,
      can_edit: row.status === 'pending' && (actor.can_approve || row.created_by === actor.id),
    }));
  }
}
