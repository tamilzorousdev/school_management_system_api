export const HOSTEL_OPTIONAL_MODULES = ['staff_duty', 'lockers', 'study_hall', 'laundry', 'medical', 'mess'] as const;
export type HostelOptionalModule = (typeof HOSTEL_OPTIONAL_MODULES)[number];
export type EnabledModules = Record<HostelOptionalModule, boolean>;

export const DEFAULT_ENABLED_MODULES: EnabledModules = {
  staff_duty: false,
  lockers: false,
  study_hall: true,
  laundry: false,
  medical: true,
  mess: true,
};

export const DEFAULT_TIMINGS = {
  wake_up_time: '05:30',
  study_start_time: '18:30',
  study_end_time: '20:30',
  in_time: '19:00',
  lights_out_time: '22:00',
  outing_from_time: '16:00',
  outing_until_time: '18:30',
};

export type HostelTimings = typeof DEFAULT_TIMINGS;

export function mergeEnabledModules(stored: Partial<Record<string, unknown>> | null | undefined): EnabledModules {
  const result = { ...DEFAULT_ENABLED_MODULES };
  if (!stored) return result;
  for (const key of HOSTEL_OPTIONAL_MODULES) {
    if (typeof stored[key] === 'boolean') result[key] = stored[key] as boolean;
  }
  return result;
}

export function timingErrors(timings: HostelTimings): { field: string; message: string }[] {
  const errors: { field: string; message: string }[] = [];
  if (timings.study_end_time <= timings.study_start_time) {
    errors.push({ field: 'study_end_time', message: 'Study end time must be after study start time' });
  }
  if (timings.outing_until_time <= timings.outing_from_time) {
    errors.push({ field: 'outing_until_time', message: 'Outing end time must be after outing start time' });
  }
  if (timings.lights_out_time <= timings.in_time) {
    errors.push({ field: 'lights_out_time', message: 'Lights out must be after the in-time' });
  }
  return errors;
}

export function bedLabels(capacity: number, existing: string[] = []): string[] {
  const taken = new Set(existing.map((label) => label.toUpperCase()));
  const labels: string[] = [];
  let index = 0;
  while (labels.length < capacity) {
    const label = bedLabel(index);
    if (!taken.has(label)) labels.push(label);
    index += 1;
  }
  return labels;
}

function bedLabel(index: number): string {
  let label = '';
  let value = index;
  do {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
}

export function roomNumbers(prefix: string, from: number, count: number, pad: number): string[] {
  return Array.from({ length: count }, (_value, offset) => `${prefix}${String(from + offset).padStart(pad, '0')}`);
}

export type HostelGenderRule = 'boys' | 'girls' | 'mixed';

export function genderAllowed(hostel: HostelGenderRule, studentGender: string): boolean {
  if (hostel === 'mixed') return true;
  if (hostel === 'boys') return studentGender === 'male';
  return studentGender === 'female';
}

export type ApplicationState = 'pending' | 'waitlisted' | 'approved' | 'rejected' | 'cancelled' | 'admitted';
export const APPLICATION_ACTIONS = {
  approve: 'approve',
  waitlist: 'waitlist',
  reject: 'reject',
  cancel: 'cancel',
} as const;
export type ApplicationAction = (typeof APPLICATION_ACTIONS)[keyof typeof APPLICATION_ACTIONS];

const APPLICATION_MOVES: Record<ApplicationAction, { from: ApplicationState[]; to: ApplicationState }> = {
  approve: { from: ['pending', 'waitlisted'], to: 'approved' },
  waitlist: { from: ['pending', 'approved'], to: 'waitlisted' },
  reject: { from: ['pending', 'waitlisted', 'approved'], to: 'rejected' },
  cancel: { from: ['pending', 'waitlisted', 'approved'], to: 'cancelled' },
};

export function applicationMove(current: ApplicationState, action: ApplicationAction): ApplicationState | null {
  const move = APPLICATION_MOVES[action];
  return move.from.includes(current) ? move.to : null;
}

export interface ClearanceTemplate {
  code: string;
  label: string;
}

export function checkoutItems(enabled: Pick<EnabledModules, 'lockers'>): ClearanceTemplate[] {
  const items: ClearanceTemplate[] = [
    { code: 'room_handover', label: 'Room and furniture handed over' },
    { code: 'key_return', label: 'Room key returned' },
    { code: 'damage_check', label: 'Damage check (charge if any)' },
    { code: 'fee_dues', label: 'Hostel fee dues cleared' },
    { code: 'deposit_refund', label: 'Caution deposit settled' },
  ];
  if (enabled.lockers) items.splice(2, 0, { code: 'locker_return', label: 'Locker emptied and key returned' });
  return items;
}

export function serialNumber(prefix: string, year: string | number, value: number): string {
  return `${prefix}-${year}-${String(value).padStart(4, '0')}`;
}

export const ROLL_SLOTS = ['morning', 'evening', 'night'] as const;
export type RollSlot = (typeof ROLL_SLOTS)[number];

export const ROLL_STATUSES = ['present', 'absent', 'late', 'on_leave', 'outing', 'sick'] as const;
export type RollStatus = (typeof ROLL_STATUSES)[number];

export type LeaveState = 'awaiting_parent' | 'pending' | 'approved' | 'rejected' | 'cancelled' | 'out' | 'returned';
export type LeaveAction = 'consent_given' | 'consent_refused' | 'approve' | 'reject' | 'cancel' | 'out' | 'in';

const LEAVE_MOVES: Record<LeaveAction, { from: LeaveState[]; to: LeaveState }> = {
  consent_given: { from: ['awaiting_parent'], to: 'pending' },
  consent_refused: { from: ['awaiting_parent'], to: 'rejected' },
  approve: { from: ['pending'], to: 'approved' },
  reject: { from: ['pending', 'awaiting_parent'], to: 'rejected' },
  cancel: { from: ['awaiting_parent', 'pending', 'approved'], to: 'cancelled' },
  out: { from: ['approved'], to: 'out' },
  in: { from: ['out'], to: 'returned' },
};

export function leaveMove(current: LeaveState, action: LeaveAction): LeaveState | null {
  const move = LEAVE_MOVES[action];
  return move.from.includes(current) ? move.to : null;
}

export const OPEN_LEAVE_STATES: LeaveState[] = ['awaiting_parent', 'pending', 'approved', 'out'];

export function outingWithinWindow(
  departTime: string,
  returnTime: string,
  window: { outing_from_time: string; outing_until_time: string },
): boolean {
  return departTime >= window.outing_from_time && returnTime <= window.outing_until_time && returnTime > departTime;
}

export function lateMinutes(expected: Date, actual: Date): number {
  return Math.max(0, Math.floor((actual.getTime() - expected.getTime()) / 60000));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

export function rollStatusFromLeave(kind: string | null, leaveStatus: string | null): RollStatus | null {
  if (leaveStatus !== 'out') return null;
  return kind === 'outing' ? 'outing' : 'on_leave';
}

export function occupancyPercent(occupied: number, total: number): number {
  if (!total) return 0;
  return Math.round((occupied / total) * 1000) / 10;
}
