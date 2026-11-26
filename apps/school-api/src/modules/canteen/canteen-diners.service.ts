import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppException, AuthUser, escapeLike, paginate, Paginated, searchTerms } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { yearClause } from '../../shared/year-context';
import { QrTokens } from '../security/qr-tokens';
import { cardNoFor, cardRefusal } from './canteen-sales.logic';
import { loadSalesSettings } from './canteen-wallet.service';
import {
  CardBlockDto,
  CardLookupQueryDto,
  DinerDetailDto,
  DinerDto,
  DinerInputDto,
  DinerInsightsDto,
  DinerQueryDto,
  DinerStatusDto,
  DinerUpdateDto,
  RecentOrderDto,
} from './dto/canteen-sales.dto';

type Row = Record<string, unknown>;

const SORTS: Record<string, string> = {
  created_at: 'd.created_at',
  name: 'person_name',
  card_no: 'd.card_no',
  wallet_balance: 'd.wallet_balance',
};

const FROM = `FROM canteen_diners d
  LEFT JOIN students s ON s.id = d.student_id
  LEFT JOIN staff st ON st.id = d.staff_id
  LEFT JOIN users u ON u.id = st.user_id
  LEFT JOIN academic_years ay ON ay.school_id = d.school_id AND ${yearClause('ay')}
  LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = ay.id
  LEFT JOIN classes c ON c.id = e.class_id
  LEFT JOIN sections sec ON sec.id = e.section_id`;

const COLUMNS = `d.*,
  COALESCE(NULLIF(TRIM(CONCAT(s.first_name, ' ', s.last_name)), ''), u.name) AS person_name,
  s.admission_no, st.employee_no, c.name AS class_name, sec.name AS section_name`;

const numOrNull = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));
const strOrNull = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));

function presentDiner(row: Row): DinerDto {
  return {
    id: Number(row.id),
    person_type: row.person_type as DinerDto['person_type'],
    student_id: numOrNull(row.student_id),
    staff_id: numOrNull(row.staff_id),
    person: {
      id: Number(row.student_id ?? row.staff_id),
      name: String(row.person_name ?? ''),
      admission_no: strOrNull(row.admission_no),
      employee_no: strOrNull(row.employee_no),
      class_name: strOrNull(row.class_name),
      section_name: strOrNull(row.section_name),
    },
    card_no: String(row.card_no),
    card_status: row.card_status as DinerDto['card_status'],
    card_version: Number(row.card_version),
    card_issued_at: (row.card_issued_at as Date | null) ?? null,
    wallet_balance: Number(row.wallet_balance),
    daily_limit: numOrNull(row.daily_limit),
    diet: row.diet as DinerDto['diet'],
    allergies: strOrNull(row.allergies),
    meal_slots: strOrNull(row.meal_slots),
    status: row.status as DinerDto['status'],
    notes: strOrNull(row.notes),
  };
}

@Injectable()
export class CanteenDinersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly qr: QrTokens,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async create(schoolId: number, dto: DinerInputDto, actor: AuthUser): Promise<DinerDetailDto> {
    const isStudent = dto.person_type === 'student';
    const personId = isStudent ? dto.student_id! : dto.staff_id!;
    const [person] = await this.dataSource.query(
      isStudent
        ? `SELECT id FROM students WHERE school_id = $1 AND id = $2 AND deleted_at IS NULL`
        : `SELECT id FROM staff WHERE school_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [schoolId, personId],
    );
    if (!person) {
      throw isStudent
        ? AppException.notFound('Student not found', 'STUDENT_NOT_FOUND')
        : AppException.notFound('Staff member not found', 'STAFF_NOT_FOUND');
    }
    const [existing] = await this.dataSource.query(
      `SELECT id FROM canteen_diners WHERE school_id = $1 AND deleted_at IS NULL AND ${
        isStudent ? 'student_id' : 'staff_id'
      } = $2`,
      [schoolId, personId],
    );
    if (existing) throw AppException.conflict('This person is already enrolled', 'DINER_EXISTS');
    const id = await this.dataSource.transaction(async (manager) => {
      const rows: Row[] = await manager.query(
        `INSERT INTO canteen_diners (school_id, person_type, student_id, staff_id, card_no, card_issued_at, diet,
           allergies, meal_slots, daily_limit, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, now(), $6, $7, $8, $9, $10, $11) RETURNING id`,
        [
          schoolId,
          dto.person_type,
          isStudent ? personId : null,
          isStudent ? null : personId,
          `TMP${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 20),
          dto.diet ?? 'veg',
          dto.allergies ?? null,
          dto.meal_slots ?? null,
          dto.daily_limit ?? null,
          dto.notes ?? null,
          actor.id,
        ],
      );
      const dinerId = Number(rows[0]!.id);
      await manager.query(`UPDATE canteen_diners SET card_no = $1 WHERE id = $2`, [cardNoFor(dinerId), dinerId]);
      if (dto.daily_limit === undefined) {
        await manager.query(
          `UPDATE canteen_diners d SET daily_limit = cs.default_daily_limit
           FROM canteen_settings cs WHERE d.id = $1 AND cs.school_id = d.school_id`,
          [dinerId],
        );
      }
      return dinerId;
    });
    return this.get(schoolId, id);
  }

  async list(schoolId: number, query: DinerQueryDto): Promise<Paginated<DinerDto>> {
    const params: unknown[] = [schoolId];
    const where = ['d.school_id = $1', 'd.deleted_at IS NULL'];
    const add = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };
    if (query.person_type) where.push(`d.person_type = ${add(query.person_type)}`);
    if (query.status) where.push(`d.status = ${add(query.status)}`);
    if (query.card_status) where.push(`d.card_status = ${add(query.card_status)}`);
    if (query.diet) where.push(`d.diet = ${add(query.diet)}`);
    if (query.class_id) where.push(`e.class_id = ${add(query.class_id)}`);
    for (const term of searchTerms(query.search)) {
      const key = add(`%${escapeLike(term)}%`);
      where.push(
        `(s.first_name ILIKE ${key} OR s.last_name ILIKE ${key} OR s.admission_no ILIKE ${key} OR u.name ILIKE ${key}
          OR st.employee_no ILIKE ${key} OR d.card_no ILIKE ${key})`,
      );
    }
    const column = SORTS[query.sort ?? 'created_at'];
    if (!column) {
      throw AppException.badRequest(`sort must be one of: ${Object.keys(SORTS).join(', ')}`, 'INVALID_SORT');
    }
    const clause = where.join(' AND ');
    const [count] = await this.dataSource.query(`SELECT COUNT(DISTINCT d.id) AS total ${FROM} WHERE ${clause}`, params);
    const rows: Row[] = await this.dataSource.query(
      `SELECT * FROM (SELECT DISTINCT ON (d.id) ${COLUMNS} ${FROM} WHERE ${clause} ORDER BY d.id) d
       ORDER BY ${column} ${query.order === 'asc' ? 'ASC' : 'DESC'}, d.id DESC
       LIMIT ${add(query.limit)} OFFSET ${add((query.page - 1) * query.limit)}`,
      params,
    );
    return paginate([rows.map(presentDiner), Number(count.total)], query.page, query.limit);
  }

  async insights(schoolId: number): Promise<DinerInsightsDto> {
    const settings = await loadSalesSettings(this.dataSource.manager, schoolId);
    const [row] = await this.dataSource.query(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE person_type = 'student') AS students,
              COUNT(*) FILTER (WHERE person_type = 'staff') AS staff,
              COUNT(*) FILTER (WHERE status = 'active') AS active,
              COUNT(*) FILTER (WHERE card_status IN ('blocked', 'lost')) AS blocked_cards,
              COUNT(*) FILTER (WHERE status = 'active' AND wallet_balance <= $2) AS low_balance
       FROM canteen_diners WHERE school_id = $1 AND deleted_at IS NULL`,
      [schoolId, settings.low_balance_limit],
    );
    return {
      total: Number(row.total),
      students: Number(row.students),
      staff: Number(row.staff),
      active: Number(row.active),
      blocked_cards: Number(row.blocked_cards),
      low_balance: Number(row.low_balance),
    };
  }

  private async findRow(schoolId: number, condition: string, value: unknown): Promise<Row | null> {
    const [row] = await this.dataSource.query(
      `SELECT DISTINCT ON (d.id) ${COLUMNS} ${FROM}
       WHERE d.school_id = $1 AND d.deleted_at IS NULL AND ${condition} ORDER BY d.id`,
      [schoolId, value],
    );
    return row ?? null;
  }

  async get(schoolId: number, id: number): Promise<DinerDetailDto> {
    const row = await this.findRow(schoolId, 'd.id = $2', id);
    if (!row) throw AppException.notFound('Diner not found', 'DINER_NOT_FOUND');
    return this.detail(schoolId, row);
  }

  private async detail(schoolId: number, row: Row): Promise<DinerDetailDto> {
    const today = todayIn(this.app.timeZone);
    const [spend] = await this.dataSource.query(
      `SELECT COALESCE(SUM(total_amount), 0) AS spend FROM canteen_orders
       WHERE school_id = $1 AND diner_id = $2 AND order_date = $3::date AND status <> 'cancelled' AND deleted_at IS NULL`,
      [schoolId, row.id, today],
    );
    const orders: Row[] = await this.dataSource.query(
      `SELECT id, order_no, token_label, order_date, status, total_amount, payment_status FROM canteen_orders
       WHERE school_id = $1 AND diner_id = $2 AND deleted_at IS NULL ORDER BY id DESC LIMIT 5`,
      [schoolId, row.id],
    );
    const recent: RecentOrderDto[] = orders.map((order) => ({
      id: Number(order.id),
      order_no: String(order.order_no),
      token_label: String(order.token_label),
      order_date:
        typeof order.order_date === 'string' ? order.order_date : (order.order_date as Date).toISOString().slice(0, 10),
      status: order.status as RecentOrderDto['status'],
      total_amount: Number(order.total_amount),
      payment_status: order.payment_status as RecentOrderDto['payment_status'],
    }));
    return { ...presentDiner(row), today_spend: Number(spend.spend), recent_orders: recent };
  }

  async update(schoolId: number, id: number, dto: DinerUpdateDto): Promise<DinerDetailDto> {
    await this.mustExist(schoolId, id);
    const changes = Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined));
    if (Object.keys(changes).length > 0) {
      await this.dataSource
        .createQueryBuilder()
        .update('canteen_diners')
        .set({ ...changes, updated_at: () => 'now()' })
        .where('school_id = :schoolId AND id = :id', { schoolId, id })
        .execute();
    }
    return this.get(schoolId, id);
  }

  async setStatus(schoolId: number, id: number, dto: DinerStatusDto): Promise<DinerDetailDto> {
    await this.mustExist(schoolId, id);
    await this.dataSource.query(
      `UPDATE canteen_diners SET status = $3, updated_at = now() WHERE school_id = $1 AND id = $2`,
      [schoolId, id, dto.status],
    );
    return this.get(schoolId, id);
  }

  async replaceCard(schoolId: number, id: number): Promise<DinerDetailDto> {
    await this.mustExist(schoolId, id);
    await this.dataSource.query(
      `UPDATE canteen_diners SET card_version = card_version + 1,
         card_no = $3 || 'V' || (card_version + 1), card_status = 'active', card_issued_at = now(), updated_at = now()
       WHERE school_id = $1 AND id = $2`,
      [schoolId, id, cardNoFor(id)],
    );
    return this.get(schoolId, id);
  }

  async blockCard(schoolId: number, id: number, dto: CardBlockDto): Promise<DinerDetailDto> {
    await this.mustExist(schoolId, id);
    await this.dataSource.query(
      `UPDATE canteen_diners SET card_status = $3, notes = LEFT(COALESCE(notes || ' | ', '') || $4, 300), updated_at = now()
       WHERE school_id = $1 AND id = $2`,
      [schoolId, id, dto.card_status ?? 'blocked', `Card: ${dto.reason}`],
    );
    return this.get(schoolId, id);
  }

  async unblockCard(schoolId: number, id: number): Promise<DinerDetailDto> {
    await this.mustExist(schoolId, id);
    await this.dataSource.query(
      `UPDATE canteen_diners SET card_status = 'active', updated_at = now() WHERE school_id = $1 AND id = $2`,
      [schoolId, id],
    );
    return this.get(schoolId, id);
  }

  async lookup(schoolId: number, query: CardLookupQueryDto): Promise<DinerDetailDto> {
    if (!query.card_no && !query.qr) {
      throw AppException.badRequest('Give a card_no or a qr', 'CARD_LOOKUP_EMPTY');
    }
    const row = query.qr ? await this.byQr(schoolId, query.qr) : await this.byCard(schoolId, query.card_no!);
    const refusal = cardRefusal(String(row.card_status), String(row.status));
    if (refusal) throw AppException.conflict(refusal.message, refusal.code);
    return this.detail(schoolId, row);
  }

  private async byCard(schoolId: number, cardNo: string): Promise<Row> {
    const row = await this.findRow(schoolId, 'd.card_no = $2', cardNo.toUpperCase());
    if (!row) throw AppException.notFound('No meal card with this number', 'CARD_NOT_FOUND');
    return row;
  }

  private async byQr(schoolId: number, token: string): Promise<Row> {
    const parsed = this.qr.readStudent(token);
    if (!parsed) throw AppException.badRequest('This is not a valid student ID card QR', 'CARD_QR_INVALID');
    const [student] = await this.dataSource.query(
      `SELECT card_version FROM students WHERE school_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [schoolId, parsed.student_id],
    );
    if (!student) throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');
    if (Number(student.card_version) !== parsed.version) {
      throw AppException.conflict('This ID card was replaced. Use the new card.', 'CARD_NOT_ACTIVE');
    }
    const row = await this.findRow(schoolId, 'd.student_id = $2', parsed.student_id);
    if (!row) throw AppException.notFound('This student is not enrolled for canteen meals', 'DINER_NOT_FOUND');
    return row;
  }

  private async mustExist(schoolId: number, id: number): Promise<void> {
    const [row] = await this.dataSource.query(
      `SELECT id FROM canteen_diners WHERE school_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [schoolId, id],
    );
    if (!row) throw AppException.notFound('Diner not found', 'DINER_NOT_FOUND');
  }
}
