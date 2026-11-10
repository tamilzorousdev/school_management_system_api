import { StreamableFile } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { ClassReportDto, SectionReportDto } from './dto/attendance.dto';

export const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF159053' } };

function sheet(book: ExcelJS.Workbook, name: string, title: string, subtitle: string, headers: string[]) {
  const ws = book.addWorksheet(name);
  ws.addRow([title]).font = { bold: true, size: 14 };
  ws.addRow([subtitle]).font = { color: { argb: 'FF5A6A62' } };
  ws.addRow([]);
  const head = ws.addRow(headers);
  head.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = HEADER_FILL;
  });
  ws.views = [{ state: 'frozen', ySplit: 4 }];
  return ws;
}

function fit(ws: ExcelJS.Worksheet, widths: number[]) {
  widths.forEach((width, index) => (ws.getColumn(index + 1).width = width));
}

async function file(book: ExcelJS.Workbook, name: string): Promise<StreamableFile> {
  const buffer = Buffer.from(await book.xlsx.writeBuffer());
  return new StreamableFile(buffer, {
    type: XLSX,
    length: buffer.length,
    disposition: `attachment; filename="${encodeURIComponent(name.replace(/[^\w.-]+/g, '-'))}.xlsx"`,
  });
}

export function sectionReportFile(report: SectionReportDto, sectionName: string): Promise<StreamableFile> {
  const book = new ExcelJS.Workbook();
  const ws = sheet(
    book,
    'Attendance',
    `Class ${sectionName} · attendance ${report.month}`,
    `${report.marked_days} of ${report.working_days} school days marked · morning and afternoon sessions together`,
    ['Roll no', 'Student', 'Present', 'Half day', 'Late', 'Absent', 'Leave', 'Attendance %'],
  );
  for (const row of report.students) {
    ws.addRow([row.roll_no, row.full_name, row.present, row.half_day, row.late, row.absent, row.leave, row.percent]);
  }
  fit(ws, [9, 30, 10, 10, 8, 9, 8, 14]);
  return file(book, `Attendance-${sectionName}-${report.month}`);
}

export function classReportFile(report: ClassReportDto): Promise<StreamableFile> {
  const book = new ExcelJS.Workbook();
  const ws = sheet(
    book,
    'Class',
    `Class ${report.class.name} · attendance ${report.month}`,
    `${report.students} students · ${report.working_days} school days · class average ${report.percent ?? '—'}% · ${report.below_75} below 75%`,
    ['Section', 'Students', 'Days marked', 'Average %', 'Below 75%'],
  );
  for (const row of report.sections) {
    ws.addRow([row.name, row.students, row.marked_days, row.percent, row.below_75]);
  }
  ws.addRow(['Whole class', report.students, null, report.percent, report.below_75]).font = { bold: true };
  fit(ws, [18, 11, 13, 12, 12]);
  return file(book, `Attendance-Class-${report.class.name}-${report.month}`);
}
