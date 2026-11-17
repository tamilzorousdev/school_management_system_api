import {
  boardingStep,
  boardingStopId,
  checklistSummary,
  clockIn,
  riderStatus,
  routeRefusal,
  tripFlag,
  undoRefusal,
} from './boarding.logic';

describe('routeRefusal', () => {
  const trip = { route_id: 1, kind: 'pickup' as const };

  it('lets a student on the trip route and mode through', () => {
    expect(routeRefusal({ route_id: 1, mode: 'both' }, trip)).toBeNull();
    expect(routeRefusal({ route_id: 1, mode: 'pickup' }, trip)).toBeNull();
  });

  it('refuses a student with no bus or on another route', () => {
    expect(routeRefusal(null, trip)?.code).toBe('NOT_ON_THIS_ROUTE');
    expect(routeRefusal({ route_id: 2, mode: 'both' }, trip)?.code).toBe('NOT_ON_THIS_ROUTE');
  });

  it('refuses a student on the route who does not ride this kind of trip', () => {
    const refusal = routeRefusal({ route_id: 1, mode: 'drop' }, trip);
    expect(refusal?.code).toBe('NOT_ON_THIS_TRIP');
    expect(refusal?.message).toContain('morning pickup');
  });
});

describe('boardingStep', () => {
  it('records the first boarding and the first alighting after it', () => {
    expect(boardingStep([], 'boarded')).toBe('record');
    expect(boardingStep(['boarded'], 'alighted')).toBe('record');
  });

  it('treats a second scan of the same action as a duplicate', () => {
    expect(boardingStep(['boarded'], 'boarded')).toBe('duplicate');
    expect(boardingStep(['boarded', 'alighted'], 'alighted')).toBe('duplicate');
    expect(boardingStep(['boarded', 'alighted'], 'boarded')).toBe('duplicate');
  });

  it('refuses getting off before getting on', () => {
    expect(boardingStep([], 'alighted')).toBe('not_boarded');
  });
});

describe('boardingStopId', () => {
  it('puts the home stop on pickup boarding and drop alighting, the school gate otherwise', () => {
    expect(boardingStopId('boarded', 'pickup', 7)).toBe(7);
    expect(boardingStopId('alighted', 'pickup', 7)).toBeNull();
    expect(boardingStopId('boarded', 'drop', 7)).toBeNull();
    expect(boardingStopId('alighted', 'drop', 7)).toBe(7);
  });
});

describe('clockIn', () => {
  it('shows the time in the school time zone', () => {
    expect(clockIn(new Date('2026-11-09T02:05:00Z'), 'Asia/Kolkata').toLowerCase()).toBe('07:35 am');
  });
});

describe('riderStatus and tripFlag', () => {
  const waiting = { boarded: false, alighted: false, away_today: false };
  const away = { boarded: false, alighted: false, away_today: true };
  const onBus = { boarded: true, alighted: false, away_today: false };
  const offBus = { boarded: true, alighted: true, away_today: false };

  it('reads the marks of a student', () => {
    expect(riderStatus(waiting)).toBe('waiting');
    expect(riderStatus(away)).toBe('away');
    expect(riderStatus(onBus)).toBe('on_bus');
    expect(riderStatus(offBus)).toBe('off_bus');
    expect(riderStatus({ ...onBus, away_today: true })).toBe('on_bus');
  });

  it('flags nobody while the trip runs', () => {
    expect([waiting, away, onBus, offBus].map((rider) => tripFlag(rider, false))).toEqual([null, null, null, null]);
  });

  it('flags not boarded and still on the bus once the trip ends', () => {
    expect([waiting, away, onBus, offBus].map((rider) => tripFlag(rider, true))).toEqual([
      'not_boarded',
      null,
      'not_alighted',
      null,
    ]);
  });

  it('counts the checklist', () => {
    expect(checklistSummary([waiting, away, onBus, offBus, offBus], true)).toEqual({
      total: 5,
      away: 1,
      waiting: 1,
      on_bus: 1,
      off_bus: 2,
      not_boarded: 1,
      not_alighted: 1,
    });
    expect(checklistSummary([waiting, onBus], false)).toMatchObject({ not_boarded: 0, not_alighted: 0 });
  });
});

describe('undoRefusal', () => {
  it('needs got off undone before boarded', () => {
    expect(undoRefusal(['boarded', 'alighted'], 'boarded')?.code).toBe('UNDO_ALIGHTED_FIRST');
    expect(undoRefusal(['boarded', 'alighted'], 'alighted')).toBeNull();
    expect(undoRefusal(['boarded'], 'boarded')).toBeNull();
  });
});
