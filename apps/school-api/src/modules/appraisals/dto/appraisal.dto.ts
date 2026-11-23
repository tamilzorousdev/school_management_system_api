import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ListQueryDto } from '@app/common';
import {
  APPEAL_STATUSES,
  AppealStatus,
  AppraisalStage,
  AUTO_METRICS,
  AutoMetric,
  CYCLE_STATUSES,
  CycleStatus,
  IncrementBands,
  KRA_CATEGORIES,
  KraCategory,
  Rating,
  RATINGS,
  RECOMMENDATIONS,
  Recommendation,
  SCORING_MODES,
  ScoringMode,
  STAFF_TYPES,
  STAGES,
  StaffTypeRule,
} from '../entities/appraisal.entity';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimAll = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? item.trim() : item)) : value;

export const REVIEW_STATES = ['pending', 'done'] as const;
export const APPEAL_DECISIONS = ['accept', 'reject'] as const;

export class GroupRulesDto {
  @ApiPropertyOptional({ enum: STAFF_TYPES, isArray: true, example: ['teaching'] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(STAFF_TYPES, { each: true, message: 'staff_types can hold teaching and non_teaching' })
  staff_types?: StaffTypeRule[];

  @ApiPropertyOptional({ type: [String], example: ['Mathematics', 'Science'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @Transform(trimAll)
  @IsString({ each: true })
  @Length(1, 60, { each: true })
  departments?: string[];

  @ApiPropertyOptional({ type: [String], example: ['PG Assistant'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @Transform(trimAll)
  @IsString({ each: true })
  @Length(1, 80, { each: true })
  designations?: string[];

  @ApiPropertyOptional({ type: [String], example: ['TEACHER', 'HOD'], description: 'Role codes' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  roles?: string[];
}

export class AppraisalGroupInputDto {
  @ApiProperty({ example: 'Teaching – Senior school' })
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  name: string;

  @ApiPropertyOptional({ example: 'Teachers of classes 9 to 12' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiPropertyOptional({ type: GroupRulesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => GroupRulesDto)
  rules?: GroupRulesDto;

  @ApiPropertyOptional({ example: false, description: 'The catch-all group for staff in no other group' })
  @IsOptional()
  @IsBoolean()
  is_default?: boolean;

  @ApiPropertyOptional({ example: 1, description: 'Lower first: decides the group when rules of two groups match' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  sort_order?: number;

  @ApiPropertyOptional({ example: 'teaching', description: 'Start from the standard KRAs for teaching or other staff' })
  @IsOptional()
  @IsIn(['teaching', 'staff', 'none'])
  starter_kras?: 'teaching' | 'staff' | 'none';
}

export class UpdateAppraisalGroupDto {
  @ApiPropertyOptional({ example: 'Teaching – Senior school' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  name?: string;

  @ApiPropertyOptional({ example: 'Teachers of classes 9 to 12' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiPropertyOptional({ type: GroupRulesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => GroupRulesDto)
  rules?: GroupRulesDto;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  is_default?: boolean;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  sort_order?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class GroupMembersInputDto {
  @ApiProperty({ type: [Number], example: [41], description: 'Staff ids always in this group' })
  @IsArray()
  @ArrayMaxSize(1000)
  @ArrayUnique()
  @IsInt({ each: true })
  include_staff_ids: number[];

  @ApiProperty({ type: [Number], example: [52], description: 'Staff ids never in this group' })
  @IsArray()
  @ArrayMaxSize(1000)
  @ArrayUnique()
  @IsInt({ each: true })
  exclude_staff_ids: number[];
}

export class KraInputDto {
  @ApiProperty({ example: 'curriculum_pedagogy' })
  @Transform(trim)
  @IsString()
  @Length(1, 50)
  code: string;

  @ApiProperty({ example: 'Curriculum delivery and teaching methods' })
  @Transform(trim)
  @IsString()
  @Length(1, 150)
  title: string;

  @ApiPropertyOptional({ example: 'Lesson plans covered and engaging methods' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiPropertyOptional({ enum: KRA_CATEGORIES, example: 'pedagogy' })
  @IsOptional()
  @IsIn(KRA_CATEGORIES)
  category?: KraCategory;

  @ApiProperty({ example: 25, description: 'Weights of the group add up to 100' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(100)
  weightage_percent: number;

  @ApiPropertyOptional({ example: 5, description: 'Highest score (2 to 10); default 5' })
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(10)
  max_score?: number;

  @ApiPropertyOptional({ enum: SCORING_MODES, example: 'manual' })
  @IsOptional()
  @IsIn(SCORING_MODES)
  scoring_mode?: ScoringMode;

  @ApiPropertyOptional({ enum: AUTO_METRICS, example: 'exam_pass_percent', description: 'Auto KRAs only' })
  @IsOptional()
  @IsIn(AUTO_METRICS)
  auto_metric?: AutoMetric | null;

  @ApiPropertyOptional({ example: 100, description: 'The value that earns the full score; default per metric' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  auto_target?: number | null;
}

export class KraSetInputDto {
  @ApiProperty({ type: [KraInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => KraInputDto)
  kras: KraInputDto[];
}

export class CopyYearDto {
  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  from_academic_year_id: number;

  @ApiProperty({ example: 3 })
  @IsInt()
  @Min(1)
  to_academic_year_id: number;
}

export class CycleInputDto {
  @ApiProperty({ example: 'Annual review 2026-27' })
  @Transform(trim)
  @IsString()
  @Length(1, 150)
  title: string;

  @ApiPropertyOptional({ example: 'Self-appraisal first, then HOD and Principal' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiProperty({ type: [Number], example: [4, 5] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsInt({ each: true })
  group_ids: number[];

  @ApiPropertyOptional({ example: '2026-12-01T09:00:00+05:30', description: 'Leave out to open when you press Open' })
  @IsOptional()
  @IsDateString({}, { message: 'self_opens_at must be a date and time' })
  self_opens_at?: string | null;

  @ApiProperty({ example: '2026-12-10T18:00:00+05:30' })
  @IsDateString({}, { message: 'self_due_at must be a date and time' })
  self_due_at: string;

  @ApiProperty({ example: '2026-12-17T18:00:00+05:30' })
  @IsDateString({}, { message: 'hod_due_at must be a date and time' })
  hod_due_at: string;

  @ApiProperty({ example: '2026-12-24T18:00:00+05:30' })
  @IsDateString({}, { message: 'final_due_at must be a date and time' })
  final_due_at: string;

  @ApiPropertyOptional({ example: 7, description: 'Days staff can appeal after the result is published' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  appeal_days?: number;

  @ApiPropertyOptional({
    example: {
      outstanding: 12,
      exceeds_expectations: 10,
      meets_expectations: 7,
      needs_improvement: 3,
      unsatisfactory: 0,
    },
    description: 'Suggested increment % for each rating',
  })
  @IsOptional()
  @IsObject()
  increment_bands?: IncrementBands;
}

export class UpdateCycleDto {
  @ApiPropertyOptional({ example: 'Annual review 2026-27' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 150)
  title?: string;

  @ApiPropertyOptional({ example: 'Self-appraisal first, then HOD and Principal' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiPropertyOptional({ type: [Number], example: [4, 5] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsInt({ each: true })
  group_ids?: number[];

  @ApiPropertyOptional({ example: '2026-12-01T09:00:00+05:30' })
  @IsOptional()
  @IsDateString({}, { message: 'self_opens_at must be a date and time' })
  self_opens_at?: string | null;

  @ApiPropertyOptional({ example: '2026-12-10T18:00:00+05:30' })
  @IsOptional()
  @IsDateString({}, { message: 'self_due_at must be a date and time' })
  self_due_at?: string;

  @ApiPropertyOptional({ example: '2026-12-17T18:00:00+05:30' })
  @IsOptional()
  @IsDateString({}, { message: 'hod_due_at must be a date and time' })
  hod_due_at?: string;

  @ApiPropertyOptional({ example: '2026-12-24T18:00:00+05:30' })
  @IsOptional()
  @IsDateString({}, { message: 'final_due_at must be a date and time' })
  final_due_at?: string;

  @ApiPropertyOptional({ example: 7 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  appeal_days?: number;

  @ApiPropertyOptional({ example: { outstanding: 12, exceeds_expectations: 10 } })
  @IsOptional()
  @IsObject()
  increment_bands?: IncrementBands;
}

export class ExtendCycleDto {
  @ApiPropertyOptional({ example: '2026-12-12T18:00:00+05:30' })
  @IsOptional()
  @IsDateString({}, { message: 'self_due_at must be a date and time' })
  self_due_at?: string;

  @ApiPropertyOptional({ example: '2026-12-19T18:00:00+05:30' })
  @IsOptional()
  @IsDateString({}, { message: 'hod_due_at must be a date and time' })
  hod_due_at?: string;

  @ApiPropertyOptional({ example: '2026-12-26T18:00:00+05:30' })
  @IsOptional()
  @IsDateString({}, { message: 'final_due_at must be a date and time' })
  final_due_at?: string;
}

export class CycleQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: CYCLE_STATUSES })
  @IsOptional()
  @IsIn(CYCLE_STATUSES)
  status?: CycleStatus;
}

export class AppraisalQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cycle_id?: number;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  group_id?: number;

  @ApiPropertyOptional({ enum: STAGES })
  @IsOptional()
  @IsIn(STAGES)
  stage?: AppraisalStage;

  @ApiPropertyOptional({ enum: RATINGS })
  @IsOptional()
  @IsIn(RATINGS)
  rating?: Rating;
}

export class AppealQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: APPEAL_STATUSES })
  @IsOptional()
  @IsIn(APPEAL_STATUSES)
  status?: AppealStatus;
}

export class ReviewsQueryDto {
  @ApiPropertyOptional({ enum: REVIEW_STATES, example: 'pending' })
  @IsOptional()
  @IsIn(REVIEW_STATES)
  state?: (typeof REVIEW_STATES)[number];
}

export class ScoreInputDto {
  @ApiProperty({ example: 812, description: 'kra_id of the score row' })
  @IsInt()
  @Min(1)
  kra_id: number;

  @ApiPropertyOptional({ example: 4, description: '1 to the KRA max_score; null clears it' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(10)
  score?: number | null;

  @ApiPropertyOptional({ example: 'Ran the science fair and two remedial batches' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  comment?: string | null;
}

export class SelfInputDto {
  @ApiProperty({ type: [ScoreInputDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ScoreInputDto)
  scores: ScoreInputDto[];

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(100)
  expected_increment_percent?: number | null;

  @ApiPropertyOptional({ example: 'Took two extra classes and the school magazine' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  hike_justification?: string | null;

  @ApiPropertyOptional({ type: [Number], example: [431], description: 'Evidence files uploaded with POST /files' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsInt({ each: true })
  file_ids?: number[];
}

export class HodInputDto {
  @ApiProperty({ type: [ScoreInputDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ScoreInputDto)
  scores: ScoreInputDto[];

  @ApiPropertyOptional({ example: 'Strong in lab work; needs to finish the syllabus earlier' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  remarks?: string | null;
}

export class FinalScoreInputDto {
  @ApiProperty({ example: 812 })
  @IsInt()
  @Min(1)
  kra_id: number;

  @ApiProperty({ example: 4.5 })
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(10)
  score: number;

  @ApiPropertyOptional({ example: 'Science fair results came after the HOD review' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  override_reason?: string | null;
}

export class FinalInputDto {
  @ApiPropertyOptional({ type: [FinalScoreInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => FinalScoreInputDto)
  scores?: FinalScoreInputDto[];

  @ApiPropertyOptional({ enum: RECOMMENDATIONS, example: 'increment' })
  @IsOptional()
  @IsIn(RECOMMENDATIONS)
  recommendation?: Recommendation;

  @ApiPropertyOptional({ example: 9 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(100)
  increment_percent?: number | null;

  @ApiPropertyOptional({ example: 'Excellent lab work' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  strengths?: string | null;

  @ApiPropertyOptional({ example: 'Finish the syllabus a week before exams' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  improvements?: string | null;

  @ApiPropertyOptional({ example: 'Lead the inter-school science quiz' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  goals?: string | null;

  @ApiPropertyOptional({ example: 'Well done this year' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  principal_remarks?: string | null;
}

export class PublishManyDto {
  @ApiProperty({ type: [Number], example: [31, 32] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsInt({ each: true })
  ids: number[];
}

export class AcknowledgeDto {
  @ApiPropertyOptional({ example: 'Thank you, I will work on the syllabus pace' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  remarks?: string | null;
}

export class AppealInputDto {
  @ApiProperty({ example: 'My pass percentage did not count the re-test results' })
  @Transform(trim)
  @IsString()
  @Length(5, 2000)
  reason: string;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(100)
  requested_increment?: number | null;
}

export class DecideAppealDto {
  @ApiProperty({ enum: APPEAL_DECISIONS, example: 'accept' })
  @IsIn(APPEAL_DECISIONS)
  decision: (typeof APPEAL_DECISIONS)[number];

  @ApiProperty({ example: 'Re-test results added' })
  @Transform(trim)
  @IsString()
  @Length(2, 2000)
  note: string;

  @ApiPropertyOptional({ type: [FinalScoreInputDto], description: 'Accept only: revised final scores' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => FinalScoreInputDto)
  scores?: FinalScoreInputDto[];

  @ApiPropertyOptional({ example: 10, description: 'Accept only: revised increment %' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(100)
  increment_percent?: number | null;
}

export class DossierQueryDto {
  @ApiPropertyOptional({ example: 3, description: 'Defaults to the year being viewed' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  academic_year_id?: number;
}

export class NamedRefDto {
  @ApiProperty({ example: 4 })
  id: number;

  @ApiProperty({ example: 'Teaching – Senior school' })
  name: string;
}

export class GroupRulesResponseDto {
  @ApiProperty({ enum: STAFF_TYPES, isArray: true, example: ['teaching'] })
  staff_types: StaffTypeRule[];

  @ApiProperty({ type: [String], example: ['Mathematics'] })
  departments: string[];

  @ApiProperty({ type: [String], example: [] })
  designations: string[];

  @ApiProperty({ type: [String], example: ['TEACHER'] })
  roles: string[];
}

export class KraDto {
  @ApiProperty({ example: 812 })
  id: number;

  @ApiProperty({ example: 'curriculum_pedagogy' })
  code: string;

  @ApiProperty({ example: 'Curriculum delivery and teaching methods' })
  title: string;

  @ApiProperty({ example: 'Lesson plans covered', nullable: true })
  description: string | null;

  @ApiProperty({ enum: KRA_CATEGORIES, example: 'pedagogy' })
  category: KraCategory;

  @ApiProperty({ example: 25 })
  weightage_percent: number;

  @ApiProperty({ example: 5 })
  max_score: number;

  @ApiProperty({ enum: SCORING_MODES, example: 'manual' })
  scoring_mode: ScoringMode;

  @ApiProperty({ enum: AUTO_METRICS, nullable: true, example: null })
  auto_metric: AutoMetric | null;

  @ApiProperty({ nullable: true, example: null })
  auto_target: number | null;

  @ApiProperty({ example: 1 })
  sort_order: number;
}

export class AppraisalGroupDto {
  @ApiProperty({ example: 4 })
  id: number;

  @ApiProperty({ example: 3 })
  academic_year_id: number;

  @ApiProperty({ example: 'Teaching – Senior school' })
  name: string;

  @ApiProperty({ nullable: true, example: null })
  description: string | null;

  @ApiProperty({ type: GroupRulesResponseDto })
  rules: GroupRulesResponseDto;

  @ApiProperty({ example: false })
  is_default: boolean;

  @ApiProperty({ example: 1 })
  sort_order: number;

  @ApiProperty({ example: true })
  is_active: boolean;

  @ApiProperty({ example: 18, description: 'Staff placed in this group today' })
  member_count: number;

  @ApiProperty({ example: 100 })
  weight_total: number;

  @ApiProperty({ type: [KraDto] })
  kras: KraDto[];
}

export class GroupMemberDto {
  @ApiProperty({ example: 41 })
  staff_id: number;

  @ApiProperty({ example: 781 })
  user_id: number;

  @ApiProperty({ example: 'Arun Prakash' })
  name: string;

  @ApiProperty({ example: 'TZMS-EMP-0006' })
  employee_no: string;

  @ApiProperty({ example: 'PG Assistant' })
  designation: string;

  @ApiProperty({ nullable: true, example: 'Science' })
  department: string | null;

  @ApiProperty({ example: 'teaching' })
  staff_type: string;

  @ApiProperty({ enum: ['rules', 'included', 'default'], example: 'rules' })
  reason: 'rules' | 'included' | 'default';

  @ApiProperty({ type: [NamedRefDto], description: 'Other groups whose rules also match (lower priority)' })
  also_matches: NamedRefDto[];
}

export class GroupMembersDto {
  @ApiProperty({ example: 4 })
  group_id: number;

  @ApiProperty({ type: [GroupMemberDto] })
  members: GroupMemberDto[];

  @ApiProperty({
    type: [GroupMemberDto],
    description: 'Matched by rules or included here, but placed in another group',
  })
  elsewhere: GroupMemberDto[];

  @ApiProperty({ type: [Number], example: [41] })
  include_staff_ids: number[];

  @ApiProperty({ type: [Number], example: [] })
  exclude_staff_ids: number[];
}

export class CopyYearResultDto {
  @ApiProperty({ example: 3 })
  copied: number;

  @ApiProperty({ example: 1, description: 'Groups with the same name already in the target year' })
  skipped: number;
}

export class StageCountsDto {
  @ApiProperty({ example: 40 })
  total: number;

  @ApiProperty({ example: 12 })
  self_pending: number;

  @ApiProperty({ example: 8 })
  hod_pending: number;

  @ApiProperty({ example: 6 })
  principal_pending: number;

  @ApiProperty({ example: 10 })
  published: number;

  @ApiProperty({ example: 1 })
  appealed: number;

  @ApiProperty({ example: 3 })
  completed: number;

  @ApiProperty({ example: 2 })
  self_missed: number;
}

export class CycleDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ example: 3 })
  academic_year_id: number;

  @ApiProperty({ example: 'Annual review 2026-27' })
  title: string;

  @ApiProperty({ nullable: true, example: null })
  description: string | null;

  @ApiProperty({ type: [NamedRefDto] })
  groups: NamedRefDto[];

  @ApiProperty({ nullable: true, example: '2026-12-01T09:00:00.000+05:30' })
  self_opens_at: Date | null;

  @ApiProperty({ example: '2026-12-10T18:00:00.000+05:30' })
  self_due_at: Date;

  @ApiProperty({ example: '2026-12-17T18:00:00.000+05:30' })
  hod_due_at: Date;

  @ApiProperty({ example: '2026-12-24T18:00:00.000+05:30' })
  final_due_at: Date;

  @ApiProperty({ example: 7 })
  appeal_days: number;

  @ApiProperty({ example: { outstanding: 12, exceeds_expectations: 10 } })
  increment_bands: IncrementBands;

  @ApiProperty({ enum: CYCLE_STATUSES, example: 'open' })
  status: CycleStatus;

  @ApiProperty({ example: false, description: 'Reviews moved from the earlier appraisal module' })
  is_legacy: boolean;

  @ApiProperty({ nullable: true, example: null })
  opened_at: Date | null;

  @ApiProperty({ nullable: true, example: null })
  closed_at: Date | null;

  @ApiProperty({ type: StageCountsDto })
  counts: StageCountsDto;
}

export class RatingCountDto {
  @ApiProperty({ enum: RATINGS, example: 'outstanding' })
  rating: Rating;

  @ApiProperty({ example: 4 })
  count: number;
}

export class CycleInsightsDto {
  @ApiProperty({ type: StageCountsDto })
  counts: StageCountsDto;

  @ApiProperty({ nullable: true, example: 78.4, description: 'Average final % of published reviews' })
  average_final_percent: number | null;

  @ApiProperty({ type: [RatingCountDto] })
  ratings: RatingCountDto[];

  @ApiProperty({ example: 2 })
  appeals_pending: number;
}

export class StaffRefDto {
  @ApiProperty({ example: 41 })
  staff_id: number;

  @ApiProperty({ example: 781 })
  user_id: number;

  @ApiProperty({ example: 'Arun Prakash' })
  name: string;

  @ApiProperty({ example: 'TZMS-EMP-0006' })
  employee_no: string;

  @ApiProperty({ example: 'PG Assistant' })
  designation: string;

  @ApiProperty({ nullable: true, example: 'Science' })
  department: string | null;
}

export class UserRefDto {
  @ApiProperty({ example: 779 })
  id: number;

  @ApiProperty({ example: 'Priya Venkatesh' })
  name: string;
}

export class AppraisalListItemDto {
  @ApiProperty({ example: 31 })
  id: number;

  @ApiProperty({ type: NamedRefDto, description: 'The cycle (name = title)' })
  cycle: NamedRefDto;

  @ApiProperty({ type: StaffRefDto })
  staff: StaffRefDto;

  @ApiProperty({ type: NamedRefDto })
  group: NamedRefDto;

  @ApiProperty({ type: UserRefDto, nullable: true })
  hod: UserRefDto | null;

  @ApiProperty({ enum: STAGES, example: 'hod_pending' })
  stage: AppraisalStage;

  @ApiProperty({ example: false })
  self_missed: boolean;

  @ApiProperty({ nullable: true, example: 82.5 })
  self_percent: number | null;

  @ApiProperty({ nullable: true, example: 78 })
  hod_percent: number | null;

  @ApiProperty({ nullable: true, example: 80 })
  final_percent: number | null;

  @ApiProperty({ enum: RATINGS, nullable: true, example: 'exceeds_expectations' })
  rating: Rating | null;

  @ApiProperty({ nullable: true, example: 10 })
  increment_percent: number | null;

  @ApiProperty({ nullable: true, example: null })
  published_at: Date | null;

  @ApiProperty({
    nullable: true,
    example: '2026-12-10T18:00:00.000+05:30',
    description: 'Deadline of the current stage',
  })
  due_at: Date | null;
}

export class ScoreDto {
  @ApiProperty({ example: 5501 })
  id: number;

  @ApiProperty({ example: 812, nullable: true })
  kra_id: number | null;

  @ApiProperty({ example: 'student_outcomes' })
  code: string;

  @ApiProperty({ example: 'Student results' })
  title: string;

  @ApiProperty({ nullable: true, example: null })
  description: string | null;

  @ApiProperty({ example: 25 })
  weightage_percent: number;

  @ApiProperty({ example: 5 })
  max_score: number;

  @ApiProperty({ enum: SCORING_MODES, example: 'auto' })
  scoring_mode: ScoringMode;

  @ApiProperty({ enum: AUTO_METRICS, nullable: true, example: 'exam_pass_percent' })
  auto_metric: AutoMetric | null;

  @ApiProperty({ nullable: true, example: 100 })
  auto_target: number | null;

  @ApiProperty({ nullable: true, example: 86.4, description: 'Value read from school data' })
  auto_value: number | null;

  @ApiProperty({ nullable: true, example: 4.32 })
  auto_score: number | null;

  @ApiProperty({ nullable: true, example: 4 })
  self_score: number | null;

  @ApiProperty({ nullable: true, example: null })
  self_comment: string | null;

  @ApiProperty({ nullable: true, example: 4 })
  hod_score: number | null;

  @ApiProperty({ nullable: true, example: null })
  hod_comment: string | null;

  @ApiProperty({ nullable: true, example: 4.5 })
  final_score: number | null;

  @ApiProperty({ nullable: true, example: null })
  override_reason: string | null;

  @ApiProperty({ nullable: true, example: 90, description: 'final_score as a % of max_score' })
  final_percent: number | null;
}

export class EvidenceDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 431 })
  file_id: number;

  @ApiProperty({ nullable: true, example: null })
  score_id: number | null;

  @ApiProperty({ example: 'science-fair.pdf' })
  name: string;

  @ApiProperty({ example: '/api/v1/files/431/content?expires=…&signature=…', nullable: true })
  url: string | null;
}

export class AppealDto {
  @ApiProperty({ example: 6 })
  id: number;

  @ApiProperty({ example: 31 })
  appraisal_id: number;

  @ApiProperty({ type: StaffRefDto })
  staff: StaffRefDto;

  @ApiProperty({ example: 'Annual review 2026-27' })
  cycle_title: string;

  @ApiProperty({ example: 'My pass percentage did not count the re-test results' })
  reason: string;

  @ApiProperty({ nullable: true, example: 10 })
  requested_increment: number | null;

  @ApiProperty({ enum: APPEAL_STATUSES, example: 'pending' })
  status: AppealStatus;

  @ApiProperty({ nullable: true, example: null })
  decision_note: string | null;

  @ApiProperty({ type: UserRefDto, nullable: true })
  decided_by: UserRefDto | null;

  @ApiProperty({ nullable: true, example: null })
  decided_at: Date | null;

  @ApiProperty({ example: '2026-12-26T10:00:00.000+05:30' })
  created_at: Date;
}

export class AppraisalDto extends AppraisalListItemDto {
  @ApiProperty({ example: 3 })
  academic_year_id: number;

  @ApiProperty({ example: '2026-12-10T18:00:00.000+05:30' })
  self_due_at: Date;

  @ApiProperty({ example: '2026-12-17T18:00:00.000+05:30' })
  hod_due_at: Date;

  @ApiProperty({ example: '2026-12-24T18:00:00.000+05:30' })
  final_due_at: Date;

  @ApiProperty({ nullable: true, example: null })
  self_submitted_at: Date | null;

  @ApiProperty({ nullable: true, example: null })
  hod_submitted_at: Date | null;

  @ApiProperty({ nullable: true, example: null })
  acknowledged_at: Date | null;

  @ApiProperty({ nullable: true, example: null, description: 'Last moment to appeal; null when no appeal is possible' })
  appeal_until: Date | null;

  @ApiProperty({ enum: RECOMMENDATIONS, nullable: true, example: 'increment' })
  recommendation: Recommendation | null;

  @ApiProperty({ nullable: true, example: 10, description: 'From the rating and the cycle increment bands' })
  suggested_increment: number | null;

  @ApiProperty({ nullable: true, example: 10 })
  expected_increment_percent: number | null;

  @ApiProperty({ nullable: true, example: null })
  hike_justification: string | null;

  @ApiProperty({ nullable: true, example: null })
  strengths: string | null;

  @ApiProperty({ nullable: true, example: null })
  improvements: string | null;

  @ApiProperty({ nullable: true, example: null })
  goals: string | null;

  @ApiProperty({ nullable: true, example: null })
  hod_remarks: string | null;

  @ApiProperty({ nullable: true, example: null })
  principal_remarks: string | null;

  @ApiProperty({ nullable: true, example: null })
  staff_remarks: string | null;

  @ApiProperty({ type: [ScoreDto] })
  scores: ScoreDto[];

  @ApiProperty({ type: [EvidenceDto] })
  evidence: EvidenceDto[];

  @ApiProperty({ type: [AppealDto] })
  appeals: AppealDto[];
}

export class RemindResultDto {
  @ApiProperty({ example: 12 })
  reminded: number;
}

export class PublishResultDto {
  @ApiProperty({ example: 18 })
  published: number;

  @ApiProperty({
    type: [Number],
    example: [33],
    description: 'Not ready: scores missing or not at the Principal stage',
  })
  skipped: number[];
}

export class MetricValuesDto {
  @ApiProperty({ nullable: true, example: 96.5 })
  attendance_percent: number | null;

  @ApiProperty({ nullable: true, example: 86.4 })
  exam_pass_percent: number | null;

  @ApiProperty({ nullable: true, example: 4.3 })
  parent_rating: number | null;

  @ApiProperty({ nullable: true, example: 92 })
  parent_good_behaviour_percent: number | null;

  @ApiProperty({ nullable: true, example: 42 })
  homework_count: number | null;

  @ApiProperty({ nullable: true, example: null })
  driver_rating: number | null;
}

export class DossierClassDto {
  @ApiProperty({ example: 176 })
  section_id: number;

  @ApiProperty({ example: '7 - A' })
  section: string;

  @ApiProperty({ example: 'Science' })
  subject: string;

  @ApiProperty({ example: 6 })
  periods_per_week: number;

  @ApiProperty({ example: 39 })
  papers: number;

  @ApiProperty({ nullable: true, example: 87.2 })
  pass_percent: number | null;

  @ApiProperty({ nullable: true, example: 68.1 })
  average_percent: number | null;
}

export class DossierAttendanceDto {
  @ApiProperty({ example: 110 })
  marked_days: number;

  @ApiProperty({ example: 100 })
  present: number;

  @ApiProperty({ example: 5 })
  late: number;

  @ApiProperty({ example: 2 })
  half_day: number;

  @ApiProperty({ example: 3 })
  absent: number;
}

export class DossierWorkloadDto {
  @ApiProperty({ example: 28 })
  periods_per_week: number;

  @ApiProperty({ example: 4 })
  sections: number;

  @ApiProperty({ type: [DossierClassDto] })
  classes: DossierClassDto[];
}

export class DossierHomeworkItemDto {
  @ApiProperty({ example: 901 })
  id: number;

  @ApiProperty({ example: 'Chapter 4 exercise' })
  title: string;

  @ApiProperty({ nullable: true, example: '7 - A' })
  section: string | null;

  @ApiProperty({ example: '2026-11-18T10:00:00.000Z' })
  published_at: string;
}

export class DossierHomeworkDto {
  @ApiProperty({ example: 42 })
  count: number;

  @ApiProperty({ type: [DossierHomeworkItemDto] })
  recent: DossierHomeworkItemDto[];
}

export class DossierRatingsDto {
  @ApiProperty({ nullable: true, example: 4.3 })
  parent_average: number | null;

  @ApiProperty({ example: 57 })
  parent_count: number;

  @ApiProperty({ nullable: true, example: 92 })
  good_behaviour_percent: number | null;
}

export class DossierDriverDto {
  @ApiProperty({ nullable: true, example: null })
  average: number | null;

  @ApiProperty({ example: 0 })
  count: number;
}

export class DossierDto {
  @ApiProperty({ example: 781 })
  user_id: number;

  @ApiProperty({ example: 3 })
  academic_year_id: number;

  @ApiProperty({ type: MetricValuesDto })
  metrics: MetricValuesDto;

  @ApiProperty({ type: DossierAttendanceDto })
  attendance: DossierAttendanceDto;

  @ApiProperty({ type: DossierWorkloadDto })
  workload: DossierWorkloadDto;

  @ApiProperty({ type: DossierHomeworkDto })
  homework: DossierHomeworkDto;

  @ApiProperty({ type: DossierRatingsDto })
  ratings: DossierRatingsDto;

  @ApiProperty({ type: DossierDriverDto })
  driver: DossierDriverDto;
}
