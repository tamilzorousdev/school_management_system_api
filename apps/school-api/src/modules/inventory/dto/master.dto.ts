import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
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
} from 'class-validator';
import { ListQueryDto, toBoolean } from '@app/common';
import { RefDto } from '../../students/dto/student-response.dto';
import {
  CATEGORY_KINDS,
  CategoryKind,
  DEPRECIATION_METHODS,
  DepreciationMethod,
  LOCATION_KINDS,
  LocationKind,
} from '../entities/master.entity';

export const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
export const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
export const notNull = (_object: unknown, value: unknown) => value !== null && value !== undefined;
export const upperCode = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class InventorySettingsDto {
  @ApiProperty({ example: true, description: 'Transfers wait for an approver (AO, principal, admin)' })
  approve_transfers: boolean;
  @ApiProperty({ example: true, description: 'Stock requisitions wait for an approver' }) approve_requisitions: boolean;
  @ApiProperty({ example: true, description: 'Disposals wait for an approver' }) approve_disposals: boolean;
  @ApiProperty({ enum: DEPRECIATION_METHODS }) depreciation_method: DepreciationMethod;
  @ApiProperty({ example: 30, description: 'Days before a warranty or AMC ends to alert' }) warranty_alert_days: number;
  @ApiProperty({ example: 7, description: 'Days before preventive maintenance is due to alert' })
  maintenance_alert_days: number;
}

export class InventorySettingsInputDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() approve_transfers?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() approve_requisitions?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() approve_disposals?: boolean;
  @ApiPropertyOptional({ enum: DEPRECIATION_METHODS })
  @IsOptional()
  @IsIn(DEPRECIATION_METHODS)
  depreciation_method?: DepreciationMethod;
  @ApiPropertyOptional({ minimum: 0, maximum: 365 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  warranty_alert_days?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 90 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(90)
  maintenance_alert_days?: number;
}

export class CategoryDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'Laptops' }) name: string;
  @ApiProperty({ example: 'LAP' }) code: string;
  @ApiProperty({ enum: CATEGORY_KINDS }) kind: CategoryKind;
  @ApiProperty({ nullable: true, type: RefDto }) parent: RefDto | null;
  @ApiProperty({ nullable: true, type: Number, example: 25, description: '% per year' })
  depreciation_rate: number | null;
  @ApiProperty({ nullable: true, type: Number, example: 4 }) useful_life_years: number | null;
  @ApiProperty({ nullable: true, type: Number, example: 180 }) maintenance_interval_days: number | null;
  @ApiProperty({ nullable: true, type: String }) description: string | null;
  @ApiProperty({ example: 12, description: 'Assets, or stock items for a stock category' }) item_count: number;
}

export class CategoryInputDto {
  @ApiProperty({ example: 'Laptops' }) @Transform(trim) @IsString() @Length(2, 60) name: string;
  @ApiProperty({ example: 'LAP' })
  @Transform(upperCode)
  @Matches(/^[A-Z0-9-]{1,20}$/, { message: 'code must be 1 to 20 letters, digits or dashes' })
  code: string;
  @ApiProperty({ enum: CATEGORY_KINDS }) @IsIn(CATEGORY_KINDS) kind: CategoryKind;
  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  parent_id?: number | null;
  @ApiPropertyOptional({ nullable: true, type: Number, minimum: 0, maximum: 100 })
  @IsOptional()
  @ValidateIf(notNull)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  depreciation_rate?: number | null;
  @ApiPropertyOptional({ nullable: true, type: Number, minimum: 1, maximum: 100 })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1)
  @Max(100)
  useful_life_years?: number | null;
  @ApiPropertyOptional({ nullable: true, type: Number, minimum: 1, maximum: 3650 })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1)
  @Max(3650)
  maintenance_interval_days?: number | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  description?: string | null;
}

export class CategoryUpdateDto extends PartialType(CategoryInputDto) {}

export class CategoryQueryDto {
  @ApiPropertyOptional({ enum: CATEGORY_KINDS }) @IsOptional() @IsIn(CATEGORY_KINDS) kind?: CategoryKind;
}

export class LocationDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'Computer Lab' }) name: string;
  @ApiProperty({ example: 'B-LAB1' }) code: string;
  @ApiProperty({ enum: LOCATION_KINDS }) kind: LocationKind;
  @ApiProperty({ nullable: true, type: String, example: 'Block B' }) building: string | null;
  @ApiProperty({ nullable: true, type: String, example: '1st' }) floor: string | null;
  @ApiProperty({ nullable: true, type: RefDto, description: 'The class using this room' }) section: RefDto | null;
  @ApiProperty() is_active: boolean;
  @ApiProperty({ example: 34 }) asset_count: number;
}

export class LocationInputDto {
  @ApiProperty({ example: 'Computer Lab' }) @Transform(trim) @IsString() @Length(2, 80) name: string;
  @ApiProperty({ example: 'B-LAB1' })
  @Transform(upperCode)
  @Matches(/^[A-Z0-9 ·.-]{1,30}$/, { message: 'code must be 1 to 30 letters, digits, spaces, dots or dashes' })
  code: string;
  @ApiPropertyOptional({ enum: LOCATION_KINDS, default: 'classroom' })
  @IsOptional()
  @IsIn(LOCATION_KINDS)
  kind?: LocationKind;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(40)
  building?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(20)
  floor?: string | null;
  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  section_id?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_active?: boolean;
}

export class LocationUpdateDto extends PartialType(LocationInputDto) {}

export class LocationQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: LOCATION_KINDS }) @IsOptional() @IsIn(LOCATION_KINDS) kind?: LocationKind;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(40) building?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(toBoolean) @IsBoolean() is_active?: boolean;
}

export class UserRefDto {
  @ApiProperty({ example: 21 }) id: number;
  @ApiProperty({ example: 'Priya Venkatesh' }) name: string;
  @ApiProperty({ nullable: true, type: String, example: 'PG Assistant' }) detail: string | null;
}

export class DepartmentDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'Science' }) name: string;
  @ApiProperty({ example: 'SCI' }) code: string;
  @ApiProperty({ nullable: true, type: UserRefDto }) head: UserRefDto | null;
  @ApiProperty({ nullable: true, type: String }) description: string | null;
  @ApiProperty() is_active: boolean;
  @ApiProperty({ example: 6, description: 'Staff whose department has this name' }) staff_count: number;
  @ApiProperty({ example: 18 }) asset_count: number;
}

export class DepartmentInputDto {
  @ApiProperty({ example: 'Science' }) @Transform(trim) @IsString() @Length(2, 60) name: string;
  @ApiPropertyOptional({ example: 'SCI', description: 'Made from the name when left out' })
  @IsOptional()
  @Transform(upperCode)
  @Matches(/^[A-Z0-9-]{1,20}$/, { message: 'code must be 1 to 20 letters, digits or dashes' })
  code?: string;
  @ApiPropertyOptional({ nullable: true, type: Number, description: 'Head of department (user id)' })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  head_user_id?: number | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  description?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_active?: boolean;
}

export class DepartmentUpdateDto extends PartialType(DepartmentInputDto) {}

export class DepartmentSyncResultDto {
  @ApiProperty({ example: 4, description: 'Departments created from the staff department names' }) created: number;
  @ApiProperty({ example: 11 }) existing: number;
}

export class VendorDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'Sri Ganesh Computers' }) name: string;
  @ApiProperty({ nullable: true, type: String }) contact_person: string | null;
  @ApiProperty({ nullable: true, type: String }) phone: string | null;
  @ApiProperty({ nullable: true, type: String }) email: string | null;
  @ApiProperty({ nullable: true, type: String }) gstin: string | null;
  @ApiProperty({ nullable: true, type: String }) address: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'Laptops, printers, AMC' }) supplies: string | null;
  @ApiProperty() is_active: boolean;
  @ApiProperty({ example: 12 }) asset_count: number;
  @ApiProperty({ example: 3 }) receipt_count: number;
}

export class VendorInputDto {
  @ApiProperty({ example: 'Sri Ganesh Computers' }) @Transform(trim) @IsString() @Length(2, 120) name: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(80)
  contact_person?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, example: '9840012345' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @Matches(/^[0-9+ -]{6,15}$/, { message: 'phone must be 6 to 15 digits' })
  phone?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(120)
  email?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, example: '33ABCDE1234F1Z5' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() || null : value))
  @ValidateIf(notNull)
  @Matches(/^[0-9A-Z]{15}$/, { message: 'gstin must be 15 letters and digits' })
  gstin?: string | null;
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
  @MaxLength(255)
  supplies?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_active?: boolean;
}

export class VendorUpdateDto extends PartialType(VendorInputDto) {}

export class StoreDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'Main store' }) name: string;
  @ApiProperty({ example: 'MAIN' }) code: string;
  @ApiProperty({ nullable: true, type: RefDto }) location: RefDto | null;
  @ApiProperty({ nullable: true, type: UserRefDto }) keeper: UserRefDto | null;
  @ApiProperty() is_active: boolean;
  @ApiProperty({ example: 18, description: 'Stock items held' }) item_count: number;
  @ApiProperty({ example: 24500, description: 'Stock value held' }) stock_value: number;
}

export class StoreInputDto {
  @ApiProperty({ example: 'Main store' }) @Transform(trim) @IsString() @Length(2, 60) name: string;
  @ApiProperty({ example: 'MAIN' })
  @Transform(upperCode)
  @Matches(/^[A-Z0-9-]{1,20}$/, { message: 'code must be 1 to 20 letters, digits or dashes' })
  code: string;
  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  location_id?: number | null;
  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  keeper_user_id?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_active?: boolean;
}

export class StoreUpdateDto extends PartialType(StoreInputDto) {}
