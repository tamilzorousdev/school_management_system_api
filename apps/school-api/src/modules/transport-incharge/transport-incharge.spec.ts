import { CREW_ROLES, nextStatus } from '../staff-leave/staff-leave.service';
import { ExpiryDto } from '../transport/dto/transport.dto';
import {
  classifyLate,
  LateInput,
  lateCounts,
  liveCounts,
  maintenanceDue,
  monthBounds,
  onTimePercent,
  paperCounts,
  weightedKmPerLitre,
} from './transport-incharge.logic';

const paper = (days_left: number): ExpiryDto =>
  ({
    kind: 'insurance',
    label: 'Insurance',
    subject: 'Bus 1',
    ref_id: 1,
    vehicle_id: 1,
    staff_id: null,
    date: '2026-12-01',
    days_left,
  }) as ExpiryDto;

describe('transport in-charge papers', () => {
  it('counts expired and due soon, most urgent first', () => {
    const result = paperCounts([paper(12), paper(-3), paper(0), paper(-10)]);
    expect(result.expired).toBe(2);
    expect(result.due_soon).toBe(2);
    expect(result.items.map((item) => item.days_left)).toEqual([-10, -3, 0, 12]);
  });
});

describe('crew leave', () => {
  it('treats drivers and attendants as bus crew', () => {
    expect(CREW_ROLES).toEqual(['DRIVER', 'ATTENDANT']);
  });

  it('a final approver approves a waiting request in one step', () => {
    expect(nextStatus('pending_hod', 'approved', true)).toBe('approved');
    expect(nextStatus('pending_hod', 'approved', false)).toBe('pending_principal');
    expect(nextStatus('pending_hod', 'rejected', true)).toBe('rejected');
  });
});

const trip = (input: Partial<LateInput>): LateInput => ({
  status: 'running',
  planned_minutes: 7 * 60,
  started_minutes: 7 * 60,
  now_minutes: 8 * 60,
  delay_minutes: null,
  skipped_stops: 0,
  ...input,
});

describe('late and missed trips', () => {
  it('a trip not started 10 minutes after the first stop time is not_started', () => {
    expect(classifyLate(trip({ status: 'late_start', started_minutes: null, now_minutes: 7 * 60 + 12 }))).toEqual({
      status: 'not_started',
      delay_minutes: 12,
    });
    expect(classifyLate(trip({ status: 'not_started', started_minutes: null, now_minutes: 7 * 60 + 9 }))).toBeNull();
  });

  it('a future day or a route with no stop time is never late', () => {
    expect(classifyLate(trip({ status: 'not_started', started_minutes: null, now_minutes: null }))).toBeNull();
    expect(classifyLate(trip({ status: 'not_started', started_minutes: null, planned_minutes: null }))).toBeNull();
  });

  it('a trip started 10 or more minutes late is late_start', () => {
    expect(classifyLate(trip({ started_minutes: 7 * 60 + 10 }))).toEqual({ status: 'late_start', delay_minutes: 10 });
    expect(classifyLate(trip({ started_minutes: 7 * 60 + 9 }))).toBeNull();
    expect(classifyLate(trip({ started_minutes: 6 * 60 + 40 }))).toBeNull();
  });

  it('a running trip with a reported delay of 10 or more is running_late, ahead of late_start', () => {
    expect(classifyLate(trip({ status: 'delayed', delay_minutes: 15, started_minutes: 7 * 60 + 20 }))).toEqual({
      status: 'running_late',
      delay_minutes: 15,
    });
    expect(classifyLate(trip({ status: 'delayed', delay_minutes: 5 }))).toBeNull();
  });

  it('a completed trip with skipped stops is missed_stops; without them only a late start counts', () => {
    expect(classifyLate(trip({ status: 'completed', skipped_stops: 2, started_minutes: 7 * 60 + 3 }))).toEqual({
      status: 'missed_stops',
      delay_minutes: 3,
    });
    expect(classifyLate(trip({ status: 'completed', started_minutes: 7 * 60 + 25 }))).toEqual({
      status: 'late_start',
      delay_minutes: 25,
    });
    expect(classifyLate(trip({ status: 'completed' }))).toBeNull();
  });

  it('counts late (late_start + running_late), not started and missed stops', () => {
    expect(
      lateCounts([
        { status: 'late_start' },
        { status: 'running_late' },
        { status: 'not_started' },
        { status: 'missed_stops' },
      ]),
    ).toEqual({ late: 2, not_started: 1, missed_stops: 1 });
  });
});

describe('maintenance due window', () => {
  it('overdue when the date or the km has passed', () => {
    expect(maintenanceDue({ days_left: -1, km_left: 5000 })).toBe('overdue');
    expect(maintenanceDue({ days_left: 90, km_left: -20 })).toBe('overdue');
  });

  it('due soon within 30 days or 1000 km', () => {
    expect(maintenanceDue({ days_left: 30, km_left: null })).toBe('due_soon');
    expect(maintenanceDue({ days_left: null, km_left: 1000 })).toBe('due_soon');
    expect(maintenanceDue({ days_left: 31, km_left: 1001 })).toBeNull();
    expect(maintenanceDue({ days_left: null, km_left: null })).toBeNull();
  });
});

describe('monthly summary', () => {
  it('on-time percent to one decimal, 0 when nothing ran', () => {
    expect(onTimePercent(160, 176)).toBe(90.9);
    expect(onTimePercent(3, 3)).toBe(100);
    expect(onTimePercent(0, 0)).toBe(0);
  });

  it('fleet km per litre is weighted by litres and skips buses with no figure', () => {
    expect(
      weightedKmPerLitre([
        { litres: 100, km_per_litre: 6 },
        { litres: 300, km_per_litre: 4 },
        { litres: 50, km_per_litre: null },
      ]),
    ).toBe(4.5);
    expect(weightedKmPerLitre([{ litres: 0, km_per_litre: 5 }])).toBeNull();
  });

  it('month bounds end on the first day of the next month', () => {
    expect(monthBounds('2026-11')).toEqual({ from: '2026-11-01', to: '2026-12-01' });
    expect(monthBounds('2026-12')).toEqual({ from: '2026-12-01', to: '2027-01-01' });
  });
});

describe('live map counts', () => {
  it('idle and parked count as stopped', () => {
    expect(
      liveCounts([
        { state: 'moving', trip: { id: 1 } },
        { state: 'idle', trip: null },
        { state: 'parked', trip: null },
        { state: 'offline', trip: null },
        { state: 'no_data', trip: null },
      ]),
    ).toEqual({ total: 5, moving: 1, stopped: 2, offline: 1, no_data: 1, on_trip: 1 });
  });
});
