import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AppException, AuthUser, listQuery, Paginated } from '@app/common';
import { yearClause } from '../../shared/year-context';
import { PERMISSIONS } from '../access/access.catalog';
import {
  AuthorisedPickupDto,
  AuthorisedPickupInputDto,
  CheckDto,
  CheckResultDto,
  ConsentRequestDto,
  DecisionDto,
  EmergencyDto,
  GatePassDto,
  GateStudentCardDto,
  PassQueryDto,
  PassRequestDto,
  PickupInputDto,
  ReleaseDto,
  StaffPassDto,
  UpdateAuthorisedPickupDto,
} from './dto/gate.dto';
import { AuthorisedPickup, GateBlock, GatePass, PassSource, PickupKind } from './entities/gate.entity';
import { GateCoreService, OFFICE_ROLES } from './gate-core.service';
import {
  blockedMatch,
  codeLocked,
  collectorError,
  PASS_VERDICT_TEXT,
  passVerdict,
  toMinutes,
  VISIT_VERDICT_TEXT,
  visitVerdict,
} from './gate.logic';
import { GateVisitsService } from './gate-visits.service';

const AFTERNOON_PERIOD = 5;
const MAX_DAYS_AHEAD = 30;

interface ResolvedPickup {
  pickup_kind: PickupKind | null;
  guardian_id: number | null;
  authorised_id: number | null;
  pickup_name: string | null;
  pickup_relation: string | null;
  pickup_mobile: string | null;
  pickup_photo_file_id: number | null;
}

const NO_PICKUP: ResolvedPickup = {
  pickup_kind: null,
  guardian_id: null,
  authorised_id: null,
  pickup_name: null,
  pickup_relation: null,
  pickup_mobile: null,
  pickup_photo_file_id: null,
};

const addMinutes = (time: string, minutes: number) => {
  const total = Math.min(toMinutes(time) + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

@Injectable()
export class GatePassesService {
  private readonly logger = new Logger('GatePasses');
  private readonly codeTries = new Map<number, number[]>();

  constructor(
    @InjectRepository(GatePass) private readonly passes: Repository<GatePass>,
    @InjectRepository(AuthorisedPickup) private readonly pickups: Repository<AuthorisedPickup>,
    @InjectRepository(GateBlock) private readonly blocks: Repository<GateBlock>,
    private readonly core: GateCoreService,
    private readonly visits: GateVisitsService,
    private readonly dataSource: DataSource,
  ) {}

  async list(schoolId: number, query: PassQueryDto): Promise<Paginated<GatePassDto>> {
    const qb = this.passes
      .createQueryBuilder('p')
      .leftJoin('students', 's', 's.id = p.student_id')
      .leftJoin('academic_years', 'ay', `ay.school_id = p.school_id AND ay.deleted_at IS NULL AND ${yearClause('ay')}`)
      .leftJoin('student_enrollments', 'e', 'e.student_id = p.student_id AND e.academic_year_id = ay.id')
      .where('p.school_id = :schoolId', { schoolId });
    if (query.from) qb.andWhere('p.pass_date >= :from', { from: query.from });
    if (query.to) qb.andWhere('p.pass_date <= :to', { to: query.to });
    if (query.status) qb.andWhere('p.status = :status', { status: query.status });
    if (query.source) qb.andWhere('p.source = :source', { source: query.source });
    if (query.method) qb.andWhere('p.release_method = :method', { method: query.method });
    if (query.emergency !== undefined) qb.andWhere('p.is_emergency = :emergency', { emergency: query.emergency });
    if (query.class_id) qb.andWhere('e.class_id = :classId', { classId: query.class_id });
    if (query.section_id) qb.andWhere('e.section_id = :sectionId', { sectionId: query.section_id });
    const page = await listQuery(qb, query, {
      searchable: ['p.pass_no', 'p.pickup_name', 'p.reason', 's.first_name', 's.last_name', 's.admission_no'],
      sortable: { pass_date: 'p.pass_date', created_at: 'p.created_at', released_at: 'p.released_at' },
      defaultSort: 'created_at',
    });
    return { ...page, items: await this.core.presentPasses(schoolId, page.items, true) };
  }

  async get(schoolId: number, id: number, reveal: boolean): Promise<GatePassDto> {
    return (await this.core.presentPasses(schoolId, [await this.find(schoolId, id)], reveal))[0]!;
  }

  async studentCard(schoolId: number, studentId: number): Promise<GateStudentCardDto> {
    const today = this.core.today();
    const [students, people, rows, absent] = await Promise.all([
      this.core.students(schoolId, [studentId]),
      this.core.peopleFor(schoolId, [studentId], today),
      this.passes.find({
        where: { school_id: schoolId, student_id: studentId, pass_date: today },
        order: { id: 'DESC' },
      }),
      this.core.absentToday(studentId),
    ]);
    const student = students.get(studentId);
    if (!student) throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');
    const files = await this.core.presentFiles([student.photo_file_id, ...people.map((row) => row.photo_file_id)]);
    return {
      student: this.core.studentView(student, studentId, files),
      people: people.map((row) => this.core.personView(row, files)),
      today_passes: await this.core.presentPasses(schoolId, rows, false),
      absent_today: absent,
    };
  }

  async searchStudents(schoolId: number, search: string): Promise<GateStudentCardDto[]> {
    const ids = await this.core.searchStudents(schoolId, search);
    return Promise.all(ids.map((id) => this.studentCard(schoolId, id)));
  }

  async forParent(user: AuthUser, studentId: number): Promise<GatePassDto[]> {
    const schoolId = await this.child(user, studentId);
    const rows = await this.passes.find({
      where: { school_id: schoolId, student_id: studentId },
      order: { pass_date: 'DESC', id: 'DESC' },
      take: 30,
    });
    return this.core.presentPasses(schoolId, rows, true);
  }

  async requestByParent(user: AuthUser, studentId: number, dto: PassRequestDto): Promise<GatePassDto> {
    const schoolId = await this.child(user, studentId);
    return this.createPass(schoolId, studentId, dto, user, 'parent', false);
  }

  async cancelByParent(user: AuthUser, studentId: number, passId: number): Promise<GatePassDto> {
    const schoolId = await this.child(user, studentId);
    const pass = await this.find(schoolId, passId);
    if (pass.student_id !== studentId) throw AppException.notFound('Gate pass not found', 'GATE_PASS_NOT_FOUND');
    return this.cancel(schoolId, pass, user);
  }

  async createByStaff(schoolId: number, dto: StaffPassDto, actor: AuthUser, source: PassSource): Promise<GatePassDto> {
    const students = await this.core.students(schoolId, [dto.student_id]);
    const student = students.get(dto.student_id);
    if (!student) throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');
    if (dto.approve_now) this.assertCanDecide(actor, student.class_teacher_user_id);
    return this.createPass(schoolId, dto.student_id, dto, actor, source, Boolean(dto.approve_now));
  }

  async toApprove(schoolId: number, actor: AuthUser): Promise<GatePassDto[]> {
    const rows = await this.passes.find({
      where: { school_id: schoolId, status: 'pending' },
      order: { is_emergency: 'DESC', pass_date: 'ASC', id: 'ASC' },
      take: 100,
    });
    if (this.isOffice(actor)) return this.core.presentPasses(schoolId, rows, false);
    const students = await this.core.students(
      schoolId,
      rows.map((row) => row.student_id),
    );
    return this.core.presentPasses(
      schoolId,
      rows.filter((row) => students.get(row.student_id)?.class_teacher_user_id === actor.id),
      false,
    );
  }

  async decide(schoolId: number, id: number, dto: DecisionDto, actor: AuthUser): Promise<GatePassDto> {
    const pass = await this.find(schoolId, id);
    if (pass.status !== 'pending') {
      throw AppException.conflict('Someone already decided this gate pass', 'PASS_ALREADY_DECIDED');
    }
    const student = (await this.core.students(schoolId, [pass.student_id])).get(pass.student_id);
    this.assertCanDecide(actor, student?.class_teacher_user_id ?? null);
    if (dto.approve && pass.needs_consent && pass.consent_status !== 'approved') {
      throw AppException.conflict('Wait until a parent agrees in the app', 'CONSENT_PENDING');
    }
    const updated = await this.passes
      .createQueryBuilder()
      .update()
      .set({
        status: dto.approve ? 'approved' : 'rejected',
        decided_by: actor.id,
        decided_at: new Date(),
        decision_note: dto.note ?? null,
      })
      .where('id = :id AND status = :pending', { id, pending: 'pending' })
      .execute();
    if (!updated.affected)
      throw AppException.conflict('Someone already decided this gate pass', 'PASS_ALREADY_DECIDED');
    await this.core.log(
      schoolId,
      dto.approve ? 'pass_approved' : 'pass_rejected',
      { pass_id: id, student_id: pass.student_id },
      actor.id,
      `${pass.pass_no}${dto.note ? ` · ${dto.note}` : ''}`,
    );
    const view = await this.get(schoolId, id, true);
    if (pass.is_emergency && pass.requested_by) {
      await this.core.notify(
        'GATE_REQUEST_ANSWERED',
        { user_ids: [pass.requested_by] },
        {
          student: view.student.name,
          class_section: view.student.class_section ?? '',
          decision: dto.approve ? 'approved: send the student to the gate' : 'refused: do not release',
          by: actor.name,
          pass_id: id,
        },
      );
    }
    if (!pass.is_emergency) {
      await this.core.notify(
        'GATE_PASS_DECIDED',
        { user_ids: await this.core.parentUsers(pass.student_id) },
        {
          student: view.student.name,
          decision: dto.approve ? 'approved' : 'not approved',
          date: pass.pass_date,
          from: pass.from_time,
          until: pass.until_time,
          code: dto.approve ? pass.code : '',
          note: dto.note ?? '',
          pass_id: id,
        },
      );
    }
    return view;
  }

  async cancelByStaff(schoolId: number, id: number, actor: AuthUser): Promise<GatePassDto> {
    return this.cancel(schoolId, await this.find(schoolId, id), actor);
  }

  async check(schoolId: number, dto: CheckDto, actor: AuthUser): Promise<CheckResultDto> {
    if (!dto.qr && !dto.code && !dto.number) {
      throw AppException.validation([{ field: 'qr', message: 'Scan the QR, or type the code or the pass number' }]);
    }
    if (dto.code) this.assertNotLocked(actor.id);
    const today = this.core.today();
    let pass: GatePass | null = null;
    let visitId: number | null = null;
    let method: 'qr' | 'code' | 'manual' = 'manual';
    if (dto.qr) {
      method = 'qr';
      const read = this.core.readQr(dto.qr);
      if (read?.kind === 'p') {
        pass = await this.passes.findOneBy({ id: read.id, school_id: schoolId });
        if (pass && pass.qr_version !== read.version) pass = null;
      }
      if (read?.kind === 'v') visitId = await this.visits.idForQr(schoolId, read.id, read.version);
    } else if (dto.code) {
      method = 'code';
      pass = await this.passes.findOne({
        where: { school_id: schoolId, pass_date: today, code: dto.code },
        order: { id: 'DESC' },
      });
      if (!pass) visitId = await this.visits.idForCode(schoolId, today, dto.code);
    } else if (dto.number) {
      pass = await this.passes.findOneBy({ school_id: schoolId, pass_no: dto.number });
      if (!pass) visitId = await this.visits.idForNumber(schoolId, dto.number);
    }
    if (visitId) {
      const visit = await this.visits.view(schoolId, visitId, false);
      const verdict = visitVerdict(visit, today);
      return {
        ok: verdict === 'ok_in' || verdict === 'ok_out',
        kind: 'visit',
        verdict,
        message: VISIT_VERDICT_TEXT[verdict],
        pass: null,
        visit,
      };
    }
    if (!pass) {
      if (dto.code) this.countTry(actor.id);
      await this.core.log(schoolId, 'check_failed', {}, actor.id, 'Not a school pass', method);
      return {
        ok: false,
        kind: 'pass',
        verdict: 'not_found',
        message: 'Not a school pass or visitor slip. Do not release.',
        pass: null,
        visit: null,
      };
    }
    const settings = await this.core.settings(schoolId);
    const verdict = passVerdict(
      pass,
      today,
      this.core.nowTime(),
      settings.grace_minutes,
      await this.core.absentToday(pass.student_id),
    );
    await this.core.log(
      schoolId,
      verdict === 'ok' ? 'pass_checked' : 'check_failed',
      { pass_id: pass.id, student_id: pass.student_id },
      actor.id,
      `${pass.pass_no} · ${verdict}`,
      method,
    );
    return {
      ok: verdict === 'ok',
      kind: 'pass',
      verdict,
      message: PASS_VERDICT_TEXT[verdict],
      pass: (await this.core.presentPasses(schoolId, [pass], false))[0]!,
      visit: null,
    };
  }

  async release(schoolId: number, id: number, dto: ReleaseDto, actor: AuthUser): Promise<GatePassDto> {
    if (dto.method === 'manual') {
      const missing = [
        ...(!dto.photo_file_id
          ? [{ field: 'photo_file_id', message: 'Take a photo of the person for a manual check' }]
          : []),
        ...(!dto.id_proof_kind ? [{ field: 'id_proof_kind', message: 'Choose the ID proof the person showed' }] : []),
        ...(!dto.id_proof_last4 ? [{ field: 'id_proof_last4', message: 'Type the last 4 characters of the ID' }] : []),
      ];
      if (missing.length) throw AppException.validation(missing);
    }
    const pass = await this.find(schoolId, id);
    const settings = await this.core.settings(schoolId);
    const verdict = passVerdict(
      pass,
      this.core.today(),
      this.core.nowTime(),
      settings.grace_minutes,
      await this.core.absentToday(pass.student_id),
    );
    if (verdict !== 'ok') throw AppException.conflict(PASS_VERDICT_TEXT[verdict], `PASS_${verdict.toUpperCase()}`);
    await this.core.assertFile(dto.photo_file_id, schoolId, 'photo_file_id');
    const updated = await this.passes
      .createQueryBuilder()
      .update()
      .set({
        status: 'released',
        released_at: new Date(),
        released_by: actor.id,
        release_method: dto.method,
        release_photo_file_id: dto.photo_file_id ?? null,
        id_proof_kind: dto.id_proof_kind ?? pass.id_proof_kind,
        id_proof_last4: dto.id_proof_last4?.toUpperCase() ?? pass.id_proof_last4,
      })
      .where('id = :id AND status = :approved', { id, approved: 'approved' })
      .execute();
    if (!updated.affected) throw AppException.conflict(PASS_VERDICT_TEXT.used, 'PASS_USED');
    const leaveId = pass.pickup_kind ? await this.markHalfDay(schoolId, pass, actor) : null;
    if (leaveId) await this.passes.update(id, { leave_id: leaveId });
    const view = await this.get(schoolId, id, false);
    await this.core.log(
      schoolId,
      'released',
      { pass_id: id, student_id: pass.student_id },
      actor.id,
      `${pass.pass_no} · ${view.student.name}${view.student.class_section ? ` (${view.student.class_section})` : ''} ${pass.pickup_name ? `to ${pass.pickup_name}` : '(visit)'}`,
      dto.method,
    );
    const time = this.core.nowTime();
    await this.core.notify(
      'GATE_RELEASED',
      { user_ids: await this.core.parentUsers(pass.student_id) },
      {
        student: view.student.name,
        time,
        person: pass.pickup_name ?? '',
        relation: pass.pickup_relation ?? '',
        method:
          dto.method === 'manual'
            ? 'checked by hand at the gate'
            : dto.method === 'code'
              ? 'checked with the code'
              : 'QR scanned',
        pass_id: id,
      },
    );
    if (dto.method === 'manual' && settings.notify_office_on_manual) {
      await this.core.notify(
        'GATE_MANUAL_RELEASE',
        { roles: OFFICE_ROLES, school_id: schoolId },
        {
          student: view.student.name,
          person: pass.pickup_name ?? '',
          time,
          by: actor.name,
          pass_id: id,
        },
      );
    }
    return view;
  }

  async emergency(schoolId: number, dto: EmergencyDto, actor: AuthUser): Promise<GatePassDto> {
    const student = (await this.core.students(schoolId, [dto.student_id])).get(dto.student_id);
    if (!student) throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');
    if (dto.pickup.kind === 'other') {
      if (!dto.pickup.photo_file_id) {
        throw AppException.validation([{ field: 'pickup.photo_file_id', message: 'Take a photo of the person' }]);
      }
      const blocks = await this.blocks.findBy({ school_id: schoolId, is_active: true });
      const hit = blockedMatch({ name: dto.pickup.name!, mobile: dto.pickup.mobile! }, blocks);
      if (hit) {
        await this.core.log(
          schoolId,
          'blocked_person',
          { student_id: dto.student_id },
          actor.id,
          `${dto.pickup.name} for ${student.name}`,
        );
        await this.core.notify(
          'GATE_BLOCKED_PERSON',
          { roles: OFFICE_ROLES, school_id: schoolId },
          {
            person: dto.pickup.name!,
            mobile: dto.pickup.mobile!,
            purpose: `to take ${student.name}`,
          },
        );
        throw AppException.forbidden(
          'This person is on the blocked list. Do not release. The office has been told.',
          'PERSON_BLOCKED',
        );
      }
    }
    const open = await this.passes.findOneBy({
      school_id: schoolId,
      student_id: dto.student_id,
      is_emergency: true,
      status: 'pending',
    });
    if (open)
      throw AppException.conflict('An emergency request for this student is already waiting', 'EMERGENCY_WAITING');
    const now = this.core.nowTime();
    const view = await this.createPass(
      schoolId,
      dto.student_id,
      {
        pass_date: this.core.today(),
        from_time: now,
        until_time: addMinutes(now, 60),
        reason: dto.reason,
        pickup: dto.pickup,
      },
      actor,
      'gate',
      false,
      { is_emergency: true, id_proof_kind: dto.id_proof_kind ?? null, id_proof_last4: dto.id_proof_last4 ?? null },
    );
    const data = {
      student: view.student.name,
      class_section: view.student.class_section ?? '',
      person: `${view.pickup!.name}${view.pickup!.relation ? ` (${view.pickup!.relation})` : ''}`,
      reason: dto.reason,
      pass_id: view.id,
    };
    if (student.class_teacher_user_id)
      await this.core.notify('GATE_EMERGENCY', { user_ids: [student.class_teacher_user_id] }, data);
    await this.core.notify('GATE_EMERGENCY', { roles: OFFICE_ROLES, school_id: schoolId }, data);
    if (view.needs_consent) {
      await this.core.notify('GATE_CONSENT_NEEDED', { user_ids: await this.core.parentUsers(dto.student_id) }, data);
      await this.core.log(
        schoolId,
        'consent_asked',
        { pass_id: view.id, student_id: dto.student_id },
        actor.id,
        view.pickup!.name,
      );
    }
    return view;
  }

  async consents(user: AuthUser): Promise<ConsentRequestDto[]> {
    const rows: { id: number; school_id: number }[] = await this.dataSource.query(
      `SELECT DISTINCT p.id, p.school_id FROM gate_passes p
       JOIN student_guardians sg ON sg.student_id = p.student_id
       JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL AND g.user_id = $1
       WHERE p.needs_consent = true AND p.deleted_at IS NULL AND p.pass_date = $2
       ORDER BY p.id DESC`,
      [user.id, this.core.today()],
    );
    if (!rows.length) return [];
    const schoolId = Number(rows[0]!.school_id);
    const passes = await this.passes.findBy({ id: In(rows.map((row) => Number(row.id))) });
    const views = await this.core.presentPasses(schoolId, passes, false);
    return passes
      .sort((a, b) => b.id - a.id)
      .map((pass) => {
        const view = views.find((item) => item.id === pass.id)!;
        return {
          pass_id: pass.id,
          student: view.student,
          person: view.pickup!,
          reason: pass.reason,
          status: pass.consent_status ?? 'waiting',
          code: pass.consent_status === 'approved' && pass.consent_by === user.id ? pass.consent_code : null,
          asked_at: pass.created_at,
        };
      });
  }

  async consentDecision(user: AuthUser, passId: number, approve: boolean): Promise<ConsentRequestDto> {
    const [row] = await this.dataSource.query(
      `SELECT p.id, p.school_id FROM gate_passes p
       JOIN student_guardians sg ON sg.student_id = p.student_id
       JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL AND g.user_id = $1
       WHERE p.id = $2 AND p.needs_consent = true AND p.deleted_at IS NULL LIMIT 1`,
      [user.id, passId],
    );
    if (!row) throw AppException.notFound('Request not found', 'CONSENT_NOT_FOUND');
    const schoolId = Number(row.school_id);
    const pass = await this.find(schoolId, passId);
    if (pass.consent_status !== 'waiting' || pass.status !== 'pending') {
      throw AppException.conflict('This request was already answered', 'CONSENT_ANSWERED');
    }
    await this.passes.update(pass.id, {
      consent_status: approve ? 'approved' : 'rejected',
      consent_by: user.id,
      consent_at: new Date(),
      ...(approve
        ? {}
        : {
            status: 'rejected' as const,
            decided_by: user.id,
            decided_at: new Date(),
            decision_note: 'The parent refused',
          }),
    });
    await this.core.log(
      schoolId,
      approve ? 'consent_approved' : 'consent_rejected',
      { pass_id: pass.id, student_id: pass.student_id },
      user.id,
      pass.pickup_name,
    );
    const view = await this.get(schoolId, pass.id, false);
    const data = {
      student: view.student.name,
      class_section: view.student.class_section ?? '',
      person: pass.pickup_name ?? '',
      reason: pass.reason,
      pass_id: pass.id,
    };
    if (approve) {
      await this.core.notify('GATE_CONSENT_GIVEN', { roles: OFFICE_ROLES, school_id: schoolId }, data);
    } else if (pass.requested_by) {
      await this.core.notify(
        'GATE_REQUEST_ANSWERED',
        { user_ids: [pass.requested_by] },
        {
          ...data,
          decision: 'refused by the parent: do not release',
          by: user.name,
        },
      );
    }
    return (await this.consents(user)).find((item) => item.pass_id === pass.id)!;
  }

  async verifyConsent(schoolId: number, id: number, code: string, actor: AuthUser): Promise<GatePassDto> {
    this.assertNotLocked(actor.id);
    const pass = await this.find(schoolId, id);
    if (!pass.needs_consent) throw AppException.conflict('This pass does not need a parent code', 'NO_CONSENT_NEEDED');
    if (pass.consent_status !== 'approved') {
      throw AppException.conflict('The parent has not agreed yet', 'CONSENT_PENDING');
    }
    if (pass.consent_code !== code) {
      this.countTry(actor.id);
      await this.core.log(
        schoolId,
        'check_failed',
        { pass_id: id, student_id: pass.student_id },
        actor.id,
        'Wrong parent code',
        'code',
      );
      throw AppException.badRequest('Wrong code. Ask the person to check with the parent.', 'WRONG_CODE');
    }
    await this.passes.update(id, { consent_verified_at: new Date() });
    await this.core.log(
      schoolId,
      'consent_verified',
      { pass_id: id, student_id: pass.student_id },
      actor.id,
      pass.pickup_name,
      'code',
    );
    return this.get(schoolId, id, false);
  }

  async authorisedFor(schoolId: number, studentId: number): Promise<AuthorisedPickupDto[]> {
    const rows = await this.pickups.find({
      where: { school_id: schoolId, student_id: studentId },
      order: { id: 'ASC' },
    });
    return this.presentPickups(rows);
  }

  async authorisedForParent(user: AuthUser, studentId: number): Promise<AuthorisedPickupDto[]> {
    return this.authorisedFor(await this.child(user, studentId), studentId);
  }

  async addAuthorised(
    schoolId: number,
    studentId: number,
    dto: AuthorisedPickupInputDto,
    actor: AuthUser,
  ): Promise<AuthorisedPickupDto> {
    await this.core.assertFile(dto.photo_file_id, schoolId, 'photo_file_id');
    if (dto.valid_until && dto.valid_until < this.core.today()) {
      throw AppException.validation([{ field: 'valid_until', message: 'valid_until cannot be in the past' }]);
    }
    const count = await this.pickups.count({ where: { school_id: schoolId, student_id: studentId, is_active: true } });
    if (count >= 6) throw AppException.conflict('A student can have up to 6 pickup persons', 'TOO_MANY_PICKUPS');
    const saved = await this.pickups.save(
      this.pickups.create({
        school_id: schoolId,
        student_id: studentId,
        name: dto.name,
        relation: dto.relation,
        mobile: dto.mobile,
        photo_file_id: dto.photo_file_id ?? null,
        valid_until: dto.valid_until ?? null,
        is_active: true,
        created_by: actor.id,
      }),
    );
    return (await this.presentPickups([saved]))[0]!;
  }

  async addAuthorisedByParent(
    user: AuthUser,
    studentId: number,
    dto: AuthorisedPickupInputDto,
  ): Promise<AuthorisedPickupDto> {
    return this.addAuthorised(await this.child(user, studentId), studentId, dto, user);
  }

  async updateAuthorised(
    schoolId: number,
    studentId: number | null,
    id: number,
    dto: UpdateAuthorisedPickupDto,
  ): Promise<AuthorisedPickupDto> {
    const row = await this.pickups.findOneBy({
      id,
      school_id: schoolId,
      ...(studentId ? { student_id: studentId } : {}),
    });
    if (!row) throw AppException.notFound('Pickup person not found', 'PICKUP_NOT_FOUND');
    if (dto.photo_file_id && dto.photo_file_id !== row.photo_file_id)
      await this.core.assertFile(dto.photo_file_id, schoolId, 'photo_file_id');
    const changes: Partial<AuthorisedPickup> = {};
    for (const key of ['name', 'relation', 'mobile', 'photo_file_id', 'valid_until', 'is_active'] as const) {
      if (dto[key] !== undefined) Object.assign(changes, { [key]: dto[key] });
    }
    await this.pickups.save(this.pickups.merge(row, changes));
    return (await this.presentPickups([await this.pickups.findOneByOrFail({ id })]))[0]!;
  }

  async updateAuthorisedByParent(user: AuthUser, studentId: number, id: number, dto: UpdateAuthorisedPickupDto) {
    return this.updateAuthorised(await this.child(user, studentId), studentId, id, dto);
  }

  async removeAuthorised(schoolId: number, studentId: number | null, id: number): Promise<void> {
    const row = await this.pickups.findOneBy({
      id,
      school_id: schoolId,
      ...(studentId ? { student_id: studentId } : {}),
    });
    if (!row) throw AppException.notFound('Pickup person not found', 'PICKUP_NOT_FOUND');
    await this.pickups.softDelete(row.id);
  }

  async removeAuthorisedByParent(user: AuthUser, studentId: number, id: number): Promise<void> {
    await this.removeAuthorised(await this.child(user, studentId), studentId, id);
  }

  @Interval('gate-pass-lifecycle', 60000)
  async lifecycle(): Promise<void> {
    const expired: { id: number; school_id: number; student_id: number; pass_no: string }[] = await this.dataSource
      .query(
        `UPDATE gate_passes p SET status = 'expired', updated_at = now()
         FROM (SELECT p2.id FROM gate_passes p2
               LEFT JOIN gate_settings gs ON gs.school_id = p2.school_id
               WHERE p2.status IN ('pending', 'approved') AND p2.deleted_at IS NULL
                 AND (p2.pass_date + p2.until_time::time + make_interval(mins => COALESCE(gs.grace_minutes, 30)))
                     < (now() AT TIME ZONE $1)) due
         WHERE p.id = due.id
         RETURNING p.id, p.school_id, p.student_id, p.pass_no`,
        [this.core.timeZone],
      )
      .then((result: unknown[]) => (Array.isArray(result[0]) ? (result[0] as never) : (result as never)));
    for (const row of expired) {
      await this.core.log(
        Number(row.school_id),
        'pass_expired',
        { pass_id: Number(row.id), student_id: Number(row.student_id) },
        null,
        row.pass_no,
      );
    }
    const late: { id: number; school_id: number; student_id: number; requested_by: number | null }[] =
      await this.dataSource
        .query(
          `UPDATE gate_passes p SET escalated_at = now()
         FROM gate_passes p2 LEFT JOIN gate_settings gs ON gs.school_id = p2.school_id
         WHERE p.id = p2.id AND p.status = 'pending' AND p.is_emergency = true AND p.escalated_at IS NULL
           AND p.created_at < now() - make_interval(mins => COALESCE(gs.emergency_wait_minutes, 10))
         RETURNING p.id, p.school_id, p.student_id, p.requested_by`,
        )
        .then((result: unknown[]) => (Array.isArray(result[0]) ? (result[0] as never) : (result as never)));
    for (const row of late) {
      const schoolId = Number(row.school_id);
      await this.core.log(
        schoolId,
        'emergency_escalated',
        { pass_id: Number(row.id), student_id: Number(row.student_id) },
        null,
      );
      const view = await this.get(schoolId, Number(row.id), false).catch(() => null);
      if (row.requested_by && view) {
        await this.core.notify(
          'GATE_NO_ANSWER',
          { user_ids: [Number(row.requested_by)] },
          {
            student: view.student.name,
            person: view.pickup?.name ?? '',
            pass_id: view.id,
          },
        );
      }
    }
  }

  private async createPass(
    schoolId: number,
    studentId: number,
    dto: PassRequestDto,
    actor: AuthUser,
    source: PassSource,
    approveNow: boolean,
    extra: { is_emergency?: boolean; id_proof_kind?: GatePass['id_proof_kind']; id_proof_last4?: string | null } = {},
  ): Promise<GatePassDto> {
    const today = this.core.today();
    const errors = [];
    if (dto.pass_date < today) errors.push({ field: 'pass_date', message: 'pass_date cannot be in the past' });
    const limit = new Date(Date.parse(`${today}T00:00:00Z`) + MAX_DAYS_AHEAD * 86400000).toISOString().slice(0, 10);
    if (dto.pass_date > limit)
      errors.push({ field: 'pass_date', message: `pass_date can be at most ${MAX_DAYS_AHEAD} days ahead` });
    const until = dto.until_time ?? addMinutes(dto.from_time, 120);
    if (toMinutes(until) <= toMinutes(dto.from_time)) {
      errors.push({ field: 'until_time', message: 'until_time must be after from_time' });
    }
    if (errors.length) throw AppException.validation(errors);
    const passType = dto.pass_type ?? 'pickup';
    const collectorMessage = collectorError(passType, Boolean(dto.pickup));
    if (collectorMessage) throw AppException.validation([{ field: 'pickup', message: collectorMessage }]);
    const pickup = dto.pickup ? await this.resolvePickup(schoolId, studentId, dto.pickup, dto.pass_date) : NO_PICKUP;
    await this.core.assertFile(pickup.pickup_photo_file_id, schoolId, 'pickup.photo_file_id');
    const needsConsent = Boolean(extra.is_emergency) && pickup.pickup_kind === 'other';
    const passNo = await this.core.nextNumber(schoolId, 'gate_passes', 'GP', dto.pass_date);
    const saved = await this.passes.save(
      this.passes.create({
        school_id: schoolId,
        pass_no: passNo,
        student_id: studentId,
        pass_date: dto.pass_date,
        from_time: dto.from_time,
        until_time: until,
        reason: dto.reason,
        pass_type: passType,
        ...pickup,
        status: approveNow ? 'approved' : 'pending',
        source,
        is_emergency: Boolean(extra.is_emergency),
        needs_consent: needsConsent,
        consent_status: needsConsent ? 'waiting' : null,
        consent_code: needsConsent ? await this.core.freeCode(schoolId, dto.pass_date) : null,
        requested_by: actor.id,
        decided_by: approveNow ? actor.id : null,
        decided_at: approveNow ? new Date() : null,
        code: await this.core.freeCode(schoolId, dto.pass_date),
        id_proof_kind: extra.id_proof_kind ?? null,
        id_proof_last4: extra.id_proof_last4?.toUpperCase() ?? null,
        created_by: actor.id,
      }),
    );
    await this.core.log(
      schoolId,
      extra.is_emergency ? 'emergency_raised' : 'pass_requested',
      { pass_id: saved.id, student_id: studentId },
      actor.id,
      `${passNo} · ${dto.reason}`,
    );
    if (approveNow)
      await this.core.log(schoolId, 'pass_approved', { pass_id: saved.id, student_id: studentId }, actor.id, passNo);
    const view = await this.get(schoolId, saved.id, true);
    if (!extra.is_emergency && !approveNow) {
      const student = (await this.core.students(schoolId, [studentId])).get(studentId);
      const data = {
        student: view.student.name,
        class_section: view.student.class_section ?? '',
        date: dto.pass_date,
        from: dto.from_time,
        reason: dto.reason,
        pass_id: saved.id,
      };
      if (student?.class_teacher_user_id)
        await this.core.notify('GATE_PASS_REQUESTED', { user_ids: [student.class_teacher_user_id] }, data);
      await this.core.notify('GATE_PASS_REQUESTED', { roles: OFFICE_ROLES, school_id: schoolId }, data);
    }
    if (approveNow) {
      await this.core.notify(
        'GATE_PASS_DECIDED',
        { user_ids: await this.core.parentUsers(studentId) },
        {
          student: view.student.name,
          decision: 'approved',
          date: dto.pass_date,
          from: dto.from_time,
          until,
          code: saved.code,
          note: '',
          pass_id: saved.id,
        },
      );
    }
    return view;
  }

  private async resolvePickup(
    schoolId: number,
    studentId: number,
    pickup: PickupInputDto,
    onDate: string,
  ): Promise<ResolvedPickup> {
    if (pickup.kind === 'other') {
      return {
        pickup_kind: 'other',
        guardian_id: null,
        authorised_id: null,
        pickup_name: pickup.name!,
        pickup_relation: pickup.relation ?? null,
        pickup_mobile: pickup.mobile ?? null,
        pickup_photo_file_id: pickup.photo_file_id ?? null,
      };
    }
    const people = await this.core.peopleFor(schoolId, [studentId], onDate);
    const person = people.find(
      (row) =>
        row.kind === pickup.kind && row.id === (pickup.kind === 'guardian' ? pickup.guardian_id : pickup.authorised_id),
    );
    if (!person) {
      throw AppException.validation([
        {
          field: pickup.kind === 'guardian' ? 'pickup.guardian_id' : 'pickup.authorised_id',
          message:
            pickup.kind === 'guardian'
              ? 'This parent is not allowed to pick up the student'
              : 'This pickup person is not saved for the student, or is no longer valid',
        },
      ]);
    }
    return {
      pickup_kind: pickup.kind,
      guardian_id: pickup.kind === 'guardian' ? person.id : null,
      authorised_id: pickup.kind === 'authorised' ? person.id : null,
      pickup_name: person.name,
      pickup_relation: person.relation,
      pickup_mobile: person.mobile,
      pickup_photo_file_id: pickup.photo_file_id ?? null,
    };
  }

  private async cancel(schoolId: number, pass: GatePass, actor: AuthUser): Promise<GatePassDto> {
    if (!['pending', 'approved'].includes(pass.status)) {
      throw AppException.conflict('Only a waiting or approved pass can be cancelled', 'PASS_NOT_CANCELLABLE');
    }
    await this.passes.update(pass.id, { status: 'cancelled', decided_by: actor.id, decided_at: new Date() });
    await this.core.log(
      schoolId,
      'pass_cancelled',
      { pass_id: pass.id, student_id: pass.student_id },
      actor.id,
      pass.pass_no,
    );
    return this.get(schoolId, pass.id, true);
  }

  private async markHalfDay(schoolId: number, pass: GatePass, actor: AuthUser): Promise<number | null> {
    const today = this.core.today();
    const [afternoon] = await this.dataSource.query(
      `SELECT 1 FROM attendance_records WHERE student_id = $1 AND date = $2 AND period >= $3 LIMIT 1`,
      [pass.student_id, today, AFTERNOON_PERIOD],
    );
    const [leave] = await this.dataSource.query(
      `SELECT 1 FROM student_leave_requests WHERE student_id = $1 AND status = 'approved' AND deleted_at IS NULL
         AND from_date <= $2 AND to_date >= $2 LIMIT 1`,
      [pass.student_id, today],
    );
    if (afternoon || leave) return null;
    const [row] = await this.dataSource.query(
      `INSERT INTO student_leave_requests (school_id, student_id, from_date, to_date, half_day, reason, status, decided_by, decided_at, decision_note, created_by)
       VALUES ($1, $2, $3, $3, 'afternoon', $4, 'approved', $5, now(), $6, $5) RETURNING id`,
      [schoolId, pass.student_id, today, `Left with a gate pass: ${pass.reason}`.slice(0, 500), actor.id, pass.pass_no],
    );
    return row ? Number(row.id) : null;
  }

  private assertCanDecide(actor: AuthUser, classTeacherId: number | null): void {
    if (this.isOffice(actor) || classTeacherId === actor.id) return;
    throw AppException.forbidden('Only the class teacher or the office can decide this gate pass', 'NOT_CLASS_TEACHER');
  }

  private isOffice(actor: AuthUser): boolean {
    return actor.permissions.includes(PERMISSIONS.GATE_MANAGE);
  }

  private assertNotLocked(userId: number): void {
    if (codeLocked(this.codeTries.get(userId) ?? [], Date.now())) {
      throw new AppException(429, 'Too many wrong codes. Wait 10 minutes or scan the QR.', 'TOO_MANY_TRIES');
    }
  }

  private countTry(userId: number): void {
    const now = Date.now();
    this.codeTries.set(userId, [...(this.codeTries.get(userId) ?? []).filter((at) => now - at < 600000), now]);
  }

  private async child(user: AuthUser, studentId: number): Promise<number> {
    const [row] = await this.dataSource.query(
      `SELECT s.school_id FROM student_guardians sg
       JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
       JOIN students s ON s.id = sg.student_id AND s.deleted_at IS NULL AND s.status = 'active'
       WHERE g.user_id = $1 AND sg.student_id = $2 LIMIT 1`,
      [user.id, studentId],
    );
    if (!row) throw AppException.notFound('This child is not linked to your mobile number', 'CHILD_NOT_FOUND');
    return Number(row.school_id);
  }

  private async find(schoolId: number, id: number): Promise<GatePass> {
    const pass = await this.passes.findOneBy({ id, school_id: schoolId });
    if (!pass) throw AppException.notFound('Gate pass not found', 'GATE_PASS_NOT_FOUND');
    return pass;
  }

  private async presentPickups(rows: AuthorisedPickup[]): Promise<AuthorisedPickupDto[]> {
    if (!rows.length) return [];
    const [files, people] = await Promise.all([
      this.core.presentFiles(rows.map((row) => row.photo_file_id)),
      this.core.people(rows.map((row) => row.created_by)),
    ]);
    return rows.map((row) => ({
      id: row.id,
      student_id: row.student_id,
      name: row.name,
      relation: row.relation,
      mobile: row.mobile,
      photo: row.photo_file_id ? (files.get(row.photo_file_id) ?? null) : null,
      valid_until: row.valid_until,
      is_active: row.is_active,
      added_by: row.created_by ? (people.get(row.created_by) ?? null) : null,
    }));
  }
}
