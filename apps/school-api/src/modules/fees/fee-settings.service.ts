import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppException, AuthUser } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { FeeSettingsDto, FeeSettingsInputDto, LateFeeRunDto } from './dto/fees.dto';
import { FeeSettings } from './entities/fee-settings.entity';
import { recordFeeAudit } from './fee-audit';
import { applyLateFees } from './fee-adjustments';
import { DEFAULT_REMINDER_DAYS, round2, shortDate } from './fees.logic';
import { rupees } from '../payroll/payroll.calc';
import { FeesService } from './fees.service';

@Injectable()
export class FeeSettingsService {
  private readonly logger = new Logger('FeeSettings');

  constructor(
    @InjectRepository(FeeSettings) private readonly settings: Repository<FeeSettings>,
    private readonly fees: FeesService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async get(schoolId: number): Promise<FeeSettingsDto> {
    const row = await this.settings.findOneBy({ school_id: schoolId });
    if (!row) {
      return {
        grace_days: 0,
        late_fee_type: 'none',
        late_fee_value: 0,
        reminder_days: DEFAULT_REMINDER_DAYS,
        updated_by: null,
        updated_at: null,
      };
    }
    const users = row.updated_by ? await this.fees.userNames([row.updated_by]) : new Map<number, string>();
    return {
      grace_days: row.grace_days,
      late_fee_type: row.late_fee_type,
      late_fee_value: row.late_fee_value,
      reminder_days: row.reminder_days,
      updated_by: row.updated_by ? { id: row.updated_by, name: users.get(row.updated_by) ?? '' } : null,
      updated_at: row.updated_at,
    };
  }

  async update(schoolId: number, dto: FeeSettingsInputDto, actor: AuthUser): Promise<FeeSettingsDto> {
    const current = await this.settings.findOneBy({ school_id: schoolId });
    const values = {
      grace_days: dto.grace_days,
      late_fee_type: dto.late_fee_type,
      late_fee_value: dto.late_fee_type === 'none' ? 0 : dto.late_fee_value,
      reminder_days: dto.reminder_days ?? current?.reminder_days ?? DEFAULT_REMINDER_DAYS,
    };
    if (values.late_fee_type === 'percent' && values.late_fee_value > 100) {
      throw AppException.validation([{ field: 'late_fee_value', message: 'A percentage can be at most 100' }]);
    }
    if (values.late_fee_type !== 'none' && values.late_fee_value <= 0) {
      throw AppException.validation([{ field: 'late_fee_value', message: 'Enter the late fee' }]);
    }
    await this.dataSource.transaction(async (manager) => {
      const before = await manager.findOne(FeeSettings, {
        where: { school_id: schoolId },
        lock: { mode: 'pessimistic_write' },
      });
      if (before) {
        await manager.update(FeeSettings, before.id, { ...values, updated_by: actor.id });
      } else {
        await manager.save(
          manager.create(FeeSettings, { ...values, school_id: schoolId, updated_by: actor.id, created_by: actor.id }),
        );
      }
      await recordFeeAudit(manager, {
        school_id: schoolId,
        entity: 'fee_settings',
        entity_id: null,
        action: 'updated',
        before: before
          ? {
              grace_days: before.grace_days,
              late_fee_type: before.late_fee_type,
              late_fee_value: before.late_fee_value,
              reminder_days: before.reminder_days,
            }
          : null,
        after: values,
        actor_id: actor.id,
      });
    });
    return this.get(schoolId);
  }

  async runLateFees(schoolId: number | null, actorId: number | null): Promise<LateFeeRunDto> {
    const rows = await this.settings
      .createQueryBuilder('s')
      .where(`s.late_fee_type <> 'none' AND s.late_fee_value > 0`)
      .andWhere(schoolId ? 's.school_id = :schoolId' : '1 = 1', { schoolId })
      .getMany();
    const today = todayIn(this.app.timeZone);
    let invoices = 0;
    let amount = 0;
    for (const settings of rows) {
      const outcome = await this.dataSource.transaction(async (manager) => {
        await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`fee_late:${settings.school_id}`]);
        return applyLateFees(manager, settings, today, actorId);
      });
      invoices += outcome.invoices;
      amount = round2(amount + outcome.amount);
      void this.fees
        .notifyGuardians(
          'FEE_LATE_FEE',
          outcome.charged.map((item) => ({
            student_id: item.student_id,
            data: {
              amount: rupees(item.amount),
              installment: item.installment,
              due_date: shortDate(item.due_date),
              balance: rupees(item.balance),
            },
          })),
        )
        .catch(() => undefined);
    }
    return { invoices, amount };
  }

  @Cron('30 6 * * *', { name: 'fee-late-fees', timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' })
  async dailyLateFees(): Promise<void> {
    const outcome = await this.runLateFees(null, null);
    if (outcome.invoices) this.logger.log(`Late fee added to ${outcome.invoices} invoices (${outcome.amount})`);
  }
}
