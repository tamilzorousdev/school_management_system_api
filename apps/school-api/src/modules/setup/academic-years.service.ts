import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AppException, AuthUser } from '@app/common';
import {
  AcademicYearDto,
  AcademicYearInputDto,
  TermInputDto,
  UpdateAcademicYearDto,
  UpdateTermDto,
} from './dto/setup.dto';
import { AcademicYear, AcademicYearStatus } from './entities/academic-year.entity';
import { Term } from './entities/term.entity';
import { yearWhere } from '../../shared/year-context';
import { AlumniRecordsService } from '../alumni/alumni-records.service';

@Injectable()
export class AcademicYearsService {
  constructor(
    @InjectRepository(AcademicYear) private readonly years: Repository<AcademicYear>,
    @InjectRepository(Term) private readonly terms: Repository<Term>,
    private readonly dataSource: DataSource,
    private readonly alumni: AlumniRecordsService,
  ) {}

  async list(schoolId: number): Promise<AcademicYearDto[]> {
    const years = await this.years.find({
      where: { school_id: schoolId },
      relations: { terms: true },
      order: { start_date: 'DESC', terms: { sort_order: 'ASC', start_date: 'ASC' } },
    });
    const names = await this.userNames(years.flatMap((year) => actorsOf(year)));
    return years.map((year) => this.present(year, names));
  }

  async current(schoolId: number): Promise<AcademicYear> {
    const year = await this.years.findOneBy(yearWhere(schoolId));
    if (!year) {
      throw AppException.badRequest('Set the current academic year in School setup first', 'NO_CURRENT_YEAR');
    }
    return year;
  }

  async currentOrNull(schoolId: number): Promise<AcademicYearDto | null> {
    const year = await this.years.findOne({
      where: yearWhere(schoolId),
      relations: { terms: true },
      order: { terms: { sort_order: 'ASC' } },
    });
    return year ? this.present(year, await this.userNames(actorsOf(year))) : null;
  }

  async resolve(schoolId: number, yearId?: number): Promise<AcademicYear> {
    if (!yearId) return this.current(schoolId);
    return this.find(schoolId, yearId);
  }

  async find(schoolId: number, id: number): Promise<AcademicYear> {
    const year = await this.years.findOneBy({ id, school_id: schoolId });
    if (!year) throw AppException.notFound('Academic year not found', 'YEAR_NOT_FOUND');
    return year;
  }

  async create(schoolId: number, dto: AcademicYearInputDto, actor: AuthUser): Promise<AcademicYearDto> {
    this.assertRange(dto.start_date, dto.end_date);
    await this.assertNameFree(schoolId, dto.name);
    await this.assertNoOverlap(schoolId, dto.start_date, dto.end_date);
    const hasCurrent = await this.years.exists({ where: { school_id: schoolId, is_current: true } });
    const id = await this.dataSource.transaction(async (manager) => {
      const makeCurrent = dto.is_current ?? !hasCurrent;
      if (makeCurrent) await this.closeCurrent(manager, schoolId, actor.id);
      const year = await manager.save(
        manager.create(AcademicYear, {
          ...dto,
          school_id: schoolId,
          is_current: makeCurrent,
          status: makeCurrent ? 'active' : 'draft',
          activated_at: makeCurrent ? new Date() : null,
          activated_by: makeCurrent ? actor.id : null,
        }),
      );
      return year.id;
    });
    return this.get(schoolId, id);
  }

  async update(schoolId: number, id: number, dto: UpdateAcademicYearDto, actor: AuthUser): Promise<AcademicYearDto> {
    const year = await this.find(schoolId, id);
    const start = dto.start_date ?? year.start_date;
    const end = dto.end_date ?? year.end_date;
    this.assertRange(start, end);
    if (dto.name && dto.name !== year.name) await this.assertNameFree(schoolId, dto.name);
    const datesChanged = start !== year.start_date || end !== year.end_date;
    if (datesChanged && (year.status === 'closed' || year.status === 'archived')) {
      throw AppException.conflict(`${year.name} is ${year.status}. Its dates cannot change.`, 'YEAR_CLOSED');
    }
    if (datesChanged) await this.assertNoOverlap(schoolId, start, end, id);
    if (dto.is_current && !year.is_current && year.status === 'archived') {
      throw AppException.conflict(`Restore ${year.name} before making it current`, 'YEAR_ARCHIVED');
    }
    if (dto.is_current === false && year.is_current) {
      throw AppException.badRequest(
        'Make another year current instead of switching this one off',
        'CURRENT_YEAR_REQUIRED',
      );
    }
    const outside = await this.terms
      .createQueryBuilder('t')
      .where('t.academic_year_id = :id', { id })
      .andWhere('(t.start_date < :start OR t.end_date > :end)', { start, end })
      .getCount();
    if (outside)
      throw AppException.badRequest(
        'Some terms fall outside these dates. Adjust the terms first.',
        'TERMS_OUTSIDE_YEAR',
      );

    const { is_current: makeCurrent, ...changes } = dto;
    await this.dataSource.transaction(async (manager) => {
      if (Object.keys(changes).length) await manager.update(AcademicYear, id, changes);
      if (makeCurrent && !year.is_current) await this.makeActive(manager, year, actor.id);
    });
    return this.get(schoolId, id);
  }

  async activate(schoolId: number, id: number, actor: AuthUser): Promise<AcademicYearDto> {
    const year = await this.find(schoolId, id);
    if (year.status === 'archived') {
      throw AppException.conflict(`Restore ${year.name} before making it current`, 'YEAR_ARCHIVED');
    }
    if (!year.is_current) {
      await this.dataSource.transaction((manager) => this.makeActive(manager, year, actor.id));
    }
    return this.get(schoolId, id);
  }

  async archive(schoolId: number, id: number, actor: AuthUser): Promise<AcademicYearDto> {
    const year = await this.find(schoolId, id);
    this.assertTransition(year, 'archived', ['closed']);
    await this.years.update(id, { status: 'archived', archived_at: new Date(), archived_by: actor.id });
    return this.get(schoolId, id);
  }

  async restore(schoolId: number, id: number): Promise<AcademicYearDto> {
    const year = await this.find(schoolId, id);
    this.assertTransition(year, 'closed', ['archived']);
    await this.years.update(id, { status: 'closed', archived_at: null, archived_by: null });
    return this.get(schoolId, id);
  }

  async remove(schoolId: number, id: number): Promise<{ id: number }> {
    const year = await this.find(schoolId, id);
    if (year.is_current) throw AppException.conflict('The current academic year cannot be deleted', 'YEAR_IS_CURRENT');
    const [{ used }] = await this.dataSource.query(
      `SELECT (SELECT COUNT(*) FROM sections WHERE academic_year_id = $1 AND deleted_at IS NULL)
            + (SELECT COUNT(*) FROM student_enrollments WHERE academic_year_id = $1) AS used`,
      [id],
    );
    if (Number(used))
      throw AppException.conflict('This year has sections or students. It cannot be deleted.', 'YEAR_IN_USE');
    await this.dataSource.transaction(async (manager) => {
      await manager.softDelete(Term, { academic_year_id: id });
      await manager.softDelete(AcademicYear, id);
    });
    return { id };
  }

  async addTerm(schoolId: number, yearId: number, dto: TermInputDto): Promise<AcademicYearDto> {
    const year = await this.find(schoolId, yearId);
    this.assertTerm(year, dto.start_date, dto.end_date);
    const count = await this.terms.countBy({ academic_year_id: yearId });
    await this.terms.save(
      this.terms.create({ ...dto, school_id: schoolId, academic_year_id: yearId, sort_order: count + 1 }),
    );
    return this.get(schoolId, yearId);
  }

  async updateTerm(schoolId: number, termId: number, dto: UpdateTermDto): Promise<AcademicYearDto> {
    const term = await this.terms.findOneBy({ id: termId, school_id: schoolId });
    if (!term) throw AppException.notFound('Term not found', 'TERM_NOT_FOUND');
    const year = await this.find(schoolId, term.academic_year_id);
    this.assertTerm(year, dto.start_date ?? term.start_date, dto.end_date ?? term.end_date);
    await this.terms.update(termId, dto);
    return this.get(schoolId, year.id);
  }

  async removeTerm(schoolId: number, termId: number): Promise<{ id: number }> {
    const term = await this.terms.findOneBy({ id: termId, school_id: schoolId });
    if (!term) throw AppException.notFound('Term not found', 'TERM_NOT_FOUND');
    await this.terms.softDelete(termId);
    return { id: termId };
  }

  private async get(schoolId: number, id: number): Promise<AcademicYearDto> {
    const year = await this.years.findOne({
      where: { id, school_id: schoolId },
      relations: { terms: true },
      order: { terms: { sort_order: 'ASC', start_date: 'ASC' } },
    });
    if (!year) throw AppException.notFound('Academic year not found', 'YEAR_NOT_FOUND');
    return this.present(year, await this.userNames(actorsOf(year)));
  }

  private async makeActive(manager: EntityManager, year: AcademicYear, actorId: number): Promise<void> {
    await this.closeCurrent(manager, year.school_id, actorId);
    await manager.update(AcademicYear, year.id, {
      is_current: true,
      status: 'active',
      activated_at: new Date(),
      activated_by: actorId,
    });
  }

  private async closeCurrent(manager: EntityManager, schoolId: number, actorId: number): Promise<void> {
    const current = await manager.findOneBy(AcademicYear, { school_id: schoolId, is_current: true });
    if (current) await this.alumni.passOut(manager, schoolId, current.id, actorId);
    await manager.update(
      AcademicYear,
      { school_id: schoolId, is_current: true },
      { is_current: false, status: 'closed', closed_at: new Date(), closed_by: actorId },
    );
  }

  private assertTransition(year: AcademicYear, to: AcademicYearStatus, from: AcademicYearStatus[]): void {
    if (from.includes(year.status)) return;
    const hint =
      year.status === 'active'
        ? 'Make another year current first; the current year is then closed.'
        : `Only a ${from.join(' or ')} year can be ${to === 'closed' ? 'restored' : to}.`;
    throw AppException.conflict(`${year.name} is ${year.status}. ${hint}`, 'INVALID_STATUS_TRANSITION');
  }

  private async assertNoOverlap(schoolId: number, start: string, end: string, exceptId?: number): Promise<void> {
    const qb = this.years
      .createQueryBuilder('y')
      .where('y.school_id = :schoolId AND y.start_date <= :end AND y.end_date >= :start', { schoolId, start, end });
    if (exceptId) qb.andWhere('y.id <> :exceptId', { exceptId });
    const clash = await qb.getOne();
    if (clash) {
      throw AppException.conflict(
        `These dates overlap ${clash.name} (${clash.start_date} to ${clash.end_date})`,
        'YEAR_OVERLAPS',
      );
    }
  }

  private async userNames(ids: (number | null)[]): Promise<Map<number, string>> {
    const unique = [...new Set(ids.filter((id): id is number => id !== null))];
    if (!unique.length) return new Map();
    const rows: { id: number; name: string }[] = await this.dataSource.query(
      `SELECT u.id, u.name FROM users u WHERE u.id = ANY($1)`,
      [unique],
    );
    return new Map(rows.map((row) => [Number(row.id), row.name]));
  }

  private async assertNameFree(schoolId: number, name: string): Promise<void> {
    if (await this.years.exists({ where: { school_id: schoolId, name } })) {
      throw AppException.conflict(`Academic year ${name} already exists`, 'YEAR_EXISTS');
    }
  }

  private assertRange(start: string, end: string): void {
    if (end <= start) throw AppException.badRequest('end_date must be after start_date', 'INVALID_DATE_RANGE');
  }

  private assertTerm(year: AcademicYear, start: string, end: string): void {
    this.assertRange(start, end);
    if (start < year.start_date || end > year.end_date) {
      throw AppException.badRequest(
        `Term dates must be inside ${year.name} (${year.start_date} to ${year.end_date})`,
        'TERM_OUTSIDE_YEAR',
      );
    }
  }

  private present(year: AcademicYear, names: Map<number, string>): AcademicYearDto {
    const nameOf = (id: number | null) => (id === null ? null : (names.get(id) ?? null));
    return {
      id: year.id,
      name: year.name,
      start_date: year.start_date,
      end_date: year.end_date,
      is_current: year.is_current,
      status: year.status,
      description: year.description,
      activated_at: year.activated_at,
      activated_by: nameOf(year.activated_by),
      closed_at: year.closed_at,
      closed_by: nameOf(year.closed_by),
      archived_at: year.archived_at,
      archived_by: nameOf(year.archived_by),
      terms: (year.terms ?? [])
        .filter((term) => !term.deleted_at)
        .map(({ id, name, start_date, end_date, sort_order }) => ({ id, name, start_date, end_date, sort_order })),
    };
  }
}

function actorsOf(year: AcademicYear): (number | null)[] {
  return [year.activated_by, year.closed_by, year.archived_by];
}
