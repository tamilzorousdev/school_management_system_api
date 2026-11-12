import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ListQueryDto, PaginationDto } from '@app/common';
import { IsDateOnly } from '../../../shared/dates';
import { RefDto } from '../../students/dto/student-response.dto';
import {
  MEETING_PARTIES,
  MEETING_RESPONSES,
  MEETING_STATUSES,
  MeetingParty,
  MeetingResponse,
  MeetingStatus,
} from '../entities/meeting.entity';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

export const MEETING_SCOPES = ['upcoming', 'past', 'all'] as const;
export type MeetingScope = (typeof MEETING_SCOPES)[number];
export const MEETING_WHEN = ['today', 'upcoming', 'past'] as const;
export type MeetingWhen = (typeof MEETING_WHEN)[number];
export const CALL_PLATFORMS = ['android', 'ios', 'web'] as const;

const ISO_WITH_ZONE = /(Z|[+-]\d{2}:\d{2})$/;

class MeetingInputBase {
  @ApiProperty({ example: 'Maths progress', maxLength: 150 })
  @Transform(trim)
  @MaxLength(150)
  @IsString()
  @IsNotEmpty({ message: 'Enter a title for the meeting' })
  title: string;

  @ApiPropertyOptional({ example: 'Talk about the unit test marks', nullable: true, type: String, maxLength: 500 })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @MaxLength(500)
  agenda?: string | null;

  @ApiProperty({
    example: '2026-11-11T16:30:00+05:30',
    description: 'Start time with its offset. Up to 60 days ahead.',
  })
  @Matches(ISO_WITH_ZONE, { message: 'scheduled_at must include the time zone, for example +05:30' })
  @IsISO8601({ strict: true }, { message: 'scheduled_at must be a date and time like 2026-11-11T16:30:00+05:30' })
  scheduled_at: string;

  @ApiPropertyOptional({ example: 15, default: 15, minimum: 5, maximum: 60 })
  @IsOptional()
  @Max(60)
  @Min(5)
  @IsInt({ message: 'duration_minutes must be a whole number of minutes' })
  duration_minutes?: number;
}

export class TeacherMeetingInputDto extends MeetingInputBase {
  @ApiProperty({ example: 12, description: 'Student the meeting is about. Must be in one of my sections.' })
  @Min(1)
  @IsInt({ message: 'Choose the student' })
  student_id: number;

  @ApiPropertyOptional({
    example: 31,
    description: 'Parent user to meet. Leave out to use the primary guardian who has the app.',
  })
  @IsOptional()
  @Min(1)
  @IsInt()
  parent_user_id?: number;
}

export class ParentMeetingInputDto extends MeetingInputBase {
  @ApiProperty({ example: 9, description: 'A teacher of the child, from GET /mobile/parent/children/{id}/teachers' })
  @Min(1)
  @IsInt({ message: 'Choose the teacher' })
  teacher_user_id: number;
}

export class RespondMeetingDto {
  @ApiPropertyOptional({
    example: 'Can we do it after 4 pm?',
    nullable: true,
    type: String,
    maxLength: 255,
    description: 'Optional note, for example why you decline',
  })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @MaxLength(255)
  note?: string | null;
}

export class CancelMeetingDto {
  @ApiPropertyOptional({ example: 'I am on leave that day', nullable: true, type: String, maxLength: 255 })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @MaxLength(255)
  reason?: string | null;
}

export class ExtendMeetingDto {
  @ApiProperty({
    example: 10,
    minimum: 5,
    maximum: 60,
    description: 'Minutes to add to the scheduled end (120 in total)',
  })
  @Max(60)
  @Min(5)
  @IsInt({ message: 'minutes must be a whole number of minutes' })
  minutes: number;
}

export class JoinMeetingDto {
  @ApiPropertyOptional({ enum: CALL_PLATFORMS, default: 'android' })
  @IsOptional()
  @IsIn(CALL_PLATFORMS)
  platform?: (typeof CALL_PLATFORMS)[number];
}

export class MobileMeetingQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: MEETING_SCOPES,
    default: 'upcoming',
    description:
      'upcoming: scheduled, in progress or over time, soonest first. past: completed, missed or cancelled, newest first. Current academic year only.',
  })
  @IsOptional()
  @IsIn(MEETING_SCOPES)
  scope: MeetingScope = 'upcoming';

  @ApiPropertyOptional({ example: 12, description: 'Parent app: only this child' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  student_id?: number;
}

export class MeetingQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: MEETING_STATUSES })
  @IsOptional()
  @IsIn(MEETING_STATUSES)
  status?: MeetingStatus;

  @ApiPropertyOptional({ enum: MEETING_WHEN, description: 'today, upcoming (not started yet) or past' })
  @IsOptional()
  @IsIn(MEETING_WHEN)
  when?: MeetingWhen;

  @ApiPropertyOptional({ enum: MEETING_PARTIES, description: 'Who booked the meeting' })
  @IsOptional()
  @IsIn(MEETING_PARTIES)
  scheduled_by?: MeetingParty;

  @ApiPropertyOptional({ example: 9 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  teacher_user_id?: number;

  @ApiPropertyOptional({ example: 5, description: 'Parent record id (from the parents list)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  guardian_id?: number;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  student_id?: number;

  @IsDateOnly('2026-11-01', true)
  date_from?: string;

  @IsDateOnly('2026-11-30', true)
  date_to?: string;
}

export class MeetingPersonDto {
  @ApiProperty({ example: 9, description: 'User id' })
  id: number;

  @ApiProperty({ example: 'Priya Venkatesh' })
  name: string;

  @ApiProperty({ enum: MEETING_PARTIES, example: 'teacher' })
  role: MeetingParty;

  @ApiProperty({ example: 'Class teacher', nullable: true, type: String, description: 'Relation or teaching role' })
  label: string | null;
}

export class MeetingStudentDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 'Kavin Narayanan' })
  name: string;

  @ApiProperty({ example: '6 - A', nullable: true, type: String })
  class_section: string | null;
}

export class MeetingDto {
  @ApiProperty({ example: 4 })
  id: number;

  @ApiProperty({ example: 'Maths progress' })
  title: string;

  @ApiProperty({ example: 'Talk about the unit test marks', nullable: true, type: String })
  agenda: string | null;

  @ApiProperty({ enum: MEETING_STATUSES, example: 'scheduled' })
  status: MeetingStatus;

  @ApiProperty({
    enum: MEETING_RESPONSES,
    example: 'accepted',
    description:
      'Reply of the invited side (to): pending, accepted or declined. Like a Teams invite: joining works whatever the reply.',
  })
  response: MeetingResponse;

  @ApiProperty({ nullable: true, type: Date, example: '2026-11-12T10:15:00.000+05:30' })
  responded_at: Date | null;

  @ApiProperty({ nullable: true, type: String, example: 'Can we do it after 4 pm?' })
  response_note: string | null;

  @ApiProperty({ example: '2026-11-11T16:30:00.000+05:30' })
  scheduled_at: Date;

  @ApiProperty({ example: '2026-11-11T16:45:00.000+05:30', description: 'Scheduled end, including extensions' })
  ends_at: Date;

  @ApiProperty({ example: 15, description: 'Booked length' })
  duration_minutes: number;

  @ApiProperty({ example: 0, description: 'Minutes the host added' })
  extended_minutes: number;

  @ApiProperty({ nullable: true, type: Date })
  extended_at: Date | null;

  @ApiProperty({ type: RefDto, nullable: true })
  extended_by: RefDto | null;

  @ApiProperty({ type: RefDto, description: 'Academic year the meeting belongs to' })
  academic_year: RefDto;

  @ApiProperty({ example: 9, description: 'Host user id (the teacher). Only the host can extend or end.' })
  host_id: number;

  @ApiProperty({ enum: MEETING_PARTIES, example: 'teacher', description: 'Who booked it' })
  scheduled_by: MeetingParty;

  @ApiProperty({ type: MeetingPersonDto, description: 'The person who booked the meeting' })
  from: MeetingPersonDto;

  @ApiProperty({ type: MeetingPersonDto, description: 'The person it was booked with' })
  to: MeetingPersonDto;

  @ApiProperty({ type: MeetingPersonDto })
  teacher: MeetingPersonDto;

  @ApiProperty({ type: MeetingPersonDto })
  parent: MeetingPersonDto;

  @ApiProperty({ type: MeetingStudentDto })
  student: MeetingStudentDto;

  @ApiProperty({
    example: false,
    description:
      'True from 10 minutes before the start. A meeting that has started stays joinable until the host ends it, even past its end time.',
  })
  can_join: boolean;

  @ApiProperty({
    example: { teacher: true, parent: false },
    description: 'Who is in the call right now. Ring only when the other side is in and you are not.',
  })
  in_call: { teacher: boolean; parent: boolean };

  @ApiProperty({ example: 1, description: 'People in the call right now (0, 1 or 2)' })
  active_participants: number;

  @ApiProperty({ example: '2026-11-11T16:20:00.000+05:30' })
  join_opens_at: Date;

  @ApiProperty({
    example: '2026-11-11T17:15:00.000+05:30',
    nullable: true,
    type: Date,
    description:
      'Last moment Join works: for a meeting nobody joined, end + 30 min (then missed); for a live one, end + 10 min (then it closes and the call is ended for everyone). Show it as the expiry.',
  })
  join_closes_at: Date | null;

  @ApiProperty({ nullable: true, type: Date })
  started_at: Date | null;

  @ApiProperty({ nullable: true, type: Date })
  ended_at: Date | null;

  @ApiProperty({
    example: 12,
    nullable: true,
    type: Number,
    description: 'Actual length: first join to the end (or to now while it runs), independent of the booked length',
  })
  call_minutes: number | null;

  @ApiProperty({ type: RefDto, nullable: true })
  ended_by: RefDto | null;

  @ApiProperty({
    enum: ['host_ended', 'empty', 'time_up'],
    nullable: true,
    description:
      'host_ended (the teacher ended it), empty (everyone had left for 5 minutes) or time_up (closed 10 minutes after the end time, extensions included)',
  })
  end_reason: 'host_ended' | 'empty' | 'time_up' | null;

  @ApiProperty({ type: RefDto, nullable: true })
  cancelled_by: RefDto | null;

  @ApiProperty({ nullable: true, type: String })
  cancel_reason: string | null;

  @ApiProperty({ example: '2026-11-04T10:12:00.000+05:30' })
  created_at: Date;
}

export class MeetingCallLogDto {
  @ApiProperty({ type: RefDto })
  user: RefDto;

  @ApiProperty({ enum: MEETING_PARTIES })
  party: MeetingParty;

  @ApiProperty({ example: 'android' })
  platform: string;

  @ApiProperty({ enum: ['app', 'agora'], description: 'app: reported by the app; agora: from the Agora webhook' })
  source: 'app' | 'agora';

  @ApiProperty({ nullable: true, type: String, example: 'network', description: 'Agora leave reason when known' })
  leave_reason: string | null;

  @ApiProperty({ example: '2026-11-11T16:29:10.000+05:30' })
  joined_at: Date;

  @ApiProperty({ nullable: true, type: Date })
  left_at: Date | null;

  @ApiProperty({ example: 11, nullable: true, type: Number })
  minutes: number | null;
}

export class MeetingDetailDto extends MeetingDto {
  @ApiProperty({ type: MeetingCallLogDto, isArray: true, description: 'Every join and leave, oldest first' })
  call_log: MeetingCallLogDto[];
}

export class MeetingJoinDto {
  @ApiProperty({ example: 'agora' })
  provider: 'agora';

  @ApiProperty({ example: '0123456789abcdef0123456789abcdef', description: 'Agora App ID for the SDK engine' })
  app_id: string;

  @ApiProperty({ example: 'tzs_1_5f2c9a1b7d3e', description: 'Agora channel to join' })
  channel_name: string;

  @ApiProperty({
    example: 18,
    description:
      'Agora uid for this person on this side: user id × 2 for the teacher, user id × 2 + 1 for the parent, so it is unique in the channel even when one person is both',
  })
  uid: number;

  @ApiProperty({ example: '007eJxTYJ...', description: 'Agora RTC token (publisher)' })
  token: string;

  @ApiProperty({
    example: '2026-11-11T16:45:00.000+05:30',
    description: 'Short-lived (AGORA_TOKEN_TTL_SECONDS). Call POST .../token on onTokenPrivilegeWillExpire.',
  })
  expires_at: Date;

  @ApiProperty({ enum: ['host', 'participant'], description: 'host can extend and end for everyone' })
  role: 'host' | 'participant';

  @ApiProperty({ type: MeetingDto })
  meeting: MeetingDto;
}

export class MeetingInsightsDto {
  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 3 })
  today: number;

  @ApiProperty({ example: 8 })
  upcoming: number;

  @ApiProperty({ example: 1, description: 'in_progress or time_exceeded right now' })
  live: number;

  @ApiProperty({ example: 1, description: 'Running past the scheduled end' })
  time_exceeded: number;

  @ApiProperty({ example: 25 })
  completed: number;

  @ApiProperty({ example: 4 })
  missed: number;

  @ApiProperty({ example: 4 })
  cancelled: number;
}

export class MeetingTeacherOptionDto {
  @ApiProperty({ example: 9, description: 'User id to send as teacher_user_id' })
  id: number;

  @ApiProperty({ example: 'Priya Venkatesh' })
  name: string;

  @ApiProperty({ example: true })
  is_class_teacher: boolean;

  @ApiProperty({ example: ['Mathematics'], type: String, isArray: true })
  subjects: string[];
}

export class MeetingParentOptionDto {
  @ApiProperty({ example: 31, description: 'User id to send as parent_user_id' })
  id: number;

  @ApiProperty({ example: 'Lakshmi Narayanan' })
  name: string;

  @ApiProperty({ example: 'mother' })
  relation: string;

  @ApiProperty({ example: true })
  is_primary: boolean;

  @ApiProperty({
    example: false,
    description: 'This parent is the signed-in teacher. Hide for meetings (400 SAME_PERSON); chat is allowed.',
  })
  is_me?: boolean;
}
