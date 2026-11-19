import { AppException } from '@app/common';
import { cashTotals, flatTotals, groupMovements, Movement } from '../fees/cashbook.logic';
import { daySheetPdf } from '../fees/day-sheet.pdf';
import {
  assertDecidable,
  assertDeletable,
  assertEditable,
  DEFAULT_CATEGORIES,
  initialStatus,
  monthLabel,
  monthsBetween,
} from './accounts.logic';
import { voucherPdf } from './voucher.pdf';

const approver = { id: 1, can_approve: true };
const clerk = { id: 2, can_approve: false };

function codeOf(work: () => void): string | undefined {
  try {
    work();
  } catch (error) {
    return ((error as AppException).getResponse() as { code?: string }).code;
  }
  return undefined;
}

describe('accounts entry rules', () => {
  it('approves at once for an approver and waits otherwise', () => {
    expect(initialStatus(approver)).toBe('approved');
    expect(initialStatus(clerk)).toBe('pending');
  });

  it('lets the owner or an approver edit a pending entry', () => {
    expect(codeOf(() => assertEditable({ status: 'pending', created_by: 2 }, clerk))).toBeUndefined();
    expect(codeOf(() => assertEditable({ status: 'pending', created_by: 9 }, approver))).toBeUndefined();
    expect(codeOf(() => assertEditable({ status: 'pending', created_by: 9 }, clerk))).toBe('NOT_ENTRY_OWNER');
  });

  it('locks decided entries', () => {
    expect(codeOf(() => assertEditable({ status: 'approved', created_by: 2 }, approver))).toBe('ENTRY_LOCKED');
    expect(codeOf(() => assertDeletable({ status: 'approved', created_by: 2 }, approver))).toBe('ENTRY_LOCKED');
    expect(codeOf(() => assertDeletable({ status: 'rejected', created_by: 2 }, clerk))).toBeUndefined();
  });

  it('decides only from the right status', () => {
    expect(codeOf(() => assertDecidable({ status: 'pending' }, 'approve'))).toBeUndefined();
    expect(codeOf(() => assertDecidable({ status: 'approved' }, 'reject'))).toBe('ENTRY_ALREADY_DECIDED');
    expect(codeOf(() => assertDecidable({ status: 'approved' }, 'void'))).toBeUndefined();
    expect(codeOf(() => assertDecidable({ status: 'pending' }, 'void'))).toBe('ENTRY_NOT_APPROVED');
  });

  it('has an Other category for both kinds', () => {
    expect(DEFAULT_CATEGORIES.expense).toContain('Other');
    expect(DEFAULT_CATEGORIES.income).toContain('Other');
  });
});

describe('report months', () => {
  it('lists every month in the range across a year end', () => {
    expect(monthsBetween('2026-11-15', '2027-02-01')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(monthsBetween('2026-06-01', '2026-06-30')).toEqual(['2026-06']);
  });

  it('labels a month', () => {
    expect(monthLabel('2027-01')).toBe('Jan 2027');
  });
});

const movements: Movement[] = [
  { paid_on: '2026-11-18', collector_id: 7, mode: 'cash', source: 'fees', receipts: 3, amount: 15000 },
  { paid_on: '2026-11-18', collector_id: 7, mode: 'upi', source: 'fees', receipts: 1, amount: 5000 },
  { paid_on: '2026-11-18', collector_id: 7, mode: 'cash', source: 'advance', receipts: 1, amount: 2000 },
  { paid_on: '2026-11-18', collector_id: 9, mode: 'cash', source: 'library', receipts: 2, amount: 40 },
  { paid_on: '2026-11-18', collector_id: 7, mode: 'cash', source: 'refund', receipts: 1, amount: 1500 },
  { paid_on: '2026-11-19', collector_id: null, mode: 'online', source: 'fees', receipts: 1, amount: 8000 },
];

describe('cash totals', () => {
  it('adds receipts by mode and takes refunds out of cash in hand', () => {
    const totals = cashTotals(movements.filter((row) => row.paid_on === '2026-11-18'));
    expect(totals.receipts).toBe(7);
    expect(totals.fees).toBe(20000);
    expect(totals.advance).toBe(2000);
    expect(totals.library_fines).toBe(40);
    expect(totals.refunds).toBe(1500);
    expect(totals.net).toBe(20540);
    expect(totals.by_mode.cash).toBe(17040);
    expect(totals.cash_in_hand).toBe(15540);
  });

  it('groups by day or collector', () => {
    expect([...groupMovements(movements, (row) => row.paid_on).keys()]).toEqual(['2026-11-18', '2026-11-19']);
    const people = groupMovements(movements, (row) => row.collector_id);
    expect(cashTotals(people.get(null)!).by_mode.online).toBe(8000);
    expect(flatTotals(cashTotals(people.get(9)!))).toMatchObject({ library_fines: 40, net: 40, cash_in_hand: 40 });
  });
});

describe('documents', () => {
  const school = { school_name: 'Demo School', school_address: 'Chennai', school_logo: null };

  it('renders a day-end sheet', async () => {
    const pdf = await daySheetPdf({
      ...school,
      date: '2026-11-18',
      collector: null,
      sections: [
        {
          section: 'fees',
          lines: Array.from({ length: 60 }, (_, index) => ({
            receipt_no: `TZ-RCPT-2026-${index}`,
            name: 'Kavin N',
            detail: '6 - A · Term 1',
            mode: 'cash',
            reference: null,
            amount: 500,
            collector: 'Kumar',
          })),
        },
        { section: 'refund', lines: [] },
      ],
      totals: cashTotals(movements),
    });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('renders a voucher', async () => {
    const pdf = await voucherPdf({
      ...school,
      school_signature: null,
      school_seal: null,
      kind: 'expense',
      entry_no: 'TZ-EXP-2026-0001',
      entry_date: '2026-11-18',
      category: 'Electricity',
      amount: 8450,
      payment_mode: 'bank_transfer',
      party: 'TNEB',
      reference: 'BILL-1',
      note: null,
      status: 'void',
      added_by: 'Kumar',
      decided_by: 'Admin',
      decision_note: 'Entered twice',
    });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });
});
