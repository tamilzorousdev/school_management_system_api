import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AppException, AuthUser, listQuery, Paginated } from '@app/common';
import { Student } from '../students/entities/student.entity';
import {
  AwardInputDto,
  AwardQueryDto,
  AwardResultDto,
  BenefitInputDto,
  BenefitQueryDto,
  FeeAwardDto,
  FeeBenefitDto,
  RevokeAwardDto,
  UpdateBenefitDto,
} from './dto/fees.dto';
import { CONCESSION_TYPES, FeeBenefit, SCHOLARSHIP_TYPES } from './entities/fee-benefit.entity';
import { FeeHead } from './entities/fee-head.entity';
import { StudentFeeBenefit } from './entities/student-fee-benefit.entity';
import { pick, recordFeeAudit } from './fee-audit';
import { FeeYear } from './fee-ledger';
import { FeesService } from './fees.service';

const BENEFIT_FIELDS = [
  'kind',
  'name',
  'type',
  'calc_type',
  'value',
  'fee_head_ids',
  'class_ids',
  'description',
  'is_active',
] as const;

const KIND_LABEL = { concession: 'concession', scholarship: 'scholarship' } as const;

@Injectable()
export class FeeBenefitsService {
  constructor(
    @InjectRepository(FeeBenefit) private readonly benefits: Repository<FeeBenefit>,
    @InjectRepository(StudentFeeBenefit) private readonly awards: Repository<StudentFeeBenefit>,
    @InjectRepository(FeeHead) private readonly heads: Repository<FeeHead>,
    private readonly fees: FeesService,
    private readonly dataSource: DataSource,
  ) {}

  async list(schoolId: number, query: BenefitQueryDto): Promise<Paginated<FeeBenefitDto>> {
    const year = await this.fees.year(schoolId, query.academic_year_id);
    const qb = this.benefits
      .createQueryBuilder('b')
      .where('b.school_id = :schoolId AND b.academic_year_id = :yearId', { schoolId, yearId: year.id });
    if (query.kind) qb.andWhere('b.kind = :kind', { kind: query.kind });
    if (query.type) qb.andWhere('b.type = :type', { type: query.type });
    if (query.is_active !== undefined) qb.andWhere('b.is_active = :active', { active: query.is_active });
    const page = await listQuery(qb, query, {
      searchable: ['b.name', 'b.description'],
      sortable: { name: 'b.name', value: 'b.value', created_at: 'b.created_at' },
      defaultSort: 'name',
    });
    return { ...page, items: await this.present(page.items) };
  }

  async get(schoolId: number, id: number): Promise<FeeBenefitDto> {
    return (await this.present([await this.benefit(schoolId, id)]))[0]!;
  }

  async create(schoolId: number, dto: BenefitInputDto, actor: AuthUser): Promise<FeeBenefitDto> {
    const year = await this.writableYear(schoolId, dto.academic_year_id);
    const values = {
      kind: dto.kind,
      name: dto.name,
      type: dto.type,
      calc_type: dto.calc_type,
      value: dto.value,
      fee_head_ids: dto.fee_head_ids ?? [],
      class_ids: dto.class_ids ?? [],
      description: dto.description || null,
      is_active: dto.is_active ?? true,
    };
    await this.validate(schoolId, year.id, values);
    const saved = await this.dataSource.transaction(async (manager) => {
      const benefit = await manager.save(
        manager.create(FeeBenefit, { ...values, school_id: schoolId, academic_year_id: year.id, created_by: actor.id }),
      );
      await recordFeeAudit(manager, {
        school_id: schoolId,
        entity: 'fee_benefit',
        entity_id: benefit.id,
        action: 'created',
        after: pick(benefit, BENEFIT_FIELDS),
        actor_id: actor.id,
      });
      return benefit;
    });
    return this.get(schoolId, saved.id);
  }

  async update(schoolId: number, id: number, dto: UpdateBenefitDto, actor: AuthUser): Promise<FeeBenefitDto> {
    const benefit = await this.benefit(schoolId, id);
    await this.writableYear(schoolId, benefit.academic_year_id);
    const values = {
      kind: benefit.kind,
      name: dto.name ?? benefit.name,
      type: dto.type ?? benefit.type,
      calc_type: dto.calc_type ?? benefit.calc_type,
      value: dto.value ?? benefit.value,
      fee_head_ids: dto.fee_head_ids ?? benefit.fee_head_ids,
      class_ids: dto.class_ids ?? benefit.class_ids,
      description: dto.description === undefined ? benefit.description : dto.description || null,
      is_active: dto.is_active ?? benefit.is_active,
    };
    await this.validate(schoolId, benefit.academic_year_id, values, id);
    await this.dataSource.transaction(async (manager) => {
      await manager.update(FeeBenefit, id, values);
      await recordFeeAudit(manager, {
        school_id: schoolId,
        entity: 'fee_benefit',
        entity_id: id,
        action: 'updated',
        before: pick(benefit, BENEFIT_FIELDS),
        after: values,
        actor_id: actor.id,
      });
    });
    return this.get(schoolId, id);
  }

  async remove(schoolId: number, id: number, actor: AuthUser): Promise<void> {
    const benefit = await this.benefit(schoolId, id);
    const [{ awards, applied }] = await this.dataSource.query(
      `SELECT (SELECT count(*) FROM student_fee_benefits WHERE benefit_id = $1 AND deleted_at IS NULL) AS awards,
              (SELECT count(*) FROM fee_invoice_benefits WHERE benefit_id = $1 AND deleted_at IS NULL) AS applied`,
      [id],
    );
    if (Number(awards) || Number(applied)) {
      throw AppException.conflict(
        `${benefit.name} has been given to students, so it cannot be deleted. Switch it off instead.`,
        'BENEFIT_IN_USE',
      );
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.softDelete(FeeBenefit, id);
      await recordFeeAudit(manager, {
        school_id: schoolId,
        entity: 'fee_benefit',
        entity_id: id,
        action: 'deleted',
        before: pick(benefit, BENEFIT_FIELDS),
        actor_id: actor.id,
      });
    });
  }

  async listAwards(schoolId: number, query: AwardQueryDto): Promise<Paginated<FeeAwardDto>> {
    const year = await this.fees.year(schoolId, query.academic_year_id);
    const qb = this.awards
      .createQueryBuilder('a')
      .innerJoin(FeeBenefit, 'b', 'b.id = a.benefit_id')
      .innerJoin(Student, 's', 's.id = a.student_id')
      .where('a.school_id = :schoolId AND a.academic_year_id = :yearId', { schoolId, yearId: year.id });
    if (query.benefit_id) qb.andWhere('a.benefit_id = :benefitId', { benefitId: query.benefit_id });
    if (query.kind) qb.andWhere('b.kind = :kind', { kind: query.kind });
    if (query.student_id) qb.andWhere('a.student_id = :studentId', { studentId: query.student_id });
    if (query.status) qb.andWhere('a.status = :status', { status: query.status });
    const page = await listQuery(qb, query, {
      searchable: ['s.first_name', 's.last_name', 's.admission_no', 'b.name'],
      sortable: { created_at: 'a.created_at', student: 's.first_name' },
      defaultSort: 'created_at',
    });
    return { ...page, items: await this.presentAwards(schoolId, page.items) };
  }

  async award(schoolId: number, dto: AwardInputDto, actor: AuthUser): Promise<AwardResultDto> {
    const benefit = await this.benefit(schoolId, dto.benefit_id);
    if (!benefit.is_active) {
      throw AppException.conflict(`${benefit.name} is switched off. Switch it on first.`, 'BENEFIT_INACTIVE');
    }
    await this.writableYear(schoolId, benefit.academic_year_id);
    const enrolled: { student_id: number; class_id: number; name: string }[] = await this.dataSource.query(
      `SELECT e.student_id, e.class_id, concat_ws(' ', s.first_name, s.last_name) AS name
       FROM student_enrollments e JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
       WHERE e.school_id = $1 AND e.academic_year_id = $2 AND e.status = 'studying' AND e.student_id = ANY($3)`,
      [schoolId, benefit.academic_year_id, dto.student_ids],
    );
    const byStudent = new Map(enrolled.map((row) => [Number(row.student_id), row]));
    const errors = dto.student_ids.flatMap((studentId, index) => {
      const row = byStudent.get(studentId);
      if (!row) return [{ field: `student_ids.${index}`, message: 'Student is not studying in this academic year' }];
      if (benefit.class_ids.length && !benefit.class_ids.includes(Number(row.class_id))) {
        return [{ field: `student_ids.${index}`, message: `${benefit.name} is not open to ${row.name}’s class` }];
      }
      return [];
    });
    if (errors.length) throw AppException.validation(errors);
    const result = await this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`fee_benefit:${benefit.id}`]);
      const existing = new Set(
        (
          await manager.findBy(StudentFeeBenefit, {
            benefit_id: benefit.id,
            status: 'active',
            student_id: In(dto.student_ids),
          })
        ).map((award) => award.student_id),
      );
      const fresh = dto.student_ids.filter((studentId) => !existing.has(studentId));
      const saved = fresh.length
        ? await manager.save(
            fresh.map((studentId) =>
              manager.create(StudentFeeBenefit, {
                school_id: schoolId,
                student_id: studentId,
                benefit_id: benefit.id,
                academic_year_id: benefit.academic_year_id,
                status: 'active',
                reason: dto.reason,
                created_by: actor.id,
              }),
            ),
          )
        : [];
      for (const award of saved) {
        await recordFeeAudit(manager, {
          school_id: schoolId,
          entity: 'benefit_award',
          entity_id: award.id,
          action: 'awarded',
          after: {
            student_id: award.student_id,
            benefit_id: benefit.id,
            name: benefit.name,
            kind: benefit.kind,
            calc_type: benefit.calc_type,
            value: benefit.value,
          },
          reason: dto.reason,
          actor_id: actor.id,
        });
      }
      return { saved, already: existing.size };
    });
    return {
      awarded: result.saved.length,
      already_awarded: result.already,
      items: await this.presentAwards(schoolId, result.saved),
    };
  }

  async revoke(schoolId: number, id: number, dto: RevokeAwardDto, actor: AuthUser): Promise<FeeAwardDto> {
    await this.dataSource.transaction(async (manager) => {
      const award = await manager.findOne(StudentFeeBenefit, {
        where: { id, school_id: schoolId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!award) throw AppException.notFound('Award not found', 'AWARD_NOT_FOUND');
      if (award.status === 'revoked') throw AppException.conflict('This is already withdrawn', 'AWARD_REVOKED');
      const change = {
        status: 'revoked' as const,
        revoked_at: new Date(),
        revoked_by: actor.id,
        revoke_reason: dto.reason,
      };
      await manager.update(StudentFeeBenefit, id, change);
      await recordFeeAudit(manager, {
        school_id: schoolId,
        entity: 'benefit_award',
        entity_id: id,
        action: 'revoked',
        before: { student_id: award.student_id, benefit_id: award.benefit_id, status: award.status },
        after: { student_id: award.student_id, benefit_id: award.benefit_id, status: change.status },
        reason: dto.reason,
        actor_id: actor.id,
      });
    });
    const award = await this.awards.findOneByOrFail({ id });
    return (await this.presentAwards(schoolId, [award]))[0]!;
  }

  private async writableYear(schoolId: number, yearId?: number): Promise<FeeYear> {
    const year = await this.fees.year(schoolId, yearId);
    if (year.status === 'closed' || year.status === 'archived') {
      throw AppException.conflict(
        `${year.name} is ${year.status}. Its concessions and scholarships cannot change.`,
        'YEAR_CLOSED',
      );
    }
    return year;
  }

  private async validate(
    schoolId: number,
    yearId: number,
    values: Pick<FeeBenefit, 'kind' | 'name' | 'type' | 'calc_type' | 'value' | 'fee_head_ids' | 'class_ids'>,
    id?: number,
  ): Promise<void> {
    const types: readonly string[] = values.kind === 'concession' ? CONCESSION_TYPES : SCHOLARSHIP_TYPES;
    if (!types.includes(values.type)) {
      throw AppException.validation([
        { field: 'type', message: `type of a ${KIND_LABEL[values.kind]} must be one of ${types.join(', ')}` },
      ]);
    }
    if (values.calc_type === 'percent' && values.value > 100) {
      throw AppException.validation([{ field: 'value', message: 'A percentage can be at most 100' }]);
    }
    const heads = values.fee_head_ids.length
      ? await this.heads.findBy({ school_id: schoolId, id: In(values.fee_head_ids) })
      : [];
    if (heads.length !== values.fee_head_ids.length) {
      throw AppException.validation([{ field: 'fee_head_ids', message: 'Fee head not found' }]);
    }
    if (values.calc_type === 'fixed' && heads.length && heads.every((head) => head.is_transport)) {
      throw AppException.validation([
        {
          field: 'fee_head_ids',
          message: 'A fixed amount needs a head from the fee plan. Use a percentage for transport.',
        },
      ]);
    }
    if (values.class_ids.length) {
      const rows: { id: number }[] = await this.dataSource.query(
        `SELECT id FROM classes WHERE school_id = $1 AND id = ANY($2) AND deleted_at IS NULL`,
        [schoolId, values.class_ids],
      );
      if (rows.length !== values.class_ids.length) {
        throw AppException.validation([{ field: 'class_ids', message: 'Class not found in this school' }]);
      }
    }
    const clash = await this.benefits.findOneBy({
      school_id: schoolId,
      academic_year_id: yearId,
      kind: values.kind,
      name: values.name,
    });
    if (clash && clash.id !== id) {
      throw AppException.conflict(`${values.name} already exists this year`, 'BENEFIT_EXISTS');
    }
  }

  private async benefit(schoolId: number, id: number): Promise<FeeBenefit> {
    const benefit = await this.benefits.findOneBy({ id, school_id: schoolId });
    if (!benefit) throw AppException.notFound('Concession or scholarship not found', 'BENEFIT_NOT_FOUND');
    return benefit;
  }

  private async present(benefits: FeeBenefit[]): Promise<FeeBenefitDto[]> {
    if (!benefits.length) return [];
    const ids = benefits.map((benefit) => benefit.id);
    const [awards, given]: [{ benefit_id: number; count: string }[], { benefit_id: number; amount: string }[]] =
      await Promise.all([
        this.dataSource.query(
          `SELECT benefit_id, count(*) AS count FROM student_fee_benefits
           WHERE benefit_id = ANY($1) AND status = 'active' AND deleted_at IS NULL GROUP BY benefit_id`,
          [ids],
        ),
        this.dataSource.query(
          `SELECT fb.benefit_id, sum(fb.amount) AS amount FROM fee_invoice_benefits fb
           JOIN fee_invoices i ON i.id = fb.invoice_id AND i.status <> 'cancelled' AND i.deleted_at IS NULL
           WHERE fb.benefit_id = ANY($1) AND fb.deleted_at IS NULL GROUP BY fb.benefit_id`,
          [ids],
        ),
      ]);
    const counts = new Map(awards.map((row) => [Number(row.benefit_id), Number(row.count)]));
    const amounts = new Map(given.map((row) => [Number(row.benefit_id), Number(row.amount)]));
    return benefits.map((benefit) => ({
      id: benefit.id,
      academic_year_id: benefit.academic_year_id,
      kind: benefit.kind,
      name: benefit.name,
      type: benefit.type,
      calc_type: benefit.calc_type,
      value: benefit.value,
      fee_head_ids: benefit.fee_head_ids,
      class_ids: benefit.class_ids,
      description: benefit.description,
      is_active: benefit.is_active,
      active_awards: counts.get(benefit.id) ?? 0,
      amount_given: amounts.get(benefit.id) ?? 0,
      created_at: benefit.created_at,
    }));
  }

  private async presentAwards(schoolId: number, awards: StudentFeeBenefit[]): Promise<FeeAwardDto[]> {
    if (!awards.length) return [];
    const ids = awards.map((award) => award.id);
    const [students, users, benefits, given] = await Promise.all([
      this.fees.studentRefs(
        schoolId,
        awards.map((award) => award.student_id),
      ),
      this.fees.userNames(
        awards.flatMap((award) => [award.created_by, award.revoked_by].filter((id): id is number => id !== null)),
      ),
      this.benefits.find({ where: { id: In(awards.map((award) => award.benefit_id)) }, withDeleted: true }),
      this.dataSource.query(
        `SELECT fb.award_id, sum(fb.amount) AS amount FROM fee_invoice_benefits fb
         JOIN fee_invoices i ON i.id = fb.invoice_id AND i.status <> 'cancelled' AND i.deleted_at IS NULL
         WHERE fb.award_id = ANY($1) AND fb.deleted_at IS NULL GROUP BY fb.award_id`,
        [ids],
      ) as Promise<{ award_id: number; amount: string }[]>,
    ]);
    const byId = new Map(benefits.map((benefit) => [benefit.id, benefit]));
    const amounts = new Map(given.map((row) => [Number(row.award_id), Number(row.amount)]));
    const user = (id: number | null) => (id ? { id, name: users.get(id) ?? '' } : null);
    return awards.map((award) => {
      const benefit = byId.get(award.benefit_id)!;
      return {
        id: award.id,
        student: students.get(award.student_id) ?? {
          id: award.student_id,
          full_name: 'Removed student',
          admission_no: '',
          class_section: null,
        },
        benefit: {
          id: benefit.id,
          kind: benefit.kind,
          name: benefit.name,
          calc_type: benefit.calc_type,
          value: benefit.value,
        },
        status: award.status,
        reason: award.reason,
        awarded_by: user(award.created_by),
        awarded_at: award.created_at,
        revoked_at: award.revoked_at,
        revoked_by: user(award.revoked_by),
        revoke_reason: award.revoke_reason,
        amount_given: amounts.get(award.id) ?? 0,
      };
    });
  }
}
