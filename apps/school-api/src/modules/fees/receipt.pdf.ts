import { rupees } from '../payroll/payroll.calc';
import { amountInWords } from '../payroll/payslip.pdf';
import { BRAND, createPdf, displayDate, renderPdf, type Pdf } from '../student-lifecycle/pdf/pdf-kit';

interface ReceiptSchool {
  school_name: string;
  school_address: string | null;
  school_logo: Buffer | null;
  school_signature?: Buffer | null;
  school_seal?: Buffer | null;
}

export interface ReceiptPdfData extends ReceiptSchool {
  receipt_no: string;
  paid_on: string;
  student_name: string;
  admission_no: string;
  class_section: string | null;
  invoice_no: string;
  installment: string;
  due_date: string;
  mode: string;
  reference: string | null;
  received_by: string | null;
  amount: number;
  lines: [string, number][];
  benefit?: number;
  discount: number;
  invoice_total: number;
  paid_to_date: number;
  balance: number;
  reversed?: { on: string | null; reason: string | null } | null;
}

export interface InvoicePdfData extends ReceiptSchool {
  invoice_no: string;
  kind: 'fee' | 'fine';
  issued_on: string;
  student_name: string;
  admission_no: string;
  class_section: string | null;
  academic_year: string | null;
  installment: string;
  due_date: string;
  status: 'unpaid' | 'partly_paid' | 'paid' | 'cancelled';
  lines: [string, number][];
  benefit: number;
  discount: number;
  total: number;
  payments: { receipt_no: string; paid_on: string; mode: string; amount: number }[];
  refunded: number;
  balance: number;
  cancel_reason: string | null;
}

export interface RefundPdfData extends ReceiptSchool {
  refund_no: string;
  paid_on: string;
  student_name: string;
  admission_no: string;
  class_section: string | null;
  invoice_no: string;
  installment: string;
  mode: string;
  reference: string | null;
  reason: string;
  approved_by: string | null;
  invoice_total: number;
  paid: number;
  refunded_before: number;
  amount: number;
}

export interface AdvanceReceiptPdfData extends ReceiptSchool {
  receipt_no: string;
  paid_on: string;
  student_name: string;
  admission_no: string;
  class_section: string | null;
  mode: string;
  reference: string | null;
  received_by: string | null;
  collected: number;
  applied: [string, number][];
  advance: number;
}

const REVERSED_RED = '#b42318';

interface Stamp {
  text: string;
  color: string;
}
const LEFT = 50;
const WIDTH = 495.28;

const MODE_TEXT: Record<string, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  bank_transfer: 'Bank transfer',
  cheque: 'Cheque',
  online: 'Online (Razorpay)',
  credit: 'Advance credit',
};

function drawHeader(doc: Pdf, school: ReceiptSchool, title: string, receiptNo: string, stamp: Stamp | null): number {
  doc.rect(0, 0, 595.28, 8).fill(BRAND.green);
  if (school.school_logo) doc.image(school.school_logo, LEFT, 34, { fit: [50, 50] });
  const headerX = school.school_logo ? LEFT + 62 : LEFT;
  doc
    .fillColor(BRAND.dark)
    .font('Helvetica-Bold')
    .fontSize(17)
    .text(school.school_name, headerX, 38, { width: WIDTH - (headerX - LEFT) });
  if (school.school_address) {
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(BRAND.muted)
      .text(school.school_address, headerX, doc.y + 2, { width: WIDTH - (headerX - LEFT) });
  }

  const titleY = 104;
  doc.rect(LEFT, titleY, WIDTH, 30).fill(BRAND.wash);
  doc
    .fillColor(BRAND.deep)
    .font('Helvetica-Bold')
    .fontSize(12)
    .text(title, LEFT + 12, titleY + 9, { width: WIDTH / 2 });
  doc.text(receiptNo, LEFT + WIDTH / 2, titleY + 9, { width: WIDTH / 2 - 12, align: 'right' });
  if (stamp) {
    doc
      .fillColor(stamp.color)
      .text(stamp.text, LEFT + 110, titleY + 9, { width: WIDTH / 2 - 110 })
      .fillColor(BRAND.deep);
  }
  return titleY + 44;
}

function drawFacts(doc: Pdf, facts: [string, string][], top: number): number {
  let y = top;
  const column = WIDTH / 2;
  facts.forEach(([label, value], index) => {
    const x = LEFT + (index % 2) * column;
    if (index % 2 === 0 && index > 0) y += 20;
    doc.font('Helvetica').fontSize(9).fillColor(BRAND.muted).text(label, x, y, { width: 90 });
    doc
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .fillColor(BRAND.dark)
      .text(value, x + 90, y, { width: column - 100 });
  });
  return y + 34;
}

function startTable(doc: Pdf, top: number, heading: string) {
  doc.rect(LEFT, top, WIDTH, 24).fill(BRAND.green);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff');
  doc.text(heading, LEFT + 10, top + 7, { width: WIDTH - 140 });
  doc.text('Amount', LEFT + WIDTH - 130, top + 7, { width: 120, align: 'right' });
  let rowY = top + 24;
  const row = (label: string, amount: string, shade: boolean, bold = false) => {
    if (shade) doc.rect(LEFT, rowY, WIDTH, 22).fill('#f5f7f6');
    doc
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(9.5)
      .fillColor(BRAND.dark);
    doc.text(label, LEFT + 10, rowY + 6, { width: WIDTH - 150 });
    doc.text(amount, LEFT + WIDTH - 130, rowY + 6, { width: 120, align: 'right' });
    rowY += 22;
  };
  const total = (label: string, amount: string) => {
    doc.rect(LEFT, rowY, WIDTH, 24).fill(BRAND.wash);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(BRAND.deep);
    doc.text(label, LEFT + 10, rowY + 7, { width: WIDTH - 150 });
    doc.text(amount, LEFT + WIDTH - 130, rowY + 7, { width: 120, align: 'right' });
    rowY += 24;
  };
  const close = () => {
    doc
      .rect(LEFT, top, WIDTH, rowY - top)
      .lineWidth(0.6)
      .strokeColor(BRAND.line)
      .stroke();
    return rowY;
  };
  return { row, total, close };
}

function drawAmountAndSignature(
  doc: Pdf,
  school: ReceiptSchool,
  top: number,
  label: string,
  amount: number,
  footer: string,
) {
  const paidY = top + 18;
  doc.rect(LEFT, paidY, WIDTH, 46).fill(BRAND.deep);
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#cfe8da')
    .text(label, LEFT + 14, paidY + 8);
  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .fillColor('#ffffff')
    .text(rupees(amount), LEFT + 14, paidY + 21, { width: 200 });
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#ffffff')
    .text(amountInWords(amount), LEFT + 220, paidY + 17, { width: WIDTH - 234, align: 'right' });

  const authY = paidY + 58;
  if (school.school_seal) {
    try {
      doc.image(school.school_seal, LEFT + 40, authY - 8, { fit: [65, 65] });
    } catch {
      // ignore
    }
  }
  const sigX = LEFT + WIDTH - 150;
  if (school.school_signature) {
    try {
      doc.image(school.school_signature, sigX + 10, authY - 4, { fit: [130, 36], align: 'center' });
    } catch {
      // ignore
    }
  }
  doc
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .fillColor(BRAND.dark)
    .text('Authorized Signatory', sigX, authY + 36, { width: 150, align: 'center' });
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(BRAND.muted)
    .text(footer, LEFT, authY + 54, { width: WIDTH, align: 'center' });
}

const receivedBy = (name: string | null) => (name ? `Received by ${name}. ` : '');

export async function receiptPdf(data: ReceiptPdfData): Promise<Buffer> {
  const doc = createPdf({ size: 'A4', margin: 50, info: { Title: `Fee receipt ${data.receipt_no}` } });
  const factsTop = drawHeader(
    doc,
    data,
    'Fee receipt',
    data.receipt_no,
    data.reversed ? { text: 'REVERSED', color: REVERSED_RED } : null,
  );
  const tableTop = drawFacts(
    doc,
    [
      ['Student', data.student_name],
      ['Receipt date', displayDate(data.paid_on)],
      ['Admission no.', data.admission_no],
      ['Class', data.class_section ?? '—'],
      ['Invoice no.', data.invoice_no],
      ['Installment', `${data.installment} (due ${displayDate(data.due_date)})`],
      ['Paid by', MODE_TEXT[data.mode] ?? data.mode],
      ['Reference', data.reference ?? '—'],
    ],
    factsTop,
  );

  const table = startTable(doc, tableTop, 'Fee');
  data.lines.forEach(([label, amount], index) => table.row(label, rupees(amount), index % 2 === 1));
  const extras: [string, number][] = [
    ['Concessions and scholarships', data.benefit ?? 0],
    ['Discount', data.discount],
  ];
  extras
    .filter(([, value]) => value > 0)
    .forEach(([label, value], index) => table.row(label, `- ${rupees(value)}`, (data.lines.length + index) % 2 === 1));
  table.total('Invoice total', rupees(data.invoice_total));
  table.row('Paid so far, including this receipt', rupees(data.paid_to_date), false);
  table.row('Balance', rupees(data.balance), true, true);
  if (data.reversed) {
    const when = data.reversed.on ? ` on ${displayDate(data.reversed.on)}` : '';
    table.row(`Reversed${when}: ${data.reversed.reason ?? ''}`, `- ${rupees(data.amount)}`, false, true);
  }

  drawAmountAndSignature(
    doc,
    data,
    table.close(),
    'Amount received',
    data.amount,
    `${receivedBy(data.received_by)}This is an official computer-generated fee receipt.`,
  );
  return renderPdf(doc);
}

export async function advanceReceiptPdf(data: AdvanceReceiptPdfData): Promise<Buffer> {
  const doc = createPdf({ size: 'A4', margin: 50, info: { Title: `Advance receipt ${data.receipt_no}` } });
  const factsTop = drawHeader(doc, data, 'Advance fee receipt', data.receipt_no, null);
  const tableTop = drawFacts(
    doc,
    [
      ['Student', data.student_name],
      ['Receipt date', displayDate(data.paid_on)],
      ['Admission no.', data.admission_no],
      ['Class', data.class_section ?? '—'],
      ['Paid by', MODE_TEXT[data.mode] ?? data.mode],
      ['Reference', data.reference ?? '—'],
    ],
    factsTop,
  );

  const table = startTable(doc, tableTop, 'Payment');
  table.row('Amount paid', rupees(data.collected), false);
  data.applied.forEach(([label, amount], index) =>
    table.row(`Paid towards ${label}`, `- ${rupees(amount)}`, index % 2 === 0),
  );
  table.total('Kept as advance', rupees(data.advance));

  drawAmountAndSignature(
    doc,
    data,
    table.close(),
    'Advance received',
    data.advance,
    `${receivedBy(data.received_by)}The advance is used on the next fee invoices. This is an official computer-generated receipt.`,
  );
  return renderPdf(doc);
}

const INVOICE_STAMPS: Record<InvoicePdfData['status'], Stamp | null> = {
  unpaid: null,
  partly_paid: { text: 'PART PAID', color: '#b54708' },
  paid: { text: 'PAID', color: BRAND.green },
  cancelled: { text: 'CANCELLED', color: REVERSED_RED },
};

export async function invoicePdf(data: InvoicePdfData): Promise<Buffer> {
  const title = data.kind === 'fine' ? 'Fine invoice' : 'Fee invoice';
  const doc = createPdf({ size: 'A4', margin: 50, info: { Title: `${title} ${data.invoice_no}` } });
  const factsTop = drawHeader(doc, data, title, data.invoice_no, INVOICE_STAMPS[data.status]);
  const tableTop = drawFacts(
    doc,
    [
      ['Student', data.student_name],
      ['Issued on', displayDate(data.issued_on)],
      ['Admission no.', data.admission_no],
      ['Class', data.class_section ?? '—'],
      ['Installment', data.installment],
      ['Due date', displayDate(data.due_date)],
      ['Academic year', data.academic_year ?? '—'],
    ],
    factsTop,
  );

  const table = startTable(doc, tableTop, data.kind === 'fine' ? 'Fine' : 'Fee');
  data.lines.forEach(([label, amount], index) => table.row(label, rupees(amount), index % 2 === 1));
  let shade = data.lines.length % 2 === 1;
  const next = () => {
    const current = shade;
    shade = !shade;
    return current;
  };
  if (data.benefit > 0) table.row('Concessions and scholarships', `- ${rupees(data.benefit)}`, next());
  if (data.discount > 0) table.row('Discount', `- ${rupees(data.discount)}`, next());
  table.total('Invoice total', rupees(data.total));
  data.payments.forEach((payment) =>
    table.row(
      `Paid on ${displayDate(payment.paid_on)} by ${MODE_TEXT[payment.mode] ?? payment.mode} (receipt ${payment.receipt_no})`,
      `- ${rupees(payment.amount)}`,
      next(),
    ),
  );
  if (data.refunded > 0) table.row('Refunded', rupees(data.refunded), next());
  if (data.status === 'cancelled') {
    table.row(`Cancelled${data.cancel_reason ? `: ${data.cancel_reason}` : ''}`, '', next(), true);
  }

  const due = data.status === 'cancelled' ? 0 : data.balance;
  drawAmountAndSignature(
    doc,
    data,
    table.close(),
    due > 0 ? `Balance due by ${displayDate(data.due_date)}` : 'Balance due',
    due,
    due > 0
      ? 'Please pay at the school office or online in the school app. This is a computer-generated invoice.'
      : 'Nothing is due on this invoice. This is a computer-generated invoice.',
  );
  return renderPdf(doc);
}

export async function refundPdf(data: RefundPdfData): Promise<Buffer> {
  const doc = createPdf({ size: 'A4', margin: 50, info: { Title: `Fee refund ${data.refund_no}` } });
  const factsTop = drawHeader(doc, data, 'Fee refund', data.refund_no, null);
  const tableTop = drawFacts(
    doc,
    [
      ['Student', data.student_name],
      ['Refund date', displayDate(data.paid_on)],
      ['Admission no.', data.admission_no],
      ['Class', data.class_section ?? '—'],
      ['Invoice no.', data.invoice_no],
      ['Installment', data.installment],
      ['Refunded by', MODE_TEXT[data.mode] ?? data.mode],
      ['Reference', data.reference ?? '—'],
    ],
    factsTop,
  );

  const table = startTable(doc, tableTop, 'Invoice');
  table.row('Invoice total', rupees(data.invoice_total), false);
  table.row('Paid on this invoice', rupees(data.paid), true);
  if (data.refunded_before > 0) table.row('Refunded earlier', `- ${rupees(data.refunded_before)}`, false);
  table.total('Refunded now', rupees(data.amount));
  table.row(`Reason: ${data.reason}`, '', false);

  drawAmountAndSignature(
    doc,
    data,
    table.close(),
    'Amount refunded',
    data.amount,
    `${data.approved_by ? `Approved by ${data.approved_by}. ` : ''}This is an official computer-generated refund receipt.`,
  );
  return renderPdf(doc);
}
