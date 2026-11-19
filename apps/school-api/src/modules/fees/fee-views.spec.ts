import type { StudentFeesDto } from './dto/fees.dto';
import { feesForParent, feesForTeacher } from './fee-views';

const payment = {
  id: 7,
  receipt_no: 'TZMS-RCP-2026-0007',
  amount: 5000,
  mode: 'cheque',
  reference: 'CHQ 004512',
  notes: 'Father will pay the rest next week',
  received_by: 'Divya Shankar',
  reversed_by: 'Revathi',
  reversal_reason: 'Cheque bounced',
  status: 'reversed',
};

const fees = {
  status: 'overdue',
  balance: 10000,
  total: 15000,
  paid: 5000,
  credit_balance: 0,
  advances: [],
  invoices: [
    {
      id: 1,
      installment: 'Term 1',
      total: 15000,
      benefit: 2000,
      discount: 1000,
      discount_reason: 'Written off: family cannot pay',
      cancel_reason: null,
      benefits: [{ benefit_id: 3, kind: 'concession', name: 'Staff ward', fee_head_id: 1, amount: 2000 }],
      refunds: [{ id: 1, refund_no: 'R1', amount: 500, reason: 'Excess paid' }],
      pending_requests: [{ id: 9, kind: 'discount', reason: 'Hardship', requested_by: { id: 4, name: 'Divya' } }],
      payments: [payment],
    },
  ],
  payments: [payment],
} as unknown as StudentFeesDto;

describe('fee views', () => {
  it('teachers see amounts and statuses but no reasons, names or references', () => {
    const view = feesForTeacher(fees);
    const [invoice] = view.invoices;
    expect(view.balance).toBe(10000);
    expect(invoice.total).toBe(15000);
    expect(invoice.benefit).toBe(2000);
    expect(invoice.discount).toBe(1000);
    expect(invoice.discount_reason).toBeNull();
    expect(invoice.benefits).toEqual([]);
    expect(invoice.refunds).toEqual([]);
    expect(invoice.pending_requests).toEqual([]);
    for (const row of [invoice.payments[0], view.payments[0]]) {
      expect(row).toMatchObject({
        amount: 5000,
        mode: 'cheque',
        status: 'reversed',
        reference: null,
        notes: null,
        received_by: null,
        reversed_by: null,
        reversal_reason: null,
      });
    }
  });

  it('parents keep their own reasons and references but not internal notes or waiting requests', () => {
    const view = feesForParent(fees);
    const [invoice] = view.invoices;
    expect(invoice.discount_reason).toBe('Written off: family cannot pay');
    expect(invoice.benefits).toHaveLength(1);
    expect(invoice.refunds).toHaveLength(1);
    expect(invoice.pending_requests).toEqual([]);
    expect(view.payments[0]).toMatchObject({ reference: 'CHQ 004512', reversal_reason: 'Cheque bounced', notes: null });
    expect(invoice.payments[0].notes).toBeNull();
  });

  it('does not change the admin summary it was given', () => {
    feesForTeacher(fees);
    feesForParent(fees);
    expect(fees.payments[0].notes).toBe('Father will pay the rest next week');
    expect(fees.invoices[0].pending_requests).toHaveLength(1);
  });
});
