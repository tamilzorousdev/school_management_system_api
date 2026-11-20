import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ListQueryDto } from '@app/common';
import {
  APPRAISAL_RECOMMENDATIONS,
  APPRAISAL_STATUSES,
  AppraisalRecommendation,
  AppraisalStatus,
  OVERALL_RATINGS,
  OverallRating,
  KraScoreItem,
  AppealStatus,
} from '../entities/staff-appraisal.entity';
import { PersonNameDto } from '../../student-records/dto/records.dto';

export class StaffAppraisalDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 2 })
  academic_year_id: number;

  @ApiProperty({ example: 99 })
  staff_id: number;

  @ApiProperty({ example: 229 })
  user_id: number;

  @ApiProperty({ type: PersonNameDto })
  staff: PersonNameDto;

  @ApiProperty({ example: 'TZMS-EMP-0084' })
  employee_no: string;

  @ApiProperty({ example: 'BT Assistant' })
  designation: string;

  @ApiProperty({ example: 'Mathematics', nullable: true })
  department: string | null;

  @ApiProperty({ type: PersonNameDto })
  reviewer: PersonNameDto;

  @ApiProperty({ example: '2026-27 Annual Review' })
  period: string;

  @ApiProperty({ example: '2026-10-25' })
  review_date: string;

  @ApiProperty({ enum: APPRAISAL_STATUSES, example: 'finalized' })
  status: AppraisalStatus;

  @ApiProperty({ example: 4.8 })
  teaching_effectiveness: number;

  @ApiProperty({ example: 4.6 })
  student_outcomes: number;

  @ApiProperty({ example: 4.5 })
  classroom_management: number;

  @ApiProperty({ example: 4.9 })
  professional_conduct: number;

  @ApiProperty({ example: 4.2 })
  extracurricular_contribution: number;

  @ApiProperty({ example: 4.6 })
  overall_score: number;

  @ApiProperty({ enum: OVERALL_RATINGS, example: 'outstanding' })
  overall_rating: OverallRating;

  @ApiProperty({ example: 'Exceptional subject knowledge and interactive teaching methods.', nullable: true })
  strengths: string | null;

  @ApiProperty({ example: 'Can incorporate more multimedia digital tools in lesson delivery.', nullable: true })
  areas_for_improvement: string | null;

  @ApiProperty({ example: 'Publish department math question bank and conduct remedial workshops.', nullable: true })
  goals_next_period: string | null;

  @ApiProperty({ example: 'Consistently high student pass rate and strong parent feedback.', nullable: true })
  reviewer_remarks: string | null;

  @ApiProperty({
    example: 'Thank you for the guidance. Will work towards integrating AI tools in classroom.',
    nullable: true,
  })
  staff_remarks: string | null;

  @ApiPropertyOptional({ example: 12.0, nullable: true })
  expected_increment_percent: number | null;

  @ApiPropertyOptional({ example: 'Completed B.Ed and coached district football team.', nullable: true })
  hike_justification: string | null;

  @ApiProperty({ enum: APPRAISAL_RECOMMENDATIONS, example: 'increment' })
  recommendation: AppraisalRecommendation;

  @ApiProperty({ example: 10.0 })
  increment_percent: number;

  @ApiPropertyOptional({ nullable: true })
  kra_scores?: KraScoreItem[] | null;

  @ApiPropertyOptional({ example: 'none' })
  appeal_status?: AppealStatus;

  @ApiPropertyOptional({ nullable: true })
  appeal_reason?: string | null;

  @ApiPropertyOptional({ example: 15.0, nullable: true })
  appeal_requested_hike?: number | null;

  @ApiPropertyOptional({ nullable: true })
  appeal_feedback?: string | null;

  @ApiPropertyOptional({ nullable: true })
  appealed_at?: Date | null;

  @ApiPropertyOptional({ nullable: true })
  appeal_resolved_at?: Date | null;

  @ApiPropertyOptional({ nullable: true })
  appeal_resolved_by?: number | null;

  @ApiProperty({ nullable: true })
  finalized_at: Date | null;

  @ApiProperty()
  created_at: Date;
}

export class StaffAppraisalInputDto {
  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  academic_year_id?: number;

  @ApiPropertyOptional({ example: 99 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  staff_id?: number;

  @ApiPropertyOptional({ example: 'TZMS-EMP-0005' })
  @IsOptional()
  @IsString()
  employee_no?: string;

  @ApiPropertyOptional({ example: '2026-27 Annual Review' })
  @IsOptional()
  @IsString()
  period?: string;

  @ApiPropertyOptional({ example: '2026-10-25' })
  @IsOptional()
  @IsDateString()
  review_date?: string;

  @ApiPropertyOptional({ example: 4.5 })
  @IsOptional()
  @IsNumber()
  @Min(1.0)
  @Max(5.0)
  @Type(() => Number)
  teaching_effectiveness?: number;

  @ApiPropertyOptional({ example: 4.5 })
  @IsOptional()
  @IsNumber()
  @Min(1.0)
  @Max(5.0)
  @Type(() => Number)
  student_outcomes?: number;

  @ApiPropertyOptional({ example: 4.5 })
  @IsOptional()
  @IsNumber()
  @Min(1.0)
  @Max(5.0)
  @Type(() => Number)
  classroom_management?: number;

  @ApiPropertyOptional({ example: 4.8 })
  @IsOptional()
  @IsNumber()
  @Min(1.0)
  @Max(5.0)
  @Type(() => Number)
  professional_conduct?: number;

  @ApiPropertyOptional({ example: 4.0 })
  @IsOptional()
  @IsNumber()
  @Min(1.0)
  @Max(5.0)
  @Type(() => Number)
  extracurricular_contribution?: number;

  @ApiPropertyOptional({ example: 'Strong subject foundation and high student pass rate' })
  @IsOptional()
  @IsString()
  strengths?: string;

  @ApiPropertyOptional({ example: 'Introduce more hands-on activities' })
  @IsOptional()
  @IsString()
  areas_for_improvement?: string;

  @ApiPropertyOptional({ example: 'Achieve 100% first class in board exams' })
  @IsOptional()
  @IsString()
  goals_next_period?: string;

  @ApiPropertyOptional({ example: 'Highly recommended for performance incentive' })
  @IsOptional()
  @IsString()
  reviewer_remarks?: string;

  @ApiPropertyOptional({ enum: APPRAISAL_RECOMMENDATIONS, example: 'increment' })
  @IsOptional()
  @IsEnum(APPRAISAL_RECOMMENDATIONS)
  recommendation?: AppraisalRecommendation;

  @ApiPropertyOptional({ example: 10.0 })
  @IsOptional()
  @IsNumber()
  @Min(0.0)
  @Max(100.0)
  @Type(() => Number)
  increment_percent?: number;

  @ApiPropertyOptional({ description: 'List of evaluated KRA scores and weightage snapshot' })
  @IsOptional()
  kra_scores?: KraScoreItem[];

  @ApiPropertyOptional({ example: 12.0 })
  @IsOptional()
  @IsNumber()
  @Min(0.0)
  @Max(100.0)
  @Type(() => Number)
  expected_increment_percent?: number;

  @ApiPropertyOptional({ example: 'Completed B.Ed and coached district football team.' })
  @IsOptional()
  @IsString()
  hike_justification?: string;
}

export class StaffAppraisalCommentDto {
  @ApiProperty({ example: 'I acknowledge the feedback and will focus on interactive learning aids.' })
  @IsString()
  staff_remarks: string;
}

export class StaffHikeRequestDto {
  @ApiProperty({ example: 12.0, description: 'Requested percentage salary increment' })
  @IsNumber()
  @Min(0.0)
  @Max(100.0)
  @Type(() => Number)
  expected_increment_percent: number;

  @ApiProperty({
    example:
      'Completed B.Ed certification, produced 100% pass rate in Class 10 Math, and coached district football team.',
    description: 'Detailed justification for the requested increment',
  })
  @IsString()
  hike_justification: string;
}

export class TeachingAssignmentSummaryDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Class 10' })
  class_name: string;

  @ApiProperty({ example: 'A' })
  section_name: string;

  @ApiProperty({ example: 'Mathematics' })
  subject_name: string;

  @ApiProperty({ example: 6 })
  periods_per_week: number;
}

export class RecentHomeworkItemDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 'Trigonometry Chapter 4 Problem Set' })
  title: string;

  @ApiPropertyOptional({ example: '2026-10-30', nullable: true })
  due_date: string | null;

  @ApiProperty({ example: '2026-10-24T09:30:00Z' })
  created_at: string;

  @ApiPropertyOptional({ example: 'Mathematics', nullable: true })
  subject_name: string | null;

  @ApiPropertyOptional({ example: 'Class 10 - A', nullable: true })
  class_section: string | null;
}

export class StaffPerformanceMetricsDto {
  @ApiProperty({ example: 99 })
  staff_id: number;

  @ApiProperty({ example: 229 })
  user_id: number;

  @ApiProperty({ example: 'Sarah Jenkins' })
  name: string;

  @ApiProperty({ example: 96.5, description: 'Staff attendance percentage for the academic year' })
  attendance_percentage: number;

  @ApiProperty({ example: 182, description: 'Days present' })
  present_days: number;

  @ApiProperty({ example: 7, description: 'Days absent or on leave' })
  absent_days: number;

  @ApiProperty({ example: 189, description: 'Total working days' })
  total_working_days: number;

  @ApiProperty({ example: 24, description: 'Assigned periods per week' })
  assigned_periods_per_week: number;

  @ApiProperty({ example: 4, description: 'Total class sections taught' })
  total_sections_taught: number;

  @ApiProperty({ example: 142, description: 'Total homework and class diary entries posted' })
  diary_entries_count: number;

  @ApiProperty({ example: 88, description: 'Total homework entries assigned' })
  homework_count: number;

  @ApiProperty({ example: 94.2, nullable: true, description: 'Overall student pass percentage in subjects taught' })
  student_pass_percentage: number | null;

  @ApiProperty({ example: 5.8, nullable: true, description: 'Overall student fail percentage in subjects taught' })
  student_fail_percentage: number | null;

  @ApiProperty({ example: 114, description: 'Number of students passed' })
  passed_students: number;

  @ApiProperty({ example: 7, description: 'Number of students failed' })
  failed_students: number;

  @ApiProperty({ example: 121, description: 'Total student exam marks evaluated' })
  total_students_evaluated: number;

  @ApiProperty({ example: 76.5, nullable: true, description: 'Average marks scored by students' })
  average_student_marks: number | null;

  @ApiProperty({ example: 4.6, nullable: true, description: 'Average rating from parents (1-5 stars)' })
  parent_rating_average: number | null;

  @ApiProperty({ example: 38, description: 'Total parent ratings received' })
  parent_rating_count: number;

  @ApiProperty({ example: 4.5, nullable: true, description: 'Average student feedback (1-5 stars)' })
  student_feedback_average: number | null;

  @ApiProperty({ example: 42, description: 'Total student feedbacks received' })
  student_feedback_count: number;

  @ApiProperty({ type: [TeachingAssignmentSummaryDto] })
  teaching_assignments: TeachingAssignmentSummaryDto[];

  @ApiProperty({ type: [RecentHomeworkItemDto] })
  recent_homework: RecentHomeworkItemDto[];
}

export class AppraisalQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  academic_year_id?: number;

  @ApiPropertyOptional({ enum: APPRAISAL_STATUSES })
  @IsOptional()
  @IsEnum(APPRAISAL_STATUSES)
  status?: AppraisalStatus;

  @ApiPropertyOptional({ enum: OVERALL_RATINGS })
  @IsOptional()
  @IsEnum(OVERALL_RATINGS)
  rating?: OverallRating;

  @ApiPropertyOptional({ example: 99 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  staff_id?: number;

  @ApiPropertyOptional({ example: 'TZMS-EMP-0005' })
  @IsOptional()
  @IsString()
  employee_no?: string;
}
