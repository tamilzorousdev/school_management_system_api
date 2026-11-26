import {
  attendanceRate,
  billFor,
  canMoveOrder,
  dailyLimitRefusal,
  documentNo,
  isWithinHours,
  money,
  receiveStatus,
  slotAt,
  stockStatus,
  tokenLabel,
  walletRefusal,
} from './canteen.logic';

describe('canteen billing', () => {
  it('adds tax after the discount', () => {
    const bill = billFor(
      [
        { unit_price: 40, quantity: 2 },
        { unit_price: 15.5, quantity: 1 },
      ],
      5,
      10,
    );
    expect(bill).toEqual({ subtotal: 95.5, discount_amount: 10, tax_amount: 4.28, total_amount: 89.78 });
  });

  it('never discounts below zero or more than the subtotal', () => {
    expect(billFor([{ unit_price: 20, quantity: 1 }], 0, 500).total_amount).toBe(0);
    expect(billFor([{ unit_price: 20, quantity: 1 }], 0, -5).discount_amount).toBe(0);
  });

  it('rounds money to paise', () => {
    expect(money(1.005 + 0.0000001)).toBe(1.01);
    expect(money(10.234)).toBe(10.23);
  });
});

describe('canteen tokens and numbers', () => {
  it('pads tokens and builds document numbers', () => {
    expect(tokenLabel('T', 7)).toBe('T007');
    expect(tokenLabel('CN', 1234)).toBe('CN1234');
    expect(documentNo('ORD', '2026-11-26', 12)).toBe('ORD-20261126-0012');
  });
});

describe('canteen wallet rules', () => {
  it('refuses a bad amount and an overdraw', () => {
    expect(walletRefusal(100, 0, false)).toBe('WALLET_AMOUNT_INVALID');
    expect(walletRefusal(50, 60, false)).toBe('WALLET_INSUFFICIENT');
    expect(walletRefusal(50, 60, true)).toBeNull();
    expect(walletRefusal(50, 50, false)).toBeNull();
  });

  it('checks the daily limit only when one is set', () => {
    expect(dailyLimitRefusal(80, 30, 100)).toBe('DAILY_LIMIT_EXCEEDED');
    expect(dailyLimitRefusal(70, 30, 100)).toBeNull();
    expect(dailyLimitRefusal(500, 30, null)).toBeNull();
  });
});

describe('canteen service hours and slots', () => {
  it('maps the time of day to a meal slot', () => {
    expect(slotAt('08:15')).toBe('breakfast');
    expect(slotAt('12:30')).toBe('lunch');
    expect(slotAt('16:00')).toBe('snacks');
    expect(slotAt('19:00')).toBe('dinner');
  });

  it('tells whether the canteen is open', () => {
    expect(isWithinHours('09:00', '08:00', '17:00')).toBe(true);
    expect(isWithinHours('07:59', '08:00', '17:00')).toBe(false);
    expect(isWithinHours('17:01', '08:00', '17:00')).toBe(false);
  });
});

describe('canteen order flow', () => {
  it('moves forward and may cancel until served', () => {
    expect(canMoveOrder('placed', 'preparing')).toBe(true);
    expect(canMoveOrder('ready', 'served')).toBe(true);
    expect(canMoveOrder('preparing', 'cancelled')).toBe(true);
    expect(canMoveOrder('placed', 'served')).toBe(false);
    expect(canMoveOrder('served', 'cancelled')).toBe(false);
    expect(canMoveOrder('cancelled', 'placed')).toBe(false);
  });
});

describe('canteen stock and purchase status', () => {
  it('classifies stock levels', () => {
    expect(stockStatus(0, 5)).toBe('out');
    expect(stockStatus(5, 5)).toBe('low');
    expect(stockStatus(6, 5)).toBe('ok');
  });

  it('derives the purchase status from received quantities', () => {
    expect(receiveStatus([{ quantity: 10, received_quantity: 0 }])).toBe('ordered');
    expect(
      receiveStatus([
        { quantity: 10, received_quantity: 10 },
        { quantity: 5, received_quantity: 2 },
      ]),
    ).toBe('partial');
    expect(receiveStatus([{ quantity: 10, received_quantity: 10 }])).toBe('received');
  });
});

describe('canteen staff attendance rate', () => {
  it('counts a half day as half', () => {
    expect(attendanceRate(18, 4, 25)).toBe(80);
    expect(attendanceRate(0, 0, 0)).toBe(0);
  });
});
