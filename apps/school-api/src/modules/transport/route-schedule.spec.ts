import { journeyText } from './routes.service';
import {
  checkSchedule,
  routeTimings,
  ScheduleStop,
  timeShift,
  timeWindows,
  windowsOverlap,
} from './route-schedule.logic';

const stop = (name: string, pickup: string | null, drop: string | null, lat = 13.08, lng = 80.21): ScheduleStop => ({
  name,
  lat,
  lng,
  pickup_time: pickup,
  drop_time: drop,
});
const school = { start: '08:30', end: '15:30' };
const codes = (stops: ScheduleStop[]) => checkSchedule(stops, school).map((item) => item.code);

describe('route schedule checks', () => {
  it('accepts pickups going up before school and drops going up after school in reverse order', () => {
    expect(
      checkSchedule(
        [
          stop('Anna Nagar', '07:30', '16:20'),
          stop('Kilpauk', '07:45', '16:05', 13.081, 80.211),
          stop('Egmore', '08:00', '15:50', 13.082, 80.212),
        ],
        school,
      ),
    ).toEqual([]);
  });

  it('needs every stop to have a time once one has it', () => {
    expect(codes([stop('A', '07:30', null), stop('B', null, null)])).toEqual(['PICKUP_TIME_MISSING']);
  });

  it('blocks pickups out of order or closer than 2 minutes', () => {
    expect(codes([stop('A', '07:40', null), stop('B', '07:35', null)])).toContain('PICKUP_TIME_ORDER');
    expect(codes([stop('A', '07:40', null), stop('B', '07:41', null)])).toContain('PICKUP_TIME_ORDER');
  });

  it('blocks a pickup at or after school start and a drop at or before school end', () => {
    expect(codes([stop('A', '08:30', null)])).toEqual(['PICKUP_AFTER_SCHOOL_START']);
    expect(codes([stop('A', null, '15:30')])).toEqual(['DROP_BEFORE_SCHOOL_END']);
  });

  it('checks drops from the last stop outwards', () => {
    expect(codes([stop('A', null, '16:00'), stop('B', null, '16:10')])).toContain('DROP_TIME_ORDER');
  });

  it('warns when stops far apart are only minutes apart', () => {
    const problems = checkSchedule(
      [stop('A', '07:30', null, 13.0, 80.2), stop('B', '07:33', null, 13.1, 80.3)],
      school,
    );
    expect(problems).toEqual([expect.objectContaining({ code: 'STOP_TIMES_TOO_CLOSE', severity: 'warning' })]);
  });
});

describe('route timings and clashes', () => {
  it('estimates reaching and leaving school from the distance to the school', () => {
    const near = { lat: 13.0805, lng: 80.2105 };
    expect(routeTimings([stop('A', '07:10', '16:40'), stop('B', '07:30', '16:20')], school, near)).toEqual({
      leaves_at: '07:10',
      reaches_school_at: '07:35',
      leaves_school_at: '16:15',
      last_drop_at: '16:40',
    });
  });

  it('works out when the route leaves and finishes', () => {
    expect(routeTimings([stop('A', '07:10', '16:40'), stop('B', '07:30', '16:20')], school)).toEqual({
      leaves_at: '07:10',
      reaches_school_at: '08:30',
      leaves_school_at: '15:30',
      last_drop_at: '16:40',
    });
  });

  it('finds overlapping rounds of the same bus', () => {
    const first = timeWindows({
      leaves_at: '07:00',
      reaches_school_at: '08:00',
      leaves_school_at: null,
      last_drop_at: null,
    });
    const second = timeWindows({
      leaves_at: '07:45',
      reaches_school_at: '08:30',
      leaves_school_at: null,
      last_drop_at: null,
    });
    const later = timeWindows({
      leaves_at: '08:00',
      reaches_school_at: '08:40',
      leaves_school_at: null,
      last_drop_at: null,
    });
    expect(windowsOverlap(first, second)).toBe(true);
    expect(windowsOverlap(first, later)).toBe(false);
  });

  it('measures how far a stop time moved', () => {
    expect(timeShift('07:30', '07:42')).toBe(12);
    expect(timeShift(null, null)).toBe(0);
    expect(timeShift(null, '07:30')).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('driver journey line', () => {
  const stopAt = { name: 'Kilpauk', pickup_time: '07:25', drop_time: '16:30' };

  it('says where the student boards and gets off', () => {
    expect(journeyText('both', stopAt)).toBe('Boards at Kilpauk 07:25 · Drops at Kilpauk 16:30');
    expect(journeyText('pickup', stopAt)).toBe('Boards at Kilpauk 07:25');
    expect(journeyText('drop', stopAt)).toBe('Drops at Kilpauk 16:30');
  });
});
