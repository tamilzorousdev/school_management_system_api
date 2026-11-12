import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AppException, AuthUser, listQuery, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { addDays, holidaySet, workingDays } from '../../shared/school-days';
import { PERMISSIONS, ROLES } from '../access/access.catalog';
import { NotificationsService } from '../notifications/notifications.service';
import { AcademicYear } from '../setup/entities/academic-year.entity';
import { Staff } from '../staff/entities/staff.entity';
import {
  LeaveBalanceDto,
  LeaveTypeDto,
  LeaveTypeInputDto,
  StaffLeaveDecisionDto,
  StaffLeaveDto,
  StaffLeaveInputDto,
  StaffLeaveQueryDto,
  UpdateLeaveTypeDto,
} from './dto/staff-leave.dto';
import { LeaveType } from './entities/leave-type.entity';
import { StaffLeave, StaffLeaveStatus } from './entities/staff-leave.entity';
import { yearWhere } from '../../shared/year-context';

export const DEFAULT_LEAVE_TYPES: [string, string, number, boolean][] = [
  ['CL', 'Casual leave', 12, true],
  ['SL', 'Sick leave', 10, true],
  ['EL', 'Earned leave', 15, true],
  ['LOP', 'Loss of pay', 0, false],
];

const BACKDATE_DAYS = 7;
const PENDING: StaffLeaveStatus[] = ['pending_hod', 'pending_principal'];
const STATUS_WORD: Record<StaffLeaveStatus, string> = {
  pending_hod: 'waiting for the HOD',
  pending_principal: 'waiting for the principal',
  approved: 'approved',
  rejected: 'rejected',
  cancelled: 'cancelled',
};

export function nextStatus(
  current: StaffLeaveStatus,
  decision: 'approved' | 'rejected',
  approverIsFinal: boolean,
): StaffLeaveStatus {
  if (decision === 'rejected') return 'rejected';
  if (current === 'pending_hod' && !approverIsFinal) return 'pending_principal';
  return 'approved';
}

@Injectable()
export class StaffLeaveService {
  private readonly logger = new Logger('StaffLeave');

  constructor(
    @InjectRepository(LeaveType) private readonly types: Repository<LeaveType>,
    @InjectRepository(StaffLeave) private readonly leaves: Repository<StaffLeave>,
    private readonly notifications: NotificationsService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async listTypes(schoolId: number): Promise<LeaveTypeDto[]> {
    await this.ensureDefaults(schoolId);
    const rows = await this.types.find({ where: { school_id: schoolId }, order: { sort_order: 'ASC', name: 'ASC' } });
    return rows.map((row) => this.presentType(row));
  }

  async createType(schoolId: number, dto: LeaveTypeInputDto): Promise<LeaveTypeDto> {
    await this.ensureDefaults(schoolId);
    if (await this.types.existsBy({ school_id: schoolId, code: dto.code })) {
      throw AppException.conflict(`Leave type ${dto.code} already exists`, 'LEAVE_TYPE_EXISTS');
    }
    const count = await this.types.countBy({ school_id: schoolId });
    return this.presentType(
      await this.types.save(this.types.create({ ...dto, school_id: schoolId, sort_order: count + 1 })),
    );
  }

  async updateType(schoolId: number, id: number, dto: UpdateLeaveTypeDto): Promise<LeaveTypeDto> {
    const row = await this.types.findOneBy({ id, school_id: schoolId });
    if (!row) throw AppException.notFound('Leave type not found', 'LEAVE_TYPE_NOT_FOUND');
    if (dto.code && dto.code !== row.code && (await this.types.existsBy({ school_id: schoolId, code: dto.code }))) {
      throw AppException.conflict(`Leave type ${dto.code} already exists`, 'LEAVE_TYPE_EXISTS');
    }
    return this.presentType(await this.types.save(this.types.merge(row, dto)));
  }

  async balances(schoolId: number, userId: number): Promise<LeaveBalanceDto[]> {
    await this.ensureDefaults(schoolId);
    const year = await this.currentYear(schoolId);
    const [types, used]: [LeaveType[], { leave_type_id: number; status: StaffLeaveStatus; days: string }[]] =
      await Promise.all([
        this.types.find({ where: { school_id: schoolId, is_active: true }, order: { sort_order: 'ASC' } }),
        this.dataSource.query(
          `SELECT leave_type_id, status, SUM(days) AS days FROM staff_leave_requests
         WHERE user_id = $1 AND academic_year_id = $2 AND deleted_at IS NULL AND status IN ('approved', 'pending_hod', 'pending_principal')
         GROUP BY leave_type_id, status`,
          [userId, year.id],
        ),
      ]);
    return types.map((type) => {
      const mine = used.filter((row) => Number(row.leave_type_id) === type.id);
      const approved = mine.filter((row) => row.status === 'approved').reduce((sum, row) => sum + Number(row.days), 0);
      const pending = mine.filter((row) => row.status !== 'approved').reduce((sum, row) => sum + Number(row.days), 0);
      const allowed = type.days_per_year > 0 ? type.days_per_year : null;
      return {
        leave_type: this.presentType(type),
        allowed,
        used: approved,
        pending,
        remaining: allowed === null ? null : Math.max(0, allowed - approved - pending),
      };
    });
  }

  async apply(user: AuthUser, dto: StaffLeaveInputDto): Promise<StaffLeaveDto> {
    const staff = await this.dataSource.getRepository(Staff).findOneBy({ user_id: user.id });
    if (!staff || staff.status === 'resigned')
      throw AppException.forbidden('Only staff members can apply for leave', 'NOT_STAFF');
    const schoolId = staff.school_id;
    await this.ensureDefaults(schoolId);
    const type = await this.types.findOneBy({ id: dto.leave_type_id, school_id: schoolId, is_active: true });
    if (!type) throw AppException.validation([{ field: 'leave_type_id', message: 'Choose a leave type' }]);
    if (dto.to_date < dto.from_date) {
      throw AppException.validation([{ field: 'to_date', message: 'The last day must be on or after the first day' }]);
    }
    if (dto.half_day && dto.from_date !== dto.to_date) {
      throw AppException.validation([{ field: 'half_day', message: 'A half day must start and end on the same date' }]);
    }
    const today = todayIn(this.app.timeZone);
    if (dto.from_date < addDays(today, -BACKDATE_DAYS)) {
      throw AppException.validation([
        { field: 'from_date', message: `Leave can start at most ${BACKDATE_DAYS} days ago` },
      ]);
    }
    const holidays = await holidaySet(this.dataSource.manager, schoolId, dto.from_date, dto.to_date);
    const schoolDays = workingDays(dto.from_date, dto.to_date, holidays).length;
    if (!schoolDays) throw AppException.badRequest('These dates are all holidays or Sundays', 'NO_WORKING_DAYS');
    const days = dto.half_day ? 0.5 : schoolDays;
    const overlap = await this.dataSource.query(
      `SELECT 1 FROM staff_leave_requests WHERE user_id = $1 AND deleted_at IS NULL
       AND status IN ('approved', 'pending_hod', 'pending_principal') AND from_date <= $3 AND to_date >= $2 LIMIT 1`,
      [user.id, dto.from_date, dto.to_date],
    );
    if (overlap.length) throw AppException.conflict('You already have leave on some of these days', 'LEAVE_OVERLAP');
    const balance = (await this.balances(schoolId, user.id)).find((row) => row.leave_type.id === type.id);
    if (balance?.remaining !== null && balance !== undefined && days > balance.remaining) {
      throw AppException.badRequest(
        `Only ${balance.remaining} days of ${type.name.toLowerCase()} left this year`,
        'LEAVE_BALANCE_LOW',
      );
    }
    const hod = await this.hodFor(staff, user);
    const year = await this.currentYear(schoolId);
    const saved = await this.leaves.save(
      this.leaves.create({
        school_id: schoolId,
        user_id: user.id,
        leave_type_id: type.id,
        academic_year_id: year.id,
        from_date: dto.from_date,
        to_date: dto.to_date,
        half_day: dto.half_day ?? false,
        days: String(days),
        reason: dto.reason,
        status: hod ? 'pending_hod' : 'pending_principal',
        hod_user_id: hod,
        created_by: user.id,
      }),
    );
    await this.notifyApprovers(saved, user.name, type.name);
    return (await this.present([saved]))[0];
  }

  async mine(user: AuthUser): Promise<StaffLeaveDto[]> {
    const rows = await this.leaves.find({ where: { user_id: user.id }, order: { from_date: 'DESC' }, take: 50 });
    return this.present(rows);
  }

  async cancel(user: AuthUser, id: number): Promise<StaffLeaveDto> {
    const leave = await this.leaves.findOneBy({ id, user_id: user.id });
    if (!leave) throw AppException.notFound('Leave request not found', 'LEAVE_NOT_FOUND');
    if (!PENDING.includes(leave.status)) {
      throw AppException.conflict(
        `Only a waiting request can be cancelled. This one is ${STATUS_WORD[leave.status]}.`,
        'LEAVE_NOT_PENDING',
      );
    }
    leave.status = 'cancelled';
    return (await this.present([await this.leaves.save(leave)]))[0];
  }

  async list(schoolId: number, query: StaffLeaveQueryDto): Promise<Paginated<StaffLeaveDto>> {
    const qb = this.leaves
      .createQueryBuilder('l')
      .innerJoin('users', 'u', 'u.id = l.user_id')
      .where('l.school_id = :schoolId', { schoolId });
    if (query.status === 'waiting') {
      qb.andWhere('l.status IN (:...waiting)', { waiting: ['pending_hod', 'pending_principal'] });
    } else if (query.status) {
      qb.andWhere('l.status = :status', { status: query.status });
    }
    if (query.user_id) qb.andWhere('l.user_id = :userId', { userId: query.user_id });
    const page = await listQuery(qb, query.sort ? query : { ...query, sort: 'from_date', order: 'desc' }, {
      searchable: ['u.name', 'l.reason'],
      sortable: { from_date: 'l.from_date', created_at: 'l.created_at', status: 'l.status' },
      defaultSort: 'from_date',
    });
    return { ...page, items: await this.present(page.items) };
  }

  async approvals(user: AuthUser): Promise<StaffLeaveDto[]> {
    const final = user.permissions.includes(PERMISSIONS.LEAVE_APPROVE);
    const qb = this.leaves
      .createQueryBuilder('l')
      .where(`(l.status = 'pending_hod' AND l.hod_user_id = :userId)`, { userId: user.id })
      .orderBy('l.from_date', 'ASC');
    if (final && user.school_id) {
      qb.orWhere(`(l.status IN ('pending_principal', 'pending_hod') AND l.school_id = :schoolId)`, {
        schoolId: user.school_id,
      });
    }
    return this.present(await qb.take(100).getMany());
  }

  async decide(user: AuthUser, id: number, dto: StaffLeaveDecisionDto, schoolId?: number): Promise<StaffLeaveDto> {
    const leave = await this.leaves.findOneBy({ id, ...(schoolId ? { school_id: schoolId } : {}) });
    if (!leave) throw AppException.notFound('Leave request not found', 'LEAVE_NOT_FOUND');
    if (!PENDING.includes(leave.status)) {
      throw AppException.conflict(`This request is already ${STATUS_WORD[leave.status]}`, 'LEAVE_NOT_PENDING');
    }
    if (leave.user_id === user.id) throw AppException.forbidden('You cannot decide your own leave', 'OWN_LEAVE');
    const final = user.permissions.includes(PERMISSIONS.LEAVE_APPROVE);
    const isHod = leave.status === 'pending_hod' && leave.hod_user_id === user.id;
    if (!final && !isHod) throw AppException.forbidden('You cannot decide this request', 'NOT_APPROVER');
    if (!final && user.school_id !== leave.school_id)
      throw AppException.forbidden('You cannot decide this request', 'NOT_APPROVER');
    const status = nextStatus(leave.status, dto.status, final);
    if (leave.status === 'pending_hod' && !final) {
      Object.assign(leave, { hod_decided_at: new Date(), hod_note: dto.note ?? null });
    } else {
      Object.assign(leave, {
        principal_user_id: user.id,
        principal_decided_at: new Date(),
        principal_note: dto.note ?? null,
      });
    }
    leave.status = status;
    const saved = await this.leaves.save(leave);
    const type = await this.types.findOneByOrFail({ id: saved.leave_type_id });
    if (status === 'pending_principal') {
      const [applicant] = await this.dataSource.query(`SELECT name FROM users WHERE id = $1`, [saved.user_id]);
      await this.notifyApprovers(saved, applicant?.name ?? '', type.name);
    }
    await this.notifications
      .dispatch({
        template: 'STAFF_LEAVE_STATUS',
        audience: { user_ids: [saved.user_id] },
        data: {
          type: type.name.toLowerCase(),
          from: saved.from_date,
          to: saved.to_date,
          days: Number(saved.days),
          status: STATUS_WORD[status],
          leave_id: String(saved.id),
          note: dto.note ? ` Note: ${dto.note}` : '',
        },
      })
      .catch((error: Error) => this.logger.warn(`Leave status for ${saved.id} not sent: ${error.message}`));
    return (await this.present([saved]))[0];
  }

  private async hodFor(staff: Staff, user: AuthUser): Promise<number | null> {
    if (user.roles.includes(ROLES.HOD) || user.roles.includes(ROLES.PRINCIPAL) || !staff.department) return null;
    const [row] = await this.dataSource.query(
      `SELECT st.user_id FROM staff st
       JOIN user_roles ur ON ur.user_id = st.user_id JOIN roles r ON r.id = ur.role_id AND r.code = $3
       WHERE st.school_id = $1 AND LOWER(st.department) = LOWER($2) AND st.user_id <> $4
         AND st.deleted_at IS NULL AND st.status = 'active'
       ORDER BY st.joining_date LIMIT 1`,
      [staff.school_id, staff.department, ROLES.HOD, user.id],
    );
    return row ? Number(row.user_id) : null;
  }

  private async notifyApprovers(leave: StaffLeave, name: string, typeName: string): Promise<void> {
    let userIds: number[] = [];
    if (leave.status === 'pending_hod' && leave.hod_user_id) userIds = [leave.hod_user_id];
    else {
      const rows: { id: number }[] = await this.dataSource.query(
        `SELECT DISTINCT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
         WHERE u.school_id = $1 AND u.deleted_at IS NULL AND u.status = 'active' AND r.code = $2 AND u.id <> $3`,
        [leave.school_id, ROLES.PRINCIPAL, leave.user_id],
      );
      userIds = rows.map((row) => Number(row.id));
    }
    if (!userIds.length) return;
    await this.notifications
      .dispatch({
        template: 'LEAVE_APPROVAL_NEEDED',
        audience: { user_ids: userIds },
        data: {
          name,
          type: typeName.toLowerCase(),
          from: leave.from_date,
          to: leave.to_date,
          days: Number(leave.days),
          leave_id: String(leave.id),
        },
      })
      .catch((error: Error) => this.logger.warn(`Approval request for ${leave.id} not sent: ${error.message}`));
  }

  private async ensureDefaults(schoolId: number): Promise<void> {
    if (await this.types.existsBy({ school_id: schoolId })) return;
    await this.types.save(
      DEFAULT_LEAVE_TYPES.map(([code, name, days, paid], index) =>
        this.types.create({
          school_id: schoolId,
          code,
          name,
          days_per_year: days,
          is_paid: paid,
          sort_order: index + 1,
        }),
      ),
    );
  }

  private async currentYear(schoolId: number): Promise<AcademicYear> {
    const year = await this.dataSource.getRepository(AcademicYear).findOneBy(yearWhere(schoolId));
    if (!year) throw AppException.badRequest('Set the current academic year in School setup first', 'NO_CURRENT_YEAR');
    return year;
  }

  private presentType(row: LeaveType): LeaveTypeDto {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      days_per_year: row.days_per_year,
      is_paid: row.is_paid,
      is_active: row.is_active,
    };
  }

  private async present(rows: StaffLeave[]): Promise<StaffLeaveDto[]> {
    if (!rows.length) return [];
    const userIds = [
      ...new Set(
        rows
          .flatMap((row) => [row.user_id, row.hod_user_id, row.principal_user_id])
          .filter((id): id is number => Boolean(id)),
      ),
    ];
    const [users, staff, types] = await Promise.all([
      this.dataSource.query(`SELECT id, name FROM users WHERE id = ANY($1)`, [userIds]) as Promise<
        { id: number; name: string }[]
      >,
      this.dataSource
        .getRepository(Staff)
        .find({ where: { user_id: In(rows.map((row) => row.user_id)) }, withDeleted: true }),
      this.types.find({ where: { id: In(rows.map((row) => row.leave_type_id)) }, withDeleted: true }),
    ]);
    const names = new Map(users.map((row) => [Number(row.id), { id: Number(row.id), name: row.name }]));
    const departments = new Map(staff.map((row) => [row.user_id, row.department]));
    const typeMap = new Map(types.map((row) => [row.id, this.presentType(row)]));
    return rows.map((row) => ({
      id: row.id,
      staff: names.get(row.user_id) ?? { id: row.user_id, name: '' },
      department: departments.get(row.user_id) ?? null,
      leave_type: typeMap.get(row.leave_type_id)!,
      from_date: row.from_date,
      to_date: row.to_date,
      half_day: row.half_day,
      days: Number(row.days),
      reason: row.reason,
      status: row.status,
      hod: row.hod_user_id ? (names.get(row.hod_user_id) ?? null) : null,
      hod_note: row.hod_note,
      principal: row.principal_user_id ? (names.get(row.principal_user_id) ?? null) : null,
      principal_note: row.principal_note,
      created_at: row.created_at,
    }));
  }
}
