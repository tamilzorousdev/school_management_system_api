import { AppException } from '@app/common';
import {
  applyDiscount,
  applyPayment,
  feeNumber,
  feeTotals,
  InvoiceAmounts,
  invoiceStatus,
  isOverdue,
  monthsBetween,
  previousDueDate,
  studentStatus,
  sumAmounts,
  transportCharge,
  invoiceAmounts,
  paidShare,
  transportAdjustment,
  transportFeeStatus,
} from './fees.logic';

const TODAY = '2026-11-03';

const invoice = (overrides: Partial<InvoiceAmounts>): InvoiceAmounts => ({
  total: 10000,
  paid: 0,
  balance: 10000,
  due_date: '2026-12-03',
  status: 'unpaid',
  ...overrides,
});

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    return ((error as AppException).getResponse() as { code?: string }).code;
  }
  return undefined;
};

describe('student fee status', () => {
  it('is paid when nothing is left to pay', () => {
    expect(feeTotals([invoice({ paid: 10000, balance: 0, status: 'paid' })], TODAY).status).toBe('paid');
    expect(feeTotals([], TODAY).status).toBe('paid');
  });

  it('is due when a balance is not yet past its due date and nothing is paid', () => {
    expect(feeTotals([invoice({})], TODAY).status).toBe('due');
  });

  it('is partly paid when something is paid and the rest is not overdue', () => {
    expect(feeTotals([invoice({ paid: 4000, balance: 6000, status: 'partly_paid' })], TODAY).status).toBe(
      'partly_paid',
    );
  });

  it('is overdue when any balance is past its due date', () => {
    const totals = feeTotals(
      [
        invoice({ due_date: '2026-10-03', paid: 7000, balance: 3000, status: 'partly_paid' }),
        invoice({ due_date: '2026-12-03' }),
      ],
      TODAY,
    );
    expect(totals.status).toBe('overdue');
    expect(totals.overdue_amount).toBe(3000);
    expect(totals.balance).toBe(13000);
    expect(totals.next_due_date).toBe('2026-12-03');
  });

  it('is not overdue on the due date itself', () => {
    expect(isOverdue(invoice({ due_date: TODAY }), TODAY)).toBe(false);
    expect(isOverdue(invoice({ due_date: '2026-11-02' }), TODAY)).toBe(true);
  });

  it('leaves cancelled invoices out of the totals', () => {
    const totals = feeTotals([invoice({ status: 'cancelled', balance: 0, due_date: '2026-09-01' })], TODAY);
    expect(totals).toMatchObject({ status: 'paid', total: 0, balance: 0, overdue_amount: 0, next_due_date: null });
  });

  it('points next_due_date at the oldest unpaid date when everything is overdue', () => {
    expect(feeTotals([invoice({ due_date: '2026-10-03' })], TODAY).next_due_date).toBe('2026-10-03');
  });

  it('follows the rules from the totals alone', () => {
    expect(studentStatus(0, 0, false)).toBe('paid');
    expect(studentStatus(0, 500, false)).toBe('due');
    expect(studentStatus(100, 500, false)).toBe('partly_paid');
    expect(studentStatus(100, 500, true)).toBe('overdue');
  });
});

describe('invoice status', () => {
  it('moves unpaid → partly paid → paid', () => {
    expect(invoiceStatus(1000, 0)).toBe('unpaid');
    expect(invoiceStatus(1000, 1)).toBe('partly_paid');
    expect(invoiceStatus(1000, 1000)).toBe('paid');
  });
});

describe('transport line', () => {
  it('charges the stop fee for each month since the previous due date', () => {
    expect(transportCharge(1000, '2026-10-03', '2026-06-01')).toEqual({ months: 4, amount: 4000 });
    expect(transportCharge(1200, '2026-12-03', '2026-10-03')).toEqual({ months: 2, amount: 2400 });
  });

  it('charges at least one month', () => {
    expect(monthsBetween('2026-10-03', '2026-10-20')).toBe(1);
    expect(transportCharge(800, '2026-06-15', '2026-06-01')).toEqual({ months: 1, amount: 800 });
  });

  it('counts across a year end', () => {
    expect(monthsBetween('2026-11-01', '2027-02-01')).toBe(3);
  });

  it('starts from the year start for the first installment', () => {
    expect(previousDueDate(['2026-10-03', '2026-12-03'], '2026-10-03', '2026-06-01')).toBe('2026-06-01');
    expect(previousDueDate(['2026-12-03', '2026-10-03', '2027-02-03'], '2027-02-03', '2026-06-01')).toBe('2026-12-03');
  });
});

describe('payments', () => {
  it('updates paid, balance and status', () => {
    expect(applyPayment(invoice({}), 4000)).toEqual({ paid: 4000, balance: 6000, status: 'partly_paid' });
    expect(applyPayment(invoice({ paid: 4000, balance: 6000, status: 'partly_paid' }), 6000)).toEqual({
      paid: 10000,
      balance: 0,
      status: 'paid',
    });
  });

  it('refuses more than the balance', () => {
    expect(codeOf(() => applyPayment(invoice({ paid: 4000, balance: 6000 }), 6000.01))).toBe('PAYMENT_EXCEEDS_BALANCE');
  });

  it('refuses a paid or cancelled invoice and a zero amount', () => {
    expect(codeOf(() => applyPayment(invoice({ paid: 10000, balance: 0, status: 'paid' }), 1))).toBe('INVOICE_PAID');
    expect(codeOf(() => applyPayment(invoice({ status: 'cancelled' }), 1))).toBe('INVOICE_CANCELLED');
    expect(codeOf(() => applyPayment(invoice({}), 0))).toBe('VALIDATION_FAILED');
  });

  it('keeps paise exact', () => {
    expect(applyPayment(invoice({ total: 0.3, balance: 0.3 }), 0.1)).toEqual({
      paid: 0.1,
      balance: 0.2,
      status: 'partly_paid',
    });
  });
});

describe('discount', () => {
  it('lowers the total and balance', () => {
    expect(applyDiscount({ gross: 10000, paid: 2000, status: 'partly_paid' }, 1500)).toEqual({
      total: 8500,
      balance: 6500,
      status: 'partly_paid',
    });
  });

  it('can settle the invoice but never go below what is paid', () => {
    expect(applyDiscount({ gross: 10000, paid: 2000, status: 'partly_paid' }, 8000).status).toBe('paid');
    expect(codeOf(() => applyDiscount({ gross: 10000, paid: 2000, status: 'partly_paid' }, 8000.5))).toBe(
      'DISCOUNT_TOO_HIGH',
    );
  });
});

describe('numbering and totals', () => {
  it('formats invoice and receipt numbers per school and year', () => {
    expect(feeNumber('TZMS', 'FEE', '2026', 1)).toBe('TZMS-FEE-2026-0001');
    expect(feeNumber('TZMS', 'RCP', 2026, 123)).toBe('TZMS-RCP-2026-0123');
  });

  it('adds amounts without float drift', () => {
    expect(sumAmounts([0.1, 0.2])).toBe(0.3);
    expect(sumAmounts([12500, 1500, 4000])).toBe(18000);
    expect(sumAmounts([])).toBe(0);
  });
});

describe('bus fee changes on invoices', () => {
  it('recalculates an invoice after its bus line changes', () => {
    expect(invoiceAmounts([5000, 3600], 600, 0)).toEqual({ gross: 8600, total: 8000, balance: 8000, status: 'unpaid' });
    expect(invoiceAmounts([5000, 3600], 0, 8600)).toMatchObject({ balance: 0, status: 'paid' });
  });

  it('charges the difference on the next invoice when the paid one is out of date', () => {
    expect(transportAdjustment(4200, 3600, 0)).toBe(600);
    expect(transportAdjustment(3000, 3600, 0)).toBe(-600);
    expect(transportAdjustment(0, 3600, 0)).toBe(-3600);
  });

  it('counts adjustments already raised for that invoice', () => {
    expect(transportAdjustment(4200, 3600, 600)).toBe(0);
    expect(transportAdjustment(3000, 3600, 600)).toBe(-1200);
  });

  it('splits a payment across lines by amount', () => {
    expect(paidShare(3600, 4300, 8600)).toBe(1800);
    expect(paidShare(3600, 0, 8600)).toBe(0);
    expect(paidShare(3600, 100, 0)).toBe(0);
  });

  it('gives the bus fee status', () => {
    expect(transportFeeStatus(0, 0, 0)).toBe('not_billed');
    expect(transportFeeStatus(3600, 0, 0)).toBe('paid');
    expect(transportFeeStatus(3600, 1200, 0)).toBe('pending');
    expect(transportFeeStatus(3600, 1200, 1200)).toBe('overdue');
  });
});
