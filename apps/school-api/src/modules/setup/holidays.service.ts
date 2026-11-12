import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppException } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import {
  HolidayDto,
  HolidayInputDto,
  HolidayQueryDto,
  MobileHolidayDto,
  MobileHolidayOverviewDto,
  UpdateHolidayDto,
} from './dto/setup.dto';
import { Holiday } from './entities/holiday.entity';

const DAY_MS = 24 * 60 * 60 * 1000;

export function holidayDays(date: string, endDate: string | null): number {
  if (!endDate) return 1;
  return Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / DAY_MS) + 1;
}

@Injectable()
export class HolidaysService {
  constructor(
    @InjectRepository(Holiday) private readonly holidays: Repository<Holiday>,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async list(schoolId: number, query: HolidayQueryDto, classIds?: number[]): Promise<HolidayDto[]> {
    const qb = this.holidays.createQueryBuilder('h').where('h.school_id = :schoolId', { schoolId });
    if (classIds) {
      qb.andWhere('(h.class_ids IS NULL OR h.class_ids && :classIds::int[])', {
        classIds: classIds.length ? classIds : [0],
      });
    }
    const from = query.upcoming ? todayIn(this.app.timeZone) : query.from;
    if (from) qb.andWhere('COALESCE(h.end_date, h.date) >= :from', { from });
    if (query.to) qb.andWhere('h.date <= :to', { to: query.to });
    if (query.type) qb.andWhere('h.type = :type', { type: query.type });
    const rows = await qb.orderBy('h.date', 'ASC').getMany();
    const names = await this.classNames(schoolId);
    return rows.map((row) => this.present(row, names, classIds));
  }

  async forStudent(schoolId: number, studentId: number, query?: HolidayQueryDto): Promise<MobileHolidayOverviewDto> {
    const rows: { class_id: number }[] = await this.dataSource.query(
      `SELECT e.class_id FROM student_enrollments e
       JOIN academic_years y ON y.id = e.academic_year_id AND y.is_current AND y.deleted_at IS NULL
       WHERE e.student_id = $1 AND y.school_id = $2`,
      [studentId, schoolId],
    );
    return this.overview(
      schoolId,
      query,
      rows.map((row) => Number(row.class_id)),
    );
  }

  async forTeacher(schoolId: number, userId: number, query?: HolidayQueryDto): Promise<MobileHolidayOverviewDto> {
    const rows: { class_id: number }[] = await this.dataSource.query(
      `SELECT DISTINCT sec.class_id FROM sections sec
       JOIN academic_years y ON y.id = sec.academic_year_id AND y.is_current AND y.deleted_at IS NULL
       WHERE sec.school_id = $1 AND sec.deleted_at IS NULL
         AND (sec.class_teacher_user_id = $2
              OR EXISTS (SELECT 1 FROM teacher_assignments ta
                         WHERE ta.section_id = sec.id AND ta.teacher_user_id = $2 AND ta.deleted_at IS NULL))`,
      [schoolId, userId],
    );
    return this.overview(
      schoolId,
      query,
      rows.map((row) => Number(row.class_id)),
    );
  }

  async next(schoolId: number): Promise<HolidayDto | null> {
    const [first] = await this.list(schoolId, { upcoming: true, type: 'holiday' });
    return first ?? null;
  }

  async overview(schoolId: number, query?: HolidayQueryDto, classIds?: number[]): Promise<MobileHolidayOverviewDto> {
    const today = todayIn(this.app.timeZone);
    const all = await this.list(schoolId, { ...query, upcoming: false }, classIds);
    const todayMs = Date.parse(`${today}T00:00:00Z`);

    const decorate = (h: HolidayDto): MobileHolidayDto => {
      const hMs = Date.parse(`${h.date}T00:00:00Z`);
      const daysUntil = Math.round((hMs - todayMs) / DAY_MS);
      return {
        ...h,
        days_until: daysUntil >= 0 ? daysUntil : null,
      };
    };

    const decoratedAll = all.map(decorate);
    const upcoming = decoratedAll.filter((h) => {
      const endOrStart = h.end_date ?? h.date;
      return endOrStart >= today;
    });
    const next = upcoming.find((h) => h.type === 'holiday') ?? upcoming[0] ?? null;

    return {
      next_holiday: next ?? null,
      upcoming,
      all: decoratedAll,
    };
  }

  async create(schoolId: number, dto: HolidayInputDto): Promise<HolidayDto> {
    this.assertRange(dto.date, dto.end_date ?? null);
    await this.assertClasses(schoolId, dto.class_ids);
    const holiday = await this.holidays.save(
      this.holidays.create({
        ...dto,
        school_id: schoolId,
        end_date: dto.end_date ?? null,
        type: dto.type ?? 'holiday',
        class_ids: dto.class_ids?.length ? dto.class_ids : null,
      }),
    );
    return this.present(holiday, await this.classNames(schoolId));
  }

  async update(schoolId: number, id: number, dto: UpdateHolidayDto): Promise<HolidayDto> {
    const holiday = await this.find(schoolId, id);
    this.assertRange(dto.date ?? holiday.date, dto.end_date === undefined ? holiday.end_date : dto.end_date);
    await this.assertClasses(schoolId, dto.class_ids);
    await this.holidays.update(id, {
      ...dto,
      ...(dto.class_ids !== undefined ? { class_ids: dto.class_ids?.length ? dto.class_ids : null } : {}),
    });
    return this.present(await this.find(schoolId, id), await this.classNames(schoolId));
  }

  async remove(schoolId: number, id: number): Promise<{ id: number }> {
    await this.find(schoolId, id);
    await this.holidays.softDelete(id);
    return { id };
  }

  private async find(schoolId: number, id: number): Promise<Holiday> {
    const holiday = await this.holidays.findOneBy({ id, school_id: schoolId });
    if (!holiday) throw AppException.notFound('Holiday not found', 'HOLIDAY_NOT_FOUND');
    return holiday;
  }

  private assertRange(date: string, endDate: string | null): void {
    if (endDate && endDate < date)
      throw AppException.badRequest('end_date cannot be before date', 'INVALID_DATE_RANGE');
  }

  private async assertClasses(schoolId: number, classIds?: number[] | null): Promise<void> {
    if (!classIds?.length) return;
    const rows: { id: number }[] = await this.dataSource.query(
      `SELECT id FROM classes WHERE school_id = $1 AND id = ANY($2) AND deleted_at IS NULL`,
      [schoolId, classIds],
    );
    const known = new Set(rows.map((row) => Number(row.id)));
    const missing = classIds.find((id) => !known.has(id));
    if (missing)
      throw AppException.validation([{ field: 'class_ids', message: `Class ${missing} is not in this school` }]);
  }

  private async classNames(schoolId: number): Promise<Map<number, string>> {
    const rows: { id: number; name: string }[] = await this.dataSource.query(
      `SELECT id, name FROM classes WHERE school_id = $1 AND deleted_at IS NULL`,
      [schoolId],
    );
    return new Map(rows.map((row) => [Number(row.id), row.name]));
  }

  private present(holiday: Holiday, names: Map<number, string>, only?: number[]): HolidayDto {
    const ids = (holiday.class_ids ?? []).map(Number).filter((id) => !only || only.includes(id));
    return {
      id: holiday.id,
      date: holiday.date,
      end_date: holiday.end_date,
      name: holiday.name,
      type: holiday.type,
      days: holidayDays(holiday.date, holiday.end_date),
      whole_school: !holiday.class_ids?.length,
      classes: ids.map((id) => ({ id, name: names.get(id) ?? '' })),
    };
  }
}
