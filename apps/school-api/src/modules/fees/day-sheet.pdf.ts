import { rupees } from '../payroll/payroll.calc';
import { BRAND, createPdf, displayDate, renderPdf, type Pdf } from '../student-lifecycle/pdf/pdf-kit';
import { CASHBOOK_MODE_LABELS, CASHBOOK_MODES, CashTotals } from './cashbook.logic';

export const DAY_SHEET_SECTIONS = ['fees', 'advance', 'library', 'refund'] as const;
export type DaySheetSection = (typeof DAY_SHEET_SECTIONS)[number];

const SECTION_TITLES: Record<DaySheetSection, string> = {
  fees: 'Fee receipts',
  advance: 'Advance receipts',
  library: 'Library fine receipts',
  refund: 'Refunds paid out',
};

export interface DaySheetLine {
  receipt_no: string;
  name: string;
  detail: string | null;
  mode: string;
  reference: string | null;
  amount: number;
  collector: string | null;
}

export interface DaySheetPdfData {
  school_name: string;
  school_address: string | null;
  school_logo: Buffer | null;
  date: string;
  collector: string | null;
  sections: { section: DaySheetSection; lines: DaySheetLine[] }[];
  totals: CashTotals;
}

const LEFT = 40;
const WIDTH = 515.28;
const BOTTOM = 790;

interface Column {
  label: string;
  width: number;
  align?: 'right';
  value: (line: DaySheetLine) => string;
}

const modeText = (mode: string) => CASHBOOK_MODE_LABELS[mode as keyof typeof CASHBOOK_MODE_LABELS] ?? mode;

function columns(showCollector: boolean): Column[] {
  const list: Column[] = [
    { label: 'Receipt no.', width: 98, value: (line) => line.receipt_no ?? '' },
    { label: 'Name', width: 100, value: (line) => line.name ?? '' },
    { label: 'Details', width: showCollector ? 105 : 167, value: (line) => line.detail ?? '' },
    {
      label: 'Mode',
      width: 72,
      value: (line) => [modeText(line.mode), line.reference].filter(Boolean).join('\n'),
    },
  ];
  if (showCollector) list.push({ label: 'By', width: 62, value: (line) => line.collector ?? 'Online' });
  list.push({ label: 'Amount', width: 0, align: 'right', value: (line) => rupees(Number(line.amount)) });
  const used = list.reduce((sum, column) => sum + column.width, 0);
  list[list.length - 1].width = WIDTH - used;
  return list;
}

function header(doc: Pdf, data: DaySheetPdfData): number {
  doc.rect(0, 0, 595.28, 8).fill(BRAND.green);
  if (data.school_logo) doc.image(data.school_logo, LEFT, 26, { fit: [40, 40] });
  const x = data.school_logo ? LEFT + 52 : LEFT;
  doc
    .fillColor(BRAND.dark)
    .font('Helvetica-Bold')
    .fontSize(15)
    .text(data.school_name, x, 28, { width: WIDTH - (x - LEFT) });
  if (data.school_address) {
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(BRAND.muted)
      .text(data.school_address, x, doc.y + 1, { width: WIDTH - (x - LEFT) });
  }
  const top = 80;
  doc.rect(LEFT, top, WIDTH, 28).fill(BRAND.wash);
  doc
    .fillColor(BRAND.deep)
    .font('Helvetica-Bold')
    .fontSize(12)
    .text('Day-end collection sheet', LEFT + 10, top + 8, { width: WIDTH / 2 });
  doc
    .font('Helvetica')
    .fontSize(10)
    .text(
      `${displayDate(data.date)} · ${data.collector ? `Collected by ${data.collector}` : 'All staff'}`,
      LEFT + WIDTH / 2,
      top + 9,
      { width: WIDTH / 2 - 10, align: 'right' },
    );
  return top + 40;
}

function ensureRoom(doc: Pdf, y: number, needed: number): number {
  if (y + needed <= BOTTOM) return y;
  doc.addPage();
  return 40;
}

function drawSection(doc: Pdf, title: string, lines: DaySheetLine[], cols: Column[], top: number): number {
  let y = ensureRoom(doc, top, 60);
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(BRAND.deep).text(title, LEFT, y);
  y += 16;
  const head = (at: number) => {
    doc.rect(LEFT, at, WIDTH, 18).fill(BRAND.green);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff');
    let x = LEFT;
    for (const column of cols) {
      doc.text(column.label, x + 5, at + 5, { width: column.width - 10, align: column.align ?? 'left' });
      x += column.width;
    }
    return at + 18;
  };
  y = head(y);
  if (!lines.length) {
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(BRAND.muted)
      .text('None', LEFT + 5, y + 5);
    return y + 26;
  }
  let total = 0;
  lines.forEach((line, index) => {
    doc.font('Helvetica').fontSize(8.5);
    const height =
      Math.max(...cols.map((column) => doc.heightOfString(column.value(line), { width: column.width - 10 }))) + 8;
    if (y + height > BOTTOM) {
      doc.addPage();
      y = head(40);
    }
    if (index % 2 === 1) doc.rect(LEFT, y, WIDTH, height).fill('#f5f7f6');
    doc.font('Helvetica').fontSize(8.5).fillColor(BRAND.dark);
    let x = LEFT;
    for (const column of cols) {
      doc.text(column.value(line), x + 5, y + 4, { width: column.width - 10, align: column.align ?? 'left' });
      x += column.width;
    }
    y += height;
    total += Number(line.amount);
  });
  y = ensureRoom(doc, y, 20);
  doc.rect(LEFT, y, WIDTH, 20).fill(BRAND.wash);
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(BRAND.deep)
    .text(`${lines.length} ${lines.length === 1 ? 'entry' : 'entries'}`, LEFT + 5, y + 6)
    .text(rupees(Math.round(total * 100) / 100), LEFT + 5, y + 6, { width: WIDTH - 10, align: 'right' });
  return y + 32;
}

function drawSummary(doc: Pdf, totals: CashTotals, top: number): number {
  const modes = CASHBOOK_MODES.filter((mode) => totals.by_mode[mode] > 0 || totals.refunds_by_mode[mode] > 0);
  let y = ensureRoom(doc, top, 60 + modes.length * 18 + 70);
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(BRAND.deep).text('Summary by payment mode', LEFT, y);
  y += 16;
  const widths = [WIDTH - 360, 120, 120, 120];
  const row = (cells: string[], bold: boolean, fill: string | null) => {
    if (fill) doc.rect(LEFT, y, WIDTH, 18).fill(fill);
    doc
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(9)
      .fillColor(fill === BRAND.green ? '#ffffff' : BRAND.dark);
    let x = LEFT;
    cells.forEach((cell, index) => {
      doc.text(cell, x + 5, y + 5, { width: widths[index] - 10, align: index === 0 ? 'left' : 'right' });
      x += widths[index];
    });
    y += 18;
  };
  row(['Mode', 'Received', 'Refunded', 'Net'], true, BRAND.green);
  modes.forEach((mode, index) => {
    const received = totals.by_mode[mode];
    const refunded = totals.refunds_by_mode[mode];
    row(
      [
        CASHBOOK_MODE_LABELS[mode],
        rupees(received),
        rupees(refunded),
        rupees(Math.round((received - refunded) * 100) / 100),
      ],
      false,
      index % 2 === 1 ? '#f5f7f6' : null,
    );
  });
  const received = Math.round((totals.fees + totals.advance + totals.library_fines) * 100) / 100;
  row(['Total', rupees(received), rupees(totals.refunds), rupees(totals.net)], true, BRAND.wash);
  y += 10;
  doc.rect(LEFT, y, WIDTH, 40).fill(BRAND.deep);
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#cfe8da')
    .text('Cash in hand to deposit', LEFT + 12, y + 7);
  doc
    .font('Helvetica-Bold')
    .fontSize(15)
    .fillColor('#ffffff')
    .text(rupees(totals.cash_in_hand), LEFT + 12, y + 19, { width: 200 });
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#ffffff')
    .text(
      `Fees ${rupees(totals.fees)} · Advance ${rupees(totals.advance)} · Library fines ${rupees(totals.library_fines)}`,
      LEFT + 220,
      y + 15,
      { width: WIDTH - 232, align: 'right' },
    );
  return y + 52;
}

function drawSignatures(doc: Pdf, top: number, collector: string | null) {
  const y = ensureRoom(doc, top + 30, 50);
  const width = WIDTH / 3;
  const labels = [collector ? `Prepared by ${collector}` : 'Prepared by', 'Checked by', 'Principal'];
  labels.forEach((label, index) => {
    const x = LEFT + index * width;
    doc
      .moveTo(x + 15, y)
      .lineTo(x + width - 15, y)
      .lineWidth(0.6)
      .strokeColor(BRAND.line)
      .stroke();
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(BRAND.muted)
      .text(label, x, y + 5, { width, align: 'center' });
  });
}

export async function daySheetPdf(data: DaySheetPdfData): Promise<Buffer> {
  const doc = createPdf({ size: 'A4', margin: 40, info: { Title: `Day-end collection sheet ${data.date}` } });
  let y = header(doc, data);
  const cols = columns(!data.collector);
  for (const { section, lines } of data.sections) {
    if (!lines.length && (section === 'advance' || section === 'library' || section === 'refund')) continue;
    y = drawSection(doc, SECTION_TITLES[section], lines, cols, y);
  }
  y = drawSummary(doc, data.totals, y + 4);
  drawSignatures(doc, y, data.collector);
  return renderPdf(doc);
}
