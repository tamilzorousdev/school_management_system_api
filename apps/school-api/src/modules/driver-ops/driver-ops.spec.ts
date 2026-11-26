import { tripAway } from '../../shared/student-away';
import { plannedGapSeconds } from '../tracking/tracking.logic';
import {
  clockOf,
  dutyPlace,
  hoursBetween,
  lateMinutes,
  metresBetween,
  minutesOf,
  reportingTime,
  studentsTodaySummary,
} from './driver-ops.logic';

describe('transport students today', () => {
  it('counts riders, who is away per trip, early leaves and held passes', () => {
    expect(
      studentsTodaySummary({
        riders: 10,
        away: [
          { pickup: true, drop: true },
          { pickup: false, drop: true },
          { pickup: true, drop: false },
        ],
        earlyLeaves: ['released', 'approved', 'released'],
        onHold: 2,
      }),
    ).toEqual({
      riders: 10,
      coming: 9,
      away_pickup: 2,
      away_drop: 2,
      early_leave: 2,
      early_leave_waiting: 1,
      passes_on_hold: 2,
    });
  });
});

describe('driver duty', () => {
  it('reports 15 minutes before the first stop', () => {
    expect(reportingTime('07:15')).toBe('07:00');
    expect(reportingTime('00:05')).toBe('23:50');
    expect(reportingTime(null)).toBeNull();
  });

  it('counts late minutes only after the reporting time', () => {
    expect(lateMinutes('07:00', '06:58')).toBe(0);
    expect(lateMinutes('07:00', '07:00')).toBe(0);
    expect(lateMinutes('07:00', '07:12')).toBe(12);
    expect(lateMinutes(null, '09:00')).toBe(0);
  });

  it('reads clock times', () => {
    expect(minutesOf('06:30:00')).toBe(390);
    expect(minutesOf('')).toBeNull();
    expect(clockOf(390)).toBe('06:30');
  });

  it('tells where the driver checked in', () => {
    const school = { lat: 13.0827, lng: 80.2707, radius_m: 200 };
    const stops = [{ lat: 13.1, lng: 80.2, radius_m: 100 }];
    expect(dutyPlace(null, school, stops)).toBe('unknown');
    expect(dutyPlace({ lat: 13.0828, lng: 80.2708 }, school, stops)).toBe('school');
    expect(dutyPlace({ lat: 13.1001, lng: 80.2001 }, school, stops)).toBe('stop');
    expect(dutyPlace({ lat: 12.9, lng: 80.0 }, school, stops)).toBe('other');
  });

  it('measures distance and hours', () => {
    expect(Math.round(metresBetween({ lat: 13, lng: 80 }, { lat: 13.001, lng: 80 }))).toBe(111);
    expect(hoursBetween(new Date('2026-11-25T06:00:00Z'), new Date('2026-11-25T15:30:00Z'))).toBe(9.5);
    expect(hoursBetween(new Date(), null)).toBeNull();
  });
});

describe('phone trips', () => {
  it('uses the planned gap between stops as the ETA, or 5 minutes', () => {
    expect(plannedGapSeconds('07:00', '07:08')).toBe(480);
    expect(plannedGapSeconds('16:20', '16:10')).toBe(600);
    expect(plannedGapSeconds(null, '07:08')).toBe(300);
    expect(plannedGapSeconds('07:00', '07:00')).toBe(300);
    expect(plannedGapSeconds('06:00', '09:00')).toBe(300);
  });

  it('treats a parent no-bus day as away for that trip only', () => {
    const day = { leaves: [], od_sessions: [], od_title: null, morning: null, afternoon: null, bus_off: ['pickup'] };
    expect(tripAway(day, 'pickup')).toEqual({ reason: 'no_bus', note: 'Parent: not taking the bus' });
    expect(tripAway(day, 'drop')).toBeNull();
  });
});

describe('gate pass early leave', () => {
  it('keeps the child off the evening bus only', () => {
    const day = {
      leaves: [],
      od_sessions: [],
      od_title: null,
      morning: null,
      afternoon: null,
      early_leave: 'Murugan (Uncle)',
    };
    expect(tripAway(day, 'drop')).toEqual({
      reason: 'early_leave',
      note: 'Gone home early (gate pass) with Murugan (Uncle)',
    });
    expect(tripAway(day, 'pickup')).toBeNull();
  });
});
