import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
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
import { ListQueryDto } from '@app/common';
import { IsDateOnly } from '../../../shared/dates';
import { SOS_KINDS, SOS_MARKS, SOS_STATUSES, SosKind, SosMark, SosStatus } from '../entities/hostel-safety.entity';
import { HostelStudentDto } from './hostel-admission.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const notNull = (_object: unknown, value: unknown) => value !== null && value !== undefined;

export class SosCountsDto {
  @ApiProperty({ example: 120 }) total: number;
  @ApiProperty({ example: 110 }) safe: number;
  @ApiProperty({ example: 1 }) missing: number;
  @ApiProperty({ example: 0 }) injured: number;
  @ApiProperty({ example: 6 }) away: number;
  @ApiProperty({ example: 3 }) unmarked: number;
}

export class SosDto {
  @ApiProperty({ example: 2 }) id: number;
  @ApiProperty({ example: 'SOS-2026-0002' }) sos_no: string;
  @ApiProperty({ example: 1 }) hostel_id: number;
  @ApiProperty({ example: 'Boys Hostel' }) hostel_name: string;
  @ApiProperty({ enum: SOS_KINDS }) kind: SosKind;
  @ApiProperty({ example: 'Smoke in A Block ground floor. Everyone to the assembly point.' }) message: string;
  @ApiProperty({ nullable: true, type: HostelStudentDto }) student: HostelStudentDto | null;
  @ApiProperty({ example: false }) is_drill: boolean;
  @ApiProperty({ example: false }) notify_parents: boolean;
  @ApiProperty({ enum: SOS_STATUSES }) status: SosStatus;
  @ApiProperty({ nullable: true, type: String, example: 'R. Kumar' }) raised_by_name: string | null;
  @ApiProperty({ nullable: true, type: String }) resolved_by_name: string | null;
  @ApiProperty({ nullable: true, type: String }) resolved_at: Date | null;
  @ApiProperty({ nullable: true, type: String }) resolution: string | null;
  @ApiProperty({ type: SosCountsDto }) counts: SosCountsDto;
  @ApiProperty() created_at: Date;
}

export class SosEntryDto {
  @ApiProperty({ example: 21 }) admission_id: number;
  @ApiProperty({ type: HostelStudentDto }) student: HostelStudentDto;
  @ApiProperty({ nullable: true, type: String, example: 'A-101' }) room_no: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'A Block' }) block_name: string | null;
  @ApiProperty({ nullable: true, enum: SOS_MARKS }) status: SosMark | null;
  @ApiProperty({ nullable: true, enum: SOS_MARKS, description: 'away when out on a hostel pass' })
  suggested_status: SosMark | null;
  @ApiProperty({ nullable: true, type: String }) marked_at: Date | null;
}

export class SosDetailDto extends SosDto {
  @ApiProperty({ type: [SosEntryDto] }) students: SosEntryDto[];
}

export class SosInputDto {
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) hostel_id: number;
  @ApiProperty({ enum: SOS_KINDS }) @IsIn(SOS_KINDS) kind: SosKind;
  @ApiProperty({ example: 'Smoke in A Block ground floor. Everyone to the assembly point.' })
  @Transform(trim)
  @IsString()
  @Length(5, 500)
  message: string;
  @ApiPropertyOptional({ description: 'Resident the alert is about (missing or hurt student)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  admission_id?: number;
  @ApiPropertyOptional({ default: false, description: 'A practice drill: no SMS, parents are never told' })
  @IsOptional()
  @IsBoolean()
  is_drill?: boolean;
  @ApiPropertyOptional({ default: false, description: 'Also tell the parents of every resident of this hostel' })
  @IsOptional()
  @IsBoolean()
  notify_parents?: boolean;
}

export class SosMarkItemDto {
  @ApiProperty({ example: 21 }) @IsInt() @Min(1) admission_id: number;
  @ApiProperty({ enum: SOS_MARKS }) @IsIn(SOS_MARKS) status: SosMark;
}

export class SosMarkDto {
  @ApiProperty({ type: [SosMarkItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SosMarkItemDto)
  entries: SosMarkItemDto[];
}

export class SosCloseDto {
  @ApiPropertyOptional({ nullable: true, type: String, example: 'False alarm from the kitchen. All safe.' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class SosQueryDto extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
  @ApiPropertyOptional({ enum: SOS_STATUSES }) @IsOptional() @IsIn(SOS_STATUSES) status?: SosStatus;
}

export class RulesDto {
  @ApiProperty({ nullable: true, type: String, example: 'No mobile phones after lights out.' }) rules: string | null;
  @ApiProperty({ example: '05:30' }) wake_up_time: string;
  @ApiProperty({ example: '18:30' }) study_start_time: string;
  @ApiProperty({ example: '20:30' }) study_end_time: string;
  @ApiProperty({ example: '19:00' }) in_time: string;
  @ApiProperty({ example: '22:00' }) lights_out_time: string;
  @ApiProperty({ example: '16:00' }) outing_from_time: string;
  @ApiProperty({ example: '18:30' }) outing_until_time: string;
  @ApiProperty({ example: 'a3f…', description: 'Changes whenever the rules or timings change' }) version: string;
  @ApiProperty({ example: false }) acknowledged: boolean;
  @ApiProperty({ nullable: true, type: String }) acknowledged_at: Date | null;
}

export class RuleAckRowDto {
  @ApiProperty({ example: 21 }) admission_id: number;
  @ApiProperty({ type: HostelStudentDto }) student: HostelStudentDto;
  @ApiProperty({ example: 'Boys Hostel' }) hostel_name: string;
  @ApiProperty({ example: true }) acknowledged: boolean;
  @ApiProperty({ nullable: true, type: String }) acknowledged_at: Date | null;
  @ApiProperty({ nullable: true, type: String, example: 'Kumar R' }) acknowledged_by: string | null;
}

export class RuleAckQueryDto extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
  @ApiPropertyOptional({ description: 'false = only residents whose parents have not agreed yet' })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  acknowledged?: boolean;
}

export class RuleAckSummaryDto {
  @ApiProperty({ example: 'a3f…' }) version: string;
  @ApiProperty({ example: 120 }) residents: number;
  @ApiProperty({ example: 96 }) acknowledged: number;
}

export class HostelOptionDto {
  @ApiProperty({ example: 1 }) id: number;
  @ApiProperty({ example: 'Boys Hostel' }) name: string;
  @ApiProperty({ example: 'boys' }) gender: string;
  @ApiProperty({ example: 12 }) vacant_beds: number;
}

export class RoomTypeOptionDto {
  @ApiProperty({ example: 2 }) id: number;
  @ApiProperty({ example: '4-sharing non-AC' }) name: string;
  @ApiProperty({ example: 4 }) default_beds: number;
  @ApiProperty({ example: false }) is_ac: boolean;
  @ApiProperty({ example: true }) attached_bathroom: boolean;
  @ApiProperty({ example: 60000 }) annual_fee: number;
  @ApiProperty({ nullable: true, type: String }) amenities: string | null;
}

export class ParentHostelOptionsDto {
  @ApiProperty({ type: [HostelOptionDto], description: 'Only hostels that fit the child’s gender' })
  hostels: HostelOptionDto[];
  @ApiProperty({ type: [RoomTypeOptionDto] }) room_types: RoomTypeOptionDto[];
  @ApiProperty({ example: 5000 }) caution_deposit: number;
  @ApiProperty({ example: true }) in_hostel: boolean;
}

export class ParentApplicationInputDto {
  @ApiPropertyOptional({ example: 1 }) @IsOptional() @IsInt() @Min(1) hostel_id?: number;
  @ApiPropertyOptional({ example: 2 }) @IsOptional() @IsInt() @Min(1) room_type_id?: number;
  @IsDateOnly('2026-06-01', true) wanted_from?: string;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'We live 60 km away' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(500)
  reason?: string | null;
}
