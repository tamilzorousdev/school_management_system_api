import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { ListQueryDto } from '@app/common';
import {
  COMPLAINANT_TYPES,
  ComplainantType,
  GRIEVANCE_CATEGORIES,
  GRIEVANCE_PRIORITIES,
  GRIEVANCE_STATUSES,
  GrievanceCategory,
  GrievancePriority,
  GrievanceStatus,
} from '../entities/grievance.entity';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const toBoolean = ({ value }: { value: unknown }) => value === 'true' || value === true || value === 1 || value === '1';

export class GrievanceQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: GRIEVANCE_STATUSES, example: 'in_progress' })
  @IsOptional()
  @IsIn(GRIEVANCE_STATUSES)
  status?: GrievanceStatus;

  @ApiPropertyOptional({ enum: GRIEVANCE_CATEGORIES, example: 'transport' })
  @IsOptional()
  @IsIn(GRIEVANCE_CATEGORIES)
  category?: GrievanceCategory;

  @ApiPropertyOptional({ enum: GRIEVANCE_PRIORITIES, example: 'high' })
  @IsOptional()
  @IsIn(GRIEVANCE_PRIORITIES)
  priority?: GrievancePriority;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  assigned_to?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  sla_breached?: boolean;
}

export class CreateGrievanceDto {
  @ApiProperty({ enum: COMPLAINANT_TYPES, example: 'parent' })
  @IsIn(COMPLAINANT_TYPES)
  complainant_type: ComplainantType;

  @ApiPropertyOptional({ example: 'Senthil Nathan' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(150)
  complainant_name?: string | null;

  @ApiPropertyOptional({ example: '9876543210' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(20)
  complainant_mobile?: string | null;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  student_id?: number | null;

  @ApiProperty({ enum: GRIEVANCE_CATEGORIES, example: 'transport' })
  @IsIn(GRIEVANCE_CATEGORIES)
  category: GrievanceCategory;

  @ApiPropertyOptional({ example: 'Bus Route Delay' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  subcategory?: string | null;

  @ApiProperty({ enum: GRIEVANCE_PRIORITIES, example: 'high' })
  @IsIn(GRIEVANCE_PRIORITIES)
  priority: GrievancePriority;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  is_anonymous?: boolean;

  @ApiProperty({ example: 'Bus 4 morning pickup delayed by 45 mins' })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  subject: string;

  @ApiProperty({ example: 'Bus arrived at 08:35 AM instead of 07:50 AM with no prior alert.' })
  @Transform(trim)
  @IsString()
  @MinLength(5)
  description: string;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  assigned_to_user_id?: number | null;

  @ApiPropertyOptional({ example: 24 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sla_hours?: number;

  @ApiPropertyOptional({ example: 'bus' })
  @IsOptional()
  @IsString()
  linked_entity_type?: string | null;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  linked_entity_id?: number | null;
}

export class AssignGrievanceDto {
  @ApiProperty({ example: 4 })
  @Type(() => Number)
  @IsInt()
  assigned_to_user_id: number;

  @ApiPropertyOptional({ example: 'Please inspect the route driver log and coordinate with transport supervisor.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  note?: string;
}

export class UpdateGrievanceStatusDto {
  @ApiProperty({ enum: GRIEVANCE_STATUSES, example: 'in_progress' })
  @IsIn(GRIEVANCE_STATUSES)
  status: GrievanceStatus;

  @ApiPropertyOptional({ example: 'Officer contacted driver; maintenance check underway.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  note?: string;
}

export class AddGrievanceNoteDto {
  @ApiProperty({ example: 'Parent called to verify replacement bus timing.' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  note: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  is_internal?: boolean;
}

export class ResolveGrievanceDto {
  @ApiProperty({ example: 'Driver reprimanded and backup bus dispatched on Route 4. Parent notified via phone.' })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  resolution_summary: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  notify_complainant?: boolean;
}

export class EscalateGrievanceDto {
  @ApiProperty({ example: 'SLA deadline exceeded with no resolution from transport team.' })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  reason: string;
}

export class GrievanceRefDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'K. Ramanathan' })
  name: string;

  @ApiPropertyOptional({ example: 'Transport Incharge' })
  role?: string;
}

export class GrievanceTimelineItemDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiPropertyOptional({ example: 'Principal Dr. V. Sundaram' })
  actor_name: string | null;

  @ApiPropertyOptional({ example: 'PRINCIPAL' })
  actor_role: string | null;

  @ApiProperty({ example: 'assigned' })
  action: string;

  @ApiPropertyOptional({ enum: GRIEVANCE_STATUSES, example: 'submitted' })
  from_status: GrievanceStatus | null;

  @ApiPropertyOptional({ enum: GRIEVANCE_STATUSES, example: 'in_progress' })
  to_status: GrievanceStatus | null;

  @ApiProperty({ example: 'Assigned to Transport Incharge' })
  message: string;

  @ApiProperty({ example: false })
  is_internal: boolean;

  @ApiProperty({ example: '2026-11-20T10:00:00.000Z' })
  created_at: string;
}

export class GrievanceAttachmentDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'incident_photo.jpg' })
  file_name: string;

  @ApiProperty({ example: '/files/download/...' })
  file_url: string;

  @ApiPropertyOptional({ example: 1048576 })
  file_size?: number;

  @ApiPropertyOptional({ example: 'image/jpeg' })
  mime_type?: string;

  @ApiProperty({ example: false })
  is_internal: boolean;

  @ApiProperty({ example: '2026-11-20T10:00:00.000Z' })
  uploaded_at: string;
}

export class GrievanceItemDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'GRV-2026-0001' })
  ticket_no: string;

  @ApiProperty({ example: 1 })
  school_id: number;

  @ApiProperty({ enum: COMPLAINANT_TYPES, example: 'parent' })
  complainant_type: ComplainantType;

  @ApiPropertyOptional({ example: 'Senthil Nathan' })
  complainant_name: string | null;

  @ApiPropertyOptional({ example: '9876543210' })
  complainant_mobile: string | null;

  @ApiPropertyOptional({ example: 12 })
  student_id: number | null;

  @ApiPropertyOptional({ example: 'Aravind Senthil' })
  student_name: string | null;

  @ApiPropertyOptional({ example: 'ADM202401' })
  student_admission_no: string | null;

  @ApiPropertyOptional({ example: 'Grade 8 - A' })
  class_section: string | null;

  @ApiProperty({ enum: GRIEVANCE_CATEGORIES, example: 'transport' })
  category: GrievanceCategory;

  @ApiPropertyOptional({ example: 'Bus Route Delay' })
  subcategory: string | null;

  @ApiProperty({ enum: GRIEVANCE_PRIORITIES, example: 'high' })
  priority: GrievancePriority;

  @ApiProperty({ example: false })
  is_anonymous: boolean;

  @ApiProperty({ example: 'Bus 4 morning pickup delayed by 45 mins' })
  subject: string;

  @ApiProperty({ example: 'Bus arrived at 08:35 AM instead of 07:50 AM with no prior alert.' })
  description: string;

  @ApiProperty({ enum: GRIEVANCE_STATUSES, example: 'in_progress' })
  status: GrievanceStatus;

  @ApiPropertyOptional({ type: GrievanceRefDto })
  assigned_to: GrievanceRefDto | null;

  @ApiPropertyOptional({ example: '2026-11-20T10:00:00.000Z' })
  assigned_at: string | null;

  @ApiProperty({ example: '2026-11-21T10:00:00.000Z' })
  sla_due_at: string;

  @ApiProperty({ example: false })
  is_sla_breached: boolean;

  @ApiPropertyOptional({ example: null })
  escalated_at: string | null;

  @ApiPropertyOptional({ example: null })
  escalation_reason: string | null;

  @ApiPropertyOptional({ example: null })
  resolution_summary: string | null;

  @ApiPropertyOptional({ example: null })
  resolved_at: string | null;

  @ApiPropertyOptional({ example: null })
  satisfaction_rating: number | null;

  @ApiProperty({ example: '2026-11-20T08:00:00.000Z' })
  created_at: string;

  @ApiProperty({ example: '2026-11-20T10:00:00.000Z' })
  updated_at: string;
}

export class GrievanceDetailDto extends GrievanceItemDto {
  @ApiProperty({ type: [GrievanceTimelineItemDto] })
  timeline: GrievanceTimelineItemDto[];

  @ApiProperty({ type: [GrievanceAttachmentDto] })
  attachments: GrievanceAttachmentDto[];

  @ApiPropertyOptional({ example: 'bus' })
  linked_entity_type?: string | null;

  @ApiPropertyOptional({ example: 4 })
  linked_entity_id?: number | null;

  @ApiPropertyOptional({ example: 'Bus #4 (TN-01-AB-1234)' })
  linked_entity_label?: string | null;

  @ApiProperty({ type: [GrievanceTimelineItemDto] })
  internal_notes: GrievanceTimelineItemDto[];
}

export class GrievanceInsightsDto {
  @ApiProperty({ example: 5 })
  total_open: number;

  @ApiProperty({ example: 1 })
  sla_breached: number;

  @ApiProperty({ example: 3 })
  in_progress: number;

  @ApiProperty({ example: 12 })
  resolved_this_month: number;

  @ApiPropertyOptional({ example: 18.5 })
  avg_resolution_hours: number | null;

  @ApiProperty({
    example: {
      transport: 3,
      academics: 1,
      safety_bullying: 0,
      fees_billing: 1,
      facilities: 0,
      staff_conduct: 0,
      workplace_staff: 0,
      other: 0,
    },
  })
  by_category: Record<GrievanceCategory, number>;
}
