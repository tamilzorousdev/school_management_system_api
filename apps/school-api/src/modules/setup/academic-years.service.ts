import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AppException } from '@app/common';
import {
  AcademicYearDto,
  AcademicYearInputDto,
  TermInputDto,
  UpdateAcademicYearDto,
  UpdateTermDto,
} from './dto/setup.dto';
import { AcademicYear } from './entities/academic-year.entity';
import { Term } from './entities/term.entity';
import { yearWhere } from '../../shared/year-context';

@Injectable()
export class AcademicYearsService {
  constructor(
    @InjectRepository(AcademicYear) private readonly years: Repository<AcademicYear>,
    @InjectRepository(Term) private readonly terms: Repository<Term>,
    private readonly dataSource: DataSource,
  ) {}

  async list(schoolId: number): Promise<AcademicYearDto[]> {
    const years = await this.years.find({
      where: { school_id: schoolId },
      relations: { terms: true },
      order: { start_date: 'DESC', terms: { sort_order: 'ASC', start_date: 'ASC' } },
    });
    return years.map((year) => this.present(year));
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
    return year ? this.present(year) : null;
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

  async create(schoolId: number, dto: AcademicYearInputDto): Promise<AcademicYearDto> {
    this.assertRange(dto.start_date, dto.end_date);
    await this.assertNameFree(schoolId, dto.name);
    const hasCurrent = await this.years.exists({ where: { school_id: schoolId, is_current: true } });
    const id = await this.dataSource.transaction(async (manager) => {
      const makeCurrent = dto.is_current ?? !hasCurrent;
      if (makeCurrent) await this.clearCurrent(manager, schoolId);
      const year = await manager.save(
        manager.create(AcademicYear, { ...dto, school_id: schoolId, is_current: makeCurrent }),
      );
      return year.id;
    });
    return this.get(schoolId, id);
  }

  async update(schoolId: number, id: number, dto: UpdateAcademicYearDto): Promise<AcademicYearDto> {
    const year = await this.find(schoolId, id);
    const start = dto.start_date ?? year.start_date;
    const end = dto.end_date ?? year.end_date;
    this.assertRange(start, end);
    if (dto.name && dto.name !== year.name) await this.assertNameFree(schoolId, dto.name);
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

    await this.dataSource.transaction(async (manager) => {
      if (dto.is_current && !year.is_current) await this.clearCurrent(manager, schoolId);
      await manager.update(AcademicYear, id, dto);
    });
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
    return this.present(year);
  }

  private async clearCurrent(manager: EntityManager, schoolId: number): Promise<void> {
    await manager.update(AcademicYear, { school_id: schoolId, is_current: true }, { is_current: false });
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

  private present(year: AcademicYear): AcademicYearDto {
    return {
      id: year.id,
      name: year.name,
      start_date: year.start_date,
      end_date: year.end_date,
      is_current: year.is_current,
      terms: (year.terms ?? [])
        .filter((term) => !term.deleted_at)
        .map(({ id, name, start_date, end_date, sort_order }) => ({ id, name, start_date, end_date, sort_order })),
    };
  }
}
