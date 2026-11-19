import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDateOnly } from '../../../shared/dates';
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
  ValidateIf,
} from 'class-validator';
import { ListQueryDto, PaginationDto, toBoolean } from '@app/common';
import { FileDto } from '../../files/dto/file.dto';
import { RefDto } from '../../students/dto/student-response.dto';
import { MAX_ATTACHMENTS, MAX_INDIVIDUALS } from '../announcements.logic';
import {
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_PRIORITIES,
  ANNOUNCEMENT_STATUSES,
  AnnouncementAudience,
  AnnouncementPriority,
  AnnouncementStatus,
} from '../entities/announcement.entity';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const ISO_WITH_ZONE = /(Z|[+-]\d{2}:\d{2})$/;

export class AnnouncementInputDto {
  @ApiProperty({ example: 'School closed on Friday for Deepavali', maxLength: 150 })
  @Transform(trim)
  @MaxLength(150)
  @IsString()
  @IsNotEmpty({ message: 'Enter a title' })
  title: string;

  @ApiProperty({ example: 'The school stays closed on 13 November. Classes resume on Monday.', maxLength: 4000 })
  @Transform(trim)
  @MaxLength(4000)
  @IsString()
  @IsNotEmpty({ message: 'Write the announcement' })
  body: string;

  @ApiProperty({
    enum: ANNOUNCEMENT_AUDIENCES,
    example: 'parents',
    description:
      'classes: parents of chosen classes or sections. individuals: parents of chosen students and chosen staff members.',
  })
  @IsIn(ANNOUNCEMENT_AUDIENCES, { message: 'audience must be everyone, parents, staff, classes or individuals' })
  audience: AnnouncementAudience;

  @ApiPropertyOptional({
    example: [12, 15],
    type: Number,
    isArray: true,
    description: 'audience=individuals: the parents of these students receive it',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_INDIVIDUALS, { message: `Choose up to ${MAX_INDIVIDUALS} students` })
  @IsInt({ each: true })
  student_ids?: number[];

  @ApiPropertyOptional({
    example: [31],
    type: Number,
    isArray: true,
    description: 'audience=individuals: these staff members (user ids) receive it',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_INDIVIDUALS, { message: `Choose up to ${MAX_INDIVIDUALS} staff members` })
  @IsInt({ each: true })
  staff_user_ids?: number[];

  @ApiPropertyOptional({
    example: [3],
    type: Number,
    isArray: true,
    description: 'audience=classes: every section of these classes',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsInt({ each: true })
  class_ids?: number[];

  @ApiPropertyOptional({ example: [4], type: Number, isArray: true, description: 'audience=classes: these sections' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @IsInt({ each: true })
  section_ids?: number[];

  @ApiPropertyOptional({
    enum: ANNOUNCEMENT_PRIORITIES,
    default: 'normal',
    description: 'urgent also sends SMS when push fails',
  })
  @IsOptional()
  @IsIn(ANNOUNCEMENT_PRIORITIES)
  priority?: AnnouncementPriority;

  @ApiPropertyOptional({
    example: '2026-11-10T08:00:00+05:30',
    nullable: true,
    type: String,
    description: 'Send later. Leave empty to save a draft, or use publish_now.',
  })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @Matches(ISO_WITH_ZONE, { message: 'publish_at must include the time zone, for example +05:30' })
  @IsISO8601({ strict: true }, { message: 'publish_at must be a date and time' })
  publish_at?: string | null;

  @ApiPropertyOptional({
    example: '2026-11-14T00:00:00+05:30',
    nullable: true,
    type: String,
    description: 'Leaves the feed after this',
  })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @Matches(ISO_WITH_ZONE, { message: 'expires_at must include the time zone, for example +05:30' })
  @IsISO8601({ strict: true }, { message: 'expires_at must be a date and time' })
  expires_at?: string | null;

  @ApiPropertyOptional({
    example: [41],
    type: Number,
    isArray: true,
    description: 'Files from POST /files (purpose announcement_attachment): PDF, JPG, PNG or WEBP',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ATTACHMENTS, { message: `Attach up to ${MAX_ATTACHMENTS} files` })
  @IsInt({ each: true })
  file_ids?: number[];

  @ApiPropertyOptional({
    example: false,
    description: 'true: publish as soon as it is saved (ignored when publish_at is set)',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  publish_now?: boolean;

  @ApiPropertyOptional({
    example: false,
    description: 'Editing a published announcement: true sends the update to every recipient again',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  notify_again?: boolean;
}

export class AnnouncementPublishDto {
  @ApiPropertyOptional({ example: null, nullable: true, type: String, description: 'Empty: now' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @Matches(ISO_WITH_ZONE, { message: 'publish_at must include the time zone, for example +05:30' })
  @IsISO8601({ strict: true }, { message: 'publish_at must be a date and time' })
  publish_at?: string | null;
}

export class AnnouncementQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: ANNOUNCEMENT_STATUSES })
  @IsOptional()
  @IsIn(ANNOUNCEMENT_STATUSES)
  status?: AnnouncementStatus;

  @ApiPropertyOptional({ enum: ANNOUNCEMENT_AUDIENCES })
  @IsOptional()
  @IsIn(ANNOUNCEMENT_AUDIENCES)
  audience?: AnnouncementAudience;

  @ApiPropertyOptional({ enum: ANNOUNCEMENT_PRIORITIES })
  @IsOptional()
  @IsIn(ANNOUNCEMENT_PRIORITIES)
  priority?: AnnouncementPriority;
}

export class AnnouncementReadersQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ['read', 'unread'] })
  @IsOptional()
  @IsIn(['read', 'unread'])
  state?: 'read' | 'unread';

  @ApiPropertyOptional({ enum: ['parent', 'staff'] })
  @IsOptional()
  @IsIn(['parent', 'staff'])
  segment?: 'parent' | 'staff';

  @ApiPropertyOptional({ example: 6, description: 'Parents of children in this class' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  class_id?: number;

  @ApiPropertyOptional({ example: 'Lakshmi', description: 'Name or mobile' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  search?: string;
}

export class MyAnnouncementsQueryDto extends PaginationDto {
  @ApiPropertyOptional({ example: true, description: 'Only unread ones' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  unread?: boolean;

  @ApiPropertyOptional({ example: 'holiday', description: 'Words in the title or message' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: ANNOUNCEMENT_PRIORITIES })
  @IsOptional()
  @IsIn(ANNOUNCEMENT_PRIORITIES)
  priority?: AnnouncementPriority;

  @IsDateOnly('2026-11-01', true)
  from?: string;

  @IsDateOnly('2026-11-30', true)
  to?: string;

  @ApiPropertyOptional({ example: 12, description: 'Parents: only those received for this child' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  student_id?: number;
}

export class AnnouncementDto {
  @ApiProperty({ example: 7 })
  id: number;

  @ApiProperty({ example: 'School closed on Friday for Deepavali' })
  title: string;

  @ApiProperty({ example: 'The school stays closed on 13 November.' })
  body: string;

  @ApiProperty({ enum: ANNOUNCEMENT_AUDIENCES })
  audience: AnnouncementAudience;

  @ApiProperty({ example: 'Parents of 6 - A, Class 7', description: 'Who it goes to, in words' })
  audience_label: string;

  @ApiProperty({ type: RefDto, isArray: true })
  classes: RefDto[];

  @ApiProperty({ type: RefDto, isArray: true, description: 'Sections, named like 6 - A' })
  sections: RefDto[];

  @ApiProperty({
    type: RefDto,
    isArray: true,
    description: 'audience=individuals: chosen students, named like "Kavin (6 - A)"',
  })
  students: RefDto[];

  @ApiProperty({ type: RefDto, isArray: true, description: 'audience=individuals: chosen staff members' })
  staff: RefDto[];

  @ApiProperty({ enum: ANNOUNCEMENT_PRIORITIES })
  priority: AnnouncementPriority;

  @ApiProperty({ enum: ANNOUNCEMENT_STATUSES })
  status: AnnouncementStatus;

  @ApiProperty({ nullable: true, type: Date })
  publish_at: Date | null;

  @ApiProperty({ nullable: true, type: Date })
  published_at: Date | null;

  @ApiProperty({ nullable: true, type: Date })
  expires_at: Date | null;

  @ApiProperty({ type: FileDto, isArray: true })
  attachments: FileDto[];

  @ApiProperty({ example: 312 })
  recipient_count: number;

  @ApiProperty({ example: 120 })
  read_count: number;

  @ApiProperty({ example: 38, description: 'Percent of recipients who opened it' })
  read_percent: number;

  @ApiProperty({ type: RefDto })
  author: RefDto;

  @ApiProperty({ type: RefDto })
  academic_year: RefDto;

  @ApiProperty({ nullable: true, type: Date, description: 'Last edit after it was published' })
  edited_at: Date | null;

  @ApiProperty({ type: RefDto, nullable: true })
  edited_by: RefDto | null;

  @ApiProperty()
  created_at: Date;
}

export class AnnouncementReaderDto {
  @ApiProperty({ type: RefDto })
  user: RefDto;

  @ApiProperty({ example: '9876543210' })
  mobile: string;

  @ApiProperty({ enum: ['parent', 'staff'] })
  segment: 'parent' | 'staff';

  @ApiProperty({ nullable: true, type: Date })
  read_at: Date | null;

  @ApiProperty({
    type: RefDto,
    isArray: true,
    description: 'Parents: the children they received it for, named like "Kavin (6 - A)"',
  })
  students: RefDto[];
}

export class MyAnnouncementDto {
  @ApiProperty({ example: 7 })
  id: number;

  @ApiProperty({ example: 'School closed on Friday for Deepavali' })
  title: string;

  @ApiProperty({ example: 'The school stays closed on 13 November.' })
  body: string;

  @ApiProperty({ enum: ANNOUNCEMENT_PRIORITIES })
  priority: AnnouncementPriority;

  @ApiProperty({ type: RefDto, description: 'School that sent it' })
  school: RefDto;

  @ApiProperty({ type: FileDto, isArray: true })
  attachments: FileDto[];

  @ApiProperty()
  published_at: Date;

  @ApiProperty({ nullable: true, type: Date })
  expires_at: Date | null;

  @ApiProperty({ nullable: true, type: Date, description: 'Set when the school changed it after sending' })
  edited_at: Date | null;

  @ApiProperty({ example: false })
  is_read: boolean;

  @ApiProperty({ nullable: true, type: Date })
  read_at: Date | null;
}

export class AnnouncementInsightsDto {
  @ApiProperty({ example: 2 })
  drafts: number;

  @ApiProperty({ example: 1 })
  scheduled: number;

  @ApiProperty({ example: 18 })
  published: number;

  @ApiProperty({ example: 4 })
  archived: number;

  @ApiProperty({ example: 1, description: 'Published urgent announcements still in the feed' })
  urgent_live: number;

  @ApiProperty({ example: 64, description: 'Average read percent of published announcements' })
  average_read_percent: number;
}

export class UnreadCountDto {
  @ApiProperty({ example: 2 })
  unread: number;
}
