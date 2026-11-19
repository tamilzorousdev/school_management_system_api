import ExcelJS, { CellValue } from 'exceljs';
import { cellText, normalizeDate } from '../student-import/import-sheet';
import { COPY_SOURCES, CopySource } from './entities/book.entity';
import { normalizeIsbn } from './library.logic';

export interface BookColumn {
  key: string;
  header: string;
  width: number;
  note: string;
}

export const BOOK_COLUMNS: BookColumn[] = [
  { key: 'title', header: 'Title *', width: 34, note: 'Required' },
  { key: 'subtitle', header: 'Subtitle', width: 22, note: '' },
  { key: 'isbn', header: 'ISBN', width: 16, note: 'ISBN-10 or ISBN-13. A known ISBN adds copies to that book.' },
  { key: 'authors', header: 'Authors', width: 26, note: 'Separate several with commas' },
  { key: 'publisher', header: 'Publisher', width: 20, note: '' },
  { key: 'edition', header: 'Edition', width: 10, note: '' },
  { key: 'published_year', header: 'Year', width: 8, note: 'e.g. 2019' },
  { key: 'language', header: 'Language', width: 11, note: 'English if empty' },
  { key: 'category', header: 'Category', width: 16, note: 'Name or code. New names are created.' },
  { key: 'rack', header: 'Rack', width: 8, note: '' },
  { key: 'shelf', header: 'Shelf', width: 8, note: '' },
  { key: 'price', header: 'Price', width: 9, note: 'Rupees per copy' },
  { key: 'pages', header: 'Pages', width: 8, note: '' },
  { key: 'copies', header: 'Copies', width: 8, note: '1 if empty' },
  { key: 'barcodes', header: 'Barcodes', width: 26, note: 'Optional, separated by |' },
  {
    key: 'accession_nos',
    header: 'Accession numbers',
    width: 22,
    note: 'Optional, from your register, separated by |',
  },
  { key: 'source', header: 'Source', width: 10, note: 'purchase, donation or other' },
  { key: 'vendor', header: 'Vendor', width: 18, note: '' },
  { key: 'bill_no', header: 'Bill no', width: 12, note: '' },
  { key: 'acquired_on', header: 'Acquired on', width: 12, note: 'YYYY-MM-DD or DD-MM-YYYY' },
  { key: 'keywords', header: 'Keywords', width: 20, note: '' },
];

export type BookSheetRow = Record<string, string>;

export interface ParsedBookRow {
  row: number;
  title: string;
  subtitle: string | null;
  isbn: string | null;
  authors: string | null;
  publisher: string | null;
  edition: string | null;
  published_year: number | null;
  language: string;
  category: string | null;
  rack: string | null;
  shelf: string | null;
  price: number | null;
  pages: number | null;
  copies: number;
  barcodes: string[];
  accession_nos: string[];
  source: CopySource;
  vendor: string | null;
  bill_no: string | null;
  acquired_on: string | null;
  keywords: string | null;
}

function keyFor(header: string): string | null {
  const wanted = header.replace('*', '').trim().toLowerCase();
  return BOOK_COLUMNS.find((column) => column.header.replace('*', '').trim().toLowerCase() === wanted)?.key ?? null;
}

export async function readBookSheet(
  buffer: Buffer,
  filename: string,
): Promise<{ row: number; values: BookSheetRow }[]> {
  const workbook = new ExcelJS.Workbook();
  if (/\.csv$/i.test(filename)) {
    const { Readable } = await import('stream');
    await workbook.csv.read(Readable.from(buffer.toString('utf8').replace(/^﻿/, '')));
  } else {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  }
  const sheet = workbook.getWorksheet('Books') ?? workbook.worksheets[0];
  if (!sheet) return [];
  const headers = new Map<number, string>();
  sheet.getRow(1).eachCell((cell, column) => {
    const key = keyFor(cellText(cell.value as CellValue));
    if (key) headers.set(column, key);
  });
  const rows: { row: number; values: BookSheetRow }[] = [];
  sheet.eachRow((row, number) => {
    if (number === 1) return;
    const values: BookSheetRow = {};
    headers.forEach((key, column) => {
      values[key] = cellText(row.getCell(column).value as CellValue);
    });
    if (Object.values(values).some((value) => value !== '')) rows.push({ row: number, values });
  });
  return rows;
}

const split = (value: string) =>
  value
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);

const orNull = (value: string | undefined) => (value && value.trim() ? value.trim() : null);

export function parseBookRow(
  row: number,
  values: BookSheetRow,
): { parsed: ParsedBookRow | null; error: string | null } {
  const errors: string[] = [];
  const title = (values.title ?? '').trim();
  if (!title) errors.push('Title is required');
  if (title.length > 200) errors.push('Title is longer than 200 characters');
  let isbn: string | null = null;
  if (values.isbn) {
    isbn = normalizeIsbn(values.isbn);
    if (!isbn) errors.push(`ISBN ${values.isbn} is not valid`);
  }
  const number = (value: string | undefined, label: string, min: number, max: number, integer = true) => {
    if (!value) return null;
    const parsed = Number(value.replace(/,/g, ''));
    if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) {
      errors.push(`${label} must be a number from ${min} to ${max}`);
      return null;
    }
    return parsed;
  };
  const barcodes = split(values.barcodes ?? '');
  const accessionNos = split(values.accession_nos ?? '');
  const copies = number(values.copies, 'Copies', 1, 200) ?? Math.max(1, barcodes.length, accessionNos.length);
  if (barcodes.length > copies) errors.push('More barcodes than copies');
  if (accessionNos.length > copies) errors.push('More accession numbers than copies');
  if (barcodes.some((code) => code.length < 3 || code.length > 60)) errors.push('Barcodes must be 3 to 60 characters');
  if (new Set(barcodes).size !== barcodes.length) errors.push('A barcode is repeated');
  if (new Set(accessionNos).size !== accessionNos.length) errors.push('An accession number is repeated');
  const source = (values.source || 'purchase').toLowerCase() as CopySource;
  if (!COPY_SOURCES.includes(source)) errors.push('Source must be purchase, donation or other');
  const acquired = values.acquired_on ? normalizeDate(values.acquired_on) : '';
  if (acquired && !/^\d{4}-\d{2}-\d{2}$/.test(acquired)) errors.push('Acquired on must be a date');
  const parsed: ParsedBookRow = {
    row,
    title,
    subtitle: orNull(values.subtitle),
    isbn,
    authors: orNull(values.authors),
    publisher: orNull(values.publisher),
    edition: orNull(values.edition),
    published_year: number(values.published_year, 'Year', 1400, 2100),
    language: orNull(values.language) ?? 'English',
    category: orNull(values.category),
    rack: orNull(values.rack),
    shelf: orNull(values.shelf),
    price: number(values.price, 'Price', 0, 1000000, false),
    pages: number(values.pages, 'Pages', 1, 20000),
    copies,
    barcodes,
    accession_nos: accessionNos,
    source,
    vendor: orNull(values.vendor),
    bill_no: orNull(values.bill_no),
    acquired_on: acquired || null,
    keywords: orNull(values.keywords),
  };
  return errors.length ? { parsed: null, error: errors.join('; ') } : { parsed, error: null };
}

export async function bookTemplate(categories: { name: string; code: string }[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Books');
  sheet.columns = BOOK_COLUMNS.map((column) => ({ header: column.header, key: column.key, width: column.width }));
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF159053' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.addRow({
    title: 'Wings of Fire',
    subtitle: 'An Autobiography',
    isbn: '9788173711466',
    authors: 'A. P. J. Abdul Kalam, Arun Tiwari',
    publisher: 'Universities Press',
    published_year: 1999,
    language: 'English',
    category: categories[0]?.name ?? 'Biography',
    rack: 'R1',
    shelf: 'S2',
    price: 250,
    copies: 2,
    barcodes: '',
    accession_nos: '',
    source: 'purchase',
    acquired_on: '2026-06-10',
  });
  const help = workbook.addWorksheet('Instructions');
  help.columns = [
    { header: 'Column', key: 'header', width: 22 },
    { header: 'How to fill it', key: 'note', width: 70 },
  ];
  help.getRow(1).font = { bold: true };
  BOOK_COLUMNS.forEach((column) => help.addRow({ header: column.header, note: column.note }));
  help.addRow({});
  help.addRow({
    header: 'Categories',
    note: categories.map((item) => `${item.name} (${item.code})`).join(', ') || '-',
  });
  help.addRow({
    header: 'Tip',
    note: 'Delete the example row. Leave Barcodes empty to print new barcode labels from the library after the import.',
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
