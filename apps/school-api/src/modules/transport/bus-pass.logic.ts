import { addDays } from '../../shared/school-days';

export const BUS_PASS_STATES = ['awaiting_payment', 'active', 'on_hold', 'expired'] as const;
export type BusPassState = (typeof BUS_PASS_STATES)[number];

export const HOLD_KINDS = ['fee', 'office'] as const;
export type HoldKind = (typeof HOLD_KINDS)[number];

export const FEE_STANDINGS = ['clear', 'due', 'past_grace'] as const;
export type FeeStanding = (typeof FEE_STANDINGS)[number];

export interface BusFeeFacts {
  oldest_unpaid_due: string | null;
  any_paid: boolean;
  any_billed: boolean;
}

export function graceEnds(dueDate: string, graceDays: number): string {
  return addDays(dueDate, graceDays);
}

export function feeStanding(facts: BusFeeFacts, graceDays: number, today: string): FeeStanding {
  if (!facts.oldest_unpaid_due) return 'clear';
  return today > graceEnds(facts.oldest_unpaid_due, graceDays) ? 'past_grace' : 'due';
}

export function isIssued(facts: BusFeeFacts, freeRide: boolean, alreadyIssued: boolean): boolean {
  return alreadyIssued || freeRide || facts.any_paid;
}

export function busPassState(input: {
  today: string;
  valid_until: string;
  issued: boolean;
  hold: 'active' | 'on_hold';
  hold_kind: HoldKind | null;
  standing: FeeStanding;
}): BusPassState {
  if (input.today > input.valid_until) return 'expired';
  if (input.hold === 'on_hold' && !(input.hold_kind === 'fee' && input.standing !== 'past_grace')) return 'on_hold';
  if (!input.issued) return 'awaiting_payment';
  return 'active';
}

export function passNumber(schoolCode: string, yearStart: number, sequence: number): string {
  return `${schoolCode}-BP-${yearStart}-${String(sequence).padStart(4, '0')}`;
}

export const PASS_MESSAGES: Record<BusPassState, string> = {
  awaiting_payment: 'Your bus pass will be ready once the bus fee is paid.',
  active: 'Show this pass when you board the school bus.',
  on_hold: 'This bus pass is on hold. Please contact the school office.',
  expired: 'This bus pass has expired. A new pass comes with the new academic year.',
};

export function crewLabel(hold: 'active' | 'on_hold', holdKind: HoldKind | null): string | null {
  if (hold !== 'on_hold') return null;
  return holdKind === 'fee' ? 'Pass on hold – fee pending, contact office' : 'Pass on hold – contact office';
}
