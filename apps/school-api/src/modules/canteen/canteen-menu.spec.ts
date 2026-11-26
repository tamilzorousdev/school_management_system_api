import {
  addDays,
  copyDrafts,
  duplicateKey,
  effectivePrice,
  entryKey,
  entryRefusal,
  groupBySlot,
  isPastDate,
  mealPricing,
  planReplace,
  remainingQuantity,
  settingsRefusal,
  weekDates,
} from './canteen-menu.logic';

const base = { opens_at: '08:00', closes_at: '17:00', tax_percent: 0, token_prefix: 'T' };

describe('settingsRefusal', () => {
  it('accepts valid settings', () => {
    expect(settingsRefusal(base, { tax_percent: 5, token_prefix: 'CAN' })).toBeNull();
  });
  it('requires opening before closing', () => {
    expect(settingsRefusal(base, { opens_at: '18:00' })?.field).toBe('closes_at');
    expect(settingsRefusal(base, { closes_at: '08:00' })?.field).toBe('closes_at');
  });
  it('rejects bad times, tax and prefix', () => {
    expect(settingsRefusal(base, { opens_at: '8:00' })?.field).toBe('opens_at');
    expect(settingsRefusal(base, { closes_at: '25:00' })?.field).toBe('closes_at');
    expect(settingsRefusal(base, { tax_percent: 51 })?.field).toBe('tax_percent');
    expect(settingsRefusal(base, { token_prefix: 'abc' })?.field).toBe('token_prefix');
    expect(settingsRefusal(base, { token_prefix: 'ABCDE' })?.field).toBe('token_prefix');
  });
});

describe('prices and stock', () => {
  it('uses the entry price when set, else the base price', () => {
    expect(effectivePrice(null, 40)).toBe(40);
    expect(effectivePrice(35.5, 40)).toBe(35.5);
    expect(effectivePrice(0, 40)).toBe(0);
  });
  it('counts what is left', () => {
    expect(remainingQuantity(null, 5)).toBeNull();
    expect(remainingQuantity(20, 5)).toBe(15);
    expect(remainingQuantity(5, 9)).toBe(0);
  });
  it('totals a combo and its saving', () => {
    expect(
      mealPricing(
        [
          { price: 40, quantity: 1 },
          { price: 15, quantity: 2 },
        ],
        60,
      ),
    ).toEqual({ item_total: 70, saving: 10 });
  });
});

describe('daily menu entries', () => {
  it('needs exactly one of item or meal', () => {
    expect(entryRefusal({ food_item_id: 1, meal_id: 2 })).not.toBeNull();
    expect(entryRefusal({})).not.toBeNull();
    expect(entryRefusal({ food_item_id: null, meal_id: null })).not.toBeNull();
    expect(entryRefusal({ food_item_id: 1 })).toBeNull();
    expect(entryRefusal({ meal_id: 2 })).toBeNull();
  });
  it('finds duplicates', () => {
    expect(duplicateKey([{ food_item_id: 1 }, { meal_id: 1 }])).toBeNull();
    expect(duplicateKey([{ food_item_id: 1 }, { food_item_id: 1 }])).toBe('item:1');
    expect(entryKey({ meal_id: 4 })).toBe('meal:4');
  });
  it('refuses past dates only', () => {
    expect(isPastDate('2026-06-01', '2026-06-02')).toBe(true);
    expect(isPastDate('2026-06-02', '2026-06-02')).toBe(false);
  });
});

describe('planReplace', () => {
  it('keeps matching rows, creates new ones, removes the rest', () => {
    const plan = planReplace(
      [
        { id: 1, key: 'item:1' },
        { id: 2, key: 'item:2' },
        { id: 3, key: 'meal:1' },
      ],
      ['item:2', 'item:9', 'meal:1'],
    );
    expect(plan.update).toEqual([
      { id: 2, index: 0 },
      { id: 3, index: 2 },
    ]);
    expect(plan.create).toEqual([1]);
    expect(plan.remove).toEqual([1]);
  });
  it('removes everything for an empty list', () => {
    expect(planReplace([{ id: 5, key: 'item:1' }], []).remove).toEqual([5]);
  });
});

describe('copying and weeks', () => {
  const source = [
    { slot: 'lunch' as const, food_item_id: 1, meal_id: null, price: null, quantity_limit: 10, active: true },
    { slot: 'dinner' as const, food_item_id: null, meal_id: 2, price: 50, quantity_limit: null, active: true },
  ];
  it('copies one slot or all', () => {
    expect(copyDrafts(source)).toHaveLength(2);
    expect(copyDrafts(source, 'lunch')).toEqual([source[0]]);
    expect(copyDrafts(source)[0]).not.toBe(source[0]);
  });
  it('builds seven dates across a month end', () => {
    expect(addDays('2026-02-27', 3)).toBe('2026-03-02');
    expect(weekDates('2026-12-29')).toEqual([
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
      '2027-01-04',
    ]);
  });
  it('groups entries by slot in day order', () => {
    const groups = groupBySlot([
      { slot: 'dinner' as const },
      { slot: 'breakfast' as const },
      { slot: 'dinner' as const },
    ]);
    expect(groups.map((group) => group.slot)).toEqual(['breakfast', 'dinner']);
    expect(groups[1]!.entries).toHaveLength(2);
  });
});
