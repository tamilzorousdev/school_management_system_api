import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { AppException, AuthUser, paginate, Paginated } from '@app/common';
import { libraryConfig, LibraryConfig } from '../../config/configuration';
import { monthStartIn } from '../../shared/dates';
import { appConfig, AppConfig } from '../../config/configuration';
import { UploadedFileInput } from '../files/files.service';
import { SequencesService } from '../schools/sequences.service';
import { bookTemplate, parseBookRow, ParsedBookRow, readBookSheet } from './book-import';
import { logCopyEvents, schoolInfo } from './copy-events';
import {
  BookCreateDto,
  BookDto,
  BookImportReportDto,
  BookImportRowDto,
  BookInsightsDto,
  BookInputDto,
  BookQueryDto,
  BookSuggestionDto,
  BookUpdateDto,
  CategoryDto,
  CategoryInputDto,
  CategoryUpdateDto,
  CopyDto,
  CopyEventDto,
  CopyInputDto,
  CopyQueryDto,
  CopyUpdateDto,
  IsbnLookupDto,
  LabelsQueryDto,
} from './dto/catalogue.dto';
import { CatalogueBookDto, CatalogueQueryDto } from './dto/desk.dto';
import { Book, BookCategory, BookCopy } from './entities/book.entity';
import { accessionNumber, normalizeIsbn } from './library.logic';
import { labelsPdf } from './library-pdf';
import {
  addSearch,
  LibraryReadService,
  MEMBER_COLUMNS,
  MEMBER_JOINS,
  param,
  Row,
  SqlFilter,
} from './library-read.service';
import { LibrarySettingsService } from './library-settings.service';

const BOOK_SORTS: Record<string, string> = {
  title: 'b.title',
  authors: 'b.authors',
  created_at: 'b.created_at',
  available: 'k.available',
};

const COPY_SORTS: Record<string, string> = {
  accession_no: 'c.accession_no',
  created_at: 'c.created_at',
  title: 'b.title',
};

const sortOf = (sorts: Record<string, string>, sort: string | undefined, fallback: string, order: string) => {
  const column = sorts[sort ?? fallback];
  if (!column) {
    throw AppException.badRequest(`sort must be one of: ${Object.keys(sorts).join(', ')}`, 'INVALID_SORT');
  }
  return `${column} ${order === 'asc' ? 'ASC' : 'DESC'} NULLS LAST`;
};

@Injectable()
export class CatalogueService {
  private readonly logger = new Logger('LibraryCatalogue');
  private readonly sequences = new SequencesService();

  constructor(
    @InjectRepository(BookCategory) private readonly categoriesRepo: Repository<BookCategory>,
    @InjectRepository(Book) private readonly booksRepo: Repository<Book>,
    @InjectRepository(BookCopy) private readonly copiesRepo: Repository<BookCopy>,
    private readonly read: LibraryReadService,
    private readonly settings: LibrarySettingsService,
    private readonly dataSource: DataSource,
    @Inject(libraryConfig.KEY) private readonly config: LibraryConfig,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async categories(schoolId: number): Promise<CategoryDto[]> {
    const rows: Row[] = await this.dataSource.query(
      `SELECT cat.id, cat.name, cat.code, cat.is_reference, cat.description,
              COUNT(DISTINCT b.id)::int AS book_count, COUNT(c.id)::int AS copy_count
       FROM book_categories cat
       LEFT JOIN books b ON b.category_id = cat.id AND b.deleted_at IS NULL
       LEFT JOIN book_copies c ON c.book_id = b.id AND c.deleted_at IS NULL
       WHERE cat.school_id = $1 AND cat.deleted_at IS NULL
       GROUP BY cat.id ORDER BY cat.name`,
      [schoolId],
    );
    return rows.map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      code: String(row.code),
      is_reference: Boolean(row.is_reference),
      description: (row.description as string | null) ?? null,
      book_count: Number(row.book_count),
      copy_count: Number(row.copy_count),
    }));
  }

  async createCategory(schoolId: number, dto: CategoryInputDto): Promise<CategoryDto> {
    await this.uniqueCategory(schoolId, dto.code, dto.name);
    const saved = await this.categoriesRepo.save(
      this.categoriesRepo.create({
        school_id: schoolId,
        name: dto.name,
        code: dto.code,
        is_reference: dto.is_reference ?? false,
        description: dto.description ?? null,
      }),
    );
    return (await this.categories(schoolId)).find((row) => row.id === saved.id)!;
  }

  async updateCategory(schoolId: number, id: number, dto: CategoryUpdateDto): Promise<CategoryDto> {
    const category = await this.category(schoolId, id);
    await this.uniqueCategory(schoolId, dto.code, dto.name, id);
    await this.categoriesRepo.update(category.id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.code !== undefined ? { code: dto.code } : {}),
      ...(dto.is_reference !== undefined ? { is_reference: dto.is_reference } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
    });
    return (await this.categories(schoolId)).find((row) => row.id === id)!;
  }

  async deleteCategory(schoolId: number, id: number): Promise<void> {
    const category = await this.category(schoolId, id);
    if (await this.booksRepo.existsBy({ school_id: schoolId, category_id: id, deleted_at: IsNull() })) {
      throw AppException.conflict('Move the books to another category first', 'CATEGORY_IN_USE');
    }
    await this.categoriesRepo.softDelete(category.id);
  }

  private async category(schoolId: number, id: number): Promise<BookCategory> {
    const category = await this.categoriesRepo.findOneBy({ id, school_id: schoolId });
    if (!category) throw AppException.notFound('Category not found', 'CATEGORY_NOT_FOUND');
    return category;
  }

  private async uniqueCategory(schoolId: number, code?: string, name?: string, exceptId?: number) {
    if (code === undefined && name === undefined) return;
    const rows: { id: number; code: string; name: string }[] = await this.dataSource.query(
      `SELECT id, code, name FROM book_categories WHERE school_id = $1 AND deleted_at IS NULL
       AND (code = $2 OR lower(name) = lower($3))`,
      [schoolId, code ?? '', name ?? ''],
    );
    const clash = rows.find((row) => Number(row.id) !== exceptId);
    if (clash) {
      throw AppException.conflict(
        clash.code === code ? `Code ${code} is already used` : `${name} already exists`,
        'CATEGORY_EXISTS',
      );
    }
  }

  private bookSql(filter: SqlFilter, tail: string): string {
    return `
      SELECT b.*, cat.name AS category_name, COALESCE(cat.is_reference, false) AS is_reference,
             sub.name AS subject_name, k.*
      FROM books b
      LEFT JOIN book_categories cat ON cat.id = b.category_id
      LEFT JOIN subjects sub ON sub.id = b.subject_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE status = 'available')::int AS available,
               COUNT(*) FILTER (WHERE status = 'issued')::int AS issued,
               COUNT(*) FILTER (WHERE status = 'lost')::int AS lost,
               COUNT(*) FILTER (WHERE status = 'damaged')::int AS damaged,
               COUNT(*) FILTER (WHERE status = 'in_repair')::int AS in_repair,
               COUNT(*) FILTER (WHERE status = 'withdrawn')::int AS withdrawn
        FROM book_copies x WHERE x.book_id = b.id AND x.deleted_at IS NULL
      ) k ON true
      WHERE b.deleted_at IS NULL ${filter.where.length ? `AND ${filter.where.join(' AND ')}` : ''}
      ${tail}`;
  }

  private presentBook(row: Row): BookDto {
    return {
      id: Number(row.id),
      title: String(row.title),
      subtitle: (row.subtitle as string | null) ?? null,
      isbn: (row.isbn as string | null) ?? null,
      authors: (row.authors as string | null) ?? null,
      publisher: (row.publisher as string | null) ?? null,
      edition: (row.edition as string | null) ?? null,
      published_year: row.published_year === null ? null : Number(row.published_year),
      language: String(row.language),
      category: row.category_id ? { id: Number(row.category_id), name: String(row.category_name) } : null,
      subject: row.subject_id ? { id: Number(row.subject_id), name: String(row.subject_name) } : null,
      pages: row.pages === null ? null : Number(row.pages),
      rack: (row.rack as string | null) ?? null,
      shelf: (row.shelf as string | null) ?? null,
      price: row.price === null ? null : Number(row.price),
      cover_file_id: row.cover_file_id === null ? null : Number(row.cover_file_id),
      cover_url: this.read.link(row.cover_file_id),
      description: (row.description as string | null) ?? null,
      keywords: (row.keywords as string | null) ?? null,
      is_active: Boolean(row.is_active),
      is_reference: Boolean(row.is_reference),
      copies: {
        total: Number(row.total ?? 0),
        available: Number(row.available ?? 0),
        issued: Number(row.issued ?? 0),
        lost: Number(row.lost ?? 0),
        damaged: Number(row.damaged ?? 0),
        in_repair: Number(row.in_repair ?? 0),
        withdrawn: Number(row.withdrawn ?? 0),
      },
      created_at: row.created_at as Date,
    };
  }

  async listBooks(schoolId: number, query: BookQueryDto): Promise<Paginated<BookDto>> {
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`b.school_id = ${param(filter, schoolId)}`);
    if (query.category_id) filter.where.push(`b.category_id = ${param(filter, query.category_id)}`);
    if (query.language) filter.where.push(`lower(b.language) = lower(${param(filter, query.language)})`);
    if (query.is_active !== undefined) filter.where.push(`b.is_active = ${param(filter, query.is_active)}`);
    if (query.availability === 'available') filter.where.push('k.available > 0');
    if (query.availability === 'none_available') filter.where.push('k.available = 0');
    addSearch(filter, query.search, [
      'b.title',
      'b.subtitle',
      'b.authors',
      'b.isbn',
      'b.publisher',
      'b.keywords',
      `(SELECT string_agg(x.accession_no || ' ' || x.barcode, ' ') FROM book_copies x WHERE x.book_id = b.id AND x.deleted_at IS NULL)`,
    ]);
    const order = sortOf(BOOK_SORTS, query.sort, 'created_at', query.order);
    const [{ total }]: { total: string }[] = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM (${this.bookSql(filter, '')}) counted`,
      filter.params,
    );
    const rows: Row[] = await this.dataSource.query(
      this.bookSql(
        filter,
        `ORDER BY ${order}, b.id DESC LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      ),
      filter.params,
    );
    return paginate([rows.map((row) => this.presentBook(row)), Number(total)], query.page, query.limit);
  }

  async browse(schoolId: number, query: CatalogueQueryDto): Promise<Paginated<CatalogueBookDto>> {
    const page = await this.listBooks(schoolId, {
      ...query,
      is_active: true,
      availability: query.available_only ? 'available' : undefined,
      sort: query.sort ?? 'title',
      order: query.sort ? query.order : 'asc',
    } as BookQueryDto);
    return {
      ...page,
      items: page.items.map((book) => ({
        id: book.id,
        title: book.title,
        authors: book.authors,
        category: book.category?.name ?? null,
        language: book.language,
        cover_url: book.cover_url,
        location: [book.rack, book.shelf].filter(Boolean).join(' / ') || null,
        available_copies: book.copies.available,
        total_copies: book.copies.total - book.copies.withdrawn - book.copies.lost,
        is_reference: book.is_reference,
      })),
    };
  }

  async getBook(schoolId: number, id: number, manager?: EntityManager): Promise<BookDto> {
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`b.school_id = ${param(filter, schoolId)}`, `b.id = ${param(filter, id)}`);
    const [row]: Row[] = await (manager ?? this.dataSource.manager).query(this.bookSql(filter, ''), filter.params);
    if (!row) throw AppException.notFound('Book not found', 'BOOK_NOT_FOUND');
    return this.presentBook(row);
  }

  async insights(schoolId: number): Promise<BookInsightsDto> {
    const monthStart = monthStartIn(this.app.timeZone);
    const [row]: Row[] = await this.dataSource.query(
      `SELECT
         (SELECT COUNT(*) FROM books WHERE school_id = $1 AND deleted_at IS NULL)::int AS titles,
         COUNT(c.id)::int AS copies,
         COUNT(c.id) FILTER (WHERE c.status = 'available')::int AS available,
         COUNT(c.id) FILTER (WHERE c.status = 'issued')::int AS issued,
         COUNT(c.id) FILTER (WHERE c.status = 'lost')::int AS lost,
         COUNT(c.id) FILTER (WHERE c.status IN ('damaged', 'in_repair'))::int AS damaged,
         COUNT(c.id) FILTER (WHERE c.created_at >= $2::date)::int AS added_this_month,
         (SELECT COUNT(*) FROM library_issues i WHERE i.school_id = $1 AND i.deleted_at IS NULL
            AND i.status = 'issued' AND i.due_date < $3::date)::int AS overdue
       FROM book_copies c JOIN books b ON b.id = c.book_id AND b.deleted_at IS NULL
       WHERE c.school_id = $1 AND c.deleted_at IS NULL`,
      [schoolId, monthStart, this.read.today()],
    );
    return {
      titles: Number(row?.titles ?? 0),
      copies: Number(row?.copies ?? 0),
      available: Number(row?.available ?? 0),
      issued: Number(row?.issued ?? 0),
      overdue: Number(row?.overdue ?? 0),
      lost: Number(row?.lost ?? 0),
      damaged: Number(row?.damaged ?? 0),
      added_this_month: Number(row?.added_this_month ?? 0),
    };
  }

  async isbnLookup(schoolId: number, raw: string): Promise<IsbnLookupDto> {
    const isbn = normalizeIsbn(raw);
    if (!isbn) throw AppException.badRequest('This is not a valid ISBN', 'ISBN_INVALID');
    const existing = await this.booksRepo.findOneBy({ school_id: schoolId, isbn, deleted_at: IsNull() });
    if (existing) return { isbn, book: await this.getBook(schoolId, existing.id), suggestion: null };
    const settings = await this.settings.get(schoolId);
    const suggestion = settings.isbn_lookup && settings.isbn_lookup_available ? await this.lookupOnline(isbn) : null;
    return { isbn, book: null, suggestion };
  }

  private async lookupOnline(isbn: string): Promise<BookSuggestionDto | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.bookLookupTimeoutMs);
    try {
      const response = await fetch(
        `${this.config.bookLookupUrl}/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`,
        { signal: controller.signal, headers: { Accept: 'application/json' } },
      );
      if (!response.ok) return null;
      const body = (await response.json()) as Record<string, OpenLibraryBook | undefined>;
      const book = body[`ISBN:${isbn}`];
      if (!book?.title) return null;
      const year = /(\d{4})/.exec(book.publish_date ?? '')?.[1];
      return {
        title: book.title.slice(0, 200),
        subtitle: book.subtitle?.slice(0, 200) ?? null,
        authors:
          book.authors
            ?.map((author) => author.name)
            .join(', ')
            .slice(0, 200) || null,
        publisher:
          book.publishers
            ?.map((publisher) => publisher.name)
            .join(', ')
            .slice(0, 120) || null,
        published_year: year ? Number(year) : null,
        pages: book.number_of_pages ?? null,
        description: typeof book.notes === 'string' ? book.notes.slice(0, 4000) : null,
      };
    } catch (error) {
      this.logger.warn(`ISBN lookup for ${isbn} failed: ${(error as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async bookFields(schoolId: number, dto: BookInputDto, manager: EntityManager, exceptId?: number) {
    const fields: Partial<Book> = {};
    if (dto.isbn !== undefined) {
      fields.isbn = dto.isbn === null ? null : normalizeIsbn(dto.isbn);
      if (dto.isbn !== null && !fields.isbn) {
        throw AppException.validation([{ field: 'isbn', message: 'This is not a valid ISBN-10 or ISBN-13' }]);
      }
      if (fields.isbn) {
        const clash = await manager.findOneBy(Book, { school_id: schoolId, isbn: fields.isbn, deleted_at: IsNull() });
        if (clash && clash.id !== exceptId) {
          throw AppException.conflict(
            `"${clash.title}" already has this ISBN; add copies to it instead`,
            'DUPLICATE_ISBN',
          );
        }
      }
    }
    if (dto.category_id) {
      const found = await manager.findOneBy(BookCategory, { id: dto.category_id, school_id: schoolId });
      if (!found) throw AppException.validation([{ field: 'category_id', message: 'Category not found' }]);
    }
    if (dto.subject_id) {
      const [found] = await manager.query(`SELECT id FROM subjects WHERE id = $1 AND school_id = $2`, [
        dto.subject_id,
        schoolId,
      ]);
      if (!found) throw AppException.validation([{ field: 'subject_id', message: 'Subject not found' }]);
    }
    const keys: (keyof BookInputDto)[] = [
      'title',
      'subtitle',
      'authors',
      'publisher',
      'edition',
      'published_year',
      'language',
      'category_id',
      'subject_id',
      'pages',
      'rack',
      'shelf',
      'price',
      'cover_file_id',
      'description',
      'keywords',
    ];
    for (const key of keys) {
      if (dto[key] !== undefined) (fields as Record<string, unknown>)[key] = dto[key];
    }
    return fields;
  }

  async createBook(schoolId: number, dto: BookCreateDto, actor: AuthUser): Promise<BookDto> {
    const id = await this.dataSource.transaction(async (manager) => {
      const fields = await this.bookFields(schoolId, dto, manager);
      const book = await manager.save(
        manager.create(Book, {
          ...fields,
          school_id: schoolId,
          language: dto.language ?? 'English',
          created_by: actor.id,
        }),
      );
      if (dto.copies) await this.addCopiesInTx(manager, schoolId, book, dto.copies, actor.id);
      return book.id;
    });
    return this.getBook(schoolId, id);
  }

  async updateBook(schoolId: number, id: number, dto: BookUpdateDto): Promise<BookDto> {
    await this.dataSource.transaction(async (manager) => {
      const book = await manager.findOneBy(Book, { id, school_id: schoolId });
      if (!book) throw AppException.notFound('Book not found', 'BOOK_NOT_FOUND');
      const fields = await this.bookFields(schoolId, dto as BookInputDto, manager, id);
      if (dto.is_active !== undefined) fields.is_active = dto.is_active;
      if (Object.keys(fields).length) await manager.update(Book, id, fields);
    });
    return this.getBook(schoolId, id);
  }

  async deleteBook(schoolId: number, id: number): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const book = await manager.findOneBy(Book, { id, school_id: schoolId });
      if (!book) throw AppException.notFound('Book not found', 'BOOK_NOT_FOUND');
      if (await manager.existsBy(BookCopy, { book_id: id, status: 'issued', deleted_at: IsNull() })) {
        throw AppException.conflict('A copy of this book is on loan. Get it back first.', 'BOOK_ON_LOAN');
      }
      await manager.softDelete(BookCopy, { book_id: id });
      await manager.softDelete(Book, id);
    });
  }

  async bookCopies(schoolId: number, bookId: number): Promise<CopyDto[]> {
    await this.getBook(schoolId, bookId);
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`c.book_id = ${param(filter, bookId)}`);
    return this.read.copies(schoolId, filter, 'c.accession_no');
  }

  async addCopies(schoolId: number, bookId: number, dto: CopyInputDto, actor: AuthUser): Promise<CopyDto[]> {
    const ids = await this.dataSource.transaction(async (manager) => {
      const book = await manager.findOneBy(Book, { id: bookId, school_id: schoolId });
      if (!book) throw AppException.notFound('Book not found', 'BOOK_NOT_FOUND');
      return this.addCopiesInTx(manager, schoolId, book, dto, actor.id);
    });
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`c.id = ANY(${param(filter, ids)})`);
    return this.read.copies(schoolId, filter, 'c.accession_no');
  }

  async addCopiesInTx(
    manager: EntityManager,
    schoolId: number,
    book: Book,
    dto: CopyInputDto,
    actorId: number | null,
  ): Promise<number[]> {
    const barcodes = (dto.barcodes ?? []).map((code) => code.trim());
    const accessions = (dto.accession_nos ?? []).map((code) => code.trim());
    const count = Math.max(dto.count ?? 0, barcodes.length, accessions.length, 1);
    if (count > 200) throw AppException.validation([{ field: 'count', message: 'Add at most 200 copies at a time' }]);
    await this.ensureFreeCodes(manager, schoolId, [...barcodes, ...accessions]);
    const school = await schoolInfo(manager, schoolId);
    const rows: Partial<BookCopy>[] = [];
    const taken = new Set([...barcodes, ...accessions]);
    for (let index = 0; index < count; index += 1) {
      const accession = accessions[index] ?? (await this.nextAccession(manager, schoolId, school.code, taken));
      taken.add(accession);
      rows.push({
        school_id: schoolId,
        book_id: book.id,
        accession_no: accession,
        barcode: barcodes[index] ?? accession,
        status: 'available',
        condition: dto.condition ?? 'new',
        source: dto.source ?? 'purchase',
        vendor: dto.vendor ?? null,
        bill_no: dto.bill_no ?? null,
        acquired_on: dto.acquired_on ?? null,
        price: dto.price === undefined ? book.price : dto.price,
        notes: dto.notes ?? null,
        created_by: actorId,
      });
    }
    const saved = await manager.save(
      BookCopy,
      rows.map((row) => manager.create(BookCopy, row)),
    );
    await logCopyEvents(
      manager,
      saved.map((copy) => ({
        school_id: schoolId,
        copy_id: copy.id,
        kind: 'added' as const,
        note: [copy.source, copy.vendor, copy.bill_no].filter(Boolean).join(' · ') || null,
        actor_id: actorId,
      })),
    );
    return saved.map((copy) => copy.id);
  }

  private async nextAccession(
    manager: EntityManager,
    schoolId: number,
    code: string,
    taken: Set<string>,
  ): Promise<string> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const candidate = accessionNumber(code, await this.sequences.next(manager, schoolId, 'library_accession'));
      if (taken.has(candidate)) continue;
      const [clash] = await manager.query(
        `SELECT 1 FROM book_copies WHERE school_id = $1 AND deleted_at IS NULL AND (accession_no = $2 OR barcode = $2)`,
        [schoolId, candidate],
      );
      if (!clash) return candidate;
    }
    throw AppException.conflict('Could not find a free accession number', 'ACCESSION_EXHAUSTED');
  }

  private async ensureFreeCodes(manager: EntityManager, schoolId: number, codes: string[], exceptCopyId?: number) {
    if (!codes.length) return;
    const clashes: { code: string }[] = await manager.query(
      `SELECT accession_no AS code FROM book_copies WHERE school_id = $1 AND deleted_at IS NULL AND accession_no = ANY($2) AND id <> $3
       UNION SELECT barcode FROM book_copies WHERE school_id = $1 AND deleted_at IS NULL AND barcode = ANY($2) AND id <> $3`,
      [schoolId, codes, exceptCopyId ?? 0],
    );
    if (clashes.length) {
      throw AppException.conflict(
        `Already used by another copy: ${clashes.map((row) => row.code).join(', ')}`,
        'DUPLICATE_BARCODE',
      );
    }
  }

  async listCopies(schoolId: number, query: CopyQueryDto): Promise<Paginated<CopyDto>> {
    const filter: SqlFilter = { where: [], params: [] };
    if (query.status) filter.where.push(`c.status = ${param(filter, query.status)}`);
    if (query.condition) filter.where.push(`c.condition = ${param(filter, query.condition)}`);
    if (query.book_id) filter.where.push(`c.book_id = ${param(filter, query.book_id)}`);
    if (query.category_id) filter.where.push(`b.category_id = ${param(filter, query.category_id)}`);
    addSearch(filter, query.search, ['c.accession_no', 'c.barcode', 'b.title', 'b.authors', 'b.isbn']);
    const order = `${sortOf(COPY_SORTS, query.sort, 'accession_no', query.order)}, c.id`;
    return this.read.copyPage(schoolId, filter, order, query.page, query.limit);
  }

  async lookupCopy(schoolId: number, code: string, manager?: EntityManager): Promise<CopyDto> {
    const filter: SqlFilter = { where: [], params: [] };
    const key = param(filter, code.trim());
    filter.where.push(`(c.barcode = ${key} OR c.accession_no = ${key} OR upper(c.barcode) = upper(${key}))`);
    const [copy] = await this.read.copies(schoolId, filter, 'c.id', manager);
    if (!copy) throw AppException.notFound(`No copy has the code ${code}`, 'COPY_NOT_FOUND');
    return copy;
  }

  async getCopy(schoolId: number, id: number): Promise<CopyDto> {
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`c.id = ${param(filter, id)}`);
    const [copy] = await this.read.copies(schoolId, filter);
    if (!copy) throw AppException.notFound('Copy not found', 'COPY_NOT_FOUND');
    return copy;
  }

  async updateCopy(schoolId: number, id: number, dto: CopyUpdateDto, actor: AuthUser): Promise<CopyDto> {
    await this.dataSource.transaction(async (manager) => {
      const copy = await manager.findOne(BookCopy, {
        where: { id, school_id: schoolId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!copy) throw AppException.notFound('Copy not found', 'COPY_NOT_FOUND');
      const fields: Partial<BookCopy> = {};
      if (dto.barcode !== undefined && dto.barcode !== copy.barcode) {
        await this.ensureFreeCodes(manager, schoolId, [dto.barcode], id);
        fields.barcode = dto.barcode;
      }
      for (const key of ['condition', 'source', 'vendor', 'bill_no', 'acquired_on', 'price', 'notes'] as const) {
        if (dto[key] !== undefined) (fields as Record<string, unknown>)[key] = dto[key];
      }
      const events: { kind: 'edited' | 'damaged' | 'repaired' | 'withdrawn' | 'restored'; note: string | null }[] = [];
      if (dto.status && dto.status !== copy.status) {
        if (copy.status === 'issued') {
          throw AppException.conflict('This copy is on loan. Return it at the issue desk first.', 'COPY_ON_LOAN');
        }
        if (copy.status === 'lost' && dto.status !== 'available') {
          throw AppException.conflict('A lost copy can only be made available again', 'COPY_LOST');
        }
        fields.status = dto.status;
        const kind =
          dto.status === 'damaged'
            ? 'damaged'
            : dto.status === 'withdrawn'
              ? 'withdrawn'
              : dto.status === 'in_repair'
                ? 'damaged'
                : copy.status === 'in_repair' || copy.status === 'damaged'
                  ? 'repaired'
                  : 'restored';
        events.push({ kind, note: dto.notes ?? `Status ${copy.status} → ${dto.status}` });
      } else if (Object.keys(fields).length) {
        events.push({
          kind: 'edited',
          note: dto.barcode && dto.barcode !== copy.barcode ? `Barcode ${copy.barcode} → ${dto.barcode}` : null,
        });
      }
      if (Object.keys(fields).length) await manager.update(BookCopy, id, fields);
      await logCopyEvents(
        manager,
        events.map((event) => ({
          school_id: schoolId,
          copy_id: id,
          kind: event.kind,
          note: event.note,
          actor_id: actor.id,
        })),
      );
    });
    return this.getCopy(schoolId, id);
  }

  async copyHistory(schoolId: number, id: number): Promise<CopyEventDto[]> {
    const copy = await this.copiesRepo.findOneBy({ id, school_id: schoolId });
    if (!copy) throw AppException.notFound('Copy not found', 'COPY_NOT_FOUND');
    const rows: Row[] = await this.dataSource.query(
      `SELECT ev.id, ev.kind, ev.note, ev.issue_id, ev.created_at, au.name AS actor_name,
              CASE WHEN m.id IS NULL THEN NULL ELSE 1 END AS has_member, ${MEMBER_COLUMNS('m', 'mm')}
       FROM library_copy_events ev
       LEFT JOIN library_members m ON m.id = ev.member_id
       ${MEMBER_JOINS('m', 'mm')}
       LEFT JOIN users au ON au.id = ev.actor_id
       WHERE ev.copy_id = $1 AND ev.school_id = $2
       ORDER BY ev.created_at DESC, ev.id DESC LIMIT 200`,
      [id, schoolId],
    );
    return rows.map((row) => ({
      id: Number(row.id),
      kind: String(row.kind),
      note: (row.note as string | null) ?? null,
      issue_id: row.issue_id === null ? null : Number(row.issue_id),
      member: row.has_member ? this.read.memberRef(row, 'mm') : null,
      actor: (row.actor_name as string | null) ?? null,
      created_at: row.created_at as Date,
    }));
  }

  async labels(schoolId: number, query: LabelsQueryDto): Promise<{ name: string; pdf: Buffer }> {
    const filter: SqlFilter = { where: [], params: [] };
    if (query.copy_ids?.length) filter.where.push(`c.id = ANY(${param(filter, query.copy_ids)})`);
    if (query.book_id) filter.where.push(`c.book_id = ${param(filter, query.book_id)}`);
    if (query.added_from) filter.where.push(`c.created_at >= ${param(filter, query.added_from)}::date`);
    if (!filter.where.length) {
      throw AppException.validation([{ field: 'copy_ids', message: 'Choose copies, a book or a date to print' }]);
    }
    filter.where.push(`c.status <> 'withdrawn'`);
    const copies = await this.read.copies(schoolId, filter, 'c.accession_no');
    if (!copies.length) throw AppException.notFound('No copies to print', 'NO_COPIES');
    if (copies.length > 960) {
      throw AppException.badRequest('Print at most 960 labels (40 sheets) at a time', 'TOO_MANY_LABELS');
    }
    const school = await schoolInfo(this.dataSource.manager, schoolId);
    const pdf = await labelsPdf(
      school.name,
      copies.map((copy) => ({
        accession_no: copy.accession_no,
        barcode: copy.barcode,
        title: copy.book.title,
        location: copy.location,
      })),
    );
    return { name: `library-labels-${copies.length}`, pdf };
  }

  async importTemplate(schoolId: number): Promise<{ name: string; buffer: Buffer }> {
    const categories = await this.categoriesRepo.find({ where: { school_id: schoolId }, order: { name: 'ASC' } });
    return { name: 'library-books-template.xlsx', buffer: await bookTemplate(categories) };
  }

  async importBooks(
    schoolId: number,
    file: UploadedFileInput | undefined,
    mode: 'validate' | 'import',
    actor: AuthUser,
  ): Promise<BookImportReportDto> {
    if (!file?.buffer?.length) throw AppException.badRequest('Choose the filled Excel or CSV file', 'FILE_MISSING');
    if (!/\.(xlsx|csv)$/i.test(file.originalname)) {
      throw AppException.badRequest('Upload the .xlsx template or a .csv file', 'FILE_TYPE');
    }
    let sheet: Awaited<ReturnType<typeof readBookSheet>>;
    try {
      sheet = await readBookSheet(file.buffer, file.originalname);
    } catch {
      throw AppException.badRequest('This file could not be read. Use the template.', 'FILE_UNREADABLE');
    }
    if (!sheet.length) throw AppException.badRequest('The file has no book rows', 'FILE_EMPTY');
    if (sheet.length > 2000) throw AppException.badRequest('Import at most 2000 rows at a time', 'TOO_MANY_ROWS');

    const categories = await this.categoriesRepo.findBy({ school_id: schoolId });
    const existingIsbns = new Map(
      (
        await this.booksRepo.find({
          where: { school_id: schoolId, isbn: In(sheet.map((row) => row.values.isbn).filter(Boolean)) },
        })
      ).map((book) => [book.isbn!, book]),
    );
    for (const row of sheet) {
      const normalized = row.values.isbn ? normalizeIsbn(row.values.isbn) : null;
      if (normalized && !existingIsbns.has(normalized)) {
        const found = await this.booksRepo.findOneBy({ school_id: schoolId, isbn: normalized });
        if (found) existingIsbns.set(normalized, found);
      }
    }
    const codes = sheet.flatMap((row) =>
      `${row.values.barcodes ?? ''}|${row.values.accession_nos ?? ''}`
        .split('|')
        .map((code) => code.trim())
        .filter(Boolean),
    );
    const usedCodes = new Set<string>(
      codes.length
        ? (
            await this.dataSource.query(
              `SELECT accession_no AS code FROM book_copies WHERE school_id = $1 AND deleted_at IS NULL AND accession_no = ANY($2)
               UNION SELECT barcode FROM book_copies WHERE school_id = $1 AND deleted_at IS NULL AND barcode = ANY($2)`,
              [schoolId, codes],
            )
          ).map((row: { code: string }) => row.code)
        : [],
    );

    const seenCodes = new Set<string>();
    const seenIsbns = new Set<string>();
    const planned: { report: BookImportRowDto; parsed: ParsedBookRow | null }[] = sheet.map(({ row, values }) => {
      const { parsed, error } = parseBookRow(row, values);
      const report: BookImportRowDto = {
        row,
        status: 'ok',
        title: values.title || null,
        isbn: parsed?.isbn ?? (values.isbn || null),
        copies: parsed?.copies ?? 0,
        action: null,
        message: error,
        book_id: null,
      };
      if (!parsed) return { report: { ...report, status: 'error' }, parsed: null };
      const rowCodes = [...parsed.barcodes, ...parsed.accession_nos];
      const clash = rowCodes.find((code) => usedCodes.has(code) || seenCodes.has(code));
      if (clash)
        return {
          report: { ...report, status: 'error', message: `${clash} is already used by another copy` },
          parsed: null,
        };
      if (parsed.isbn && seenIsbns.has(parsed.isbn)) {
        return { report: { ...report, status: 'error', message: 'The same ISBN is on an earlier row' }, parsed: null };
      }
      rowCodes.forEach((code) => seenCodes.add(code));
      if (parsed.isbn) seenIsbns.add(parsed.isbn);
      const existing = parsed.isbn ? existingIsbns.get(parsed.isbn) : undefined;
      return {
        report: {
          ...report,
          action: existing ? 'add_copies' : 'new_book',
          book_id: existing?.id ?? null,
          message: existing ? `Adds ${parsed.copies} to "${existing.title}"` : null,
        },
        parsed,
      };
    });

    let booksCreated = 0;
    let copiesAdded = 0;
    let categoriesCreated = 0;
    if (mode === 'import') {
      const byName = new Map(
        categories.flatMap((item) => [
          [item.name.toLowerCase(), item],
          [item.code.toLowerCase(), item],
        ]),
      );
      for (const item of planned) {
        if (!item.parsed) continue;
        const parsed = item.parsed;
        try {
          await this.dataSource.transaction(async (manager) => {
            let categoryId: number | null = null;
            if (parsed.category) {
              let category = byName.get(parsed.category.toLowerCase());
              if (!category) {
                category = await manager.save(
                  manager.create(BookCategory, {
                    school_id: schoolId,
                    name: parsed.category.slice(0, 60),
                    code: await this.freeCategoryCode(manager, schoolId, parsed.category),
                    is_reference: false,
                    description: null,
                  }),
                );
                byName.set(category.name.toLowerCase(), category);
                byName.set(category.code.toLowerCase(), category);
                categoriesCreated += 1;
              }
              categoryId = category.id;
            }
            let book = item.report.book_id ? await manager.findOneBy(Book, { id: item.report.book_id }) : null;
            if (!book) {
              book = await manager.save(
                manager.create(Book, {
                  school_id: schoolId,
                  title: parsed.title,
                  subtitle: parsed.subtitle,
                  isbn: parsed.isbn,
                  authors: parsed.authors,
                  publisher: parsed.publisher,
                  edition: parsed.edition,
                  published_year: parsed.published_year,
                  language: parsed.language,
                  category_id: categoryId,
                  rack: parsed.rack,
                  shelf: parsed.shelf,
                  price: parsed.price,
                  pages: parsed.pages,
                  keywords: parsed.keywords,
                  created_by: actor.id,
                }),
              );
              booksCreated += 1;
              if (parsed.isbn) existingIsbns.set(parsed.isbn, book);
            }
            const ids = await this.addCopiesInTx(
              manager,
              schoolId,
              book,
              {
                count: parsed.copies,
                barcodes: parsed.barcodes,
                accession_nos: parsed.accession_nos,
                source: parsed.source,
                vendor: parsed.vendor,
                bill_no: parsed.bill_no,
                acquired_on: parsed.acquired_on ?? undefined,
                price: parsed.price,
                condition: 'new',
              },
              actor.id,
            );
            copiesAdded += ids.length;
            item.report.book_id = book.id;
          });
        } catch (error) {
          item.report.status = 'error';
          item.report.message = (error as Error).message;
        }
      }
    }
    const rows = planned.map((item) => item.report);
    return {
      mode,
      total_rows: rows.length,
      ok_rows: rows.filter((row) => row.status === 'ok').length,
      error_rows: rows.filter((row) => row.status === 'error').length,
      books_created: booksCreated,
      copies_added: copiesAdded,
      categories_created: categoriesCreated,
      rows,
    };
  }

  private async freeCategoryCode(manager: EntityManager, schoolId: number, name: string): Promise<string> {
    const base =
      name
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '')
        .slice(0, 6) || 'CAT';
    for (let index = 0; index < 100; index += 1) {
      const code = index ? `${base}${index}` : base;
      const [clash] = await manager.query(
        `SELECT 1 FROM book_categories WHERE school_id = $1 AND code = $2 AND deleted_at IS NULL`,
        [schoolId, code],
      );
      if (!clash) return code;
    }
    return `${base}${Date.now() % 10000}`;
  }
}

interface OpenLibraryBook {
  title?: string;
  subtitle?: string;
  authors?: { name: string }[];
  publishers?: { name: string }[];
  publish_date?: string;
  number_of_pages?: number;
  notes?: string | { value: string };
}
