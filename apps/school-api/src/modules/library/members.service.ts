import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AppException, paginate, Paginated } from '@app/common';
import { normalizeMobile } from '../../shared/mobile';
import { yearClause } from '../../shared/year-context';
import { QrTokens } from '../security/qr-tokens';
import { SequencesService } from '../schools/sequences.service';
import { schoolInfo } from './copy-events';
import {
  MemberBulkDto,
  MemberBulkResultDto,
  MemberCreateDto,
  MemberDto,
  MemberInsightsDto,
  MemberQueryDto,
  MemberSummaryDto,
  MemberUpdateDto,
  PeopleQueryDto,
  PersonDto,
} from './dto/circulation.dto';
import { ClassOverdueDto, PersonLibraryDto, SectionLibraryDto, SectionLibraryStudentDto } from './dto/desk.dto';
import { LibraryMember, MemberStatus, MemberType } from './entities/library-member.entity';
import { bookLimit, cardNumber, LoanRules, loanDays, Refusal } from './library.logic';
import {
  addSearch,
  LibraryReadService,
  MEMBER_COLUMNS,
  MEMBER_JOINS,
  MEMBER_NAME,
  param,
  Row,
  SqlFilter,
} from './library-read.service';
import { LibrarySettingsService } from './library-settings.service';

const MEMBER_SORTS: Record<string, string> = {
  name: 'mm_name',
  card_no: 'm.card_no',
  joined_on: 'm.joined_on',
  created_at: 'm.created_at',
  open_loans: 'k.open_loans',
  unpaid_fines: 'k.unpaid_fines',
};

export type PersonKey = { student_id: number } | { user_id: number };

@Injectable()
export class MembersService {
  private readonly sequences = new SequencesService();

  constructor(
    private readonly dataSource: DataSource,
    private readonly read: LibraryReadService,
    private readonly settings: LibrarySettingsService,
    private readonly qr: QrTokens,
  ) {}

  private memberSql(filter: SqlFilter, tail: string): string {
    return `
      SELECT m.id, m.member_type, m.card_no, m.status, m.status_reason, m.max_books, m.loan_days,
             m.joined_on::text AS joined_on, m.student_id, m.user_id,
             mms.admission_no, mms.status AS student_status, mme.section_id AS m_section_id,
             mmst.employee_no, mmst.designation, mmst.status AS staff_status, mmu.mobile,
             k.open_loans, k.overdue_loans, k.total_loans, k.unpaid_fines, k.last_visit_at,
             ${MEMBER_COLUMNS('m', 'mm')}
      FROM library_members m
      ${MEMBER_JOINS('m', 'mm')}
      LEFT JOIN LATERAL (
        SELECT
          (SELECT COUNT(*) FROM library_issues i WHERE i.member_id = m.id AND i.status = 'issued' AND i.deleted_at IS NULL)::int AS open_loans,
          (SELECT COUNT(*) FROM library_issues i WHERE i.member_id = m.id AND i.status = 'issued' AND i.deleted_at IS NULL AND i.due_date < CURRENT_DATE)::int AS overdue_loans,
          (SELECT COUNT(*) FROM library_issues i WHERE i.member_id = m.id AND i.deleted_at IS NULL)::int AS total_loans,
          (SELECT COALESCE(SUM(f.balance), 0) FROM library_fines f WHERE f.member_id = m.id AND f.deleted_at IS NULL) AS unpaid_fines,
          (SELECT MAX(COALESCE(v.in_at, v.created_at)) FROM library_visits v WHERE v.deleted_at IS NULL AND v.present
             AND ((m.student_id IS NOT NULL AND v.student_id = m.student_id) OR (m.user_id IS NOT NULL AND v.user_id = m.user_id))) AS last_visit_at
      ) k ON true
      WHERE m.deleted_at IS NULL ${filter.where.length ? `AND ${filter.where.join(' AND ')}` : ''}
      ${tail}`;
  }

  private presentMember(row: Row, rules: LoanRules): MemberDto {
    const type = row.member_type as MemberType;
    const maxOverride = row.max_books === null ? null : Number(row.max_books);
    const daysOverride = row.loan_days === null ? null : Number(row.loan_days);
    const ref = this.read.memberRef(row, 'mm');
    return {
      id: Number(row.id),
      member_type: type,
      card_no: String(row.card_no),
      name: ref.name,
      detail: ref.detail,
      photo_url: ref.photo_url,
      phone: ref.phone,
      status: row.status as MemberStatus,
      status_reason: (row.status_reason as string | null) ?? null,
      max_books: bookLimit(rules, type, maxOverride),
      loan_days: loanDays(rules, type, daysOverride),
      max_books_override: maxOverride,
      loan_days_override: daysOverride,
      joined_on: String(row.joined_on),
      student:
        type === 'student' && row.student_id
          ? {
              id: Number(row.student_id),
              admission_no: String(row.admission_no ?? ''),
              class_section: ref.detail,
              section_id: row.m_section_id === null || row.m_section_id === undefined ? null : Number(row.m_section_id),
              status: String(row.student_status ?? 'active'),
            }
          : null,
      staff:
        type === 'staff' && row.user_id
          ? {
              user_id: Number(row.user_id),
              employee_no: (row.employee_no as string | null) ?? null,
              designation: (row.designation as string | null) ?? null,
              mobile: String(row.mobile ?? ''),
              status: String(row.staff_status ?? 'active'),
            }
          : null,
      open_loans: Number(row.open_loans ?? 0),
      overdue_loans: Number(row.overdue_loans ?? 0),
      unpaid_fines: Number(row.unpaid_fines ?? 0),
      total_loans: Number(row.total_loans ?? 0),
      last_visit_at: (row.last_visit_at as Date | null) ?? null,
    };
  }

  async list(schoolId: number, query: MemberQueryDto): Promise<Paginated<MemberDto>> {
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`m.school_id = ${param(filter, schoolId)}`);
    if (query.member_type) filter.where.push(`m.member_type = ${param(filter, query.member_type)}`);
    if (query.status) filter.where.push(`m.status = ${param(filter, query.status)}`);
    if (query.class_id) filter.where.push(`mme.class_id = ${param(filter, query.class_id)}`);
    if (query.section_id) filter.where.push(`mme.section_id = ${param(filter, query.section_id)}`);
    if (query.has_overdue !== undefined)
      filter.where.push(query.has_overdue ? 'k.overdue_loans > 0' : 'k.overdue_loans = 0');
    if (query.has_fines !== undefined) filter.where.push(query.has_fines ? 'k.unpaid_fines > 0' : 'k.unpaid_fines = 0');
    addSearch(filter, query.search, [
      MEMBER_NAME('m', 'mm'),
      'm.card_no',
      'mms.admission_no',
      'mmst.employee_no',
      'mmu.mobile',
    ]);
    const column = MEMBER_SORTS[query.sort ?? 'name'];
    if (!column) {
      throw AppException.badRequest(`sort must be one of: ${Object.keys(MEMBER_SORTS).join(', ')}`, 'INVALID_SORT');
    }
    const order = `${column} ${query.sort ? (query.order === 'asc' ? 'ASC' : 'DESC') : 'ASC'} NULLS LAST, m.id`;
    const [{ total }]: { total: string }[] = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM (${this.memberSql(filter, '')}) counted`,
      filter.params,
    );
    const rows: Row[] = await this.dataSource.query(
      this.memberSql(filter, `ORDER BY ${order} LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`),
      filter.params,
    );
    const rules = await this.settings.rules(schoolId);
    return paginate([rows.map((row) => this.presentMember(row, rules)), Number(total)], query.page, query.limit);
  }

  async member(schoolId: number, id: number, manager?: EntityManager): Promise<MemberDto> {
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`m.school_id = ${param(filter, schoolId)}`, `m.id = ${param(filter, id)}`);
    const [row]: Row[] = await (manager ?? this.dataSource.manager).query(this.memberSql(filter, ''), filter.params);
    if (!row) throw AppException.notFound('Library member not found', 'MEMBER_NOT_FOUND');
    return this.presentMember(row, await this.settings.rules(schoolId));
  }

  async insights(schoolId: number): Promise<MemberInsightsDto> {
    const [row]: Row[] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS members,
              COUNT(*) FILTER (WHERE m.member_type = 'student')::int AS students,
              COUNT(*) FILTER (WHERE m.member_type = 'staff')::int AS staff,
              COUNT(*) FILTER (WHERE m.status = 'suspended')::int AS suspended,
              COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM library_issues i WHERE i.member_id = m.id AND i.status = 'issued'
                 AND i.deleted_at IS NULL AND i.due_date < $2::date))::int AS with_overdue,
              COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM library_fines f WHERE f.member_id = m.id AND f.balance > 0
                 AND f.deleted_at IS NULL))::int AS with_fines,
              (SELECT COUNT(*) FROM students s WHERE s.school_id = $1 AND s.deleted_at IS NULL AND s.status = 'active'
                 AND NOT EXISTS (SELECT 1 FROM library_members x WHERE x.student_id = s.id AND x.deleted_at IS NULL))::int AS students_not_enrolled
       FROM library_members m WHERE m.school_id = $1 AND m.deleted_at IS NULL`,
      [schoolId, this.read.today()],
    );
    return {
      members: Number(row?.members ?? 0),
      students: Number(row?.students ?? 0),
      staff: Number(row?.staff ?? 0),
      suspended: Number(row?.suspended ?? 0),
      with_overdue: Number(row?.with_overdue ?? 0),
      with_fines: Number(row?.with_fines ?? 0),
      students_not_enrolled: Number(row?.students_not_enrolled ?? 0),
    };
  }

  async people(schoolId: number, query: PeopleQueryDto): Promise<PersonDto[]> {
    const filter: SqlFilter = { where: [], params: [] };
    const school = param(filter, schoolId);
    const studentSearch: SqlFilter = { where: [], params: filter.params };
    addSearch(studentSearch, query.search, [
      `s.first_name || COALESCE(' ' || s.last_name, '')`,
      's.admission_no',
      'lm.card_no',
    ]);
    const staffSearch: SqlFilter = { where: [], params: filter.params };
    addSearch(staffSearch, query.search, ['u.name', 'st.employee_no', 'u.mobile', 'lm.card_no']);
    const students = `
      SELECT 'student' AS member_type, s.id AS student_id, NULL::int AS user_id,
             s.first_name || COALESCE(' ' || s.last_name, '') AS name,
             CONCAT_WS(' · ', NULLIF(CONCAT_WS(' - ', ce.class_name, ce.section_name), ''), s.admission_no) AS detail,
             s.photo_file_id AS photo, lm.id AS member_id, lm.card_no, lm.status AS member_status
      FROM students s
      LEFT JOIN library_members lm ON lm.student_id = s.id AND lm.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT c.name AS class_name, sec.name AS section_name FROM student_enrollments e
        JOIN academic_years y ON y.id = e.academic_year_id AND ${yearClause('y')}
        JOIN classes c ON c.id = e.class_id LEFT JOIN sections sec ON sec.id = e.section_id
        WHERE e.student_id = s.id ORDER BY e.id DESC LIMIT 1
      ) ce ON true
      WHERE s.school_id = ${school} AND s.deleted_at IS NULL AND s.status = 'active'
      ${studentSearch.where.length ? `AND ${studentSearch.where.join(' AND ')}` : ''}`;
    const staff = `
      SELECT 'staff' AS member_type, NULL::int AS student_id, u.id AS user_id, u.name,
             CONCAT_WS(' · ', st.designation, st.employee_no) AS detail, u.photo_file_id AS photo,
             lm.id AS member_id, lm.card_no, lm.status AS member_status
      FROM staff st
      JOIN users u ON u.id = st.user_id AND u.deleted_at IS NULL
      LEFT JOIN library_members lm ON lm.user_id = u.id AND lm.school_id = st.school_id AND lm.deleted_at IS NULL
      WHERE st.school_id = ${school} AND st.deleted_at IS NULL AND st.status = 'active'
      ${staffSearch.where.length ? `AND ${staffSearch.where.join(' AND ')}` : ''}`;
    const parts =
      query.member_type === 'student' ? [students] : query.member_type === 'staff' ? [staff] : [students, staff];
    const rows: Row[] = await this.dataSource.query(
      `SELECT * FROM (${parts.join(' UNION ALL ')}) people ORDER BY name LIMIT 20`,
      filter.params,
    );
    return rows.map((row) => ({
      member_type: row.member_type as MemberType,
      student_id: row.student_id === null ? null : Number(row.student_id),
      user_id: row.user_id === null ? null : Number(row.user_id),
      name: String(row.name),
      detail: (row.detail as string | null) || null,
      photo_url: this.read.link(row.photo),
      member_id: row.member_id === null ? null : Number(row.member_id),
      card_no: (row.card_no as string | null) ?? null,
      member_status: (row.member_status as MemberStatus | null) ?? null,
    }));
  }

  async ensureMember(
    manager: EntityManager,
    schoolId: number,
    key: PersonKey,
  ): Promise<{ member: LibraryMember; created: boolean }> {
    if ('student_id' in key) {
      const [student]: { id: number; status: string }[] = await manager.query(
        `SELECT id, status FROM students WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
        [key.student_id, schoolId],
      );
      if (!student) throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');
      const existing = await manager.findOneBy(LibraryMember, { school_id: schoolId, student_id: key.student_id });
      if (existing) return { member: existing, created: false };
      if (student.status !== 'active') throw AppException.conflict('This student has left the school', 'MEMBER_LEFT');
      return { member: await this.createMember(manager, schoolId, 'student', key.student_id, null), created: true };
    }
    const [staff]: { status: string }[] = await manager.query(
      `SELECT st.status FROM staff st WHERE st.user_id = $1 AND st.school_id = $2 AND st.deleted_at IS NULL`,
      [key.user_id, schoolId],
    );
    if (!staff) throw AppException.notFound('Staff member not found', 'STAFF_NOT_FOUND');
    const existing = await manager.findOneBy(LibraryMember, { school_id: schoolId, user_id: key.user_id });
    if (existing) return { member: existing, created: false };
    if (staff.status !== 'active') throw AppException.conflict('This staff member is not active', 'MEMBER_LEFT');
    return { member: await this.createMember(manager, schoolId, 'staff', null, key.user_id), created: true };
  }

  private async createMember(
    manager: EntityManager,
    schoolId: number,
    type: MemberType,
    studentId: number | null,
    userId: number | null,
  ): Promise<LibraryMember> {
    const school = await schoolInfo(manager, schoolId);
    const value = await this.sequences.next(manager, schoolId, `library_card_${type}`);
    const inserted = await manager
      .createQueryBuilder()
      .insert()
      .into(LibraryMember)
      .values({
        school_id: schoolId,
        member_type: type,
        student_id: studentId,
        user_id: userId,
        card_no: cardNumber(school.code, type, value),
        status: 'active',
        joined_on: this.read.today(),
      })
      .orIgnore()
      .returning('*')
      .execute();
    const created = inserted.raw?.[0] as LibraryMember | undefined;
    if (created) return manager.create(LibraryMember, created);
    const existing = await manager.findOneBy(
      LibraryMember,
      studentId ? { school_id: schoolId, student_id: studentId } : { school_id: schoolId, user_id: userId! },
    );
    if (!existing) throw AppException.conflict('Could not enrol this member, try again', 'MEMBER_ENROL_FAILED');
    return existing;
  }

  async resolveCode(manager: EntityManager, schoolId: number, raw: string): Promise<PersonKey> {
    const code = raw.trim();
    if (code.startsWith('TZS1.')) {
      const parsed = this.qr.readStudent(code);
      if (!parsed) throw AppException.badRequest('This QR code is not a school ID card', 'QR_INVALID');
      const [student]: { card_version: number; school_id: number }[] = await manager.query(
        `SELECT card_version, school_id FROM students WHERE id = $1 AND deleted_at IS NULL`,
        [parsed.student_id],
      );
      if (!student || Number(student.school_id) !== schoolId) {
        throw AppException.notFound('This card belongs to another school', 'QR_OTHER_SCHOOL');
      }
      if (Number(student.card_version) !== parsed.version) {
        throw AppException.conflict('This card was replaced. Use the latest ID card.', 'QR_REPLACED');
      }
      return { student_id: parsed.student_id };
    }
    const [card]: { student_id: number | null; user_id: number | null }[] = await manager.query(
      `SELECT student_id, user_id FROM library_members WHERE school_id = $1 AND deleted_at IS NULL AND upper(card_no) = upper($2)`,
      [schoolId, code],
    );
    if (card) return card.student_id ? { student_id: Number(card.student_id) } : { user_id: Number(card.user_id) };
    const [student]: { id: number }[] = await manager.query(
      `SELECT id FROM students WHERE school_id = $1 AND deleted_at IS NULL AND upper(admission_no) = upper($2)`,
      [schoolId, code],
    );
    if (student) return { student_id: Number(student.id) };
    const [staff]: { user_id: number }[] = await manager.query(
      `SELECT st.user_id FROM staff st JOIN users u ON u.id = st.user_id
       WHERE st.school_id = $1 AND st.deleted_at IS NULL AND (upper(st.employee_no) = upper($2) OR u.mobile = $3)
       LIMIT 1`,
      [schoolId, code, String(normalizeMobile(code))],
    );
    if (staff) return { user_id: Number(staff.user_id) };
    throw AppException.notFound(`Nobody has the card or number ${code}`, 'MEMBER_NOT_FOUND');
  }

  async lookup(schoolId: number, code: string): Promise<MemberSummaryDto> {
    const { member, created } = await this.dataSource.transaction(async (manager) =>
      this.ensureMember(manager, schoolId, await this.resolveCode(manager, schoolId, code)),
    );
    return { ...(await this.summary(schoolId, member.id)), enrolled_now: created };
  }

  async summary(schoolId: number, id: number): Promise<MemberSummaryDto> {
    const member = await this.member(schoolId, id);
    const loanFilter: SqlFilter = { where: [], params: [] };
    loanFilter.where.push(`i.member_id = ${param(loanFilter, id)}`, `i.status = 'issued'`);
    const loans = await this.read.loans(schoolId, loanFilter, 'i.due_date ASC, i.id');
    const fineFilter: SqlFilter = { where: [], params: [] };
    fineFilter.where.push(`f.member_id = ${param(fineFilter, id)}`, 'f.balance > 0');
    const fines = (await this.read.fines(schoolId, fineFilter)).map((fine) => this.read.memberFine(fine));
    const rules = await this.settings.rules(schoolId);
    const refusal = this.memberRefusal(member, rules);
    return {
      member,
      loans,
      fines,
      books_left: Math.max(0, member.max_books - member.open_loans),
      can_borrow: refusal === null,
      refusal,
      enrolled_now: false,
    };
  }

  memberRefusal(member: MemberDto, rules: LoanRules): Refusal | null {
    if (member.status !== 'active') return { code: 'MEMBER_NOT_ACTIVE', message: `This member is ${member.status}` };
    const personStatus = member.student?.status ?? member.staff?.status ?? 'active';
    if (personStatus !== 'active') return { code: 'MEMBER_LEFT', message: 'This person has left the school' };
    if (member.open_loans >= member.max_books) {
      return {
        code: 'BOOK_LIMIT_REACHED',
        message: `The member can hold ${member.max_books} ${member.max_books === 1 ? 'book' : 'books'} and already has ${member.open_loans}`,
      };
    }
    if (rules.block_issue_above_fine > 0 && member.unpaid_fines > rules.block_issue_above_fine) {
      return {
        code: 'FINE_PENDING',
        message: `Unpaid library fines of Rs. ${member.unpaid_fines.toFixed(2)}. Collect the fine before issuing.`,
      };
    }
    return null;
  }

  async create(schoolId: number, dto: MemberCreateDto): Promise<MemberDto> {
    if (Boolean(dto.student_id) === Boolean(dto.user_id)) {
      throw AppException.validation([{ field: 'student_id', message: 'Send either student_id or user_id' }]);
    }
    const key: PersonKey = dto.student_id ? { student_id: dto.student_id } : { user_id: dto.user_id! };
    const { member, created } = await this.dataSource.transaction((manager) =>
      this.ensureMember(manager, schoolId, key),
    );
    if (!created) throw AppException.conflict(`Already a member (card ${member.card_no})`, 'ALREADY_MEMBER');
    return this.member(schoolId, member.id);
  }

  async bulk(schoolId: number, dto: MemberBulkDto): Promise<MemberBulkResultDto> {
    const choices = [dto.section_id, dto.class_id, dto.all_students, dto.all_staff].filter(Boolean).length;
    if (choices !== 1) {
      throw AppException.validation([
        { field: 'section_id', message: 'Choose one: a section, a class, every student or every staff member' },
      ]);
    }
    return this.dataSource.transaction(async (manager) => {
      let keys: PersonKey[];
      if (dto.all_staff) {
        const rows: { user_id: number }[] = await manager.query(
          `SELECT user_id FROM staff WHERE school_id = $1 AND deleted_at IS NULL AND status = 'active'`,
          [schoolId],
        );
        keys = rows.map((row) => ({ user_id: Number(row.user_id) }));
      } else {
        const rows: { id: number }[] = await manager.query(
          `SELECT DISTINCT s.id FROM students s
           JOIN student_enrollments e ON e.student_id = s.id
           JOIN academic_years y ON y.id = e.academic_year_id AND ${yearClause('y')}
           WHERE s.school_id = $1 AND s.deleted_at IS NULL AND s.status = 'active'
             ${dto.section_id ? 'AND e.section_id = $2' : dto.class_id ? 'AND e.class_id = $2' : ''}`,
          dto.section_id ? [schoolId, dto.section_id] : dto.class_id ? [schoolId, dto.class_id] : [schoolId],
        );
        keys = rows.map((row) => ({ student_id: Number(row.id) }));
      }
      let created = 0;
      for (const key of keys) {
        if ((await this.ensureMember(manager, schoolId, key)).created) created += 1;
      }
      return { created, already_members: keys.length - created };
    });
  }

  async update(schoolId: number, id: number, dto: MemberUpdateDto): Promise<MemberDto> {
    await this.member(schoolId, id);
    const fields: Partial<LibraryMember> = {};
    if (dto.status !== undefined) {
      fields.status = dto.status;
      fields.status_reason = dto.status === 'suspended' ? (dto.status_reason ?? null) : null;
    } else if (dto.status_reason !== undefined) {
      fields.status_reason = dto.status_reason;
    }
    if (dto.max_books !== undefined) fields.max_books = dto.max_books;
    if (dto.loan_days !== undefined) fields.loan_days = dto.loan_days;
    if (Object.keys(fields).length) await this.dataSource.getRepository(LibraryMember).update(id, fields);
    return this.member(schoolId, id);
  }

  async personLibrary(schoolId: number, key: { student_id: number } | { staff_id: number }): Promise<PersonLibraryDto> {
    let member: LibraryMember | null;
    let visitWhere: string;
    let visitParam: number;
    if ('student_id' in key) {
      const [student] = await this.dataSource.query(
        `SELECT id FROM students WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
        [key.student_id, schoolId],
      );
      if (!student) throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');
      member = await this.dataSource
        .getRepository(LibraryMember)
        .findOneBy({ school_id: schoolId, student_id: key.student_id });
      visitWhere = 'student_id';
      visitParam = key.student_id;
    } else {
      const [staff]: { user_id: number }[] = await this.dataSource.query(
        `SELECT user_id FROM staff WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
        [key.staff_id, schoolId],
      );
      if (!staff) throw AppException.notFound('Staff member not found', 'STAFF_NOT_FOUND');
      member = await this.dataSource
        .getRepository(LibraryMember)
        .findOneBy({ school_id: schoolId, user_id: Number(staff.user_id) });
      visitWhere = 'user_id';
      visitParam = Number(staff.user_id);
    }
    const [visits]: { count: string }[] = await this.dataSource.query(
      `SELECT COUNT(*) AS count FROM library_visits WHERE school_id = $1 AND ${visitWhere} = $2 AND present
       AND deleted_at IS NULL AND visit_date >= date_trunc('month', $3::date)`,
      [schoolId, visitParam, this.read.today()],
    );
    return this.personView(schoolId, member, Number(visits?.count ?? 0));
  }

  async personLibraryForUser(schoolId: number, userId: number): Promise<PersonLibraryDto> {
    const member = await this.dataSource
      .getRepository(LibraryMember)
      .findOneBy({ school_id: schoolId, user_id: userId });
    const [visits]: { count: string }[] = await this.dataSource.query(
      `SELECT COUNT(*) AS count FROM library_visits WHERE school_id = $1 AND user_id = $2 AND present
       AND deleted_at IS NULL AND visit_date >= date_trunc('month', $3::date)`,
      [schoolId, userId, this.read.today()],
    );
    return this.personView(schoolId, member, Number(visits?.count ?? 0));
  }

  async classOverdue(schoolId: number, sectionIds: number[]): Promise<ClassOverdueDto[]> {
    if (!sectionIds.length) return [];
    const sections: { id: number; name: string }[] = await this.dataSource.query(
      `SELECT sec.id, c.name || ' - ' || sec.name AS name FROM sections sec JOIN classes c ON c.id = sec.class_id
       WHERE sec.id = ANY($1) ORDER BY c.grade_level, sec.name`,
      [sectionIds],
    );
    const filter: SqlFilter = { where: [`i.status = 'issued'`, `i.purpose = 'personal'`], params: [] };
    filter.where.push(`i.due_date < ${param(filter, this.read.today())}::date`);
    filter.where.push(`mme.section_id = ANY(${param(filter, sectionIds)})`);
    const loans = await this.read.loans(schoolId, filter, 'i.due_date');
    return sections.map((section) => ({
      section: { id: Number(section.id), name: section.name },
      loans: loans.filter((loan) => loan.member.detail === section.name),
    }));
  }

  private async classTeacherSection(schoolId: number, sectionId: number, userId: number) {
    const [section]: { id: number; name: string; class_name: string; class_teacher_user_id: number | null }[] =
      await this.dataSource.query(
        `SELECT sec.id, sec.name, c.name AS class_name, sec.class_teacher_user_id FROM sections sec
         JOIN classes c ON c.id = sec.class_id
         JOIN academic_years y ON y.id = sec.academic_year_id AND ${yearClause('y')}
         WHERE sec.id = $1 AND sec.school_id = $2 AND sec.deleted_at IS NULL`,
        [sectionId, schoolId],
      );
    if (!section) throw AppException.notFound('Section not found', 'SECTION_NOT_FOUND');
    if (Number(section.class_teacher_user_id) !== userId) {
      throw AppException.forbidden('Only the class teacher of this section can see its library', 'NOT_CLASS_TEACHER');
    }
    return section;
  }

  async sectionLibrary(schoolId: number, sectionId: number, userId: number): Promise<SectionLibraryDto> {
    const section = await this.classTeacherSection(schoolId, sectionId, userId);
    const students: Row[] = await this.dataSource.query(
      `SELECT s.id, s.first_name || COALESCE(' ' || s.last_name, '') AS full_name, s.admission_no, e.roll_no,
              s.photo_file_id, lm.id AS member_id, lm.card_no,
              (SELECT g.mobile FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
                WHERE sg.student_id = s.id ORDER BY sg.receives_alerts DESC, sg.id LIMIT 1) AS parent_phone,
              (SELECT COALESCE(SUM(f.balance), 0) FROM library_fines f WHERE f.member_id = lm.id AND f.deleted_at IS NULL) AS unpaid_fines
       FROM student_enrollments e
       JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL AND s.status = 'active'
       LEFT JOIN library_members lm ON lm.student_id = s.id AND lm.deleted_at IS NULL
       WHERE e.section_id = $1 AND e.status = 'studying'
       ORDER BY e.roll_no NULLS LAST, s.first_name`,
      [sectionId],
    );
    const memberIds = students
      .map((row) => row.member_id)
      .filter((id) => id !== null)
      .map(Number);
    const filter: SqlFilter = { where: [`i.status = 'issued'`, `i.purpose = 'personal'`], params: [] };
    filter.where.push(`i.member_id = ANY(${param(filter, memberIds.length ? memberIds : [0])})`);
    const loans = await this.read.loans(schoolId, filter, 'i.due_date');
    const rank = { overdue: 0, dues: 1, holding: 2, clear: 3 } as const;
    const rows: SectionLibraryStudentDto[] = students.map((row) => {
      const memberId = row.member_id === null ? null : Number(row.member_id);
      const own = memberId === null ? [] : loans.filter((loan) => loan.member.id === memberId);
      const overdue = own.filter((loan) => loan.state === 'overdue');
      const unpaid = Number(row.unpaid_fines ?? 0);
      const status = overdue.length ? 'overdue' : unpaid > 0 ? 'dues' : own.length ? 'holding' : 'clear';
      return {
        student_id: Number(row.id),
        full_name: String(row.full_name),
        admission_no: String(row.admission_no),
        roll_no: row.roll_no === null ? null : Number(row.roll_no),
        photo_url: this.read.link(row.photo_file_id),
        member_id: memberId,
        card_no: (row.card_no as string | null) ?? null,
        books_held: own.length,
        overdue_books: overdue.length,
        max_days_overdue: Math.max(0, ...own.map((loan) => loan.days_overdue)),
        running_fine: Math.round(own.reduce((sum, loan) => sum + loan.running_fine, 0) * 100) / 100,
        unpaid_fines: unpaid,
        parent_phone: (row.parent_phone as string | null) ?? null,
        status,
        loans: own,
      };
    });
    rows.sort((a, b) => rank[a.status] - rank[b.status] || b.max_days_overdue - a.max_days_overdue);
    const sum = (values: number[]) => Math.round(values.reduce((total, value) => total + value, 0) * 100) / 100;
    return {
      section_id: Number(section.id),
      class_section: `${section.class_name} - ${section.name}`,
      counts: {
        students: rows.length,
        members: rows.filter((row) => row.member_id !== null).length,
        holding: rows.filter((row) => row.books_held > 0).length,
        overdue: rows.filter((row) => row.overdue_books > 0).length,
        with_dues: rows.filter((row) => row.unpaid_fines > 0).length,
      },
      unpaid_fines: sum(rows.map((row) => row.unpaid_fines)),
      running_fines: sum(rows.map((row) => row.running_fine)),
      students: rows,
    };
  }

  async teacherStudentLibrary(schoolId: number, studentId: number, userId: number): Promise<PersonLibraryDto> {
    const [enrollment]: { section_id: number }[] = await this.dataSource.query(
      `SELECT e.section_id FROM student_enrollments e
       JOIN sections sec ON sec.id = e.section_id
       JOIN academic_years y ON y.id = sec.academic_year_id AND ${yearClause('y')}
       JOIN students s ON s.id = e.student_id AND s.school_id = $2 AND s.deleted_at IS NULL
       WHERE e.student_id = $1 ORDER BY e.id DESC LIMIT 1`,
      [studentId, schoolId],
    );
    if (!enrollment) throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');
    await this.classTeacherSection(schoolId, Number(enrollment.section_id), userId);
    return this.personLibrary(schoolId, { student_id: studentId });
  }

  async personView(schoolId: number, member: LibraryMember | null, visitsThisMonth: number): Promise<PersonLibraryDto> {
    const rules = await this.settings.rules(schoolId);
    if (!member) {
      return {
        member: null,
        status: null,
        max_books: rules.student_max_books,
        books_left: rules.student_max_books,
        loans: [],
        fines: [],
        unpaid_fines: 0,
        history: [],
        total_loans: 0,
        visits_this_month: visitsThisMonth,
      };
    }
    const summary = await this.summary(schoolId, member.id);
    const historyFilter: SqlFilter = { where: [], params: [] };
    historyFilter.where.push(`i.member_id = ${param(historyFilter, member.id)}`, `i.status <> 'issued'`);
    const history = await this.read.loans(schoolId, historyFilter, 'COALESCE(i.returned_at, i.issued_at) DESC', 20);
    return {
      member: {
        id: summary.member.id,
        member_type: summary.member.member_type,
        card_no: summary.member.card_no,
        name: summary.member.name,
        detail: summary.member.detail,
        student_id: summary.member.student?.id ?? null,
        user_id: summary.member.staff?.user_id ?? null,
        photo_url: summary.member.photo_url,
        phone: summary.member.phone,
      },
      status: summary.member.status,
      max_books: summary.member.max_books,
      books_left: summary.books_left,
      loans: summary.loans,
      fines: summary.fines,
      unpaid_fines: summary.member.unpaid_fines,
      history,
      total_loans: summary.member.total_loans,
      visits_this_month: visitsThisMonth,
    };
  }
}
