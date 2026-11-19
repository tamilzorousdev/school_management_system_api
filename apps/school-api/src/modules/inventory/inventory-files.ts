import { toBuffer } from 'bwip-js';
import ExcelJS, { CellValue } from 'exceljs';
import { cellText, normalizeDate } from '../student-import/import-sheet';
import { BRAND, createPdf, renderPdf } from '../student-lifecycle/pdf/pdf-kit';
import { ASSET_CONDITIONS, AssetCondition, FUNDING_SOURCES, FundingSource } from './entities/asset.entity';

export interface AssetLabel {
  tag: string;
  name: string;
  location: string | null;
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const COLUMNS = 3;
const ROWS = 8;
const MARGIN_X = 18;
const MARGIN_Y = 22;
const GAP = 6;

export async function assetLabelsPdf(schoolName: string, labels: AssetLabel[]): Promise<Buffer> {
  const doc = createPdf({ size: 'A4', margin: 0, info: { Title: 'Asset tags' } });
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
      .text(`${schoolName.toUpperCase()} · PROPERTY`, x + 6, y + 5, {
        width: width - 12,
        height: 8,
        ellipsis: true,
        lineBreak: false,
      });
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(BRAND.dark)
      .text(label.name, x + 6, y + 15, { width: width - 12, height: 18, ellipsis: true });
    const png = await toBuffer({
      bcid: 'code128',
      text: label.tag,
      scale: 3,
      height: 10,
      includetext: false,
      paddingwidth: 2,
    });
    doc.image(png, x + 8, y + 36, { fit: [width - 16, height - 58], align: 'center' });
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(BRAND.dark)
      .text(label.tag, x + 6, y + height - 19, { width: width - 12, align: 'center', lineBreak: false });
    if (label.location) {
      doc
        .font('Helvetica')
        .fontSize(6)
        .fillColor(BRAND.muted)
        .text(label.location, x + 6, y + height - 9, { width: width - 12, align: 'center', lineBreak: false });
    }
  }
  return renderPdf(doc);
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const ASSET_COLUMNS: { key: string; header: string; width: number; note: string }[] = [
  { key: 'name', header: 'Name *', width: 28, note: 'Required' },
  {
    key: 'category',
    header: 'Category *',
    width: 18,
    note: 'Name or code of an asset category. New names are created.',
  },
  { key: 'quantity', header: 'Quantity', width: 9, note: '1 if empty. Registers that many identical assets.' },
  { key: 'serial_nos', header: 'Serial numbers', width: 24, note: 'Optional, one per asset, separated by |' },
  { key: 'make', header: 'Make', width: 14, note: '' },
  { key: 'model', header: 'Model', width: 16, note: '' },
  { key: 'location', header: 'Location', width: 18, note: 'Name or code. New names are created as rooms.' },
  { key: 'vendor', header: 'Vendor', width: 20, note: 'New names are created' },
  { key: 'invoice_no', header: 'Invoice no', width: 14, note: '' },
  { key: 'purchase_date', header: 'Purchase date', width: 13, note: 'YYYY-MM-DD or DD-MM-YYYY' },
  { key: 'cost', header: 'Cost', width: 11, note: 'Rupees per asset' },
  { key: 'warranty_until', header: 'Warranty until', width: 13, note: 'YYYY-MM-DD or DD-MM-YYYY' },
  { key: 'condition', header: 'Condition', width: 10, note: 'new, good, fair, poor or damaged' },
  { key: 'funding_source', header: 'Funding', width: 11, note: 'school, government, donation, pta or other' },
  { key: 'notes', header: 'Notes', width: 24, note: '' },
];

export interface ParsedAssetRow {
  row: number;
  name: string;
  category: string;
  quantity: number;
  serial_nos: string[];
  make: string | null;
  model: string | null;
  location: string | null;
  vendor: string | null;
  invoice_no: string | null;
  purchase_date: string | null;
  cost: number | null;
  warranty_until: string | null;
  condition: AssetCondition;
  funding_source: FundingSource;
  notes: string | null;
}

const keyFor = (header: string) => {
  const wanted = header.replace('*', '').trim().toLowerCase();
  return ASSET_COLUMNS.find((column) => column.header.replace('*', '').trim().toLowerCase() === wanted)?.key ?? null;
};

export async function readAssetSheet(
  buffer: Buffer,
  filename: string,
): Promise<{ row: number; values: Record<string, string> }[]> {
  const workbook = new ExcelJS.Workbook();
  if (/\.csv$/i.test(filename)) {
    const { Readable } = await import('stream');
    await workbook.csv.read(Readable.from(buffer.toString('utf8').replace(/^﻿/, '')));
  } else {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  }
  const sheet = workbook.getWorksheet('Assets') ?? workbook.worksheets[0];
  if (!sheet) return [];
  const headers = new Map<number, string>();
  sheet.getRow(1).eachCell((cell, column) => {
    const key = keyFor(cellText(cell.value as CellValue));
    if (key) headers.set(column, key);
  });
  const rows: { row: number; values: Record<string, string> }[] = [];
  sheet.eachRow((row, number) => {
    if (number === 1) return;
    const values: Record<string, string> = {};
    headers.forEach((key, column) => {
      values[key] = cellText(row.getCell(column).value as CellValue);
    });
    if (Object.values(values).some((value) => value !== '')) rows.push({ row: number, values });
  });
  return rows;
}

const orNull = (value: string | undefined) => (value && value.trim() ? value.trim() : null);

export function parseAssetRow(
  row: number,
  values: Record<string, string>,
): { parsed: ParsedAssetRow | null; error: string | null } {
  const errors: string[] = [];
  const name = (values.name ?? '').trim();
  const category = (values.category ?? '').trim();
  if (!name) errors.push('Name is required');
  if (name.length > 120) errors.push('Name is longer than 120 characters');
  if (!category) errors.push('Category is required');
  const serials = (values.serial_nos ?? '')
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
  let quantity = Math.max(1, serials.length);
  if (values.quantity) {
    const parsed = Number(values.quantity);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) errors.push('Quantity must be 1 to 200');
    else quantity = parsed;
  }
  if (serials.length > quantity) errors.push('More serial numbers than the quantity');
  if (new Set(serials).size !== serials.length) errors.push('A serial number is repeated');
  let cost: number | null = null;
  if (values.cost) {
    cost = Number(values.cost.replace(/,/g, ''));
    if (!Number.isFinite(cost) || cost < 0) errors.push('Cost must be a number');
  }
  const date = (value: string | undefined, label: string) => {
    if (!value) return null;
    const normalized = normalizeDate(value);
    if (!isCalendarDate(normalized)) {
      errors.push(`${label} must be a date`);
      return null;
    }
    return normalized;
  };
  const condition = (values.condition || 'new').toLowerCase() as AssetCondition;
  if (!ASSET_CONDITIONS.includes(condition)) errors.push('Condition must be new, good, fair, poor or damaged');
  const funding = (values.funding_source || 'school').toLowerCase() as FundingSource;
  if (!FUNDING_SOURCES.includes(funding)) errors.push('Funding must be school, government, donation, pta or other');
  const parsed: ParsedAssetRow = {
    row,
    name,
    category,
    quantity,
    serial_nos: serials,
    make: orNull(values.make),
    model: orNull(values.model),
    location: orNull(values.location),
    vendor: orNull(values.vendor),
    invoice_no: orNull(values.invoice_no),
    purchase_date: date(values.purchase_date, 'Purchase date'),
    cost,
    warranty_until: date(values.warranty_until, 'Warranty until'),
    condition,
    funding_source: funding,
    notes: orNull(values.notes),
  };
  return errors.length ? { parsed: null, error: errors.join('; ') } : { parsed, error: null };
}

export async function assetTemplate(categories: string[], locations: string[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Assets');
  sheet.columns = ASSET_COLUMNS.map((column) => ({ header: column.header, key: column.key, width: column.width }));
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF159053' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.addRow({
    name: 'Dell Latitude 3440',
    category: categories[0] ?? 'Laptops',
    quantity: 2,
    serial_nos: 'DL3440A1|DL3440A2',
    make: 'Dell',
    model: 'Latitude 3440',
    location: locations[0] ?? 'Computer Lab',
    vendor: 'Sri Ganesh Computers',
    invoice_no: 'SGC-2026-114',
    purchase_date: '2026-06-10',
    cost: 52000,
    warranty_until: '2029-06-09',
    condition: 'new',
    funding_source: 'school',
  });
  const help = workbook.addWorksheet('Instructions');
  help.columns = [
    { header: 'Column', key: 'header', width: 18 },
    { header: 'How to fill it', key: 'note', width: 70 },
  ];
  help.getRow(1).font = { bold: true };
  ASSET_COLUMNS.forEach((column) => help.addRow({ header: column.header, note: column.note }));
  help.addRow({});
  help.addRow({ header: 'Asset categories', note: categories.join(', ') || '-' });
  help.addRow({ header: 'Locations', note: locations.slice(0, 60).join(', ') || '-' });
  help.addRow({
    header: 'Tip',
    note: 'Delete the example row. Every asset gets its own tag; print the labels after the import.',
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
