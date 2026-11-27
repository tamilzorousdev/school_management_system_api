import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ListQueryDto } from '@app/common';
import { IdentityDto } from '../../../shared/identity';
import { SCHOOL_BOARDS, SchoolBoard } from '../../schools/entities/school.entity';
import { TeachersTodayDto } from './office-teachers.dto';
import { BusesTodayDto, StudentBusTodayDto } from './office-bus.dto';

export class IdNameDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ example: 'Primary' })
  name: string;
}

export class OfficeMeDto {
  @ApiProperty({ example: true, description: 'True for a wing AO: everything is limited to their wings' })
  is_limited: boolean;

  @ApiProperty({ example: false, description: 'AO with no wing (sees the whole school and the AO monitor)' })
  is_head_ao: boolean;

  @ApiProperty({ example: false, description: 'Can open the AO monitor' })
  can_monitor: boolean;

  @ApiProperty({ type: [IdNameDto], description: 'Wings this user sees' })
  wings: IdNameDto[];

  @ApiProperty({ example: '2026-11-23' })
  today: string;
}

export class AttendanceTodayDto {
  @ApiProperty({ example: 12 })
  sections_marked: number;

  @ApiProperty({ example: 14 })
  sections_total: number;

  @ApiProperty({ example: 480 })
  present: number;

  @ApiProperty({ example: 20 })
  absent: number;

  @ApiProperty({ example: 96, nullable: true, type: Number, description: 'Present out of marked, %' })
  percent: number | null;
}

class CountsBlockDto {
  @ApiProperty({ example: 10 })
  class_count: number;

  @ApiProperty({ example: 28 })
  section_count: number;

  @ApiProperty({ example: 520 })
  student_count: number;

  @ApiProperty({ example: 260 })
  boys: number;

  @ApiProperty({ example: 260 })
  girls: number;

  @ApiProperty({ type: AttendanceTodayDto })
  attendance: AttendanceTodayDto;

  @ApiProperty({ example: 320000, description: 'Fee balance due this year, ₹' })
  fee_due: number;

  @ApiProperty({ example: 2, description: 'Gate passes still waiting' })
  pending_gate_passes: number;
}

export class WingCardDto extends CountsBlockDto {
  @ApiProperty({ example: 2 })
  id: number;

  @ApiProperty({ example: 'Primary' })
  name: string;

  @ApiProperty({ example: 'Classes 1 – 5' })
  range_label: string;

  @ApiProperty({ enum: SCHOOL_BOARDS, nullable: true, example: null })
  board: SchoolBoard | null;

  @ApiProperty({ type: [IdNameDto], description: 'AOs looking after this wing today' })
  aos: IdNameDto[];
}

export class OfficeWingsDto {
  @ApiProperty({ type: [WingCardDto] })
  wings: WingCardDto[];

  @ApiProperty({ type: [IdNameDto], description: 'Classes in no wing (only for the head AO and admin)' })
  unassigned_classes: IdNameDto[];
}

export class ClassCardDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'LKG' })
  name: string;

  @ApiProperty({ example: -1 })
  grade_level: number;

  @ApiProperty({ example: 2 })
  section_count: number;

  @ApiProperty({ example: 48 })
  student_count: number;

  @ApiProperty({ example: 25 })
  boys: number;

  @ApiProperty({ example: 23 })
  girls: number;

  @ApiProperty({ example: ['Anitha R', 'Bala S'] })
  class_teachers: string[];

  @ApiProperty({ type: AttendanceTodayDto })
  attendance: AttendanceTodayDto;

  @ApiProperty({ example: 42000 })
  fee_due: number;

  @ApiProperty({ example: 0 })
  pending_gate_passes: number;

  @ApiProperty({ example: 78.4, nullable: true, type: Number, description: 'Average % in the latest published exam' })
  last_exam_average: number | null;
}

export class WingClassesDto {
  @ApiProperty({ type: IdNameDto })
  wing: IdNameDto;

  @ApiProperty({ type: [ClassCardDto] })
  classes: ClassCardDto[];
}

export class TopperDto {
  @ApiProperty({ example: 41 })
  student_id: number;

  @ApiProperty({ example: 'Kavin S' })
  name: string;

  @ApiProperty({ example: 96.5 })
  percent: number;

  @ApiProperty({ example: 1 })
  rank: number;
}

export class SectionCardDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ example: 'A' })
  name: string;

  @ApiProperty({ example: 'LKG - A' })
  class_section: string;

  @ApiProperty({ type: IdNameDto, nullable: true })
  class_teacher: IdNameDto | null;

  @ApiProperty({ example: 24 })
  student_count: number;

  @ApiProperty({ example: 12 })
  boys: number;

  @ApiProperty({ example: 12 })
  girls: number;

  @ApiProperty({ type: AttendanceTodayDto })
  attendance: AttendanceTodayDto;

  @ApiProperty({ example: 3, description: 'Students with a fee balance due' })
  fee_defaulters: number;

  @ApiProperty({ example: 21000 })
  fee_due: number;

  @ApiProperty({ example: 0 })
  pending_gate_passes: number;

  @ApiProperty({ type: IdNameDto, nullable: true, description: 'Latest published exam' })
  last_exam: IdNameDto | null;

  @ApiProperty({ example: 81.2, nullable: true, type: Number })
  last_exam_average: number | null;

  @ApiProperty({ type: [TopperDto] })
  toppers: TopperDto[];
}

export class ClassSectionsDto {
  @ApiProperty({ type: IdNameDto })
  class: IdNameDto;

  @ApiProperty({ type: IdNameDto, nullable: true })
  wing: IdNameDto | null;

  @ApiProperty({ type: [SectionCardDto] })
  sections: SectionCardDto[];
}

export const SECTION_STUDENT_FILTERS = ['all', 'absent_today', 'fee_due', 'low_attendance'] as const;
export type SectionStudentFilter = (typeof SECTION_STUDENT_FILTERS)[number];

export class SectionStudentsQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: SECTION_STUDENT_FILTERS, example: 'all' })
  @IsOptional()
  @IsIn(SECTION_STUDENT_FILTERS)
  filter?: SectionStudentFilter;
}

export class TransportRefDto {
  @ApiProperty({ example: 'Route 2 · Anna Nagar' })
  route: string;

  @ApiProperty({ example: 'Anna Nagar Roundtana', nullable: true, type: String })
  stop: string | null;

  @ApiProperty({ example: 'active', nullable: true, type: String })
  pass_status: string | null;
}

export class SectionStudentDto {
  @ApiProperty({ example: 41 })
  id: number;

  @ApiProperty({ example: 'Kavin S' })
  name: string;

  @ApiProperty({ example: 'TZMS-2026-0041' })
  admission_no: string;

  @ApiProperty({ example: 7, nullable: true, type: Number })
  roll_no: number | null;

  @ApiProperty({ example: 'male', nullable: true, type: String })
  gender: string | null;

  @ApiProperty({ example: 'https://…/files/31/content?variant=thumb…', nullable: true, type: String })
  photo_url: string | null;

  @ApiProperty({
    example: 'present',
    nullable: true,
    type: String,
    description: 'Today: present, absent, late, half_day, leave, od; null when not marked',
  })
  today: string | null;

  @ApiProperty({ example: 94.2, nullable: true, type: Number, description: 'This year, %' })
  attendance_percent: number | null;

  @ApiProperty({ example: 12500 })
  fee_due: number;

  @ApiProperty({ example: 'due', enum: ['paid', 'due', 'none'] })
  fee_status: 'paid' | 'due' | 'none';

  @ApiProperty({ example: 88.5, nullable: true, type: Number })
  last_exam_percent: number | null;

  @ApiProperty({ example: 3, nullable: true, type: Number, description: 'Section rank in the latest exam' })
  rank: number | null;

  @ApiProperty({ type: TransportRefDto, nullable: true })
  transport: TransportRefDto | null;

  @ApiProperty({
    example: ['fee_due', 'health_alert'],
    description: 'fee_due, low_attendance, health_alert, pass_on_hold',
  })
  flags: string[];
}

export class SectionStudentsDto {
  @ApiProperty({ type: SectionCardDto })
  section: SectionCardDto;

  @ApiProperty({ type: [SectionStudentDto] })
  items: SectionStudentDto[];

  @ApiProperty({ example: 24 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 50 })
  limit: number;

  @ApiProperty({ example: 1 })
  total_pages: number;

  @ApiProperty({ example: false })
  has_next: boolean;
}

export class FlagDto {
  @ApiProperty({ example: 'fee_due' })
  code: string;

  @ApiProperty({ example: 'Fee due ₹12,500' })
  label: string;
}

export class GuardianRefDto {
  @ApiProperty({ example: 9 })
  id: number;

  @ApiProperty({ example: 'Senthil K' })
  name: string;

  @ApiProperty({ example: 'father', nullable: true, type: String })
  relation: string | null;

  @ApiProperty({ example: '9000000005', nullable: true, type: String })
  mobile: string | null;

  @ApiProperty({ example: true })
  is_primary: boolean;

  @ApiProperty({ example: true })
  can_pickup: boolean;
}

export class StudentBasicsDto extends IdentityDto {
  @ApiProperty({ example: 41 })
  id: number;

  @ApiProperty({ example: 'Kavin S' })
  name: string;

  @ApiProperty({ example: 'TZMS-2026-0041' })
  admission_no: string;

  @ApiProperty({ nullable: true, type: String })
  photo_url: string | null;

  @ApiProperty({ example: '2019-04-02', nullable: true, type: String })
  dob: string | null;

  @ApiProperty({ example: 'male', nullable: true, type: String })
  gender: string | null;

  @ApiProperty({ example: 'B+', nullable: true, type: String })
  blood_group: string | null;

  @ApiProperty({ example: '2024-06-03', nullable: true, type: String })
  admission_date: string | null;

  @ApiProperty({ example: 'active' })
  status: string;

  @ApiProperty({ example: 'Blue', nullable: true, type: String })
  house: string | null;

  @ApiProperty({ example: '12, Gandhi Street, Chennai 600040', nullable: true, type: String })
  address: string | null;
}

export class CurrentPlacementDto {
  @ApiProperty({ example: '2026-27' })
  academic_year: string;

  @ApiProperty({ example: 1 })
  class_id: number;

  @ApiProperty({ example: 3 })
  section_id: number;

  @ApiProperty({ example: 'LKG - A' })
  class_section: string;

  @ApiProperty({ example: 7, nullable: true, type: Number })
  roll_no: number | null;

  @ApiProperty({ type: IdNameDto, nullable: true })
  class_teacher: IdNameDto | null;

  @ApiProperty({ type: IdNameDto, nullable: true })
  wing: IdNameDto | null;
}

export class AttendanceSummaryDto {
  @ApiProperty({ example: 120 })
  days: number;

  @ApiProperty({ example: 112 })
  present: number;

  @ApiProperty({ example: 4 })
  absent: number;

  @ApiProperty({ example: 2 })
  late: number;

  @ApiProperty({ example: 1 })
  leave: number;

  @ApiProperty({ example: 1 })
  half_day: number;

  @ApiProperty({ example: 95.8, nullable: true, type: Number })
  percent: number | null;
}

export class FeeSummaryDto {
  @ApiProperty({ example: 27500 })
  total: number;

  @ApiProperty({ example: 15000 })
  paid: number;

  @ApiProperty({ example: 12500 })
  balance: number;

  @ApiProperty({ example: 0, description: 'Balance past its due date' })
  overdue: number;

  @ApiProperty({ example: 2 })
  invoices: number;
}

export class ExamLineDto {
  @ApiProperty({ example: 4 })
  exam_id: number;

  @ApiProperty({ example: 'Term 1' })
  exam_name: string;

  @ApiProperty({ example: 412 })
  total: number;

  @ApiProperty({ example: 500 })
  max_total: number;

  @ApiProperty({ example: 82.4, nullable: true, type: Number })
  percent: number | null;

  @ApiProperty({ example: 'A1', nullable: true, type: String })
  grade: string | null;

  @ApiProperty({ example: 'pass', nullable: true, type: String })
  result: string | null;

  @ApiProperty({ example: 3, nullable: true, type: Number })
  section_rank: number | null;

  @ApiProperty({ example: 24 })
  section_size: number;

  @ApiProperty({ example: 5, nullable: true, type: Number })
  class_rank: number | null;

  @ApiProperty({ example: 48 })
  class_size: number;
}

export class YearLineDto {
  @ApiProperty({ example: '2025-26' })
  academic_year: string;

  @ApiProperty({ example: 'UKG - B' })
  class_section: string;

  @ApiProperty({ example: 4, nullable: true, type: Number })
  roll_no: number | null;

  @ApiProperty({ example: 'promoted' })
  status: string;
}

export class StudentCountsDto {
  @ApiProperty({ example: 1 })
  behaviour_notes: number;

  @ApiProperty({ example: 2 })
  achievements: number;

  @ApiProperty({ example: 1 })
  gate_passes: number;

  @ApiProperty({ example: 3 })
  documents: number;

  @ApiProperty({ example: 1 })
  library_books_out: number;

  @ApiProperty({ example: 2 })
  leave_requests: number;
}

export class HealthBriefDto {
  @ApiProperty({ example: 'Peanuts', nullable: true, type: String })
  allergies: string | null;

  @ApiProperty({ example: 'Asthma', nullable: true, type: String })
  conditions: string | null;

  @ApiProperty({ example: 'Inhaler', nullable: true, type: String })
  medications: string | null;

  @ApiProperty({ example: '2026-07-10', nullable: true, type: String })
  last_checkup_on: string | null;
}

export class AchievementLineDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 'Junior Art Fest 2026' })
  title: string;

  @ApiProperty({ example: 'arts', nullable: true, type: String })
  category: string | null;

  @ApiProperty({ example: 'district', nullable: true, type: String })
  level: string | null;

  @ApiProperty({ example: '1st', nullable: true, type: String })
  position: string | null;

  @ApiProperty({ example: '2026-10-20', nullable: true, type: String })
  achieved_on: string | null;
}

export class SportsOdLineDto {
  @ApiProperty({ example: 79 })
  id: number;

  @ApiProperty({ example: 'Football' })
  sport_name: string;

  @ApiProperty({ example: 'Zonal football league' })
  title: string;

  @ApiProperty({ example: '2026-11-20' })
  from_date: string;

  @ApiProperty({ example: '2026-11-21' })
  to_date: string;

  @ApiProperty({ example: null, nullable: true, type: String, description: 'morning, afternoon or null for full day' })
  session: string | null;

  @ApiProperty({ example: 'Jawaharlal Nehru Stadium', nullable: true, type: String })
  venue: string | null;
}

export class OdStudentDto extends SportsOdLineDto {
  @ApiProperty({ example: 519 })
  student_id: number;

  @ApiProperty({ example: 'Arjun Ganesan' })
  name: string;

  @ApiProperty({ example: '8 - A', nullable: true, type: String })
  class_section: string | null;
}

export class OdTodayDto {
  @ApiProperty({ example: 3, description: 'Students on sports OD today' })
  count: number;

  @ApiProperty({ type: [OdStudentDto] })
  students: OdStudentDto[];
}

export class Student360Dto {
  @ApiProperty({ type: StudentBasicsDto })
  student: StudentBasicsDto;

  @ApiProperty({ type: CurrentPlacementDto, nullable: true })
  current: CurrentPlacementDto | null;

  @ApiProperty({ type: [GuardianRefDto] })
  guardians: GuardianRefDto[];

  @ApiProperty({ type: TransportRefDto, nullable: true })
  transport: TransportRefDto | null;

  @ApiProperty({ type: [FlagDto] })
  flags: FlagDto[];

  @ApiProperty({ type: AttendanceSummaryDto })
  attendance: AttendanceSummaryDto;

  @ApiProperty({ type: FeeSummaryDto })
  fees: FeeSummaryDto;

  @ApiProperty({ type: [ExamLineDto], description: 'Published exams, newest first, with section and class rank' })
  exams: ExamLineDto[];

  @ApiProperty({ type: [YearLineDto], description: 'Every year in the school, newest first' })
  years: YearLineDto[];

  @ApiProperty({ type: StudentCountsDto })
  counts: StudentCountsDto;

  @ApiProperty({ type: HealthBriefDto, nullable: true })
  health: HealthBriefDto | null;

  @ApiProperty({ example: '/api/v1/admin/students/41/report-card/pdf', nullable: true, type: String })
  report_card_pdf_path: string | null;

  @ApiProperty({ type: [AchievementLineDto], description: 'Sports and activity achievements, newest first' })
  achievements: AchievementLineDto[];

  @ApiProperty({ type: [SportsOdLineDto], description: 'Sports on-duty (OD) days, newest first' })
  sports_od: SportsOdLineDto[];

  @ApiProperty({
    type: StudentBusTodayDto,
    nullable: true,
    description: 'Today on the school bus; null when no boarding today',
  })
  bus_today: StudentBusTodayDto | null;
}

export const TIMELINE_TYPES = [
  'admission',
  'enrolment',
  'attendance',
  'leave',
  'fee_invoice',
  'fee_payment',
  'exam',
  'gate',
  'behaviour',
  'achievement',
  'transport',
  'document',
  'library',
] as const;
export type TimelineType = (typeof TIMELINE_TYPES)[number];

export class TimelineQueryDto {
  @ApiPropertyOptional({ enum: TIMELINE_TYPES })
  @IsOptional()
  @IsIn(TIMELINE_TYPES)
  type?: TimelineType;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class TimelineItemDto {
  @ApiProperty({ example: '2026-11-20T09:15:00.000+05:30' })
  at: Date;

  @ApiProperty({ enum: TIMELINE_TYPES, example: 'fee_payment' })
  type: TimelineType;

  @ApiProperty({ example: 'Fee paid ₹15,000' })
  title: string;

  @ApiProperty({ example: 'Term 1 · TZMS-RCP-2026-0021 · cheque', nullable: true, type: String })
  detail: string | null;

  @ApiProperty({ example: 21, nullable: true, type: Number })
  ref_id: number | null;
}

export class WingInputDto {
  @ApiProperty({ example: 'Primary' })
  @IsString()
  @Length(2, 60)
  name: string;

  @ApiProperty({ example: 1, description: 'First grade: -1 = LKG, 0 = UKG, 1 to 12' })
  @Type(() => Number)
  @IsInt()
  @Min(-3)
  @Max(12)
  from_grade: number;

  @ApiProperty({ example: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(-3)
  @Max(12)
  to_grade: number;

  @ApiPropertyOptional({
    type: [Number],
    example: null,
    description: 'Pick exact classes instead of the grade range (for a school with two boards)',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  class_ids?: number[] | null;

  @ApiPropertyOptional({ enum: SCHOOL_BOARDS, example: null })
  @IsOptional()
  @IsIn(SCHOOL_BOARDS)
  board?: SchoolBoard | null;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99)
  sort_order?: number;
}

export class UpdateWingDto {
  @ApiPropertyOptional({ example: 'Primary' })
  @IsOptional()
  @IsString()
  @Length(2, 60)
  name?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-3)
  @Max(12)
  from_grade?: number;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-3)
  @Max(12)
  to_grade?: number;

  @ApiPropertyOptional({ type: [Number], example: null })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  class_ids?: number[] | null;

  @ApiPropertyOptional({ enum: SCHOOL_BOARDS, example: null })
  @IsOptional()
  @IsIn(SCHOOL_BOARDS)
  board?: SchoolBoard | null;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99)
  sort_order?: number;
}

export class AoWingInputDto {
  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsInt()
  wing_id: number;

  @ApiPropertyOptional({ example: null, description: 'Cover from this date (for leave cover); empty = now' })
  @IsOptional()
  @IsDateString({ strict: true })
  valid_from?: string | null;

  @ApiPropertyOptional({ example: null, description: 'Cover until this date; empty = no end' })
  @IsOptional()
  @IsDateString({ strict: true })
  valid_to?: string | null;

  @ApiPropertyOptional({ example: 'Covering for Meena while on leave' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string | null;
}

export class AoWingsInputDto {
  @ApiProperty({ type: [AoWingInputDto], description: 'Empty list = head AO (whole school)' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AoWingInputDto)
  wings: AoWingInputDto[];
}

export class WingAoDto {
  @ApiProperty({ example: 7 })
  id: number;

  @ApiProperty({ example: 'Meena R' })
  name: string;

  @ApiProperty({ example: null, nullable: true, type: String })
  valid_from: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  valid_to: string | null;
}

export class WingSetupDto {
  @ApiProperty({ example: 2 })
  id: number;

  @ApiProperty({ example: 'Primary' })
  name: string;

  @ApiProperty({ example: 1 })
  from_grade: number;

  @ApiProperty({ example: 5 })
  to_grade: number;

  @ApiProperty({ type: [Number], nullable: true, example: null })
  class_ids: number[] | null;

  @ApiProperty({ enum: SCHOOL_BOARDS, nullable: true, example: null })
  board: SchoolBoard | null;

  @ApiProperty({ example: 2 })
  sort_order: number;

  @ApiProperty({ example: 'Classes 1 – 5' })
  range_label: string;

  @ApiProperty({ type: [IdNameDto] })
  classes: IdNameDto[];

  @ApiProperty({ type: [WingAoDto], description: 'AOs on this wing, including future and past cover' })
  aos: WingAoDto[];
}

export class SetupClassDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'LKG' })
  name: string;

  @ApiProperty({ example: -1 })
  grade_level: number;

  @ApiProperty({ example: 1, nullable: true, type: Number })
  wing_id: number | null;
}

export class AoWingLinkDto {
  @ApiProperty({ example: 2 })
  wing_id: number;

  @ApiProperty({ example: 'Primary' })
  name: string;

  @ApiProperty({ example: null, nullable: true, type: String })
  valid_from: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  valid_to: string | null;

  @ApiProperty({ example: true, description: 'Counts today' })
  active: boolean;

  @ApiProperty({ example: null, nullable: true, type: String })
  note: string | null;
}

export class SetupAoDto {
  @ApiProperty({ example: 7 })
  id: number;

  @ApiProperty({ example: 'Meena R' })
  name: string;

  @ApiProperty({ example: '9000000013' })
  mobile: string;

  @ApiProperty({ type: [AoWingLinkDto] })
  wings: AoWingLinkDto[];

  @ApiProperty({ example: false, description: 'No wing today: sees the whole school and the AO monitor' })
  is_head: boolean;
}

export class WingSetupPageDto {
  @ApiProperty({ type: [WingSetupDto] })
  wings: WingSetupDto[];

  @ApiProperty({ type: [SetupClassDto] })
  classes: SetupClassDto[];

  @ApiProperty({ type: [SetupAoDto] })
  aos: SetupAoDto[];
}

export class PendingCountsDto {
  @ApiProperty({ example: 2 })
  gate_passes: number;

  @ApiProperty({ example: 1 })
  fee_requests: number;

  @ApiProperty({ example: 3 })
  leave_requests: number;

  @ApiProperty({ example: 1 })
  grievances: number;

  @ApiProperty({ example: 7 })
  total: number;

  @ApiProperty({ example: 2, description: 'Waiting 24 hours or more (gate passes: past the escalation time)' })
  overdue: number;
}

export class AoCardDto {
  @ApiProperty({ type: IdNameDto })
  user: IdNameDto;

  @ApiProperty({ example: '9000000013' })
  mobile: string;

  @ApiProperty({ type: [IdNameDto] })
  wings: IdNameDto[];

  @ApiProperty({ example: false })
  is_head: boolean;

  @ApiProperty({ example: '2026-11-23T10:05:00.000+05:30', nullable: true, type: Date })
  last_active_at: Date | null;

  @ApiProperty({ example: false, description: 'No activity for 2 days or more' })
  inactive: boolean;

  @ApiProperty({ type: PendingCountsDto })
  pending: PendingCountsDto;

  @ApiProperty({ example: 42000, description: 'Fees this AO collected today, ₹' })
  fees_collected_today: number;

  @ApiProperty({ example: 380000 })
  fees_collected_month: number;

  @ApiProperty({ example: 320000, description: 'Fee balance due in their wings' })
  fee_due: number;

  @ApiProperty({ type: AttendanceTodayDto })
  attendance: AttendanceTodayDto;

  @ApiProperty({ example: ['overdue_approvals'], description: 'inactive, overdue_approvals, attendance_not_marked' })
  flags: string[];
}

export class MonitorSummaryDto {
  @ApiProperty({ type: PendingCountsDto })
  pending: PendingCountsDto;

  @ApiProperty({ example: 107500 })
  fees_today: number;

  @ApiProperty({ example: 1250000 })
  fees_month: number;

  @ApiProperty({ type: AttendanceTodayDto })
  attendance: AttendanceTodayDto;

  @ApiProperty({ example: 5 })
  open_grievances: number;

  @ApiProperty({ type: [IdNameDto], description: 'Wings with no AO today (the head AO covers them)' })
  unassigned_wings: IdNameDto[];
}

export class MonitorDto {
  @ApiProperty({ type: MonitorSummaryDto })
  summary: MonitorSummaryDto;

  @ApiProperty({ type: [AoCardDto] })
  aos: AoCardDto[];
}

export const PENDING_KINDS = ['gate_pass', 'fee_request', 'student_leave', 'grievance'] as const;
export type PendingKind = (typeof PENDING_KINDS)[number];

export class PendingItemDto {
  @ApiProperty({ enum: PENDING_KINDS, example: 'gate_pass' })
  kind: PendingKind;

  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 'Gate pass GP-2026-11-0012' })
  title: string;

  @ApiProperty({ example: 'Kavin S', nullable: true, type: String })
  student: string | null;

  @ApiProperty({ example: 'LKG - A', nullable: true, type: String })
  class_section: string | null;

  @ApiProperty({ example: '2026-11-23T08:10:00.000+05:30' })
  created_at: Date;

  @ApiProperty({ example: 3 })
  age_hours: number;

  @ApiProperty({ example: false })
  overdue: boolean;
}

export class ActivityItemDto {
  @ApiProperty({ example: '2026-11-23T10:05:00.000+05:30' })
  at: Date;

  @ApiProperty({ example: 'fee_collected' })
  kind: string;

  @ApiProperty({ example: 'Collected ₹15,000' })
  title: string;

  @ApiProperty({ example: 'Kavin S · TZMS-RCP-2026-0021', nullable: true, type: String })
  detail: string | null;
}

export class AoDetailDto {
  @ApiProperty({ type: AoCardDto })
  card: AoCardDto;

  @ApiProperty({ type: [PendingItemDto], description: 'Oldest first' })
  pending: PendingItemDto[];

  @ApiProperty({ type: [ActivityItemDto], description: 'Latest 60 actions, newest first' })
  activity: ActivityItemDto[];
}

export class RemindResultDto {
  @ApiProperty({ example: 4 })
  pending: number;
}

export class OfficeHomeDto {
  @ApiProperty({ type: OfficeMeDto })
  me: OfficeMeDto;

  @ApiProperty({ type: OfficeWingsDto })
  wings: OfficeWingsDto;

  @ApiProperty({ example: 2, description: 'Gate passes waiting in my wings' })
  pending_gate_passes: number;
}

export class DefaulterDto {
  @ApiProperty({ example: 2 })
  student_id: number;

  @ApiProperty({ example: 'Nila Narayanan' })
  name: string;

  @ApiProperty({ example: '3 - A', nullable: true, type: String })
  class_section: string | null;

  @ApiProperty({ example: 12850 })
  due: number;
}

export class DashboardFeesDto {
  @ApiProperty({ example: 15000, description: 'Collected today from students in my wings, ₹' })
  collected_today: number;

  @ApiProperty({ example: 182000 })
  collected_month: number;

  @ApiProperty({ example: 33790 })
  due: number;

  @ApiProperty({ example: 2 })
  defaulters: number;

  @ApiProperty({ type: [DefaulterDto], description: 'Top 5 by amount due' })
  top_defaulters: DefaulterDto[];
}

export class ClassExamDto {
  @ApiProperty({ example: 5 })
  class_id: number;

  @ApiProperty({ example: '3' })
  class_name: string;

  @ApiProperty({ type: IdNameDto })
  exam: IdNameDto;

  @ApiProperty({ example: 74.8 })
  average: number;

  @ApiProperty({ type: [TopperDto] })
  toppers: TopperDto[];
}

export class DashboardAlertsDto {
  @ApiProperty({ example: 3, description: 'Students below 75% attendance this year' })
  low_attendance: number;

  @ApiProperty({ example: 1, description: 'Bus passes on hold' })
  passes_on_hold: number;

  @ApiProperty({ example: 4, description: 'Students with an allergy or condition on record' })
  health_alerts: number;
}

export class OfficeDashboardDto {
  @ApiProperty({ type: OfficeMeDto })
  me: OfficeMeDto;

  @ApiProperty({ type: AttendanceTodayDto, description: 'Students in my wings today' })
  attendance: AttendanceTodayDto;

  @ApiProperty({ example: 520 })
  students: number;

  @ApiProperty({ example: 4, description: 'Staff on approved leave today (whole school)' })
  staff_on_leave: number;

  @ApiProperty({ type: DashboardFeesDto })
  fees: DashboardFeesDto;

  @ApiProperty({ type: PendingCountsDto })
  pending: PendingCountsDto;

  @ApiProperty({ type: [PendingItemDto], description: 'Oldest 5 waiting items' })
  pending_items: PendingItemDto[];

  @ApiProperty({ type: [ClassExamDto], description: 'Latest published exam per class, with top 3' })
  exams: ClassExamDto[];

  @ApiProperty({ type: DashboardAlertsDto })
  alerts: DashboardAlertsDto;

  @ApiProperty({
    type: [AoCardDto],
    nullable: true,
    description: 'AO cards, only for the head AO, principal and admin',
  })
  aos: AoCardDto[] | null;

  @ApiProperty({ type: OdTodayDto, description: 'Students in my wings on sports OD today' })
  od_today: OdTodayDto;

  @ApiProperty({ type: TeachersTodayDto, description: 'Teachers of my wings today' })
  teachers: TeachersTodayDto;

  @ApiProperty({ type: BusesTodayDto, description: 'School buses carrying students of my wings today' })
  buses: BusesTodayDto;
}

export class StudentDocumentDto {
  @ApiProperty({ example: 14 })
  id: number;

  @ApiProperty({ example: 'birth_certificate' })
  type: string;

  @ApiProperty({ example: 'Municipal Birth Certificate' })
  title: string;

  @ApiProperty({ example: 'verified' })
  status: string;

  @ApiProperty({ example: null, nullable: true, type: String })
  remarks: string | null;

  @ApiProperty({ example: '2026-11-06T15:33:00.000+05:30' })
  created_at: Date;

  @ApiProperty({ example: '2026-11-06T16:00:00.000+05:30', nullable: true, type: Date })
  verified_at: Date | null;

  @ApiProperty({ example: 'application/pdf', nullable: true, type: String })
  mime_type: string | null;

  @ApiProperty({ description: 'Signed link that opens without a token until it expires', nullable: true, type: String })
  url: string | null;

  @ApiProperty({ nullable: true, type: String })
  thumbnail_url: string | null;
}
