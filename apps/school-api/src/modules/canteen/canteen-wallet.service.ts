import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AppException, AuthUser, paginate, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { walletRefusal } from './canteen.logic';
import { adjustmentRefusal, balanceAfter, signedAmount } from './canteen-sales.logic';
import {
  LowBalanceDto,
  LowBalanceQueryDto,
  TopupDto,
  WalletAdjustmentDto,
  WalletRefundDto,
  WalletResultDto,
  WalletSummaryDto,
  WalletTransactionDto,
  WalletTransactionQueryDto,
} from './dto/canteen-sales.dto';
import { CanteenSettings } from './entities/canteen-menu.entity';
import { CanteenDiner, WalletKind, WalletTransaction } from './entities/canteen-sales.entity';

export const SALES_SETTINGS_DEFAULTS = {
  opens_at: '08:00',
  closes_at: '17:00',
  accepts_orders: true,
  wallet_enabled: true,
  allow_negative_balance: false,
  allow_walk_in: true,
  low_balance_limit: 50,
  token_prefix: 'T',
  tax_percent: 0,
  receipt_footer: null as string | null,
};

export type SalesSettings = typeof SALES_SETTINGS_DEFAULTS;

export async function loadSalesSettings(manager: EntityManager, schoolId: number): Promise<SalesSettings> {
  const row = await manager.findOneBy(CanteenSettings, { school_id: schoolId });
  if (!row) return { ...SALES_SETTINGS_DEFAULTS };
  return {
    opens_at: row.opens_at,
    closes_at: row.closes_at,
    accepts_orders: row.accepts_orders,
    wallet_enabled: row.wallet_enabled,
    allow_negative_balance: row.allow_negative_balance,
    allow_walk_in: row.allow_walk_in,
    low_balance_limit: row.low_balance_limit,
    token_prefix: row.token_prefix,
    tax_percent: row.tax_percent,
    receipt_footer: row.receipt_footer,
  };
}

export interface WalletChange {
  diner_id: number;
  kind: WalletKind;
  amount: number;
  mode?: WalletTransaction['mode'];
  reference?: string | null;
  order_id?: number | null;
  note?: string | null;
  allow_negative: boolean;
}

export function presentTransaction(row: WalletTransaction): WalletTransactionDto {
  return {
    id: row.id,
    diner_id: row.diner_id,
    kind: row.kind,
    amount: row.amount,
    balance_after: row.balance_after,
    mode: row.mode,
    reference: row.reference,
    order_id: row.order_id,
    note: row.note,
    created_at: row.created_at,
  };
}

export async function lockDiner(manager: EntityManager, schoolId: number, dinerId: number): Promise<CanteenDiner> {
  const diner = await manager
    .createQueryBuilder(CanteenDiner, 'd')
    .setLock('pessimistic_write')
    .where('d.school_id = :schoolId AND d.id = :dinerId AND d.deleted_at IS NULL', { schoolId, dinerId })
    .getOne();
  if (!diner) throw AppException.notFound('Diner not found', 'DINER_NOT_FOUND');
  return diner;
}

@Injectable()
export class CanteenWalletService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(WalletTransaction) private readonly transactions: Repository<WalletTransaction>,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async applyChange(
    manager: EntityManager,
    schoolId: number,
    change: WalletChange,
    actor: AuthUser | null,
  ): Promise<{ diner: CanteenDiner; transaction: WalletTransaction }> {
    const diner = await lockDiner(manager, schoolId, change.diner_id);
    const signed = signedAmount(change.kind, change.amount);
    if (signed < 0) {
      const refusal = walletRefusal(diner.wallet_balance, Math.abs(signed), change.allow_negative);
      if (refusal) {
        throw AppException.conflict(
          refusal === 'WALLET_INSUFFICIENT' ? 'The wallet balance is not enough' : 'The amount is not valid',
          refusal,
        );
      }
    }
    diner.wallet_balance = balanceAfter(diner.wallet_balance, signed);
    await manager.update(CanteenDiner, { id: diner.id, school_id: schoolId }, { wallet_balance: diner.wallet_balance });
    const transaction = await manager.save(
      manager.create(WalletTransaction, {
        school_id: schoolId,
        diner_id: diner.id,
        kind: change.kind,
        amount: signed,
        balance_after: diner.wallet_balance,
        mode: change.mode ?? null,
        reference: change.reference ?? null,
        order_id: change.order_id ?? null,
        note: change.note ?? null,
        created_by: actor?.id ?? null,
      }),
    );
    return { diner, transaction };
  }

  private async settings(schoolId: number): Promise<SalesSettings> {
    return loadSalesSettings(this.dataSource.manager, schoolId);
  }

  private async run(schoolId: number, change: Omit<WalletChange, 'allow_negative'>, actor: AuthUser) {
    const settings = await this.settings(schoolId);
    if (!settings.wallet_enabled) throw AppException.conflict('The wallet is switched off', 'WALLET_DISABLED');
    const result = await this.dataSource.transaction((manager) =>
      this.applyChange(manager, schoolId, { ...change, allow_negative: settings.allow_negative_balance }, actor),
    );
    return this.present(result.diner, result.transaction);
  }

  private present(diner: CanteenDiner, transaction: WalletTransaction): WalletResultDto {
    return { diner_id: diner.id, wallet_balance: diner.wallet_balance, transaction: presentTransaction(transaction) };
  }

  topup(schoolId: number, dto: TopupDto, actor: AuthUser): Promise<WalletResultDto> {
    return this.run(
      schoolId,
      {
        diner_id: dto.diner_id,
        kind: 'topup',
        amount: dto.amount,
        mode: dto.mode,
        reference: dto.reference,
        note: dto.note,
      },
      actor,
    );
  }

  refund(schoolId: number, dto: WalletRefundDto, actor: AuthUser): Promise<WalletResultDto> {
    return this.run(
      schoolId,
      { diner_id: dto.diner_id, kind: 'refund', amount: dto.amount, note: dto.note ?? 'Refund to wallet' },
      actor,
    );
  }

  adjustment(schoolId: number, dto: WalletAdjustmentDto, actor: AuthUser): Promise<WalletResultDto> {
    const refusal = adjustmentRefusal(dto.amount, dto.note);
    if (refusal) throw AppException.badRequest(refusal.message, refusal.code);
    return this.run(
      schoolId,
      { diner_id: dto.diner_id, kind: 'adjustment', amount: dto.amount, note: dto.note },
      actor,
    );
  }

  async history(
    schoolId: number,
    dinerId: number,
    query: WalletTransactionQueryDto,
  ): Promise<Paginated<WalletTransactionDto>> {
    const diner = await this.dataSource.manager.findOneBy(CanteenDiner, { id: dinerId, school_id: schoolId });
    if (!diner) throw AppException.notFound('Diner not found', 'DINER_NOT_FOUND');
    const qb = this.transactions
      .createQueryBuilder('t')
      .where('t.school_id = :schoolId AND t.diner_id = :dinerId', { schoolId, dinerId });
    if (query.kind) qb.andWhere('t.kind = :kind', { kind: query.kind });
    const sorts: Record<string, string> = { created_at: 't.created_at', amount: 't.amount' };
    const column = sorts[query.sort ?? 'created_at'];
    if (!column) throw AppException.badRequest('sort must be one of: created_at, amount', 'INVALID_SORT');
    qb.orderBy(column, query.order === 'asc' ? 'ASC' : 'DESC')
      .addOrderBy('t.id', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);
    const [rows, total] = await qb.getManyAndCount();
    return paginate([rows.map(presentTransaction), total], query.page, query.limit);
  }

  async lowBalance(schoolId: number, query: LowBalanceQueryDto): Promise<Paginated<LowBalanceDto>> {
    const settings = await this.settings(schoolId);
    const params: unknown[] = [schoolId, settings.low_balance_limit];
    const where = `d.school_id = $1 AND d.deleted_at IS NULL AND d.status = 'active' AND d.wallet_balance <= $2`;
    const from = `FROM canteen_diners d
      LEFT JOIN students s ON s.id = d.student_id
      LEFT JOIN staff st ON st.id = d.staff_id
      LEFT JOIN users u ON u.id = st.user_id`;
    const [count] = await this.dataSource.query(`SELECT COUNT(*) AS total ${from} WHERE ${where}`, params);
    const rows: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT d.id, d.person_type, d.card_no, d.wallet_balance,
              COALESCE(NULLIF(TRIM(CONCAT(s.first_name, ' ', s.last_name)), ''), u.name) AS name
       ${from} WHERE ${where}
       ORDER BY d.wallet_balance ASC, d.id ASC LIMIT $3 OFFSET $4`,
      [...params, query.limit, (query.page - 1) * query.limit],
    );
    const items = rows.map((row) => ({
      diner_id: Number(row.id),
      name: String(row.name ?? ''),
      person_type: row.person_type as LowBalanceDto['person_type'],
      card_no: String(row.card_no),
      wallet_balance: Number(row.wallet_balance),
    }));
    return paginate([items, Number(count.total)], query.page, query.limit);
  }

  async summary(schoolId: number): Promise<WalletSummaryDto> {
    const settings = await this.settings(schoolId);
    const today = todayIn(this.app.timeZone);
    const [totals] = await this.dataSource.query(
      `SELECT COALESCE(SUM(wallet_balance) FILTER (WHERE wallet_balance > 0), 0) AS liability,
              COUNT(*) AS diners,
              COUNT(*) FILTER (WHERE status = 'active' AND wallet_balance <= $2) AS low
       FROM canteen_diners WHERE school_id = $1 AND deleted_at IS NULL`,
      [schoolId, settings.low_balance_limit],
    );
    const [flow] = await this.dataSource.query(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE kind = 'topup'), 0) AS topups,
              COALESCE(-SUM(amount) FILTER (WHERE kind = 'purchase'), 0) AS spend
       FROM canteen_wallet_transactions
       WHERE school_id = $1 AND (created_at AT TIME ZONE $2)::date = $3::date`,
      [schoolId, this.app.timeZone, today],
    );
    return {
      total_liability: Number(totals.liability),
      topups_today: Number(flow.topups),
      spend_today: Number(flow.spend),
      diners: Number(totals.diners),
      low_balance: Number(totals.low),
    };
  }
}
