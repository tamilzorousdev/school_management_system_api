import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ListQueryDto, toBoolean } from '@app/common';
import { IsDateOnly, IsNullableDate } from '../../../shared/dates';
import { RefDto } from '../../students/dto/student-response.dto';
import {
  ASSET_CONDITIONS,
  ASSET_EVENT_KINDS,
  ASSET_STATUSES,
  ASSIGNEE_TYPES,
  AssetCondition,
  AssetEventKind,
  AssetStatus,
  AssigneeType,
  DISPOSAL_METHODS,
  DISPOSAL_STATUSES,
  DisposalMethod,
  DisposalStatus,
  FUNDING_SOURCES,
  FundingSource,
  TRANSFER_STATUSES,
  TransferStatus,
} from '../entities/asset.entity';
import { notNull, trim, trimToNull, UserRefDto } from './master.dto';

const idList = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isInteger(item) && item > 0)
    : value;

export const WARRANTY_STATES = ['active', 'expiring', 'expired', 'none'] as const;
export type WarrantyState = (typeof WARRANTY_STATES)[number];

export class AssigneeDto {
  @ApiProperty({ enum: ASSIGNEE_TYPES }) type: AssigneeType;
  @ApiProperty({ example: 14 }) id: number;
  @ApiProperty({ example: 'Priya Venkatesh' }) name: string;
  @ApiProperty({ nullable: true, type: String, example: 'Science' }) detail: string | null;
}

export class CurrentAllocationDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: AssigneeDto }) assignee: AssigneeDto;
  @ApiProperty({ example: '2026-11-01' }) allocated_on: string;
  @ApiProperty({ nullable: true, type: String }) expected_return_on: string | null;
  @ApiProperty({ nullable: true, type: Date }) acknowledged_at: Date | null;
  @ApiProperty({ example: false, description: 'Past the expected return date' }) overdue: boolean;
}

export class AssetDto {
  @ApiProperty({ example: 41 }) id: number;
  @ApiProperty({ example: 'TZMS-AST-000041' }) asset_tag: string;
  @ApiProperty({ example: 'Dell Latitude 3440' }) name: string;
  @ApiProperty({ type: RefDto }) category: RefDto;
  @ApiProperty({ nullable: true, type: String }) make: string | null;
  @ApiProperty({ nullable: true, type: String }) model: string | null;
  @ApiProperty({ nullable: true, type: String }) serial_no: string | null;
  @ApiProperty({ nullable: true, type: String }) description: string | null;
  @ApiProperty({ nullable: true, type: RefDto }) vendor: RefDto | null;
  @ApiProperty({ nullable: true, type: String }) invoice_no: string | null;
  @ApiProperty({ nullable: true, type: Number }) invoice_file_id: number | null;
  @ApiProperty({ nullable: true, type: String }) invoice_url: string | null;
  @ApiProperty({ nullable: true, type: String, example: '2025-06-10' }) purchase_date: string | null;
  @ApiProperty({ nullable: true, type: Number, example: 52000 }) cost: number | null;
  @ApiProperty({ nullable: true, type: Number }) residual_value: number | null;
  @ApiProperty({ nullable: true, type: Number, example: 39000, description: 'Cost less depreciation today' })
  book_value: number | null;
  @ApiProperty({ nullable: true, type: String }) warranty_until: string | null;
  @ApiProperty({ enum: WARRANTY_STATES, description: 'expiring = within the alert days' })
  warranty_state: WarrantyState;
  @ApiProperty({ nullable: true, type: String }) amc_until: string | null;
  @ApiProperty({ nullable: true, type: RefDto }) amc_vendor: RefDto | null;
  @ApiProperty({ enum: FUNDING_SOURCES }) funding_source: FundingSource;
  @ApiProperty({ enum: ASSET_CONDITIONS }) condition: AssetCondition;
  @ApiProperty({ enum: ASSET_STATUSES }) status: AssetStatus;
  @ApiProperty({ nullable: true, type: RefDto, description: 'Where it is now' }) location: RefDto | null;
  @ApiProperty({ nullable: true, type: RefDto }) department: RefDto | null;
  @ApiProperty({ nullable: true, type: UserRefDto, description: 'Staff member responsible' })
  custodian: UserRefDto | null;
  @ApiProperty({ nullable: true, type: RefDto, description: 'The store it is kept in when in store' })
  store: RefDto | null;
  @ApiProperty({ nullable: true, type: CurrentAllocationDto }) current_allocation: CurrentAllocationDto | null;
  @ApiProperty({ nullable: true, type: Number }) photo_file_id: number | null;
  @ApiProperty({ nullable: true, type: String }) photo_url: string | null;
  @ApiProperty({ nullable: true, type: String }) notes: string | null;
  @ApiProperty({ example: 0 }) open_tickets: number;
  @ApiProperty({ nullable: true, type: String, description: 'Next preventive maintenance date' }) next_maintenance_on:
    string | null;
  @ApiProperty() created_at: Date;
}

export class AssetQueryDto extends ListQueryDto {
  @ApiPropertyOptional({
    enum: ASSET_STATUSES,
    isArray: true,
    description: 'One status or several separated by commas, e.g. in_store,in_maintenance',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean)
      : value,
  )
  @IsIn(ASSET_STATUSES, { each: true })
  status?: AssetStatus[];
  @ApiPropertyOptional({ enum: ASSET_CONDITIONS }) @IsOptional() @IsIn(ASSET_CONDITIONS) condition?: AssetCondition;
  @ApiPropertyOptional() @IsOptional() @IsInt() category_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() location_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() department_id?: number;
  @ApiPropertyOptional({ description: 'Custodian or the staff member it is allocated to' })
  @IsOptional()
  @IsInt()
  custodian_user_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() vendor_id?: number;
  @ApiPropertyOptional({ enum: WARRANTY_STATES }) @IsOptional() @IsIn(WARRANTY_STATES) warranty?: WarrantyState;
  @ApiPropertyOptional({ enum: FUNDING_SOURCES }) @IsOptional() @IsIn(FUNDING_SOURCES) funding_source?: FundingSource;
}

export class AssetInsightsDto {
  @ApiProperty({ example: 420 }) total: number;
  @ApiProperty({ example: 2150000 }) total_cost: number;
  @ApiProperty({ example: 1640000 }) book_value: number;
  @ApiProperty({ example: 120 }) in_store: number;
  @ApiProperty({ example: 280 }) allocated: number;
  @ApiProperty({ example: 6 }) in_maintenance: number;
  @ApiProperty({ example: 2 }) lost: number;
  @ApiProperty({ example: 12 }) disposed: number;
  @ApiProperty({ example: 9, description: 'Warranty or AMC ending within the alert days' }) warranty_expiring: number;
  @ApiProperty({ example: 3, description: 'Allocations past the expected return date' }) overdue_returns: number;
  @ApiProperty({ example: 5, description: 'Allocated to staff and not acknowledged' }) unacknowledged: number;
}

export class AssetInputDto {
  @ApiProperty({ example: 'Dell Latitude 3440' }) @Transform(trim) @IsString() @Length(2, 120) name: string;
  @ApiProperty({ example: 3 }) @IsInt() category_id: number;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(60)
  make?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(60)
  model?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Only for a single asset' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(80)
  serial_no?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(500)
  description?: string | null;
  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  vendor_id?: number | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(40)
  invoice_no?: string | null;
  @ApiPropertyOptional({ nullable: true, type: Number, description: 'A file uploaded through POST /files' })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  invoice_file_id?: number | null;
  @IsNullableDate('2025-06-10') purchase_date?: string | null;
  @ApiPropertyOptional({ nullable: true, type: Number, example: 52000 })
  @IsOptional()
  @ValidateIf(notNull)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000000)
  cost?: number | null;
  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  residual_value?: number | null;
  @IsNullableDate('2028-06-09') warranty_until?: string | null;
  @IsNullableDate('2027-06-09') amc_until?: string | null;
  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  amc_vendor_id?: number | null;
  @ApiPropertyOptional({ enum: FUNDING_SOURCES, default: 'school' })
  @IsOptional()
  @IsIn(FUNDING_SOURCES)
  funding_source?: FundingSource;
  @ApiPropertyOptional({ enum: ASSET_CONDITIONS, default: 'new' })
  @IsOptional()
  @IsIn(ASSET_CONDITIONS)
  condition?: AssetCondition;
  @ApiPropertyOptional({ nullable: true, type: Number, description: 'Where it is kept while in store' })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  location_id?: number | null;
  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  store_id?: number | null;
  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  photo_file_id?: number | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

export class AssetCreateDto extends AssetInputDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 1, description: 'Register this many identical assets' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  quantity?: number;

  @ApiPropertyOptional({ type: [String], description: 'Serial numbers, one per asset (bulk)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsString({ each: true })
  @Length(1, 80, { each: true })
  serial_nos?: string[];

  @ApiPropertyOptional({ description: 'Create a preventive maintenance schedule from the category interval' })
  @IsOptional()
  @IsBoolean()
  schedule_maintenance?: boolean;
}

export class AssetUpdateDto extends PartialType(AssetInputDto) {}

export class AssetCreateResultDto {
  @ApiProperty({ type: [AssetDto] }) assets: AssetDto[];
}

export class AssetLookupQueryDto {
  @ApiProperty({ example: 'TZMS-AST-000041', description: 'Asset tag or serial number' })
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  code: string;
}

export class AssetLabelsQueryDto {
  @ApiPropertyOptional({ example: '41,42,43' })
  @IsOptional()
  @Transform(idList)
  @IsArray()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  asset_ids?: number[];
  @ApiPropertyOptional() @IsOptional() @IsInt() location_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() category_id?: number;
  @IsDateOnly('2026-11-01', true) added_from?: string;
}

export class AssetEventDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: ASSET_EVENT_KINDS }) kind: AssetEventKind;
  @ApiProperty({ nullable: true, type: String }) note: string | null;
  @ApiProperty({ nullable: true, type: String }) ref_type: string | null;
  @ApiProperty({ nullable: true, type: Number }) ref_id: number | null;
  @ApiProperty({ nullable: true, type: String }) actor: string | null;
  @ApiProperty() created_at: Date;
}

export class AssignTargetDto {
  @ApiProperty({ enum: ASSIGNEE_TYPES }) @IsIn(ASSIGNEE_TYPES) assignee_type: AssigneeType;
  @ApiPropertyOptional({ description: 'Staff member (user id) for assignee_type staff' })
  @IsOptional()
  @IsInt()
  user_id?: number;
  @ApiPropertyOptional({ description: 'For assignee_type department' }) @IsOptional() @IsInt() department_id?: number;
  @ApiPropertyOptional({ description: 'For assignee_type location; also where the asset will be kept' })
  @IsOptional()
  @IsInt()
  location_id?: number;
}

export class AllocateDto extends AssignTargetDto {
  @ApiProperty({ type: [Number], description: 'One or more assets in store' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsInt({ each: true })
  asset_ids: number[];
  @IsDateOnly('2026-11-19', true) allocated_on?: string;
  @IsDateOnly('2027-03-31', true) expected_return_on?: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  remarks?: string | null;
}

export class ReturnAssetsDto {
  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsInt({ each: true })
  asset_ids: number[];
  @ApiPropertyOptional({ enum: ASSET_CONDITIONS }) @IsOptional() @IsIn(ASSET_CONDITIONS) condition?: AssetCondition;
  @ApiPropertyOptional({ description: 'Store it goes back to' }) @IsOptional() @IsInt() store_id?: number;
  @ApiPropertyOptional({ description: 'Open a breakdown ticket for each returned asset' })
  @IsOptional()
  @IsBoolean()
  send_to_maintenance?: boolean;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  remarks?: string | null;
}

export class AllocationDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: RefDto, description: 'The asset, named "TAG · name"' }) asset: RefDto;
  @ApiProperty({ example: 'TZMS-AST-000041' }) asset_tag: string;
  @ApiProperty({ type: AssigneeDto }) assignee: AssigneeDto;
  @ApiProperty() allocated_on: string;
  @ApiProperty({ nullable: true, type: String }) expected_return_on: string | null;
  @ApiProperty({ nullable: true, type: Date }) acknowledged_at: Date | null;
  @ApiProperty({ nullable: true, type: String }) returned_on: string | null;
  @ApiProperty({ nullable: true, enum: ASSET_CONDITIONS }) return_condition: AssetCondition | null;
  @ApiProperty({ enum: ['active', 'returned'] }) status: 'active' | 'returned';
  @ApiProperty() overdue: boolean;
  @ApiProperty({ nullable: true, type: String }) allocated_by: string | null;
  @ApiProperty({ nullable: true, type: String }) returned_by: string | null;
  @ApiProperty({ nullable: true, type: String }) remarks: string | null;
}

export class AllocationQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: ['active', 'returned'] })
  @IsOptional()
  @IsIn(['active', 'returned'])
  status?: 'active' | 'returned';
  @ApiPropertyOptional({ enum: ASSIGNEE_TYPES }) @IsOptional() @IsIn(ASSIGNEE_TYPES) assignee_type?: AssigneeType;
  @ApiPropertyOptional() @IsOptional() @IsInt() user_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() department_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() location_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() asset_id?: number;
  @ApiPropertyOptional({ description: 'Active and past the expected return date' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  overdue?: boolean;
  @ApiPropertyOptional({ description: 'Active staff allocations not acknowledged' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  unacknowledged?: boolean;
}

export class TransferItemDto {
  @ApiProperty() asset_id: number;
  @ApiProperty({ example: 'TZMS-AST-000041' }) asset_tag: string;
  @ApiProperty({ example: 'Dell Latitude 3440' }) name: string;
  @ApiProperty({ nullable: true, type: String, example: 'Priya Venkatesh', description: 'Who or where it was' })
  from: string | null;
}

export class TransferDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'TZMS-TRF-2026-0004' }) transfer_no: string;
  @ApiProperty({ type: AssigneeDto, description: 'Where the assets go' }) to: AssigneeDto;
  @ApiProperty({ type: [TransferItemDto] }) items: TransferItemDto[];
  @ApiProperty() reason: string;
  @ApiProperty({ enum: TRANSFER_STATUSES }) status: TransferStatus;
  @ApiProperty({ nullable: true, type: String }) requested_by: string | null;
  @ApiProperty({ nullable: true, type: String }) decided_by: string | null;
  @ApiProperty({ nullable: true, type: Date }) decided_at: Date | null;
  @ApiProperty({ nullable: true, type: String }) decision_note: string | null;
  @ApiProperty({ nullable: true, type: Date }) completed_at: Date | null;
  @ApiProperty() created_at: Date;
}

export class TransferInputDto extends AssignTargetDto {
  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsInt({ each: true })
  asset_ids: number[];
  @ApiProperty({ example: 'Moved to the new computer lab' })
  @Transform(trim)
  @IsString()
  @Length(3, 255)
  reason: string;
}

export class TransferQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: TRANSFER_STATUSES }) @IsOptional() @IsIn(TRANSFER_STATUSES) status?: TransferStatus;
  @ApiPropertyOptional() @IsOptional() @IsInt() asset_id?: number;
}

export class DecisionDto {
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  note?: string | null;
}

export class RejectDto {
  @ApiProperty({ example: 'Not needed this term' }) @Transform(trim) @IsString() @Length(3, 255) note: string;
}

export class MarkLostDto {
  @ApiProperty({ example: 'Missing after the annual day' }) @Transform(trim) @IsString() @Length(3, 255) note: string;
}

export class DisposalDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'TZMS-DSP-2026-0002' }) disposal_no: string;
  @ApiProperty({ type: RefDto, description: 'The asset, named "TAG · name"' }) asset: RefDto;
  @ApiProperty() asset_tag: string;
  @ApiProperty({ enum: DISPOSAL_METHODS }) method: DisposalMethod;
  @ApiProperty() reason: string;
  @ApiProperty({ nullable: true, type: Number }) value_realised: number | null;
  @ApiProperty({ nullable: true, type: Number, description: 'Book value when requested' }) book_value: number | null;
  @ApiProperty({ enum: DISPOSAL_STATUSES }) status: DisposalStatus;
  @ApiProperty({ nullable: true, type: String }) requested_by: string | null;
  @ApiProperty({ nullable: true, type: String }) decided_by: string | null;
  @ApiProperty({ nullable: true, type: Date }) decided_at: Date | null;
  @ApiProperty({ nullable: true, type: String }) decision_note: string | null;
  @ApiProperty() created_at: Date;
}

export class DisposalInputDto {
  @ApiProperty() @IsInt() asset_id: number;
  @ApiProperty({ enum: DISPOSAL_METHODS }) @IsIn(DISPOSAL_METHODS) method: DisposalMethod;
  @ApiProperty({ example: 'Beyond repair' }) @Transform(trim) @IsString() @Length(3, 255) reason: string;
  @ApiPropertyOptional({ nullable: true, type: Number, description: 'Sale or scrap value' })
  @IsOptional()
  @ValidateIf(notNull)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  value_realised?: number | null;
}

export class DisposalQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: DISPOSAL_STATUSES }) @IsOptional() @IsIn(DISPOSAL_STATUSES) status?: DisposalStatus;
  @ApiPropertyOptional({ enum: DISPOSAL_METHODS }) @IsOptional() @IsIn(DISPOSAL_METHODS) method?: DisposalMethod;
}

export const IMPORT_MODES = ['validate', 'import'] as const;

export class AssetImportOptionsDto {
  @ApiPropertyOptional({ enum: IMPORT_MODES, default: 'validate' })
  @IsOptional()
  @IsIn(IMPORT_MODES)
  mode?: (typeof IMPORT_MODES)[number];
}

export const ASSET_IMPORT_UPLOAD_SCHEMA = {
  type: 'object',
  required: ['file'],
  properties: {
    file: {
      type: 'string',
      format: 'binary',
      description: 'The Excel template (.xlsx) or a CSV with the same columns',
    },
    mode: { type: 'string', enum: [...IMPORT_MODES], default: 'validate' },
  },
};

export class AssetImportRowDto {
  @ApiProperty() row: number;
  @ApiProperty({ enum: ['ok', 'error'] }) status: 'ok' | 'error';
  @ApiProperty({ nullable: true, type: String }) name: string | null;
  @ApiProperty({ example: 2 }) quantity: number;
  @ApiProperty({ nullable: true, type: String }) message: string | null;
  @ApiProperty({ type: [String], description: 'Tags given on import' }) asset_tags: string[];
  @ApiProperty({ type: [Number], description: 'Ids of the assets created from this row (for printing labels)' })
  asset_ids: number[];
}

export class AssetImportReportDto {
  @ApiProperty({ enum: IMPORT_MODES }) mode: 'validate' | 'import';
  @ApiProperty() total_rows: number;
  @ApiProperty() ok_rows: number;
  @ApiProperty() error_rows: number;
  @ApiProperty() assets_created: number;
  @ApiProperty({ description: 'Categories, locations or vendors created from new names' }) masters_created: number;
  @ApiProperty({ type: [AssetImportRowDto] }) rows: AssetImportRowDto[];
}
