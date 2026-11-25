import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
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
import {
  BED_STATUSES,
  BedStatus,
  HOSTEL_GENDERS,
  HOSTEL_STATUSES,
  HostelGender,
  HostelStatus,
  ROOM_STATUSES,
  RoomStatus,
} from '../entities/hostel.entity';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);
const notNull = (_object: unknown, value: unknown) => value !== null && value !== undefined;
const CODE = /^[A-Z0-9-]{1,20}$/;
const CODE_MESSAGE = 'code must be 1 to 20 letters, digits or dashes';
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIME_MESSAGE = 'must be a time as HH:mm';

export class EnabledModulesDto {
  @ApiProperty({ example: false, description: 'Hostel staff attendance and duty roster' }) staff_duty: boolean;
  @ApiProperty({ example: false, description: 'Student lockers' }) lockers: boolean;
  @ApiProperty({ example: true, description: 'Study halls and seat allocation' }) study_hall: boolean;
  @ApiProperty({ example: false }) laundry: boolean;
  @ApiProperty({ example: true, description: 'Medical and sick bay' }) medical: boolean;
  @ApiProperty({ example: true }) mess: boolean;
}

export class EnabledModulesInputDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() staff_duty?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() lockers?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() study_hall?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() laundry?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() medical?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() mess?: boolean;
}

export class HostelSettingsDto {
  @ApiProperty({ type: EnabledModulesDto }) enabled_modules: EnabledModulesDto;
  @ApiProperty({ example: '05:30' }) wake_up_time: string;
  @ApiProperty({ example: '18:30' }) study_start_time: string;
  @ApiProperty({ example: '20:30' }) study_end_time: string;
  @ApiProperty({ example: '19:00', description: 'Students must be back in the hostel by this time' }) in_time: string;
  @ApiProperty({ example: '22:00' }) lights_out_time: string;
  @ApiProperty({ example: '16:00' }) outing_from_time: string;
  @ApiProperty({ example: '18:30' }) outing_until_time: string;
  @ApiProperty({ example: true, description: 'Home leave needs the parent to agree in the Parent app' })
  parent_consent_for_leave: boolean;
  @ApiProperty({ example: false, description: 'Vacation: roll call and mess are paused' }) holiday_mode: boolean;
  @ApiProperty({ nullable: true, type: String }) rules: string | null;
  @ApiProperty({ example: 5000, description: 'Caution deposit billed once at admission; 0 = none' })
  caution_deposit: number;
  @ApiProperty({ example: true, description: 'Bill hostel fee and deposit as soon as a student is admitted' })
  bill_on_admission: boolean;
}

export class HostelSettingsInputDto {
  @ApiPropertyOptional({ type: EnabledModulesInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => EnabledModulesInputDto)
  enabled_modules?: EnabledModulesInputDto;
  @ApiPropertyOptional({ example: '05:30' })
  @IsOptional()
  @Matches(TIME, { message: `wake_up_time ${TIME_MESSAGE}` })
  wake_up_time?: string;
  @ApiPropertyOptional({ example: '18:30' })
  @IsOptional()
  @Matches(TIME, { message: `study_start_time ${TIME_MESSAGE}` })
  study_start_time?: string;
  @ApiPropertyOptional({ example: '20:30' })
  @IsOptional()
  @Matches(TIME, { message: `study_end_time ${TIME_MESSAGE}` })
  study_end_time?: string;
  @ApiPropertyOptional({ example: '19:00' })
  @IsOptional()
  @Matches(TIME, { message: `in_time ${TIME_MESSAGE}` })
  in_time?: string;
  @ApiPropertyOptional({ example: '22:00' })
  @IsOptional()
  @Matches(TIME, { message: `lights_out_time ${TIME_MESSAGE}` })
  lights_out_time?: string;
  @ApiPropertyOptional({ example: '16:00' })
  @IsOptional()
  @Matches(TIME, { message: `outing_from_time ${TIME_MESSAGE}` })
  outing_from_time?: string;
  @ApiPropertyOptional({ example: '18:30' })
  @IsOptional()
  @Matches(TIME, { message: `outing_until_time ${TIME_MESSAGE}` })
  outing_until_time?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() parent_consent_for_leave?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() holiday_mode?: boolean;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(5000)
  rules?: string | null;
  @ApiPropertyOptional({ example: 5000 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999)
  caution_deposit?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() bill_on_admission?: boolean;
}

export class HostelModulesDto {
  @ApiProperty({ type: EnabledModulesDto }) enabled_modules: EnabledModulesDto;
  @ApiProperty({ example: false }) holiday_mode: boolean;
}

export class HostelDto {
  @ApiProperty({ example: 1 }) id: number;
  @ApiProperty({ example: 'Boys Hostel' }) name: string;
  @ApiProperty({ example: 'BH' }) code: string;
  @ApiProperty({ enum: HOSTEL_GENDERS, example: 'boys' }) gender: HostelGender;
  @ApiProperty({ enum: HOSTEL_STATUSES, example: 'active' }) status: HostelStatus;
  @ApiProperty({ nullable: true, type: Number, example: 14 }) warden_user_id: number | null;
  @ApiProperty({ nullable: true, type: String, example: 'R. Kumar' }) warden_name: string | null;
  @ApiProperty({ nullable: true, type: String, example: '9000000013' }) phone: string | null;
  @ApiProperty({ nullable: true, type: String }) address: string | null;
  @ApiProperty({ nullable: true, type: String }) notes: string | null;
  @ApiProperty({ example: 2 }) block_count: number;
  @ApiProperty({ example: 40 }) room_count: number;
  @ApiProperty({ example: 160 }) bed_count: number;
  @ApiProperty({ example: 120 }) occupied_beds: number;
}

export class HostelInputDto {
  @ApiProperty({ example: 'Boys Hostel' }) @Transform(trim) @IsString() @Length(2, 100) name: string;
  @ApiProperty({ example: 'BH' }) @Transform(upper) @Matches(CODE, { message: CODE_MESSAGE }) code: string;
  @ApiProperty({ enum: HOSTEL_GENDERS }) @IsIn(HOSTEL_GENDERS) gender: HostelGender;
  @ApiPropertyOptional({ enum: HOSTEL_STATUSES, default: 'active' })
  @IsOptional()
  @IsIn(HOSTEL_STATUSES)
  status?: HostelStatus;
  @ApiPropertyOptional({ nullable: true, type: Number, description: 'User with the WARDEN role' })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1)
  warden_user_id?: number | null;
  @ApiPropertyOptional({ nullable: true, type: String, example: '9000000013' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @Matches(/^[6-9]\d{9}$/, { message: 'phone must be a valid 10-digit Indian mobile number' })
  phone?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  address?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class HostelUpdateDto extends PartialType(HostelInputDto) {}

export class BlockDto {
  @ApiProperty({ example: 3 }) id: number;
  @ApiProperty({ example: 1 }) hostel_id: number;
  @ApiProperty({ example: 'A Block' }) name: string;
  @ApiProperty({ example: 'A' }) code: string;
  @ApiProperty({ example: 0 }) sort_order: number;
  @ApiProperty({ nullable: true, type: Number }) incharge_user_id: number | null;
  @ApiProperty({ nullable: true, type: String }) incharge_name: string | null;
  @ApiProperty({ example: 3 }) floor_count: number;
  @ApiProperty({ example: 24 }) room_count: number;
  @ApiProperty({ example: 96 }) bed_count: number;
  @ApiProperty({ example: 80 }) occupied_beds: number;
}

export class BlockInputDto {
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) hostel_id: number;
  @ApiProperty({ example: 'A Block' }) @Transform(trim) @IsString() @Length(1, 60) name: string;
  @ApiProperty({ example: 'A' }) @Transform(upper) @Matches(CODE, { message: CODE_MESSAGE }) code: string;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(0) @Max(999) sort_order?: number;
  @ApiPropertyOptional({ nullable: true, type: Number, description: 'Warden or assistant warden for this block' })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1)
  incharge_user_id?: number | null;
}

export class BlockUpdateDto extends PartialType(BlockInputDto) {}

export class BlockQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
}

export class FloorDto {
  @ApiProperty({ example: 7 }) id: number;
  @ApiProperty({ example: 1 }) hostel_id: number;
  @ApiProperty({ example: 3 }) block_id: number;
  @ApiProperty({ example: 'Ground floor' }) name: string;
  @ApiProperty({ example: 0 }) level: number;
  @ApiProperty({ example: 8 }) room_count: number;
  @ApiProperty({ example: 32 }) bed_count: number;
  @ApiProperty({ example: 28 }) occupied_beds: number;
}

export class FloorInputDto {
  @ApiProperty({ example: 3 }) @IsInt() @Min(1) block_id: number;
  @ApiProperty({ example: 'Ground floor' }) @Transform(trim) @IsString() @Length(1, 40) name: string;
  @ApiProperty({ example: 0, description: '0 is the ground floor' }) @IsInt() @Min(-2) @Max(50) level: number;
}

export class FloorUpdateDto extends PartialType(FloorInputDto) {}

export class FloorQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) block_id?: number;
}

export class RoomTypeDto {
  @ApiProperty({ example: 2 }) id: number;
  @ApiProperty({ example: '4-sharing non-AC' }) name: string;
  @ApiProperty({ example: 'NAC4' }) code: string;
  @ApiProperty({ example: 4 }) default_beds: number;
  @ApiProperty({ example: false }) is_ac: boolean;
  @ApiProperty({ example: true }) attached_bathroom: boolean;
  @ApiProperty({ example: 60000 }) annual_fee: number;
  @ApiProperty({ nullable: true, type: String, example: 'Cot, mattress, table, cupboard, fan' })
  amenities: string | null;
  @ApiProperty({ example: 30 }) room_count: number;
}

export class RoomTypeInputDto {
  @ApiProperty({ example: '4-sharing non-AC' }) @Transform(trim) @IsString() @Length(2, 60) name: string;
  @ApiProperty({ example: 'NAC4' }) @Transform(upper) @Matches(CODE, { message: CODE_MESSAGE }) code: string;
  @ApiProperty({ example: 4 }) @IsInt() @Min(1) @Max(50) default_beds: number;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() is_ac?: boolean;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() attached_bathroom?: boolean;
  @ApiPropertyOptional({ example: 60000, default: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999)
  annual_fee?: number;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  amenities?: string | null;
}

export class RoomTypeUpdateDto extends PartialType(RoomTypeInputDto) {}

export class BedOccupantDto {
  @ApiProperty({ example: 21 }) admission_id: number;
  @ApiProperty({ example: 312 }) student_id: number;
  @ApiProperty({ example: 'Arun Kumar' }) student_name: string;
  @ApiProperty({ nullable: true, type: String, example: '8 A' }) class_section: string | null;
  @ApiProperty({ example: '2026-06-01' }) from_date: string;
}

export class BedDto {
  @ApiProperty({ example: 41 }) id: number;
  @ApiProperty({ example: 12 }) room_id: number;
  @ApiProperty({ example: 'A' }) bed_no: string;
  @ApiProperty({ enum: BED_STATUSES, example: 'vacant' }) status: BedStatus;
  @ApiProperty({ nullable: true, type: String }) notes: string | null;
  @ApiProperty({ nullable: true, type: BedOccupantDto }) occupant: BedOccupantDto | null;
}

export class RoomDto {
  @ApiProperty({ example: 12 }) id: number;
  @ApiProperty({ example: 1 }) hostel_id: number;
  @ApiProperty({ example: 'Boys Hostel' }) hostel_name: string;
  @ApiProperty({ example: 3 }) block_id: number;
  @ApiProperty({ example: 'A Block' }) block_name: string;
  @ApiProperty({ example: 7 }) floor_id: number;
  @ApiProperty({ example: 'Ground floor' }) floor_name: string;
  @ApiProperty({ example: 2 }) room_type_id: number;
  @ApiProperty({ example: '4-sharing non-AC' }) room_type_name: string;
  @ApiProperty({ example: 'A-101' }) room_no: string;
  @ApiProperty({ example: 4 }) capacity: number;
  @ApiProperty({ enum: ROOM_STATUSES, example: 'active' }) status: RoomStatus;
  @ApiProperty({ nullable: true, type: String }) notes: string | null;
  @ApiProperty({ example: 3 }) occupied_beds: number;
  @ApiProperty({ example: 1 }) vacant_beds: number;
}

export class RoomDetailDto extends RoomDto {
  @ApiProperty({ type: [BedDto] }) beds: BedDto[];
}

export class RoomInputDto {
  @ApiProperty({ example: 7 }) @IsInt() @Min(1) floor_id: number;
  @ApiProperty({ example: 2 }) @IsInt() @Min(1) room_type_id: number;
  @ApiProperty({ example: 'A-101' }) @Transform(upper) @IsString() @Length(1, 20) room_no: string;
  @ApiPropertyOptional({ example: 4, description: 'Defaults to the room type bed count. Beds A, B, C... are created.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  capacity?: number;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  notes?: string | null;
}

export class RoomUpdateDto {
  @ApiPropertyOptional({ example: 2 }) @IsOptional() @IsInt() @Min(1) room_type_id?: number;
  @ApiPropertyOptional({ example: 'A-101' })
  @IsOptional()
  @Transform(upper)
  @IsString()
  @Length(1, 20)
  room_no?: string;
  @ApiPropertyOptional({ example: 4, description: 'Raising it adds beds; lowering it removes only vacant beds.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  capacity?: number;
  @ApiPropertyOptional({ enum: ROOM_STATUSES }) @IsOptional() @IsIn(ROOM_STATUSES) status?: RoomStatus;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  notes?: string | null;
}

export class RoomBulkDto {
  @ApiProperty({ example: 7 }) @IsInt() @Min(1) floor_id: number;
  @ApiProperty({ example: 2 }) @IsInt() @Min(1) room_type_id: number;
  @ApiPropertyOptional({ example: 'A-', default: '' })
  @IsOptional()
  @Transform(upper)
  @Matches(/^[A-Z0-9-]{0,10}$/, { message: 'prefix must be up to 10 letters, digits or dashes' })
  prefix?: string;
  @ApiProperty({ example: 101 }) @IsInt() @Min(0) @Max(99999) start_no: number;
  @ApiProperty({ example: 10 }) @IsInt() @Min(1) @Max(100) count: number;
  @ApiPropertyOptional({ example: 3, default: 0, description: 'Zero-pad the number to this many digits' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  pad?: number;
}

export class RoomBulkResultDto {
  @ApiProperty({ example: 10 }) created: number;
  @ApiProperty({ example: ['A-101', 'A-102'] }) room_nos: string[];
}

export class RoomQueryDto extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) block_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) floor_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) room_type_id?: number;
  @ApiPropertyOptional({ enum: ROOM_STATUSES }) @IsOptional() @IsIn(ROOM_STATUSES) status?: RoomStatus;
  @ApiPropertyOptional({ description: 'Only rooms with at least one vacant bed' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  has_vacancy?: boolean;
}

export class BedUpdateDto {
  @ApiPropertyOptional({
    enum: ['vacant', 'blocked', 'maintenance'],
    description: 'Occupied and reserved are set by allocation',
  })
  @IsOptional()
  @IsIn(['vacant', 'blocked', 'maintenance'])
  status?: 'vacant' | 'blocked' | 'maintenance';
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  notes?: string | null;
}

export class BedAvailabilityQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) block_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) room_type_id?: number;
}

export class AvailableBedDto {
  @ApiProperty({ example: 41 }) bed_id: number;
  @ApiProperty({ example: 'A' }) bed_no: string;
  @ApiProperty({ example: 12 }) room_id: number;
  @ApiProperty({ example: 'A-101' }) room_no: string;
  @ApiProperty({ example: 'A Block' }) block_name: string;
  @ApiProperty({ example: 'Ground floor' }) floor_name: string;
  @ApiProperty({ example: 'Boys Hostel' }) hostel_name: string;
  @ApiProperty({ example: '4-sharing non-AC' }) room_type_name: string;
}

export class HostelDashboardDto {
  @ApiProperty({ example: 2 }) hostels: number;
  @ApiProperty({ example: 4 }) blocks: number;
  @ApiProperty({ example: 80 }) rooms: number;
  @ApiProperty({ example: 320 }) total_beds: number;
  @ApiProperty({ example: 280 }) occupied_beds: number;
  @ApiProperty({ example: 30 }) vacant_beds: number;
  @ApiProperty({ example: 4 }) reserved_beds: number;
  @ApiProperty({ example: 6 }) unavailable_beds: number;
  @ApiProperty({ example: 87.5 }) occupancy_percent: number;
  @ApiProperty({ example: 3 }) rooms_under_maintenance: number;
  @ApiProperty({ type: EnabledModulesDto }) enabled_modules: EnabledModulesDto;
}

export class HostelIdQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
}
