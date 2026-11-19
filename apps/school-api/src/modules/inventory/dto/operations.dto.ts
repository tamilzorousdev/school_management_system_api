import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
  ValidateNested,
} from 'class-validator';
import { ListQueryDto, PaginationDto, toBoolean } from '@app/common';
import { IsDateOnly } from '../../../shared/dates';
import { RefDto } from '../../students/dto/student-response.dto';
import { AssetCondition, ASSET_CONDITIONS } from '../entities/asset.entity';
import {
  AUDIT_FINDINGS,
  AUDIT_KINDS,
  AUDIT_STATUSES,
  AuditFinding,
  AuditKind,
  AuditStatus,
  MOVEMENT_KINDS,
  MovementKind,
  REQUISITION_STATUSES,
  RequisitionStatus,
  STOCK_UNITS,
  StockUnit,
  TICKET_KINDS,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  TicketKind,
  TicketPriority,
  TicketStatus,
} from '../entities/operations.entity';
import { AllocationDto, AssetDto, AssetInsightsDto, TransferDto, DisposalDto } from './asset.dto';
import { notNull, trim, trimToNull, UserRefDto } from './master.dto';

export class TicketDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'TZMS-MNT-2026-0007' }) ticket_no: string;
  @ApiProperty({ type: RefDto, description: 'The asset, named "TAG · name"' }) asset: RefDto;
  @ApiProperty() asset_tag: string;
  @ApiProperty({ nullable: true, type: RefDto }) location: RefDto | null;
  @ApiProperty({ enum: TICKET_KINDS }) kind: TicketKind;
  @ApiProperty({ example: 'Projector not turning on' }) title: string;
  @ApiProperty({ nullable: true, type: String }) description: string | null;
  @ApiProperty({ enum: TICKET_PRIORITIES }) priority: TicketPriority;
  @ApiProperty({ enum: TICKET_STATUSES }) status: TicketStatus;
  @ApiProperty({ nullable: true, type: String }) reported_by: string | null;
  @ApiProperty({ nullable: true, type: UserRefDto }) assigned_to: UserRefDto | null;
  @ApiProperty({ nullable: true, type: RefDto }) vendor: RefDto | null;
  @ApiProperty() under_warranty: boolean;
  @ApiProperty({ nullable: true, type: Number }) cost: number | null;
  @ApiProperty({ nullable: true, type: String }) parts: string | null;
  @ApiProperty() opened_at: Date;
  @ApiProperty({ nullable: true, type: Date }) resolved_at: Date | null;
  @ApiProperty({ nullable: true, type: Number, example: 3, description: 'Days from opened to resolved (or today)' })
  downtime_days: number | null;
  @ApiProperty({ nullable: true, type: String }) resolution: string | null;
}

export class TicketInputDto {
  @ApiProperty() @IsInt() asset_id: number;
  @ApiPropertyOptional({ enum: TICKET_KINDS, default: 'breakdown' })
  @IsOptional()
  @IsIn(TICKET_KINDS)
  kind?: TicketKind;
  @ApiProperty({ example: 'Projector not turning on' }) @Transform(trim) @IsString() @Length(3, 120) title: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(1000)
  description?: string | null;
  @ApiPropertyOptional({ enum: TICKET_PRIORITIES, default: 'medium' })
  @IsOptional()
  @IsIn(TICKET_PRIORITIES)
  priority?: TicketPriority;
  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  assigned_to_user_id?: number | null;
  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  vendor_id?: number | null;
}

export class TicketUpdateDto {
  @ApiPropertyOptional({ enum: ['open', 'in_progress'] })
  @IsOptional()
  @IsIn(['open', 'in_progress'])
  status?: 'open' | 'in_progress';
  @ApiPropertyOptional({ enum: TICKET_PRIORITIES }) @IsOptional() @IsIn(TICKET_PRIORITIES) priority?: TicketPriority;
  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  assigned_to_user_id?: number | null;
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
  @MaxLength(1000)
  description?: string | null;
}

export class TicketResolveDto {
  @ApiProperty({ example: 'Lamp replaced' }) @Transform(trim) @IsString() @Length(3, 1000) resolution: string;
  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cost?: number | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  parts?: string | null;
  @ApiPropertyOptional({ enum: ASSET_CONDITIONS, description: 'Condition after the repair' })
  @IsOptional()
  @IsIn(ASSET_CONDITIONS)
  condition?: AssetCondition;
}

export class TicketCancelDto {
  @ApiProperty({ example: 'Raised twice' }) @Transform(trim) @IsString() @Length(3, 255) note: string;
}

export class TicketQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: TICKET_STATUSES }) @IsOptional() @IsIn(TICKET_STATUSES) status?: TicketStatus;
  @ApiPropertyOptional({ enum: TICKET_KINDS }) @IsOptional() @IsIn(TICKET_KINDS) kind?: TicketKind;
  @ApiPropertyOptional({ enum: TICKET_PRIORITIES }) @IsOptional() @IsIn(TICKET_PRIORITIES) priority?: TicketPriority;
  @ApiPropertyOptional() @IsOptional() @IsInt() asset_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() vendor_id?: number;
  @ApiPropertyOptional({ description: 'Open or in progress only' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;
}

export class ScheduleDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: RefDto, description: 'The asset, named "TAG · name"' }) asset: RefDto;
  @ApiProperty() asset_tag: string;
  @ApiProperty({ example: 'AC service' }) title: string;
  @ApiProperty({ example: 180 }) interval_days: number;
  @ApiProperty({ example: '2026-12-01' }) next_due_on: string;
  @ApiProperty({ nullable: true, type: String }) last_done_on: string | null;
  @ApiProperty({ nullable: true, type: RefDto }) vendor: RefDto | null;
  @ApiProperty() is_active: boolean;
  @ApiProperty({ enum: ['overdue', 'due_soon', 'scheduled'] }) state: 'overdue' | 'due_soon' | 'scheduled';
  @ApiProperty({ nullable: true, type: Number, description: 'Open ticket raised from this schedule' })
  open_ticket_id: number | null;
}

export class ScheduleInputDto {
  @ApiProperty() @IsInt() asset_id: number;
  @ApiProperty({ example: 'AC service' }) @Transform(trim) @IsString() @Length(3, 120) title: string;
  @ApiProperty({ example: 180 }) @IsInt() @Min(1) @Max(3650) interval_days: number;
  @IsDateOnly('2026-12-01') next_due_on: string;
  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  vendor_id?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_active?: boolean;
}

export class ScheduleUpdateDto extends PartialType(ScheduleInputDto) {}

export class ScheduleQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: ['overdue', 'due_soon', 'scheduled'] })
  @IsOptional()
  @IsIn(['overdue', 'due_soon', 'scheduled'])
  state?: 'overdue' | 'due_soon' | 'scheduled';
  @ApiPropertyOptional() @IsOptional() @IsInt() asset_id?: number;
}

export class StockItemDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'A4 paper (75 gsm)' }) name: string;
  @ApiProperty({ example: 'PAP-A4' }) code: string;
  @ApiProperty({ type: RefDto }) category: RefDto;
  @ApiProperty({ enum: STOCK_UNITS }) unit: StockUnit;
  @ApiProperty({ example: 10 }) reorder_level: number;
  @ApiProperty({ nullable: true, type: String }) description: string | null;
  @ApiProperty() is_active: boolean;
  @ApiProperty({ example: 42, description: 'All stores, or the store filtered' }) quantity: number;
  @ApiProperty({ example: 10500 }) value: number;
  @ApiProperty({ example: 250, description: 'Average cost per unit' }) average_rate: number;
  @ApiProperty({ example: false, description: 'At or below the reorder level' }) low: boolean;
}

export class StockItemInputDto {
  @ApiProperty({ example: 'A4 paper (75 gsm)' }) @Transform(trim) @IsString() @Length(2, 120) name: string;
  @ApiPropertyOptional({ example: 'PAP-A4', description: 'Made from the name when left out' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @Length(1, 30)
  code?: string;
  @ApiProperty() @IsInt() category_id: number;
  @ApiPropertyOptional({ enum: STOCK_UNITS, default: 'pcs' }) @IsOptional() @IsIn(STOCK_UNITS) unit?: StockUnit;
  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  reorder_level?: number;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  description?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_active?: boolean;
}

export class StockItemUpdateDto extends PartialType(StockItemInputDto) {}

export class StockItemQueryDto extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() category_id?: number;
  @ApiPropertyOptional({ description: 'Balance in this store' }) @IsOptional() @IsInt() store_id?: number;
  @ApiPropertyOptional({ description: 'At or below the reorder level' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  low?: boolean;
  @ApiPropertyOptional() @IsOptional() @Transform(toBoolean) @IsBoolean() is_active?: boolean;
}

export class StockBalanceDto {
  @ApiProperty({ type: RefDto }) store: RefDto;
  @ApiProperty() quantity: number;
  @ApiProperty() value: number;
}

export class StockItemDetailDto extends StockItemDto {
  @ApiProperty({ type: [StockBalanceDto] }) balances: StockBalanceDto[];
}

export class StockInsightsDto {
  @ApiProperty({ example: 48 }) items: number;
  @ApiProperty({ example: 86500 }) stock_value: number;
  @ApiProperty({ example: 6 }) low_stock: number;
  @ApiProperty({ example: 2 }) out_of_stock: number;
  @ApiProperty({ example: 4 }) pending_requisitions: number;
  @ApiProperty({ example: 2, description: 'Approved and waiting to be issued' }) to_issue: number;
  @ApiProperty({ example: 12500 }) received_this_month: number;
  @ApiProperty({ example: 9800 }) issued_this_month: number;
}

export class ReceiptLineInputDto {
  @ApiProperty() @IsInt() item_id: number;
  @ApiProperty({ example: 20 }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) quantity: number;
  @ApiProperty({ example: 250 }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) rate: number;
}

export class ReceiptInputDto {
  @ApiProperty() @IsInt() store_id: number;
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
  @IsDateOnly('2026-11-15', true) invoice_date?: string;
  @IsDateOnly('2026-11-18', true) received_on?: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  notes?: string | null;
  @ApiProperty({ type: [ReceiptLineInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ReceiptLineInputDto)
  lines: ReceiptLineInputDto[];
}

export class ReceiptLineDto {
  @ApiProperty({ type: RefDto }) item: RefDto;
  @ApiProperty({ enum: STOCK_UNITS }) unit: StockUnit;
  @ApiProperty() quantity: number;
  @ApiProperty() rate: number;
  @ApiProperty() amount: number;
}

export class ReceiptDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'TZMS-GRN-2026-0003' }) receipt_no: string;
  @ApiProperty({ type: RefDto }) store: RefDto;
  @ApiProperty({ nullable: true, type: RefDto }) vendor: RefDto | null;
  @ApiProperty({ nullable: true, type: String }) invoice_no: string | null;
  @ApiProperty({ nullable: true, type: String }) invoice_date: string | null;
  @ApiProperty() received_on: string;
  @ApiProperty() total: number;
  @ApiProperty({ nullable: true, type: String }) notes: string | null;
  @ApiProperty({ nullable: true, type: String }) received_by: string | null;
  @ApiProperty({ type: [ReceiptLineDto] }) lines: ReceiptLineDto[];
  @ApiProperty() created_at: Date;
}

export class ReceiptQueryDto extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() store_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() vendor_id?: number;
  @IsDateOnly('2026-11-01', true) from?: string;
  @IsDateOnly('2026-11-30', true) to?: string;
}

export const ADJUSTMENT_REASONS = ['damaged', 'expired', 'count_correction', 'returned', 'other'] as const;

export class AdjustmentInputDto {
  @ApiProperty() @IsInt() item_id: number;
  @ApiProperty() @IsInt() store_id: number;
  @ApiProperty({ example: -2, description: 'Positive adds stock, negative removes it' })
  @IsNumber({ maxDecimalPlaces: 2 })
  quantity: number;
  @ApiProperty({ enum: ADJUSTMENT_REASONS }) @IsIn(ADJUSTMENT_REASONS) reason: (typeof ADJUSTMENT_REASONS)[number];
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  note?: string | null;
  @ApiPropertyOptional({ description: 'Rate for stock added back; defaults to the average cost' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  rate?: number;
}

export class DirectIssueLineDto {
  @ApiProperty() @IsInt() item_id: number;
  @ApiProperty({ example: 5 }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) quantity: number;
}

export class DirectIssueDto {
  @ApiProperty() @IsInt() store_id: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() department_id?: number;
  @ApiPropertyOptional({ description: 'Staff member (user id) it is given to' })
  @IsOptional()
  @IsInt()
  user_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() section_id?: number;
  @ApiProperty({ example: 'Chart work for 6-A' }) @Transform(trim) @IsString() @Length(3, 255) purpose: string;
  @ApiProperty({ type: [DirectIssueLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DirectIssueLineDto)
  lines: DirectIssueLineDto[];
}

export class MovementDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: RefDto }) item: RefDto;
  @ApiProperty({ enum: STOCK_UNITS }) unit: StockUnit;
  @ApiProperty({ type: RefDto }) store: RefDto;
  @ApiProperty({ enum: MOVEMENT_KINDS }) kind: MovementKind;
  @ApiProperty({ example: -5, description: 'Positive = in, negative = out' }) quantity: number;
  @ApiProperty() rate: number;
  @ApiProperty() value: number;
  @ApiProperty({ description: 'Balance in the store after this movement' }) balance_after: number;
  @ApiProperty({ nullable: true, type: String }) reference: string | null;
  @ApiProperty({ nullable: true, type: RefDto }) department: RefDto | null;
  @ApiProperty({ nullable: true, type: String, description: 'Staff member it was given to' }) person: string | null;
  @ApiProperty({ nullable: true, type: RefDto }) section: RefDto | null;
  @ApiProperty({ nullable: true, type: String }) note: string | null;
  @ApiProperty() moved_on: string;
  @ApiProperty({ nullable: true, type: String }) by: string | null;
  @ApiProperty() created_at: Date;
}

export class MovementQueryDto extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() item_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() store_id?: number;
  @ApiPropertyOptional({ enum: MOVEMENT_KINDS }) @IsOptional() @IsIn(MOVEMENT_KINDS) kind?: MovementKind;
  @ApiPropertyOptional() @IsOptional() @IsInt() department_id?: number;
  @IsDateOnly('2026-11-01', true) from?: string;
  @IsDateOnly('2026-11-30', true) to?: string;
}

export class RequisitionLineInputDto {
  @ApiProperty() @IsInt() item_id: number;
  @ApiProperty({ example: 50 }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) quantity: number;
}

export class RequisitionInputDto {
  @ApiProperty() @IsInt() store_id: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() department_id?: number;
  @ApiPropertyOptional({ description: 'Staff member (user id) asking' })
  @IsOptional()
  @IsInt()
  requested_for_user_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() section_id?: number;
  @ApiProperty({ example: 'Chart work for 6-A' }) @Transform(trim) @IsString() @Length(3, 255) purpose: string;
  @IsDateOnly('2026-11-25', true) needed_by?: string;
  @ApiProperty({ type: [RequisitionLineInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => RequisitionLineInputDto)
  lines: RequisitionLineInputDto[];
}

export class ApprovalLineDto {
  @ApiProperty() @IsInt() item_id: number;
  @ApiProperty({ example: 40, description: 'Approved quantity (0 drops the line)' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  approved_quantity: number;
}

export class RequisitionApproveDto {
  @ApiPropertyOptional({ type: [ApprovalLineDto], description: 'Change quantities; left out = approve as asked' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ApprovalLineDto)
  lines?: ApprovalLineDto[];
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  note?: string | null;
}

export class IssueLineDto {
  @ApiProperty() @IsInt() item_id: number;
  @ApiProperty({ example: 40 }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) quantity: number;
}

export class RequisitionIssueDto {
  @ApiPropertyOptional({ type: [IssueLineDto], description: 'Quantities given now; left out = everything still due' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => IssueLineDto)
  lines?: IssueLineDto[];
}

export class RequisitionLineDto {
  @ApiProperty({ type: RefDto }) item: RefDto;
  @ApiProperty({ enum: STOCK_UNITS }) unit: StockUnit;
  @ApiProperty() quantity: number;
  @ApiProperty({ nullable: true, type: Number }) approved_quantity: number | null;
  @ApiProperty() issued_quantity: number;
  @ApiProperty({ description: 'In the requisition store now' }) available: number;
}

export class RequisitionDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'TZMS-REQ-2026-0009' }) requisition_no: string;
  @ApiProperty({ type: RefDto }) store: RefDto;
  @ApiProperty({ nullable: true, type: RefDto }) department: RefDto | null;
  @ApiProperty({ nullable: true, type: UserRefDto }) requested_for: UserRefDto | null;
  @ApiProperty({ nullable: true, type: RefDto }) section: RefDto | null;
  @ApiProperty() purpose: string;
  @ApiProperty({ nullable: true, type: String }) needed_by: string | null;
  @ApiProperty({ enum: REQUISITION_STATUSES }) status: RequisitionStatus;
  @ApiProperty({ nullable: true, type: String }) raised_by: string | null;
  @ApiProperty({ nullable: true, type: String }) decided_by: string | null;
  @ApiProperty({ nullable: true, type: Date }) decided_at: Date | null;
  @ApiProperty({ nullable: true, type: String }) decision_note: string | null;
  @ApiProperty({ nullable: true, type: Date }) issued_at: Date | null;
  @ApiProperty({ type: [RequisitionLineDto] }) lines: RequisitionLineDto[];
  @ApiProperty() created_at: Date;
}

export class RequisitionQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: REQUISITION_STATUSES })
  @IsOptional()
  @IsIn(REQUISITION_STATUSES)
  status?: RequisitionStatus;
  @ApiPropertyOptional() @IsOptional() @IsInt() department_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() store_id?: number;
}

export class AuditDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'Half-yearly verification' }) name: string;
  @ApiProperty({ enum: AUDIT_KINDS }) kind: AuditKind;
  @ApiProperty({ enum: AUDIT_STATUSES }) status: AuditStatus;
  @ApiProperty({ nullable: true, type: RefDto }) location: RefDto | null;
  @ApiProperty({ nullable: true, type: RefDto }) category: RefDto | null;
  @ApiProperty({ nullable: true, type: RefDto }) department: RefDto | null;
  @ApiProperty({ nullable: true, type: RefDto }) store: RefDto | null;
  @ApiProperty({ example: 120, description: 'Assets expected, or items to count' }) expected: number;
  @ApiProperty({ example: 98, description: 'Scanned, or counted' }) checked: number;
  @ApiProperty({ example: 90 }) found: number;
  @ApiProperty({ example: 5 }) misplaced: number;
  @ApiProperty({ example: 1, description: 'Scanned but lost, disposed or in maintenance in the records' })
  not_available: number;
  @ApiProperty({ example: 2 }) unknown: number;
  @ApiProperty({ example: 22, description: 'Expected but not scanned (assets) or not counted yet (stock)' })
  missing: number;
  @ApiProperty({ example: 3, description: 'Stock: items whose count differs from the system' }) differences: number;
  @ApiProperty({ nullable: true, type: String }) notes: string | null;
  @ApiProperty({ nullable: true, type: String }) started_by: string | null;
  @ApiProperty() created_at: Date;
  @ApiProperty({ nullable: true, type: Date }) closed_at: Date | null;
}

export class AuditInputDto {
  @ApiProperty({ example: 'Half-yearly verification' }) @Transform(trim) @IsString() @Length(3, 80) name: string;
  @ApiProperty({ enum: AUDIT_KINDS }) @IsIn(AUDIT_KINDS) kind: AuditKind;
  @ApiPropertyOptional({ description: 'Asset audit: only this location' }) @IsOptional() @IsInt() location_id?: number;
  @ApiPropertyOptional({ description: 'Only this category' }) @IsOptional() @IsInt() category_id?: number;
  @ApiPropertyOptional({ description: 'Asset audit: only this department' })
  @IsOptional()
  @IsInt()
  department_id?: number;
  @ApiPropertyOptional({ description: 'Stock count: the store (required)' }) @IsOptional() @IsInt() store_id?: number;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  notes?: string | null;
}

export class AuditScanDto {
  @ApiProperty({ example: 'TZMS-AST-000041' }) @Transform(trim) @IsString() @Length(1, 60) code: string;
  @ApiPropertyOptional({ description: 'Where it was found (for a whole-school audit)' })
  @IsOptional()
  @IsInt()
  location_id?: number;
}

export class AuditItemDto {
  @ApiProperty() id: number;
  @ApiProperty() code: string;
  @ApiProperty({ enum: [...AUDIT_FINDINGS, 'missing'] }) finding: AuditFinding | 'missing';
  @ApiProperty({ nullable: true, type: AssetDto }) asset: AssetDto | null;
  @ApiProperty({ nullable: true, type: RefDto }) found_location: RefDto | null;
  @ApiProperty({ nullable: true, type: Date }) scanned_at: Date | null;
}

export class AuditScanResultDto {
  @ApiProperty({ enum: AUDIT_FINDINGS }) finding: AuditFinding;
  @ApiProperty({ example: 'Found where it belongs' }) message: string;
  @ApiProperty() repeated: boolean;
  @ApiProperty({ nullable: true, type: AssetDto }) asset: AssetDto | null;
  @ApiProperty({ type: AuditDto }) audit: AuditDto;
}

export class AuditItemsQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: [...AUDIT_FINDINGS, 'missing'] })
  @IsOptional()
  @IsIn([...AUDIT_FINDINGS, 'missing'])
  finding?: AuditFinding | 'missing';
}

export class CountLineDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: RefDto }) item: RefDto;
  @ApiProperty({ enum: STOCK_UNITS }) unit: StockUnit;
  @ApiProperty() system_quantity: number;
  @ApiProperty({ nullable: true, type: Number }) counted_quantity: number | null;
  @ApiProperty({ nullable: true, type: Number, description: 'counted − system' }) difference: number | null;
  @ApiProperty({ nullable: true, type: String }) note: string | null;
}

export class CountInputLineDto {
  @ApiProperty() @IsInt() item_id: number;
  @ApiProperty({ example: 38 }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) counted_quantity: number;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  note?: string | null;
}

export class CountInputDto {
  @ApiProperty({ type: [CountInputLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => CountInputLineDto)
  lines: CountInputLineDto[];
}

export class AuditCloseDto {
  @ApiPropertyOptional({ description: 'Asset audit: mark the assets still missing as lost' })
  @IsOptional()
  @IsBoolean()
  mark_missing_lost?: boolean;
  @ApiPropertyOptional({ description: 'Stock count: post the differences as stock adjustments' })
  @IsOptional()
  @IsBoolean()
  post_adjustments?: boolean;
}

export class ReportQueryDto {
  @IsDateOnly('2026-06-01', true) from?: string;
  @IsDateOnly('2026-11-30', true) to?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() category_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() location_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() department_id?: number;
  @ApiPropertyOptional({ description: 'Valuation as on this date (default today)' })
  @IsDateOnly('2026-11-30', true)
  as_on?: string;
}

export const GROUP_BY = ['category', 'location', 'department', 'custodian', 'status'] as const;

export class GroupQueryDto extends ReportQueryDto {
  @ApiProperty({ enum: GROUP_BY }) @IsIn(GROUP_BY) group_by: (typeof GROUP_BY)[number];
}

export class GroupRowDto {
  @ApiProperty({ nullable: true, type: Number }) id: number | null;
  @ApiProperty({ example: 'Computer Lab' }) name: string;
  @ApiProperty() assets: number;
  @ApiProperty() cost: number;
  @ApiProperty() book_value: number;
  @ApiProperty() allocated: number;
  @ApiProperty() in_maintenance: number;
}

export class DepreciationRowDto {
  @ApiProperty({ type: RefDto }) category: RefDto;
  @ApiProperty() assets: number;
  @ApiProperty() cost: number;
  @ApiProperty({ description: 'Book value at the start of the range' }) opening_value: number;
  @ApiProperty({ description: 'Depreciation in the range' }) depreciation: number;
  @ApiProperty({ description: 'Book value at the end of the range' }) closing_value: number;
}

export class MaintenanceCostRowDto {
  @ApiProperty({ type: RefDto }) category: RefDto;
  @ApiProperty() tickets: number;
  @ApiProperty() resolved: number;
  @ApiProperty() cost: number;
  @ApiProperty({ nullable: true, type: Number }) average_downtime_days: number | null;
}

export class ConsumptionRowDto {
  @ApiProperty({ nullable: true, type: RefDto }) department: RefDto | null;
  @ApiProperty({ type: RefDto }) item: RefDto;
  @ApiProperty({ enum: STOCK_UNITS }) unit: StockUnit;
  @ApiProperty() quantity: number;
  @ApiProperty() value: number;
}

export class StockValuationRowDto {
  @ApiProperty({ type: RefDto }) item: RefDto;
  @ApiProperty({ type: RefDto }) category: RefDto;
  @ApiProperty({ enum: STOCK_UNITS }) unit: StockUnit;
  @ApiProperty() quantity: number;
  @ApiProperty() average_rate: number;
  @ApiProperty() value: number;
  @ApiProperty() reorder_level: number;
  @ApiProperty() low: boolean;
}

export class InventoryDashboardDto {
  @ApiProperty({ type: AssetInsightsDto }) assets: AssetInsightsDto;
  @ApiProperty({ type: StockInsightsDto }) stock: StockInsightsDto;
  @ApiProperty({ example: 4 }) open_tickets: number;
  @ApiProperty({ example: 3 }) maintenance_due: number;
  @ApiProperty({ example: 2 }) pending_transfers: number;
  @ApiProperty({ example: 1 }) pending_disposals: number;
  @ApiProperty({ type: [StockItemDto], description: 'Low stock (up to 8)' }) low_stock: StockItemDto[];
  @ApiProperty({ type: [ScheduleDto], description: 'Maintenance overdue or due soon (up to 8)' })
  maintenance_due_list: ScheduleDto[];
  @ApiProperty({ type: [AssetDto], description: 'Warranty or AMC ending soon (up to 8)' })
  warranty_expiring: AssetDto[];
  @ApiProperty({ type: [AllocationDto], description: 'Overdue returns (up to 8)' }) overdue_returns: AllocationDto[];
  @ApiProperty({ type: [RequisitionDto], description: 'Waiting for approval or issue (up to 8)' })
  requisitions: RequisitionDto[];
  @ApiProperty({ type: [TransferDto], description: 'Waiting for approval (up to 8)' }) transfers: TransferDto[];
  @ApiProperty({ type: [DisposalDto], description: 'Waiting for approval (up to 8)' }) disposals: DisposalDto[];
}

export class MyAssetDto {
  @ApiProperty() allocation_id: number;
  @ApiProperty({ type: AssetDto }) asset: AssetDto;
  @ApiProperty() allocated_on: string;
  @ApiProperty({ nullable: true, type: String }) expected_return_on: string | null;
  @ApiProperty({ nullable: true, type: Date }) acknowledged_at: Date | null;
  @ApiProperty() overdue: boolean;
}

export class PeopleAssetsDto {
  @ApiProperty({ type: [AllocationDto], description: 'Allocated now' }) current: AllocationDto[];
  @ApiProperty({ type: [AllocationDto], description: 'Returned, last 50' }) history: AllocationDto[];
}

export class InventoryAlertResultDto {
  @ApiProperty({ example: 2, description: 'Overdue return reminders sent to staff' }) overdue_returns: number;
  @ApiProperty({ example: 3, description: 'Schedules in the maintenance digest' }) maintenance_due: number;
  @ApiProperty({ example: 1, description: 'Assets in the warranty/AMC digest' }) warranty_expiring: number;
  @ApiProperty({ example: 4, description: 'Items in the low stock digest' }) low_stock: number;
}
