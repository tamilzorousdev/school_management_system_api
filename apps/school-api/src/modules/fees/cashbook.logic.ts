import { MANUAL_PAYMENT_MODES } from './entities/fee-payment.entity';
import { round2 } from './fees.logic';

export const CASHBOOK_MODES = [...MANUAL_PAYMENT_MODES, 'online'] as const;
export type CashbookMode = (typeof CASHBOOK_MODES)[number];

export const CASHBOOK_MODE_LABELS: Record<CashbookMode, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  bank_transfer: 'Bank transfer',
  cheque: 'Cheque',
  online: 'Online',
};

export const MOVEMENT_SOURCES = ['fees', 'advance', 'library', 'refund'] as const;
export type MovementSource = (typeof MOVEMENT_SOURCES)[number];

export interface Movement {
  paid_on: string;
  collector_id: number | null;
  mode: string;
  source: MovementSource;
  receipts: number;
  amount: number;
}

export interface CashTotals {
  receipts: number;
  fees: number;
  advance: number;
  library_fines: number;
  refunds: number;
  net: number;
  cash_in_hand: number;
  by_mode: Record<CashbookMode, number>;
  refunds_by_mode: Record<CashbookMode, number>;
}

const zeroModes = () => Object.fromEntries(CASHBOOK_MODES.map((mode) => [mode, 0])) as Record<CashbookMode, number>;

const asMode = (mode: string): CashbookMode =>
  (CASHBOOK_MODES as readonly string[]).includes(mode) ? (mode as CashbookMode) : 'cash';

export function cashTotals(movements: Movement[]): CashTotals {
  const totals: CashTotals = {
    receipts: 0,
    fees: 0,
    advance: 0,
    library_fines: 0,
    refunds: 0,
    net: 0,
    cash_in_hand: 0,
    by_mode: zeroModes(),
    refunds_by_mode: zeroModes(),
  };
  for (const row of movements) {
    const amount = Number(row.amount);
    const mode = asMode(row.mode);
    if (row.source === 'refund') {
      totals.refunds += amount;
      totals.refunds_by_mode[mode] += amount;
      continue;
    }
    totals.receipts += Number(row.receipts);
    totals.by_mode[mode] += amount;
    if (row.source === 'fees') totals.fees += amount;
    if (row.source === 'advance') totals.advance += amount;
    if (row.source === 'library') totals.library_fines += amount;
  }
  for (const mode of CASHBOOK_MODES) {
    totals.by_mode[mode] = round2(totals.by_mode[mode]);
    totals.refunds_by_mode[mode] = round2(totals.refunds_by_mode[mode]);
  }
  totals.fees = round2(totals.fees);
  totals.advance = round2(totals.advance);
  totals.library_fines = round2(totals.library_fines);
  totals.refunds = round2(totals.refunds);
  totals.net = round2(totals.fees + totals.advance + totals.library_fines - totals.refunds);
  totals.cash_in_hand = round2(totals.by_mode.cash - totals.refunds_by_mode.cash);
  return totals;
}

export function groupMovements<K>(movements: Movement[], key: (row: Movement) => K): Map<K, Movement[]> {
  const groups = new Map<K, Movement[]>();
  for (const row of movements) {
    const value = key(row);
    groups.set(value, [...(groups.get(value) ?? []), row]);
  }
  return groups;
}

export function flatTotals(totals: CashTotals): Record<string, number> {
  return {
    receipts: totals.receipts,
    ...totals.by_mode,
    fees: totals.fees,
    advance: totals.advance,
    library_fines: totals.library_fines,
    refunds: totals.refunds,
    net: totals.net,
    cash_in_hand: totals.cash_in_hand,
  };
}
