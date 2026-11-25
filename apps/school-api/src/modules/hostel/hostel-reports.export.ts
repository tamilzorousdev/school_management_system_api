import { StreamableFile } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { XLSX } from '../attendance/attendance-export';
import {
  AttendanceReportDto,
  DisciplineReportDto,
  FeesReportDto,
  LeavesReportDto,
  OccupancyCountsDto,
  OccupancyReportDto,
  ReportCountDto,
  ReportPeriodDto,
} from './dto/hostel-reports.dto';
import { HostelStudentDto } from './dto/hostel-admission.dto';
import { labelOf } from './hostel-reports.logic';

type Cell = string | number | null;

export interface ReportSheet {
  name: string;
  headers: string[];
  rows: Cell[][];
  boldRows?: number[];
}

export interface ReportHeading {
  school: string;
  title: string;
  scope: string;
  period: string;
}

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF159053' } };

function width(header: string, rows: Cell[][], index: number): number {
  const longest = Math.max(header.length, ...rows.slice(0, 200).map((row) => String(row[index] ?? '').length));
  return Math.min(Math.max(longest + 2, 10), 40);
}

function addSheet(book: ExcelJS.Workbook, heading: ReportHeading, sheet: ReportSheet): void {
  const ws = book.addWorksheet(sheet.name.slice(0, 31));
  ws.addRow([`${heading.school} · ${heading.title}`]).font = { bold: true, size: 14 };
  ws.addRow([`${heading.scope} · ${heading.period}`]).font = { color: { argb: 'FF5A6A62' } };
  ws.addRow([]);
  const head = ws.addRow(sheet.headers);
  head.eachCell((item) => {
    item.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    item.fill = HEADER_FILL;
  });
  ws.views = [{ state: 'frozen', ySplit: 4 }];
  sheet.rows.forEach((row, index) => {
    const added = ws.addRow(row);
    if (sheet.boldRows?.includes(index)) added.font = { bold: true };
  });
  sheet.headers.forEach((header, index) => (ws.getColumn(index + 1).width = width(header, sheet.rows, index)));
}

export async function reportWorkbook(heading: ReportHeading, sheets: ReportSheet[]): Promise<StreamableFile> {
  const book = new ExcelJS.Workbook();
  for (const sheet of sheets) addSheet(book, heading, sheet);
  const buffer = Buffer.from(await book.xlsx.writeBuffer());
  const name = `Hostel-${heading.title}-${heading.period}`;
  return new StreamableFile(buffer, {
    type: XLSX,
    length: buffer.length,
    disposition: `attachment; filename="${encodeURIComponent(name.replace(/[^\w.-]+/g, '-'))}.xlsx"`,
  });
}

export const periodLabel = (period: ReportPeriodDto) => `${period.from} to ${period.to}`;

const studentCells = (student: HostelStudentDto): Cell[] => [
  student.name,
  student.admission_no,
  [student.class_name, student.section_name].filter(Boolean).join(' - ') || null,
];

const STUDENT_HEADERS = ['Student', 'Admission no', 'Class'];

const countRows = (group: string, rows: ReportCountDto[]): Cell[][] =>
  rows.map((row) => [group, labelOf(row.key), row.count]);

const occupancyCells = (row: OccupancyCountsDto): Cell[] => [
  row.rooms,
  row.beds,
  row.occupied,
  row.vacant,
  row.reserved,
  row.blocked,
  row.maintenance,
  row.occupancy_percent,
];

export function occupancySheets(report: OccupancyReportDto): ReportSheet[] {
  const rows: Cell[][] = [];
  const boldRows: number[] = [];
  for (const hostel of report.hostels) {
    for (const block of hostel.blocks) rows.push([hostel.hostel_name, block.block_name, ...occupancyCells(block)]);
    boldRows.push(rows.length);
    rows.push([hostel.hostel_name, 'All blocks', ...occupancyCells(hostel)]);
  }
  boldRows.push(rows.length);
  rows.push(['All hostels', null, ...occupancyCells(report.totals)]);
  return [
    {
      name: 'Blocks',
      headers: ['Hostel', 'Block', 'Rooms', 'Beds', 'Occupied', 'Vacant', 'Reserved', 'Blocked', 'Maintenance', '%'],
      rows,
      boldRows,
    },
    {
      name: 'Room types',
      headers: ['Room type', 'Rooms', 'Beds', 'Occupied', 'Occupancy %'],
      rows: report.room_types.map((row) => [
        row.room_type_name,
        row.rooms,
        row.beds,
        row.occupied,
        row.occupancy_percent,
      ]),
    },
  ];
}

export function attendanceSheets(report: AttendanceReportDto): ReportSheet[] {
  const headers = ['Slot', 'Marked', 'Present', 'Late', 'Absent', 'Away', 'Sick', 'Present %'];
  return [
    {
      name: 'Slots',
      headers,
      rows: [
        ...report.slots.map((row) => [
          labelOf(row.slot),
          row.total,
          row.present,
          row.late,
          row.absent,
          row.away,
          row.sick,
          row.present_percent,
        ]),
        [
          'All slots',
          report.totals.total,
          report.totals.present,
          report.totals.late,
          report.totals.absent,
          report.totals.away,
          report.totals.sick,
          report.totals.present_percent,
        ],
      ],
      boldRows: [report.slots.length],
    },
    {
      name: 'Daily',
      headers: ['Date', 'Roll calls', 'Present', 'Absent', 'Present %'],
      rows: report.days.map((row) => [row.date, row.roll_calls, row.present, row.absent, row.present_percent]),
    },
    {
      name: 'Top absentees',
      headers: [...STUDENT_HEADERS, 'Hostel', 'Absent', 'Late', 'Marked'],
      rows: report.top_absentees.map((row) => [
        ...studentCells(row.student),
        row.hostel_name,
        row.absent,
        row.late,
        row.marked,
      ]),
    },
  ];
}

export function leavesSheets(report: LeavesReportDto): ReportSheet[] {
  const late = report.late_returns;
  return [
    {
      name: 'Summary',
      headers: ['Group', 'Item', 'Count'],
      rows: [
        ['Total', 'Leaves and outings', report.total],
        ['Total', 'Outings', report.outings],
        ['Total', 'Overnight leaves', report.overnight_leaves],
        ['Raised by', 'Parent', report.parent_initiated],
        ['Raised by', 'Warden', report.warden_initiated],
        ['Raised by', 'Office', report.office_initiated],
        ...countRows('Kind', report.by_kind),
        ...countRows('Status', report.by_status),
        ['Now', 'Open', report.open_now],
        ['Now', 'Out', report.out_now],
        ['Late returns', 'Count', late.count],
        ['Late returns', 'Average late minutes', late.average_late_minutes],
        ['Late returns', 'Longest late minutes', late.max_late_minutes],
      ],
    },
    {
      name: 'Late residents',
      headers: [...STUDENT_HEADERS, 'Hostel', 'Late returns', 'Total late minutes', 'Longest late minutes'],
      rows: late.residents.map((row) => [
        ...studentCells(row.student),
        row.hostel_name,
        row.late_returns,
        row.total_late_minutes,
        row.max_late_minutes,
      ]),
    },
  ];
}

export function feesSheets(report: FeesReportDto): ReportSheet[] {
  const deposits = report.deposits;
  return [
    {
      name: 'Hostels',
      headers: ['Hostel', 'Residents billed', 'Billed', 'Collected', 'Outstanding', 'Collected %', 'With dues'],
      rows: [
        ...report.hostels.map((row) => [
          row.hostel_name,
          row.residents_billed,
          row.billed,
          row.collected,
          row.outstanding,
          row.collection_percent,
          row.residents_with_dues,
        ]),
        [
          'All hostels',
          null,
          report.totals.billed,
          report.totals.collected,
          report.totals.outstanding,
          report.totals.collection_percent,
          report.totals.residents_with_dues,
        ],
      ],
      boldRows: [report.hostels.length],
    },
    {
      name: 'Deposits',
      headers: ['Item', 'Amount', 'Count'],
      rows: [
        ['Billed', deposits.billed, null],
        ['Held', deposits.held, deposits.held_count],
        ['Settled', deposits.settled, deposits.settled_count],
        ['Deductions', deposits.deductions, null],
        ['Refunded', deposits.refunded, null],
        ['Unpaid', deposits.unpaid, null],
      ],
    },
    {
      name: 'Top dues',
      headers: [...STUDENT_HEADERS, 'Hostel', 'Admission status', 'Billed', 'Paid', 'Balance'],
      rows: report.top_dues.map((row) => [
        ...studentCells(row.student),
        row.hostel_name,
        labelOf(row.admission_status),
        row.billed,
        row.paid,
        row.balance,
      ]),
    },
  ];
}

export function disciplineSheets(report: DisciplineReportDto): ReportSheet[] {
  return [
    {
      name: 'Summary',
      headers: ['Group', 'Item', 'Count'],
      rows: [
        ['Total', 'Cases', report.total],
        ['Total', 'Open', report.open],
        ...countRows('Category', report.by_category),
        ...countRows('Severity', report.by_severity),
        ...countRows('Status', report.by_status),
        ...countRows('Action', report.actions),
      ],
    },
    {
      name: 'By month',
      headers: ['Month', 'Cases'],
      rows: report.by_month.map((row) => [row.key, row.count]),
    },
    {
      name: 'Fines',
      headers: ['Fee fine status', 'Cases', 'Amount'],
      rows: [
        ...report.fines.by_status.map((row) => [labelOf(row.key), row.count, row.amount]),
        ['All fines', report.fines.count, report.fines.amount],
      ],
      boldRows: [report.fines.by_status.length],
    },
    {
      name: 'Repeat residents',
      headers: [...STUDENT_HEADERS, 'Hostel', 'Cases', 'Major or critical', 'Last incident', 'Categories'],
      rows: report.repeat_residents.map((row) => [
        ...studentCells(row.student),
        row.hostel_name,
        row.cases,
        row.major_or_critical,
        row.last_incident_on,
        row.categories.map(labelOf).join(', '),
      ]),
    },
  ];
}
