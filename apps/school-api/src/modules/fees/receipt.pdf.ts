import { rupees } from '../payroll/payroll.calc';
import { amountInWords } from '../payroll/payslip.pdf';
import { BRAND, createPdf, displayDate, renderPdf } from '../student-lifecycle/pdf/pdf-kit';

export interface ReceiptPdfData {
  school_name: string;
  school_address: string | null;
  school_logo: Buffer | null;
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
  discount: number;
  invoice_total: number;
  paid_to_date: number;
  balance: number;
  school_signature?: Buffer | null;
  school_seal?: Buffer | null;
}

export async function receiptPdf(data: ReceiptPdfData): Promise<Buffer> {
  const doc = createPdf({ size: 'A4', margin: 50, info: { Title: `Fee receipt ${data.receipt_no}` } });
  const left = 50;
  const width = 495.28;

  doc.rect(0, 0, 595.28, 8).fill(BRAND.green);
  if (data.school_logo) doc.image(data.school_logo, left, 34, { fit: [50, 50] });
  const headerX = data.school_logo ? left + 62 : left;
  doc
    .fillColor(BRAND.dark)
    .font('Helvetica-Bold')
    .fontSize(17)
    .text(data.school_name, headerX, 38, { width: width - (headerX - left) });
  if (data.school_address) {
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(BRAND.muted)
      .text(data.school_address, headerX, doc.y + 2, { width: width - (headerX - left) });
  }

  const titleY = 104;
  doc.rect(left, titleY, width, 30).fill(BRAND.wash);
  doc
    .fillColor(BRAND.deep)
    .font('Helvetica-Bold')
    .fontSize(12)
    .text('Fee receipt', left + 12, titleY + 9, { width: width / 2 });
  doc.text(data.receipt_no, left + width / 2, titleY + 9, { width: width / 2 - 12, align: 'right' });

  const facts: [string, string][] = [
    ['Student', data.student_name],
    ['Receipt date', displayDate(data.paid_on)],
    ['Admission no.', data.admission_no],
    ['Class', data.class_section ?? '—'],
    ['Invoice no.', data.invoice_no],
    ['Installment', `${data.installment} (due ${displayDate(data.due_date)})`],
    ['Paid by', MODE_TEXT[data.mode] ?? data.mode],
    ['Reference', data.reference ?? '—'],
  ];
  let y = titleY + 44;
  const column = width / 2;
  facts.forEach(([label, value], index) => {
    const x = left + (index % 2) * column;
    if (index % 2 === 0 && index > 0) y += 20;
    doc.font('Helvetica').fontSize(9).fillColor(BRAND.muted).text(label, x, y, { width: 90 });
    doc
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .fillColor(BRAND.dark)
      .text(value, x + 90, y, { width: column - 100 });
  });
  y += 34;

  const tableTop = y;
  doc.rect(left, tableTop, width, 24).fill(BRAND.green);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff');
  doc.text('Fee', left + 10, tableTop + 7, { width: width - 140 });
  doc.text('Amount', left + width - 130, tableTop + 7, { width: 120, align: 'right' });
  let rowY = tableTop + 24;
  const row = (label: string, amount: string, shade: boolean, bold = false) => {
    if (shade) doc.rect(left, rowY, width, 22).fill('#f5f7f6');
    doc
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(9.5)
      .fillColor(BRAND.dark);
    doc.text(label, left + 10, rowY + 6, { width: width - 150 });
    doc.text(amount, left + width - 130, rowY + 6, { width: 120, align: 'right' });
    rowY += 22;
  };
  data.lines.forEach(([label, amount], index) => row(label, rupees(amount), index % 2 === 1));
  if (data.discount > 0) row('Discount', `- ${rupees(data.discount)}`, data.lines.length % 2 === 1);
  doc.rect(left, rowY, width, 24).fill(BRAND.wash);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(BRAND.deep);
  doc.text('Invoice total', left + 10, rowY + 7, { width: width - 150 });
  doc.text(rupees(data.invoice_total), left + width - 130, rowY + 7, { width: 120, align: 'right' });
  rowY += 24;
  row('Paid so far, including this receipt', rupees(data.paid_to_date), false);
  row('Balance', rupees(data.balance), true, true);
  doc
    .rect(left, tableTop, width, rowY - tableTop)
    .lineWidth(0.6)
    .strokeColor(BRAND.line)
    .stroke();

  const paidY = rowY + 18;
  doc.rect(left, paidY, width, 46).fill(BRAND.deep);
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#cfe8da')
    .text('Amount received', left + 14, paidY + 8);
  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .fillColor('#ffffff')
    .text(rupees(data.amount), left + 14, paidY + 21, { width: 200 });
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#ffffff')
    .text(amountInWords(data.amount), left + 220, paidY + 17, { width: width - 234, align: 'right' });

  const authY = paidY + 58;
  if (data.school_seal) {
    try {
      doc.image(data.school_seal, left + 40, authY - 8, { fit: [65, 65] });
    } catch {
      // ignore
    }
  }
  const sigX = left + width - 150;
  if (data.school_signature) {
    try {
      doc.image(data.school_signature, sigX + 10, authY - 4, { fit: [130, 36], align: 'center' });
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
    .text(
      `${data.received_by ? `Received by ${data.received_by}. ` : ''}This is an official computer-generated fee receipt.`,
      left,
      authY + 54,
      { width, align: 'center' },
    );
  return renderPdf(doc);
}

const MODE_TEXT: Record<string, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  bank_transfer: 'Bank transfer',
  cheque: 'Cheque',
};
