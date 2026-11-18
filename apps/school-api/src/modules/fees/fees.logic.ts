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

export function applyDiscount(
  invoice: Pick<InvoiceAmounts, 'paid' | 'status'> & { gross: number },
  discount: number,
): { total: number; balance: number; status: InvoiceStatus } {
  if (invoice.status === 'cancelled') {
    throw AppException.conflict('This invoice is cancelled', 'INVOICE_CANCELLED');
  }
  const total = round2(invoice.gross - discount);
  if (discount < 0 || total < invoice.paid) {
    throw AppException.badRequest(
      `The discount can be at most ${rupees(round2(invoice.gross - invoice.paid))}`,
      'DISCOUNT_TOO_HIGH',
    );
  }
  return { total, balance: round2(total - invoice.paid), status: invoiceStatus(total, invoice.paid) };
}

export function feeNumber(schoolCode: string, kind: 'FEE' | 'RCP', year: string | number, value: number): string {
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

export function invoiceAmounts(lineAmounts: number[], discount: number, paid: number) {
  const gross = sumAmounts(lineAmounts);
  const total = round2(Math.max(gross - Number(discount), 0));
  const balance = round2(Math.max(total - Number(paid), 0));
  return { gross, total, balance, status: invoiceStatus(total, Number(paid)) };
}

export function transportAdjustment(newAmount: number, billed: number, adjustedSoFar: number): number {
  return round2(Number(newAmount) - Number(billed) - Number(adjustedSoFar));
}

export function paidShare(lineAmount: number, invoicePaid: number, invoiceGross: number): number {
  return Number(invoiceGross) > 0 ? round2((Number(lineAmount) * Number(invoicePaid)) / Number(invoiceGross)) : 0;
}

export function transportFeeStatus(
  billed: number,
  pending: number,
  overdue: number,
): 'paid' | 'pending' | 'overdue' | 'not_billed' {
  if (Number(billed) <= 0) return 'not_billed';
  if (Number(overdue) > 0) return 'overdue';
  return Number(pending) > 0 ? 'pending' : 'paid';
}
