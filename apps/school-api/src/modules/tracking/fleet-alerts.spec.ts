import { TripStop } from './entities/transport-trip.entity';
import {
  alertMoveRefusal,
  cancelNote,
  positionFrom,
  safetyTemplate,
  sosDuplicateOf,
  sosLocation,
  sosUpdateRefusal,
  telematicsAlert,
  TelematicsAlertEvent,
} from './fleet-alerts.logic';

const event = (alert: TelematicsAlertEvent['alert'], at = '2026-11-09T02:05:00.000Z'): TelematicsAlertEvent => ({
  type: 'alert.raised',
  at,
  trip: null,
  device_id: 1,
  alert,
});

const stop = (stopId: number, name: string, status: TripStop['status']): TripStop => ({
  stop_id: stopId,
  name,
  sequence: stopId,
  lat: 13,
  lng: 80,
  radius_m: 120,
  planned_time: null,
  status,
  eta_seconds: null,
  approached_at: null,
  arrived_at: null,
  departed_at: null,
});

describe('telematicsAlert', () => {
  it('maps a safety alert with its values and position', () => {
    const draft = telematicsAlert(
      event({
        kind: 'overspeed',
        severity: 'high',
        message: '',
        value: 72,
        limit: 50,
        position: { lat: 13.08, lng: 80.21, speed_kmh: 72 },
      }),
      1,
    );
    expect(draft).toMatchObject({
      kind: 'overspeed',
      severity: 'high',
      message: 'Overspeed: 72 km/h in a 50 km/h limit',
      position: { lat: 13.08, lng: 80.21, speed_kmh: 72 },
      data: { value: 72, limit: 50 },
      source_ref: '1:overspeed:2026-11-09T02:05:00.000Z',
    });
    expect(draft.raised_at.toISOString()).toBe('2026-11-09T02:05:00.000Z');
  });

  it('keeps the sender message and gives the same ref to a retried event', () => {
    const first = telematicsAlert(event({ kind: 'idle', severity: 'low', message: 'Idle 12 min at depot' }), 3);
    const again = telematicsAlert(event({ kind: 'idle', severity: 'low', message: 'Idle 12 min at depot' }), 3);
    expect(first.message).toBe('Idle 12 min at depot');
    expect(first.source_ref).toBe(again.source_ref);
  });

  it('falls back to other and medium for unknown values and drops a bad position', () => {
    const draft = telematicsAlert(event({ kind: 'teleport', severity: 'extreme', position: { lat: 200, lng: 80 } }), 1);
    expect(draft).toMatchObject({ kind: 'other', severity: 'medium', position: null, message: 'Alert' });
    expect(draft.data).toEqual({ reported_kind: 'teleport' });
  });

  it('uses now when the time is missing or broken', () => {
    const now = new Date('2026-11-09T03:00:00.000Z');
    expect(telematicsAlert(event({ kind: 'harsh_braking' }, 'not a date'), 1, now).raised_at).toEqual(now);
  });
});

describe('safetyTemplate', () => {
  it('sends SMS fallback only for high severity', () => {
    expect(safetyTemplate('high')).toBe('SAFETY_ALERT_HIGH');
    expect(safetyTemplate('critical')).toBe('SAFETY_ALERT_HIGH');
    expect(safetyTemplate('medium')).toBe('SAFETY_ALERT');
    expect(safetyTemplate('low')).toBe('SAFETY_ALERT');
  });
});

describe('alertMoveRefusal', () => {
  it('allows acknowledge and resolve until resolved', () => {
    expect(alertMoveRefusal('open', 'acknowledge')).toBeNull();
    expect(alertMoveRefusal('acknowledged', 'acknowledge')).toBeNull();
    expect(alertMoveRefusal('acknowledged', 'resolve')).toBeNull();
    expect(alertMoveRefusal('open', 'resolve')).toBeNull();
  });

  it('refuses changing a resolved alert', () => {
    expect(alertMoveRefusal('resolved', 'resolve')?.code).toBe('ALERT_ALREADY_RESOLVED');
    expect(alertMoveRefusal('resolved', 'acknowledge')?.code).toBe('ALERT_RESOLVED');
  });
});

describe('sosLocation', () => {
  it('names the stop the bus is near, with coordinates', () => {
    const stops = [stop(1, 'Mogappair', 'departed'), stop(2, 'Anna Nagar', 'approaching'), stop(3, 'Gate', 'pending')];
    expect(sosLocation(stops, { lat: 13.084912, lng: 80.210511 })).toBe('Anna Nagar (13.08491, 80.21051)');
    expect(sosLocation(stops.slice(0, 1), null)).toBe('Mogappair');
  });

  it('falls back to coordinates or an unknown place', () => {
    expect(sosLocation([], { lat: 13, lng: 80 })).toBe('13.00000, 80.00000');
    expect(sosLocation([], null)).toBe('an unknown place');
  });
});

describe('positionFrom', () => {
  it('prefers the phone location, then the bus position', () => {
    const bus = { lat: 1, lng: 2, speed: 30, heading: null, recorded_at: 'x', source: 'device' };
    expect(positionFrom({ lat: 13, lng: 80 }, bus)).toEqual({ lat: 13, lng: 80, speed_kmh: null });
    expect(positionFrom({}, bus)).toEqual({ lat: 1, lng: 2, speed_kmh: 30 });
    expect(positionFrom({}, null)).toBeNull();
  });
});

describe('sosDuplicateOf', () => {
  const now = Date.parse('2026-11-18T08:00:00Z');
  const alert = (id: number, raisedBy: number, vehicleId: number | null, secondsAgo: number, status = 'open') => ({
    id,
    raised_by: raisedBy,
    vehicle_id: vehicleId,
    raised_at: new Date(now - secondsAgo * 1000),
    status: status as 'open' | 'acknowledged' | 'resolved',
  });

  it('treats a press by the other crew member of the same bus as the same SOS', () => {
    expect(sosDuplicateOf([alert(1, 7, 3, 30)], { userId: 8, vehicleId: 3 }, now)?.id).toBe(1);
  });

  it('matches my own recent SOS even without a bus', () => {
    expect(sosDuplicateOf([alert(1, 7, null, 30)], { userId: 7, vehicleId: null }, now)?.id).toBe(1);
  });

  it('raises a new SOS after two minutes, after it is resolved, or on another bus', () => {
    expect(sosDuplicateOf([alert(1, 7, 3, 150)], { userId: 7, vehicleId: 3 }, now)).toBeNull();
    expect(sosDuplicateOf([alert(1, 7, 3, 30, 'resolved')], { userId: 7, vehicleId: 3 }, now)).toBeNull();
    expect(sosDuplicateOf([alert(1, 9, 4, 30)], { userId: 7, vehicleId: 3 }, now)).toBeNull();
  });

  it('returns the newest match', () => {
    expect(sosDuplicateOf([alert(1, 7, 3, 90), alert(2, 8, 3, 10)], { userId: 7, vehicleId: 3 }, now)?.id).toBe(2);
  });
});

describe('sosUpdateRefusal and cancelNote', () => {
  it('only lets an open or acknowledged SOS change', () => {
    expect(sosUpdateRefusal({ kind: 'sos', status: 'acknowledged' })).toBeNull();
    expect(sosUpdateRefusal({ kind: 'sos', status: 'resolved' })?.code).toBe('SOS_CLOSED');
    expect(sosUpdateRefusal({ kind: 'overspeed', status: 'open' })?.code).toBe('NOT_AN_SOS');
  });

  it('records who cancelled and why', () => {
    expect(cancelNote('Ganesan')).toBe('Cancelled by Ganesan (false alarm)');
    expect(cancelNote('Ganesan', 'Pressed by mistake')).toBe('Cancelled by Ganesan: Pressed by mistake');
  });
});
