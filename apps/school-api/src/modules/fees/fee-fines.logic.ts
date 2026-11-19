import { AppException } from '@app/common';
import { addDays } from '../../shared/school-days';
import { rupees } from '../payroll/payroll.calc';
import { FineStatus } from './entities/fee-fine.entity';

export const FINE_DUE_DAYS = 7;
const INSTALLMENT_LENGTH = 40;

export function fineInstallment(fineNo: string, title: string): string {
  const serial = Number(fineNo.split('-').pop());
  const label = `Fine ${Number.isFinite(serial) ? serial : fineNo} · ${title}`;
  return label.length <= INSTALLMENT_LENGTH ? label : `${label.slice(0, INSTALLMENT_LENGTH - 1).trimEnd()}…`;
}

export function fineAction(status: FineStatus, amount: number, detail?: string | null): string {
  const fine = `Fine ${rupees(amount)}`;
  const text: Record<FineStatus, string> = {
    pending: `${fine} asked, waiting for approval`,
    approved: `${fine} charged${detail ? ` (${detail})` : ''}`,
    rejected: `${fine} not approved${detail ? `: ${detail}` : ''}`,
    withdrawn: `${fine} withdrawn`,
  };
  return text[status].slice(0, 255);
}

export function resolveFine(
  type: { name: string; default_amount: number } | null,
  input: { title?: string; amount?: number },
): { title: string; amount: number } {
  const title = input.title?.trim() || type?.name;
  const amount = input.amount ?? type?.default_amount;
  const errors = [
    ...(title ? [] : [{ field: 'title', message: 'Choose a fine type or enter what the fine is for' }]),
    ...(amount && amount > 0 ? [] : [{ field: 'amount', message: 'Choose a fine type or enter the amount' }]),
  ];
  if (errors.length) throw AppException.validation(errors);
  return { title: title!, amount: Math.round(amount! * 100) / 100 };
}

export function fineDueDate(
  today: string,
  requested: string | undefined,
  year: { name: string; start_date: string; end_date: string },
): string {
  const due = requested ?? [addDays(today, FINE_DUE_DAYS), year.end_date].sort()[0]!;
  if (due < today || due < year.start_date || due > year.end_date) {
    throw AppException.validation([
      { field: 'due_date', message: `Due date must be from today to the end of ${year.name}` },
    ]);
  }
  return due;
}
