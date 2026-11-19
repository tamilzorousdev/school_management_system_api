import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AppException, AuthUser, listQuery, Paginated } from '@app/common';
import { PERMISSIONS } from '../access/access.catalog';
import { SmsService } from '../sms/sms.service';
import {
  BlockDto,
  BlockInputDto,
  InviteDto,
  StaffOptionDto,
  UpdateBlockDto,
  VisitDecisionDto,
  VisitDto,
  VisitorBaseDto,
  VisitQueryDto,
  WalkInDto,
} from './dto/gate.dto';
import { CheckMethod, GateBlock, GateVisit, VisitStatus } from './entities/gate.entity';
import { GateCoreService, OFFICE_ROLES } from './gate-core.service';
import { blockedMatch, isLateFor, toMinutes } from './gate.logic';

const PURPOSE_LABELS: Record<string, string> = {
  meet_staff: 'Meet a staff member',
  parent_meeting: 'Parent meeting',
  fee_payment: 'Fee payment',
  admission_enquiry: 'Admission enquiry',
  delivery: 'Delivery',
  vendor: 'Vendor or contractor',
  interview: 'Interview',
  event: 'School event',
  other: 'Other',
};

export { PURPOSE_LABELS };

@Injectable()
export class GateVisitsService {
  private readonly logger = new Logger('GateVisits');

  constructor(
    @InjectRepository(GateVisit) private readonly visits: Repository<GateVisit>,
    @InjectRepository(GateBlock) private readonly blocks: Repository<GateBlock>,
    private readonly core: GateCoreService,
    private readonly sms: SmsService,
    private readonly dataSource: DataSource,
  ) {}

  async list(schoolId: number, query: VisitQueryDto): Promise<Paginated<VisitDto>> {
    const qb = this.visits.createQueryBuilder('v').where('v.school_id = :schoolId', { schoolId });
    if (query.from) qb.andWhere('v.visit_date >= :from', { from: query.from });
    if (query.to) qb.andWhere('v.visit_date <= :to', { to: query.to });
    if (query.status) qb.andWhere('v.status = :status', { status: query.status });
    if (query.purpose) qb.andWhere('v.purpose = :purpose', { purpose: query.purpose });
    if (query.host_user_id) qb.andWhere('v.host_user_id = :host', { host: query.host_user_id });
    const page = await listQuery(qb, query, {
      searchable: ['v.name', 'v.mobile', 'v.visit_no', 'v.company', 'v.purpose_note', 'v.vehicle_no'],
      sortable: { created_at: 'v.created_at', visit_date: 'v.visit_date', checked_in_at: 'v.checked_in_at' },
      defaultSort: 'created_at',
    });
    return { ...page, items: await this.core.presentVisits(schoolId, page.items, true) };
  }

  async view(schoolId: number, id: number, reveal: boolean): Promise<VisitDto> {
    return (await this.core.presentVisits(schoolId, [await this.find(schoolId, id)], reveal))[0]!;
  }

  async today(schoolId: number): Promise<{ inside: VisitDto[]; coming: VisitDto[] }> {
    const today = this.core.today();
    const [inside, coming] = await Promise.all([
      this.visits.find({ where: { school_id: schoolId, status: 'inside' }, order: { checked_in_at: 'ASC' } }),
      this.visits.find({
        where: { school_id: schoolId, visit_date: today, status: In(['waiting', 'allowed', 'expected']) },
        order: { expected_from: 'ASC', id: 'ASC' },
      }),
    ]);
    return {
      inside: await this.core.presentVisits(schoolId, inside, false),
      coming: await this.core.presentVisits(schoolId, coming, false),
    };
  }

  async idForQr(schoolId: number, id: number, version: number): Promise<number | null> {
    const visit = await this.visits.findOneBy({ id, school_id: schoolId });
    return visit && visit.qr_version === version ? visit.id : null;
  }

  async idForCode(schoolId: number, date: string, code: string): Promise<number | null> {
    const visit = await this.visits.findOne({
      where: [
        { school_id: schoolId, visit_date: date, code },
        { school_id: schoolId, code, status: 'inside' },
      ],
      order: { id: 'DESC' },
    });
    return visit?.id ?? null;
  }

  async idForNumber(schoolId: number, number: string): Promise<number | null> {
    return (await this.visits.findOneBy({ school_id: schoolId, visit_no: number }))?.id ?? null;
  }

  async walkIn(schoolId: number, dto: WalkInDto, actor: AuthUser): Promise<VisitDto> {
    const settings = await this.core.settings(schoolId);
    const missing = [
      ...(settings.visitor_photo_required && !dto.photo_file_id
        ? [{ field: 'photo_file_id', message: 'Take a photo of the visitor' }]
        : []),
      ...(settings.visitor_id_required && (!dto.id_proof_kind || !dto.id_proof_last4)
        ? [{ field: 'id_proof_last4', message: 'Note the visitor’s ID proof' }]
        : []),
    ];
    if (missing.length) throw AppException.validation(missing);
    await this.core.assertFile(dto.photo_file_id, schoolId, 'photo_file_id');
    await this.assertLinks(schoolId, dto);
    const blocked = await this.isBlocked(schoolId, dto.name, dto.mobile);
    const today = this.core.today();
    const saved = await this.visits.save(
      this.visits.create({
        ...this.base(schoolId, dto),
        visit_no: await this.core.nextNumber(schoolId, 'gate_visits', 'VP', today),
        visit_date: today,
        photo_file_id: dto.photo_file_id ?? null,
        id_proof_kind: dto.id_proof_kind ?? null,
        id_proof_last4: dto.id_proof_last4?.toUpperCase() ?? null,
        status: blocked ? 'declined' : 'waiting',
        decision_note: blocked ? 'On the blocked list' : null,
        decided_at: blocked ? new Date() : null,
        blocked_hit: Boolean(blocked),
        code: await this.core.freeCode(schoolId, today),
        created_by: actor.id,
      }),
    );
    await this.core.log(
      schoolId,
      'visitor_registered',
      { visit_id: saved.id, student_id: saved.student_id },
      actor.id,
      `${saved.visit_no} · ${saved.name} · ${PURPOSE_LABELS[saved.purpose]}`,
    );
    if (blocked) {
      await this.core.log(
        schoolId,
        'blocked_person',
        { visit_id: saved.id },
        actor.id,
        `${saved.name} · ${blocked.reason}`,
      );
      await this.core.notify(
        'GATE_BLOCKED_PERSON',
        { roles: OFFICE_ROLES, school_id: schoolId },
        {
          person: saved.name,
          mobile: saved.mobile,
          purpose: PURPOSE_LABELS[saved.purpose]!,
        },
      );
    } else {
      const data = {
        visitor: saved.name,
        purpose: PURPOSE_LABELS[saved.purpose]!,
        company: saved.company ?? '',
        visit_id: saved.id,
      };
      if (saved.host_user_id) await this.core.notify('VISITOR_WAITING', { user_ids: [saved.host_user_id] }, data);
      else await this.core.notify('VISITOR_WAITING', { roles: OFFICE_ROLES, school_id: schoolId }, data);
    }
    return this.view(schoolId, saved.id, false);
  }

  async invite(schoolId: number, dto: InviteDto, actor: AuthUser): Promise<VisitDto> {
    const today = this.core.today();
    const errors = [];
    if (dto.visit_date < today) errors.push({ field: 'visit_date', message: 'visit_date cannot be in the past' });
    if (dto.expected_from && dto.expected_until && toMinutes(dto.expected_until) <= toMinutes(dto.expected_from)) {
      errors.push({ field: 'expected_until', message: 'expected_until must be after expected_from' });
    }
    if (errors.length) throw AppException.validation(errors);
    await this.assertLinks(schoolId, dto);
    const blocked = await this.isBlocked(schoolId, dto.name, dto.mobile);
    if (blocked) throw AppException.conflict(`${dto.name} is on the blocked list: ${blocked.reason}`, 'PERSON_BLOCKED');
    const saved = await this.visits.save(
      this.visits.create({
        ...this.base(schoolId, dto),
        visit_no: await this.core.nextNumber(schoolId, 'gate_visits', 'VP', dto.visit_date),
        visit_date: dto.visit_date,
        expected_from: dto.expected_from ?? null,
        expected_until: dto.expected_until ?? null,
        status: 'expected',
        invited_by: actor.id,
        code: await this.core.freeCode(schoolId, dto.visit_date),
        created_by: actor.id,
      }),
    );
    await this.core.log(
      schoolId,
      'visitor_invited',
      { visit_id: saved.id, student_id: saved.student_id },
      actor.id,
      `${saved.visit_no} · ${saved.name} on ${saved.visit_date}`,
    );
    const view = await this.view(schoolId, saved.id, true);
    await this.sms
      .send({
        mobile: saved.mobile,
        text: `Visitor pass ${saved.visit_no} for ${saved.visit_date}${saved.expected_from ? ` from ${saved.expected_from}` : ''}. Show code ${saved.code} at the school gate.`,
        dltTemplateId: null,
        templateCode: 'VISITOR_PASS',
        variables: {
          name: saved.name,
          visit_no: saved.visit_no,
          date: saved.visit_date,
          from: saved.expected_from ?? '',
          code: saved.code,
        },
      })
      .catch((error: Error) => this.logger.warn(`Visitor pass SMS for ${saved.visit_no} not sent: ${error.message}`));
    return view;
  }

  async decide(schoolId: number, id: number, dto: VisitDecisionDto, actor: AuthUser): Promise<VisitDto> {
    const visit = await this.find(schoolId, id);
    const office = actor.permissions.includes(PERMISSIONS.GATE_MANAGE);
    if (!office && visit.host_user_id !== actor.id) {
      throw AppException.forbidden('Only the person being met or the office can decide', 'NOT_YOUR_VISITOR');
    }
    if (visit.status !== 'waiting') throw AppException.conflict('This visitor was already answered', 'VISIT_ANSWERED');
    await this.visits.update(id, {
      status: dto.allow ? 'allowed' : 'declined',
      decided_by: actor.id,
      decided_at: new Date(),
      decision_note: dto.note ?? null,
    });
    await this.core.log(
      schoolId,
      dto.allow ? 'visitor_allowed' : 'visitor_declined',
      { visit_id: id },
      actor.id,
      `${visit.name}${dto.note ? ` · ${dto.note}` : ''}`,
    );
    if (visit.created_by) {
      await this.core.notify(
        'VISITOR_ANSWERED',
        { user_ids: [visit.created_by] },
        {
          visitor: visit.name,
          decision: dto.allow ? 'allowed: let them in' : 'not allowed',
          by: actor.name,
          note: dto.note ?? '',
          visit_id: id,
        },
      );
    }
    return this.view(schoolId, id, false);
  }

  async pendingForHost(schoolId: number, actor: AuthUser): Promise<VisitDto[]> {
    const rows = await this.visits.find({
      where: { school_id: schoolId, host_user_id: actor.id, status: In(['waiting', 'expected', 'allowed', 'inside']) },
      order: { id: 'DESC' },
      take: 30,
    });
    return this.core.presentVisits(schoolId, rows, false);
  }

  async checkIn(schoolId: number, id: number, method: CheckMethod, actor: AuthUser): Promise<VisitDto> {
    const visit = await this.find(schoolId, id);
    if (visit.status === 'waiting')
      throw AppException.conflict('Not allowed yet. Wait for the answer.', 'VISIT_WAITING');
    if (!['allowed', 'expected'].includes(visit.status)) {
      throw AppException.conflict(`This visitor is ${visit.status} and cannot come in`, 'VISIT_NOT_OPEN');
    }
    if (visit.visit_date !== this.core.today())
      throw AppException.conflict('This visitor pass is not for today', 'VISIT_NOT_TODAY');
    await this.move(visit, 'inside', { checked_in_at: new Date(), checked_in_by: actor.id, check_in_method: method });
    await this.core.log(
      schoolId,
      'visitor_in',
      { visit_id: id, student_id: visit.student_id },
      actor.id,
      `${visit.visit_no} · ${visit.name}`,
      method,
    );
    if (visit.status === 'expected' && visit.host_user_id) {
      await this.core.notify(
        'VISITOR_ARRIVED',
        { user_ids: [visit.host_user_id] },
        { visitor: visit.name, visit_id: id },
      );
    }
    return this.view(schoolId, id, false);
  }

  async checkOut(
    schoolId: number,
    id: number,
    method: CheckMethod | 'auto',
    actor: AuthUser | null,
  ): Promise<VisitDto> {
    const visit = await this.find(schoolId, id);
    if (visit.status !== 'inside') throw AppException.conflict('This visitor is not inside', 'VISIT_NOT_INSIDE');
    await this.move(visit, 'left', {
      checked_out_at: new Date(),
      checked_out_by: actor?.id ?? null,
      check_out_method: method,
    });
    await this.core.log(
      schoolId,
      'visitor_out',
      { visit_id: id },
      actor?.id ?? null,
      `${visit.visit_no} · ${visit.name}`,
      method,
    );
    return this.view(schoolId, id, false);
  }

  async cancel(schoolId: number, id: number, actor: AuthUser): Promise<VisitDto> {
    const visit = await this.find(schoolId, id);
    if (!['expected', 'waiting', 'allowed'].includes(visit.status)) {
      throw AppException.conflict('Only a visit that has not started can be cancelled', 'VISIT_NOT_CANCELLABLE');
    }
    await this.visits.update(id, { status: 'cancelled', decided_by: actor.id, decided_at: new Date() });
    return this.view(schoolId, id, true);
  }

  async staffOptions(schoolId: number, search: string | undefined): Promise<StaffOptionDto[]> {
    const params: unknown[] = [schoolId];
    const filter = search ? `AND u.name ILIKE $${params.push(`%${search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`)}` : '';
    const rows: { id: number; name: string; role: string | null }[] = await this.dataSource.query(
      `SELECT u.id, u.name, MIN(r.name) AS role FROM users u
       JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
       WHERE u.school_id = $1 AND u.deleted_at IS NULL AND u.status = 'active'
         AND r.code NOT IN ('PARENT', 'DRIVER', 'ATTENDANT', 'SUPER_ADMIN') ${filter}
       GROUP BY u.id, u.name ORDER BY u.name LIMIT 50`,
      params,
    );
    return rows.map((row) => ({ id: Number(row.id), name: row.name, role: row.role }));
  }

  async blocklist(schoolId: number): Promise<BlockDto[]> {
    const rows = await this.blocks.find({ where: { school_id: schoolId }, order: { is_active: 'DESC', id: 'DESC' } });
    const people = await this.core.people(rows.map((row) => row.created_by));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      mobile: row.mobile,
      reason: row.reason,
      is_active: row.is_active,
      added_by: row.created_by ? (people.get(row.created_by) ?? null) : null,
      created_at: row.created_at,
    }));
  }

  async addBlock(schoolId: number, dto: BlockInputDto, actor: AuthUser): Promise<BlockDto[]> {
    await this.blocks.save(
      this.blocks.create({
        school_id: schoolId,
        name: dto.name,
        mobile: dto.mobile ?? null,
        reason: dto.reason,
        is_active: dto.is_active ?? true,
        created_by: actor.id,
      }),
    );
    return this.blocklist(schoolId);
  }

  async updateBlock(schoolId: number, id: number, dto: UpdateBlockDto): Promise<BlockDto[]> {
    const row = await this.blocks.findOneBy({ id, school_id: schoolId });
    if (!row) throw AppException.notFound('Blocked entry not found', 'BLOCK_NOT_FOUND');
    const changes: Partial<GateBlock> = {};
    for (const key of ['name', 'mobile', 'reason', 'is_active'] as const) {
      if (dto[key] !== undefined) Object.assign(changes, { [key]: dto[key] });
    }
    await this.blocks.save(this.blocks.merge(row, changes));
    return this.blocklist(schoolId);
  }

  async removeBlock(schoolId: number, id: number): Promise<void> {
    const row = await this.blocks.findOneBy({ id, school_id: schoolId });
    if (!row) throw AppException.notFound('Blocked entry not found', 'BLOCK_NOT_FOUND');
    await this.blocks.softDelete(row.id);
  }

  @Interval('gate-visit-lifecycle', 60000)
  async lifecycle(): Promise<void> {
    const inside = await this.visits.find({ where: { status: 'inside' } });
    if (!inside.length) return;
    const now = this.core.nowTime();
    const today = this.core.today();
    for (const visit of inside) {
      const settings = await this.core.settings(visit.school_id);
      const pastClose = visit.visit_date < today || toMinutes(now) >= toMinutes(settings.visitor_checkout_time);
      if (pastClose) {
        await this.checkOut(visit.school_id, visit.id, 'auto', null).catch(() => undefined);
        continue;
      }
      if (!visit.overstay_alerted_at && visit.expected_until && isLateFor(visit, now, settings.visitor_checkout_time)) {
        await this.visits.update(visit.id, { overstay_alerted_at: new Date() });
        await this.core.log(
          visit.school_id,
          'visitor_overstay',
          { visit_id: visit.id },
          null,
          `${visit.name} past ${visit.expected_until}`,
        );
        await this.core.notify(
          'VISITOR_OVERSTAY',
          { roles: OFFICE_ROLES, school_id: visit.school_id },
          {
            visitor: visit.name,
            until: visit.expected_until,
            visit_id: visit.id,
          },
        );
      }
    }
  }

  private base(schoolId: number, dto: VisitorBaseDto) {
    return {
      school_id: schoolId,
      name: dto.name,
      mobile: dto.mobile,
      purpose: dto.purpose,
      purpose_note: dto.purpose_note ?? null,
      host_user_id: dto.host_user_id ?? null,
      student_id: dto.student_id ?? null,
      company: dto.company ?? null,
      people_count: dto.people_count ?? 1,
      vehicle_no: dto.vehicle_no ?? null,
    };
  }

  private async assertLinks(schoolId: number, dto: VisitorBaseDto): Promise<void> {
    if (dto.host_user_id) {
      const [host] = await this.dataSource.query(
        `SELECT id FROM users WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
        [dto.host_user_id, schoolId],
      );
      if (!host)
        throw AppException.validation([
          { field: 'host_user_id', message: 'host_user_id must be a staff member of this school' },
        ]);
    }
    if (dto.student_id) {
      const [student] = await this.dataSource.query(
        `SELECT id FROM students WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
        [dto.student_id, schoolId],
      );
      if (!student)
        throw AppException.validation([
          { field: 'student_id', message: 'student_id must be a student of this school' },
        ]);
    }
  }

  private async isBlocked(schoolId: number, name: string, mobile: string): Promise<GateBlock | null> {
    const blocks = await this.blocks.findBy({ school_id: schoolId, is_active: true });
    const hit = blockedMatch({ name, mobile }, blocks);
    return hit ? (hit as GateBlock) : null;
  }

  private async move(visit: GateVisit, status: VisitStatus, changes: Partial<GateVisit>): Promise<void> {
    const updated = await this.visits
      .createQueryBuilder()
      .update()
      .set({ ...changes, status })
      .where('id = :id AND status = :status', { id: visit.id, status: visit.status })
      .execute();
    if (!updated.affected)
      throw AppException.conflict('This visitor was just updated by someone else', 'VISIT_CHANGED');
  }

  private async find(schoolId: number, id: number): Promise<GateVisit> {
    const visit = await this.visits.findOneBy({ id, school_id: schoolId });
    if (!visit) throw AppException.notFound('Visitor not found', 'VISIT_NOT_FOUND');
    return visit;
  }
}
