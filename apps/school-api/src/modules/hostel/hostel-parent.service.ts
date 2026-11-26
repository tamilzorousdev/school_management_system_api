import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppException, AuthUser, Paginated } from '@app/common';
import { ListQueryDto } from '@app/common';
import {
  ApprovedVisitorDto,
  ApprovedVisitorInputDto,
  ConsentDto,
  LeaveDto,
  LeaveInputDto,
  ParentHostelDto,
  RollHistoryItemDto,
  RollHistoryQueryDto,
  VisitDto,
} from './dto/hostel-movement.dto';
import {
  CaseDto,
  ComplaintDetailDto,
  ComplaintDto,
  ParentComplaintInputDto,
  RatingDto,
} from './dto/hostel-conduct.dto';
import { HostelDisciplineService } from './hostel-discipline.service';
import { HostelFeesService } from './hostel-fees.service';
import { HostelLeavesService } from './hostel-leaves.service';
import { HostelTicketsService } from './hostel-tickets.service';
import { HostelRollCallService } from './hostel-roll-call.service';
import { HostelVisitorsService } from './hostel-visitors.service';
import { OPEN_LEAVE_STATES } from './hostel.logic';

export interface ChildStay {
  school_id: number;
  admission_id: number | null;
}

@Injectable()
export class HostelParentService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly leaves: HostelLeavesService,
    private readonly rollCalls: HostelRollCallService,
    private readonly visitors: HostelVisitorsService,
    private readonly fees: HostelFeesService,
    private readonly tickets: HostelTicketsService,
    private readonly discipline: HostelDisciplineService,
  ) {}

  async overview(user: AuthUser, studentId: number): Promise<ParentHostelDto> {
    const stay = await this.child(user, studentId);
    const empty: ParentHostelDto = {
      in_hostel: false,
      admission_id: null,
      admission_no: null,
      hostel_name: null,
      bed: null,
      block_name: null,
      status: null,
      diet: null,
      warden: { name: null, phone: null },
      today: [],
      current_leave: null,
      consent_waiting: 0,
      fees: null,
    };
    if (!stay.admission_id) return empty;
    const money = await this.fees.residentFees(stay.school_id, stay.admission_id);
    const deposit = money.charges.find((charge) => charge.kind === 'deposit' && charge.invoice_status !== 'cancelled');
    const [row] = await this.dataSource.query(
      `SELECT a.id, a.admission_no, a.status, a.diet, h.name AS hostel_name, b.name AS block_name,
         CASE WHEN r.id IS NULL THEN NULL ELSE CONCAT(r.room_no, ' / ', bd.bed_no) END AS bed,
         COALESCE(bu.name, wu.name) AS warden_name, COALESCE(bu.mobile, h.phone, wu.mobile) AS warden_phone
       FROM hostel_admissions a
       JOIN hostels h ON h.id = a.hostel_id
       LEFT JOIN users wu ON wu.id = h.warden_user_id
       LEFT JOIN hostel_allocations al ON al.admission_id = a.id AND al.to_date IS NULL
       LEFT JOIN hostel_rooms r ON r.id = al.room_id
       LEFT JOIN hostel_beds bd ON bd.id = al.bed_id
       LEFT JOIN hostel_blocks b ON b.id = r.block_id
       LEFT JOIN users bu ON bu.id = b.incharge_user_id
       WHERE a.id = $1`,
      [stay.admission_id],
    );
    const today = this.rollCalls.today();
    const open = await this.leaves.list(
      stay.school_id,
      Object.assign(new ListQueryDto(), {
        admission_id: stay.admission_id,
        sort: 'from_date',
        order: 'asc',
        limit: 20,
      }),
    );
    const live = open.items.filter((leave) => OPEN_LEAVE_STATES.includes(leave.status));
    return {
      in_hostel: true,
      admission_id: row.id,
      admission_no: row.admission_no,
      hostel_name: row.hostel_name,
      bed: row.bed,
      block_name: row.block_name,
      status: row.status,
      diet: row.diet,
      warden: { name: row.warden_name ?? null, phone: row.warden_phone ?? null },
      today: await this.rollCalls.history(stay.school_id, stay.admission_id, { from: today, to: today }),
      current_leave: live.find((leave) => leave.status === 'out') ?? live[0] ?? null,
      consent_waiting: live.filter((leave) => leave.status === 'awaiting_parent').length,
      fees: {
        billed: money.billed,
        paid: money.paid,
        balance: money.balance,
        deposit_paid: deposit && !deposit.settled_at ? deposit.paid : 0,
      },
    };
  }

  async complaints(user: AuthUser, studentId: number, query: ListQueryDto): Promise<Paginated<ComplaintDto>> {
    const stay = await this.resident(user, studentId);
    return this.tickets.complaints(
      stay.school_id,
      Object.assign(query, { admission_id: stay.admission_id, sort: 'created_at' }),
    );
  }

  async complaint(user: AuthUser, studentId: number, id: number): Promise<ComplaintDetailDto> {
    const stay = await this.resident(user, studentId);
    const item = await this.tickets.complaint(stay.school_id, id);
    if (item.admission_id !== stay.admission_id)
      throw AppException.notFound('Complaint not found', 'HOSTEL_COMPLAINT_NOT_FOUND');
    return item;
  }

  async raiseComplaint(user: AuthUser, studentId: number, dto: ParentComplaintInputDto): Promise<ComplaintDetailDto> {
    const stay = await this.resident(user, studentId);
    return this.tickets.createParentComplaint(stay.school_id, stay.admission_id, dto, user);
  }

  async rateComplaint(user: AuthUser, studentId: number, id: number, dto: RatingDto): Promise<ComplaintDetailDto> {
    const stay = await this.resident(user, studentId);
    return this.tickets.rate(stay.school_id, id, stay.admission_id, dto, user);
  }

  async conduct(user: AuthUser, studentId: number, query: ListQueryDto): Promise<Paginated<CaseDto>> {
    const stay = await this.resident(user, studentId);
    return this.discipline.list(
      stay.school_id,
      Object.assign(query, { admission_id: stay.admission_id, sort: 'created_at' }),
      true,
    );
  }

  async attendance(user: AuthUser, studentId: number, query: RollHistoryQueryDto): Promise<RollHistoryItemDto[]> {
    const stay = await this.resident(user, studentId);
    return this.rollCalls.history(stay.school_id, stay.admission_id, query);
  }

  async leaveList(user: AuthUser, studentId: number, query: ListQueryDto): Promise<Paginated<LeaveDto>> {
    const stay = await this.resident(user, studentId);
    return this.leaves.list(
      stay.school_id,
      Object.assign(query, { admission_id: stay.admission_id, sort: 'created_at' }),
    );
  }

  async apply(user: AuthUser, studentId: number, dto: LeaveInputDto): Promise<LeaveDto> {
    const stay = await this.resident(user, studentId);
    return this.leaves.createByParent(stay.school_id, stay.admission_id, dto, user);
  }

  async consent(user: AuthUser, studentId: number, leaveId: number, dto: ConsentDto): Promise<LeaveDto> {
    const stay = await this.ownLeave(user, studentId, leaveId);
    return this.leaves.consent(stay.school_id, leaveId, dto.agree, dto.note ?? null, user);
  }

  async cancel(user: AuthUser, studentId: number, leaveId: number): Promise<LeaveDto> {
    const stay = await this.ownLeave(user, studentId, leaveId);
    return this.leaves.decide(stay.school_id, leaveId, 'cancel', { note: 'Cancelled by the parent' }, user);
  }

  async visits(user: AuthUser, studentId: number, query: ListQueryDto): Promise<Paginated<VisitDto>> {
    const stay = await this.resident(user, studentId);
    return this.visitors.list(
      stay.school_id,
      Object.assign(query, { admission_id: stay.admission_id, sort: 'created_at' }),
    );
  }

  async approvedVisitors(user: AuthUser, studentId: number): Promise<ApprovedVisitorDto[]> {
    const stay = await this.resident(user, studentId);
    return this.visitors.approvedVisitors(stay.school_id, studentId);
  }

  async addApprovedVisitor(
    user: AuthUser,
    studentId: number,
    dto: ApprovedVisitorInputDto,
  ): Promise<ApprovedVisitorDto> {
    const stay = await this.resident(user, studentId);
    return this.visitors.addApprovedVisitor(stay.school_id, studentId, dto, user, 'parent');
  }

  async removeApprovedVisitor(user: AuthUser, studentId: number, id: number): Promise<void> {
    const stay = await this.resident(user, studentId);
    await this.visitors.removeApprovedVisitor(stay.school_id, studentId, id, user);
  }

  async child(user: AuthUser, studentId: number): Promise<ChildStay> {
    const [row] = await this.dataSource.query(
      `SELECT s.school_id, a.id AS admission_id FROM student_guardians sg
       JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
       JOIN students s ON s.id = sg.student_id AND s.deleted_at IS NULL
       LEFT JOIN hostel_admissions a ON a.student_id = s.id AND a.status <> 'checked_out' AND a.deleted_at IS NULL
       WHERE g.user_id = $1 AND sg.student_id = $2 LIMIT 1`,
      [user.id, studentId],
    );
    if (!row) throw AppException.notFound('This child is not linked to your mobile number', 'CHILD_NOT_FOUND');
    return { school_id: Number(row.school_id), admission_id: row.admission_id ? Number(row.admission_id) : null };
  }

  async resident(user: AuthUser, studentId: number): Promise<{ school_id: number; admission_id: number }> {
    const stay = await this.child(user, studentId);
    if (!stay.admission_id) {
      throw AppException.notFound('Your child is not staying in the hostel', 'HOSTEL_NOT_RESIDENT');
    }
    return { school_id: stay.school_id, admission_id: stay.admission_id };
  }

  private async ownLeave(user: AuthUser, studentId: number, leaveId: number) {
    const stay = await this.child(user, studentId);
    const [leave] = await this.dataSource.query(
      `SELECT 1 FROM hostel_leaves WHERE id = $1 AND student_id = $2 AND school_id = $3 AND deleted_at IS NULL`,
      [leaveId, studentId, stay.school_id],
    );
    if (!leave) throw AppException.notFound('Hostel leave not found', 'HOSTEL_LEAVE_NOT_FOUND');
    return stay;
  }
}
