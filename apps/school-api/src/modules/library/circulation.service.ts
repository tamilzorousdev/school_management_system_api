import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { AppException, AuthUser, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { holidaySet } from '../../shared/school-days';
import { addDays } from '../../shared/school-days';
import { yearClause } from '../../shared/year-context';
import { rupees } from '../payroll/payroll.calc';
import { LIBRARY_TEMPLATES } from '../notifications/library-templates.catalog';
import { logCopyEvents } from './copy-events';
import {
  FollowUpDto,
  FollowUpInputDto,
  FollowUpQueryDto,
  IssueBooksDto,
  IssueInsightsDto,
  IssueQueryDto,
  LoanDetailDto,
  LoanDto,
  LostDto,
  MemberFineDto,
  RenewDto,
  ReturnBooksDto,
  ReturnedItemDto,
} from './dto/circulation.dto';
import { Book, BookCategory, BookCopy } from './entities/book.entity';
import { LibraryFine } from './entities/library-fine.entity';
import { LibraryFollowUp, LibraryIssue } from './entities/library-issue.entity';
import {
  chargeableDays,
  dueDateFor,
  fineAmounts,
  fineReason,
  finesApply,
  issueRefusal,
  loanDays,
  LoanRules,
  lostFine,
  overdueFine,
  renewRefusal,
  round2,
} from './library.logic';
import { LibraryNotifyService } from './library-notify.service';
import { addSearch, LibraryReadService, MEMBER_NAME, param, SqlFilter } from './library-read.service';
import { LibrarySettingsService } from './library-settings.service';
import { MembersService } from './members.service';

const LOAN_SORTS: Record<string, string> = {
  issued_at: 'i.issued_at',
  due_date: 'i.due_date',
  returned_at: 'i.returned_at',
};

interface RaisedFine {
  member_id: number;
  amount: number;
  reason: string;
}

@Injectable()
export class CirculationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly read: LibraryReadService,
    private readonly members: MembersService,
    private readonly settings: LibrarySettingsService,
    private readonly notify: LibraryNotifyService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  private async findCopy(manager: EntityManager, schoolId: number, code: string): Promise<BookCopy> {
    const [row]: { id: number }[] = await manager.query(
      `SELECT id FROM book_copies WHERE school_id = $1 AND deleted_at IS NULL
       AND (barcode = $2 OR accession_no = $2 OR upper(barcode) = upper($2)) ORDER BY id LIMIT 1`,
      [schoolId, code.trim()],
    );
    if (!row) throw AppException.notFound(`No copy has the code ${code}`, 'COPY_NOT_FOUND');
    return manager.findOneOrFail(BookCopy, { where: { id: Number(row.id) }, lock: { mode: 'pessimistic_write' } });
  }

  private async holidays(manager: EntityManager, schoolId: number, rules: LoanRules, from: string, to: string) {
    return rules.skip_holidays && from <= to ? holidaySet(manager, schoolId, from, to) : new Set<string>();
  }

  private async raiseFine(
    manager: EntityManager,
    input: {
      school_id: number;
      member_id: number;
      issue_id: number;
      kind: 'overdue' | 'lost' | 'damage';
      amount: number;
      reason: string;
      days_late?: number | null;
      actor_id: number | null;
    },
  ): Promise<LibraryFine | null> {
    const amount = round2(input.amount);
    if (amount <= 0) return null;
    return manager.save(
      manager.create(LibraryFine, {
        school_id: input.school_id,
        member_id: input.member_id,
        issue_id: input.issue_id,
        kind: input.kind,
        ...fineAmounts(amount, 0, 0),
        days_late: input.days_late ?? null,
        reason: input.reason,
        created_by: input.actor_id,
      }),
    );
  }

  async issue(schoolId: number, dto: IssueBooksDto, actor: AuthUser): Promise<LoanDto[]> {
    const today = this.read.today();
    const purpose = dto.purpose ?? 'personal';
    const created = await this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT id FROM library_members WHERE id = $1 FOR UPDATE`, [dto.member_id]);
      const member = await this.members.member(schoolId, dto.member_id, manager);
      const rules = await this.settings.rules(schoolId);
      if (purpose === 'class_set') {
        if (member.member_type !== 'staff') {
          throw AppException.validation([{ field: 'purpose', message: 'Class sets are issued to a teacher' }]);
        }
        if (!dto.section_id) throw AppException.validation([{ field: 'section_id', message: 'Choose the class' }]);
        const [section] = await manager.query(
          `SELECT sec.id FROM sections sec JOIN academic_years y ON y.id = sec.academic_year_id AND ${yearClause('y')}
           WHERE sec.id = $1 AND sec.school_id = $2 AND sec.deleted_at IS NULL`,
          [dto.section_id, schoolId],
        );
        if (!section) throw AppException.validation([{ field: 'section_id', message: 'Section not found' }]);
      }
      if (dto.due_date && dto.due_date <= today) {
        throw AppException.validation([{ field: 'due_date', message: 'The due date must be after today' }]);
      }
      const held: { book_id: number }[] = await manager.query(
        `SELECT book_id FROM library_issues WHERE member_id = $1 AND status = 'issued' AND deleted_at IS NULL`,
        [member.id],
      );
      const heldBooks = new Set(held.map((row) => Number(row.book_id)));
      const days = loanDays(rules, member.member_type, member.loan_days_override);
      const holidays = await this.holidays(manager, schoolId, rules, today, addDays(today, days + 60));
      const due = dto.due_date ?? dueDateFor(today, days, rules.skip_holidays, holidays);
      const personActive = (member.student?.status ?? member.staff?.status ?? 'active') === 'active';
      const [enrollment]: { class_id: number; section_id: number | null; year_id: number }[] = member.student
        ? await manager.query(
            `SELECT e.class_id, e.section_id, y.id AS year_id FROM student_enrollments e
             JOIN academic_years y ON y.id = e.academic_year_id AND ${yearClause('y')}
             WHERE e.student_id = $1 ORDER BY e.id DESC LIMIT 1`,
            [member.student.id],
          )
        : [];
      const [year]: { id: number }[] = await manager.query(
        `SELECT id FROM academic_years y WHERE y.school_id = $1 AND ${yearClause('y')} AND y.deleted_at IS NULL LIMIT 1`,
        [schoolId],
      );

      const issues: LibraryIssue[] = [];
      for (const code of dto.codes) {
        const copy = await this.findCopy(manager, schoolId, code);
        const book = await manager.findOneByOrFail(Book, { id: copy.book_id });
        const category = book.category_id ? await manager.findOneBy(BookCategory, { id: book.category_id }) : null;
        const refusal = issueRefusal({
          member_status: member.status,
          person_active: personActive,
          open_loans: purpose === 'class_set' ? 0 : member.open_loans,
          limit: purpose === 'class_set' ? Number.MAX_SAFE_INTEGER : member.max_books,
          unpaid_fines: member.unpaid_fines,
          block_above: rules.block_issue_above_fine,
          copy_status: copy.status,
          is_reference: Boolean(category?.is_reference),
          holds_same_title: purpose === 'personal' && heldBooks.has(book.id),
          basket_size: purpose === 'class_set' ? 0 : dto.codes.length,
        });
        if (refusal) {
          throw AppException.conflict(`${copy.accession_no} (${book.title}): ${refusal.message}`, refusal.code);
        }
        heldBooks.add(book.id);
        const issue = await manager.save(
          manager.create(LibraryIssue, {
            school_id: schoolId,
            copy_id: copy.id,
            book_id: book.id,
            member_id: member.id,
            academic_year_id: year ? Number(year.id) : null,
            class_id: enrollment ? Number(enrollment.class_id) : null,
            section_id:
              purpose === 'class_set' ? dto.section_id! : enrollment?.section_id ? Number(enrollment.section_id) : null,
            purpose,
            issued_at: new Date(),
            due_date: due,
            status: 'issued',
            issued_by: actor.id,
            remarks: dto.remarks ?? null,
            created_by: actor.id,
          }),
        );
        await manager.update(BookCopy, copy.id, { status: 'issued' });
        await logCopyEvents(manager, [
          {
            school_id: schoolId,
            copy_id: copy.id,
            kind: 'issued',
            issue_id: issue.id,
            member_id: member.id,
            note: `Due ${due}`,
            actor_id: actor.id,
          },
        ]);
        issues.push(issue);
      }
      return issues;
    });
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(
      `i.id = ANY(${param(
        filter,
        created.map((issue) => issue.id),
      )})`,
    );
    const loans = await this.read.loans(schoolId, filter, 'i.id');
    if (loans.length) {
      await this.notify.tell(dto.member_id, LIBRARY_TEMPLATES.LIBRARY_BOOK_ISSUED, {
        books: loans.map((loan) => `"${loan.book.title}"`).join(', '),
        due_date: loans[0]!.due_date,
        book: loans[0]!.book.title,
        issue_id: String(loans[0]!.id),
      });
    }
    return loans;
  }

  async returnBooks(schoolId: number, dto: ReturnBooksDto, actor: AuthUser): Promise<ReturnedItemDto[]> {
    const today = this.read.today();
    const codes = dto.items.map((item) => item.code.trim().toUpperCase());
    if (new Set(codes).size !== codes.length) {
      throw AppException.validation([{ field: 'items', message: 'A copy is scanned twice' }]);
    }
    const outcome = await this.dataSource.transaction(async (manager) => {
      const rules = await this.settings.rules(schoolId);
      const results: { issue_id: number; member_id: number; book: string; fines: LibraryFine[] }[] = [];
      for (const item of dto.items) {
        const copy = await this.findCopy(manager, schoolId, item.code);
        const issue = await manager.findOne(LibraryIssue, {
          where: { copy_id: copy.id, status: 'issued', deleted_at: IsNull() },
          lock: { mode: 'pessimistic_write' },
        });
        if (!issue) {
          throw AppException.conflict(`${copy.accession_no} is not on loan`, 'NOT_ON_LOAN');
        }
        const book = await manager.findOneByOrFail(Book, { id: issue.book_id });
        const [member]: { member_type: 'student' | 'staff' }[] = await manager.query(
          `SELECT member_type FROM library_members WHERE id = $1`,
          [issue.member_id],
        );
        const fines: LibraryFine[] = [];
        const late = issue.due_date < today;
        if (late && finesApply(rules, member!.member_type)) {
          const holidays = await this.holidays(manager, schoolId, rules, issue.due_date, today);
          const days = chargeableDays(issue.due_date, today, rules.grace_days, rules.skip_holidays, holidays);
          const fine = await this.raiseFine(manager, {
            school_id: schoolId,
            member_id: issue.member_id,
            issue_id: issue.id,
            kind: 'overdue',
            amount: overdueFine(days, rules.fine_per_day, rules.max_fine_per_book),
            reason: fineReason('overdue', book.title, days),
            days_late: days,
            actor_id: actor.id,
          });
          if (fine) fines.push(fine);
        }
        if (item.damage_fine && item.damage_fine > 0) {
          const fine = await this.raiseFine(manager, {
            school_id: schoolId,
            member_id: issue.member_id,
            issue_id: issue.id,
            kind: 'damage',
            amount: item.damage_fine,
            reason: fineReason('damage', book.title),
            actor_id: actor.id,
          });
          if (fine) fines.push(fine);
        }
        const condition = item.condition ?? copy.condition;
        const copyStatus =
          item.damage_fine && item.damage_fine > 0 ? 'in_repair' : condition === 'poor' ? 'damaged' : 'available';
        await manager.update(LibraryIssue, issue.id, {
          status: 'returned',
          returned_at: new Date(),
          return_condition: item.condition ?? null,
          returned_by: actor.id,
          remarks: item.remarks ?? issue.remarks,
        });
        await manager.update(BookCopy, copy.id, { status: copyStatus, condition });
        await logCopyEvents(manager, [
          {
            school_id: schoolId,
            copy_id: copy.id,
            kind: 'returned',
            issue_id: issue.id,
            member_id: issue.member_id,
            note:
              [late ? `Returned ${today}, due ${issue.due_date}` : null, item.remarks].filter(Boolean).join(' · ') ||
              null,
            actor_id: actor.id,
          },
          ...(copyStatus !== 'available'
            ? [
                {
                  school_id: schoolId,
                  copy_id: copy.id,
                  kind: 'damaged' as const,
                  issue_id: issue.id,
                  member_id: issue.member_id,
                  note: copyStatus === 'in_repair' ? 'Sent for repair after return' : 'Returned in poor condition',
                  actor_id: actor.id,
                },
              ]
            : []),
        ]);
        results.push({ issue_id: issue.id, member_id: issue.member_id, book: book.title, fines });
      }
      return results;
    });

    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(
      `i.id = ANY(${param(
        filter,
        outcome.map((item) => item.issue_id),
      )})`,
    );
    const loans = new Map((await this.read.loans(schoolId, filter, 'i.id')).map((loan) => [loan.id, loan]));
    for (const item of outcome) {
      await this.notify.tell(item.member_id, LIBRARY_TEMPLATES.LIBRARY_BOOK_RETURNED, {
        book: item.book,
        issue_id: String(item.issue_id),
      });
      for (const fine of item.fines) {
        await this.notify.tell(item.member_id, LIBRARY_TEMPLATES.LIBRARY_FINE_RAISED, {
          amount: rupees(Number(fine.amount)),
          reason: fine.reason,
          issue_id: String(item.issue_id),
          fine_id: String(fine.id),
        });
      }
    }
    return outcome.map((item) => ({
      loan: loans.get(item.issue_id)!,
      fines: item.fines.map((fine) => this.memberFine(fine)),
    }));
  }

  private memberFine(fine: LibraryFine): MemberFineDto {
    return {
      id: fine.id,
      kind: fine.kind,
      status: fine.status,
      amount: Number(fine.amount),
      balance: Number(fine.balance),
      reason: fine.reason,
      created_at: fine.created_at,
    };
  }

  private async lockIssue(manager: EntityManager, schoolId: number, id: number): Promise<LibraryIssue> {
    const issue = await manager.findOne(LibraryIssue, {
      where: { id, school_id: schoolId, deleted_at: IsNull() },
      lock: { mode: 'pessimistic_write' },
    });
    if (!issue) throw AppException.notFound('Loan not found', 'LOAN_NOT_FOUND');
    return issue;
  }

  async renew(schoolId: number, id: number, dto: RenewDto, actor: AuthUser): Promise<LoanDto> {
    const today = this.read.today();
    await this.dataSource.transaction(async (manager) => {
      const issue = await this.lockIssue(manager, schoolId, id);
      const rules = await this.settings.rules(schoolId);
      const refusal = renewRefusal(issue, today, rules);
      if (refusal) throw AppException.conflict(refusal.message, refusal.code);
      const member = await this.members.member(schoolId, issue.member_id, manager);
      if (member.status !== 'active')
        throw AppException.conflict(`This member is ${member.status}`, 'MEMBER_NOT_ACTIVE');
      const days = loanDays(rules, member.member_type, member.loan_days_override);
      const base = issue.due_date > today ? issue.due_date : today;
      const holidays = await this.holidays(manager, schoolId, rules, base, addDays(base, days + 60));
      const due = dto.due_date ?? dueDateFor(base, days, rules.skip_holidays, holidays);
      if (due <= today || due <= issue.due_date) {
        throw AppException.validation([{ field: 'due_date', message: `Pick a date after ${issue.due_date}` }]);
      }
      await manager.update(LibraryIssue, issue.id, { due_date: due, renew_count: issue.renew_count + 1 });
      await logCopyEvents(manager, [
        {
          school_id: schoolId,
          copy_id: issue.copy_id,
          kind: 'renewed',
          issue_id: issue.id,
          member_id: issue.member_id,
          note: `Due ${issue.due_date} → ${due}`,
          actor_id: actor.id,
        },
      ]);
    });
    return this.loan(schoolId, id);
  }

  async markLost(schoolId: number, id: number, dto: LostDto, actor: AuthUser): Promise<LoanDetailDto> {
    const today = this.read.today();
    const raised = await this.dataSource.transaction(async (manager) => {
      const issue = await this.lockIssue(manager, schoolId, id);
      if (issue.status !== 'issued') throw AppException.conflict('This book is not on loan', 'LOAN_CLOSED');
      const rules = await this.settings.rules(schoolId);
      const copy = await manager.findOneByOrFail(BookCopy, { id: issue.copy_id });
      const book = await manager.findOneByOrFail(Book, { id: issue.book_id });
      const [member]: { member_type: 'student' | 'staff' }[] = await manager.query(
        `SELECT member_type FROM library_members WHERE id = $1`,
        [issue.member_id],
      );
      const fines: RaisedFine[] = [];
      if (issue.due_date < today && finesApply(rules, member!.member_type)) {
        const holidays = await this.holidays(manager, schoolId, rules, issue.due_date, today);
        const days = chargeableDays(issue.due_date, today, rules.grace_days, rules.skip_holidays, holidays);
        const fine = await this.raiseFine(manager, {
          school_id: schoolId,
          member_id: issue.member_id,
          issue_id: issue.id,
          kind: 'overdue',
          amount: overdueFine(days, rules.fine_per_day, rules.max_fine_per_book),
          reason: fineReason('overdue', book.title, days),
          days_late: days,
          actor_id: actor.id,
        });
        if (fine) fines.push({ member_id: issue.member_id, amount: Number(fine.amount), reason: fine.reason });
      }
      const lost = await this.raiseFine(manager, {
        school_id: schoolId,
        member_id: issue.member_id,
        issue_id: issue.id,
        kind: 'lost',
        amount: lostFine(copy.price ?? book.price, rules.lost_processing_fee),
        reason: fineReason('lost', book.title),
        actor_id: actor.id,
      });
      if (lost) fines.push({ member_id: issue.member_id, amount: Number(lost.amount), reason: lost.reason });
      await manager.update(LibraryIssue, issue.id, {
        status: 'lost',
        returned_by: actor.id,
        remarks: dto.note ?? issue.remarks,
      });
      await manager.update(BookCopy, copy.id, { status: 'lost' });
      await logCopyEvents(manager, [
        {
          school_id: schoolId,
          copy_id: copy.id,
          kind: 'marked_lost',
          issue_id: issue.id,
          member_id: issue.member_id,
          note: dto.note ?? null,
          actor_id: actor.id,
        },
      ]);
      return fines;
    });
    for (const fine of raised) {
      await this.notify.tell(fine.member_id, LIBRARY_TEMPLATES.LIBRARY_FINE_RAISED, {
        amount: rupees(fine.amount),
        reason: fine.reason,
        issue_id: String(id),
      });
    }
    return this.detail(schoolId, id);
  }

  async markFound(schoolId: number, id: number, actor: AuthUser): Promise<LoanDetailDto> {
    await this.dataSource.transaction(async (manager) => {
      const issue = await this.lockIssue(manager, schoolId, id);
      if (issue.status !== 'lost') throw AppException.conflict('This book is not marked lost', 'NOT_LOST');
      const copy = await manager.findOne(BookCopy, {
        where: { id: issue.copy_id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!copy || copy.deleted_at)
        throw AppException.conflict('This copy was removed from the catalogue', 'COPY_REMOVED');
      if (copy.status !== 'lost') {
        throw AppException.conflict('This copy is already back in circulation', 'COPY_NOT_LOST');
      }
      const lostFines = await manager.find(LibraryFine, {
        where: { issue_id: issue.id, kind: 'lost', deleted_at: IsNull() },
      });
      for (const fine of lostFines) {
        if (Number(fine.balance) <= 0) continue;
        const waived = round2(Number(fine.waived) + Number(fine.balance));
        await manager.update(LibraryFine, fine.id, {
          ...fineAmounts(Number(fine.amount), waived, Number(fine.paid)),
          waived_by: actor.id,
          waived_at: new Date(),
          waive_reason: 'The lost book was found',
        });
      }
      await manager.update(LibraryIssue, issue.id, {
        status: 'returned',
        returned_at: new Date(),
        returned_by: actor.id,
      });
      await manager.update(BookCopy, copy.id, { status: 'available' });
      await logCopyEvents(manager, [
        {
          school_id: schoolId,
          copy_id: copy.id,
          kind: 'found',
          issue_id: issue.id,
          member_id: issue.member_id,
          note: 'Lost book returned; unpaid lost fine waived',
          actor_id: actor.id,
        },
      ]);
    });
    return this.detail(schoolId, id);
  }

  private listFilter(schoolId: number, query: IssueQueryDto): SqlFilter {
    const filter: SqlFilter = { where: [], params: [] };
    const today = this.read.today();
    if (query.status) filter.where.push(`i.status = ${param(filter, query.status)}`);
    if (query.state) {
      filter.where.push(`i.status = 'issued'`);
      if (query.state === 'overdue') filter.where.push(`i.due_date < ${param(filter, today)}::date`);
      if (query.state === 'due_today') filter.where.push(`i.due_date = ${param(filter, today)}::date`);
      if (query.state === 'due_soon') {
        filter.where.push(
          `i.due_date > ${param(filter, today)}::date AND i.due_date <= ${param(filter, today)}::date + (SELECT COALESCE(MAX(due_soon_days), 2) FROM library_settings WHERE school_id = ${param(filter, schoolId)})`,
        );
      }
    }
    if (query.member_id) filter.where.push(`i.member_id = ${param(filter, query.member_id)}`);
    if (query.book_id) filter.where.push(`i.book_id = ${param(filter, query.book_id)}`);
    if (query.copy_id) filter.where.push(`i.copy_id = ${param(filter, query.copy_id)}`);
    if (query.member_type) filter.where.push(`m.member_type = ${param(filter, query.member_type)}`);
    if (query.class_id) filter.where.push(`i.class_id = ${param(filter, query.class_id)}`);
    if (query.section_id) filter.where.push(`i.section_id = ${param(filter, query.section_id)}`);
    if (query.purpose) filter.where.push(`i.purpose = ${param(filter, query.purpose)}`);
    const zone = query.from || query.to || query.on ? param(filter, this.app.timeZone) : null;
    if (query.on) {
      const day = param(filter, query.on);
      filter.where.push(
        `((i.issued_at AT TIME ZONE ${zone})::date = ${day}::date OR (i.returned_at AT TIME ZONE ${zone})::date = ${day}::date)`,
      );
    }
    if (query.from) filter.where.push(`(i.issued_at AT TIME ZONE ${zone})::date >= ${param(filter, query.from)}::date`);
    if (query.to) filter.where.push(`(i.issued_at AT TIME ZONE ${zone})::date <= ${param(filter, query.to)}::date`);
    addSearch(filter, query.search, [
      'b.title',
      'b.authors',
      'c.accession_no',
      'c.barcode',
      MEMBER_NAME('m', 'mm'),
      'm.card_no',
    ]);
    return filter;
  }

  async list(schoolId: number, query: IssueQueryDto): Promise<Paginated<LoanDto>> {
    const column = LOAN_SORTS[query.sort ?? 'issued_at'];
    if (!column) {
      throw AppException.badRequest(`sort must be one of: ${Object.keys(LOAN_SORTS).join(', ')}`, 'INVALID_SORT');
    }
    const order = `${column} ${query.order === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, i.id DESC`;
    return this.read.loanPage(schoolId, this.listFilter(schoolId, query), order, query.page, query.limit);
  }

  async exportCsv(schoolId: number, query: IssueQueryDto): Promise<{ name: string; buffer: Buffer }> {
    const column = LOAN_SORTS[query.sort ?? 'issued_at'] ?? 'i.issued_at';
    const loans = await this.read.loans(
      schoolId,
      this.listFilter(schoolId, query),
      `${column} ${query.order === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, i.id DESC`,
      5000,
    );
    const zone = this.app.timeZone;
    const stamp = (value: Date | null) =>
      value
        ? new Intl.DateTimeFormat('en-CA', {
            timeZone: zone,
            dateStyle: 'short',
            timeStyle: 'short',
            hour12: false,
          }).format(value)
        : '';
    const header = [
      'Issued at',
      'Due date',
      'Returned at',
      'Status',
      'Days overdue',
      'Running fine',
      'Accession no',
      'Book',
      'Authors',
      'Member',
      'Member type',
      'Card no',
      'Class / role',
      'Renewals',
      'Issued by',
      'Returned by',
    ];
    const cell = (value: unknown) => {
      const text = value === null || value === undefined ? '' : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const lines = [
      header.join(','),
      ...loans.map((loan) =>
        [
          stamp(loan.issued_at),
          loan.due_date,
          stamp(loan.returned_at),
          loan.state,
          loan.days_overdue,
          loan.running_fine,
          loan.copy.accession_no,
          loan.book.title,
          loan.book.authors,
          loan.member.name,
          loan.member.member_type,
          loan.member.card_no,
          loan.member.detail,
          loan.renew_count,
          loan.issued_by,
          loan.returned_by,
        ]
          .map(cell)
          .join(','),
      ),
    ];
    return {
      name: `library-transactions-${this.read.today()}.csv`,
      buffer: Buffer.from(`﻿${lines.join('\n')}`, 'utf8'),
    };
  }

  async insights(schoolId: number): Promise<IssueInsightsDto> {
    const today = this.read.today();
    const rules = await this.settings.rules(schoolId);
    const [row]: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT
         COUNT(*) FILTER (WHERE i.status = 'issued')::int AS on_loan,
         COUNT(*) FILTER (WHERE i.status = 'issued' AND i.due_date < $2::date)::int AS overdue,
         COUNT(*) FILTER (WHERE i.status = 'issued' AND i.due_date = $2::date)::int AS due_today,
         COUNT(*) FILTER (WHERE i.status = 'issued' AND i.due_date > $2::date AND i.due_date <= $2::date + $4::int)::int AS due_soon,
         COUNT(*) FILTER (WHERE (i.issued_at AT TIME ZONE $3)::date = $2::date)::int AS issued_today,
         COUNT(*) FILTER (WHERE i.status = 'returned' AND (i.returned_at AT TIME ZONE $3)::date = $2::date)::int AS returned_today,
         COUNT(*) FILTER (WHERE i.status = 'lost')::int AS lost
       FROM library_issues i WHERE i.school_id = $1 AND i.deleted_at IS NULL`,
      [schoolId, today, this.app.timeZone, rules.due_soon_days],
    );
    const overdueFilter: SqlFilter = { where: [`i.status = 'issued'`], params: [] };
    overdueFilter.where.push(`i.due_date < ${param(overdueFilter, today)}::date`);
    const overdue = await this.read.loans(schoolId, overdueFilter, 'i.due_date');
    const followUps = await this.followUpCount(schoolId);
    return {
      on_loan: Number(row?.on_loan ?? 0),
      overdue: Number(row?.overdue ?? 0),
      due_today: Number(row?.due_today ?? 0),
      due_soon: Number(row?.due_soon ?? 0),
      issued_today: Number(row?.issued_today ?? 0),
      returned_today: Number(row?.returned_today ?? 0),
      lost: Number(row?.lost ?? 0),
      running_fines: round2(overdue.reduce((sum, loan) => sum + loan.running_fine, 0)),
      follow_ups_due: followUps,
    };
  }

  private followUpFilter(query: Pick<FollowUpQueryDto, 'show' | 'member_type' | 'class_id' | 'search'>): SqlFilter {
    const today = this.read.today();
    const filter: SqlFilter = { where: [`i.status = 'issued'`], params: [] };
    filter.where.push(`i.due_date < ${param(filter, today)}::date`);
    if ((query.show ?? 'due') === 'due') {
      filter.where.push(
        `(f.id IS NULL OR COALESCE(f.next_follow_up_on, f.promised_on + 1, f.created_at::date + 3) <= ${param(filter, today)}::date)`,
      );
    }
    if (query.member_type) filter.where.push(`m.member_type = ${param(filter, query.member_type)}`);
    if (query.class_id) filter.where.push(`i.class_id = ${param(filter, query.class_id)}`);
    addSearch(filter, query.search, ['b.title', 'c.accession_no', MEMBER_NAME('m', 'mm'), 'm.card_no']);
    return filter;
  }

  async followUpCount(schoolId: number): Promise<number> {
    const page = await this.read.loanPage(schoolId, this.followUpFilter({ show: 'due' }), 'i.due_date', 1, 1);
    return page.total;
  }

  async followUpQueue(schoolId: number, query: FollowUpQueryDto): Promise<Paginated<LoanDto>> {
    return this.read.loanPage(schoolId, this.followUpFilter(query), 'i.due_date ASC, i.id', query.page, query.limit);
  }

  async loan(schoolId: number, id: number): Promise<LoanDto> {
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`i.id = ${param(filter, id)}`);
    const [loan] = await this.read.loans(schoolId, filter);
    if (!loan) throw AppException.notFound('Loan not found', 'LOAN_NOT_FOUND');
    return loan;
  }

  async detail(schoolId: number, id: number): Promise<LoanDetailDto> {
    const loan = await this.loan(schoolId, id);
    const followUps: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT f.id, f.action, f.note, f.promised_on::text AS promised_on, f.next_follow_up_on::text AS next_follow_up_on,
              f.created_at, u.name AS by
       FROM library_follow_ups f LEFT JOIN users u ON u.id = f.created_by
       WHERE f.issue_id = $1 AND f.deleted_at IS NULL ORDER BY f.created_at DESC`,
      [id],
    );
    const fineFilter: SqlFilter = { where: [], params: [] };
    fineFilter.where.push(`f.issue_id = ${param(fineFilter, id)}`);
    const fines = (await this.read.fines(schoolId, fineFilter)).map((fine) => this.read.memberFine(fine));
    const reminders: { kind: string; sent_at: Date; recipients: number }[] = await this.dataSource.query(
      `SELECT kind, sent_at, recipients FROM library_reminders WHERE issue_id = $1 ORDER BY sent_at DESC`,
      [id],
    );
    return {
      ...loan,
      follow_ups: followUps.map((row) => this.followUp(row)),
      fines,
      reminders: reminders.map((row) => ({ kind: row.kind, sent_at: row.sent_at, recipients: Number(row.recipients) })),
    };
  }

  private followUp(row: Record<string, unknown>): FollowUpDto {
    return {
      id: Number(row.id),
      action: row.action as FollowUpDto['action'],
      note: (row.note as string | null) ?? null,
      promised_on: (row.promised_on as string | null) ?? null,
      next_follow_up_on: (row.next_follow_up_on as string | null) ?? null,
      by: (row.by as string | null) ?? null,
      created_at: row.created_at as Date,
    };
  }

  async addFollowUp(schoolId: number, id: number, dto: FollowUpInputDto, actor: AuthUser): Promise<FollowUpDto> {
    const today = this.read.today();
    const issue = await this.dataSource.getRepository(LibraryIssue).findOneBy({ id, school_id: schoolId });
    if (!issue) throw AppException.notFound('Loan not found', 'LOAN_NOT_FOUND');
    if (issue.status !== 'issued') throw AppException.conflict('This book is not on loan any more', 'LOAN_CLOSED');
    if (dto.next_follow_up_on && dto.next_follow_up_on < today) {
      throw AppException.validation([{ field: 'next_follow_up_on', message: 'Pick today or a later date' }]);
    }
    if (dto.action === 'promised_date' && !dto.promised_on) {
      throw AppException.validation([{ field: 'promised_on', message: 'Enter the date they promised' }]);
    }
    const saved = await this.dataSource.getRepository(LibraryFollowUp).save(
      this.dataSource.getRepository(LibraryFollowUp).create({
        school_id: schoolId,
        issue_id: issue.id,
        member_id: issue.member_id,
        action: dto.action,
        note: dto.note ?? null,
        promised_on: dto.promised_on ?? null,
        next_follow_up_on: dto.next_follow_up_on ?? null,
        created_by: actor.id,
      }),
    );
    return this.followUp({ ...saved, by: actor.name });
  }
}
