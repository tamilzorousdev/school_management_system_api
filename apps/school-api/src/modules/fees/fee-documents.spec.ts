import { dueIn, PAYMENT_MODE_NAMES } from './fees.logic';
import { invoicePdf, InvoicePdfData, refundPdf } from './receipt.pdf';

const base: InvoicePdfData = {
  school_name: 'Tamilzorous Model School',
  school_address: '123, Anna Nagar, Chennai',
  school_logo: null,
  invoice_no: 'INV-2026-000123',
  kind: 'fee',
  issued_on: '2026-06-01',
  student_name: 'Kavin Narayanan',
  admission_no: 'TZMS-2026-0012',
  class_section: '6 - A',
  academic_year: '2026-27',
  installment: 'Term 1',
  due_date: '2026-06-15',
  status: 'partly_paid',
  lines: [
    ['Tuition fee', 18000],
    ['Bus fee (Anna Nagar · ₹1,200 × 3 months)', 3600],
    ['Late fee (Unpaid 7 days after the due date)', 200],
  ],
  benefit: 1800,
  discount: 500,
  total: 19500,
  payments: [
    { receipt_no: 'RCP-2026-000045', paid_on: '2026-06-10', mode: 'upi', amount: 10000 },
    { receipt_no: 'RCP-2026-000051', paid_on: '2026-06-20', mode: 'online', amount: 4000 },
  ],
  refunded: 0,
  balance: 5500,
  cancel_reason: null,
};

const pageCount = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;

describe('invoicePdf', () => {
  it('renders a one-page fee invoice with payments and the balance', async () => {
    const pdf = await invoicePdf(base);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pageCount(pdf)).toBe(1);
  });

  it('renders paid, cancelled and fine invoices', async () => {
    for (const data of [
      { ...base, status: 'paid' as const, balance: 0 },
      { ...base, status: 'cancelled' as const, cancel_reason: 'Student left the school', payments: [] },
      {
        ...base,
        kind: 'fine' as const,
        installment: 'Fine 1 · Broke a window',
        lines: [['Fine', 500]] as [string, number][],
      },
    ]) {
      const pdf = await invoicePdf(data);
      expect(pageCount(pdf)).toBe(1);
    }
  });
});

describe('payment mode names', () => {
  it('names every mode a parent can be told about', () => {
    expect(PAYMENT_MODE_NAMES.online).toBe('online payment');
    expect(PAYMENT_MODE_NAMES.bank_transfer).toBe('bank transfer');
  });
});

describe('due-soon wording', () => {
  it('says today, tomorrow or in N days', () => {
    expect(dueIn(0).when).toBe('today');
    expect(dueIn(1)).toEqual({ when: 'tomorrow', when_ta: 'நாளை' });
    expect(dueIn(3).when).toBe('in 3 days');
  });
});

describe('refundPdf', () => {
  it('renders a one-page refund receipt', async () => {
    const pdf = await refundPdf({
      school_name: 'Tamilzorous Model School',
      school_address: null,
      school_logo: null,
      refund_no: 'TZMS-RFD-2026-0004',
      paid_on: '2026-11-19',
      student_name: 'Kavin Narayanan',
      admission_no: 'TZMS-2021-0001',
      class_section: '6 - A',
      invoice_no: 'TZMS-FEE-2026-0285',
      installment: 'Term 3',
      mode: 'bank_transfer',
      reference: 'NEFT 4471',
      reason: 'Caution deposit returned',
      approved_by: 'Lakshmi Raman',
      invoice_total: 18200,
      paid: 6000,
      refunded_before: 500,
      amount: 2000,
    });
    expect(pageCount(pdf)).toBe(1);
  });
});
