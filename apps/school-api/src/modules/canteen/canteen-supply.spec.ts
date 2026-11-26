import {
  addDays,
  bookingConflicts,
  canCancelPurchase,
  canMoveBatch,
  daysUntil,
  expiryState,
  linesTotal,
  partyFits,
  receiveRefusal,
  remainingToReceive,
  stockDelta,
  stockRefusal,
  suggestedBatchQuantity,
  wasteCost,
} from './canteen-supply.logic';

describe('stock delta', () => {
  it('adds for purchase and return, subtracts for issue and wastage', () => {
    expect(stockDelta('purchase', 5)).toBe(5);
    expect(stockDelta('return', 2.5)).toBe(2.5);
    expect(stockDelta('issue', 3)).toBe(-3);
    expect(stockDelta('wastage', 1.25)).toBe(-1.25);
  });

  it('keeps the sign for an adjustment', () => {
    expect(stockDelta('adjustment', -4)).toBe(-4);
    expect(stockDelta('adjustment', 4)).toBe(4);
  });

  it('refuses zero, negative non-adjustments and non numbers', () => {
    expect(stockDelta('adjustment', 0)).toBeNull();
    expect(stockDelta('issue', -2)).toBeNull();
    expect(stockDelta('purchase', Number.NaN)).toBeNull();
  });

  it('refuses to go below zero but allows reaching zero', () => {
    expect(stockRefusal(5, -5)).toBeNull();
    expect(stockRefusal(5, -5.001)).toBe('STOCK_INSUFFICIENT');
    expect(stockRefusal(0, 3)).toBeNull();
  });
});

describe('expiry window', () => {
  it('counts days between dates', () => {
    expect(daysUntil('2026-03-01', '2026-02-27')).toBe(2);
    expect(daysUntil('2026-02-27', '2026-03-01')).toBe(-2);
  });

  it('classifies expiry', () => {
    expect(expiryState(null, '2026-06-01', 7)).toBe('none');
    expect(expiryState('2026-05-31', '2026-06-01', 7)).toBe('expired');
    expect(expiryState('2026-06-01', '2026-06-01', 7)).toBe('soon');
    expect(expiryState('2026-06-08', '2026-06-01', 7)).toBe('soon');
    expect(expiryState('2026-06-09', '2026-06-01', 7)).toBe('ok');
  });

  it('adds days across months', () => {
    expect(addDays('2026-01-30', 3)).toBe('2026-02-02');
  });
});

describe('receiving a purchase', () => {
  const line = { quantity: 10, received_quantity: 4 };

  it('accepts up to the remaining quantity', () => {
    expect(receiveRefusal(line, 6)).toBeNull();
    expect(remainingToReceive(line)).toBe(6);
  });

  it('refuses more than ordered', () => {
    expect(receiveRefusal(line, 6.5)).toBe('RECEIVE_EXCEEDS_ORDERED');
  });

  it('refuses zero and negative quantities', () => {
    expect(receiveRefusal(line, 0)).toBe('RECEIVE_QUANTITY_INVALID');
    expect(receiveRefusal(line, -1)).toBe('RECEIVE_QUANTITY_INVALID');
  });

  it('totals the lines', () => {
    expect(
      linesTotal([
        { quantity: 2.5, unit_cost: 40 },
        { quantity: 3, unit_cost: 19.99 },
      ]),
    ).toBe(159.97);
  });

  it('cancels only when nothing was received', () => {
    expect(canCancelPurchase('draft', 0)).toBe(true);
    expect(canCancelPurchase('ordered', 0)).toBe(true);
    expect(canCancelPurchase('ordered', 1)).toBe(false);
    expect(canCancelPurchase('partial', 0)).toBe(false);
    expect(canCancelPurchase('received', 0)).toBe(false);
  });
});

describe('batch transitions', () => {
  it('follows planned, cooking, done', () => {
    expect(canMoveBatch('planned', 'cooking')).toBe(true);
    expect(canMoveBatch('cooking', 'done')).toBe(true);
  });

  it('allows cancelling before done', () => {
    expect(canMoveBatch('planned', 'cancelled')).toBe(true);
    expect(canMoveBatch('cooking', 'cancelled')).toBe(true);
  });

  it('blocks skipping and reopening', () => {
    expect(canMoveBatch('planned', 'done')).toBe(false);
    expect(canMoveBatch('done', 'cooking')).toBe(false);
    expect(canMoveBatch('cancelled', 'planned')).toBe(false);
  });

  it('suggests quantity from the limit or the sales', () => {
    expect(suggestedBatchQuantity(100, 40, 30)).toBe(70);
    expect(suggestedBatchQuantity(100, 40, 120)).toBe(0);
    expect(suggestedBatchQuantity(null, 40, 30)).toBe(10);
  });
});

describe('table booking', () => {
  const booking = { id: 1, table_id: 3, booking_date: '2026-06-01', slot: 'lunch', status: 'reserved' };

  it('detects the same table, date and slot', () => {
    expect(
      bookingConflicts([booking], { table_id: 3, booking_date: '2026-06-01', slot: 'lunch', status: 'reserved' }),
    ).toBe(true);
  });

  it('ignores other tables, slots, dates and finished bookings', () => {
    const candidate = { table_id: 3, booking_date: '2026-06-01', slot: 'lunch', status: 'reserved' };
    expect(bookingConflicts([{ ...booking, table_id: 4 }], candidate)).toBe(false);
    expect(bookingConflicts([{ ...booking, slot: 'snacks' }], candidate)).toBe(false);
    expect(bookingConflicts([{ ...booking, booking_date: '2026-06-02' }], candidate)).toBe(false);
    expect(bookingConflicts([{ ...booking, status: 'cancelled' }], candidate)).toBe(false);
    expect(bookingConflicts([{ ...booking, status: 'completed' }], candidate)).toBe(false);
  });

  it('does not conflict with itself', () => {
    expect(bookingConflicts([booking], { ...booking })).toBe(false);
  });

  it('checks the party against the seats', () => {
    expect(partyFits(4, 4)).toBe(true);
    expect(partyFits(5, 4)).toBe(false);
    expect(partyFits(0, 4)).toBe(false);
  });
});

describe('waste cost', () => {
  it('uses the given cost first', () => {
    expect(wasteCost({ quantity: 2, given_cost: 15, stock_cost_per_unit: 100 })).toBe(15);
  });

  it('estimates from the stock cost', () => {
    expect(wasteCost({ quantity: 2.5, stock_cost_per_unit: 40 })).toBe(100);
  });

  it('estimates from the recipe cost', () => {
    expect(wasteCost({ quantity: 3, recipe_cost_per_portion: 12.5 })).toBe(37.5);
  });

  it('falls back to zero', () => {
    expect(wasteCost({ quantity: 3 })).toBe(0);
  });
});
