import { StreamableFile } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { AlumniDetailDto } from './dto/alumni.dto';

export const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF159053' } };

const OCCUPATION_LABELS: Record<string, string> = {
  higher_studies: 'Higher studies',
  employed: 'Employed',
  self_employed: 'Self-employed',
  seeking: 'Looking for work',
  other: 'Other',
  unknown: 'Not known',
};

const COLUMNS: [string, number, (row: AlumniDetailDto) => string | number | null][] = [
  ['Alumni no', 18, (row) => row.alumni_no],
  ['Name', 26, (row) => row.full_name],
  ['Gender', 9, (row) => row.gender],
  ['Date of birth', 13, (row) => row.dob],
  ['Admission no', 15, (row) => row.admission_no],
  ['EMIS no', 18, (row) => row.emis_number],
  ['Batch', 8, (row) => row.batch_year],
  ['Left on', 12, (row) => row.left_on],
  ['Exit', 12, (row) => row.exit_type],
  ['Final class', 12, (row) => [row.final_class_name, row.final_section_name].filter(Boolean).join(' ') || null],
  ['Final %', 9, (row) => row.final_percent],
  ['Grade', 7, (row) => row.final_grade],
  ['Mobile', 13, (row) => row.mobile],
  ['Email', 26, (row) => row.email],
  ['City', 14, (row) => row.city],
  ['State', 14, (row) => row.state],
  ['Occupation', 16, (row) => OCCUPATION_LABELS[row.occupation_status] ?? row.occupation_status],
  ['Institution', 24, (row) => row.institution],
  ['Course', 20, (row) => row.course],
  ['Organisation', 22, (row) => row.organization],
  ['Designation', 18, (row) => row.designation],
  ['Can contact', 11, (row) => (row.contact_consent ? 'Yes' : 'No')],
  ['Status', 9, (row) => row.status],
];

export async function alumniFile(rows: AlumniDetailDto[]): Promise<StreamableFile> {
  const book = new ExcelJS.Workbook();
  const ws = book.addWorksheet('Alumni');
  ws.addRow(['Alumni register']).font = { bold: true, size: 14 };
  ws.addRow([`${rows.length} ${rows.length === 1 ? 'alumnus' : 'alumni'}`]).font = { color: { argb: 'FF5A6A62' } };
  ws.addRow([]);
  const head = ws.addRow(COLUMNS.map(([title]) => title));
  head.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = HEADER_FILL;
  });
  ws.views = [{ state: 'frozen', ySplit: 4 }];
  for (const row of rows) ws.addRow(COLUMNS.map(([, , value]) => value(row)));
  COLUMNS.forEach(([, width], index) => (ws.getColumn(index + 1).width = width));
  const buffer = Buffer.from(await book.xlsx.writeBuffer());
  return new StreamableFile(buffer, {
    type: XLSX,
    length: buffer.length,
    disposition: 'attachment; filename="Alumni.xlsx"',
  });
}
