import { passengerRef } from './routes.service';
import {
  alertThreshold,
  autoSequence,
  daysBetween,
  expiryState,
  occupancy,
  pathKm,
  riderFee,
  roadBlockers,
  seatCheck,
  sendsSms,
  stopFee,
  stopForTrip,
  stopsOf,
  tripRiders,
} from './transport.logic';

const school = { lat: 13.0878, lng: 80.2101 };

describe('autoSequence', () => {
  it('starts at the stop farthest from school and ends nearest to it', () => {
    const stops = [
      { name: 'Roundtana', lat: 13.0849, lng: 80.2105 },
      { name: 'Mogappair', lat: 13.0846, lng: 80.1767 },
      { name: 'Thirumangalam', lat: 13.085, lng: 80.2017 },
      { name: 'West depot', lat: 13.0938, lng: 80.1956 },
    ];
    expect(autoSequence(stops, school).map((stop) => stop.name)).toEqual([
      'Mogappair',
      'West depot',
      'Thirumangalam',
      'Roundtana',
    ]);
  });

  it('gives a shorter path than a shuffled order', () => {
    const stops = [
      { lat: 13.0849, lng: 80.2105 },
      { lat: 13.0846, lng: 80.1767 },
      { lat: 13.0938, lng: 80.1956 },
      { lat: 13.085, lng: 80.2017 },
    ];
    expect(pathKm([...autoSequence(stops, school), school])).toBeLessThan(pathKm([...stops, school]));
  });

  it('works without a school location and with one stop', () => {
    expect(autoSequence([{ lat: 1, lng: 1 }], null)).toHaveLength(1);
    expect(
      autoSequence(
        [
          { lat: 13, lng: 80 },
          { lat: 13.1, lng: 80.1 },
        ],
        null,
      ),
    ).toHaveLength(2);
  });
});

describe('expiry', () => {
  it('counts days between dates', () => {
    expect(daysBetween('2026-11-03', '2026-11-20')).toBe(17);
    expect(daysBetween('2026-11-03', '2026-11-01')).toBe(-2);
  });

  it('labels documents ok, due soon, expired or missing', () => {
    expect(expiryState('puc', '2026-11-15', '2026-11-03').state).toBe('due_soon');
    expect(expiryState('insurance', '2027-03-31', '2026-11-03').state).toBe('ok');
    expect(expiryState('fitness', '2026-10-31', '2026-11-03')).toMatchObject({ state: 'expired', days_left: -3 });
    expect(expiryState('permit', null, '2026-11-03').state).toBe('missing');
  });

  it('alerts at 30, 15, 7 and 1 days, on the day, then every 3 days while expired', () => {
    expect(alertThreshold(45)).toBeNull();
    expect(alertThreshold(30)).toBe(30);
    expect(alertThreshold(20)).toBe(30);
    expect(alertThreshold(12)).toBe(15);
    expect(alertThreshold(7)).toBe(7);
    expect(alertThreshold(1)).toBe(1);
    expect(alertThreshold(0)).toBe(0);
    expect(alertThreshold(-2)).toBe(0);
    expect(alertThreshold(-3)).toBe(-3);
    expect(alertThreshold(-4)).toBe(-3);
    expect(alertThreshold(-6)).toBe(-6);
  });

  it('sends SMS only at 7 days, 1 day and on the expiry day', () => {
    expect([30, 15, 7, 1, 0, -3].filter(sendsSms)).toEqual([7, 1, 0]);
  });
});

describe('vehicle master rules', () => {
  it('stops trips only for expired insurance, fitness or permit', () => {
    const expiries = [
      expiryState('insurance', '2027-01-01', '2026-11-16'),
      expiryState('fitness', '2026-11-10', '2026-11-16'),
      expiryState('puc', '2026-11-01', '2026-11-16'),
      expiryState('permit', null, '2026-11-16'),
    ];
    expect(roadBlockers(expiries)).toEqual(['Fitness certificate']);
  });

  it('flags a bus as nearly full at 90% of its seats', () => {
    expect(occupancy(36, 40)).toEqual({ occupancy_percent: 90, nearly_full: true, over_capacity: false });
    expect(occupancy(30, 40)).toMatchObject({ nearly_full: false });
    expect(occupancy(42, 40)).toMatchObject({ nearly_full: false, over_capacity: true });
    expect(occupancy(0, 0).occupancy_percent).toBe(0);
  });
});

describe('passengerRef', () => {
  it('is opaque and unique', () => {
    const first = passengerRef();
    expect(first).toMatch(/^P[0-9a-f]{18}$/);
    expect(passengerRef()).not.toBe(first);
  });
});

describe('stopForTrip', () => {
  it('uses the drop stop on the evening trip only when one is set', () => {
    const split = { stop_id: 4, drop_stop_id: 7, mode: 'both' as const };
    expect(stopForTrip(split, 'pickup')).toBe(4);
    expect(stopForTrip(split, 'drop')).toBe(7);
    expect(stopForTrip({ ...split, drop_stop_id: null }, 'drop')).toBe(4);
  });

  it('lists the stops a rider uses for each trip', () => {
    expect(stopsOf({ stop_id: 4, drop_stop_id: 7, mode: 'both' })).toEqual({ pickup: 4, drop: 7 });
    expect(stopsOf({ stop_id: 4, drop_stop_id: null, mode: 'pickup' })).toEqual({ pickup: 4, drop: null });
    expect(stopsOf({ stop_id: 4, drop_stop_id: null, mode: 'drop' })).toEqual({ pickup: null, drop: 4 });
  });
});

describe('seatCheck', () => {
  it('counts the morning and evening trips separately', () => {
    expect(tripRiders(['both', 'pickup', 'drop'])).toEqual({ pickup: 2, drop: 2 });
  });

  it('lets a pickup-only and a drop-only student share a seat', () => {
    expect(seatCheck(1, tripRiders(['pickup', 'drop']))).toBeNull();
  });

  it('names the trip that is over capacity', () => {
    expect(seatCheck(2, tripRiders(['both', 'both', 'pickup']))).toBe('2 seats, but the morning trip would carry 3');
    expect(seatCheck(2, tripRiders(['both', 'both', 'drop']))).toBe('2 seats, but the evening trip would carry 3');
    expect(seatCheck(1, tripRiders(['both', 'both']))).toBe(
      '1 seats, but the morning trip would carry 2 and the evening trip would carry 2',
    );
  });

  it('allows a full bus exactly at capacity', () => {
    expect(seatCheck(3, tripRiders(['both', 'both', 'both']))).toBeNull();
  });
});

describe('stopFee and riderFee', () => {
  it('uses the route fee unless the stop has its own', () => {
    expect(stopFee(null, 1200)).toBe(1200);
    expect(stopFee(undefined, 1200)).toBe(1200);
    expect(stopFee(1500, 1200)).toBe(1500);
    expect(stopFee(0, 1200)).toBe(0);
  });

  it('charges the dearer of the pickup and drop stops', () => {
    expect(riderFee(1200, null)).toBe(1200);
    expect(riderFee(1200, 900)).toBe(900);
    expect(riderFee(1200, 900, null)).toBe(1200);
    expect(riderFee(1200, 1500, null)).toBe(1500);
  });
});
