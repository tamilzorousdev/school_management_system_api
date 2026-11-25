import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { IsDateOnly } from '../../../shared/dates';
import { HostelStudentDto } from './hostel-admission.dto';

export class HostelReportQueryDto {
  @ApiPropertyOptional({ example: 1, description: 'Limit the report to one hostel' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  hostel_id?: number;

  @IsDateOnly('2026-10-27', true)
  from?: string;

  @IsDateOnly('2026-11-25', true)
  to?: string;

  @ApiPropertyOptional({ example: 10, default: 10, minimum: 1, maximum: 50, description: 'Rows in the top lists' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  top?: number;
}

export class ReportPeriodDto {
  @ApiProperty({ example: '2026-10-27' }) from: string;
  @ApiProperty({ example: '2026-11-25' }) to: string;
  @ApiProperty({ example: 30 }) days: number;
}

export class ReportCountDto {
  @ApiProperty({ example: 'outing' }) key: string;
  @ApiProperty({ example: 42 }) count: number;
}

export class ReportAmountDto {
  @ApiProperty({ example: 'approved' }) key: string;
  @ApiProperty({ example: 4 }) count: number;
  @ApiProperty({ example: 2000 }) amount: number;
}

export class OccupancyCountsDto {
  @ApiProperty({ example: 40 }) rooms: number;
  @ApiProperty({ example: 160 }) beds: number;
  @ApiProperty({ example: 138 }) occupied: number;
  @ApiProperty({ example: 16 }) vacant: number;
  @ApiProperty({ example: 2 }) reserved: number;
  @ApiProperty({ example: 1 }) blocked: number;
  @ApiProperty({ example: 3 }) maintenance: number;
  @ApiProperty({ example: 86.3, nullable: true, type: Number }) occupancy_percent: number | null;
}

export class OccupancyBlockDto extends OccupancyCountsDto {
  @ApiProperty({ example: 2, nullable: true, type: Number }) block_id: number | null;
  @ApiProperty({ example: 'A Block', nullable: true, type: String }) block_name: string | null;
}

export class OccupancyHostelDto extends OccupancyCountsDto {
  @ApiProperty({ example: 1 }) hostel_id: number;
  @ApiProperty({ example: 'Boys Hostel' }) hostel_name: string;
  @ApiProperty({ type: [OccupancyBlockDto] }) blocks: OccupancyBlockDto[];
}

export class OccupancyRoomTypeDto {
  @ApiProperty({ example: 3 }) room_type_id: number;
  @ApiProperty({ example: '4-sharing non-AC' }) room_type_name: string;
  @ApiProperty({ example: 20 }) rooms: number;
  @ApiProperty({ example: 80 }) beds: number;
  @ApiProperty({ example: 72 }) occupied: number;
  @ApiProperty({ example: 90, nullable: true, type: Number }) occupancy_percent: number | null;
}

export class OccupancyReportDto {
  @ApiProperty({ example: '2026-11-25', description: 'Current snapshot; from and to are ignored' }) as_of: string;
  @ApiProperty({ type: OccupancyCountsDto }) totals: OccupancyCountsDto;
  @ApiProperty({ type: [OccupancyHostelDto] }) hostels: OccupancyHostelDto[];
  @ApiProperty({ type: [OccupancyRoomTypeDto] }) room_types: OccupancyRoomTypeDto[];
}

export class AttendanceCountsDto {
  @ApiProperty({ example: 1200 }) total: number;
  @ApiProperty({ example: 1100 }) present: number;
  @ApiProperty({ example: 30 }) late: number;
  @ApiProperty({ example: 20 }) absent: number;
  @ApiProperty({ example: 40, description: 'On leave or on an outing' }) away: number;
  @ApiProperty({ example: 10 }) sick: number;
  @ApiProperty({
    example: 98.3,
    nullable: true,
    type: Number,
    description: '(present + late) / (present + late + absent); away and sick left out',
  })
  present_percent: number | null;
}

export class AttendanceSlotDto extends AttendanceCountsDto {
  @ApiProperty({ example: 'night', enum: ['morning', 'evening', 'night'] }) slot: string;
}

export class AttendanceDayDto {
  @ApiProperty({ example: '2026-11-24' }) date: string;
  @ApiProperty({ example: 3 }) roll_calls: number;
  @ApiProperty({ example: 420 }) present: number;
  @ApiProperty({ example: 6 }) absent: number;
  @ApiProperty({ example: 98.6, nullable: true, type: Number }) present_percent: number | null;
}

export class AttendanceResidentDto {
  @ApiProperty({ example: 52 }) admission_id: number;
  @ApiProperty({ type: HostelStudentDto }) student: HostelStudentDto;
  @ApiProperty({ example: 'Boys Hostel' }) hostel_name: string;
  @ApiProperty({ example: 5 }) absent: number;
  @ApiProperty({ example: 3 }) late: number;
  @ApiProperty({ example: 84 }) marked: number;
}

export class AttendanceReportDto {
  @ApiProperty({ type: ReportPeriodDto }) period: ReportPeriodDto;
  @ApiProperty({ type: AttendanceCountsDto }) totals: AttendanceCountsDto;
  @ApiProperty({ type: [AttendanceSlotDto] }) slots: AttendanceSlotDto[];
  @ApiProperty({ type: [AttendanceDayDto], description: 'Days with at least one roll call' }) days: AttendanceDayDto[];
  @ApiProperty({ type: [AttendanceResidentDto] }) top_absentees: AttendanceResidentDto[];
}

export class LateResidentDto {
  @ApiProperty({ example: 52 }) admission_id: number;
  @ApiProperty({ type: HostelStudentDto }) student: HostelStudentDto;
  @ApiProperty({ example: 'Boys Hostel' }) hostel_name: string;
  @ApiProperty({ example: 3 }) late_returns: number;
  @ApiProperty({ example: 95 }) total_late_minutes: number;
  @ApiProperty({ example: 50 }) max_late_minutes: number;
}

export class LateReturnsDto {
  @ApiProperty({ example: 9, description: 'Returns in the period that were late' }) count: number;
  @ApiProperty({ example: 37.5, nullable: true, type: Number }) average_late_minutes: number | null;
  @ApiProperty({ example: 140, nullable: true, type: Number }) max_late_minutes: number | null;
  @ApiProperty({ type: [LateResidentDto] }) residents: LateResidentDto[];
}

export class LeavesReportDto {
  @ApiProperty({ type: ReportPeriodDto }) period: ReportPeriodDto;
  @ApiProperty({ example: 64, description: 'Leaves and outings starting in the period' }) total: number;
  @ApiProperty({ example: 40 }) outings: number;
  @ApiProperty({ example: 24, description: 'Home, medical, festival and other leaves' }) overnight_leaves: number;
  @ApiProperty({ example: 30 }) parent_initiated: number;
  @ApiProperty({ example: 28 }) warden_initiated: number;
  @ApiProperty({ example: 6 }) office_initiated: number;
  @ApiProperty({ type: [ReportCountDto] }) by_kind: ReportCountDto[];
  @ApiProperty({ type: [ReportCountDto] }) by_status: ReportCountDto[];
  @ApiProperty({ type: [ReportCountDto] }) by_source: ReportCountDto[];
  @ApiProperty({ example: 5, description: 'Open right now (awaiting parent, pending, approved or out)' })
  open_now: number;
  @ApiProperty({ example: 3, description: 'Residents out right now' }) out_now: number;
  @ApiProperty({ type: LateReturnsDto }) late_returns: LateReturnsDto;
}

export class VisitDayDto {
  @ApiProperty({ example: '2026-11-23' }) date: string;
  @ApiProperty({ example: 12 }) visits: number;
  @ApiProperty({ example: 19 }) people: number;
  @ApiProperty({ example: 1 }) denied: number;
}

export class VisitorsReportDto {
  @ApiProperty({ type: ReportPeriodDto }) period: ReportPeriodDto;
  @ApiProperty({ example: 120 }) visits: number;
  @ApiProperty({ example: 190 }) people: number;
  @ApiProperty({ example: 4 }) denied: number;
  @ApiProperty({ example: 11, description: 'Visitors not on the approved visitor list' }) unknown_visitors: number;
  @ApiProperty({ example: 2, description: 'Visitors inside right now' }) inside_now: number;
  @ApiProperty({ example: 42.5, nullable: true, type: Number }) average_visit_minutes: number | null;
  @ApiProperty({ type: [ReportCountDto] }) by_relation: ReportCountDto[];
  @ApiProperty({ type: [VisitDayDto], description: 'Every day of the period' }) by_day: VisitDayDto[];
}

export class FeesTotalsDto {
  @ApiProperty({ example: 1800000 }) billed: number;
  @ApiProperty({ example: 1500000 }) collected: number;
  @ApiProperty({ example: 300000 }) outstanding: number;
  @ApiProperty({ example: 83.3, nullable: true, type: Number }) collection_percent: number | null;
  @ApiProperty({ example: 14 }) residents_with_dues: number;
}

export class FeesHostelDto extends FeesTotalsDto {
  @ApiProperty({ example: 1 }) hostel_id: number;
  @ApiProperty({ example: 'Boys Hostel' }) hostel_name: string;
  @ApiProperty({ example: 120 }) residents_billed: number;
}

export class FeesDepositsDto {
  @ApiProperty({ example: 600000 }) billed: number;
  @ApiProperty({ example: 400000, description: 'Paid and not settled yet' }) held: number;
  @ApiProperty({ example: 80 }) held_count: number;
  @ApiProperty({ example: 150000, description: 'Paid and settled at checkout' }) settled: number;
  @ApiProperty({ example: 30 }) settled_count: number;
  @ApiProperty({ example: 12000 }) deductions: number;
  @ApiProperty({ example: 138000 }) refunded: number;
  @ApiProperty({ example: 50000 }) unpaid: number;
}

export class FeesDueResidentDto {
  @ApiProperty({ example: 52 }) admission_id: number;
  @ApiProperty({ type: HostelStudentDto }) student: HostelStudentDto;
  @ApiProperty({ example: 'Boys Hostel' }) hostel_name: string;
  @ApiProperty({ example: 'checked_out' }) admission_status: string;
  @ApiProperty({ example: 45000 }) billed: number;
  @ApiProperty({ example: 15000 }) paid: number;
  @ApiProperty({ example: 30000 }) balance: number;
}

export class FeesReportDto {
  @ApiProperty({ example: '2026-27', nullable: true, type: String, description: 'Academic year being viewed' })
  academic_year: string | null;
  @ApiProperty({ type: FeesTotalsDto, description: 'Rent only' }) totals: FeesTotalsDto;
  @ApiProperty({ type: [FeesHostelDto] }) hostels: FeesHostelDto[];
  @ApiProperty({ type: FeesDepositsDto }) deposits: FeesDepositsDto;
  @ApiProperty({ type: [FeesDueResidentDto] }) top_dues: FeesDueResidentDto[];
}

export class FinesSummaryDto {
  @ApiProperty({ example: 6 }) count: number;
  @ApiProperty({ example: 3000 }) amount: number;
  @ApiProperty({
    type: [ReportAmountDto],
    description: 'By fee fine status (pending, approved, rejected, withdrawn); not_raised when no fee fine exists',
  })
  by_status: ReportAmountDto[];
}

export class RepeatResidentDto {
  @ApiProperty({ example: 52 }) admission_id: number;
  @ApiProperty({ type: HostelStudentDto }) student: HostelStudentDto;
  @ApiProperty({ example: 'Boys Hostel' }) hostel_name: string;
  @ApiProperty({ example: 4 }) cases: number;
  @ApiProperty({ example: 1 }) major_or_critical: number;
  @ApiProperty({ example: '2026-11-20' }) last_incident_on: string;
  @ApiProperty({ example: ['late_return', 'curfew'], type: [String] }) categories: string[];
}

export class DisciplineReportDto {
  @ApiProperty({ type: ReportPeriodDto }) period: ReportPeriodDto;
  @ApiProperty({ example: 18, description: 'Cases with the incident in the period, withdrawn left out' }) total: number;
  @ApiProperty({ example: 4 }) open: number;
  @ApiProperty({ type: [ReportCountDto] }) by_category: ReportCountDto[];
  @ApiProperty({ type: [ReportCountDto] }) by_severity: ReportCountDto[];
  @ApiProperty({ type: [ReportCountDto], description: 'Withdrawn included' }) by_status: ReportCountDto[];
  @ApiProperty({ type: [ReportCountDto], description: 'key is YYYY-MM; every month of the period' })
  by_month: ReportCountDto[];
  @ApiProperty({ type: [ReportCountDto] }) actions: ReportCountDto[];
  @ApiProperty({ type: FinesSummaryDto }) fines: FinesSummaryDto;
  @ApiProperty({ type: [RepeatResidentDto], description: 'Residents with 3 or more cases in the period' })
  repeat_residents: RepeatResidentDto[];
}

export class ComplaintsSummaryDto {
  @ApiProperty({ example: 40 }) total: number;
  @ApiProperty({ example: 7, description: 'Of these, still open or in progress' }) open: number;
  @ApiProperty({ example: 30 }) resolved: number;
  @ApiProperty({ type: [ReportCountDto] }) by_category: ReportCountDto[];
  @ApiProperty({ type: [ReportCountDto] }) by_status: ReportCountDto[];
  @ApiProperty({ example: 20.4, nullable: true, type: Number }) average_resolution_hours: number | null;
  @ApiProperty({ example: 86.7, nullable: true, type: Number, description: 'Resolved before due_at' })
  sla_met_percent: number | null;
  @ApiProperty({ example: 4.1, nullable: true, type: Number }) average_rating: number | null;
  @ApiProperty({ example: 18 }) rated: number;
}

export class MaintenanceSummaryDto {
  @ApiProperty({ example: 25 }) total: number;
  @ApiProperty({ example: 6, description: 'Of these, not done or cancelled' }) open: number;
  @ApiProperty({ example: 17 }) done: number;
  @ApiProperty({ type: [ReportCountDto] }) by_category: ReportCountDto[];
  @ApiProperty({ type: [ReportCountDto] }) by_status: ReportCountDto[];
  @ApiProperty({ example: 18450 }) total_cost: number;
  @ApiProperty({ example: 2.3, nullable: true, type: Number }) average_days_to_done: number | null;
  @ApiProperty({ example: 2, description: 'Rooms closed for maintenance right now' }) rooms_blocked_now: number;
}

export class ComplaintsReportDto {
  @ApiProperty({ type: ReportPeriodDto }) period: ReportPeriodDto;
  @ApiProperty({ type: ComplaintsSummaryDto }) complaints: ComplaintsSummaryDto;
  @ApiProperty({ type: MaintenanceSummaryDto }) maintenance: MaintenanceSummaryDto;
}

export class MessMealDto {
  @ApiProperty({ example: 'lunch', enum: ['breakfast', 'lunch', 'snacks', 'dinner'] }) meal: string;
  @ApiProperty({ example: 3300 }) ate: number;
  @ApiProperty({ example: 120 }) skipped: number;
  @ApiProperty({ example: 96.5, nullable: true, type: Number }) ate_percent: number | null;
  @ApiProperty({ example: 14, description: 'Skip requests in the period covering this meal' }) skip_requests: number;
  @ApiProperty({ example: 60 }) feedback_count: number;
  @ApiProperty({ example: 3.8, nullable: true, type: Number }) feedback_average: number | null;
}

export class MessReportDto {
  @ApiProperty({ type: ReportPeriodDto }) period: ReportPeriodDto;
  @ApiProperty({ type: [MessMealDto] }) meals: MessMealDto[];
  @ApiProperty({ example: 12800 }) ate: number;
  @ApiProperty({ example: 450 }) skipped: number;
  @ApiProperty({ example: 210 }) feedback_count: number;
  @ApiProperty({ example: 3.9, nullable: true, type: Number }) feedback_average: number | null;
  @ApiProperty({ example: 22, description: 'Meal skip requests overlapping the period, cancelled left out' })
  meal_skips: number;
  @ApiProperty({ type: [ReportCountDto] }) meal_skips_by_source: ReportCountDto[];
}

export class DosesSummaryDto {
  @ApiProperty({ example: 140 }) given: number;
  @ApiProperty({ example: 4 }) missed: number;
  @ApiProperty({ example: 1 }) refused: number;
  @ApiProperty({ example: 96.6, nullable: true, type: Number }) given_percent: number | null;
}

export class HealthReportDto {
  @ApiProperty({ type: ReportPeriodDto }) period: ReportPeriodDto;
  @ApiProperty({ example: 35 }) total_logs: number;
  @ApiProperty({ type: [ReportCountDto] }) by_kind: ReportCountDto[];
  @ApiProperty({ example: 3 }) hospital_visits: number;
  @ApiProperty({ example: 9, description: 'Sick bay stays that started in the period' }) sick_bay_admissions: number;
  @ApiProperty({ example: 18.5, nullable: true, type: Number, description: 'Finished stays only' })
  average_sick_bay_hours: number | null;
  @ApiProperty({ example: 1, description: 'In the sick bay right now' }) sick_bay_now: number;
  @ApiProperty({ type: DosesSummaryDto }) doses: DosesSummaryDto;
}

export class SummaryReportDto {
  @ApiProperty({ type: ReportPeriodDto }) period: ReportPeriodDto;
  @ApiProperty({ example: 138, description: 'Residents with a live admission now' }) residents: number;
  @ApiProperty({ example: 160 }) beds: number;
  @ApiProperty({ example: 138 }) occupied_beds: number;
  @ApiProperty({ example: 86.3, nullable: true, type: Number }) occupancy_percent: number | null;
  @ApiProperty({ example: 97.8, nullable: true, type: Number, description: 'Roll call in the period' })
  attendance_percent: number | null;
  @ApiProperty({ example: 5, description: 'Now' }) open_leaves: number;
  @ApiProperty({ example: 3, description: 'Now' }) out_now: number;
  @ApiProperty({ example: 9, description: 'In the period' }) late_returns: number;
  @ApiProperty({ example: 300000, description: 'Rent balance, academic year being viewed' })
  outstanding_fees: number;
  @ApiProperty({ example: 14 }) residents_with_dues: number;
  @ApiProperty({ example: 7, description: 'Now' }) open_complaints: number;
  @ApiProperty({ example: 6, description: 'Now' }) open_tickets: number;
  @ApiProperty({ example: 18, description: 'Incidents in the period, withdrawn left out' }) discipline_cases: number;
  @ApiProperty({ example: 1, description: 'Now' }) sick_bay_now: number;
  @ApiProperty({ example: 2, description: 'Now' }) visitors_inside: number;
}
