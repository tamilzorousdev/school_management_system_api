import { StreamableFile } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { XLSX } from '../attendance/attendance-export';
import { FeeReportDto, ReportColumnDto } from './dto/fees.dto';

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF159053' } };

const FORMATS: Partial<Record<ReportColumnDto['kind'], string>> = {
  money: '#,##0.00',
  number: '0',
  percent: '0.00"%"',
};

function width(column: ReportColumnDto, rows: FeeReportDto['rows']): number {
  const longest = Math.max(
    column.label.length,
    ...rows.slice(0, 200).map((row) => String(row[column.key] ?? '').length),
  );
  return Math.min(Math.max(longest + 2, column.kind === 'money' ? 14 : 10), 40);
}

function cell(column: ReportColumnDto, value: string | number | null | undefined): string | number | Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (column.kind === 'date' && typeof value === 'string') return new Date(`${value}T00:00:00Z`);
  return value;
}

export async function feeReportFile(report: FeeReportDto, school: string): Promise<StreamableFile> {
  const book = new ExcelJS.Workbook();
  const ws = book.addWorksheet(report.title.slice(0, 31));
  ws.addRow([`${school} · ${report.title}`]).font = { bold: true, size: 14 };
  const period = report.from && report.to ? `${report.from} to ${report.to}` : report.academic_year;
  ws.addRow([[period, report.note].filter(Boolean).join(' · ')]).font = { color: { argb: 'FF5A6A62' } };
  ws.addRow([]);
  const head = ws.addRow(report.columns.map((column) => column.label));
  head.eachCell((item) => {
    item.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    item.fill = HEADER_FILL;
  });
  ws.views = [{ state: 'frozen', ySplit: 4 }];
  for (const row of report.rows) {
    ws.addRow(report.columns.map((column) => cell(column, row[column.key])));
  }
  if (report.totals) {
    ws.addRow(report.columns.map((column) => cell(column, report.totals![column.key]))).font = { bold: true };
  }
  report.columns.forEach((column, index) => {
    const sheetColumn = ws.getColumn(index + 1);
    sheetColumn.width = width(column, report.rows);
    if (FORMATS[column.kind]) sheetColumn.numFmt = FORMATS[column.kind]!;
    if (column.kind === 'date') sheetColumn.numFmt = 'dd mmm yyyy';
  });
  const buffer = Buffer.from(await book.xlsx.writeBuffer());
  const name = `${report.title}-${report.from && report.to ? `${report.from}-${report.to}` : report.academic_year}`;
  return new StreamableFile(buffer, {
    type: XLSX,
    length: buffer.length,
    disposition: `attachment; filename="${encodeURIComponent(name.replace(/[^\w.-]+/g, '-'))}.xlsx"`,
  });
}
