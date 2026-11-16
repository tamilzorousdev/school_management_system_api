import { VerificationStatus } from '../../shared/verification';
import { StaffDocumentType } from '../staff/entities/staff-document.entity';
import { CrewExpiryKind } from '../transport/entities/expiry-alert.entity';
import { EXPIRY_LABELS, expiryState } from '../transport/transport.logic';

export const CREW_ROLES = ['driver', 'attendant'] as const;
export type CrewRole = (typeof CREW_ROLES)[number];

export const DUTY_STATUSES = ['pending', 'approved', 'blocked'] as const;
export type DutyStatus = (typeof DUTY_STATUSES)[number];

export const EXPIRY_FILTERS = ['expired', 'due_soon', 'missing'] as const;
export type ExpiryFilter = (typeof EXPIRY_FILTERS)[number];

export const LICENCE_TYPES = ['LMV', 'HMV', 'TRANSPORT'] as const;

export const CREW_DESIGNATIONS: Record<CrewRole, string> = { driver: 'Bus Driver', attendant: 'Bus Attendant' };

export const REMINDER_GAP_MS = 6 * 60 * 60 * 1000;

export type DocumentState = 'missing' | VerificationStatus;
export type ExpiryState = ReturnType<typeof expiryState>;

export interface CrewDates {
  licence_expiry: string | null;
  badge_expiry: string | null;
  medical_fitness_expiry: string | null;
  police_verification_expiry: string | null;
}

export interface CrewCheckDefinition {
  kind: CrewExpiryKind;
  document: StaffDocumentType;
  field: keyof CrewDates;
  roles: CrewRole[];
}

export const CREW_CHECKS: CrewCheckDefinition[] = [
  { kind: 'licence', document: 'driving_licence', field: 'licence_expiry', roles: ['driver'] },
  { kind: 'badge', document: 'psv_badge', field: 'badge_expiry', roles: ['driver'] },
  { kind: 'medical', document: 'medical_fitness', field: 'medical_fitness_expiry', roles: ['driver', 'attendant'] },
  {
    kind: 'police',
    document: 'police_verification',
    field: 'police_verification_expiry',
    roles: ['driver', 'attendant'],
  },
];

export interface CrewDocumentRef {
  id: number;
  type: string;
  status: VerificationStatus;
  created_at: Date;
}

export interface CrewCheck {
  kind: CrewExpiryKind;
  label: string;
  document_type: StaffDocumentType;
  document_status: DocumentState;
  document_id: number | null;
  expiry: ExpiryState;
  clear: boolean;
  problem: string | null;
}

export function checksFor(role: CrewRole): CrewCheckDefinition[] {
  return CREW_CHECKS.filter((check) => check.roles.includes(role));
}

export function latestDocuments(documents: CrewDocumentRef[]): Map<string, CrewDocumentRef> {
  const latest = new Map<string, CrewDocumentRef>();
  for (const document of documents) {
    const current = latest.get(document.type);
    const newer =
      !current ||
      document.created_at.getTime() > current.created_at.getTime() ||
      (document.created_at.getTime() === current.created_at.getTime() && document.id > current.id);
    if (newer) latest.set(document.type, document);
  }
  return latest;
}

function problemOf(status: DocumentState, expiry: ExpiryState): string | null {
  if (status === 'missing') return 'Upload the document';
  if (status === 'rejected') return 'Document rejected';
  if (status === 'pending') return 'Waiting for verification';
  if (expiry.state === 'missing') return 'Add the expiry date';
  if (expiry.state === 'expired') return 'Expired';
  return null;
}

export function crewChecks(role: CrewRole, dates: CrewDates, documents: CrewDocumentRef[], today: string): CrewCheck[] {
  const latest = latestDocuments(documents);
  return checksFor(role).map((check) => {
    const document = latest.get(check.document);
    const status: DocumentState = document?.status ?? 'missing';
    const expiry = expiryState(check.kind, dates[check.field], today);
    const problem = problemOf(status, expiry);
    return {
      kind: check.kind,
      label: EXPIRY_LABELS[check.kind],
      document_type: check.document,
      document_status: status,
      document_id: document?.id ?? null,
      expiry,
      clear: problem === null,
      problem,
    };
  });
}

export function dutyStatus(approvedAt: Date | null, checks: CrewCheck[]): DutyStatus {
  if (!approvedAt) return 'pending';
  return checks.every((check) => check.clear) ? 'approved' : 'blocked';
}

export function earliestExpiry(checks: CrewCheck[]): string | null {
  const dates = checks.map((check) => check.expiry.date).filter((date): date is string => Boolean(date));
  return dates.length ? dates.sort()[0]! : null;
}

export function dueChecks(checks: CrewCheck[]): CrewCheck[] {
  return checks.filter((check) => check.expiry.state === 'expired' || check.expiry.state === 'due_soon');
}

export function displayDate(date: string): string {
  return date.split('-').reverse().join('-');
}

export function reminderText(checks: CrewCheck[]): string {
  return checks
    .map((check) =>
      check.expiry.state === 'expired'
        ? `${check.label} expired on ${displayDate(check.expiry.date!)}`
        : `${check.label} ends on ${displayDate(check.expiry.date!)}`,
    )
    .join(', ');
}

export function dateProblems(
  values: CrewDates & { licence_issued_on: string | null; police_verified_on: string | null },
  today: string,
): { field: string; message: string }[] {
  const problems: { field: string; message: string }[] = [];
  if (values.licence_issued_on && values.licence_issued_on > today) {
    problems.push({ field: 'licence_issued_on', message: 'Issue date cannot be in the future' });
  }
  if (values.licence_issued_on && values.licence_expiry && values.licence_issued_on >= values.licence_expiry) {
    problems.push({ field: 'licence_expiry', message: 'Expiry must be after the issue date' });
  }
  if (values.police_verified_on && values.police_verified_on > today) {
    problems.push({ field: 'police_verified_on', message: 'Verification date cannot be in the future' });
  }
  if (
    values.police_verified_on &&
    values.police_verification_expiry &&
    values.police_verified_on >= values.police_verification_expiry
  ) {
    problems.push({ field: 'police_verification_expiry', message: 'Valid till must be after the verification date' });
  }
  return problems;
}
