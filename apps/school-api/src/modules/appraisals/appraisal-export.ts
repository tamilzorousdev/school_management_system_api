import { StreamableFile } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { XLSX } from '../attendance/attendance-export';
import { RATING_LABELS } from './appraisal.logic';
import { AppraisalDto } from './dto/appraisal.dto';

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF159053' } };

const STAGE_LABELS: Record<string, string> = {
  self_pending: 'Self-appraisal',
  hod_pending: 'With HOD',
  principal_pending: 'With Principal',
  published: 'Published',
  appealed: 'Appealed',
  completed: 'Completed',
};

function header(ws: ExcelJS.Worksheet, title: string, columns: string[]) {
  ws.addRow([title]).font = { bold: true, size: 14 };
  ws.addRow([]);
  const head = ws.addRow(columns);
  head.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = HEADER_FILL;
    cell.alignment = { wrapText: true, vertical: 'top' };
  });
  ws.views = [{ state: 'frozen', ySplit: 3 }];
}

const value = (input: number | null) => (input === null ? '' : input);

export async function appraisalFile(title: string, rows: AppraisalDto[]): Promise<StreamableFile> {
  const book = new ExcelJS.Workbook();
  const summary = book.addWorksheet('Summary');
  header(summary, title, [
    'Name',
    'Employee no',
    'Department',
    'Group',
    'Step',
    'Self %',
    'HOD %',
    'Final %',
    'Rating',
    'Recommendation',
    'Increment %',
  ]);
  for (const row of rows) {
    summary.addRow([
      row.staff.name,
      row.staff.employee_no,
      row.staff.department ?? '',
      row.group.name,
      `${STAGE_LABELS[row.stage] ?? row.stage}${row.self_missed ? ' (self missed)' : ''}`,
      value(row.self_percent),
      value(row.hod_percent),
      value(row.final_percent),
      row.rating ? RATING_LABELS[row.rating] : '',
      row.recommendation ?? '',
      value(row.increment_percent),
    ]);
  }
  [26, 14, 16, 22, 18, 9, 9, 9, 20, 14, 11].forEach((width, index) => (summary.getColumn(index + 1).width = width));

  const scores = book.addWorksheet('KRA scores');
  header(scores, title, ['Name', 'KRA', 'Weight %', 'Auto value', 'Self', 'HOD', 'Final', 'Changed because']);
  for (const row of rows) {
    for (const score of row.scores) {
      scores.addRow([
        row.staff.name,
        score.title,
        score.weightage_percent,
        value(score.auto_value),
        value(score.self_score),
        value(score.hod_score),
        value(score.final_score),
        score.override_reason ?? '',
      ]);
    }
  }
  [26, 40, 10, 11, 8, 8, 8, 40].forEach((width, index) => (scores.getColumn(index + 1).width = width));

  const buffer = Buffer.from(await book.xlsx.writeBuffer());
  return new StreamableFile(buffer, {
    type: XLSX,
    disposition: `attachment; filename="${title.replace(/[^\w.-]+/g, '-')}.xlsx"`,
  });
}
