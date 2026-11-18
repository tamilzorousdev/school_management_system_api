import { TripPosition, TripStop } from './entities/transport-trip.entity';
import { AlertData, AlertKind, AlertPosition, AlertSeverity, AlertStatus } from './entities/fleet-alert.entity';
import { Refusal } from './boarding.logic';

export interface TelematicsAlertEvent {
  type: 'alert.raised';
  at?: string;
  trip?: { id: number; ref: string; device_id: number; kind: string } | null;
  device_id?: number;
  alert?: {
    kind?: string;
    severity?: string;
    message?: string;
    value?: number;
    limit?: number;
    position?: { lat: number; lng: number; speed_kmh?: number | null };
  };
}

export interface AlertDraft {
  kind: AlertKind;
  severity: AlertSeverity;
  message: string;
  position: AlertPosition | null;
  data: AlertData;
  raised_at: Date;
  source_ref: string;
}

export type AlertMove = 'acknowledge' | 'resolve';

const TELEMATICS_KINDS: AlertKind[] = ['overspeed', 'harsh_braking', 'idle', 'route_deviation'];
const TELEMATICS_SEVERITIES: AlertSeverity[] = ['low', 'medium', 'high'];

export const ALERT_KIND_LABELS: Record<AlertKind, string> = {
  sos: 'SOS',
  overspeed: 'Overspeed',
  harsh_braking: 'Harsh braking',
  idle: 'Idling too long',
  route_deviation: 'Off route',
  vehicle_fault: 'Vehicle fault',
  other: 'Alert',
};

function validPosition(position: { lat?: unknown; lng?: unknown; speed_kmh?: unknown } | undefined) {
  if (!position) return null;
  const lat = Number(position.lat);
  const lng = Number(position.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const speed = Number(position.speed_kmh);
  return { lat, lng, speed_kmh: position.speed_kmh == null || !Number.isFinite(speed) ? null : speed };
}

function defaultMessage(kind: AlertKind, value?: number, limit?: number): string {
  if (kind === 'overspeed' && value != null) {
    return limit != null ? `Overspeed: ${value} km/h in a ${limit} km/h limit` : `Overspeed: ${value} km/h`;
  }
  if (kind === 'idle' && value != null) return `Engine idling for ${Math.round(value)} min`;
  if (kind === 'route_deviation' && value != null) return `Off the route by ${Math.round(value)} m`;
  return ALERT_KIND_LABELS[kind];
}

export function telematicsAlert(event: TelematicsAlertEvent, deviceId: number, now = new Date()): AlertDraft {
  const alert = event.alert ?? {};
  const kind = TELEMATICS_KINDS.includes(alert.kind as AlertKind) ? (alert.kind as AlertKind) : 'other';
  const severity = TELEMATICS_SEVERITIES.includes(alert.severity as AlertSeverity)
    ? (alert.severity as AlertSeverity)
    : 'medium';
  const at = event.at ? new Date(event.at) : now;
  const raisedAt = Number.isNaN(at.getTime()) ? now : at;
  const value = Number.isFinite(Number(alert.value)) && alert.value != null ? Number(alert.value) : undefined;
  const limit = Number.isFinite(Number(alert.limit)) && alert.limit != null ? Number(alert.limit) : undefined;
  const message = (alert.message?.trim() || defaultMessage(kind, value, limit)).slice(0, 300);
  return {
    kind,
    severity,
    message,
    position: validPosition(alert.position),
    data: {
      ...(alert.kind && kind === 'other' ? { reported_kind: String(alert.kind).slice(0, 40) } : {}),
      ...(value !== undefined ? { value } : {}),
      ...(limit !== undefined ? { limit } : {}),
    },
    raised_at: raisedAt,
    source_ref: `${deviceId}:${alert.kind ?? kind}:${raisedAt.toISOString()}`.slice(0, 120),
  };
}

export function safetyTemplate(severity: AlertSeverity): 'SAFETY_ALERT' | 'SAFETY_ALERT_HIGH' {
  return severity === 'high' || severity === 'critical' ? 'SAFETY_ALERT_HIGH' : 'SAFETY_ALERT';
}

export function alertMoveRefusal(status: AlertStatus, move: AlertMove): Refusal | null {
  if (status === 'resolved') {
    return move === 'resolve'
      ? { code: 'ALERT_ALREADY_RESOLVED', message: 'This alert is already resolved' }
      : { code: 'ALERT_RESOLVED', message: 'This alert is resolved; there is nothing to acknowledge' };
  }
  return null;
}

export function sosLocation(stops: TripStop[], position: { lat: number; lng: number } | null): string {
  const reached = [...stops].reverse().find((stop) => stop.status === 'arrived' || stop.status === 'departed');
  const next = stops.find((stop) => stop.status === 'approaching');
  const coordinates = position ? `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}` : null;
  const place = next?.name ?? reached?.name;
  if (place && coordinates) return `${place} (${coordinates})`;
  return place ?? coordinates ?? 'an unknown place';
}

export function positionFrom(
  given: { lat?: number; lng?: number },
  fallback: TripPosition | null | undefined,
): AlertPosition | null {
  if (given.lat !== undefined && given.lng !== undefined) return { lat: given.lat, lng: given.lng, speed_kmh: null };
  if (fallback) return { lat: fallback.lat, lng: fallback.lng, speed_kmh: fallback.speed };
  return null;
}

export const SOS_REPEAT_MS = 2 * 60 * 1000;

export interface SosCandidate {
  id: number;
  raised_by: number | null;
  vehicle_id: number | null;
  raised_at: Date;
  status: AlertStatus;
}

export function sosDuplicateOf<T extends SosCandidate>(
  candidates: T[],
  me: { userId: number; vehicleId: number | null },
  now = Date.now(),
): T | null {
  return (
    candidates
      .filter((alert) => alert.status !== 'resolved' && now - alert.raised_at.getTime() < SOS_REPEAT_MS)
      .filter((alert) => alert.raised_by === me.userId || (me.vehicleId !== null && alert.vehicle_id === me.vehicleId))
      .sort((a, b) => b.raised_at.getTime() - a.raised_at.getTime())[0] ?? null
  );
}

export function sosUpdateRefusal(alert: { kind: AlertKind; status: AlertStatus }): Refusal | null {
  if (alert.kind !== 'sos') return { code: 'NOT_AN_SOS', message: 'This alert is not an SOS' };
  if (alert.status === 'resolved') return { code: 'SOS_CLOSED', message: 'This SOS is already closed' };
  return null;
}

export function cancelNote(name: string, note?: string | null): string {
  return `Cancelled by ${name}${note ? `: ${note}` : ' (false alarm)'}`.slice(0, 500);
}
