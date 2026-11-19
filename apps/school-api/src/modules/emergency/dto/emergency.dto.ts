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
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ListQueryDto, PaginationDto } from '@app/common';
import { RefDto } from '../../students/dto/student-response.dto';
import {
  BROADCAST_STATUSES,
  BroadcastStatus,
  DELIVERY_STATUSES,
  DeliveryStatus,
  EMERGENCY_AUDIENCES,
  EMERGENCY_CATEGORIES,
  EMERGENCY_CHANNELS,
  EMERGENCY_SEVERITIES,
  EmergencyAudience,
  EmergencyCategory,
  EmergencyChannel,
  EmergencySeverity,
  END_REASONS,
  EndReason,
  EXPIRY_UNITS,
  ExpiryUnit,
  RECIPIENT_KINDS,
  RecipientKind,
  STAFF_GROUPS,
  StaffGroup,
} from '../entities/emergency.entity';
import { BROADCAST_STATES, BroadcastState } from '../emergency.logic';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class EmergencyAudienceDto {
  @ApiProperty({
    enum: EMERGENCY_AUDIENCES,
    example: 'parents',
    description:
      'everyone = all parents and all staff; parents; staff; classes, sections or students = parents of those (add include_teachers for their teachers)',
  })
  @IsIn(EMERGENCY_AUDIENCES, { message: 'audience must be everyone, parents, staff, classes, sections or students' })
  audience: EmergencyAudience;

  @ApiPropertyOptional({ type: [Number], example: [7, 8], description: 'Required when audience is classes' })
  @ValidateIf((dto: EmergencyAudienceDto) => dto.audience === 'classes')
  @IsArray()
  @ArrayMinSize(1, { message: 'Choose at least one class' })
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsInt({ each: true })
  class_ids?: number[];

  @ApiPropertyOptional({ type: [Number], example: [21], description: 'Required when audience is sections' })
  @ValidateIf((dto: EmergencyAudienceDto) => dto.audience === 'sections')
  @IsArray()
  @ArrayMinSize(1, { message: 'Choose at least one section' })
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsInt({ each: true })
  section_ids?: number[];

  @ApiPropertyOptional({ type: [Number], example: [41], description: 'Required when audience is students' })
  @ValidateIf((dto: EmergencyAudienceDto) => dto.audience === 'students')
  @IsArray()
  @ArrayMinSize(1, { message: 'Choose at least one student' })
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsInt({ each: true })
  student_ids?: number[];

  @ApiPropertyOptional({ example: false, description: 'Also send to the teachers of those classes or sections' })
  @IsOptional()
  @IsBoolean()
  include_teachers?: boolean;

  @ApiPropertyOptional({
    type: [String],
    enum: STAFF_GROUPS,
    example: ['drivers'],
    description:
      'With audience staff: only these groups. teachers = teaching staff, drivers = drivers and attendants, office = other non-teaching staff. Leave out for all staff.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Choose at least one staff group' })
  @ArrayUnique()
  @IsIn(STAFF_GROUPS, { each: true, message: 'staff_groups must be teachers, drivers or office' })
  staff_groups?: StaffGroup[];
}

export class ExpiryDto {
  @ApiProperty({ example: 2, minimum: 1, maximum: 100000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  value: number;

  @ApiProperty({ enum: EXPIRY_UNITS, example: 'hours' })
  @IsIn(EXPIRY_UNITS, { message: 'unit must be seconds, minutes, hours, days, months or years' })
  unit: ExpiryUnit;
}

export class CreateEmergencyDto extends EmergencyAudienceDto {
  @ApiProperty({ example: 'School closed today due to heavy rain', minLength: 3, maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(3, 120)
  title: string;

  @ApiProperty({ example: 'Due to heavy rain, the school is closed today.', minLength: 5, maxLength: 1000 })
  @Transform(trim)
  @IsString()
  @Length(5, 1000)
  message: string;

  @ApiPropertyOptional({ example: 'கனமழை காரணமாக இன்று பள்ளி விடுமுறை', maxLength: 120 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  title_ta?: string;

  @ApiPropertyOptional({ example: 'கனமழை காரணமாக இன்று பள்ளி விடுமுறை.', maxLength: 1000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  message_ta?: string;

  @ApiProperty({ enum: EMERGENCY_CATEGORIES, example: 'weather' })
  @IsIn(EMERGENCY_CATEGORIES, {
    message: 'category must be weather, school_closed, security, health, transport, all_clear or other',
  })
  category: EmergencyCategory;

  @ApiPropertyOptional({ enum: EMERGENCY_SEVERITIES, default: 'critical' })
  @IsOptional()
  @IsIn(EMERGENCY_SEVERITIES, { message: 'severity must be info, warning or critical' })
  severity?: EmergencySeverity;

  @ApiPropertyOptional({
    type: [String],
    enum: EMERGENCY_CHANNELS,
    default: ['push', 'sms'],
    description: 'In-app is always on. SMS goes to every recipient with a mobile number, also those without the app.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Choose push, SMS or both' })
  @ArrayUnique()
  @IsIn(EMERGENCY_CHANNELS, { each: true, message: 'channels must be push or sms' })
  channels?: EmergencyChannel[];

  @ApiPropertyOptional({
    example: '3f6c1e2a-web-1731739200000',
    description: 'Any unique text from the screen; sending twice with the same value returns the first broadcast',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  client_id?: string;

  @ApiPropertyOptional({
    example: 12,
    description: 'Id of the broadcast this follows up. A follow-up with category all_clear also ends that broadcast.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  follow_up_of?: number;

  @ApiPropertyOptional({
    type: ExpiryDto,
    description:
      'How long it stays on screen after it goes out: 5 seconds up to 5 years. Leave out to keep it until someone ends it.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ExpiryDto)
  expires_in?: ExpiryDto;

  @ApiPropertyOptional({
    example: '2026-11-18T06:00:00+05:30',
    description: 'Send later: at least 1 minute ahead and within 60 days. Leave out to send now.',
  })
  @IsOptional()
  @IsDateString({}, { message: 'send_at must be a date and time' })
  send_at?: string;
}

export class ReviewEmergencyDto {
  @ApiPropertyOptional({ example: 'Please add the reopening date', maxLength: 255 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  note?: string;
}

export class ExpiryOutDto {
  @ApiProperty({ example: 2 })
  value: number;

  @ApiProperty({ enum: EXPIRY_UNITS })
  unit: ExpiryUnit;

  @ApiProperty({ example: '2 hours' })
  label: string;
}

export class EmergencyPreviewDto {
  @ApiProperty({ example: 412, description: 'People who will get it' })
  recipients: number;

  @ApiProperty({ example: 380 })
  parents: number;

  @ApiProperty({ example: 32 })
  staff: number;

  @ApiProperty({ example: 350, description: 'Signed in to an app: in-app and push' })
  with_app: number;

  @ApiProperty({ example: 405, description: 'Have a mobile number: SMS' })
  with_mobile: number;

  @ApiProperty({ example: 55, description: 'No app, reached by SMS only' })
  sms_only: number;

  @ApiProperty({ example: 2, description: 'No app and no mobile number: cannot be reached' })
  unreachable: number;
}

export class ChannelCountsDto {
  @ApiProperty({ example: 0 })
  pending: number;

  @ApiProperty({ example: 0 })
  sending: number;

  @ApiProperty({ example: 340 })
  sent: number;

  @ApiProperty({ example: 2 })
  failed: number;

  @ApiProperty({ example: 8, description: 'Not sent, with a reason (for example push turned off)' })
  skipped: number;
}

export class EmergencyCountsDto {
  @ApiProperty({ example: 412 })
  total: number;

  @ApiProperty({ example: 380 })
  parents: number;

  @ApiProperty({ example: 32 })
  staff: number;

  @ApiProperty({ example: 350 })
  in_app: number;

  @ApiProperty({ type: ChannelCountsDto })
  push: ChannelCountsDto;

  @ApiProperty({ type: ChannelCountsDto })
  sms: ChannelCountsDto;

  @ApiProperty({ example: 401, description: 'Got it by push or SMS' })
  reached: number;

  @ApiProperty({ example: 290 })
  read: number;

  @ApiProperty({ example: 260 })
  acknowledged: number;

  @ApiProperty({ nullable: true, type: Number, example: 97.3 })
  reached_percent: number | null;

  @ApiProperty({ nullable: true, type: Number, example: 63.1 })
  acknowledged_percent: number | null;
}

export class EmergencyBroadcastDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 'School closed today due to heavy rain' })
  title: string;

  @ApiProperty()
  message: string;

  @ApiProperty({ nullable: true, type: String })
  title_ta: string | null;

  @ApiProperty({ nullable: true, type: String })
  message_ta: string | null;

  @ApiProperty({ enum: EMERGENCY_CATEGORIES })
  category: EmergencyCategory;

  @ApiProperty({ enum: EMERGENCY_SEVERITIES })
  severity: EmergencySeverity;

  @ApiProperty({ enum: EMERGENCY_AUDIENCES })
  audience: EmergencyAudience;

  @ApiProperty({ example: 'Parents of 6 - A, 6 - B', description: 'Who it went to, in words' })
  audience_label: string;

  @ApiProperty({ type: [Number] })
  class_ids: number[];

  @ApiProperty({ type: [Number] })
  section_ids: number[];

  @ApiProperty({ type: [Number] })
  student_ids: number[];

  @ApiProperty()
  include_teachers: boolean;

  @ApiProperty({ type: [String], enum: STAFF_GROUPS, description: 'Staff groups it went to; empty = all staff' })
  staff_groups: StaffGroup[];

  @ApiProperty({ type: [String], enum: EMERGENCY_CHANNELS })
  channels: EmergencyChannel[];

  @ApiProperty({
    enum: BROADCAST_STATUSES,
    description: 'Delivery: pending_approval, scheduled, sending, sent, partly_failed, rejected or cancelled',
  })
  status: BroadcastStatus;

  @ApiProperty({
    enum: BROADCAST_STATES,
    description: 'What to show: pending_approval, scheduled, active (on screen), expired, ended, rejected or cancelled',
  })
  state: BroadcastState;

  @ApiProperty({ nullable: true, type: Date, description: 'When a scheduled broadcast goes out' })
  send_at: Date | null;

  @ApiProperty({ type: ExpiryOutDto, nullable: true })
  expiry: ExpiryOutDto | null;

  @ApiProperty({ nullable: true, type: Date, description: 'When it leaves the screen; null = until ended' })
  expires_at: Date | null;

  @ApiProperty({ nullable: true, type: Date })
  ended_at: Date | null;

  @ApiProperty({ enum: END_REASONS, nullable: true, description: 'expired, ended (End now) or all_clear' })
  end_reason: EndReason | null;

  @ApiProperty({ type: RefDto, nullable: true })
  ended_by: RefDto | null;

  @ApiProperty({ type: RefDto, nullable: true, description: 'Who approved or rejected it' })
  reviewed_by: RefDto | null;

  @ApiProperty({ nullable: true, type: Date })
  reviewed_at: Date | null;

  @ApiProperty({ nullable: true, type: String })
  review_note: string | null;

  @ApiProperty({ type: RefDto, nullable: true })
  sent_by: RefDto | null;

  @ApiProperty()
  sent_at: Date;

  @ApiProperty({ nullable: true, type: Date })
  completed_at: Date | null;

  @ApiProperty({ type: RefDto, nullable: true, description: 'The broadcast this follows up' })
  follow_up_of: RefDto | null;

  @ApiProperty({ type: EmergencyCountsDto })
  counts: EmergencyCountsDto;
}

export class EmergencyQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: EMERGENCY_CATEGORIES })
  @IsOptional()
  @IsIn(EMERGENCY_CATEGORIES, { message: 'category is not valid' })
  category?: EmergencyCategory;

  @ApiPropertyOptional({ enum: BROADCAST_STATUSES })
  @IsOptional()
  @IsIn(BROADCAST_STATUSES, { message: 'status is not valid' })
  status?: BroadcastStatus;

  @ApiPropertyOptional({ enum: BROADCAST_STATES })
  @IsOptional()
  @IsIn(BROADCAST_STATES, { message: 'state is not valid' })
  state?: BroadcastState;

  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-30' })
  @IsOptional()
  @IsString()
  to?: string;
}

export const RECIPIENT_FILTERS = ['all', 'failed', 'not_read', 'not_acknowledged', 'sms_only', 'unreachable'] as const;
export type RecipientFilter = (typeof RECIPIENT_FILTERS)[number];

export class RecipientsQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: RECIPIENT_FILTERS, default: 'all' })
  @IsOptional()
  @IsIn(RECIPIENT_FILTERS, {
    message: 'filter must be all, failed, not_read, not_acknowledged, sms_only or unreachable',
  })
  filter?: RecipientFilter;

  @ApiPropertyOptional({ example: 'Lakshmi', description: 'Name, mobile or child name' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  search?: string;
}

export class RecipientStudentDto {
  @ApiProperty({ example: 41 })
  id: number;

  @ApiProperty({ example: 'Kavin Narayanan' })
  name: string;

  @ApiProperty({ nullable: true, type: String, example: '6 - A' })
  section: string | null;
}

export class EmergencyRecipientDto {
  @ApiProperty({ example: 301 })
  id: number;

  @ApiProperty({ enum: RECIPIENT_KINDS })
  kind: RecipientKind;

  @ApiProperty({ example: 'Lakshmi Narayanan' })
  name: string;

  @ApiProperty({ nullable: true, type: String, example: '9000000005' })
  mobile: string | null;

  @ApiProperty({ description: 'Signed in to an app' })
  has_app: boolean;

  @ApiProperty({ type: [RecipientStudentDto] })
  students: RecipientStudentDto[];

  @ApiProperty({ enum: DELIVERY_STATUSES })
  push_status: DeliveryStatus;

  @ApiProperty({ nullable: true, type: String })
  push_error: string | null;

  @ApiProperty({ enum: DELIVERY_STATUSES })
  sms_status: DeliveryStatus;

  @ApiProperty({ nullable: true, type: String })
  sms_error: string | null;

  @ApiProperty({ nullable: true, type: Date })
  read_at: Date | null;

  @ApiProperty({ nullable: true, type: Date })
  acknowledged_at: Date | null;
}

export const RESEND_TARGETS = ['failed', 'not_acknowledged'] as const;
export type ResendTarget = (typeof RESEND_TARGETS)[number];

export class ResendDto {
  @ApiProperty({
    enum: RESEND_TARGETS,
    example: 'failed',
    description:
      'failed: retry the channels that failed. not_acknowledged: send again by push and SMS to everyone who has not acknowledged',
  })
  @IsIn(RESEND_TARGETS, { message: 'target must be failed or not_acknowledged' })
  target: ResendTarget;

  @ApiPropertyOptional({
    type: [String],
    enum: EMERGENCY_CHANNELS,
    example: ['sms'],
    description:
      "Only these channels, for example SMS only to people who have not seen it. Default: the broadcast's channels.",
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Choose push, SMS or both' })
  @ArrayUnique()
  @IsIn(EMERGENCY_CHANNELS, { each: true, message: 'channels must be push or sms' })
  channels?: EmergencyChannel[];
}

export class ResendResultDto {
  @ApiProperty({ example: 12, description: 'People queued again' })
  queued: number;
}

export class EmergencyInsightsDto {
  @ApiProperty({ example: 3, description: 'Broadcasts this month' })
  this_month: number;

  @ApiProperty({ example: 1180 })
  recipients: number;

  @ApiProperty({ nullable: true, type: Number, example: 96.4 })
  reached_percent: number | null;

  @ApiProperty({ nullable: true, type: Number, example: 71.2 })
  acknowledged_percent: number | null;

  @ApiProperty({ example: 0, description: 'Broadcasts still sending' })
  sending: number;

  @ApiProperty({ type: EmergencyBroadcastDto, nullable: true })
  last: EmergencyBroadcastDto | null;
}

export class EmergencyTemplateDto {
  @ApiProperty({ example: 4, description: "The school's own ready message" })
  id: number;

  @ApiProperty({ example: 't4' })
  key: string;

  @ApiProperty({ example: true })
  is_active: boolean;

  @ApiProperty({ example: 1 })
  sort_order: number;

  @ApiProperty({ enum: EMERGENCY_CATEGORIES })
  category: EmergencyCategory;

  @ApiProperty({ enum: EMERGENCY_SEVERITIES })
  severity: EmergencySeverity;

  @ApiProperty()
  title: string;

  @ApiProperty()
  message: string;

  @ApiProperty({ nullable: true, type: String })
  title_ta: string | null;

  @ApiProperty({ nullable: true, type: String })
  message_ta: string | null;
}

export class TemplateQueryDto {
  @ApiPropertyOptional({ example: true, description: 'Also the switched-off ones (manage screen)' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  all?: boolean;
}

export class EmergencyTemplateInputDto {
  @ApiProperty({ enum: EMERGENCY_CATEGORIES, example: 'weather' })
  @IsIn(EMERGENCY_CATEGORIES, { message: 'category is not valid' })
  category: EmergencyCategory;

  @ApiPropertyOptional({ enum: EMERGENCY_SEVERITIES, default: 'warning' })
  @IsOptional()
  @IsIn(EMERGENCY_SEVERITIES, { message: 'severity must be info, warning or critical' })
  severity?: EmergencySeverity;

  @ApiProperty({ example: 'Water logging near the main gate', minLength: 3, maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(3, 120)
  title: string;

  @ApiProperty({ example: 'Please use the back gate on Anna Street today.', minLength: 5, maxLength: 1000 })
  @Transform(trim)
  @IsString()
  @Length(5, 1000)
  message: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  title_ta?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  message_ta?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  sort_order?: number;
}

export class EmergencyTemplateUpdateDto {
  @ApiPropertyOptional({ enum: EMERGENCY_CATEGORIES })
  @IsOptional()
  @IsIn(EMERGENCY_CATEGORIES, { message: 'category is not valid' })
  category?: EmergencyCategory;

  @ApiPropertyOptional({ enum: EMERGENCY_SEVERITIES })
  @IsOptional()
  @IsIn(EMERGENCY_SEVERITIES, { message: 'severity must be info, warning or critical' })
  severity?: EmergencySeverity;

  @ApiPropertyOptional({ minLength: 3, maxLength: 120 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(3, 120)
  title?: string;

  @ApiPropertyOptional({ minLength: 5, maxLength: 1000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(5, 1000)
  message?: string;

  @ApiPropertyOptional({ maxLength: 120, description: 'Empty text clears it' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  title_ta?: string;

  @ApiPropertyOptional({ maxLength: 1000, description: 'Empty text clears it' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  message_ta?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  sort_order?: number;
}

export class MyEmergencyDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 'School closed today due to heavy rain', description: 'In my language when available' })
  title: string;

  @ApiProperty()
  message: string;

  @ApiProperty({ enum: EMERGENCY_CATEGORIES })
  category: EmergencyCategory;

  @ApiProperty({ enum: EMERGENCY_SEVERITIES })
  severity: EmergencySeverity;

  @ApiProperty({ example: 'Tamilzorous Model School' })
  school: string;

  @ApiProperty({ type: [RecipientStudentDto], description: 'My children it is about (parents)' })
  students: RecipientStudentDto[];

  @ApiProperty()
  sent_at: Date;

  @ApiProperty({ nullable: true, type: Date })
  read_at: Date | null;

  @ApiProperty({ nullable: true, type: Date })
  acknowledged_at: Date | null;

  @ApiProperty({ nullable: true, type: Number, description: 'The broadcast this follows up' })
  follow_up_of: number | null;

  @ApiProperty({ example: true, description: 'false once it has expired or the school ended it: hide the red strip' })
  is_active: boolean;

  @ApiProperty({ nullable: true, type: Date })
  expires_at: Date | null;

  @ApiProperty({ nullable: true, type: Date })
  ended_at: Date | null;

  @ApiProperty({ enum: END_REASONS, nullable: true })
  end_reason: EndReason | null;
}

export class MyEmergencyQueryDto extends PaginationDto {
  @ApiPropertyOptional({ example: true, description: 'Only the ones I have not acknowledged' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  pending?: boolean;

  @ApiPropertyOptional({
    example: false,
    description: 'Also the expired and ended ones (history). By default only messages still on screen are listed.',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  include_ended?: boolean;
}
