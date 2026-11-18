import type {
  BroadcastStatus,
  DeliveryStatus,
  EmergencyAudience,
  EmergencyCategory,
  EmergencyChannel,
  EndReason,
  ExpiryUnit,
  RecipientKind,
  RecipientStudent,
} from './entities/emergency.entity';

export const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [10_000, 30_000, 90_000];

export interface CandidateRow {
  kind: 'parent' | 'staff';
  user_id: number | null;
  guardian_id: number | null;
  name: string;
  mobile: string | null;
  language: string | null;
  student_id?: number | null;
  student_name?: string | null;
  section?: string | null;
}

export interface MergedRecipient {
  kind: RecipientKind;
  user_id: number | null;
  guardian_id: number | null;
  name: string;
  mobile: string | null;
  language: 'en' | 'ta';
  students: RecipientStudent[];
}

const cleanMobile = (mobile: string | null) => {
  const digits = (mobile ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
};

export function mergeRecipients(rows: CandidateRow[]): MergedRecipient[] {
  const merged = new Map<string, MergedRecipient>();
  for (const row of rows) {
    const mobile = cleanMobile(row.mobile);
    const key = row.user_id
      ? `u${row.user_id}`
      : mobile
        ? `m${mobile}`
        : row.guardian_id
          ? `g${row.guardian_id}`
          : null;
    if (!key) continue;
    const current = merged.get(key) ?? {
      kind: row.kind,
      user_id: row.user_id ? Number(row.user_id) : null,
      guardian_id: row.guardian_id ? Number(row.guardian_id) : null,
      name: row.name,
      mobile,
      language: row.language === 'ta' ? ('ta' as const) : ('en' as const),
      students: [],
    };
    if (current.kind !== row.kind) current.kind = 'both';
    current.mobile ??= mobile;
    current.guardian_id ??= row.guardian_id ? Number(row.guardian_id) : null;
    if (row.student_id && !current.students.some((student) => student.id === Number(row.student_id))) {
      current.students.push({ id: Number(row.student_id), name: row.student_name ?? '', section: row.section ?? null });
    }
    merged.set(key, current);
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function startingStatus(
  channel: 'push' | 'sms',
  recipient: MergedRecipient,
  channels: string[],
): DeliveryStatus {
  if (!channels.includes(channel)) return 'none';
  if (channel === 'push') return recipient.user_id ? 'pending' : 'none';
  return recipient.mobile ? 'pending' : 'none';
}

export function afterFailure(attempts: number, now = Date.now()): { status: DeliveryStatus; next_at: Date | null } {
  if (attempts >= MAX_ATTEMPTS) return { status: 'failed', next_at: null };
  return { status: 'pending', next_at: new Date(now + RETRY_DELAYS_MS[attempts - 1]!) };
}

export interface ChannelCounts {
  pending: number;
  sending: number;
  sent: number;
  failed: number;
  skipped: number;
}

export function rollupStatus(push: ChannelCounts, sms: ChannelCounts): BroadcastStatus {
  if (push.pending + push.sending + sms.pending + sms.sending > 0) return 'sending';
  return push.failed + sms.failed > 0 ? 'partly_failed' : 'sent';
}

export const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

export const textFor = (language: 'en' | 'ta', english: string, tamil: string | null) =>
  language === 'ta' && tamil?.trim() ? tamil : english;

export interface EmergencyTemplate {
  key: string;
  category: EmergencyCategory;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  title_ta: string;
  message_ta: string;
}

export const EMERGENCY_TEMPLATES: EmergencyTemplate[] = [
  {
    key: 'rain_holiday',
    category: 'weather',
    severity: 'warning',
    title: 'School closed today due to heavy rain',
    message:
      'Due to heavy rain, the school is closed today. Please keep your child at home and safe. We will inform you before classes restart.',
    title_ta: 'கனமழை காரணமாக இன்று பள்ளி விடுமுறை',
    message_ta:
      'கனமழை காரணமாக இன்று பள்ளி விடுமுறை. உங்கள் குழந்தையை பாதுகாப்பாக வீட்டில் வைத்திருக்கவும். வகுப்புகள் மீண்டும் தொடங்கும் முன் தெரிவிப்போம்.',
  },
  {
    key: 'early_closure',
    category: 'school_closed',
    severity: 'warning',
    title: 'School closing early today',
    message:
      'The school will close early today at 12:30 PM. Please pick up your child on time or make sure the school bus details are confirmed.',
    title_ta: 'இன்று பள்ளி முன்கூட்டியே மூடப்படும்',
    message_ta:
      'இன்று பள்ளி மதியம் 12:30 மணிக்கு முன்கூட்டியே மூடப்படும். உங்கள் குழந்தையை சரியான நேரத்தில் அழைத்துச் செல்லவும்.',
  },
  {
    key: 'security_alert',
    category: 'security',
    severity: 'critical',
    title: 'Security alert: students are safe inside',
    message:
      'Due to a security concern near the school, all students are kept safely inside the campus. Please do not come to the school until we inform you.',
    title_ta: 'பாதுகாப்பு எச்சரிக்கை: மாணவர்கள் பாதுகாப்பாக உள்ளனர்',
    message_ta:
      'பள்ளி அருகே பாதுகாப்பு காரணமாக அனைத்து மாணவர்களும் வளாகத்திற்குள் பாதுகாப்பாக உள்ளனர். நாங்கள் தெரிவிக்கும் வரை பள்ளிக்கு வர வேண்டாம்.',
  },
  {
    key: 'transport_delay',
    category: 'transport',
    severity: 'warning',
    title: 'School buses are delayed',
    message:
      'School buses are running late today because of traffic. Your child is safe on the bus. Please wait at the stop; we will update you.',
    title_ta: 'பள்ளி பேருந்துகள் தாமதம்',
    message_ta:
      'போக்குவரத்து நெரிசல் காரணமாக இன்று பள்ளி பேருந்துகள் தாமதமாக வருகின்றன. உங்கள் குழந்தை பேருந்தில் பாதுகாப்பாக உள்ளது. நிறுத்தத்தில் காத்திருக்கவும்.',
  },
  {
    key: 'health_alert',
    category: 'health',
    severity: 'warning',
    title: 'Health advisory',
    message:
      'Some students have fever and cold symptoms. If your child is unwell, please keep them at home and inform the class teacher.',
    title_ta: 'சுகாதார அறிவிப்பு',
    message_ta:
      'சில மாணவர்களுக்கு காய்ச்சல் மற்றும் சளி அறிகுறிகள் உள்ளன. உங்கள் குழந்தைக்கு உடல்நலம் சரியில்லை என்றால் வீட்டில் வைத்து வகுப்பு ஆசிரியரிடம் தெரிவிக்கவும்.',
  },
  {
    key: 'all_clear',
    category: 'all_clear',
    severity: 'info',
    title: 'All clear: normal schedule resumes',
    message: 'The situation is now normal. The school will follow its regular schedule. Thank you for your patience.',
    title_ta: 'நிலைமை சீரானது: வழக்கமான அட்டவணை தொடரும்',
    message_ta: 'நிலைமை இப்போது சீராக உள்ளது. பள்ளி வழக்கமான அட்டவணையைப் பின்பற்றும். உங்கள் பொறுமைக்கு நன்றி.',
  },
];

export const MIN_EXPIRY_SECONDS = 5;
export const MAX_EXPIRY_YEARS = 5;
export const MAX_SCHEDULE_DAYS = 60;
export const WHOLE_SCHOOL_AUDIENCES: EmergencyAudience[] = ['everyone', 'parents', 'staff'];

const UNIT_SECONDS: Partial<Record<ExpiryUnit, number>> = { seconds: 1, minutes: 60, hours: 3600, days: 86400 };

const UNIT_NAMES: Record<ExpiryUnit, [string, string]> = {
  seconds: ['second', 'seconds'],
  minutes: ['minute', 'minutes'],
  hours: ['hour', 'hours'],
  days: ['day', 'days'],
  months: ['month', 'months'],
  years: ['year', 'years'],
};

export function expiryFrom(start: Date, value: number, unit: ExpiryUnit): Date {
  const seconds = UNIT_SECONDS[unit];
  if (seconds) return new Date(start.getTime() + value * seconds * 1000);
  const end = new Date(start.getTime());
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + (unit === 'years' ? value * 12 : value));
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, lastDay));
  return end;
}

export function expiryProblem(value: number, unit: ExpiryUnit, start = new Date()): string | null {
  const end = expiryFrom(start, value, unit);
  if (end.getTime() - start.getTime() < MIN_EXPIRY_SECONDS * 1000) {
    return `Keep it for at least ${MIN_EXPIRY_SECONDS} seconds`;
  }
  if (end > expiryFrom(start, MAX_EXPIRY_YEARS, 'years')) return `Keep it for at most ${MAX_EXPIRY_YEARS} years`;
  return null;
}

export function expiryLabel(value: number, unit: ExpiryUnit): string {
  return `${value} ${UNIT_NAMES[unit][value === 1 ? 0 : 1]}`;
}

export function needsApproval(
  input: { audience: EmergencyAudience; channels: EmergencyChannel[] },
  canApprove: boolean,
): boolean {
  if (canApprove) return false;
  return WHOLE_SCHOOL_AUDIENCES.includes(input.audience) || input.channels.includes('sms');
}

export const BROADCAST_STATES = [
  'pending_approval',
  'scheduled',
  'active',
  'expired',
  'ended',
  'rejected',
  'cancelled',
] as const;
export type BroadcastState = (typeof BROADCAST_STATES)[number];

export function broadcastState(
  row: { status: BroadcastStatus; expires_at: Date | null; ended_at: Date | null; end_reason: EndReason | null },
  now = new Date(),
): BroadcastState {
  if (row.status === 'pending_approval' || row.status === 'scheduled' || row.status === 'rejected') return row.status;
  if (row.status === 'cancelled') return 'cancelled';
  if (row.ended_at) return row.end_reason === 'expired' ? 'expired' : 'ended';
  if (row.expires_at && row.expires_at <= now) return 'expired';
  return 'active';
}

export function scheduleProblem(sendAt: Date, now = new Date()): string | null {
  if (sendAt.getTime() <= now.getTime() + 30_000) return 'Pick a time at least 1 minute from now';
  if (sendAt.getTime() > now.getTime() + MAX_SCHEDULE_DAYS * 86400_000) {
    return `Pick a time within the next ${MAX_SCHEDULE_DAYS} days`;
  }
  return null;
}
