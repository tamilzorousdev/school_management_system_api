import { AppException } from '@app/common';
import {
  allocateBenefits,
  applyDiscount,
  BenefitRule,
  fixedShare,
  PlanShare,
  applyPayment,
  feeNumber,
  feeTotals,
  InvoiceAmounts,
  invoiceStatus,
  isOverdue,
  lateFeeAmount,
  monthsBetween,
  previousDueDate,
  replayedPayment,
  reverseAmounts,
  shiftDate,
  studentStatus,
  sumAmounts,
  transportCharge,
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

describe('payment reversal', () => {
  it('takes the payment back off the invoice', () => {
    expect(reverseAmounts(invoice({ paid: 10000, balance: 0, status: 'paid' }), 4000)).toEqual({
      paid: 6000,
      balance: 4000,
      status: 'partly_paid',
    });
    expect(reverseAmounts(invoice({ paid: 4000, balance: 6000, status: 'partly_paid' }), 4000)).toEqual({
      paid: 0,
      balance: 10000,
      status: 'unpaid',
    });
  });

  it('keeps paise exact', () => {
    expect(reverseAmounts(invoice({ total: 0.3, paid: 0.3, balance: 0, status: 'paid' }), 0.1)).toEqual({
      paid: 0.2,
      balance: 0.1,
      status: 'partly_paid',
    });
  });

  it('refuses to take back more than the invoice shows as paid', () => {
    expect(codeOf(() => reverseAmounts(invoice({ paid: 1000, balance: 9000, status: 'partly_paid' }), 1000.01))).toBe(
      'BALANCE_MISMATCH',
    );
  });
});

describe('idempotent payments', () => {
  const earlier = { id: 7, invoice_id: 21, amount: 5000 };

  it('records a new payment when the key is unused', () => {
    expect(replayedPayment(null, 21, 5000)).toBeNull();
  });

  it('returns the earlier payment for the same invoice and amount', () => {
    expect(replayedPayment(earlier, 21, 5000)).toBe(earlier);
    expect(replayedPayment(earlier, 21, 5000.001)).toBe(earlier);
  });

  it('refuses the same key for another invoice or amount', () => {
    expect(codeOf(() => replayedPayment(earlier, 22, 5000))).toBe('IDEMPOTENCY_CONFLICT');
    expect(codeOf(() => replayedPayment(earlier, 21, 4000))).toBe('IDEMPOTENCY_CONFLICT');
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

describe('concessions and scholarships', () => {
  const TUITION = 1;
  const BOOKS = 2;
  const BUS = 9;
  const plan: PlanShare[] = [
    {
      installment: 'Term 1',
      due_date: '2026-06-10',
      lines: [
        { fee_head_id: TUITION, amount: 10000 },
        { fee_head_id: BOOKS, amount: 2000 },
      ],
    },
    { installment: 'Term 2', due_date: '2026-10-10', lines: [{ fee_head_id: TUITION, amount: 10000 }] },
    { installment: 'Term 3', due_date: '2027-01-10', lines: [{ fee_head_id: TUITION, amount: 10000 }] },
  ];
  const term1 = [
    { fee_head_id: TUITION, amount: 10000, is_transport: false },
    { fee_head_id: BOOKS, amount: 2000, is_transport: false },
    { fee_head_id: BUS, amount: 3000, is_transport: true },
  ];
  const rule = (overrides: Partial<BenefitRule>): BenefitRule => ({
    award_id: 1,
    benefit_id: 1,
    kind: 'concession',
    name: 'Sibling',
    calc_type: 'percent',
    value: 10,
    fee_head_ids: [],
    ...overrides,
  });

  it('takes a percentage from every head except transport when no head is chosen', () => {
    const result = allocateBenefits(term1, [rule({})], plan, 'Term 1');
    expect(result.map((row) => [row.fee_head_id, row.amount])).toEqual([
      [TUITION, 1000],
      [BOOKS, 200],
    ]);
  });

  it('takes a percentage only from the chosen heads, transport included when chosen', () => {
    const result = allocateBenefits(term1, [rule({ value: 50, fee_head_ids: [BUS] })], plan, 'Term 1');
    expect(result).toEqual([expect.objectContaining({ fee_head_id: BUS, amount: 1500 })]);
  });

  it('adds percentages on the base amount without compounding', () => {
    const result = allocateBenefits(
      term1,
      [
        rule({ value: 10, fee_head_ids: [TUITION] }),
        rule({ award_id: 2, benefit_id: 2, value: 20, fee_head_ids: [TUITION] }),
      ],
      plan,
      'Term 1',
    );
    expect(sumAmounts(result.map((row) => row.amount))).toBe(3000);
  });

  it('applies concessions before scholarships and never takes a line below zero', () => {
    const result = allocateBenefits(
      term1,
      [
        rule({ award_id: 5, benefit_id: 5, kind: 'scholarship', name: 'Trust', value: 50, fee_head_ids: [TUITION] }),
        rule({ award_id: 6, benefit_id: 6, value: 70, fee_head_ids: [TUITION] }),
      ],
      plan,
      'Term 1',
    );
    expect(result.map((row) => [row.kind, row.amount])).toEqual([
      ['concession', 7000],
      ['scholarship', 3000],
    ]);
  });

  it('spreads a fixed yearly amount over installments by their eligible amounts', () => {
    const fixed = rule({ calc_type: 'fixed', value: 3000, fee_head_ids: [TUITION] });
    expect(fixedShare(fixed, plan, 'Term 1')).toBe(1000);
    expect(fixedShare(fixed, plan, 'Term 2')).toBe(1000);
    expect(fixedShare(fixed, plan, 'Term 3')).toBe(1000);
  });

  it('gives the rounding remainder to the last installment so the year adds up', () => {
    const fixed = rule({ calc_type: 'fixed', value: 1000, fee_head_ids: [TUITION] });
    const shares = ['Term 1', 'Term 2', 'Term 3'].map((name) => fixedShare(fixed, plan, name));
    expect(shares).toEqual([333.33, 333.33, 333.34]);
    expect(sumAmounts(shares)).toBe(1000);
  });

  it('caps a fixed amount at what is left on the invoice', () => {
    const fixed = rule({ calc_type: 'fixed', value: 90000, fee_head_ids: [] });
    const result = allocateBenefits(term1, [fixed], plan, 'Term 1');
    expect(sumAmounts(result.map((row) => row.amount))).toBe(12000);
  });

  it('gives nothing for an installment with no eligible amount in the plan', () => {
    expect(fixedShare(rule({ calc_type: 'fixed', value: 500, fee_head_ids: [BOOKS] }), plan, 'Term 2')).toBe(0);
  });

  it('limits a discount to what is left after concessions', () => {
    expect(() => applyDiscount({ gross: 10000, benefit: 6000, paid: 3000, status: 'partly_paid' }, 1500)).toThrow(
      AppException,
    );
    expect(applyDiscount({ gross: 10000, benefit: 6000, paid: 3000, status: 'partly_paid' }, 1000)).toEqual({
      total: 3000,
      balance: 0,
      status: 'paid',
    });
  });
});

describe('copying plans to another year', () => {
  it('moves a due date by whole years', () => {
    expect(shiftDate('2025-06-10', 1, '2026-06-01', '2027-05-31')).toBe('2026-06-10');
  });

  it('turns 29 February into 28 February in a non-leap year', () => {
    expect(shiftDate('2028-02-29', 1, '2028-06-01', '2029-05-31')).toBe('2029-02-28');
  });

  it('keeps the date inside the target year', () => {
    expect(shiftDate('2025-04-01', 1, '2026-06-01', '2027-05-31')).toBe('2026-06-01');
    expect(shiftDate('2026-05-31', 1, '2026-06-01', '2027-04-30')).toBe('2027-04-30');
  });
});

describe('late fee', () => {
  it('is the flat amount', () => {
    expect(lateFeeAmount({ late_fee_type: 'flat', late_fee_value: 150 }, 9000)).toBe(150);
  });

  it('is a percentage of the unpaid balance, to the paisa', () => {
    expect(lateFeeAmount({ late_fee_type: 'percent', late_fee_value: 2 }, 10963.64)).toBe(219.27);
  });

  it('is nothing when switched off', () => {
    expect(lateFeeAmount({ late_fee_type: 'none', late_fee_value: 100 }, 9000)).toBe(0);
  });
});
