import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AppException, AuthUser, Paginated, paginate } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { PERMISSIONS } from '../access/access.catalog';
import { HOSTEL_TEMPLATES } from '../notifications/hostel-templates.catalog';
import {
  DateRangeQueryDto,
  DutyReportQueryDto,
  DutyReportRowDto,
  DutyShiftDto,
  DutyShiftInputDto,
  DutyShiftPatchDto,
  DutyShiftQueryDto,
  NightRoundDto,
  NightRoundInputDto,
  RosterInputDto,
  RosterQueryDto,
  RosterRowDto,
  RoundQueryDto,
  SwapDto,
  SwapInputDto,
  SwapQueryDto,
} from './dto/hostel-duty.dto';
import {
  HostelDutyRoster,
  HostelDutyShift,
  HostelDutySwap,
  HostelNightRound,
  RosterStatus,
} from './entities/hostel-duty.entity';
import { HostelAuditService } from './hostel-audit.service';
import { checkRange, ensurePlace, HostelPlace, sortColumn, staffNames } from './hostel-duty-checks';
import {
  averageOf,
  CHECK_IN_EARLY_MINUTES,
  checkInWindow,
  crossesMidnight,
  dateRange,
  duplicateKeys,
  MAX_REPORT_DAYS,
  MAX_ROSTER_DAYS,
  shiftBounds,
} from './hostel-duty.logic';
import { HostelNotifyService } from './hostel-notify.service';
import { addDays, lateMinutes } from './hostel.logic';

const SWAP_SORTS: Record<string, string> = { created_at: 'sw.created_at' };

interface RosterFilter {
  ids?: number[];
  hostel_id?: number;
  user_id?: number;
  from?: string;
  to?: string;
  running_on?: string;
}

@Injectable()
export class HostelDutyService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly notify: HostelNotifyService,
    private readonly audit: HostelAuditService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async shifts(schoolId: number, query: DutyShiftQueryDto): Promise<DutyShiftDto[]> {
    const rows = await this.dataSource.manager.find(HostelDutyShift, {
      where: { school_id: schoolId, ...(query.active === undefined ? {} : { active: query.active }) },
      order: { start_time: 'ASC', id: 'ASC' },
    });
    return rows.map((row) => this.toShift(row));
  }

  async createShift(schoolId: number, dto: DutyShiftInputDto, actor: AuthUser): Promise<DutyShiftDto> {
    this.checkShiftTimes(dto.start_time, dto.end_time);
    await this.ensureShiftName(schoolId, dto.name);
    const shift = await this.dataSource.manager.save(
      this.dataSource.manager.create(HostelDutyShift, {
        school_id: schoolId,
        name: dto.name,
        start_time: dto.start_time,
        end_time: dto.end_time,
        is_night: dto.is_night ?? crossesMidnight(dto.start_time, dto.end_time),
        active: dto.active ?? true,
        created_by: actor.id,
      }),
    );
    return this.toShift(shift);
  }

  async updateShift(schoolId: number, id: number, dto: DutyShiftPatchDto): Promise<DutyShiftDto> {
    const shift = await this.shift(schoolId, id);
    if (dto.name && dto.name.toLowerCase() !== shift.name.toLowerCase()) await this.ensureShiftName(schoolId, dto.name);
    const start = dto.start_time ?? shift.start_time;
    const end = dto.end_time ?? shift.end_time;
    this.checkShiftTimes(start, end);
    Object.assign(shift, {
      name: dto.name ?? shift.name,
      start_time: start,
      end_time: end,
      is_night: dto.is_night ?? (dto.start_time || dto.end_time ? crossesMidnight(start, end) : shift.is_night),
      active: dto.active ?? shift.active,
    });
    return this.toShift(await this.dataSource.manager.save(shift));
  }

  async deleteShift(schoolId: number, id: number): Promise<void> {
    const shift = await this.shift(schoolId, id);
    const [used] = await this.dataSource.query(
      `SELECT 1 FROM hostel_duty_roster WHERE school_id = $1 AND shift_id = $2 AND deleted_at IS NULL AND duty_date >= $3 LIMIT 1`,
      [schoolId, id, this.today()],
    );
    if (used) {
      throw AppException.conflict(
        'This shift is on the roster for today or later. Remove those duties or turn the shift off.',
        'HOSTEL_SHIFT_IN_USE',
      );
    }
    await this.dataSource.manager.softDelete(HostelDutyShift, { id: shift.id });
  }

  async roster(schoolId: number, query: RosterQueryDto): Promise<RosterRowDto[]> {
    const range = dateRange(query.from, query.to, this.today(), 7);
    checkRange(range.from, range.to, MAX_ROSTER_DAYS);
    return this.rosterRows(schoolId, { ...range, hostel_id: query.hostel_id, user_id: query.user_id });
  }

  async mine(schoolId: number, actor: AuthUser, query: DateRangeQueryDto): Promise<RosterRowDto[]> {
    const range = dateRange(query.from, query.to, this.today(), 14);
    checkRange(range.from, range.to, MAX_ROSTER_DAYS);
    return this.rosterRows(schoolId, { ...range, user_id: actor.id });
  }

  async todayBoard(schoolId: number, hostelId?: number): Promise<RosterRowDto[]> {
    return this.rosterRows(schoolId, { running_on: this.today(), hostel_id: hostelId });
  }

  async addRoster(schoolId: number, dto: RosterInputDto, actor: AuthUser): Promise<RosterRowDto[]> {
    const today = this.today();
    const past = dto.entries.findIndex((entry) => entry.duty_date < today);
    if (past >= 0) {
      throw AppException.validation([{ field: `entries.${past}.duty_date`, message: 'Cannot be in the past' }]);
    }
    const repeated = duplicateKeys(dto.entries, (entry) => `${entry.user_id}|${entry.duty_date}|${entry.shift_id}`);
    if (repeated.length) {
      throw AppException.conflict('The same person is on the same shift twice in this list', 'HOSTEL_DUTY_CLASH');
    }
    const { ids, shifts, places } = await this.dataSource.transaction(async (manager) => {
      const shiftMap = await this.activeShifts(
        manager,
        schoolId,
        dto.entries.map((entry) => entry.shift_id),
      );
      await staffNames(
        manager,
        schoolId,
        dto.entries.map((entry) => entry.user_id),
        'entries',
      );
      const placeMap = new Map<string, HostelPlace>();
      for (const entry of dto.entries) {
        const key = `${entry.hostel_id}|${entry.block_id ?? ''}`;
        if (!placeMap.has(key))
          placeMap.set(key, await ensurePlace(manager, schoolId, entry.hostel_id, entry.block_id));
      }
      const clashes: { user_name: string; duty_date: string; shift_name: string }[] = await manager.query(
        `SELECT u.name AS user_name, d.duty_date::text AS duty_date, sh.name AS shift_name
         FROM hostel_duty_roster d
         JOIN unnest($2::int[], $3::date[], $4::int[]) AS x(user_id, duty_date, shift_id)
           ON x.user_id = d.user_id AND x.duty_date = d.duty_date AND x.shift_id = d.shift_id
         JOIN users u ON u.id = d.user_id
         JOIN hostel_duty_shifts sh ON sh.id = d.shift_id
         WHERE d.school_id = $1 AND d.deleted_at IS NULL
         LIMIT 5`,
        [
          schoolId,
          dto.entries.map((entry) => entry.user_id),
          dto.entries.map((entry) => entry.duty_date),
          dto.entries.map((entry) => entry.shift_id),
        ],
      );
      if (clashes.length) {
        const list = clashes.map((row) => `${row.user_name} (${row.shift_name}, ${row.duty_date})`).join(', ');
        throw AppException.conflict(`Already on the roster: ${list}`, 'HOSTEL_DUTY_CLASH');
      }
      const saved = await manager.save(
        dto.entries.map((entry) =>
          manager.create(HostelDutyRoster, {
            school_id: schoolId,
            hostel_id: entry.hostel_id,
            block_id: entry.block_id ?? null,
            duty_date: entry.duty_date,
            shift_id: entry.shift_id,
            user_id: entry.user_id,
            note: entry.note ?? null,
            status: 'scheduled',
            created_by: actor.id,
          }),
        ),
      );
      for (const row of saved) {
        await this.audit.record(manager, schoolId, actor, {
          entity: 'duty_roster',
          entity_id: row.id,
          action: 'create',
          changes: { user_id: row.user_id, duty_date: row.duty_date, shift_id: row.shift_id, hostel_id: row.hostel_id },
        });
      }
      return { ids: saved.map((row) => row.id), shifts: shiftMap, places: placeMap };
    });
    for (const entry of dto.entries) {
      const shift = shifts.get(entry.shift_id)!;
      const place = places.get(`${entry.hostel_id}|${entry.block_id ?? ''}`)!;
      await this.notify.tellUsers([entry.user_id], HOSTEL_TEMPLATES.HOSTEL_DUTY_ASSIGNED, {
        shift: shift.name,
        date: entry.duty_date,
        time: `${shift.start_time} - ${shift.end_time}`,
        hostel: place.block_name ? `${place.hostel_name} · ${place.block_name}` : place.hostel_name,
      });
    }
    return this.rosterRows(schoolId, { ids });
  }

  async removeDuty(schoolId: number, id: number, actor: AuthUser): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const row = await this.lockDuty(manager, schoolId, id);
      this.expectStatus(row, ['scheduled']);
      await this.closeSwaps(manager, row.id, 'cancelled', actor);
      await manager.softDelete(HostelDutyRoster, { id: row.id });
      await this.audit.record(manager, schoolId, actor, {
        entity: 'duty_roster',
        entity_id: row.id,
        action: 'delete',
        changes: { user_id: row.user_id, duty_date: row.duty_date, shift_id: row.shift_id },
      });
    });
  }

  async markAbsent(schoolId: number, id: number, actor: AuthUser): Promise<RosterRowDto> {
    await this.dataSource.transaction(async (manager) => {
      const row = await this.lockDuty(manager, schoolId, id);
      this.expectStatus(row, ['scheduled']);
      if (row.duty_date > this.today()) {
        throw AppException.conflict('This duty is on a later day', 'HOSTEL_DUTY_NOT_STARTED');
      }
      row.status = 'absent';
      await manager.save(row);
      await this.closeSwaps(manager, row.id, 'cancelled', actor);
      await this.audit.record(manager, schoolId, actor, {
        entity: 'duty_roster',
        entity_id: row.id,
        action: 'absent',
        changes: { user_id: row.user_id, duty_date: row.duty_date },
      });
    });
    return this.rosterRow(schoolId, id);
  }

  async checkIn(schoolId: number, id: number, actor: AuthUser): Promise<RosterRowDto> {
    await this.dataSource.transaction(async (manager) => {
      const row = await this.lockOwnDuty(manager, schoolId, id, actor);
      if (row.status === 'checked_in') throw AppException.conflict('You have already checked in', 'HOSTEL_DUTY_STATE');
      this.expectStatus(row, ['scheduled']);
      const shift = await manager.findOneOrFail(HostelDutyShift, { where: { id: row.shift_id }, withDeleted: true });
      const bounds = shiftBounds(row.duty_date, shift.start_time, shift.end_time, this.app.timeZone);
      const now = new Date();
      const window = checkInWindow(bounds, now);
      if (window === 'too_early') {
        throw AppException.conflict(
          `Check-in opens ${CHECK_IN_EARLY_MINUTES} minutes before the shift starts at ${shift.start_time}`,
          'HOSTEL_DUTY_TOO_EARLY',
        );
      }
      if (window === 'over') throw AppException.conflict('This shift has ended', 'HOSTEL_DUTY_OVER');
      Object.assign(row, { status: 'checked_in', check_in_at: now, late_minutes: lateMinutes(bounds.start, now) });
      await manager.save(row);
      await this.closeSwaps(manager, row.id, 'cancelled', actor);
      await this.audit.record(manager, schoolId, actor, {
        entity: 'duty_roster',
        entity_id: row.id,
        action: 'check_in',
        changes: { late_minutes: row.late_minutes },
      });
    });
    return this.rosterRow(schoolId, id);
  }

  async checkOut(schoolId: number, id: number, actor: AuthUser): Promise<RosterRowDto> {
    await this.dataSource.transaction(async (manager) => {
      const row = await this.lockOwnDuty(manager, schoolId, id, actor);
      this.expectStatus(row, ['checked_in']);
      Object.assign(row, { status: 'completed', check_out_at: new Date() });
      await manager.save(row);
      await this.audit.record(manager, schoolId, actor, {
        entity: 'duty_roster',
        entity_id: row.id,
        action: 'check_out',
      });
    });
    return this.rosterRow(schoolId, id);
  }

  async requestSwap(schoolId: number, id: number, dto: SwapInputDto, actor: AuthUser): Promise<SwapDto> {
    if (dto.to_user_id === actor.id) {
      throw AppException.validation([{ field: 'to_user_id', message: 'Choose someone else to take this duty' }]);
    }
    const swapId = await this.dataSource.transaction(async (manager) => {
      const row = await this.lockOwnDuty(manager, schoolId, id, actor);
      this.expectStatus(row, ['scheduled']);
      if (row.duty_date < this.today()) throw AppException.conflict('This duty is over', 'HOSTEL_DUTY_OVER');
      await staffNames(manager, schoolId, [dto.to_user_id], 'to_user_id');
      const [pending] = await manager.query(
        `SELECT 1 FROM hostel_duty_swaps WHERE roster_id = $1 AND status = 'pending' AND deleted_at IS NULL`,
        [row.id],
      );
      if (pending) throw AppException.conflict('A swap is already waiting for approval', 'HOSTEL_SWAP_PENDING');
      await this.ensureFree(manager, schoolId, dto.to_user_id, row);
      const swap = await manager.save(
        manager.create(HostelDutySwap, {
          school_id: schoolId,
          roster_id: row.id,
          from_user_id: actor.id,
          to_user_id: dto.to_user_id,
          reason: dto.reason ?? null,
          status: 'pending',
          created_by: actor.id,
        }),
      );
      await this.audit.record(manager, schoolId, actor, {
        entity: 'duty_swap',
        entity_id: swap.id,
        action: 'request',
        changes: { roster_id: row.id, to_user_id: dto.to_user_id },
        note: dto.reason ?? null,
      });
      return swap.id;
    });
    const swap = await this.swap(schoolId, swapId);
    await this.notify.tellUsers([dto.to_user_id], HOSTEL_TEMPLATES.HOSTEL_SWAP_REQUEST, {
      from: actor.name,
      shift: swap.shift_name,
      date: swap.duty_date,
      swap_id: swap.id,
    });
    return swap;
  }

  async swaps(schoolId: number, query: SwapQueryDto, actor: AuthUser): Promise<Paginated<SwapDto>> {
    const sort = sortColumn(SWAP_SORTS, query.sort ?? 'created_at');
    const params: unknown[] = [schoolId];
    const where = ['sw.school_id = $1', 'sw.deleted_at IS NULL'];
    if (query.status) where.push(`sw.status = $${params.push(query.status)}`);
    if (query.mine || !actor.permissions.includes(PERMISSIONS.HOSTEL_STAFF_DUTY)) {
      const slot = `$${params.push(actor.id)}`;
      where.push(`(sw.from_user_id = ${slot} OR sw.to_user_id = ${slot})`);
    }
    const from = `${this.swapFrom()} WHERE ${where.join(' AND ')}`;
    const [{ total }] = await this.dataSource.query(`SELECT COUNT(*)::int AS total ${from}`, params);
    const order = query.order === 'asc' ? 'ASC' : 'DESC';
    const rows: SwapDto[] = await this.dataSource.query(
      `SELECT ${this.swapColumns()} ${from} ORDER BY ${sort} ${order}, sw.id ${order}
       LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      params,
    );
    return paginate([rows, total], query.page, query.limit);
  }

  async decideSwap(schoolId: number, id: number, approve: boolean, actor: AuthUser): Promise<SwapDto> {
    const moved = await this.dataSource.transaction(async (manager) => {
      const swap = await this.lockSwap(manager, schoolId, id);
      if (!approve) {
        Object.assign(swap, { status: 'rejected', decided_by: actor.id, decided_at: new Date() });
        await manager.save(swap);
        await this.audit.record(manager, schoolId, actor, {
          entity: 'duty_swap',
          entity_id: swap.id,
          action: 'reject',
        });
        return null;
      }
      const row = await this.lockDuty(manager, schoolId, swap.roster_id);
      if (row.status !== 'scheduled' || row.user_id !== swap.from_user_id) {
        throw AppException.conflict('This duty has changed since the swap was asked for', 'HOSTEL_SWAP_STATE');
      }
      if (row.duty_date < this.today()) throw AppException.conflict('This duty is over', 'HOSTEL_DUTY_OVER');
      await staffNames(manager, schoolId, [swap.to_user_id], 'to_user_id');
      await this.ensureFree(manager, schoolId, swap.to_user_id, row);
      row.user_id = swap.to_user_id;
      await manager.save(row);
      Object.assign(swap, { status: 'approved', decided_by: actor.id, decided_at: new Date() });
      await manager.save(swap);
      await this.audit.record(manager, schoolId, actor, {
        entity: 'duty_swap',
        entity_id: swap.id,
        action: 'approve',
        changes: { roster_id: row.id, from_user_id: swap.from_user_id, to_user_id: swap.to_user_id },
      });
      return row;
    });
    if (moved) {
      const [duty] = await this.rosterRows(schoolId, { ids: [moved.id] });
      if (duty) {
        await this.notify.tellUsers([moved.user_id], HOSTEL_TEMPLATES.HOSTEL_DUTY_ASSIGNED, {
          shift: duty.shift_name,
          date: duty.duty_date,
          time: `${duty.start_time} - ${duty.end_time}`,
          hostel: duty.block_name ? `${duty.hostel_name} · ${duty.block_name}` : duty.hostel_name,
        });
      }
    }
    return this.swap(schoolId, id);
  }

  async cancelSwap(schoolId: number, id: number, actor: AuthUser): Promise<SwapDto> {
    await this.dataSource.transaction(async (manager) => {
      const swap = await this.lockSwap(manager, schoolId, id);
      if (swap.from_user_id !== actor.id) {
        throw AppException.forbidden('Only the person who asked can cancel this swap', 'HOSTEL_SWAP_NOT_YOURS');
      }
      Object.assign(swap, { status: 'cancelled', decided_by: actor.id, decided_at: new Date() });
      await manager.save(swap);
      await this.audit.record(manager, schoolId, actor, {
        entity: 'duty_swap',
        entity_id: swap.id,
        action: 'cancel',
      });
    });
    return this.swap(schoolId, id);
  }

  async addRound(schoolId: number, dto: NightRoundInputDto, actor: AuthUser): Promise<NightRoundDto> {
    if (!dto.all_ok && !dto.issues) {
      throw AppException.validation([{ field: 'issues', message: 'Say what was wrong' }]);
    }
    await ensurePlace(this.dataSource.manager, schoolId, dto.hostel_id, dto.block_id);
    const round = await this.dataSource.manager.save(
      this.dataSource.manager.create(HostelNightRound, {
        school_id: schoolId,
        hostel_id: dto.hostel_id,
        block_id: dto.block_id ?? null,
        user_id: actor.id,
        round_at: new Date(),
        all_ok: dto.all_ok,
        issues: dto.issues ?? null,
      }),
    );
    const [row] = await this.roundRows(schoolId, 'n.id = $2', [round.id]);
    return row;
  }

  async rounds(schoolId: number, query: RoundQueryDto): Promise<NightRoundDto[]> {
    const params: unknown[] = [query.date ?? this.today(), this.app.timeZone];
    const where = [`(n.round_at AT TIME ZONE $3)::date = $2`];
    if (query.hostel_id) where.push(`n.hostel_id = $${params.push(query.hostel_id) + 1}`);
    return this.roundRows(schoolId, where.join(' AND '), params);
  }

  async report(schoolId: number, query: DutyReportQueryDto): Promise<DutyReportRowDto[]> {
    const today = this.today();
    const to = query.to ?? today;
    const from = query.from ?? addDays(to, -29);
    checkRange(from, to, MAX_REPORT_DAYS);
    const params: unknown[] = [schoolId, from, to, today];
    const hostel = query.hostel_id ? `AND d.hostel_id = $${params.push(query.hostel_id)}` : '';
    const rows: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT d.user_id, u.name AS user_name,
         COUNT(*)::int AS scheduled,
         COUNT(*) FILTER (WHERE d.status IN ('checked_in', 'completed'))::int AS attended,
         COUNT(*) FILTER (WHERE d.late_minutes > 0)::int AS late,
         COUNT(*) FILTER (WHERE d.status = 'absent' OR (d.status = 'scheduled' AND d.duty_date < $4))::int AS absent,
         COALESCE(SUM(d.late_minutes) FILTER (WHERE d.late_minutes > 0), 0)::int AS late_total
       FROM hostel_duty_roster d
       JOIN users u ON u.id = d.user_id
       WHERE d.school_id = $1 AND d.deleted_at IS NULL AND d.duty_date BETWEEN $2 AND $3 ${hostel}
       GROUP BY d.user_id, u.name
       ORDER BY u.name, d.user_id`,
      params,
    );
    return rows.map((row) => ({
      user_id: Number(row.user_id),
      user_name: row.user_name as string,
      scheduled: Number(row.scheduled),
      attended: Number(row.attended),
      late: Number(row.late),
      absent: Number(row.absent),
      average_late_minutes: averageOf(Number(row.late_total), Number(row.late)),
    }));
  }

  today(): string {
    return todayIn(this.app.timeZone);
  }

  private async rosterRow(schoolId: number, id: number): Promise<RosterRowDto> {
    const [row] = await this.rosterRows(schoolId, { ids: [id] });
    if (!row) throw AppException.notFound('Duty not found', 'HOSTEL_DUTY_NOT_FOUND');
    return row;
  }

  private async rosterRows(schoolId: number, filter: RosterFilter): Promise<RosterRowDto[]> {
    const params: unknown[] = [schoolId];
    const where = ['d.school_id = $1', 'd.deleted_at IS NULL'];
    if (filter.ids) where.push(`d.id = ANY($${params.push(filter.ids)})`);
    if (filter.hostel_id) where.push(`d.hostel_id = $${params.push(filter.hostel_id)}`);
    if (filter.user_id) where.push(`d.user_id = $${params.push(filter.user_id)}`);
    if (filter.from) where.push(`d.duty_date >= $${params.push(filter.from)}`);
    if (filter.to) where.push(`d.duty_date <= $${params.push(filter.to)}`);
    if (filter.running_on) {
      const today = `$${params.push(filter.running_on)}`;
      const yesterday = `$${params.push(addDays(filter.running_on, -1))}`;
      where.push(
        `(d.duty_date = ${today} OR (d.duty_date = ${yesterday} AND sh.end_time <= sh.start_time AND d.status IN ('scheduled', 'checked_in')))`,
      );
    }
    const rows: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT d.id, d.hostel_id, h.name AS hostel_name, d.block_id, b.name AS block_name,
         d.duty_date::text AS duty_date, d.shift_id, sh.name AS shift_name, sh.start_time, sh.end_time, sh.is_night,
         d.user_id, u.name AS user_name, u.mobile AS user_mobile, d.note, d.status, d.check_in_at, d.check_out_at,
         d.late_minutes,
         EXISTS (SELECT 1 FROM hostel_duty_swaps sw WHERE sw.roster_id = d.id AND sw.status = 'pending'
           AND sw.deleted_at IS NULL) AS swap_pending
       FROM hostel_duty_roster d
       JOIN hostels h ON h.id = d.hostel_id
       JOIN hostel_duty_shifts sh ON sh.id = d.shift_id
       JOIN users u ON u.id = d.user_id
       LEFT JOIN hostel_blocks b ON b.id = d.block_id
       WHERE ${where.join(' AND ')}
       ORDER BY d.duty_date, sh.start_time, h.name, u.name, d.id`,
      params,
    );
    const now = Date.now();
    return rows.map((row) => {
      const bounds = shiftBounds(
        row.duty_date as string,
        row.start_time as string,
        row.end_time as string,
        this.app.timeZone,
      );
      const status = row.status as RosterStatus;
      return {
        id: Number(row.id),
        hostel_id: Number(row.hostel_id),
        hostel_name: row.hostel_name as string,
        block_id: (row.block_id as number | null) ?? null,
        block_name: (row.block_name as string | null) ?? null,
        duty_date: row.duty_date as string,
        shift_id: Number(row.shift_id),
        shift_name: row.shift_name as string,
        start_time: row.start_time as string,
        end_time: row.end_time as string,
        is_night: Boolean(row.is_night),
        user_id: Number(row.user_id),
        user_name: row.user_name as string,
        user_mobile: (row.user_mobile as string | null) ?? null,
        note: (row.note as string | null) ?? null,
        status,
        shift_start_at: bounds.start,
        shift_end_at: bounds.end,
        check_in_at: (row.check_in_at as Date | null) ?? null,
        check_out_at: (row.check_out_at as Date | null) ?? null,
        late_minutes: (row.late_minutes as number | null) ?? null,
        running_late: status === 'scheduled' && now > bounds.start.getTime(),
        swap_pending: Boolean(row.swap_pending),
      };
    });
  }

  private async roundRows(schoolId: number, condition: string, params: unknown[]): Promise<NightRoundDto[]> {
    const rows: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT n.id, n.hostel_id, h.name AS hostel_name, n.block_id, b.name AS block_name, n.user_id,
         u.name AS user_name, n.round_at, n.all_ok, n.issues
       FROM hostel_night_rounds n
       JOIN hostels h ON h.id = n.hostel_id
       JOIN users u ON u.id = n.user_id
       LEFT JOIN hostel_blocks b ON b.id = n.block_id
       WHERE n.school_id = $1 AND ${condition}
       ORDER BY n.round_at DESC, n.id DESC`,
      [schoolId, ...params],
    );
    return rows.map((row) => ({
      id: Number(row.id),
      hostel_id: Number(row.hostel_id),
      hostel_name: row.hostel_name as string,
      block_id: (row.block_id as number | null) ?? null,
      block_name: (row.block_name as string | null) ?? null,
      user_id: Number(row.user_id),
      user_name: row.user_name as string,
      round_at: row.round_at as Date,
      all_ok: Boolean(row.all_ok),
      issues: (row.issues as string | null) ?? null,
    }));
  }

  private async swap(schoolId: number, id: number): Promise<SwapDto> {
    const [row] = await this.dataSource.query(
      `SELECT ${this.swapColumns()} ${this.swapFrom()} WHERE sw.school_id = $1 AND sw.id = $2 AND sw.deleted_at IS NULL`,
      [schoolId, id],
    );
    if (!row) throw AppException.notFound('Swap request not found', 'HOSTEL_SWAP_NOT_FOUND');
    return row;
  }

  private swapColumns(): string {
    return `sw.id, sw.roster_id, d.duty_date::text AS duty_date, sh.name AS shift_name, sh.start_time, sh.end_time,
         h.name AS hostel_name, sw.from_user_id, fu.name AS from_user_name, sw.to_user_id, tu.name AS to_user_name,
         sw.reason, sw.status, du.name AS decided_by_name, sw.decided_at, sw.created_at`;
  }

  private swapFrom(): string {
    return `FROM hostel_duty_swaps sw
       JOIN hostel_duty_roster d ON d.id = sw.roster_id
       JOIN hostel_duty_shifts sh ON sh.id = d.shift_id
       JOIN hostels h ON h.id = d.hostel_id
       JOIN users fu ON fu.id = sw.from_user_id
       JOIN users tu ON tu.id = sw.to_user_id
       LEFT JOIN users du ON du.id = sw.decided_by`;
  }

  private async shift(schoolId: number, id: number): Promise<HostelDutyShift> {
    const shift = await this.dataSource.manager.findOneBy(HostelDutyShift, { school_id: schoolId, id });
    if (!shift) throw AppException.notFound('Shift not found', 'HOSTEL_SHIFT_NOT_FOUND');
    return shift;
  }

  private async activeShifts(
    manager: EntityManager,
    schoolId: number,
    ids: number[],
  ): Promise<Map<number, HostelDutyShift>> {
    const unique = [...new Set(ids)];
    const rows = await manager
      .createQueryBuilder(HostelDutyShift, 'sh')
      .where('sh.school_id = :schoolId AND sh.id IN (:...ids)', { schoolId, ids: unique })
      .getMany();
    const map = new Map(rows.map((row) => [row.id, row]));
    const missing = unique.filter((id) => !map.has(id));
    if (missing.length) throw AppException.notFound(`Shift not found: ${missing.join(', ')}`, 'HOSTEL_SHIFT_NOT_FOUND');
    const inactive = rows.filter((row) => !row.active);
    if (inactive.length) {
      throw AppException.conflict(
        `Turned-off shift: ${inactive.map((row) => row.name).join(', ')}`,
        'HOSTEL_SHIFT_INACTIVE',
      );
    }
    return map;
  }

  private async ensureShiftName(schoolId: number, name: string): Promise<void> {
    const [taken] = await this.dataSource.query(
      `SELECT 1 FROM hostel_duty_shifts WHERE school_id = $1 AND LOWER(name) = LOWER($2) AND deleted_at IS NULL`,
      [schoolId, name],
    );
    if (taken) throw AppException.conflict('A shift with this name already exists', 'HOSTEL_SHIFT_NAME_TAKEN');
  }

  private checkShiftTimes(start: string, end: string): void {
    if (start === end) {
      throw AppException.validation([{ field: 'end_time', message: 'End time must differ from start time' }]);
    }
  }

  private async ensureFree(
    manager: EntityManager,
    schoolId: number,
    userId: number,
    duty: HostelDutyRoster,
  ): Promise<void> {
    const [clash] = await manager.query(
      `SELECT 1 FROM hostel_duty_roster WHERE school_id = $1 AND user_id = $2 AND duty_date = $3 AND shift_id = $4
         AND deleted_at IS NULL AND id <> $5`,
      [schoolId, userId, duty.duty_date, duty.shift_id, duty.id],
    );
    if (clash) {
      throw AppException.conflict('That person is already on this shift that day', 'HOSTEL_DUTY_CLASH');
    }
  }

  private async closeSwaps(
    manager: EntityManager,
    rosterId: number,
    status: 'cancelled' | 'rejected',
    actor: AuthUser,
  ): Promise<void> {
    await manager.query(
      `UPDATE hostel_duty_swaps SET status = $2, decided_by = $3, decided_at = now(), updated_at = now()
       WHERE roster_id = $1 AND status = 'pending' AND deleted_at IS NULL`,
      [rosterId, status, actor.id],
    );
  }

  private async lockDuty(manager: EntityManager, schoolId: number, id: number): Promise<HostelDutyRoster> {
    const row = await manager.findOne(HostelDutyRoster, {
      where: { school_id: schoolId, id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!row) throw AppException.notFound('Duty not found', 'HOSTEL_DUTY_NOT_FOUND');
    return row;
  }

  private async lockOwnDuty(
    manager: EntityManager,
    schoolId: number,
    id: number,
    actor: AuthUser,
  ): Promise<HostelDutyRoster> {
    const row = await this.lockDuty(manager, schoolId, id);
    if (row.user_id !== actor.id) throw AppException.forbidden('This duty is not yours', 'HOSTEL_DUTY_NOT_YOURS');
    return row;
  }

  private async lockSwap(manager: EntityManager, schoolId: number, id: number): Promise<HostelDutySwap> {
    const swap = await manager.findOne(HostelDutySwap, {
      where: { school_id: schoolId, id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!swap) throw AppException.notFound('Swap request not found', 'HOSTEL_SWAP_NOT_FOUND');
    if (swap.status !== 'pending') throw AppException.conflict(`This swap is ${swap.status}`, 'HOSTEL_SWAP_STATE');
    return swap;
  }

  private expectStatus(row: HostelDutyRoster, allowed: RosterStatus[]): void {
    if (!allowed.includes(row.status)) {
      throw AppException.conflict(`This duty is ${row.status.replace('_', ' ')}`, 'HOSTEL_DUTY_STATE');
    }
  }

  private toShift(row: HostelDutyShift): DutyShiftDto {
    return {
      id: row.id,
      name: row.name,
      start_time: row.start_time,
      end_time: row.end_time,
      is_night: row.is_night,
      crosses_midnight: crossesMidnight(row.start_time, row.end_time),
      active: row.active,
    };
  }
}
