import { AppException } from '@app/common';
import { AccountKind } from './entities/account-category.entity';
import { EntryStatus } from './entities/account-entry.entity';

export const DEFAULT_CATEGORIES: Record<AccountKind, string[]> = {
  expense: [
    'Electricity',
    'Water',
    'Internet and phone',
    'Stationery and printing',
    'Building repairs',
    'Cleaning and housekeeping',
    'Rent',
    'Events and functions',
    'Lab and sports equipment',
    'Furniture',
    'Software and subscriptions',
    'Bank charges',
    'Taxes and fees',
    'Other',
  ],
  income: [
    'Donations',
    'Uniform sales',
    'Book sales',
    'Hall or ground rent',
    'Canteen',
    'Event tickets',
    'Bank interest',
    'Government grants',
    'Other',
  ],
};

export const ENTRY_PREFIX: Record<AccountKind, string> = { expense: 'EXP', income: 'INC' };

export const MAX_ENTRY_AMOUNT = 10000000;

export interface EntryActor {
  id: number;
  can_approve: boolean;
}

export function initialStatus(actor: EntryActor): EntryStatus {
  return actor.can_approve ? 'approved' : 'pending';
}

function assertOwnerOrApprover(entry: { created_by: number | null }, actor: EntryActor, action: string): void {
  if (!actor.can_approve && entry.created_by !== actor.id) {
    throw AppException.forbidden(
      `Only the person who added this entry or an approver can ${action} it`,
      'NOT_ENTRY_OWNER',
    );
  }
}

export function assertEditable(entry: { status: EntryStatus; created_by: number | null }, actor: EntryActor): void {
  if (entry.status !== 'pending') {
    throw AppException.conflict(
      entry.status === 'approved'
        ? 'An approved entry cannot be changed. Void it and add a new one.'
        : `A ${entry.status} entry cannot be changed`,
      'ENTRY_LOCKED',
    );
  }
  assertOwnerOrApprover(entry, actor, 'change');
}

export function assertDeletable(entry: { status: EntryStatus; created_by: number | null }, actor: EntryActor): void {
  if (entry.status !== 'pending' && entry.status !== 'rejected') {
    throw AppException.conflict(
      entry.status === 'approved'
        ? 'An approved entry cannot be deleted. Void it instead.'
        : 'This entry cannot be deleted',
      'ENTRY_LOCKED',
    );
  }
  assertOwnerOrApprover(entry, actor, 'delete');
}

export function assertDecidable(entry: { status: EntryStatus }, decision: 'approve' | 'reject' | 'void'): void {
  const needed: EntryStatus = decision === 'void' ? 'approved' : 'pending';
  if (entry.status !== needed) {
    throw AppException.conflict(
      decision === 'void' ? 'Only an approved entry can be voided' : 'This entry has already been decided',
      decision === 'void' ? 'ENTRY_NOT_APPROVED' : 'ENTRY_ALREADY_DECIDED',
    );
  }
}

export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  let [year, month] = from.slice(0, 7).split('-').map(Number);
  const [endYear, endMonth] = to.slice(0, 7).split('-').map(Number);
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function monthLabel(month: string): string {
  const [year, value] = month.split('-').map(Number);
  return `${MONTH_NAMES[value - 1]} ${year}`;
}
