import { rupees } from '../payroll/payroll.calc';
import { amountInWords } from '../payroll/payslip.pdf';
import { BRAND, createPdf, displayDate, renderPdf } from '../student-lifecycle/pdf/pdf-kit';
import { AccountKind } from './entities/account-category.entity';
import { EntryStatus } from './entities/account-entry.entity';

export interface VoucherPdfData {
  school_name: string;
  school_address: string | null;
  school_logo: Buffer | null;
  school_signature: Buffer | null;
  school_seal: Buffer | null;
  kind: AccountKind;
  entry_no: string;
  entry_date: string;
  category: string;
  amount: number;
  payment_mode: string;
  party: string | null;
  reference: string | null;
  note: string | null;
  status: EntryStatus;
  added_by: string | null;
  decided_by: string | null;
  decision_note: string | null;
}

const LEFT = 50;
const WIDTH = 495.28;

const MODE_TEXT: Record<string, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  bank_transfer: 'Bank transfer',
  cheque: 'Cheque',
};

const STAMPS: Partial<Record<EntryStatus, { text: string; color: string }>> = {
  pending: { text: 'AWAITING APPROVAL', color: '#b54708' },
  rejected: { text: 'REJECTED', color: '#b42318' },
  void: { text: 'VOID', color: '#b42318' },
};

export async function voucherPdf(data: VoucherPdfData): Promise<Buffer> {
  const title = data.kind === 'expense' ? 'Payment voucher' : 'Income receipt';
  const doc = createPdf({ size: 'A4', margin: 50, info: { Title: `${title} ${data.entry_no}` } });
  doc.rect(0, 0, 595.28, 8).fill(BRAND.green);
  if (data.school_logo) doc.image(data.school_logo, LEFT, 34, { fit: [50, 50] });
  const headerX = data.school_logo ? LEFT + 62 : LEFT;
  doc
    .fillColor(BRAND.dark)
    .font('Helvetica-Bold')
    .fontSize(17)
    .text(data.school_name, headerX, 38, { width: WIDTH - (headerX - LEFT) });
  if (data.school_address) {
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(BRAND.muted)
      .text(data.school_address, headerX, doc.y + 2, { width: WIDTH - (headerX - LEFT) });
  }

  const titleY = 104;
  doc.rect(LEFT, titleY, WIDTH, 30).fill(BRAND.wash);
  doc
    .fillColor(BRAND.deep)
    .font('Helvetica-Bold')
    .fontSize(12)
    .text(title, LEFT + 12, titleY + 9, { width: 150 });
  doc.text(data.entry_no, LEFT + WIDTH / 2, titleY + 9, { width: WIDTH / 2 - 12, align: 'right' });
  const stamp = STAMPS[data.status];
  if (stamp) {
    doc
      .fillColor(stamp.color)
      .text(stamp.text, LEFT + 150, titleY + 9, { width: 180 })
      .fillColor(BRAND.deep);
  }

  const facts: [string, string][] = [
    ['Date', displayDate(data.entry_date)],
    ['Category', data.category],
    [data.kind === 'expense' ? 'Paid to' : 'Received from', data.party ?? '—'],
    [data.kind === 'expense' ? 'Paid by' : 'Received by', MODE_TEXT[data.payment_mode] ?? data.payment_mode],
    ['Reference', data.reference ?? '—'],
    ['Entered by', data.added_by ?? '—'],
  ];
  if (data.status === 'approved' && data.decided_by) facts.push(['Approved by', data.decided_by]);
  if ((data.status === 'rejected' || data.status === 'void') && data.decided_by) {
    facts.push([data.status === 'void' ? 'Voided by' : 'Rejected by', data.decided_by]);
  }
  let y = titleY + 46;
  const column = WIDTH / 2;
  facts.forEach(([label, value], index) => {
    const x = LEFT + (index % 2) * column;
    if (index % 2 === 0 && index > 0) y += 22;
    doc.font('Helvetica').fontSize(9).fillColor(BRAND.muted).text(label, x, y, { width: 90 });
    doc
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .fillColor(BRAND.dark)
      .text(value, x + 90, y, { width: column - 100 });
  });
  y += 34;

  const notes = [
    data.note ? `Note: ${data.note}` : null,
    data.decision_note ? `${data.status === 'void' ? 'Void reason' : 'Approver note'}: ${data.decision_note}` : null,
  ].filter((line): line is string => line !== null);
  for (const line of notes) {
    doc.font('Helvetica').fontSize(9.5).fillColor(BRAND.dark).text(line, LEFT, y, { width: WIDTH });
    y = doc.y + 8;
  }

  const amountY = y + 10;
  doc.rect(LEFT, amountY, WIDTH, 46).fill(BRAND.deep);
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#cfe8da')
    .text(data.kind === 'expense' ? 'Amount paid' : 'Amount received', LEFT + 14, amountY + 8);
  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .fillColor('#ffffff')
    .text(rupees(data.amount), LEFT + 14, amountY + 21, { width: 200 });
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#ffffff')
    .text(amountInWords(data.amount), LEFT + 220, amountY + 17, { width: WIDTH - 234, align: 'right' });

  const signY = amountY + 110;
  const third = WIDTH / 3;
  const labels = [
    data.kind === 'expense' ? 'Receiver’s signature' : 'Payer’s signature',
    'Accountant',
    'Authorised signatory',
  ];
  if (data.school_seal) {
    try {
      doc.image(data.school_seal, LEFT + third + 40, signY - 70, { fit: [60, 60] });
    } catch {
      doc.fillColor(BRAND.dark);
    }
  }
  if (data.school_signature) {
    try {
      doc.image(data.school_signature, LEFT + 2 * third + 15, signY - 40, { fit: [130, 36], align: 'center' });
    } catch {
      doc.fillColor(BRAND.dark);
    }
  }
  labels.forEach((label, index) => {
    const x = LEFT + index * third;
    doc
      .moveTo(x + 15, signY)
      .lineTo(x + third - 15, signY)
      .lineWidth(0.6)
      .strokeColor(BRAND.line)
      .stroke();
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(BRAND.muted)
      .text(label, x, signY + 5, { width: third, align: 'center' });
  });
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(BRAND.muted)
    .text('This is a computer-generated document.', LEFT, signY + 40, { width: WIDTH, align: 'center' });
  return renderPdf(doc);
}
