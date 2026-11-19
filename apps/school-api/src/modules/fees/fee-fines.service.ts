import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AppException, AuthUser, listQuery, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { NotificationsService } from '../notifications/notifications.service';
import { rupees } from '../payroll/payroll.calc';
import { BehaviourNote } from '../student-records/entities/behaviour-note.entity';
import { Student } from '../students/entities/student.entity';
import {
  ApproveFineDto,
  FineDto,
  FineInputDto,
  FineQueryDto,
  FineTypeDto,
  FineTypeInputDto,
  FineTypeQueryDto,
  RejectFineDto,
  UpdateFineTypeDto,
} from './dto/fee-fines.dto';
import { FeeFineType } from './entities/fee-fine-type.entity';
import { FeeFine, FineStatus } from './entities/fee-fine.entity';
import { FeeInvoice } from './entities/fee-invoice.entity';
import { recordFeeAudit } from './fee-audit';
import { applyCredit } from './fee-credits';
import { fineAction, fineDueDate, fineInstallment, resolveFine } from './fee-fines.logic';
import { createOneOffInvoice, FeeYear, nextFineNumber } from './fee-ledger';
import { shortDate } from './fees.logic';
import { FeesService } from './fees.service';

const TYPE_FIELDS = ['name', 'default_amount', 'description', 'is_active'] as const;

@Injectable()
export class FeeFinesService {
  constructor(
    @InjectRepository(FeeFine) private readonly fines: Repository<FeeFine>,
    @InjectRepository(FeeFineType) private readonly types: Repository<FeeFineType>,
    private readonly fees: FeesService,
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async listTypes(schoolId: number, query: FineTypeQueryDto): Promise<FineTypeDto[]> {
    const rows = await this.types.find({
      where: { school_id: schoolId, ...(query.active ? { is_active: true } : {}) },
      order: { is_active: 'DESC', name: 'ASC' },
    });
    const counts: { fine_type_id: number; fines: number }[] = rows.length
      ? await this.dataSource.query(
          `SELECT fine_type_id, count(*)::int AS fines FROM fee_fines
           WHERE fine_type_id = ANY($1) AND deleted_at IS NULL GROUP BY fine_type_id`,
          [rows.map((row) => row.id)],
        )
      : [];
    const used = new Map(counts.map((row) => [Number(row.fine_type_id), Number(row.fines)]));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      default_amount: row.default_amount,
      description: row.description,
      is_active: row.is_active,
      fines: used.get(row.id) ?? 0,
    }));
  }

  async createType(schoolId: number, dto: FineTypeInputDto, actor: AuthUser): Promise<FineTypeDto> {
    await this.assertTypeNameFree(schoolId, dto.name);
    const saved = await this.dataSource.transaction(async (manager) => {
      const type = await manager.save(
        manager.create(FeeFineType, {
          school_id: schoolId,
          name: dto.name,
          default_amount: dto.default_amount,
          description: dto.description || null,
          is_active: dto.is_active ?? true,
          created_by: actor.id,
        }),
      );
      await this.auditType(manager, type, 'created', null, actor);
      return type;
    });
    return this.typeDto(schoolId, saved.id);
  }

  async updateType(schoolId: number, id: number, dto: UpdateFineTypeDto, actor: AuthUser): Promise<FineTypeDto> {
    const type = await this.type(schoolId, id);
    if (dto.name && dto.name.toLowerCase() !== type.name.toLowerCase()) {
      await this.assertTypeNameFree(schoolId, dto.name);
    }
    const before = { ...type };
    await this.dataSource.transaction(async (manager) => {
      const change = {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.default_amount !== undefined ? { default_amount: dto.default_amount } : {}),
        ...(dto.description !== undefined ? { description: dto.description || null } : {}),
        ...(dto.is_active !== undefined ? { is_active: dto.is_active } : {}),
      };
      await manager.update(FeeFineType, id, change);
      await this.auditType(manager, { ...type, ...change }, 'updated', before, actor);
    });
    return this.typeDto(schoolId, id);
  }

  async removeType(schoolId: number, id: number, actor: AuthUser): Promise<void> {
    const type = await this.type(schoolId, id);
    await this.dataSource.transaction(async (manager) => {
      await manager.softDelete(FeeFineType, id);
      await this.auditType(manager, type, 'deleted', type, actor);
    });
  }

  async list(schoolId: number, query: FineQueryDto, raisedBy?: number): Promise<Paginated<FineDto>> {
    const qb = this.fines
      .createQueryBuilder('f')
      .innerJoin(Student, 's', 's.id = f.student_id')
      .where('f.school_id = :schoolId', { schoolId });
    if (query.status) qb.andWhere('f.status = :status', { status: query.status });
    if (query.student_id) qb.andWhere('f.student_id = :studentId', { studentId: query.student_id });
    if (query.fine_type_id) qb.andWhere('f.fine_type_id = :typeId', { typeId: query.fine_type_id });
    if (raisedBy) qb.andWhere('f.created_by = :raisedBy', { raisedBy });
    const page = await listQuery(qb, query, {
      searchable: ['s.first_name', 's.last_name', 's.admission_no', 'f.fine_no', 'f.title'],
      sortable: { created_at: 'f.created_at', decided_at: 'f.decided_at', amount: 'f.amount' },
      defaultSort: 'created_at',
    });
    return { ...page, items: await this.present(schoolId, page.items) };
  }

  async get(schoolId: number, id: number): Promise<FineDto> {
    return (await this.present(schoolId, [await this.fine(schoolId, id)]))[0]!;
  }

  async raise(schoolId: number, dto: FineInputDto, actor: AuthUser): Promise<FineDto> {
    const year = await this.openYear(schoolId);
    await this.assertStudying(schoolId, year.id, dto.student_id);
    const type = dto.fine_type_id ? await this.type(schoolId, dto.fine_type_id) : null;
    if (type && !type.is_active) {
      throw AppException.conflict(`${type.name} is switched off. Choose another fine type.`, 'FINE_TYPE_INACTIVE');
    }
    const { title, amount } = resolveFine(type, dto);
    const today = this.today();
    const incidentOn = dto.incident_on ?? today;
    if (incidentOn > today || incidentOn < year.start_date) {
      throw AppException.validation([
        { field: 'incident_on', message: `The date must be in ${year.name} and not in the future` },
      ]);
    }
    const saved = await this.dataSource.transaction(async (manager) => {
      const note = await manager.save(
        manager.create(BehaviourNote, {
          school_id: schoolId,
          student_id: dto.student_id,
          category: 'disciplinary',
          title,
          details: dto.details || null,
          action_taken: fineAction('pending', amount),
          noted_on: incidentOn,
          visible_to_parent: false,
          created_by: actor.id,
        }),
      );
      const fine = await manager.save(
        manager.create(FeeFine, {
          school_id: schoolId,
          fine_no: await nextFineNumber(manager, schoolId, year),
          academic_year_id: year.id,
          student_id: dto.student_id,
          fine_type_id: type?.id ?? null,
          title,
          amount,
          incident_on: incidentOn,
          details: dto.details || null,
          status: 'pending',
          behaviour_note_id: note.id,
          created_by: actor.id,
        }),
      );
      await this.audit(manager, fine, 'requested', null, actor, dto.details || null);
      return fine;
    });
    const result = await this.get(schoolId, saved.id);
    void this.notifyApprovers(schoolId, result, actor).catch(() => undefined);
    return result;
  }

  async approve(schoolId: number, id: number, dto: ApproveFineDto, actor: AuthUser): Promise<FineDto> {
    const year = await this.openYear(schoolId);
    const dueDate = fineDueDate(this.today(), dto.due_date, year);
    await this.dataSource.transaction(async (manager) => {
      const fine = await this.pending(manager, schoolId, id);
      if (fine.created_by === actor.id) {
        throw AppException.forbidden('You raised this fine, so someone else must approve it', 'SELF_APPROVAL');
      }
      if (fine.academic_year_id !== year.id) {
        throw AppException.conflict('This fine is from an earlier academic year', 'FINE_OTHER_YEAR');
      }
      const invoice = await createOneOffInvoice(manager, {
        school_id: schoolId,
        year,
        student_id: fine.student_id,
        installment: fineInstallment(fine.fine_no, fine.title),
        due_date: dueDate,
        kind: 'fine',
        lines: [
          { head_name: 'Fine', description: `${fine.title} (${fine.fine_no})`.slice(0, 160), amount: fine.amount },
        ],
        created_by: actor.id,
      });
      await this.decide(manager, fine, 'approved', actor, dto.comment || null, invoice.id);
      await this.updateNote(manager, fine, {
        action_taken: fineAction('approved', fine.amount, invoice.invoice_no),
        visible_to_parent: true,
      });
      await applyCredit(manager, schoolId, fine.student_id, actor.id, this.today(), [invoice.id]);
    });
    const result = await this.get(schoolId, id);
    void this.afterDecision(result, actor).catch(() => undefined);
    return result;
  }

  async reject(schoolId: number, id: number, dto: RejectFineDto, actor: AuthUser): Promise<FineDto> {
    await this.dataSource.transaction(async (manager) => {
      const fine = await this.pending(manager, schoolId, id);
      await this.decide(manager, fine, 'rejected', actor, dto.comment, null);
      await this.updateNote(manager, fine, { action_taken: fineAction('rejected', fine.amount, dto.comment) });
    });
    const result = await this.get(schoolId, id);
    void this.afterDecision(result, actor).catch(() => undefined);
    return result;
  }

  async withdraw(schoolId: number, id: number, actor: AuthUser): Promise<FineDto> {
    await this.dataSource.transaction(async (manager) => {
      const fine = await this.pending(manager, schoolId, id);
      if (fine.created_by !== actor.id) {
        throw AppException.forbidden('Only the person who raised the fine can withdraw it', 'NOT_REQUESTER');
      }
      await this.decide(manager, fine, 'withdrawn', actor, null, null);
      await this.updateNote(manager, fine, { action_taken: fineAction('withdrawn', fine.amount) });
    });
    return this.get(schoolId, id);
  }

  async assertOwnFine(schoolId: number, id: number, userId: number): Promise<void> {
    const fine = await this.fine(schoolId, id);
    if (fine.created_by !== userId) throw AppException.notFound('Fine not found', 'FINE_NOT_FOUND');
  }

  private async pending(manager: EntityManager, schoolId: number, id: number): Promise<FeeFine> {
    const fine = await manager.findOne(FeeFine, {
      where: { id, school_id: schoolId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!fine) throw AppException.notFound('Fine not found', 'FINE_NOT_FOUND');
    if (fine.status !== 'pending') {
      throw AppException.conflict(`This fine is already ${fine.status}`, 'FINE_NOT_PENDING');
    }
    return fine;
  }

  private async decide(
    manager: EntityManager,
    fine: FeeFine,
    status: Exclude<FineStatus, 'pending'>,
    actor: AuthUser,
    comment: string | null,
    invoiceId: number | null,
  ): Promise<void> {
    await manager.update(FeeFine, fine.id, {
      status,
      decided_by: actor.id,
      decided_at: new Date(),
      decision_comment: comment,
      invoice_id: invoiceId,
    });
    await this.audit(manager, { ...fine, status, invoice_id: invoiceId }, status, fine, actor, comment);
  }

  private async updateNote(
    manager: EntityManager,
    fine: FeeFine,
    change: Partial<Pick<BehaviourNote, 'action_taken' | 'visible_to_parent'>>,
  ): Promise<void> {
    if (fine.behaviour_note_id) await manager.update(BehaviourNote, fine.behaviour_note_id, change);
  }

  private async audit(
    manager: EntityManager,
    fine: FeeFine,
    action: 'requested' | 'approved' | 'rejected' | 'withdrawn',
    before: FeeFine | null,
    actor: AuthUser,
    reason: string | null,
  ): Promise<void> {
    const state = (row: FeeFine) => ({
      fine_no: row.fine_no,
      student_id: row.student_id,
      title: row.title,
      amount: row.amount,
      status: row.status,
      invoice_id: row.invoice_id,
    });
    await recordFeeAudit(manager, {
      school_id: fine.school_id,
      entity: 'fee_fine',
      entity_id: fine.id,
      action,
      before: before ? state(before) : null,
      after: state(fine),
      reason,
      actor_id: actor.id,
    });
  }

  private async auditType(
    manager: EntityManager,
    type: FeeFineType,
    action: 'created' | 'updated' | 'deleted',
    before: FeeFineType | null,
    actor: AuthUser,
  ): Promise<void> {
    const state = (row: FeeFineType) => Object.fromEntries(TYPE_FIELDS.map((field) => [field, row[field]]));
    await recordFeeAudit(manager, {
      school_id: type.school_id,
      entity: 'fine_type',
      entity_id: type.id,
      action,
      before: before ? state(before) : null,
      after: action === 'deleted' ? null : state(type),
      actor_id: actor.id,
    });
  }

  private async notifyApprovers(schoolId: number, fine: FineDto, actor: AuthUser): Promise<void> {
    const rows: { id: number }[] = await this.dataSource.query(
      `SELECT DISTINCT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id AND p.code = 'fees.approve'
       WHERE u.school_id = $1 AND u.deleted_at IS NULL AND u.status = 'active' AND u.id <> $2`,
      [schoolId, actor.id],
    );
    if (!rows.length) return;
    await this.notifications.dispatch({
      template: 'FEE_FINE_APPROVAL_NEEDED',
      audience: { user_ids: rows.map((row) => Number(row.id)) },
      data: {
        name: actor.name ?? '',
        amount: rupees(fine.amount),
        student: fine.student.full_name,
        title: fine.title,
        fine_id: String(fine.id),
      },
    });
  }

  private async afterDecision(fine: FineDto, actor: AuthUser): Promise<void> {
    const data = {
      name: actor.name ?? '',
      amount: rupees(fine.amount),
      student: fine.student.full_name,
      title: fine.title,
      comment: fine.decision_comment ?? '',
      fine_id: String(fine.id),
    };
    if (fine.raised_by && fine.raised_by.id !== actor.id) {
      await this.notifications
        .dispatch({
          template: fine.status === 'approved' ? 'FEE_FINE_APPROVED' : 'FEE_FINE_REJECTED',
          audience: { user_ids: [fine.raised_by.id] },
          data,
        })
        .catch(() => undefined);
    }
    if (fine.status !== 'approved' || !fine.invoice) return;
    await this.fees.notifyGuardians('FEE_FINE_CHARGED', [
      {
        student_id: fine.student.id,
        data: {
          amount: rupees(fine.amount),
          title: fine.title,
          due_date: shortDate(fine.invoice.due_date),
          invoice_id: String(fine.invoice.id),
        },
      },
    ]);
  }

  private async present(schoolId: number, rows: FeeFine[]): Promise<FineDto[]> {
    if (!rows.length) return [];
    const invoiceIds = rows.map((row) => row.invoice_id).filter((id): id is number => !!id);
    const typeIds = rows.map((row) => row.fine_type_id).filter((id): id is number => !!id);
    const [students, users, invoices, types] = await Promise.all([
      this.fees.studentRefs(
        schoolId,
        rows.map((row) => row.student_id),
      ),
      this.fees.userNames(rows.flatMap((row) => [row.created_by, row.decided_by]).filter((id): id is number => !!id)),
      invoiceIds.length
        ? this.dataSource.getRepository(FeeInvoice).find({ where: { id: In(invoiceIds) }, withDeleted: true })
        : Promise.resolve([]),
      typeIds.length ? this.types.find({ where: { id: In(typeIds) }, withDeleted: true }) : Promise.resolve([]),
    ]);
    const invoiceById = new Map(invoices.map((row) => [row.id, row]));
    const typeById = new Map(types.map((row) => [row.id, row]));
    const user = (id: number | null) => (id ? { id, name: users.get(id) ?? '' } : null);
    return rows.map((row) => {
      const invoice = row.invoice_id ? invoiceById.get(row.invoice_id) : undefined;
      const type = row.fine_type_id ? typeById.get(row.fine_type_id) : undefined;
      return {
        id: row.id,
        fine_no: row.fine_no,
        status: row.status,
        student: students.get(row.student_id) ?? {
          id: row.student_id,
          full_name: '',
          admission_no: '',
          class_section: null,
        },
        fine_type: type ? { id: type.id, name: type.name } : null,
        title: row.title,
        amount: row.amount,
        incident_on: row.incident_on,
        details: row.details,
        raised_by: user(row.created_by),
        raised_at: row.created_at,
        decided_by: user(row.decided_by),
        decided_at: row.decided_at,
        decision_comment: row.decision_comment,
        invoice: invoice
          ? {
              id: invoice.id,
              invoice_no: invoice.invoice_no,
              due_date: invoice.due_date,
              balance: invoice.balance,
              status: invoice.status,
            }
          : null,
        behaviour_note_id: row.behaviour_note_id,
      };
    });
  }

  private async fine(schoolId: number, id: number): Promise<FeeFine> {
    const fine = await this.fines.findOneBy({ id, school_id: schoolId });
    if (!fine) throw AppException.notFound('Fine not found', 'FINE_NOT_FOUND');
    return fine;
  }

  private async type(schoolId: number, id: number): Promise<FeeFineType> {
    const type = await this.types.findOneBy({ id, school_id: schoolId });
    if (!type) throw AppException.notFound('Fine type not found', 'FINE_TYPE_NOT_FOUND');
    return type;
  }

  private async typeDto(schoolId: number, id: number): Promise<FineTypeDto> {
    return (await this.listTypes(schoolId, {})).find((row) => row.id === id)!;
  }

  private async assertTypeNameFree(schoolId: number, name: string): Promise<void> {
    const taken = await this.types
      .createQueryBuilder('t')
      .where('t.school_id = :schoolId AND lower(t.name) = lower(:name)', { schoolId, name })
      .getExists();
    if (taken) throw AppException.conflict(`A fine type named ${name} already exists`, 'FINE_TYPE_EXISTS');
  }

  private async openYear(schoolId: number): Promise<FeeYear> {
    const year = await this.fees.year(schoolId);
    if (year.status === 'closed' || year.status === 'archived') {
      throw AppException.conflict(`${year.name} is ${year.status}. Fines cannot be raised in it.`, 'YEAR_CLOSED');
    }
    return year;
  }

  private async assertStudying(schoolId: number, yearId: number, studentId: number): Promise<void> {
    const [row] = await this.dataSource.query(
      `SELECT 1 FROM student_enrollments e JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
       WHERE e.school_id = $1 AND e.academic_year_id = $2 AND e.student_id = $3 AND e.status = 'studying'
         AND s.status = 'active'`,
      [schoolId, yearId, studentId],
    );
    if (!row) throw AppException.notFound('Student is not studying in this academic year', 'STUDENT_NOT_FOUND');
  }

  private today(): string {
    return todayIn(this.app.timeZone);
  }
}
