import { StreamableFile } from '@nestjs/common';
import ExcelJS from 'exceljs';
import {
  CostRowDto,
  DueReportDto,
  IdleRowDto,
  MileageRowDto,
  ReimbursementRowDto,
  SpendRowDto,
  VehicleLogEntryDto,
} from './dto/fleet-maintenance.dto';

export const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF159053' } };

type Cell = string | number | null;

export interface Table {
  sheet: string;
  title: string;
  subtitle: string;
  headers: string[];
  widths: number[];
  rows: Cell[][];
}

export async function workbook(name: string, tables: Table[]): Promise<StreamableFile> {
  const book = new ExcelJS.Workbook();
  for (const table of tables) {
    const ws = book.addWorksheet(table.sheet);
    ws.addRow([table.title]).font = { bold: true, size: 14 };
    ws.addRow([table.subtitle]).font = { color: { argb: 'FF5A6A62' } };
    ws.addRow([]);
    const head = ws.addRow(table.headers);
    head.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = HEADER_FILL;
    });
    ws.views = [{ state: 'frozen', ySplit: 4 }];
    for (const row of table.rows) ws.addRow(row);
    table.widths.forEach((width, index) => (ws.getColumn(index + 1).width = width));
  }
  const buffer = Buffer.from(await book.xlsx.writeBuffer());
  return new StreamableFile(buffer, {
    type: XLSX,
    length: buffer.length,
    disposition: `attachment; filename="${encodeURIComponent(name.replace(/[^\w.-]+/g, '-'))}.xlsx"`,
  });
}

const bus = (row: { vehicle: { name: string; registration_no: string } }) =>
  `${row.vehicle.name} (${row.vehicle.registration_no})`;

export function costsTable(rows: CostRowDto[], range: string): Table {
  return {
    sheet: 'Cost per bus',
    title: 'Cost per bus',
    subtitle: range,
    headers: [
      'Bus',
      'Month',
      'Fuel',
      'Service',
      'Repair',
      'Other',
      'Total',
      'km',
      'Cost per km',
      'Cost per seat',
      'Budget',
      'Over budget',
    ],
    widths: [26, 10, 12, 12, 12, 12, 12, 10, 12, 13, 12, 12],
    rows: rows.map((row) => [
      bus(row),
      row.month,
      row.fuel,
      row.service,
      row.repair,
      row.other,
      row.total,
      row.km,
      row.cost_per_km,
      row.cost_per_seat,
      row.budget,
      row.over_budget ? 'Yes' : '',
    ]),
  };
}

export function mileageTable(rows: MileageRowDto[], range: string): Table {
  return {
    sheet: 'Mileage',
    title: 'Mileage trend (km per litre)',
    subtitle: range,
    headers: ['Bus', 'Month', 'Litres', 'km', 'km per litre', 'Normal', 'Low'],
    widths: [26, 10, 10, 10, 12, 10, 8],
    rows: rows.map((row) => [
      bus(row),
      row.month,
      row.litres,
      row.km,
      row.km_per_litre,
      row.normal,
      row.low ? 'Low' : '',
    ]),
  };
}

export function dueTables(report: DueReportDto, today: string): Table[] {
  return [
    {
      sheet: 'Services due',
      title: 'Services due soon or overdue',
      subtitle: `As on ${today}`,
      headers: ['Bus', 'Service', 'Status', 'Due on', 'Days left', 'Due at km', 'km left', 'Last done'],
      widths: [26, 30, 10, 12, 10, 12, 10, 12],
      rows: report.services.map((row) => [
        bus(row),
        row.title,
        row.status === 'overdue' ? 'Overdue' : 'Due soon',
        row.next_due_on,
        row.days_left,
        row.next_due_km,
        row.km_left,
        row.last_done_on,
      ]),
    },
    {
      sheet: 'Documents',
      title: 'Documents expired or expiring in 30 days',
      subtitle: `As on ${today}`,
      headers: ['Bus', 'Document', 'Expiry', 'Days left'],
      widths: [26, 20, 12, 10],
      rows: report.documents.map((row) => [bus(row), row.kind.replace(/_/g, ' '), row.expiry, row.days_left]),
    },
  ];
}

export function spendTable(rows: SpendRowDto[], range: string, group: string): Table {
  return {
    sheet: 'Spend',
    title: group === 'vendor' ? 'Spend by garage and fuel station' : 'Spend by category',
    subtitle: range,
    headers: [group === 'vendor' ? 'Paid to' : 'Category', 'Entries', 'Amount'],
    widths: [34, 10, 14],
    rows: rows.map((row) => [row.label, row.entries, row.amount]),
  };
}

export function idleTable(rows: IdleRowDto[], range: string, litresPerHour: number): Table {
  return {
    sheet: 'Idle fuel',
    title: 'Fuel lost to engine idling (estimate)',
    subtitle: `${range} · ${litresPerHour} L an hour of idling`,
    headers: ['Bus', 'Idle alerts', 'Minutes', 'Litres', 'Amount'],
    widths: [26, 12, 10, 10, 12],
    rows: rows.map((row) => [bus(row), row.alerts, row.minutes, row.litres, row.amount]),
  };
}

export function reimbursementTable(rows: ReimbursementRowDto[], today: string): Table {
  return {
    sheet: 'To pay back',
    title: 'Paid by drivers, not yet paid back',
    subtitle: `As on ${today}`,
    headers: ['Date', 'Bus', 'For', 'Paid by', 'Amount'],
    widths: [12, 26, 24, 22, 12],
    rows: rows.map((row) => [row.on, bus(row), row.title, row.paid_by?.name ?? '', row.amount]),
  };
}

export function logTable(rows: VehicleLogEntryDto[], busName: string, range: string): Table {
  return {
    sheet: 'Bus log',
    title: `Log of ${busName}`,
    subtitle: range,
    headers: ['Date', 'Type', 'What', 'Details', 'Odometer km', 'Amount', 'Status'],
    widths: [12, 10, 40, 40, 12, 12, 12],
    rows: rows.map((row) => [row.on, row.type, row.title, row.detail, row.odometer_km, row.amount, row.status]),
  };
}
