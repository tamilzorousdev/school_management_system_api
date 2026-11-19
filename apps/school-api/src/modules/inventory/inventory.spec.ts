import { isCalendarDate } from './inventory-files';
import {
  allocationRefusal,
  annualRate,
  assetTag,
  averageRate,
  bookValue,
  codeFrom,
  daysBetween,
  depreciationForYear,
  DepreciationInput,
  disposalRefusal,
  documentNumber,
  maintenanceRefusal,
  nextDueDate,
  receive,
  requisitionStatusAfterIssue,
  stockRefusal,
  transferRefusal,
  withdraw,
} from './inventory.logic';

const laptop = (overrides: Partial<DepreciationInput> = {}): DepreciationInput => ({
  cost: 60000,
  residual_value: 3000,
  purchase_date: '2024-06-01',
  rate: null,
  useful_life_years: 3,
  method: 'straight_line',
  ...overrides,
});

describe('inventory depreciation', () => {
  it('prefers the category rate over the useful life', () => {
    expect(annualRate({ rate: 20, useful_life_years: 3 })).toBe(0.2);
    expect(annualRate({ rate: null, useful_life_years: 4 })).toBe(0.25);
    expect(annualRate({ rate: null, useful_life_years: null })).toBe(0);
  });

  it('straight line loses the same amount each year', () => {
    const value = bookValue(laptop(), '2025-06-01');
    expect(value).toBeGreaterThan(39900);
    expect(value).toBeLessThan(40100);
  });

  it('never falls below the residual value', () => {
    expect(bookValue(laptop(), '2031-06-01')).toBe(3000);
  });

  it('written down value shrinks by the rate on the remaining value', () => {
    const value = bookValue(laptop({ rate: 50, method: 'written_down' }), '2026-06-01');
    expect(value).toBeGreaterThan(14900);
    expect(value).toBeLessThan(15100);
  });

  it('keeps the cost when there is no purchase date or rate, and null without a cost', () => {
    expect(bookValue(laptop({ purchase_date: null }), '2026-06-01')).toBe(60000);
    expect(bookValue(laptop({ useful_life_years: null }), '2026-06-01')).toBe(60000);
    expect(bookValue(laptop({ cost: null }), '2026-06-01')).toBeNull();
  });

  it('does not appreciate before the purchase date', () => {
    expect(bookValue(laptop(), '2024-01-01')).toBe(60000);
  });

  it('reports the depreciation charged between two dates', () => {
    const charge = depreciationForYear(laptop(), '2024-06-01', '2025-06-01');
    expect(charge).toBeGreaterThan(19900);
    expect(charge).toBeLessThan(20100);
    expect(depreciationForYear(laptop({ cost: null }), '2024-06-01', '2025-06-01')).toBe(0);
  });
});

describe('inventory asset rules', () => {
  it('allocates only assets in store', () => {
    expect(allocationRefusal('in_store')).toBeNull();
    expect(allocationRefusal('allocated')?.code).toBe('ASSET_ALLOCATED');
    expect(allocationRefusal('in_maintenance')?.code).toBe('ASSET_IN_MAINTENANCE');
    expect(allocationRefusal('lost')?.code).toBe('ASSET_LOST');
    expect(allocationRefusal('disposed')?.code).toBe('ASSET_DISPOSED');
  });

  it('transfers and repairs anything still on the register', () => {
    expect(transferRefusal('allocated')).toBeNull();
    expect(transferRefusal('lost')?.code).toBe('ASSET_LOST');
    expect(maintenanceRefusal('in_store')).toBeNull();
    expect(maintenanceRefusal('disposed')?.code).toBe('ASSET_DISPOSED');
  });

  it('disposes only assets that are back with the school', () => {
    expect(disposalRefusal('in_store')).toBeNull();
    expect(disposalRefusal('lost')).toBeNull();
    expect(disposalRefusal('allocated')?.code).toBe('ASSET_ALLOCATED');
    expect(disposalRefusal('disposed')?.code).toBe('ASSET_DISPOSED');
  });
});

describe('inventory stock valuation', () => {
  it('averages the cost across receipts', () => {
    const first = receive({ quantity: 0, value: 0 }, 10, 100);
    const second = receive(first, 10, 120);
    expect(second).toEqual({ quantity: 20, value: 2200 });
    expect(averageRate(second)).toBe(110);
  });

  it('issues at the average rate and keeps the rest of the value', () => {
    const out = withdraw({ quantity: 20, value: 2200 }, 5);
    expect(out.rate).toBe(110);
    expect(out.value).toBe(550);
    expect(out.position).toEqual({ quantity: 15, value: 1650 });
  });

  it('clears the value when the last unit leaves', () => {
    const out = withdraw({ quantity: 3, value: 100 }, 3);
    expect(out.value).toBe(100);
    expect(out.position).toEqual({ quantity: 0, value: 0 });
  });

  it('refuses empty or excessive quantities', () => {
    expect(stockRefusal(10, 0, 'Chalk')?.code).toBe('INVALID_QUANTITY');
    expect(stockRefusal(10, 11, 'Chalk')?.code).toBe('NOT_ENOUGH_STOCK');
    expect(stockRefusal(10, 10, 'Chalk')).toBeNull();
  });

  it('works out the requisition status from what was issued', () => {
    expect(
      requisitionStatusAfterIssue([
        { approved: 5, issued: 5 },
        { approved: 2, issued: 2 },
      ]),
    ).toBe('issued');
    expect(
      requisitionStatusAfterIssue([
        { approved: 5, issued: 3 },
        { approved: 2, issued: 0 },
      ]),
    ).toBe('partly_issued');
    expect(requisitionStatusAfterIssue([{ approved: 5, issued: 0 }])).toBe('approved');
  });
});

describe('inventory numbering and dates', () => {
  it('formats asset tags and document numbers', () => {
    expect(assetTag('TZMS', 41)).toBe('TZMS-AST-000041');
    expect(documentNumber('TZMS', 'TRF', '2026', 7)).toBe('TZMS-TRF-2026-0007');
  });

  it('builds short codes from names', () => {
    expect(codeFrom('Computer Science')).toBe('CS');
    expect(codeFrom('Mathematics')).toBe('MATHEM');
    expect(codeFrom('!!!', 'DEPT')).toBe('DEPT');
  });

  it('counts days and the next due date', () => {
    expect(daysBetween('2026-11-01', '2026-11-19')).toBe(18);
    expect(nextDueDate('2026-11-01', 90)).toBe('2027-01-30');
    expect(nextDueDate('2026-11-01', 0)).toBe('2026-11-02');
  });
});

describe('inventory import dates', () => {
  it('accepts only real calendar dates', () => {
    expect(isCalendarDate('2026-02-28')).toBe(true);
    expect(isCalendarDate('2028-02-29')).toBe(true);
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(isCalendarDate('2026-31-31')).toBe(false);
    expect(isCalendarDate('31-12-2026')).toBe(false);
  });
});
