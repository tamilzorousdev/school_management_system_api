import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
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
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ListQueryDto, PaginationDto } from '@app/common';
import { RefDto } from '../../students/dto/student-response.dto';
import { STAFF_GROUPS, StaffGroup } from '../../emergency/entities/emergency.entity';
import {
  QUESTION_TYPES,
  QuestionType,
  SURVEY_AUDIENCES,
  SURVEY_STATUSES,
  SurveyAudience,
  SurveyStatus,
} from '../entities/survey.entity';
import { MAX_OPTIONS, MAX_QUESTIONS } from '../survey.logic';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const ROLES_FILTER = ['parent', 'staff'] as const;

export class SurveyQuestionInputDto {
  @ApiProperty({ enum: QUESTION_TYPES, example: 'single_choice' })
  @IsIn(QUESTION_TYPES, {
    message: 'type must be single_choice, multi_choice, rating, short_text, long_text, date or number',
  })
  type: QuestionType;

  @ApiProperty({ example: 'How well was the event organised?', minLength: 1, maxLength: 300 })
  @Transform(trim)
  @IsString()
  @Length(1, 300, { message: 'Write the question (up to 300 characters)' })
  text: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['Very well', 'Well', 'Average', 'Poorly'],
    description: `Choice questions only: 2 to ${MAX_OPTIONS} different options`,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_OPTIONS, { message: `Give at most ${MAX_OPTIONS} options` })
  @IsString({ each: true })
  @MaxLength(100, { each: true, message: 'Keep each option within 100 characters' })
  options?: string[];

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  is_required?: boolean;
}

export class SurveyAudienceDto {
  @ApiProperty({
    enum: SURVEY_AUDIENCES,
    example: 'classes',
    description:
      'everyone = all parents and staff; parents; staff (narrow with staff_groups); classes or sections = parents of those',
  })
  @IsIn(SURVEY_AUDIENCES, { message: 'audience must be everyone, parents, staff, classes or sections' })
  audience: SurveyAudience;

  @ApiPropertyOptional({ type: [Number], example: [49], description: 'Required when audience is classes' })
  @ValidateIf((dto: SurveyAudienceDto) => dto.audience === 'classes')
  @IsArray()
  @ArrayMinSize(1, { message: 'Choose at least one class' })
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsInt({ each: true })
  class_ids?: number[];

  @ApiPropertyOptional({ type: [Number], example: [21], description: 'Required when audience is sections' })
  @ValidateIf((dto: SurveyAudienceDto) => dto.audience === 'sections')
  @IsArray()
  @ArrayMinSize(1, { message: 'Choose at least one section' })
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsInt({ each: true })
  section_ids?: number[];

  @ApiPropertyOptional({
    enum: STAFF_GROUPS,
    isArray: true,
    example: ['teachers'],
    description: 'With everyone or staff: only these staff (teachers, drivers = bus crew, office). Empty = all staff',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(STAFF_GROUPS, { each: true, message: 'staff_groups can hold teachers, drivers and office' })
  staff_groups?: StaffGroup[];
}

export class SurveyPreviewInputDto extends SurveyAudienceDto {
  @ApiPropertyOptional({ example: false, description: 'Count one answer per child instead of one per family' })
  @IsOptional()
  @IsBoolean()
  per_child?: boolean;
}

export class CreateSurveyDto {
  @ApiProperty({ example: 'Annual Day feedback', minLength: 3, maxLength: 150 })
  @Transform(trim)
  @IsString()
  @Length(3, 150, { message: 'Write a title of 3 to 150 characters' })
  title: string;

  @ApiPropertyOptional({ example: 'Tell us what you thought of Annual Day.', maxLength: 1000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ enum: SURVEY_AUDIENCES, example: 'parents', default: 'parents' })
  @IsOptional()
  @IsIn(SURVEY_AUDIENCES, { message: 'audience must be everyone, parents, staff, classes or sections' })
  audience?: SurveyAudience;

  @ApiPropertyOptional({ type: [Number], example: [49] })
  @ValidateIf((dto: CreateSurveyDto) => dto.audience === 'classes' || dto.class_ids !== undefined)
  @IsArray()
  @ArrayMinSize(1, { message: 'Choose at least one class' })
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsInt({ each: true })
  class_ids?: number[];

  @ApiPropertyOptional({ type: [Number], example: [21] })
  @ValidateIf((dto: CreateSurveyDto) => dto.audience === 'sections' || dto.section_ids !== undefined)
  @IsArray()
  @ArrayMinSize(1, { message: 'Choose at least one section' })
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsInt({ each: true })
  section_ids?: number[];

  @ApiPropertyOptional({ enum: STAFF_GROUPS, isArray: true, example: [] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(STAFF_GROUPS, { each: true, message: 'staff_groups can hold teachers, drivers and office' })
  staff_groups?: StaffGroup[];

  @ApiPropertyOptional({ example: false, description: 'Names are never shown or exported' })
  @IsOptional()
  @IsBoolean()
  is_anonymous?: boolean;

  @ApiPropertyOptional({
    example: false,
    description: 'Parents answer once for each child instead of once per family. Only when parents are in the audience',
  })
  @IsOptional()
  @IsBoolean()
  per_child?: boolean;

  @ApiPropertyOptional({ type: [SurveyQuestionInputDto], description: `Up to ${MAX_QUESTIONS} questions, in order` })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_QUESTIONS)
  @ValidateNested({ each: true })
  @Type(() => SurveyQuestionInputDto)
  questions?: SurveyQuestionInputDto[];
}

export class UpdateSurveyDto extends PartialType(CreateSurveyDto) {}

export class SendSurveyDto {
  @ApiPropertyOptional({
    example: '2026-11-20T09:00:00+05:30',
    description: 'Send later at this time (1 minute to 60 days ahead). Leave out to send now',
  })
  @IsOptional()
  @IsDateString({}, { message: 'send_at must be a date and time' })
  send_at?: string;

  @ApiProperty({ example: '2026-11-25T18:00:00+05:30', description: 'Answers are refused after this time' })
  @IsDateString({}, { message: 'closes_at must be a date and time' })
  closes_at: string;
}

export class ExtendSurveyDto {
  @ApiProperty({ example: '2026-11-30T18:00:00+05:30', description: 'A later close date' })
  @IsDateString({}, { message: 'closes_at must be a date and time' })
  closes_at: string;
}

export class SurveyQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: SURVEY_STATUSES })
  @IsOptional()
  @IsIn(SURVEY_STATUSES)
  status?: SurveyStatus;
}

export class ResultsQueryDto {
  @ApiPropertyOptional({ example: 49 })
  @IsOptional()
  @IsInt()
  @Min(1)
  class_id?: number;

  @ApiPropertyOptional({ example: 21 })
  @IsOptional()
  @IsInt()
  @Min(1)
  section_id?: number;

  @ApiPropertyOptional({ enum: ROLES_FILTER })
  @IsOptional()
  @IsIn(ROLES_FILTER)
  role?: (typeof ROLES_FILTER)[number];

  @ApiPropertyOptional({ example: 'bus', description: 'Only written answers that contain this text' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class NotAnsweredQueryDto extends PaginationDto {
  @ApiPropertyOptional({ example: 49 })
  @IsOptional()
  @IsInt()
  @Min(1)
  class_id?: number;

  @ApiPropertyOptional({ example: 21 })
  @IsOptional()
  @IsInt()
  @Min(1)
  section_id?: number;

  @ApiPropertyOptional({ enum: ROLES_FILTER })
  @IsOptional()
  @IsIn(ROLES_FILTER)
  role?: (typeof ROLES_FILTER)[number];

  @ApiPropertyOptional({ example: 'Lakshmi', description: 'Name or child' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class TemplateQueryDto {
  @ApiPropertyOptional({ example: false, description: 'Also list switched-off ready-made forms' })
  @IsOptional()
  @Transform(({ obj }: { obj: { all?: unknown } }) => obj.all === true || obj.all === 'true')
  @IsBoolean()
  all?: boolean;
}

export class SurveyTemplateInputDto {
  @ApiProperty({ example: 'Sports day feedback', minLength: 3, maxLength: 150 })
  @Transform(trim)
  @IsString()
  @Length(3, 150, { message: 'Write a title of 3 to 150 characters' })
  title: string;

  @ApiPropertyOptional({ example: 'Tell us how sports day went.', maxLength: 1000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ type: [SurveyQuestionInputDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one question' })
  @ArrayMaxSize(MAX_QUESTIONS)
  @ValidateNested({ each: true })
  @Type(() => SurveyQuestionInputDto)
  questions: SurveyQuestionInputDto[];

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @ApiPropertyOptional({ example: 7 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sort_order?: number;
}

export class SurveyTemplateUpdateDto extends PartialType(SurveyTemplateInputDto) {}

export class MySurveysQueryDto {
  @ApiPropertyOptional({
    enum: ['waiting', 'done'],
    default: 'waiting',
    description: 'waiting = open and not answered yet; done = answered',
  })
  @IsOptional()
  @IsIn(['waiting', 'done'])
  state: 'waiting' | 'done' = 'waiting';

  @ApiPropertyOptional({
    enum: ROLES_FILTER,
    description: 'parent or staff: only the forms for that app, plus the ones for both roles (role null)',
  })
  @IsOptional()
  @IsIn(ROLES_FILTER)
  role?: (typeof ROLES_FILTER)[number];
}

export class MySurveyQueryDto {
  @ApiPropertyOptional({ example: 41, description: 'Which child, when the form is answered once per child' })
  @IsOptional()
  @IsInt()
  @Min(1)
  student_id?: number;
}

export class AnswerInputDto {
  @ApiProperty({ example: 812 })
  @IsInt()
  question_id: number;

  @ApiPropertyOptional({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }, { type: 'number' }],
    example: 'Very well',
    description:
      'single_choice, short_text, long_text: text; date: YYYY-MM-DD; multi_choice: list of options; rating: 1-5; number: a number',
  })
  @IsOptional()
  value?: string | string[] | number;
}

export class SubmitAnswersDto {
  @ApiPropertyOptional({ example: 41, description: 'Required when the form is answered once per child' })
  @IsOptional()
  @IsInt()
  @Min(1)
  student_id?: number;

  @ApiProperty({ type: [AnswerInputDto] })
  @IsArray()
  @ArrayMaxSize(MAX_QUESTIONS)
  @ValidateNested({ each: true })
  @Type(() => AnswerInputDto)
  answers: AnswerInputDto[];
}

export class SurveyQuestionDto {
  @ApiProperty({ example: 812 })
  id: number;

  @ApiProperty({ enum: QUESTION_TYPES, example: 'single_choice' })
  type: QuestionType;

  @ApiProperty({ example: 'How well was the event organised?' })
  text: string;

  @ApiProperty({ type: [String], example: ['Very well', 'Well', 'Average', 'Poorly'] })
  options: string[];

  @ApiProperty({ example: true })
  is_required: boolean;

  @ApiProperty({ example: 1 })
  sort_order: number;
}

export class SurveyCountsDto {
  @ApiProperty({ example: 13, description: 'Answer slots: people, or children when per_child' })
  recipients: number;

  @ApiProperty({ example: 9 })
  answered: number;

  @ApiProperty({ example: 69.2, nullable: true, type: Number })
  response_rate: number | null;
}

export class SurveyDto {
  @ApiProperty({ example: 14 })
  id: number;

  @ApiProperty({ example: 'Annual Day feedback' })
  title: string;

  @ApiProperty({ example: 'Tell us what you thought of Annual Day.', nullable: true, type: String })
  description: string | null;

  @ApiProperty({ enum: SURVEY_STATUSES, example: 'open' })
  status: SurveyStatus;

  @ApiProperty({ enum: SURVEY_AUDIENCES, example: 'classes' })
  audience: SurveyAudience;

  @ApiProperty({ type: [Number], example: [49] })
  class_ids: number[];

  @ApiProperty({ type: [Number], example: [] })
  section_ids: number[];

  @ApiProperty({ enum: STAFF_GROUPS, isArray: true, example: [] })
  staff_groups: StaffGroup[];

  @ApiProperty({ example: 'Parents of Class 5' })
  audience_label: string;

  @ApiProperty({ example: false })
  is_anonymous: boolean;

  @ApiProperty({ example: false })
  per_child: boolean;

  @ApiProperty({ example: null, nullable: true, type: String, format: 'date-time' })
  send_at: Date | null;

  @ApiProperty({ example: '2026-11-25T18:00:00.000+05:30', nullable: true, type: String, format: 'date-time' })
  closes_at: Date | null;

  @ApiProperty({ example: '2026-11-18T10:00:00.000+05:30', nullable: true, type: String, format: 'date-time' })
  sent_at: Date | null;

  @ApiProperty({ example: null, nullable: true, type: String, format: 'date-time' })
  closed_at: Date | null;

  @ApiProperty({ type: [SurveyQuestionDto] })
  questions: SurveyQuestionDto[];

  @ApiProperty({ type: SurveyCountsDto })
  counts: SurveyCountsDto;

  @ApiProperty({ example: true, description: 'True once any answer exists: questions can no longer change' })
  locked: boolean;

  @ApiProperty({ type: RefDto, nullable: true })
  created_by: RefDto | null;

  @ApiProperty({ example: '2026-11-18T09:40:00.000+05:30', type: String, format: 'date-time' })
  created_at: Date;
}

export class SurveyInsightsDto {
  @ApiProperty({ example: 2 })
  open: number;

  @ApiProperty({ example: 1 })
  drafts: number;

  @ApiProperty({ example: 57 })
  answers_this_month: number;

  @ApiProperty({ example: 64.5, nullable: true, type: Number, description: 'Across sent forms this year' })
  average_response_rate: number | null;
}

export class SurveyPreviewDto {
  @ApiProperty({ example: 13, description: 'Answer slots the form will have: people, or children when per_child' })
  recipients: number;

  @ApiProperty({ example: 13, description: 'People with the app who will get it' })
  people: number;

  @ApiProperty({ example: 13 })
  parents: number;

  @ApiProperty({ example: 0 })
  staff: number;

  @ApiProperty({ example: 2, description: 'In the audience but without the app: they cannot answer' })
  without_app: number;
}

export class RemindResultDto {
  @ApiProperty({ example: 4, description: 'People reminded' })
  reminded: number;
}

export class NotAnsweredDto {
  @ApiProperty({ example: 301 })
  id: number;

  @ApiProperty({ example: 'Lakshmi Narayanan' })
  name: string;

  @ApiProperty({ enum: ['parent', 'staff', 'both'], example: 'parent' })
  role: 'parent' | 'staff' | 'both';

  @ApiProperty({ type: RefDto, nullable: true, description: 'The child, when answered once per child' })
  student: RefDto | null;

  @ApiProperty({ example: '5 - A', nullable: true, type: String })
  class_section: string | null;

  @ApiProperty({ example: null, nullable: true, type: String, format: 'date-time' })
  reminded_at: Date | null;
}

export class ChoiceResultDto {
  @ApiProperty({ example: 'Very well' })
  option: string;

  @ApiProperty({ example: 6 })
  count: number;

  @ApiProperty({ example: 66.7 })
  percent: number;
}

export class RatingResultDto {
  @ApiProperty({ example: 4.2, nullable: true, type: Number })
  average: number | null;

  @ApiProperty({ example: { '1': 0, '2': 0, '3': 1, '4': 4, '5': 4 } })
  counts: Record<string, number>;
}

export class NumberResultDto {
  @ApiProperty({ example: 2.5, nullable: true, type: Number })
  average: number | null;

  @ApiProperty({ example: 1, nullable: true, type: Number })
  min: number | null;

  @ApiProperty({ example: 4, nullable: true, type: Number })
  max: number | null;
}

export class TextAnswerDto {
  @ApiProperty({ example: 'More shade for parents please' })
  value: string;

  @ApiPropertyOptional({ example: 'Lakshmi Narayanan', description: 'Never sent for an anonymous form' })
  name?: string;

  @ApiPropertyOptional({
    example: '5 - A',
    nullable: true,
    type: String,
    description: 'Never sent for an anonymous form',
  })
  class_section?: string | null;
}

export class QuestionResultDto {
  @ApiProperty({ example: 812 })
  id: number;

  @ApiProperty({ enum: QUESTION_TYPES, example: 'single_choice' })
  type: QuestionType;

  @ApiProperty({ example: 'How well was the event organised?' })
  text: string;

  @ApiProperty({ example: 9, description: 'Answers to this question' })
  answered: number;

  @ApiPropertyOptional({ type: [ChoiceResultDto], description: 'single_choice and multi_choice' })
  choices?: ChoiceResultDto[];

  @ApiPropertyOptional({ type: RatingResultDto })
  rating?: RatingResultDto;

  @ApiPropertyOptional({ type: NumberResultDto })
  number?: NumberResultDto;

  @ApiPropertyOptional({ type: [TextAnswerDto], description: 'short_text, long_text and date' })
  answers?: TextAnswerDto[];
}

export class SurveyResultsDto {
  @ApiProperty({ type: SurveyDto })
  survey: SurveyDto;

  @ApiProperty({ type: SurveyCountsDto, description: 'For the filters asked' })
  counts: SurveyCountsDto;

  @ApiProperty({ type: [QuestionResultDto] })
  questions: QuestionResultDto[];
}

export class TemplateQuestionDto {
  @ApiProperty({ enum: QUESTION_TYPES, example: 'rating' })
  type: QuestionType;

  @ApiProperty({ example: 'How would you rate the event overall?' })
  text: string;

  @ApiProperty({ type: [String], example: [] })
  options: string[];

  @ApiProperty({ example: true })
  is_required: boolean;
}

export class SurveyTemplateDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ example: 'event_feedback', nullable: true, type: String })
  key: string | null;

  @ApiProperty({ example: 'Event feedback' })
  title: string;

  @ApiProperty({ example: 'Thank you for joining us.', nullable: true, type: String })
  description: string | null;

  @ApiProperty({ type: [TemplateQuestionDto] })
  questions: TemplateQuestionDto[];

  @ApiProperty({ example: true })
  is_active: boolean;

  @ApiProperty({ example: 2 })
  sort_order: number;
}

export class MySurveyItemDto {
  @ApiProperty({ example: 14 })
  id: number;

  @ApiProperty({ example: 'Annual Day feedback' })
  title: string;

  @ApiProperty({ example: '2026-11-25T18:00:00.000+05:30', nullable: true, type: String, format: 'date-time' })
  closes_at: Date | null;

  @ApiProperty({ example: 4 })
  question_count: number;

  @ApiProperty({ type: RefDto, nullable: true, description: 'The child this answer is for, when once per child' })
  student: RefDto | null;

  @ApiProperty({
    enum: ROLES_FILTER,
    nullable: true,
    example: 'parent',
    description: 'Which app the form is for: parent, staff, or null when it is for the person in both roles',
  })
  role: (typeof ROLES_FILTER)[number] | null;

  @ApiProperty({ example: null, nullable: true, type: String, format: 'date-time' })
  answered_at: Date | null;
}

export class MyAnswerDto {
  @ApiProperty({ example: 812 })
  question_id: number;

  @ApiProperty({ oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }, { type: 'number' }] })
  value: string | string[] | number;
}

export class MySurveyDto {
  @ApiProperty({ example: 14 })
  id: number;

  @ApiProperty({ example: 'Annual Day feedback' })
  title: string;

  @ApiProperty({ example: 'Tell us what you thought of Annual Day.', nullable: true, type: String })
  description: string | null;

  @ApiProperty({ enum: ['open', 'closed'], example: 'open' })
  status: SurveyStatus;

  @ApiProperty({ example: false, description: 'The school will not see who answered what' })
  is_anonymous: boolean;

  @ApiProperty({ example: '2026-11-25T18:00:00.000+05:30', nullable: true, type: String, format: 'date-time' })
  closes_at: Date | null;

  @ApiProperty({ type: RefDto, nullable: true })
  student: RefDto | null;

  @ApiProperty({
    enum: ROLES_FILTER,
    nullable: true,
    example: 'parent',
    description: 'Which app the form is for: parent, staff, or null when it is for the person in both roles',
  })
  role: (typeof ROLES_FILTER)[number] | null;

  @ApiProperty({ type: [SurveyQuestionDto] })
  questions: SurveyQuestionDto[];

  @ApiProperty({ example: null, nullable: true, type: String, format: 'date-time' })
  answered_at: Date | null;

  @ApiProperty({ type: [MyAnswerDto], nullable: true, description: 'My answers, read only, once answered' })
  my_answers: MyAnswerDto[] | null;
}
