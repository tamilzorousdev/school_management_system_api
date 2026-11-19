import { Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { AppException, AuthUser, paginate, Paginated } from '@app/common';
import { logCopyEvents } from './copy-events';
import { CopyDto } from './dto/catalogue.dto';
import {
  AuditCloseDto,
  AuditCreateDto,
  AuditDto,
  AuditItemDto,
  AuditItemsQueryDto,
  AuditScanResultDto,
} from './dto/desk.dto';
import { BookCategory, BookCopy } from './entities/book.entity';
import { AuditFinding, LibraryStockAudit, LibraryStockAuditItem } from './entities/library-visit.entity';
import { LibraryReadService, param, Row, SqlFilter } from './library-read.service';

const FINDING_MESSAGES: Record<AuditFinding, string> = {
  found: 'Found on the shelf',
  misplaced: 'Belongs to another rack or category',
  was_issued: 'Shown as on loan but found on the shelf: check the loan',
  was_lost: 'Shown as lost but found on the shelf',
  unknown: 'This code is not in the catalogue',
};

@Injectable()
export class AuditsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly read: LibraryReadService,
  ) {}

  private scopeFilter(audit: LibraryStockAudit, filter: SqlFilter): void {
    if (audit.category_id) filter.where.push(`b.category_id = ${param(filter, audit.category_id)}`);
    if (audit.rack) filter.where.push(`upper(b.rack) = upper(${param(filter, audit.rack)})`);
  }

  private expectedSql(audit: LibraryStockAudit, filter: SqlFilter): string {
    this.scopeFilter(audit, filter);
    return `SELECT c.id FROM book_copies c JOIN books b ON b.id = c.book_id AND b.deleted_at IS NULL
            WHERE c.school_id = ${param(filter, audit.school_id)} AND c.deleted_at IS NULL
              AND c.status IN ('available', 'damaged', 'in_repair')
              ${filter.where.length ? `AND ${filter.where.join(' AND ')}` : ''}`;
  }

  private async present(audit: LibraryStockAudit): Promise<AuditDto> {
    const expectedFilter: SqlFilter = { where: [], params: [] };
    const expectedSql = this.expectedSql(audit, expectedFilter);
    const [counts]: Row[] = await this.dataSource.query(
      `SELECT
         (SELECT COUNT(*) FROM (${expectedSql}) e)::int AS expected,
         (SELECT COUNT(*) FROM library_stock_audit_items WHERE audit_id = ${param(expectedFilter, audit.id)})::int AS scanned,
         (SELECT COUNT(*) FROM library_stock_audit_items WHERE audit_id = ${param(expectedFilter, audit.id)} AND finding = 'found')::int AS found,
         (SELECT COUNT(*) FROM library_stock_audit_items WHERE audit_id = ${param(expectedFilter, audit.id)} AND finding = 'misplaced')::int AS misplaced,
         (SELECT COUNT(*) FROM library_stock_audit_items WHERE audit_id = ${param(expectedFilter, audit.id)} AND finding IN ('was_issued', 'was_lost'))::int AS mismatched,
         (SELECT COUNT(*) FROM library_stock_audit_items WHERE audit_id = ${param(expectedFilter, audit.id)} AND finding = 'was_issued')::int AS was_issued,
         (SELECT COUNT(*) FROM library_stock_audit_items WHERE audit_id = ${param(expectedFilter, audit.id)} AND finding = 'was_lost')::int AS was_lost,
         (SELECT COUNT(*) FROM library_stock_audit_items WHERE audit_id = ${param(expectedFilter, audit.id)} AND finding = 'unknown')::int AS unknown,
         (SELECT COUNT(*) FROM (${expectedSql}) e
            WHERE NOT EXISTS (SELECT 1 FROM library_stock_audit_items x WHERE x.audit_id = ${param(expectedFilter, audit.id)} AND x.copy_id = e.id))::int AS missing`,
      expectedFilter.params,
    );
    const [extra]: Row[] = await this.dataSource.query(
      `SELECT cat.name AS category_name, u.name AS started_by FROM library_stock_audits a
       LEFT JOIN book_categories cat ON cat.id = a.category_id LEFT JOIN users u ON u.id = a.created_by WHERE a.id = $1`,
      [audit.id],
    );
    const closed = audit.status === 'closed';
    return {
      id: audit.id,
      name: audit.name,
      status: audit.status,
      category: audit.category_id ? { id: audit.category_id, name: String(extra?.category_name ?? '') } : null,
      rack: audit.rack,
      expected: closed ? audit.expected_count : Number(counts?.expected ?? 0),
      scanned: Number(counts?.scanned ?? 0),
      found: closed ? audit.found_count : Number(counts?.found ?? 0),
      misplaced: Number(counts?.misplaced ?? 0),
      mismatched: Number(counts?.mismatched ?? 0),
      was_issued: Number(counts?.was_issued ?? 0),
      was_lost: Number(counts?.was_lost ?? 0),
      unknown: Number(counts?.unknown ?? 0),
      missing: closed ? audit.missing_count : Number(counts?.missing ?? 0),
      notes: audit.notes,
      started_by: (extra?.started_by as string | null) ?? null,
      created_at: audit.created_at,
      closed_at: audit.closed_at,
    };
  }

  private async find(schoolId: number, id: number): Promise<LibraryStockAudit> {
    const audit = await this.dataSource.getRepository(LibraryStockAudit).findOneBy({ id, school_id: schoolId });
    if (!audit) throw AppException.notFound('Stock check not found', 'AUDIT_NOT_FOUND');
    return audit;
  }

  async list(schoolId: number): Promise<AuditDto[]> {
    const audits = await this.dataSource
      .getRepository(LibraryStockAudit)
      .find({ where: { school_id: schoolId }, order: { created_at: 'DESC' }, take: 50 });
    return Promise.all(audits.map((audit) => this.present(audit)));
  }

  async get(schoolId: number, id: number): Promise<AuditDto> {
    return this.present(await this.find(schoolId, id));
  }

  async create(schoolId: number, dto: AuditCreateDto): Promise<AuditDto> {
    const repo = this.dataSource.getRepository(LibraryStockAudit);
    if (await repo.existsBy({ school_id: schoolId, status: 'open', deleted_at: IsNull() })) {
      throw AppException.conflict('Close the open stock check first', 'AUDIT_OPEN');
    }
    if (
      dto.category_id &&
      !(await this.dataSource.getRepository(BookCategory).existsBy({ id: dto.category_id, school_id: schoolId }))
    ) {
      throw AppException.validation([{ field: 'category_id', message: 'Category not found' }]);
    }
    const audit = await repo.save(
      repo.create({
        school_id: schoolId,
        name: dto.name,
        category_id: dto.category_id ?? null,
        rack: dto.rack ?? null,
        notes: dto.notes ?? null,
        status: 'open',
      }),
    );
    return this.present(audit);
  }

  async scan(schoolId: number, id: number, code: string, actor: AuthUser): Promise<AuditScanResultDto> {
    const audit = await this.find(schoolId, id);
    if (audit.status !== 'open') throw AppException.conflict('This stock check is closed', 'AUDIT_CLOSED');
    const value = code.trim();
    const filter: SqlFilter = { where: [], params: [] };
    const key = param(filter, value);
    filter.where.push(`(c.barcode = ${key} OR c.accession_no = ${key} OR upper(c.barcode) = upper(${key}))`);
    const [copy] = await this.read.copies(schoolId, filter, 'c.id');
    let finding: AuditFinding = 'unknown';
    if (copy) {
      const [scope]: { in_scope: boolean }[] = await this.dataSource.query(
        `SELECT (($2::int IS NULL OR b.category_id = $2::int) AND ($3::text IS NULL OR upper(b.rack) = upper($3::text))) AS in_scope
         FROM books b WHERE b.id = $1`,
        [copy.book_id, audit.category_id, audit.rack],
      );
      finding =
        copy.status === 'issued'
          ? 'was_issued'
          : copy.status === 'lost' || copy.status === 'withdrawn'
            ? 'was_lost'
            : scope?.in_scope
              ? 'found'
              : 'misplaced';
    }
    const inserted = await this.dataSource
      .createQueryBuilder()
      .insert()
      .into(LibraryStockAuditItem)
      .values({
        school_id: schoolId,
        audit_id: audit.id,
        copy_id: copy?.id ?? null,
        code: copy?.barcode ?? value,
        finding,
        scanned_by: actor.id,
      })
      .orIgnore()
      .execute();
    const repeated = !(inserted.raw as unknown[]).length;
    if (!repeated && copy) {
      await logCopyEvents(this.dataSource.manager, [
        {
          school_id: schoolId,
          copy_id: copy.id,
          kind: 'audited',
          note: `${audit.name}: ${FINDING_MESSAGES[finding]}`,
          actor_id: actor.id,
        },
      ]);
    }
    return {
      finding,
      message: repeated ? `Already scanned. ${FINDING_MESSAGES[finding]}` : FINDING_MESSAGES[finding],
      repeated,
      copy: copy ?? null,
      audit: await this.present(audit),
    };
  }

  async items(schoolId: number, id: number, query: AuditItemsQueryDto): Promise<Paginated<AuditItemDto>> {
    const audit = await this.find(schoolId, id);
    const offset = (query.page - 1) * query.limit;
    if (query.finding === 'missing') {
      const filter: SqlFilter = { where: [], params: [] };
      this.scopeFilter(audit, filter);
      filter.where.push(`c.status IN ('available', 'damaged', 'in_repair')`);
      filter.where.push(
        `NOT EXISTS (SELECT 1 FROM library_stock_audit_items x WHERE x.audit_id = ${param(filter, audit.id)} AND x.copy_id = c.id)`,
      );
      const page = await this.read.copyPage(schoolId, filter, 'c.accession_no', query.page, query.limit);
      return paginate(
        [
          page.items.map((copy: CopyDto) => ({
            id: copy.id,
            code: copy.barcode,
            finding: 'unknown' as AuditFinding,
            copy,
            scanned_at: audit.created_at,
          })),
          page.total,
        ],
        query.page,
        query.limit,
      );
    }
    const rows: Row[] = await this.dataSource.query(
      `SELECT x.id, x.code, x.finding, x.copy_id, x.scanned_at, COUNT(*) OVER() AS total
       FROM library_stock_audit_items x WHERE x.audit_id = $1 ${query.finding ? 'AND x.finding = $2' : ''}
       ORDER BY x.scanned_at DESC LIMIT ${query.limit} OFFSET ${offset}`,
      query.finding ? [audit.id, query.finding] : [audit.id],
    );
    const ids = rows.map((row) => Number(row.copy_id)).filter(Boolean);
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`c.id = ANY(${param(filter, ids)})`);
    const copies = ids.length ? await this.read.copies(schoolId, filter) : [];
    return paginate(
      [
        rows.map((row) => ({
          id: Number(row.id),
          code: String(row.code),
          finding: row.finding as AuditFinding,
          copy: copies.find((copy) => copy.id === Number(row.copy_id)) ?? null,
          scanned_at: row.scanned_at as Date,
        })),
        Number(rows[0]?.total ?? 0),
      ],
      query.page,
      query.limit,
    );
  }

  async close(schoolId: number, id: number, dto: AuditCloseDto, actor: AuthUser): Promise<AuditDto> {
    const audit = await this.find(schoolId, id);
    if (audit.status !== 'open') throw AppException.conflict('This stock check is already closed', 'AUDIT_CLOSED');
    const summary = await this.present(audit);
    await this.dataSource.transaction(async (manager) => {
      if (dto.withdraw_missing) {
        const filter: SqlFilter = { where: [], params: [] };
        const sql = this.expectedSql(audit, filter);
        const missing: { id: number }[] = await manager.query(
          `SELECT e.id FROM (${sql}) e WHERE NOT EXISTS (
             SELECT 1 FROM library_stock_audit_items x WHERE x.audit_id = ${param(filter, audit.id)} AND x.copy_id = e.id)`,
          filter.params,
        );
        const ids = missing.map((row) => Number(row.id));
        if (ids.length) {
          await manager
            .createQueryBuilder()
            .update(BookCopy)
            .set({ status: 'withdrawn' })
            .where('id IN (:...ids)', { ids })
            .execute();
          await logCopyEvents(
            manager,
            ids.map((copyId) => ({
              school_id: schoolId,
              copy_id: copyId,
              kind: 'withdrawn' as const,
              note: `Missing in stock check "${audit.name}"`,
              actor_id: actor.id,
            })),
          );
        }
      }
      await manager.update(LibraryStockAudit, audit.id, {
        status: 'closed',
        closed_at: new Date(),
        closed_by: actor.id,
        expected_count: summary.expected,
        found_count: summary.found,
        missing_count: summary.missing,
      });
    });
    return this.get(schoolId, id);
  }
}
