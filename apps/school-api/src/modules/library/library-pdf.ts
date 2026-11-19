import { toBuffer } from 'bwip-js';
import { rupees } from '../payroll/payroll.calc';
import { BRAND, createPdf, displayDate, renderPdf } from '../student-lifecycle/pdf/pdf-kit';

export interface LabelData {
  accession_no: string;
  barcode: string;
  title: string;
  location: string | null;
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const COLUMNS = 3;
const ROWS = 8;
const MARGIN_X = 18;
const MARGIN_Y = 22;
const GAP = 6;

export function barcodePng(text: string): Promise<Buffer> {
  return toBuffer({ bcid: 'code128', text, scale: 3, height: 10, includetext: false, paddingwidth: 2 });
}

export async function labelsPdf(schoolName: string, labels: LabelData[]): Promise<Buffer> {
  const doc = createPdf({ size: 'A4', margin: 0, info: { Title: 'Library barcode labels' } });
  const width = (PAGE_WIDTH - MARGIN_X * 2 - GAP * (COLUMNS - 1)) / COLUMNS;
  const height = (PAGE_HEIGHT - MARGIN_Y * 2 - GAP * (ROWS - 1)) / ROWS;
  for (const [index, label] of labels.entries()) {
    const slot = index % (COLUMNS * ROWS);
    if (index > 0 && slot === 0) doc.addPage({ size: 'A4', margin: 0 });
    const x = MARGIN_X + (slot % COLUMNS) * (width + GAP);
    const y = MARGIN_Y + Math.floor(slot / COLUMNS) * (height + GAP);
    doc.roundedRect(x, y, width, height, 4).lineWidth(0.5).strokeColor(BRAND.line).stroke();
    doc
      .font('Helvetica-Bold')
      .fontSize(6.5)
      .fillColor(BRAND.deep)
      .text(schoolName.toUpperCase(), x + 6, y + 5, { width: width - 12, height: 8, ellipsis: true, lineBreak: false });
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(BRAND.dark)
      .text(label.title, x + 6, y + 15, { width: width - 12, height: 18, ellipsis: true });
    doc.image(await barcodePng(label.barcode), x + 8, y + 36, { fit: [width - 16, height - 58], align: 'center' });
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(BRAND.dark)
      .text(label.barcode, x + 6, y + height - 19, { width: width - 12, align: 'center', lineBreak: false });
    if (label.location || label.barcode !== label.accession_no) {
      const footer = [label.barcode !== label.accession_no ? label.accession_no : null, label.location]
        .filter(Boolean)
        .join(' · ');
      doc
        .font('Helvetica')
        .fontSize(6)
        .fillColor(BRAND.muted)
        .text(footer, x + 6, y + height - 9, { width: width - 12, align: 'center', lineBreak: false });
    }
  }
  return renderPdf(doc);
}

export interface FineReceiptData {
  school_name: string;
  school_address: string | null;
  receipt_no: string;
  paid_on: string;
  member_name: string;
  member_detail: string | null;
  card_no: string;
  reason: string;
  fine_amount: number;
  waived: number;
  paid_before: number;
  amount: number;
  balance: number;
  mode: string;
  reference: string | null;
  received_by: string | null;
}

export async function fineReceiptPdf(data: FineReceiptData): Promise<Buffer> {
  const doc = createPdf({ size: 'A5', margin: 36, info: { Title: `Library fine receipt ${data.receipt_no}` } });
  const left = 36;
  const width = 419.53 - 72;
  doc.rect(0, 0, 419.53, 6).fill(BRAND.green);
  doc.fillColor(BRAND.dark).font('Helvetica-Bold').fontSize(14).text(data.school_name, left, 26, { width });
  if (data.school_address) {
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(BRAND.muted)
      .text(data.school_address, left, doc.y + 2, { width });
  }
  const titleY = doc.y + 12;
  doc.rect(left, titleY, width, 24).fill(BRAND.wash);
  doc
    .fillColor(BRAND.deep)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text('Library fine receipt', left + 10, titleY + 7, { width: width / 2 });
  doc.text(data.receipt_no, left + width / 2, titleY + 7, { width: width / 2 - 10, align: 'right' });

  const facts: [string, string][] = [
    ['Date', displayDate(data.paid_on)],
    ['Member', data.member_name],
    ['Class / role', data.member_detail ?? '-'],
    ['Library card', data.card_no],
    ['For', data.reason],
    ['Mode', `${data.mode.replace('_', ' ').toUpperCase()}${data.reference ? ` · ${data.reference}` : ''}`],
  ];
  let y = titleY + 38;
  for (const [label, value] of facts) {
    doc.font('Helvetica').fontSize(9).fillColor(BRAND.muted).text(label, left, y, { width: 100 });
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(BRAND.dark)
      .text(value, left + 100, y, { width: width - 100 });
    y = Math.max(doc.y, y + 14) + 2;
  }

  y += 8;
  const money: [string, number][] = [
    ['Fine', data.fine_amount],
    ['Waived', data.waived],
    ['Paid earlier', data.paid_before],
    ['Paid now', data.amount],
    ['Balance', data.balance],
  ];
  doc
    .moveTo(left, y)
    .lineTo(left + width, y)
    .lineWidth(0.5)
    .strokeColor(BRAND.line)
    .stroke();
  y += 6;
  for (const [label, value] of money) {
    const strong = label === 'Paid now';
    doc
      .font(strong ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(strong ? 11 : 9)
      .fillColor(BRAND.dark)
      .text(label, left, y, { width: width / 2 });
    doc.text(rupees(value), left + width / 2, y, { width: width / 2, align: 'right' });
    y += strong ? 18 : 14;
  }
  doc
    .moveTo(left, y)
    .lineTo(left + width, y)
    .lineWidth(0.5)
    .strokeColor(BRAND.line)
    .stroke();
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(BRAND.muted)
    .text(`Received by ${data.received_by ?? 'the library'}. This is a computer-generated receipt.`, left, y + 14, {
      width,
    });
  return renderPdf(doc);
}
