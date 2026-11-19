import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ListQueryDto, PaginationDto, toBoolean } from '@app/common';
import { IsDateOnly } from '../../../shared/dates';
import { RefDto } from '../../students/dto/student-response.dto';
import {
  EVENT_AUDIENCES,
  EVENT_STATUSES,
  EventAudience,
  EventStatus,
  RSVP_RESPONSES,
  RsvpResponse,
} from '../entities/school-event.entity';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const notNull = (_object: unknown, value: unknown) => value !== null;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_WITH_ZONE = /(Z|[+-]\d{2}:\d{2})$/;

export class EventInputDto {
  @ApiProperty({ example: 'Annual sports day', maxLength: 150 })
  @Transform(trim)
  @MaxLength(150)
  @IsString()
  @IsNotEmpty({ message: 'Enter a title' })
  title: string;

  @ApiPropertyOptional({
    example: 'Children come in house colours. Parents are welcome.',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @IsDateOnly('2026-12-12')
  event_date: string;

  @ApiPropertyOptional({
    example: '09:00',
    nullable: true,
    type: String,
    description: '24-hour HH:MM; empty = all day',
  })
  @IsOptional()
  @ValidateIf(notNull)
  @Matches(TIME, { message: 'start_time must be HH:MM' })
  start_time?: string | null;

  @ApiPropertyOptional({ example: '12:30', nullable: true, type: String })
  @IsOptional()
  @ValidateIf(notNull)
  @Matches(TIME, { message: 'end_time must be HH:MM' })
  end_time?: string | null;

  @ApiPropertyOptional({ example: 'School ground', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(150)
  venue?: string | null;

  @ApiProperty({
    enum: EVENT_AUDIENCES,
    example: 'school',
    description: 'school: every parent. classes: chosen classes or sections',
  })
  @IsIn(EVENT_AUDIENCES)
  audience: EventAudience;

  @ApiPropertyOptional({ example: [3], type: Number, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsInt({ each: true })
  class_ids?: number[];

  @ApiPropertyOptional({ example: [4], type: Number, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @IsInt({ each: true })
  section_ids?: number[];

  @ApiPropertyOptional({ default: true, description: 'Ask parents to reply Attending, Not attending or Maybe' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  rsvp_required?: boolean;

  @ApiPropertyOptional({
    example: '2026-12-10T18:00:00+05:30',
    nullable: true,
    type: String,
    description: 'Last time to reply; empty = until the event starts',
  })
  @IsOptional()
  @ValidateIf(notNull)
  @Matches(ISO_WITH_ZONE, { message: 'rsvp_deadline must include the time zone, for example +05:30' })
  @IsISO8601({ strict: true }, { message: 'rsvp_deadline must be a date and time' })
  rsvp_deadline?: string | null;

  @ApiPropertyOptional({ example: true, description: 'Publish now and tell the parents; false keeps a draft' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  publish?: boolean;
}

export class CancelEventDto {
  @ApiPropertyOptional({ example: 'Postponed because of heavy rain', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(300)
  reason?: string | null;
}

export class EventQueryDto extends ListQueryDto {
  @IsDateOnly('2026-12-01', true)
  from?: string;

  @IsDateOnly('2026-12-31', true)
  to?: string;

  @ApiPropertyOptional({ enum: EVENT_STATUSES })
  @IsOptional()
  @IsIn(EVENT_STATUSES)
  status?: EventStatus;

  @ApiPropertyOptional({ example: 6, description: 'Events for this class (whole-school ones included)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  class_id?: number;

  @ApiPropertyOptional({ description: 'Only events from today on' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  upcoming?: boolean;
}

export class EventResponsesQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: [...RSVP_RESPONSES, 'no_response'] })
  @IsOptional()
  @IsIn([...RSVP_RESPONSES, 'no_response'])
  response?: RsvpResponse | 'no_response';

  @ApiPropertyOptional({ example: 6 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  class_id?: number;

  @ApiPropertyOptional({ example: 'Kavin', description: 'Student name or admission number' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  search?: string;
}

export class MyEventsQueryDto extends PaginationDto {
  @IsDateOnly('2026-12-01', true)
  from?: string;

  @IsDateOnly('2026-12-31', true)
  to?: string;

  @ApiPropertyOptional({ example: 'sports' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ example: 12, description: 'Only events this child is invited to' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  student_id?: number;
}

export class RsvpInputDto {
  @ApiProperty({ example: 12, description: 'My child the reply is for' })
  @IsInt()
  student_id: number;

  @ApiProperty({ enum: RSVP_RESPONSES, example: 'attending' })
  @IsIn(RSVP_RESPONSES)
  response: RsvpResponse;
}

export class RsvpCountsDto {
  @ApiProperty({ example: 120, description: 'Students invited' })
  invited: number;

  @ApiProperty({ example: 64 })
  attending: number;

  @ApiProperty({ example: 10 })
  not_attending: number;

  @ApiProperty({ example: 12 })
  maybe: number;

  @ApiProperty({ example: 34 })
  no_response: number;
}

export class EventDto {
  @ApiProperty({ example: 5 })
  id: number;

  @ApiProperty({ example: 'Annual sports day' })
  title: string;

  @ApiProperty({ nullable: true, type: String })
  description: string | null;

  @ApiProperty({ example: '2026-12-12' })
  event_date: string;

  @ApiProperty({ nullable: true, type: String, example: '09:00' })
  start_time: string | null;

  @ApiProperty({ nullable: true, type: String, example: '12:30' })
  end_time: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'School ground' })
  venue: string | null;

  @ApiProperty({ enum: EVENT_AUDIENCES })
  audience: EventAudience;

  @ApiProperty({ example: 'Whole school', description: 'Who is invited, in words' })
  audience_label: string;

  @ApiProperty({ type: RefDto, isArray: true })
  classes: RefDto[];

  @ApiProperty({ type: RefDto, isArray: true, description: 'Sections named like 6 - A' })
  sections: RefDto[];

  @ApiProperty({ example: true })
  rsvp_required: boolean;

  @ApiProperty({ nullable: true, type: Date, description: 'Reply until; null = until the event starts' })
  rsvp_deadline: Date | null;

  @ApiProperty({ example: true, description: 'Parents can still reply' })
  rsvp_open: boolean;

  @ApiProperty({ enum: EVENT_STATUSES })
  status: EventStatus;

  @ApiProperty({ nullable: true, type: Date })
  published_at: Date | null;

  @ApiProperty({ nullable: true, type: Date })
  cancelled_at: Date | null;

  @ApiProperty({ nullable: true, type: String })
  cancel_reason: string | null;

  @ApiProperty({ type: RsvpCountsDto })
  counts: RsvpCountsDto;

  @ApiProperty({ type: RefDto })
  created_by: RefDto;

  @ApiProperty()
  created_at: Date;
}

export class EventResponseDto {
  @ApiProperty({ type: RefDto, description: 'Student' })
  student: RefDto;

  @ApiProperty({ example: 'TZMS-2026-0012' })
  admission_no: string;

  @ApiProperty({ nullable: true, type: String, example: '6 - A' })
  class_section: string | null;

  @ApiProperty({ enum: [...RSVP_RESPONSES, 'no_response'] })
  response: RsvpResponse | 'no_response';

  @ApiProperty({ type: RefDto, nullable: true, description: 'Parent who replied' })
  responded_by: RefDto | null;

  @ApiProperty({ nullable: true, type: Date })
  responded_at: Date | null;

  @ApiProperty({ nullable: true, type: String, example: '9000000005', description: 'Primary parent mobile' })
  parent_mobile: string | null;
}

export class EventInsightsDto {
  @ApiProperty({ example: 4, description: 'Published events this month' })
  this_month: number;

  @ApiProperty({ example: 6, description: 'Published events from today on' })
  upcoming: number;

  @ApiProperty({ example: 2, description: 'Upcoming events still open for replies' })
  awaiting_replies: number;

  @ApiProperty({ example: 1 })
  drafts: number;

  @ApiProperty({ example: 1 })
  cancelled: number;
}

export class MyChildRsvpDto {
  @ApiProperty({ type: RefDto })
  student: RefDto;

  @ApiProperty({ enum: RSVP_RESPONSES, nullable: true, description: 'null until replied' })
  response: RsvpResponse | null;

  @ApiProperty({ nullable: true, type: Date })
  responded_at: Date | null;
}

export class MyEventDto {
  @ApiProperty({ example: 5 })
  id: number;

  @ApiProperty({ example: 'Annual sports day' })
  title: string;

  @ApiProperty({ nullable: true, type: String })
  description: string | null;

  @ApiProperty({ example: '2026-12-12' })
  event_date: string;

  @ApiProperty({ nullable: true, type: String })
  start_time: string | null;

  @ApiProperty({ nullable: true, type: String })
  end_time: string | null;

  @ApiProperty({ nullable: true, type: String })
  venue: string | null;

  @ApiProperty({ enum: EVENT_STATUSES, description: 'published or cancelled' })
  status: EventStatus;

  @ApiProperty({ nullable: true, type: String })
  cancel_reason: string | null;

  @ApiProperty({ example: true })
  rsvp_required: boolean;

  @ApiProperty({ nullable: true, type: Date })
  rsvp_deadline: Date | null;

  @ApiProperty({ example: true })
  rsvp_open: boolean;

  @ApiProperty({ type: MyChildRsvpDto, isArray: true, description: 'My invited children and their replies' })
  my_rsvps: MyChildRsvpDto[];
}
