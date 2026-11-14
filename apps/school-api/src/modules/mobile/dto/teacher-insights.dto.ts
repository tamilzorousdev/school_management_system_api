import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional } from 'class-validator';
import { toBoolean } from '@app/common';
import { IsDateOnly } from '../../../shared/dates';
import { TeacherClassDto } from '../../staff/dto/staff-response.dto';
import { LeaveTypeDto, StaffLeaveDto } from '../../staff-leave/dto/staff-leave.dto';
import { RefDto } from '../../students/dto/student-response.dto';

export class LeavePreviewQueryDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt({ message: 'Choose a leave type' })
  leave_type_id: number;

  @IsDateOnly('2026-11-10')
  from_date: string;

  @IsDateOnly('2026-11-11')
  to_date: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  half_day?: boolean;
}

export class AffectedPeriodDto {
  @ApiProperty({ example: '2026-11-10' })
  date: string;

  @ApiProperty({ example: 3 })
  period_no: number;

  @ApiProperty({ example: '10:35' })
  start_time: string;

  @ApiProperty({ example: '8 - C' })
  section: string;

  @ApiProperty({ example: 'Science' })
  subject: string;
}

export class LeavePreviewDto {
  @ApiProperty({ type: LeaveTypeDto })
  leave_type: LeaveTypeDto;

  @ApiProperty({ example: '2026-11-10' })
  from_date: string;

  @ApiProperty({ example: '2026-11-11' })
  to_date: string;

  @ApiProperty()
  half_day: boolean;

  @ApiProperty({
    example: ['2026-11-10', '2026-11-11'],
    description: 'Working days in the range (Sundays and holidays left out)',
  })
  dates: string[];

  @ApiProperty({ example: 2, description: 'Days this leave counts: 0.5 for a half day' })
  days: number;

  @ApiProperty({
    example: 8,
    nullable: true,
    type: Number,
    description: 'Days left before this request; null when unlimited',
  })
  remaining_before: number | null;

  @ApiProperty({ example: 6, nullable: true, type: Number })
  remaining_after: number | null;

  @ApiProperty({ description: 'false when the balance is too low; applying would return 400 LEAVE_BALANCE_LOW' })
  enough_balance: boolean;

  @ApiProperty({ description: 'true when another leave already covers some of these days (applying returns 409)' })
  overlaps_existing: boolean;

  @ApiProperty({ type: [AffectedPeriodDto], description: 'My timetable periods on these days' })
  periods: AffectedPeriodDto[];

  @ApiProperty({ example: 11 })
  period_count: number;

  @ApiProperty({
    example: ['6 - A'],
    description: 'Class-teacher sections whose morning attendance falls on these days',
  })
  morning_attendance: string[];

  @ApiProperty({ enum: ['hod', 'principal'], example: 'hod', description: 'Who decides first' })
  goes_to: 'hod' | 'principal';

  @ApiProperty({ example: 'You have 11 periods, including 6 - A morning attendance on these days.' })
  message: string;
}

export class StaffLeaveApprovalDto extends StaffLeaveDto {
  @ApiProperty({
    example: 8,
    nullable: true,
    type: Number,
    description: 'Days of this leave type the staff member has left; null when unlimited',
  })
  balance_remaining: number | null;

  @ApiProperty({ example: 4, description: 'Periods the staff member teaches on these days' })
  affected_periods: number;

  @ApiProperty({ example: ['8 - C'], description: 'Sections that need a proxy on these days' })
  affected_sections: string[];
}

export class ClassTeacherSummaryDto {
  @ApiProperty({ example: 36 })
  present_today: number;

  @ApiProperty({ example: 1 })
  absent_today: number;

  @ApiProperty({ example: 38 })
  total: number;

  @ApiProperty({ description: 'Morning attendance taken today' })
  attendance_marked: boolean;

  @ApiProperty({ example: 4 })
  fees_overdue: number;

  @ApiProperty({ example: 6, description: 'Due but not yet overdue' })
  fees_due: number;

  @ApiProperty({ example: 2, description: 'Parent leave requests waiting for me' })
  leave_requests_pending: number;
}

export class MyClassDto extends TeacherClassDto {
  @ApiProperty({ example: 5, description: 'My timetable periods in this section each week' })
  periods_per_week: number;

  @ApiProperty({ example: '2026-27' })
  academic_year: string;

  @ApiProperty({ type: ClassTeacherSummaryDto, nullable: true, description: 'Only for my class-teacher sections' })
  class_teacher_summary: ClassTeacherSummaryDto | null;
}

export class TeacherProfileDto {
  @ApiProperty({ example: 5 })
  user_id: number;

  @ApiProperty({ example: 'Priya Venkatesh' })
  name: string;

  @ApiProperty({ example: '9000000004' })
  mobile: string;

  @ApiProperty({ example: 42, nullable: true, type: Number })
  photo_file_id: number | null;

  @ApiProperty({ nullable: true, type: String })
  photo_url: string | null;

  @ApiProperty({ example: 'TZMS-EMP-0004' })
  employee_no: string;

  @ApiProperty({ example: 'BT Assistant' })
  designation: string;

  @ApiProperty({ example: 'Mathematics', nullable: true, type: String })
  department: string | null;

  @ApiProperty({ example: '2019-06-03' })
  joining_date: string;

  @ApiProperty({ example: 7, description: 'Years at this school plus prior experience' })
  experience_years: number;

  @ApiProperty({ description: 'Head of department' })
  is_hod: boolean;

  @ApiProperty({ type: [RefDto], description: 'Subjects I teach this year' })
  subjects: RefDto[];

  @ApiProperty({
    type: [RefDto],
    example: [{ id: 8, name: '6 - A' }],
    description: 'Sections where I am the class teacher',
  })
  class_teacher_of: RefDto[];

  @ApiProperty({ example: 4 })
  sections_taught: number;

  @ApiProperty({ example: 26, description: 'My timetable periods per week' })
  periods_per_week: number;

  @ApiProperty({ example: 30 })
  max_periods_per_week: number;

  @ApiProperty({
    example: 'Mathematics · HOD · Class teacher 6 - A',
    description: 'Ready-made line for the profile header',
  })
  headline: string;

  @ApiProperty({ nullable: true, type: Number })
  signature_file_id: number | null;

  @ApiProperty({ nullable: true, type: String })
  signature_url: string | null;
}
