import { ACHIEVEMENT_LEVELS } from '../achievements/entities/student-achievement.entity';
import { DashboardSection } from './dashboard.logic';
import {
  YearActivitiesDto,
  YearAttendanceDto,
  YearFeeHeadDto,
  YearFeesDto,
  YearPerformanceDto,
  YearStudentsDto,
  YearStudiesDto,
} from './dto/year-performance.dto';

export interface YearRow {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
}

export type Numeric = string | number | boolean | null;
export type FigureRow = Record<string, Numeric>;
export type ByYear = Map<number, FigureRow>;

export interface YearFigures {
  students: ByYear | null;
  attendance: ByYear | null;
  staff: ByYear | null;
  studies: ByYear | null;
  activities: ByYear | null;
  fees: ByYear | null;
  feeHeads?: Map<number, FigureRow[]> | null;
}

const toNumber = (value: Numeric | undefined) => Number(value ?? 0);

const oneDecimal = (value: Numeric | undefined) =>
  value === null || value === undefined ? null : Math.round(Number(value) * 10) / 10;

export const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

export function byYear(rows: FigureRow[]): ByYear {
  return new Map(rows.map((row) => [Number(row.year_id), row]));
}

export function groupByYear(rows: FigureRow[]): Map<number, FigureRow[]> {
  const groups = new Map<number, FigureRow[]>();
  for (const row of rows) {
    const id = Number(row.year_id);
    groups.set(id, [...(groups.get(id) ?? []), row]);
  }
  return groups;
}

export function topLevel(rank: Numeric | undefined): string | null {
  const index = Number(rank ?? 0);
  return index > 0 ? (ACHIEVEMENT_LEVELS[index - 1] ?? null) : null;
}

function studentsOf(row: FigureRow = {}): YearStudentsDto {
  return { enrolled: toNumber(row.enrolled), promoted: toNumber(row.promoted), left: toNumber(row.left_school) };
}

function attendanceOf(row: FigureRow = {}, staff: FigureRow = {}): YearAttendanceDto {
  return {
    percent: oneDecimal(row.percent),
    days_marked: toNumber(row.days_marked),
    below_75: toNumber(row.below_75),
    staff_percent: oneDecimal(staff.percent),
  };
}

function studiesOf(row: FigureRow = {}): YearStudiesDto {
  return {
    exams: toNumber(row.exams),
    students: toNumber(row.students),
    average_percent: oneDecimal(row.average_percent),
    pass_percent: oneDecimal(row.pass_percent),
    fail_percent: oneDecimal(row.fail_percent),
    absent_percent: oneDecimal(row.absent_percent),
  };
}

function activitiesOf(row: FigureRow = {}): YearActivitiesDto {
  return {
    total: toNumber(row.total),
    sports: toNumber(row.sports),
    podium: toNumber(row.podium),
    students: toNumber(row.students),
    points: toNumber(row.points),
    top_level: topLevel(row.top_rank),
  };
}

function feeHeadOf(row: FigureRow): YearFeeHeadDto {
  const billed = Math.round(toNumber(row.billed));
  const collected = Math.round(toNumber(row.collected));
  return {
    name: String(row.name),
    is_transport: Boolean(row.is_transport),
    billed,
    collected,
    collection_percent: share(collected, billed),
  };
}

function feesOf(row: FigureRow = {}, heads: FigureRow[] = []): YearFeesDto {
  const billed = toNumber(row.billed);
  const collected = toNumber(row.collected);
  return {
    billed,
    collected,
    collection_percent: share(collected, billed),
    heads: heads.map(feeHeadOf).sort((a, b) => b.billed - a.billed || a.name.localeCompare(b.name)),
  };
}

const figure = <T>(allowed: boolean, rows: ByYear | null, build: (rows: ByYear) => T): T | null =>
  allowed && rows ? build(rows) : null;

export function yearPerformance(
  years: YearRow[],
  figures: YearFigures,
  show: Record<DashboardSection, boolean>,
): YearPerformanceDto[] {
  return years.map((year) => {
    const id = Number(year.id);
    return {
      academic_year: { ...year, id },
      students: figure(show.students, figures.students, (rows) => studentsOf(rows.get(id))),
      attendance: figure(show.attendance, figures.attendance, (rows) =>
        attendanceOf(rows.get(id), figures.staff?.get(id)),
      ),
      studies: figure(show.exams, figures.studies, (rows) => studiesOf(rows.get(id))),
      activities: figure(show.students, figures.activities, (rows) => activitiesOf(rows.get(id))),
      fees: figure(show.fees, figures.fees, (rows) => feesOf(rows.get(id), figures.feeHeads?.get(id))),
    };
  });
}
