import { createHmac, randomInt } from 'crypto';
import { safeEqual } from '../../shared/crypto';
import { ConsentStatus, PassStatus, PassType, VisitStatus } from './entities/gate.entity';

export const GATE_QR_PREFIX = 'TZG1';
export const MAX_CODE_TRIES = 5;
export const CODE_LOCK_MINUTES = 10;

export type GateQrKind = 'p' | 'v';

export interface GateQr {
  kind: GateQrKind;
  id: number;
  version: number;
}

export type PassVerdict =
  | 'ok'
  | 'not_approved'
  | 'rejected'
  | 'cancelled'
  | 'used'
  | 'expired'
  | 'not_today'
  | 'too_early'
  | 'consent_needed'
  | 'student_absent';

export type VisitVerdict = 'ok_in' | 'ok_out' | 'waiting' | 'declined' | 'cancelled' | 'left' | 'not_today';

export const PASS_VERDICT_TEXT: Record<PassVerdict, string> = {
  ok: 'Valid. Check the person against the photo, then release.',
  not_approved: 'Not approved yet. Ask the office.',
  rejected: 'This pass was rejected. Do not release.',
  cancelled: 'Cancelled by the parent or the school. Do not release.',
  used: 'Already used. Do not release again.',
  expired: 'Expired. Ask the office for a new pass.',
  not_today: 'This pass is not for today.',
  too_early: 'Too early. The pass starts later today.',
  consent_needed: 'Waiting for the parent’s code. Ask the person for the code the parent gave.',
  student_absent: 'The student is marked absent today. Call the office.',
};

export const VISIT_VERDICT_TEXT: Record<VisitVerdict, string> = {
  ok_in: 'Valid. Let the visitor in.',
  ok_out: 'Inside now. Check the visitor out.',
  waiting: 'Not allowed yet. Wait for the staff member or the office.',
  declined: 'Not allowed in.',
  cancelled: 'This visit was cancelled.',
  left: 'Already checked out.',
  not_today: 'This visitor pass is not for today.',
};

export function signGateQr(secret: string, kind: GateQrKind, id: number, version: number): string {
  return `${GATE_QR_PREFIX}.${kind}.${id}.${version}.${gateSignature(secret, kind, id, version)}`;
}

export function readGateQr(secret: string, token: string): GateQr | null {
  const parts = token.trim().split('.');
  if (parts.length !== 5 || parts[0] !== GATE_QR_PREFIX) return null;
  const kind = parts[1];
  const id = Number(parts[2]);
  const version = Number(parts[3]);
  if (
    (kind !== 'p' && kind !== 'v') ||
    !Number.isInteger(id) ||
    id <= 0 ||
    !Number.isInteger(version) ||
    version <= 0
  ) {
    return null;
  }
  return safeEqual(gateSignature(secret, kind, id, version), parts[4]!) ? { kind, id, version } : null;
}

function gateSignature(secret: string, kind: GateQrKind, id: number, version: number): string {
  return createHmac('sha256', secret).update(`gate:${kind}:${id}:${version}`).digest('base64url').slice(0, 22);
}

export function newCode(taken: Set<string>): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const code = String(randomInt(0, 10000)).padStart(4, '0');
    if (!taken.has(code)) return code;
  }
  throw new Error('No free gate code today');
}

export function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number) as [number, number];
  return hours * 60 + minutes;
}

export function collectorError(passType: PassType, hasCollector: boolean): string | null {
  return passType === 'pickup' && !hasCollector ? 'Choose who will collect the student' : null;
}

export function passVerdict(
  pass: {
    status: PassStatus;
    pass_date: string;
    from_time: string;
    until_time: string;
    needs_consent: boolean;
    consent_status: ConsentStatus | null;
    consent_verified_at: Date | null;
  },
  today: string,
  now: string,
  graceMinutes: number,
  absentToday: boolean,
): PassVerdict {
  if (pass.status === 'released') return 'used';
  if (pass.status === 'rejected') return 'rejected';
  if (pass.status === 'cancelled') return 'cancelled';
  if (pass.status === 'expired') return 'expired';
  if (pass.pass_date < today) return 'expired';
  if (pass.pass_date > today) return 'not_today';
  if (pass.status === 'pending') return 'not_approved';
  if (toMinutes(now) > toMinutes(pass.until_time) + graceMinutes) return 'expired';
  if (toMinutes(now) < toMinutes(pass.from_time) - graceMinutes) return 'too_early';
  if (pass.needs_consent && !pass.consent_verified_at) return 'consent_needed';
  if (absentToday) return 'student_absent';
  return 'ok';
}

export function visitVerdict(visit: { status: VisitStatus; visit_date: string }, today: string): VisitVerdict {
  if (visit.status === 'cancelled') return 'cancelled';
  if (visit.status === 'left') return 'left';
  if (visit.status === 'declined') return 'declined';
  if (visit.status === 'inside') return 'ok_out';
  if (visit.visit_date !== today) return 'not_today';
  if (visit.status === 'waiting') return 'waiting';
  return 'ok_in';
}

export function isLateFor(
  visit: { status: VisitStatus; expected_until: string | null },
  now: string,
  closing: string,
): boolean {
  if (visit.status !== 'inside') return false;
  return toMinutes(now) > toMinutes(visit.expected_until ?? closing);
}

export function normaliseMobile(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '').slice(-10);
}

export function blockedMatch(
  person: { name: string; mobile: string },
  blocks: { name: string; mobile: string | null }[],
): { name: string; mobile: string | null } | null {
  const mobile = normaliseMobile(person.mobile);
  const name = person.name.trim().toLowerCase().replace(/\s+/g, ' ');
  return (
    blocks.find(
      (block) =>
        (block.mobile && normaliseMobile(block.mobile) === mobile && mobile.length === 10) ||
        block.name.trim().toLowerCase().replace(/\s+/g, ' ') === name,
    ) ?? null
  );
}

export function serialNo(prefix: string, year: number, count: number): string {
  return `${prefix}-${year}-${String(count).padStart(4, '0')}`;
}

export function codeLocked(tries: number[], now: number): boolean {
  const recent = tries.filter((at) => now - at < CODE_LOCK_MINUTES * 60000);
  return recent.length >= MAX_CODE_TRIES;
}
