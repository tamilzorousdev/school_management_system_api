import { StreamableFile } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { XLSX } from '../attendance/attendance-export';

export interface TableColumn {
  key: string;
  label: string;
}

export interface TableExport {
  name: string;
  title: string;
  subtitle: string;
  columns: TableColumn[];
  rows: Record<string, unknown>[];
}

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF159053' } };

const fileName = (name: string) => encodeURIComponent(name.replace(/[^\w.-]+/g, '-'));

function cellValue(value: unknown): string | number | Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || value instanceof Date) return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function csvEscape(value: unknown): string {
  const cell = cellValue(value);
  if (cell === null) return '';
  const text = cell instanceof Date ? cell.toISOString() : String(cell);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function toCsv(table: Pick<TableExport, 'columns' | 'rows'>): string {
  const lines = [table.columns.map((column) => csvEscape(column.label)).join(',')];
  for (const row of table.rows) lines.push(table.columns.map((column) => csvEscape(row[column.key])).join(','));
  return lines.join('\r\n');
}

export async function tableFile(table: TableExport, format: 'xlsx' | 'csv'): Promise<StreamableFile> {
  if (format === 'csv') {
    const buffer = Buffer.from(`﻿${toCsv(table)}`, 'utf8');
    return new StreamableFile(buffer, {
      type: 'text/csv; charset=utf-8',
      length: buffer.length,
      disposition: `attachment; filename="${fileName(table.name)}.csv"`,
    });
  }
  const book = new ExcelJS.Workbook();
  const ws = book.addWorksheet(table.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
  ws.addRow([table.title]).font = { bold: true, size: 14 };
  ws.addRow([table.subtitle]).font = { color: { argb: 'FF5A6A62' } };
  ws.addRow([]);
  const head = ws.addRow(table.columns.map((column) => column.label));
  head.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = HEADER_FILL;
  });
  ws.views = [{ state: 'frozen', ySplit: 4 }];
  for (const row of table.rows) ws.addRow(table.columns.map((column) => cellValue(row[column.key])));
  table.columns.forEach((column, index) => (ws.getColumn(index + 1).width = Math.max(12, column.label.length + 4)));
  const buffer = Buffer.from(await book.xlsx.writeBuffer());
  return new StreamableFile(buffer, {
    type: XLSX,
    length: buffer.length,
    disposition: `attachment; filename="${fileName(table.name)}.xlsx"`,
  });
}
