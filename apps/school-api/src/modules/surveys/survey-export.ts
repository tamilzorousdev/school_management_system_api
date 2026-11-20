import { StreamableFile } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { XLSX } from '../attendance/attendance-export';
import { AnswerValue } from './entities/survey.entity';
import { formatAnswer, QuestionResult } from './survey.logic';

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF159053' } };

const TYPE_LABEL: Record<string, string> = {
  single_choice: 'One choice',
  multi_choice: 'Many choices',
  rating: 'Rating 1-5',
  short_text: 'Short answer',
  long_text: 'Long answer',
  date: 'Date',
  number: 'Number',
};

export interface ExportRow {
  submitted: string;
  person: string[] | null;
  answers: Map<number, AnswerValue>;
}

export interface SurveyExport {
  title: string;
  subtitle: string;
  anonymous: boolean;
  questions: { id: number; text: string }[];
  rows: ExportRow[];
  summary: QuestionResult[];
}

function header(ws: ExcelJS.Worksheet, title: string, subtitle: string, columns: string[]) {
  ws.addRow([title]).font = { bold: true, size: 14 };
  ws.addRow([subtitle]).font = { color: { argb: 'FF5A6A62' } };
  ws.addRow([]);
  const head = ws.addRow(columns);
  head.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = HEADER_FILL;
    cell.alignment = { wrapText: true, vertical: 'top' };
  });
  ws.views = [{ state: 'frozen', ySplit: 4 }];
}

function resultText(result: QuestionResult): string {
  if (result.choices) {
    return result.choices.map((choice) => `${choice.option}: ${choice.count} (${choice.percent}%)`).join(' · ');
  }
  if (result.rating) {
    const stars = [5, 4, 3, 2, 1].map((star) => `${star}★ ${result.rating!.counts[String(star)] ?? 0}`).join(', ');
    return `Average ${result.rating.average ?? '—'} · ${stars}`;
  }
  if (result.number) {
    return `Average ${result.number.average ?? '—'} · lowest ${result.number.min ?? '—'} · highest ${result.number.max ?? '—'}`;
  }
  return `${result.answers?.length ?? 0} answers (see the Answers sheet)`;
}

export async function surveyFile(data: SurveyExport): Promise<StreamableFile> {
  const book = new ExcelJS.Workbook();
  const answers = book.addWorksheet('Answers');
  const personColumns = data.anonymous ? [] : ['Name', 'Role', 'Child', 'Class / section'];
  header(answers, data.title, data.subtitle, [
    'Submitted',
    ...personColumns,
    ...data.questions.map((question) => question.text),
  ]);
  for (const row of data.rows) {
    answers.addRow([
      row.submitted,
      ...(data.anonymous ? [] : (row.person ?? [])),
      ...data.questions.map((question) => formatAnswer(row.answers.get(question.id))),
    ]);
  }
  [20, ...personColumns.map((column) => (column === 'Name' ? 26 : 16)), ...data.questions.map(() => 28)].forEach(
    (width, index) => (answers.getColumn(index + 1).width = width),
  );

  const summary = book.addWorksheet('Summary');
  header(summary, data.title, data.subtitle, ['Question', 'Type', 'Answered', 'Result']);
  for (const result of data.summary) {
    summary.addRow([result.text, TYPE_LABEL[result.type] ?? result.type, result.answered, resultText(result)]);
  }
  [40, 14, 10, 80].forEach((width, index) => (summary.getColumn(index + 1).width = width));

  const buffer = Buffer.from(await book.xlsx.writeBuffer());
  return new StreamableFile(buffer, {
    type: XLSX,
    length: buffer.length,
    disposition: `attachment; filename="${encodeURIComponent(data.title.replace(/[^\w.-]+/g, '-'))}.xlsx"`,
  });
}
