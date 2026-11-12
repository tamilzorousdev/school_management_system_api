import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ListQueryDto, PaginationDto, toBoolean } from '@app/common';
import { FileDto } from '../../files/dto/file.dto';
import { RefDto } from '../../students/dto/student-response.dto';
import { CHAT_MESSAGE_KINDS, CHAT_PARTIES, ChatMessageKind, ChatParty } from '../entities/chat.entity';

const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class TeacherThreadInputDto {
  @ApiProperty({ example: 12, description: 'Student the conversation is about. Must be in one of my sections.' })
  @Min(1)
  @IsInt({ message: 'Choose the student' })
  student_id: number;

  @ApiPropertyOptional({ example: 31, description: 'Parent user. Leave out to use the primary parent with the app.' })
  @IsOptional()
  @Min(1)
  @IsInt()
  parent_user_id?: number;
}

export class ParentThreadInputDto {
  @ApiProperty({ example: 9, description: 'A teacher of the child, from GET /mobile/parent/children/{id}/teachers' })
  @Min(1)
  @IsInt({ message: 'Choose the teacher' })
  teacher_user_id: number;
}

export class SendMessageDto {
  @ApiPropertyOptional({
    example: 'Kavin was unwell yesterday, so the homework is late.',
    nullable: true,
    maxLength: 2000,
  })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf((_dto, value) => value !== null)
  @MaxLength(2000)
  @IsString()
  body?: string | null;

  @ApiPropertyOptional({ example: null, nullable: true, type: Number, description: 'Uploaded file (POST /files)' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @Min(1)
  @IsInt()
  file_id?: number | null;

  @ApiPropertyOptional({
    example: 42,
    description:
      'Length in seconds of a voice message or video, measured by the app. Required for a video (at most 120 s); voice has no limit.',
  })
  @IsOptional()
  @Min(1)
  @Max(86400)
  @IsInt()
  duration_seconds?: number;
}

export const DELETE_SCOPES = ['me', 'everyone'] as const;
export type DeleteScope = (typeof DELETE_SCOPES)[number];

export class DeleteMessageDto {
  @ApiProperty({
    enum: DELETE_SCOPES,
    example: 'everyone',
    description:
      'me: gone from my chat only. everyone: your own message, within 24 hours of sending; both sides see "This message was deleted" and it can be undone for 10 seconds.',
  })
  @IsIn(DELETE_SCOPES)
  for: DeleteScope;
}

export class FlagMessageDto {
  @ApiProperty({ example: 'Rude language', maxLength: 255 })
  @Transform(trim)
  @MaxLength(255)
  @IsString()
  @IsNotEmpty({ message: 'Say why you are reporting this message' })
  reason: string;
}

export class HideMessageDto {
  @ApiProperty({ example: 'Not appropriate for school communication', maxLength: 255 })
  @Transform(trim)
  @MaxLength(255)
  @IsString()
  @IsNotEmpty({ message: 'Give a reason for hiding it' })
  reason: string;
}

export class MessagesQueryDto {
  @ApiPropertyOptional({ example: 120, description: 'Load messages older than this id (scroll up)' })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @IsInt()
  before_id?: number;

  @ApiPropertyOptional({ example: 30, default: 30, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @Max(100)
  @Min(1)
  @IsInt()
  limit?: number;
}

export class ThreadsQueryDto extends PaginationDto {
  @ApiPropertyOptional({ example: 12, description: 'Parent app: only this child' })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @IsInt()
  student_id?: number;
}

export class AuditThreadsQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ example: true, description: 'Only conversations with flagged messages' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  flagged?: boolean;

  @ApiPropertyOptional({ example: 9 })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @IsInt()
  teacher_user_id?: number;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @IsInt()
  student_id?: number;

  @ApiPropertyOptional({
    example: 3,
    description:
      'An earlier academic year: its conversations are archived (hidden from the apps) and kept for 2 years after that year ends. Leave out for the current year.',
  })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @IsInt()
  academic_year_id?: number;
}

export class FlaggedQueryDto extends PaginationDto {
  @ApiPropertyOptional({ example: false, description: 'true: include flags already handled' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  include_resolved?: boolean;
}

export class ChatPersonDto {
  @ApiProperty({ example: 9 })
  id: number;

  @ApiProperty({ example: 'Priya Venkatesh' })
  name: string;

  @ApiProperty({ enum: CHAT_PARTIES })
  role: ChatParty;

  @ApiProperty({ example: 'mother', nullable: true, type: String })
  label: string | null;
}

export class OfficeHoursDto {
  @ApiProperty({ example: '08:00' })
  start: string;

  @ApiProperty({ example: '17:00' })
  end: string;

  @ApiProperty({ example: true, description: 'Monday to Saturday, not on holidays' })
  open_now: boolean;

  @ApiProperty({ nullable: true, type: Date, description: 'When the teacher will be told about messages sent now' })
  next_open_at: Date | null;
}

export class ChatThreadDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ type: ChatPersonDto })
  teacher: ChatPersonDto;

  @ApiProperty({ type: ChatPersonDto })
  parent: ChatPersonDto;

  @ApiProperty({ type: ChatPersonDto, description: 'The other person, from the caller’s side' })
  other: ChatPersonDto;

  @ApiProperty({ type: RefDto })
  student: RefDto;

  @ApiProperty({ example: '6 - A', nullable: true, type: String })
  class_section: string | null;

  @ApiProperty({ nullable: true, type: Date })
  last_message_at: Date | null;

  @ApiProperty({ nullable: true, type: String })
  last_message_preview: string | null;

  @ApiProperty({ example: 2, description: 'Unread messages for the caller (both sides for the office)' })
  unread: number;

  @ApiProperty({ example: 14 })
  message_count: number;

  @ApiProperty({ example: 0, description: 'Flagged messages the office has not handled' })
  open_flags: number;

  @ApiProperty({ type: OfficeHoursDto })
  office_hours: OfficeHoursDto;

  @ApiProperty({ type: RefDto })
  academic_year: RefDto;

  @ApiProperty({
    example: false,
    description: 'true for an earlier academic year: hidden from the apps, read-only for the office',
  })
  archived: boolean;
}

export class ChatMessageDto {
  @ApiProperty({ example: 120 })
  id: number;

  @ApiProperty({ example: 3 })
  thread_id: number;

  @ApiProperty({ type: RefDto })
  sender: RefDto;

  @ApiProperty({ enum: CHAT_PARTIES })
  sender_party: ChatParty;

  @ApiProperty({ nullable: true, type: String, description: 'null when the school hid the message' })
  body: string | null;

  @ApiProperty({ type: FileDto, nullable: true })
  file: FileDto | null;

  @ApiProperty()
  sent_at: Date;

  @ApiProperty({ nullable: true, type: Date, description: 'Read receipt: when the other person opened it' })
  read_at: Date | null;

  @ApiProperty({ example: false, description: 'Sent outside office hours; the teacher is told when they start' })
  held_for_office_hours: boolean;

  @ApiProperty({ example: false })
  flagged: boolean;

  @ApiProperty({ example: false })
  hidden: boolean;

  @ApiProperty({ enum: CHAT_MESSAGE_KINDS, example: 'voice', description: 'text, image, file, voice or video' })
  kind: ChatMessageKind;

  @ApiProperty({ example: 42, nullable: true, type: Number, description: 'Voice or video length in seconds' })
  duration_seconds: number | null;

  @ApiProperty({
    example: false,
    description: 'Deleted for everyone: show "This message was deleted"; body and file are null',
  })
  deleted: boolean;

  @ApiProperty({ nullable: true, type: Date })
  deleted_at: Date | null;

  @ApiProperty({ example: true, description: 'Your own message, not deleted, sent less than 24 hours ago' })
  can_delete_for_everyone: boolean;

  @ApiProperty({
    nullable: true,
    type: Date,
    description: 'You deleted it for everyone: show Undo until this time (10 seconds)',
  })
  undo_until: Date | null;
}

export class DeleteMessageResultDto {
  @ApiProperty({ example: 120 })
  message_id: number;

  @ApiProperty({ enum: DELETE_SCOPES })
  deleted_for: DeleteScope;

  @ApiProperty({ nullable: true, type: Date, description: 'Undo is possible until this time (everyone only)' })
  undo_until: Date | null;

  @ApiProperty({ type: ChatMessageDto, nullable: true, description: 'The message as it now shows (everyone only)' })
  message: ChatMessageDto | null;
}

export class ClearChatResultDto {
  @ApiProperty({ example: 3 })
  thread_id: number;

  @ApiProperty({ description: 'Messages up to this time are gone from my chat; the other person still has them' })
  cleared_at: Date;
}

export class AuditMessageDto extends ChatMessageDto {
  @ApiProperty({ nullable: true, type: String, description: 'Original text, also when hidden' })
  original_body: string | null;

  @ApiProperty({ nullable: true, type: String })
  flag_reason: string | null;

  @ApiProperty({ type: RefDto, nullable: true })
  flagged_by: RefDto | null;

  @ApiProperty({ nullable: true, type: Date })
  flagged_at: Date | null;

  @ApiProperty({ nullable: true, type: Date })
  flag_resolved_at: Date | null;

  @ApiProperty({ type: RefDto, nullable: true })
  hidden_by: RefDto | null;

  @ApiProperty({ nullable: true, type: String })
  hidden_reason: string | null;

  @ApiProperty({ type: RefDto, nullable: true, description: 'Who deleted it for everyone (the sender)' })
  deleted_by: RefDto | null;

  @ApiProperty({ type: [RefDto], description: 'People who deleted it for themselves' })
  deleted_for_me_by: RefDto[];
}

export class MessagesPageDto {
  @ApiProperty({ type: ChatMessageDto, isArray: true, description: 'Newest first' })
  items: ChatMessageDto[];

  @ApiProperty({ example: true, description: 'Older messages exist: call again with before_id' })
  has_more: boolean;
}

export class ChatAuditEntryDto {
  @ApiProperty({ type: RefDto })
  actor: RefDto;

  @ApiProperty({ example: 'viewed_thread' })
  action: string;

  @ApiProperty({ nullable: true, type: Number })
  message_id: number | null;

  @ApiProperty({ nullable: true, type: String })
  note: string | null;

  @ApiProperty()
  at: Date;
}

export class AuditThreadDetailDto extends ChatThreadDto {
  @ApiProperty({ type: AuditMessageDto, isArray: true, description: 'Whole conversation, oldest first' })
  messages: AuditMessageDto[];

  @ApiProperty({ type: ChatAuditEntryDto, isArray: true, description: 'Who from the office opened or changed it' })
  audit: ChatAuditEntryDto[];
}

export class FlaggedMessageDto extends AuditMessageDto {
  @ApiProperty({ type: ChatThreadDto })
  thread: ChatThreadDto;
}

export class ChatInsightsDto {
  @ApiProperty({ example: 42 })
  threads: number;

  @ApiProperty({ example: 9, description: 'Conversations with a message today' })
  active_today: number;

  @ApiProperty({ example: 37 })
  messages_today: number;

  @ApiProperty({ example: 1, description: 'Flagged messages not handled yet' })
  open_flags: number;

  @ApiProperty({ example: 2 })
  hidden: number;

  @ApiProperty({ example: 4, description: 'Parent messages waiting for office hours' })
  held: number;
}

export class ReadReceiptDto {
  @ApiProperty({ example: 4, description: 'Messages marked read now' })
  marked: number;

  @ApiProperty()
  read_at: Date;
}
