import {
  addMonths,
  costPerKm,
  fillEconomy,
  gpsCheck,
  idleLitres,
  isLocked,
  isMonthEnd,
  mileageDropped,
  preTripResult,
  priceWarning,
  scheduleState,
  warrantyMatch,
} from './maintenance-plan.logic';

const window = { due_soon_km: 500, due_soon_days: 15 };

describe('addMonths', () => {
  it('keeps the day and clamps to the month end', () => {
    expect(addMonths('2026-05-10', 6)).toBe('2026-11-10');
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
  });
});

describe('scheduleState', () => {
  const rule = { every_km: 10000, every_months: 6, last_done_on: '2026-06-01', last_done_km: 40000 };

  it('is ok well before the date and the km', () => {
    const state = scheduleState(rule, 42000, '2026-08-01', window);
    expect(state).toMatchObject({ next_due_on: '2026-12-01', next_due_km: 50000, km_left: 8000, status: 'ok' });
  });

  it('is due soon within 500 km even when the date is far', () => {
    expect(scheduleState(rule, 49600, '2026-08-01', window).status).toBe('due_soon');
  });

  it('is due soon within 15 days', () => {
    expect(scheduleState(rule, 42000, '2026-11-20', window).status).toBe('due_soon');
  });

  it('is overdue when either the km or the date has passed', () => {
    expect(scheduleState(rule, 50100, '2026-08-01', window).status).toBe('overdue');
    expect(scheduleState(rule, 42000, '2026-12-02', window).status).toBe('overdue');
  });

  it('works with only months or only km, and without a current km', () => {
    expect(scheduleState({ ...rule, every_km: null }, null, '2026-08-01', window)).toMatchObject({
      next_due_km: null,
      km_left: null,
      status: 'ok',
    });
    expect(scheduleState({ ...rule, every_months: null }, null, '2030-01-01', window)).toMatchObject({
      next_due_on: null,
      status: 'ok',
    });
  });
});

describe('fillEconomy', () => {
  it('works out km per litre only between full fills, counting part fills in between', () => {
    const economy = fillEconomy([
      { id: 1, odometer_km: 1000, litres: 50, is_full: true },
      { id: 2, odometer_km: 1200, litres: 20, is_full: false },
      { id: 3, odometer_km: 1400, litres: 30, is_full: true },
    ]);
    expect(economy.get(1)).toEqual({ km_since_last: null, km_per_litre: null });
    expect(economy.get(2)).toEqual({ km_since_last: 200, km_per_litre: null });
    expect(economy.get(3)).toEqual({ km_since_last: 200, km_per_litre: 8 });
  });
});

describe('priceWarning', () => {
  it('warns only when the price is far from the average', () => {
    expect(priceWarning(96, 95, 15)).toBeNull();
    expect(priceWarning(120, 95, 15)).toContain('26% above');
    expect(priceWarning(70, 95, 15)).toContain('below');
    expect(priceWarning(70, null, 15)).toBeNull();
  });
});

describe('mileageDropped', () => {
  it('flags a drop of more than the percent', () => {
    expect(mileageDropped(5.5, 7, 20)).toBe(true);
    expect(mileageDropped(6, 7, 20)).toBe(false);
    expect(mileageDropped(null, 7, 20)).toBe(false);
  });
});

describe('gpsCheck', () => {
  it('compares odometer km with the km the tracker saw on trips', () => {
    expect(gpsCheck(400, 360)).toBe('ok');
    expect(gpsCheck(400, 500)).toBe('mismatch');
    expect(gpsCheck(900, 300)).toBe('mismatch');
    expect(gpsCheck(400, null)).toBe('unknown');
  });
});

describe('warrantyMatch', () => {
  const battery = {
    id: 7,
    category: 'battery',
    closed_at: new Date('2026-06-10T06:00:00Z'),
    odometer_km: 40000,
    warranty_months: 12,
    warranty_km: null,
  };

  it('flags a repeat repair of the same part within its warranty', () => {
    expect(warrantyMatch([battery], 'battery', '2026-11-18', 45000, 'Asia/Kolkata')).toEqual({
      ticket_id: 7,
      until: '2027-06-10',
      until_km: null,
    });
  });

  it('ignores other parts and expired warranties', () => {
    expect(warrantyMatch([battery], 'brakes', '2026-11-18', 45000, 'Asia/Kolkata')).toBeNull();
    expect(warrantyMatch([battery], 'battery', '2027-07-01', 45000, 'Asia/Kolkata')).toBeNull();
  });

  it('also uses the km warranty', () => {
    const tyre = { ...battery, category: 'tyres', warranty_months: null, warranty_km: 30000 };
    expect(warrantyMatch([tyre], 'tyres', '2030-01-01', 60000, 'Asia/Kolkata')?.until_km).toBe(70000);
    expect(warrantyMatch([tyre], 'tyres', '2030-01-01', 71000, 'Asia/Kolkata')).toBeNull();
  });
});

describe('month lock', () => {
  it('locks dates on or before the locked day', () => {
    expect(isLocked('2026-10-31', '2026-10-31')).toBe(true);
    expect(isLocked('2026-11-01', '2026-10-31')).toBe(false);
    expect(isLocked('2026-10-01', null)).toBe(false);
  });

  it('knows the last day of a month', () => {
    expect(isMonthEnd('2026-10-31')).toBe(true);
    expect(isMonthEnd('2027-02-28')).toBe(true);
    expect(isMonthEnd('2026-10-30')).toBe(false);
  });
});

describe('preTripResult', () => {
  it('fills missing items as not ok and flags critical failures', () => {
    const result = preTripResult([
      { item: 'tyres', ok: true },
      { item: 'lights', ok: false, note: ' Left indicator ' },
    ]);
    expect(result.items).toHaveLength(10);
    expect(result.items.find((mark) => mark.item === 'lights')?.note).toBe('Left indicator');
    expect(result.failed).toContain('brakes');
    expect(result.critical_failed).toBe(true);
  });

  it('passes when everything is ok', () => {
    const all = preTripResult(
      [
        'tyres',
        'brakes',
        'lights',
        'horn',
        'wipers',
        'mirrors',
        'doors',
        'first_aid',
        'fire_extinguisher',
        'cleanliness',
      ].map((item) => ({ item: item as never, ok: true })),
    );
    expect(all.failed).toEqual([]);
    expect(all.critical_failed).toBe(false);
  });
});

describe('idle and cost per km', () => {
  it('estimates idle fuel and cost per km', () => {
    expect(idleLitres(90, 2.5)).toBe(3.8);
    expect(costPerKm(5000, 1000)).toBe(5);
    expect(costPerKm(5000, 0)).toBeNull();
  });
});
