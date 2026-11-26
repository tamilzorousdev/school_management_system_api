import {
  adjustmentRefusal,
  allergenWarnings,
  balanceAfter,
  cancelRefusal,
  cardNoFor,
  cardRefusal,
  counterBoard,
  dietWarning,
  isLowBalance,
  lineTotal,
  mergeLines,
  nextNumber,
  parseList,
  payRefusal,
  paymentStatusFor,
  refundRefusal,
  refundRoute,
  remainingQuantity,
  signedAmount,
  slotAllowed,
  soldOut,
  stampsFor,
  unitPrice,
  walletSpendToday,
} from './canteen-sales.logic';

describe('meal cards', () => {
  it('builds a padded card number', () => {
    expect(cardNoFor(7)).toBe('CN000007');
    expect(cardNoFor(123456)).toBe('CN123456');
  });

  it('accepts an active card of an active diner', () => {
    expect(cardRefusal('active', 'active')).toBeNull();
  });

  it('refuses blocked, lost and expired cards', () => {
    for (const status of ['blocked', 'lost', 'expired']) {
      expect(cardRefusal(status, 'active')?.code).toBe('CARD_NOT_ACTIVE');
    }
  });

  it('refuses suspended and left diners before looking at the card', () => {
    expect(cardRefusal('blocked', 'suspended')?.code).toBe('DINER_NOT_ACTIVE');
    expect(cardRefusal('active', 'left')?.code).toBe('DINER_NOT_ACTIVE');
  });
});

describe('meal slots and lists', () => {
  it('parses a comma list in lower case', () => {
    expect(parseList(' Peanut, MILK ,')).toEqual(['peanut', 'milk']);
    expect(parseList(null)).toEqual([]);
  });

  it('allows every slot when none are set', () => {
    expect(slotAllowed(null, 'lunch')).toBe(true);
    expect(slotAllowed('', 'dinner')).toBe(true);
  });

  it('allows only the listed slots', () => {
    expect(slotAllowed('breakfast,lunch', 'lunch')).toBe(true);
    expect(slotAllowed('breakfast,lunch', 'dinner')).toBe(false);
  });
});

describe('allergen and diet warnings', () => {
  it('warns when the item has an allergen the diner avoids', () => {
    expect(allergenWarnings('peanut, milk', 'Chikki', 'Peanut')).toEqual([
      'Chikki contains peanut, which this diner is allergic to',
    ]);
  });

  it('matches partial allergen names both ways', () => {
    expect(allergenWarnings('nuts', 'Cake', 'tree nuts')).toHaveLength(1);
    expect(allergenWarnings('tree nuts', 'Cake', 'nuts')).toHaveLength(1);
  });

  it('stays quiet without allergies or overlap', () => {
    expect(allergenWarnings(null, 'Cake', 'nuts')).toEqual([]);
    expect(allergenWarnings('soy', 'Cake', 'nuts')).toEqual([]);
    expect(allergenWarnings('soy', 'Cake', null)).toEqual([]);
  });

  it('warns a vegetarian about a non-veg item only', () => {
    expect(dietWarning('veg', 'Chicken Roll', false)).toContain('non-vegetarian');
    expect(dietWarning('veg', 'Dosa', true)).toBeNull();
    expect(dietWarning('non_veg', 'Chicken Roll', false)).toBeNull();
  });
});

describe('pricing and menu quantity', () => {
  it('prefers the menu price over the item price', () => {
    expect(unitPrice(30, 40)).toBe(30);
    expect(unitPrice(null, 40)).toBe(40);
    expect(unitPrice(0, 40)).toBe(0);
  });

  it('computes the remaining quantity', () => {
    expect(remainingQuantity(null, 5)).toBeNull();
    expect(remainingQuantity(10, 4)).toBe(6);
    expect(remainingQuantity(10, 12)).toBe(0);
  });

  it('detects a sold out item', () => {
    expect(soldOut(null, 100, 5)).toBe(false);
    expect(soldOut(10, 8, 2)).toBe(false);
    expect(soldOut(10, 8, 3)).toBe(true);
  });

  it('merges repeated lines of the same item', () => {
    const merged = mergeLines([
      { food_item_id: 1, quantity: 1 },
      { meal_id: 2, quantity: 1 },
      { food_item_id: 1, quantity: 2 },
    ]);
    expect(merged).toEqual([
      { food_item_id: 1, quantity: 3 },
      { meal_id: 2, quantity: 1 },
    ]);
  });

  it('rounds a line total to paise', () => {
    expect(lineTotal(33.33, 3)).toBe(99.99);
    expect(lineTotal(0.1, 3)).toBe(0.3);
  });
});

describe('wallet arithmetic', () => {
  it('signs amounts by kind', () => {
    expect(signedAmount('topup', 100)).toBe(100);
    expect(signedAmount('refund', 40)).toBe(40);
    expect(signedAmount('purchase', 60)).toBe(-60);
    expect(signedAmount('adjustment', -20)).toBe(-20);
    expect(signedAmount('adjustment', 20)).toBe(20);
  });

  it('adds without float drift', () => {
    expect(balanceAfter(0.1, 0.2)).toBe(0.3);
    expect(balanceAfter(100, -60)).toBe(40);
  });

  it('flags low balances at the limit', () => {
    expect(isLowBalance(50, 50)).toBe(true);
    expect(isLowBalance(50.01, 50)).toBe(false);
  });

  it('requires a note and a non-zero amount for an adjustment', () => {
    expect(adjustmentRefusal(0, 'x')?.code).toBe('WALLET_AMOUNT_INVALID');
    expect(adjustmentRefusal(10, '  ')?.code).toBe('WALLET_NOTE_REQUIRED');
    expect(adjustmentRefusal(10, undefined)?.code).toBe('WALLET_NOTE_REQUIRED');
    expect(adjustmentRefusal(-10, 'duplicate top-up')).toBeNull();
  });

  it('nets purchases against refunds for the daily limit', () => {
    expect(walletSpendToday(120, 20)).toBe(100);
    expect(walletSpendToday(10, 50)).toBe(0);
  });
});

describe('numbering', () => {
  it('starts at one and goes on', () => {
    expect(nextNumber(null)).toBe(1);
    expect(nextNumber(undefined)).toBe(1);
    expect(nextNumber(0)).toBe(1);
    expect(nextNumber(41)).toBe(42);
  });
});

describe('order decisions', () => {
  it('needs a reason to cancel', () => {
    expect(cancelRefusal(undefined)?.code).toBe('CANCEL_REASON_REQUIRED');
    expect(cancelRefusal('  ')?.code).toBe('CANCEL_REASON_REQUIRED');
    expect(cancelRefusal('Customer left')).toBeNull();
  });

  it('pays only unpaid orders that are not cancelled', () => {
    const order = { status: 'placed', payment_status: 'unpaid', total_amount: 84 };
    expect(payRefusal(order, undefined)).toBeNull();
    expect(payRefusal(order, 84)).toBeNull();
    expect(payRefusal(order, 80)?.code).toBe('PAYMENT_AMOUNT_MISMATCH');
    expect(payRefusal({ ...order, status: 'cancelled' }, 84)?.code).toBe('ORDER_CANCELLED');
    expect(payRefusal({ ...order, payment_status: 'paid' }, 84)?.code).toBe('ORDER_ALREADY_PAID');
  });

  it('refunds only paid orders with a reason', () => {
    expect(refundRefusal({ payment_status: 'unpaid' }, 'x')?.code).toBe('ORDER_NOT_PAID');
    expect(refundRefusal({ payment_status: 'refunded' }, 'x')?.code).toBe('ORDER_NOT_PAID');
    expect(refundRefusal({ payment_status: 'paid' }, undefined)?.code).toBe('CANCEL_REASON_REQUIRED');
    expect(refundRefusal({ payment_status: 'paid' }, 'Wrong item')).toBeNull();
  });

  it('refunds wallet payments to the wallet', () => {
    expect(refundRoute(true)).toBe('wallet');
    expect(refundRoute(false)).toBe('payment');
  });

  it('marks an order paid only when the total is covered', () => {
    expect(paymentStatusFor(84, 84)).toBe('paid');
    expect(paymentStatusFor(84, 50)).toBe('unpaid');
    expect(paymentStatusFor(0, 0)).toBe('unpaid');
  });

  it('stamps the time of ready, served and cancelled', () => {
    const now = new Date('2026-06-01T10:00:00Z');
    expect(stampsFor('ready', now)).toEqual({ ready_at: now });
    expect(stampsFor('served', now)).toEqual({ served_at: now });
    expect(stampsFor('cancelled', now)).toEqual({ cancelled_at: now });
    expect(stampsFor('preparing', now)).toEqual({});
  });

  it('splits the token board into preparing and ready', () => {
    const board = counterBoard([
      { status: 'placed', token_label: 'T001' },
      { status: 'preparing', token_label: 'T002' },
      { status: 'ready', token_label: 'T003' },
    ]);
    expect(board).toEqual({ preparing: ['T001', 'T002'], ready: ['T003'] });
  });
});
