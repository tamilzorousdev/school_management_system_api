import { AppException } from '@app/common';
import { rupees } from '../payroll/payroll.calc';
import { SequencesService } from '../schools/sequences.service';
import { InvoiceStatus } from './entities/fee-invoice.entity';

export const STUDENT_FEE_STATUSES = ['paid', 'partly_paid', 'due', 'overdue'] as const;
export type StudentFeeStatus = (typeof STUDENT_FEE_STATUSES)[number];

export interface InvoiceAmounts {
  total: number;
  paid: number;
  balance: number;
  due_date: string;
  status: InvoiceStatus;
}

export interface FeeTotals {
  status: StudentFeeStatus;
  total: number;
  paid: number;
  balance: number;
  overdue_amount: number;
  next_due_date: string | null;
}

export const round2 = (value: number): number => Math.round(value * 100) / 100;

export const sumAmounts = (values: number[]): number => round2(values.reduce((sum, value) => sum + Number(value), 0));

export function isOverdue(invoice: Pick<InvoiceAmounts, 'balance' | 'due_date' | 'status'>, today: string): boolean {
  return invoice.status !== 'cancelled' && invoice.balance > 0 && invoice.due_date < today;
}

export function invoiceStatus(total: number, paid: number): InvoiceStatus {
  if (round2(total - paid) <= 0) return 'paid';
  return paid > 0 ? 'partly_paid' : 'unpaid';
}

export function feeTotals(invoices: InvoiceAmounts[], today: string): FeeTotals {
  const open = invoices.filter((invoice) => invoice.status !== 'cancelled');
  const total = sumAmounts(open.map((invoice) => invoice.total));
  const paid = sumAmounts(open.map((invoice) => invoice.paid));
  const balance = sumAmounts(open.map((invoice) => invoice.balance));
  const overdue = open.filter((invoice) => isOverdue(invoice, today));
  const pending = open
    .filter((invoice) => invoice.balance > 0)
    .map((invoice) => invoice.due_date)
    .sort();
  return {
    status: studentStatus(paid, balance, overdue.length > 0),
    total,
    paid,
    balance,
    overdue_amount: sumAmounts(overdue.map((invoice) => invoice.balance)),
    next_due_date: pending.find((date) => date >= today) ?? pending[0] ?? null,
  };
}

export function studentStatus(paid: number, balance: number, anyOverdue: boolean): StudentFeeStatus {
  if (balance <= 0) return 'paid';
  if (anyOverdue) return 'overdue';
  return paid > 0 ? 'partly_paid' : 'due';
}

export function monthsBetween(from: string, to: string): number {
  const [fromYear, fromMonth] = from.split('-').map(Number);
  const [toYear, toMonth] = to.split('-').map(Number);
  return Math.max(1, (toYear - fromYear) * 12 + (toMonth - fromMonth));
}

export function previousDueDate(dueDates: string[], dueDate: string, yearStart: string): string {
  return (
    dueDates
      .filter((date) => date < dueDate)
      .sort()
      .pop() ?? yearStart
  );
}

export function transportCharge(
  monthlyFee: number,
  dueDate: string,
  previousDue: string,
): { months: number; amount: number } {
  const months = monthsBetween(previousDue, dueDate);
  return { months, amount: round2(Number(monthlyFee) * months) };
}

export function applyPayment(
  invoice: Pick<InvoiceAmounts, 'total' | 'paid' | 'balance' | 'status'>,
  amount: number,
): { paid: number; balance: number; status: InvoiceStatus } {
  if (invoice.status === 'cancelled') {
    throw AppException.conflict('This invoice is cancelled', 'INVOICE_CANCELLED');
  }
  if (!(amount > 0)) {
    throw AppException.validation([{ field: 'amount', message: 'amount must be more than 0' }]);
  }
  if (invoice.balance <= 0) throw AppException.conflict('This invoice is already paid', 'INVOICE_PAID');
  if (round2(amount) > round2(invoice.balance)) {
    throw AppException.badRequest(
      `The amount is more than the balance of ${rupees(invoice.balance)}`,
      'PAYMENT_EXCEEDS_BALANCE',
    );
  }
  const paid = round2(invoice.paid + amount);
  return { paid, balance: round2(invoice.total - paid), status: invoiceStatus(invoice.total, paid) };
}

export function reverseAmounts(
  invoice: Pick<InvoiceAmounts, 'total' | 'paid' | 'status'>,
  amount: number,
): { paid: number; balance: number; status: InvoiceStatus } {
  const paid = round2(invoice.paid - amount);
  if (paid < 0) {
    throw AppException.conflict(
      'The invoice shows less paid than this payment. Run the balance check before reversing.',
      'BALANCE_MISMATCH',
    );
  }
  if (invoice.status === 'cancelled') return { paid, balance: 0, status: 'cancelled' };
  return { paid, balance: round2(invoice.total - paid), status: invoiceStatus(invoice.total, paid) };
}

export function replayedPayment<T extends { invoice_id: number; amount: number }>(
  existing: T | null,
  invoiceId: number,
  amount: number,
): T | null {
  if (!existing) return null;
  if (existing.invoice_id !== invoiceId || round2(existing.amount) !== round2(amount)) {
    throw AppException.conflict(
      'This Idempotency-Key was already used for a different payment',
      'IDEMPOTENCY_CONFLICT',
    );
  }
  return existing;
}

export function applyDiscount(
  invoice: Pick<InvoiceAmounts, 'paid' | 'status'> & { gross: number; benefit?: number },
  discount: number,
): { total: number; balance: number; status: InvoiceStatus } {
  if (invoice.status === 'cancelled') {
    throw AppException.conflict('This invoice is cancelled', 'INVOICE_CANCELLED');
  }
  const billed = round2(invoice.gross - (invoice.benefit ?? 0));
  const total = round2(billed - discount);
  if (discount < 0 || total < invoice.paid) {
    throw AppException.badRequest(
      `The discount can be at most ${rupees(round2(billed - invoice.paid))}`,
      'DISCOUNT_TOO_HIGH',
    );
  }
  return { total, balance: round2(total - invoice.paid), status: invoiceStatus(total, invoice.paid) };
}

export function feeNumber(
  schoolCode: string,
  kind: 'FEE' | 'RCP' | 'RFD' | 'FIN',
  year: string | number,
  value: number,
): string {
  return SequencesService.format(`${schoolCode}-${kind}`, year, value);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

export function shortDate(value: string): string {
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00Z`),
  );
}

export interface BenefitRule {
  award_id: number;
  benefit_id: number;
  kind: 'concession' | 'scholarship';
  name: string;
  calc_type: 'percent' | 'fixed';
  value: number;
  fee_head_ids: number[];
}

export interface ChargeLine {
  fee_head_id: number | null;
  amount: number;
  is_transport: boolean;
}

export interface PlanShare {
  installment: string;
  due_date: string;
  lines: { fee_head_id: number; amount: number }[];
}

export interface BenefitAllocation {
  award_id: number;
  benefit_id: number;
  kind: 'concession' | 'scholarship';
  name: string;
  fee_head_id: number | null;
  amount: number;
}

const KIND_ORDER = { concession: 0, scholarship: 1 } as const;

const coversHead = (rule: Pick<BenefitRule, 'fee_head_ids'>, headId: number | null, isTransport: boolean) =>
  rule.fee_head_ids.length ? headId !== null && rule.fee_head_ids.includes(headId) : !isTransport;

export function fixedShare(
  rule: Pick<BenefitRule, 'value' | 'fee_head_ids'>,
  plan: PlanShare[],
  installment: string,
): number {
  const ordered = [...plan]
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.installment.localeCompare(b.installment))
    .map((part) => ({
      installment: part.installment,
      eligible: sumAmounts(
        part.lines.filter((line) => coversHead(rule, line.fee_head_id, false)).map((line) => line.amount),
      ),
    }))
    .filter((part) => part.eligible > 0);
  const yearly = sumAmounts(ordered.map((part) => part.eligible));
  const index = ordered.findIndex((part) => part.installment === installment);
  if (!yearly || index < 0) return 0;
  const shares = ordered.map((part) => round2((rule.value * part.eligible) / yearly));
  if (index === ordered.length - 1) return round2(rule.value - sumAmounts(shares.slice(0, -1)));
  return shares[index]!;
}

export function allocateBenefits(
  lines: ChargeLine[],
  rules: BenefitRule[],
  plan: PlanShare[],
  installment: string,
): BenefitAllocation[] {
  const left = lines.map((line) => round2(line.amount));
  const allocations: BenefitAllocation[] = [];
  const ordered = [...rules].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.benefit_id - b.benefit_id);
  for (const rule of ordered) {
    const eligible = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => coversHead(rule, line.fee_head_id, line.is_transport));
    let pool = rule.calc_type === 'fixed' ? fixedShare(rule, plan, installment) : Infinity;
    for (const { line, index } of eligible) {
      const wanted = rule.calc_type === 'percent' ? round2((line.amount * rule.value) / 100) : pool;
      const amount = round2(Math.min(wanted, left[index]!, pool));
      if (amount <= 0) continue;
      left[index] = round2(left[index]! - amount);
      if (rule.calc_type === 'fixed') pool = round2(pool - amount);
      allocations.push({
        award_id: rule.award_id,
        benefit_id: rule.benefit_id,
        kind: rule.kind,
        name: rule.name,
        fee_head_id: line.fee_head_id,
        amount,
      });
    }
  }
  return allocations;
}

export function shiftDate(date: string, years: number, min: string, max: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const target = year + years;
  const leap = (target % 4 === 0 && target % 100 !== 0) || target % 400 === 0;
  const safeDay = month === 2 && day === 29 && !leap ? 28 : day;
  const shifted = `${target}-${String(month).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
  if (shifted < min) return min;
  return shifted > max ? max : shifted;
}

export function lateFeeAmount(
  settings: { late_fee_type: 'none' | 'flat' | 'percent'; late_fee_value: number },
  balance: number,
): number {
  if (settings.late_fee_type === 'flat') return round2(Number(settings.late_fee_value));
  if (settings.late_fee_type === 'percent') return round2((balance * Number(settings.late_fee_value)) / 100);
  return 0;
}
