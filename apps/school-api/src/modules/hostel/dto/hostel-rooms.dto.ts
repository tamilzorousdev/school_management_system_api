import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ListQueryDto, toBoolean } from '@app/common';
import { IsDateOnly } from '../../../shared/dates';
import {
  DISCIPLINE_CATEGORIES,
  DisciplineCategory,
  MAINTENANCE_CATEGORIES,
  MaintenanceCategory,
  SEVERITIES,
  Severity,
} from '../entities/hostel-conduct.entity';
import {
  ASSET_CONDITIONS,
  AssetCondition,
  BELONGING_STATUSES,
  BelongingStatus,
  CHECK_RESULTS,
  CheckResult,
  INSPECTION_RESULTS,
  InspectionResult,
  LOCKER_SIZES,
  LOCKER_STATUSES,
  LockerSize,
  LockerStatus,
} from '../entities/hostel-rooms.entity';
import { LOCKER_SETTABLE_STATUSES, LockerSettableStatus } from '../hostel-rooms.logic';
import { TICKET_PRIORITIES, TicketPriority } from '../hostel.logic';
import { HostelStudentDto } from './hostel-admission.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);
const notNull = (_object: unknown, value: unknown) => value !== null && value !== undefined;
const LOCKER_NO = /^[A-Z0-9-]{1,20}$/;
const LOCK_TYPES = ['school', 'own'] as const;
type LockType = (typeof LOCK_TYPES)[number];

export class LockerHolderDto {
  @ApiProperty({ example: 14 }) allocation_id: number;
  @ApiProperty({ example: 21 }) admission_id: number;
  @ApiProperty({ type: HostelStudentDto }) student: HostelStudentDto;
  @ApiProperty({ example: '2026-06-03' }) from_date: string;
  @ApiProperty({ example: 1 }) keys_given: number;
  @ApiProperty({ enum: LOCK_TYPES }) lock_type: LockType;
  @ApiProperty({ nullable: true, type: Number, example: 200 }) deposit: number | null;
}

export class LockerDto {
  @ApiProperty({ example: 5 }) id: number;
  @ApiProperty({ example: 1 }) hostel_id: number;
  @ApiProperty({ example: 'Boys Hostel' }) hostel_name: string;
  @ApiProperty({ nullable: true, type: Number }) block_id: number | null;
  @ApiProperty({ nullable: true, type: String, example: 'A Block' }) block_name: string | null;
  @ApiProperty({ nullable: true, type: Number }) room_id: number | null;
  @ApiProperty({ nullable: true, type: String, example: 'A-101' }) room_no: string | null;
  @ApiProperty({ example: 'L-005' }) locker_no: string;
  @ApiProperty({ nullable: true, enum: LOCKER_SIZES }) size: LockerSize | null;
  @ApiProperty({ enum: LOCKER_STATUSES }) status: LockerStatus;
  @ApiProperty({ nullable: true, type: String }) notes: string | null;
  @ApiProperty({ nullable: true, type: LockerHolderDto, description: 'Student holding the locker now' })
  holder: LockerHolderDto | null;
  @ApiProperty() created_at: Date;
}

export class LockerAllocationDto {
  @ApiProperty({ example: 14 }) id: number;
  @ApiProperty({ example: 5 }) locker_id: number;
  @ApiProperty({ example: 'L-005' }) locker_no: string;
  @ApiProperty({ example: 21 }) admission_id: number;
  @ApiProperty({ type: HostelStudentDto }) student: HostelStudentDto;
  @ApiProperty({ example: '2026-06-03' }) from_date: string;
  @ApiProperty({ nullable: true, type: String, example: null }) to_date: string | null;
  @ApiProperty({ example: 1 }) keys_given: number;
  @ApiProperty({ nullable: true, type: Number }) keys_returned: number | null;
  @ApiProperty({ enum: LOCK_TYPES }) lock_type: LockType;
  @ApiProperty({ nullable: true, type: Number }) deposit: number | null;
  @ApiProperty({ nullable: true, type: String, example: '1 key not returned' }) return_note: string | null;
  @ApiProperty({ nullable: true, type: String }) given_by_name: string | null;
  @ApiProperty({ nullable: true, type: String }) returned_by_name: string | null;
  @ApiProperty() created_at: Date;
}

export class LockerDetailDto extends LockerDto {
  @ApiProperty({ type: [LockerAllocationDto], description: 'Allocations, newest first' })
  history: LockerAllocationDto[];
}

export class LockerSummaryDto {
  @ApiProperty({ example: 120 }) total: number;
  @ApiProperty({ example: 30 }) available: number;
  @ApiProperty({ example: 84 }) allotted: number;
  @ApiProperty({ example: 4 }) damaged: number;
  @ApiProperty({ example: 2 }) blocked: number;
}

export class LockerQueryDto extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) block_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) room_id?: number;
  @ApiPropertyOptional({ enum: LOCKER_STATUSES }) @IsOptional() @IsIn(LOCKER_STATUSES) status?: LockerStatus;
  @ApiPropertyOptional({ description: 'true: only free lockers; false: only lockers that are not free' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  available?: boolean;
}

class LockerPlaceDto {
  @ApiPropertyOptional({ description: 'Taken from the room when left out' })
  @IsOptional()
  @IsInt()
  @Min(1)
  block_id?: number;
  @ApiPropertyOptional({ description: 'Room the locker stands in' }) @IsOptional() @IsInt() @Min(1) room_id?: number;
  @ApiPropertyOptional({ enum: LOCKER_SIZES }) @IsOptional() @IsIn(LOCKER_SIZES) size?: LockerSize;
}

export class LockerInputDto extends LockerPlaceDto {
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) hostel_id: number;
  @ApiProperty({ example: 'L-005' })
  @Transform(upper)
  @Matches(LOCKER_NO, { message: 'locker_no must be 1 to 20 letters, digits or dashes' })
  locker_no: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  notes?: string | null;
}

export class LockerBulkDto extends LockerPlaceDto {
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) hostel_id: number;
  @ApiPropertyOptional({ example: 'L-', default: '' })
  @IsOptional()
  @Transform(upper)
  @Matches(/^[A-Z0-9-]{0,10}$/, { message: 'prefix must be up to 10 letters, digits or dashes' })
  prefix?: string;
  @ApiProperty({ example: 1 }) @IsInt() @Min(0) @Max(99999) start_no: number;
  @ApiProperty({ example: 40 }) @IsInt() @Min(1) @Max(200) count: number;
  @ApiPropertyOptional({ example: 3, default: 0, description: 'Zero-pad the number to this many digits' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  pad?: number;
}

export class LockerBulkResultDto {
  @ApiProperty({ example: 40 }) created: number;
  @ApiProperty({ example: ['L-001', 'L-002'] }) locker_nos: string[];
}

export class LockerUpdateDto {
  @ApiPropertyOptional({ enum: LOCKER_SETTABLE_STATUSES, description: 'Only while the locker is not allotted' })
  @IsOptional()
  @IsIn(LOCKER_SETTABLE_STATUSES)
  status?: LockerSettableStatus;
  @ApiPropertyOptional({ nullable: true, enum: LOCKER_SIZES })
  @IsOptional()
  @ValidateIf(notNull)
  @IsIn(LOCKER_SIZES)
  size?: LockerSize | null;
  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1)
  block_id?: number | null;
  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1)
  room_id?: number | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  notes?: string | null;
}

export class LockerAllocateDto {
  @ApiProperty({ example: 21, description: 'Resident of the same hostel' }) @IsInt() @Min(1) admission_id: number;
  @ApiPropertyOptional({ example: 1, default: 1 }) @IsOptional() @IsInt() @Min(0) @Max(5) keys_given?: number;
  @ApiPropertyOptional({ enum: LOCK_TYPES, default: 'school', description: 'own: the student brought a padlock' })
  @IsOptional()
  @IsIn(LOCK_TYPES)
  lock_type?: LockType;
  @ApiPropertyOptional({ nullable: true, type: Number, example: 200, description: 'Key deposit collected' })
  @IsOptional()
  @ValidateIf(notNull)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  deposit?: number | null;
}

export class LockerReturnDto {
  @ApiProperty({ example: 1 }) @IsInt() @Min(0) @Max(5) keys_returned: number;
  @ApiPropertyOptional({ default: false, description: 'The locker comes back damaged and is not given out again' })
  @IsOptional()
  @IsBoolean()
  damaged?: boolean;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'Hinge loose' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(200)
  note?: string | null;
}

export class ParentLockerDto {
  @ApiProperty({ example: 5 }) locker_id: number;
  @ApiProperty({ example: 'L-005' }) locker_no: string;
  @ApiProperty({ example: 'Boys Hostel' }) hostel_name: string;
  @ApiProperty({ nullable: true, type: String, example: 'A Block' }) block_name: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'A-101' }) room_no: string | null;
  @ApiProperty({ nullable: true, enum: LOCKER_SIZES }) size: LockerSize | null;
  @ApiProperty({ example: '2026-06-03' }) from_date: string;
  @ApiProperty({ example: 1 }) keys_given: number;
  @ApiProperty({ enum: LOCK_TYPES }) lock_type: LockType;
}

export class RoomAssetDto {
  @ApiProperty({ example: 31 }) id: number;
  @ApiProperty({ example: 1 }) hostel_id: number;
  @ApiProperty({ example: 'Boys Hostel' }) hostel_name: string;
  @ApiProperty({ example: 12 }) room_id: number;
  @ApiProperty({ example: 'A-101' }) room_no: string;
  @ApiProperty({ nullable: true, type: String, example: 'A Block' }) block_name: string | null;
  @ApiProperty({ example: 'Ceiling fan' }) item_name: string;
  @ApiProperty({ example: 2 }) quantity: number;
  @ApiProperty({ enum: ASSET_CONDITIONS }) condition: AssetCondition;
  @ApiProperty({ nullable: true, type: Number, description: 'Asset in the inventory register' })
  inventory_asset_id: number | null;
  @ApiProperty({ nullable: true, type: String, example: 'AST-0042' }) asset_tag: string | null;
  @ApiProperty({ nullable: true, type: String }) notes: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Last time an inspection or edit checked it' })
  last_checked_at: Date | null;
  @ApiProperty() updated_at: Date;
}

export class RoomAssetInputDto {
  @ApiProperty({ example: 'Ceiling fan' }) @Transform(trim) @IsString() @Length(2, 80) item_name: string;
  @ApiProperty({ example: 2 }) @IsInt() @Min(1) @Max(500) quantity: number;
  @ApiPropertyOptional({ enum: ASSET_CONDITIONS, default: 'good' })
  @IsOptional()
  @IsIn(ASSET_CONDITIONS)
  condition?: AssetCondition;
  @ApiPropertyOptional({ nullable: true, type: Number, description: 'Link to an asset in the inventory register' })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1)
  inventory_asset_id?: number | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  notes?: string | null;
}

export class RoomAssetUpdateDto extends PartialType(RoomAssetInputDto) {}

export class AssetTemplateItemDto {
  @ApiProperty({ example: 'Study table' }) @Transform(trim) @IsString() @Length(2, 80) item_name: string;
  @ApiProperty({ example: 4 }) @IsInt() @Min(1) @Max(500) quantity: number;
}

export class AssetApplyDto {
  @ApiPropertyOptional({ example: [12, 13], description: 'These rooms' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  @Min(1, { each: true })
  room_ids?: number[];
  @ApiPropertyOptional({ description: 'Every room of this type' }) @IsOptional() @IsInt() @Min(1) room_type_id?: number;
  @ApiPropertyOptional({ description: 'Every room of this hostel' }) @IsOptional() @IsInt() @Min(1) hostel_id?: number;
  @ApiProperty({ type: [AssetTemplateItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => AssetTemplateItemDto)
  items: AssetTemplateItemDto[];
}

export class AssetApplyResultDto {
  @ApiProperty({ example: 40, description: 'Rooms that matched' }) rooms: number;
  @ApiProperty({ example: 152, description: 'Asset rows added (items a room already had are skipped)' })
  added: number;
}

export class AssetQueryDto extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) block_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) room_id?: number;
  @ApiPropertyOptional({ enum: ASSET_CONDITIONS }) @IsOptional() @IsIn(ASSET_CONDITIONS) condition?: AssetCondition;
}

export class ChecklistDto {
  @ApiProperty({ example: ['Bed & mattress', 'Cupboard', 'Fan & lights'] }) items: string[];
}

export class InspectionItemInputDto {
  @ApiProperty({ example: 'Fan & lights' }) @Transform(trim) @IsString() @Length(2, 80) item: string;
  @ApiProperty({ enum: CHECK_RESULTS }) @IsIn(CHECK_RESULTS) result: CheckResult;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'Tube light flickers' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  note?: string | null;
}

export class AssetConditionInputDto {
  @ApiProperty({ example: 31 }) @IsInt() @Min(1) asset_id: number;
  @ApiProperty({ enum: ASSET_CONDITIONS }) @IsIn(ASSET_CONDITIONS) condition: AssetCondition;
}

export class InspectionTicketInputDto {
  @ApiProperty({ enum: MAINTENANCE_CATEGORIES }) @IsIn(MAINTENANCE_CATEGORIES) category: MaintenanceCategory;
  @ApiPropertyOptional({ enum: TICKET_PRIORITIES, default: 'normal' })
  @IsOptional()
  @IsIn(TICKET_PRIORITIES)
  priority?: TicketPriority;
  @ApiProperty({ example: 'Replace tube light' }) @Transform(trim) @IsString() @Length(3, 120) title: string;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Default: the items marked issue' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(1000)
  description?: string | null;
  @ApiPropertyOptional({ default: false, description: 'Close the room for new students until done' })
  @IsOptional()
  @IsBoolean()
  blocks_room?: boolean;
}

export class InspectionCaseInputDto {
  @ApiProperty({ example: 21, description: 'Resident responsible' }) @IsInt() @Min(1) admission_id: number;
  @ApiProperty({ enum: DISCIPLINE_CATEGORIES }) @IsIn(DISCIPLINE_CATEGORIES) category: DisciplineCategory;
  @ApiProperty({ enum: SEVERITIES }) @IsIn(SEVERITIES) severity: Severity;
  @ApiProperty({ example: 'Mobile phone found in the cupboard during room inspection' })
  @Transform(trim)
  @IsString()
  @Length(5, 1000)
  description: string;
}

export class InspectionInputDto {
  @ApiProperty({ example: 12 }) @IsInt() @Min(1) room_id: number;
  @ApiPropertyOptional({ example: '2026-07-12T10:30:00+05:30', description: 'Default now' })
  @IsOptional()
  @IsISO8601()
  inspected_at?: string;
  @ApiPropertyOptional({ example: 4, description: '1 (dirty) to 5 (spotless)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  cleanliness?: number;
  @ApiProperty({ type: [InspectionItemInputDto], description: 'Start from GET inspections/checklist' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => InspectionItemInputDto)
  items: InspectionItemInputDto[];
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(500)
  notes?: string | null;
  @ApiPropertyOptional({ type: [AssetConditionInputDto], description: 'New condition of room assets seen' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AssetConditionInputDto)
  update_assets?: AssetConditionInputDto[];
  @ApiPropertyOptional({ type: InspectionTicketInputDto, description: 'Raise a maintenance ticket for this room' })
  @IsOptional()
  @ValidateNested()
  @Type(() => InspectionTicketInputDto)
  raise_ticket?: InspectionTicketInputDto;
  @ApiPropertyOptional({
    type: InspectionCaseInputDto,
    description: 'Record a discipline case (needs hostel.discipline)',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => InspectionCaseInputDto)
  raise_case?: InspectionCaseInputDto;
}

export class InspectionDto {
  @ApiProperty({ example: 9 }) id: number;
  @ApiProperty({ example: 1 }) hostel_id: number;
  @ApiProperty({ example: 'Boys Hostel' }) hostel_name: string;
  @ApiProperty({ example: 12 }) room_id: number;
  @ApiProperty({ example: 'A-101' }) room_no: string;
  @ApiProperty({ nullable: true, type: String, example: 'A Block' }) block_name: string | null;
  @ApiProperty() inspected_at: Date;
  @ApiProperty({ nullable: true, type: String, example: 'R. Kumar' }) inspector_name: string | null;
  @ApiProperty({ example: 78, description: 'ok / (ok + issue) x 100' }) score: number;
  @ApiProperty({ nullable: true, type: Number, example: 4 }) cleanliness: number | null;
  @ApiProperty({ enum: INSPECTION_RESULTS }) result: InspectionResult;
  @ApiProperty({ example: 2 }) issues: number;
  @ApiProperty({ nullable: true, type: String }) notes: string | null;
  @ApiProperty({ nullable: true, type: Number }) maintenance_ticket_id: number | null;
  @ApiProperty({ nullable: true, type: String, example: 'HMT-2026-0008' }) ticket_no: string | null;
  @ApiProperty({ nullable: true, type: Number }) discipline_case_id: number | null;
  @ApiProperty({ nullable: true, type: String, example: 'HDC-2026-0004' }) case_no: string | null;
  @ApiProperty() created_at: Date;
}

export class InspectionItemDto {
  @ApiProperty({ example: 70 }) id: number;
  @ApiProperty({ example: 'Fan & lights' }) item: string;
  @ApiProperty({ enum: CHECK_RESULTS }) result: CheckResult;
  @ApiProperty({ nullable: true, type: String }) note: string | null;
}

export class InspectionDetailDto extends InspectionDto {
  @ApiProperty({ type: [InspectionItemDto] }) items: InspectionItemDto[];
}

export class InspectionQueryDto extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) room_id?: number;
  @ApiPropertyOptional({ enum: INSPECTION_RESULTS }) @IsOptional() @IsIn(INSPECTION_RESULTS) result?: InspectionResult;
  @IsDateOnly('2026-07-01', true) from?: string;
  @IsDateOnly('2026-07-31', true) to?: string;
}

export class InspectionDueDto {
  @ApiProperty({ example: 12 }) room_id: number;
  @ApiProperty({ example: 'A-101' }) room_no: string;
  @ApiProperty({ example: 1 }) hostel_id: number;
  @ApiProperty({ example: 'Boys Hostel' }) hostel_name: string;
  @ApiProperty({ nullable: true, type: String, example: 'A Block' }) block_name: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'Ground floor' }) floor_name: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Null when never inspected' })
  last_inspected_at: Date | null;
  @ApiProperty({ nullable: true, type: Number, example: 41 }) days_since: number | null;
}

export class InspectionDueQueryDto extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
  @ApiPropertyOptional({ example: 30, default: 30, description: 'Rooms not inspected in this many days' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}

export class BelongingDto {
  @ApiProperty({ example: 6 }) id: number;
  @ApiProperty({ example: 21 }) admission_id: number;
  @ApiProperty({ example: 312 }) student_id: number;
  @ApiProperty({ example: 'Laptop' }) item: string;
  @ApiProperty({ nullable: true, type: String, example: 'Dell Inspiron, black' }) description: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'SN12345' }) serial_no: string | null;
  @ApiProperty({ example: 1 }) quantity: number;
  @ApiProperty({ example: '2026-06-03' }) declared_on: string;
  @ApiProperty({ enum: BELONGING_STATUSES }) status: BelongingStatus;
  @ApiProperty({ nullable: true, type: Number }) photo_file_id: number | null;
  @ApiProperty({ nullable: true, type: String }) notes: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'Kumar R' }) declared_by_name: string | null;
  @ApiProperty() created_at: Date;
}

export class BelongingInputDto {
  @ApiProperty({ example: 'Laptop' }) @Transform(trim) @IsString() @Length(2, 80) item: string;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'Dell Inspiron, black' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  description?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'SN12345' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(60)
  serial_no?: string | null;
  @ApiPropertyOptional({ example: 1, default: 1 }) @IsOptional() @IsInt() @Min(1) @Max(100) quantity?: number;
  @IsDateOnly('2026-06-03', true) declared_on?: string;
  @ApiPropertyOptional({ description: 'Photo uploaded through /files' })
  @IsOptional()
  @IsInt()
  @Min(1)
  photo_file_id?: number;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  notes?: string | null;
}

export class BelongingUpdateDto {
  @ApiPropertyOptional({ enum: BELONGING_STATUSES })
  @IsOptional()
  @IsIn(BELONGING_STATUSES)
  status?: BelongingStatus;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'Taken home on 12 Jul' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  notes?: string | null;
}
