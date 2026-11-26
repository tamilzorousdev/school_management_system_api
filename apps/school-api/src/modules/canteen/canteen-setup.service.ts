import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppException, AuthUser, listQuery, Paginated } from '@app/common';
import { settingsRefusal } from './canteen-menu.logic';
import {
  CanteenSettingsDto,
  CanteenSettingsInputDto,
  CounterDto,
  CounterInputDto,
  CounterQueryDto,
  CounterUpdateDto,
} from './dto/canteen-menu.dto';
import { CanteenCounter, CanteenSettings } from './entities/canteen-menu.entity';

const defined = <T extends object>(dto: T) =>
  Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined)) as Partial<T>;

export const toSettingsDto = (row: CanteenSettings): CanteenSettingsDto => ({
  opens_at: row.opens_at,
  closes_at: row.closes_at,
  accepts_orders: row.accepts_orders,
  wallet_enabled: row.wallet_enabled,
  allow_negative_balance: row.allow_negative_balance,
  allow_walk_in: row.allow_walk_in,
  low_balance_limit: row.low_balance_limit,
  default_daily_limit: row.default_daily_limit,
  order_cutoff_minutes: row.order_cutoff_minutes,
  token_prefix: row.token_prefix,
  tax_percent: row.tax_percent,
  receipt_footer: row.receipt_footer,
});

const toCounterDto = (row: CanteenCounter): CounterDto => ({
  id: row.id,
  name: row.name,
  description: row.description,
  active: row.active,
});

@Injectable()
export class CanteenSettingsService {
  constructor(@InjectRepository(CanteenSettings) private readonly settingsRepo: Repository<CanteenSettings>) {}

  async get(schoolId: number): Promise<CanteenSettings> {
    const existing = await this.settingsRepo.findOneBy({ school_id: schoolId });
    if (existing) return existing;
    try {
      return await this.settingsRepo.save(this.settingsRepo.create({ school_id: schoolId }));
    } catch {
      return this.settingsRepo.findOneByOrFail({ school_id: schoolId });
    }
  }
}

@Injectable()
export class CanteenSetupService {
  constructor(
    private readonly settings: CanteenSettingsService,
    @InjectRepository(CanteenSettings) private readonly settingsRepo: Repository<CanteenSettings>,
    @InjectRepository(CanteenCounter) private readonly countersRepo: Repository<CanteenCounter>,
  ) {}

  async getSettings(schoolId: number): Promise<CanteenSettingsDto> {
    return toSettingsDto(await this.settings.get(schoolId));
  }

  async updateSettings(schoolId: number, dto: CanteenSettingsInputDto, actor: AuthUser): Promise<CanteenSettingsDto> {
    const row = await this.settings.get(schoolId);
    const refusal = settingsRefusal(row, dto);
    if (refusal) throw AppException.validation([refusal]);
    Object.assign(row, defined(dto), { updated_by: actor.id });
    return toSettingsDto(await this.settingsRepo.save(row));
  }

  async counters(schoolId: number, query: CounterQueryDto): Promise<Paginated<CounterDto>> {
    const qb = this.countersRepo.createQueryBuilder('c').where('c.school_id = :schoolId', { schoolId });
    if (query.active !== undefined) qb.andWhere('c.active = :active', { active: query.active });
    const page = await listQuery(qb, query, {
      searchable: ['c.name', 'c.description'],
      sortable: { name: 'c.name', created_at: 'c.created_at' },
      defaultSort: 'name',
    });
    return { ...page, items: page.items.map(toCounterDto) };
  }

  private async counter(schoolId: number, id: number): Promise<CanteenCounter> {
    const row = await this.countersRepo.findOneBy({ id, school_id: schoolId });
    if (!row) throw AppException.notFound('Counter not found', 'CANTEEN_COUNTER_NOT_FOUND');
    return row;
  }

  private async assertNameFree(schoolId: number, name: string, exceptId?: number) {
    const clash = await this.countersRepo
      .createQueryBuilder('c')
      .where('c.school_id = :schoolId AND LOWER(c.name) = LOWER(:name)', { schoolId, name })
      .getOne();
    if (clash && clash.id !== exceptId) {
      throw AppException.conflict(`Counter ${name} already exists`, 'CANTEEN_COUNTER_EXISTS');
    }
  }

  async createCounter(schoolId: number, dto: CounterInputDto): Promise<CounterDto> {
    await this.assertNameFree(schoolId, dto.name);
    return toCounterDto(await this.countersRepo.save(this.countersRepo.create({ ...dto, school_id: schoolId })));
  }

  async updateCounter(schoolId: number, id: number, dto: CounterUpdateDto): Promise<CounterDto> {
    const row = await this.counter(schoolId, id);
    if (dto.name !== undefined) await this.assertNameFree(schoolId, dto.name, id);
    Object.assign(row, defined(dto));
    return toCounterDto(await this.countersRepo.save(row));
  }

  async deleteCounter(schoolId: number, id: number): Promise<void> {
    await this.counter(schoolId, id);
    await this.countersRepo.softDelete({ id, school_id: schoolId });
  }
}
