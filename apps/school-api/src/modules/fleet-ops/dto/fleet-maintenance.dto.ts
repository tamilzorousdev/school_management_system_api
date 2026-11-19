import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
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
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ListQueryDto, toBoolean } from '@app/common';
import { IsDateOnly } from '../../../shared/dates';
import { FileDto } from '../../files/dto/file.dto';
import {
  CHANGE_ENTITIES,
  ChangeAction,
  ChangeEntity,
  EXPENSE_CATEGORIES,
  ExpenseCategory,
  PAYMENT_MODES,
  PaymentMode,
  PRE_TRIP_ITEMS,
  PreTripItem,
  SERVICE_CATEGORIES,
  ServiceCategory,
  VENDOR_KINDS,
  VendorKind,
} from '../entities/fleet-maintenance.entity';
import { BusRefDto, PersonRefDto, TicketDto, VendorRefDto } from './fleet-ops.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const upperToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() || null : value;
const present = (_dto: object, value: unknown) => value !== undefined;

export const DUE_STATUSES = ['ok', 'due_soon', 'overdue'] as const;
export const LOG_TYPES = ['fuel', 'service', 'repair', 'expense', 'check'] as const;
export type LogType = (typeof LOG_TYPES)[number];
export const REPORTS = ['costs', 'mileage', 'due', 'spend', 'idle', 'reimbursements'] as const;
export type ReportName = (typeof REPORTS)[number];
export const CHECK_STATES = ['ok', 'failed', 'blocked'] as const;

const MAX_ODOMETER = 2000000;
const MAX_AMOUNT = 1000000;

export class FleetSettingsDto {
  @ApiProperty({ example: 500, description: 'A service is due soon within this many km' })
  due_soon_km: number;

  @ApiProperty({ example: 15, description: 'A service is due soon within this many days' })
  due_soon_days: number;

  @ApiProperty({ example: 20, description: 'Alert when km/l falls this many percent below the bus normal' })
  low_mileage_drop_pct: number;

  @ApiProperty({ example: 15, description: 'Warn when the fuel price is this many percent away from the bus average' })
  price_warning_pct: number;

  @ApiProperty({ example: 2.5, description: 'Litres an idling bus burns an hour, for the idle fuel report' })
  idle_litres_per_hour: number;

  @ApiProperty({ example: false, description: 'A bus cannot start a trip until today’s pre-trip check is done' })
  pre_trip_check_required: boolean;

  @ApiProperty({
    example: '2026-10-31',
    nullable: true,
    type: String,
    description: 'Entries up to this day are locked',
  })
  locked_until: string | null;
}

export class UpdateFleetSettingsDto {
  @ApiPropertyOptional({ example: 500 })
  @ValidateIf(present)
  @IsInt()
  @Min(50)
  @Max(5000)
  due_soon_km?: number;

  @ApiPropertyOptional({ example: 15 })
  @ValidateIf(present)
  @IsInt()
  @Min(1)
  @Max(90)
  due_soon_days?: number;

  @ApiPropertyOptional({ example: 20 })
  @ValidateIf(present)
  @IsInt()
  @Min(5)
  @Max(60)
  low_mileage_drop_pct?: number;

  @ApiPropertyOptional({ example: 15 })
  @ValidateIf(present)
  @IsInt()
  @Min(5)
  @Max(50)
  price_warning_pct?: number;

  @ApiPropertyOptional({ example: 2.5 })
  @ValidateIf(present)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.5)
  @Max(10)
  idle_litres_per_hour?: number;

  @ApiPropertyOptional({ example: false })
  @ValidateIf(present)
  @IsBoolean()
  pre_trip_check_required?: boolean;

  @ApiPropertyOptional({
    example: '2026-10-31',
    nullable: true,
    type: String,
    description: 'Last day of a closed month; null unlocks everything. Must be a month end before this month.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'locked_until must be a date in YYYY-MM-DD format' })
  locked_until?: string | null;
}

export class UpdateVehiclePlanDto {
  @ApiPropertyOptional({ example: 160, nullable: true, type: Number, description: 'Fuel tank size in litres' })
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(1000)
  tank_litres?: number | null;

  @ApiPropertyOptional({ example: 40000, nullable: true, type: Number, description: 'Monthly spend budget, rupees' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(MAX_AMOUNT)
  monthly_budget?: number | null;
}

export class VendorDto extends VendorRefDto {
  @ApiProperty({ enum: VENDOR_KINDS, example: 'garage' })
  kind: VendorKind;

  @ApiProperty({ example: '33ABCDE1234F1Z5', nullable: true, type: String })
  gst_no: string | null;

  @ApiProperty({ example: 'Anna Nagar, Chennai', nullable: true, type: String })
  address: string | null;

  @ApiProperty({ example: true })
  is_active: boolean;

  @ApiProperty({ example: 42500, description: 'Total spent with them (services, repairs, fuel and expenses)' })
  total_spent: number;
}

export class VendorInputDto {
  @ApiProperty({ enum: VENDOR_KINDS, example: 'garage' })
  @IsIn(VENDOR_KINDS)
  kind: VendorKind;

  @ApiProperty({ example: 'Sri Murugan Motors' })
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  name: string;

  @ApiPropertyOptional({ example: '9876500011', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @Matches(/^[0-9+\- ]{6,15}$/, { message: 'phone must be 6 to 15 digits' })
  phone?: string | null;

  @ApiPropertyOptional({ example: '33ABCDE1234F1Z5', nullable: true, type: String })
  @IsOptional()
  @Transform(upperToNull)
  @Matches(/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/, { message: 'gst_no must be a valid 15-character GSTIN' })
  gst_no?: string | null;

  @ApiPropertyOptional({ example: 'Anna Nagar, Chennai', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(200)
  address?: string | null;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateVendorDto {
  @ApiPropertyOptional({ example: 'Sri Murugan Motors' })
  @ValidateIf(present)
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  name?: string;

  @ApiPropertyOptional({ example: '9876500011', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @Matches(/^[0-9+\- ]{6,15}$/, { message: 'phone must be 6 to 15 digits' })
  phone?: string | null;

  @ApiPropertyOptional({ example: '33ABCDE1234F1Z5', nullable: true, type: String })
  @IsOptional()
  @Transform(upperToNull)
  @Matches(/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/, { message: 'gst_no must be a valid 15-character GSTIN' })
  gst_no?: string | null;

  @ApiPropertyOptional({ example: 'Anna Nagar, Chennai', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(200)
  address?: string | null;

  @ApiPropertyOptional({ example: true })
  @ValidateIf(present)
  @IsBoolean()
  is_active?: boolean;
}

export class VendorQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: VENDOR_KINDS })
  @IsOptional()
  @IsIn(VENDOR_KINDS)
  kind?: VendorKind;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;
}

export class ScheduleDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ type: BusRefDto })
  vehicle: BusRefDto;

  @ApiProperty({ enum: SERVICE_CATEGORIES, example: 'engine_oil' })
  category: ServiceCategory;

  @ApiProperty({ example: 'Engine oil and filter change' })
  title: string;

  @ApiProperty({ example: 10000, nullable: true, type: Number })
  every_km: number | null;

  @ApiProperty({ example: 6, nullable: true, type: Number })
  every_months: number | null;

  @ApiProperty({ example: '2026-06-01' })
  last_done_on: string;

  @ApiProperty({ example: 40000, nullable: true, type: Number })
  last_done_km: number | null;

  @ApiProperty({ example: true })
  is_active: boolean;

  @ApiProperty({ example: 46210, nullable: true, type: Number, description: 'Latest known odometer of the bus' })
  current_km: number | null;

  @ApiProperty({ example: '2026-12-01', nullable: true, type: String })
  next_due_on: string | null;

  @ApiProperty({ example: 50000, nullable: true, type: Number })
  next_due_km: number | null;

  @ApiProperty({ example: 13, nullable: true, type: Number })
  days_left: number | null;

  @ApiProperty({ example: 3790, nullable: true, type: Number })
  km_left: number | null;

  @ApiProperty({ enum: DUE_STATUSES, example: 'due_soon' })
  status: (typeof DUE_STATUSES)[number];
}

export class ScheduleInputDto {
  @ApiProperty({ type: [Number], example: [1, 2], description: 'Add the same rule to each of these buses' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  vehicle_ids: number[];

  @ApiProperty({ enum: SERVICE_CATEGORIES, example: 'engine_oil' })
  @IsIn(SERVICE_CATEGORIES)
  category: ServiceCategory;

  @ApiPropertyOptional({ example: 'Engine oil and filter change', description: 'Defaults to the category name' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(3, 100)
  title?: string;

  @ApiPropertyOptional({ example: 10000, nullable: true, type: Number })
  @IsOptional()
  @IsInt()
  @Min(500)
  @Max(200000)
  every_km?: number | null;

  @ApiPropertyOptional({ example: 6, nullable: true, type: Number })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  every_months?: number | null;

  @IsDateOnly('2026-06-01', true)
  last_done_on?: string;

  @ApiPropertyOptional({
    example: 40000,
    nullable: true,
    type: Number,
    description: 'Defaults to the bus’s current km',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(MAX_ODOMETER)
  last_done_km?: number | null;
}

export class UpdateScheduleDto {
  @ApiPropertyOptional({ example: 'Engine oil and filter change' })
  @ValidateIf(present)
  @Transform(trim)
  @IsString()
  @Length(3, 100)
  title?: string;

  @ApiPropertyOptional({ example: 10000, nullable: true, type: Number })
  @IsOptional()
  @IsInt()
  @Min(500)
  @Max(200000)
  every_km?: number | null;

  @ApiPropertyOptional({ example: 6, nullable: true, type: Number })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  every_months?: number | null;

  @ApiPropertyOptional({ example: '2026-06-01', format: 'date' })
  @ValidateIf(present)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'last_done_on must be a date in YYYY-MM-DD format' })
  last_done_on?: string;

  @ApiPropertyOptional({ example: 40000, nullable: true, type: Number })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(MAX_ODOMETER)
  last_done_km?: number | null;

  @ApiPropertyOptional({ example: true })
  @ValidateIf(present)
  @IsBoolean()
  is_active?: boolean;
}

export class ApplyStandardDto {
  @ApiPropertyOptional({ type: [Number], example: [1, 2], description: 'Leave out for every active bus' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  vehicle_ids?: number[];
}

export class ApplyStandardResultDto {
  @ApiProperty({ example: 8, description: 'Rules added (a bus that already has a rule for a category keeps it)' })
  added: number;

  @ApiProperty({ example: 2 })
  buses: number;
}

export class ScheduleQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  vehicle_id?: number;

  @ApiPropertyOptional({ enum: DUE_STATUSES })
  @IsOptional()
  @IsIn(DUE_STATUSES)
  status?: (typeof DUE_STATUSES)[number];

  @ApiPropertyOptional({ enum: SERVICE_CATEGORIES })
  @IsOptional()
  @IsIn(SERVICE_CATEGORIES)
  category?: ServiceCategory;
}

export class ExpenseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ type: BusRefDto })
  vehicle: BusRefDto;

  @ApiProperty({ example: '2026-11-10' })
  spent_on: string;

  @ApiProperty({ enum: EXPENSE_CATEGORIES, example: 'insurance' })
  category: ExpenseCategory;

  @ApiProperty({ example: 38500 })
  amount: number;

  @ApiProperty({ type: VendorRefDto, nullable: true })
  vendor: VendorRefDto | null;

  @ApiProperty({ example: 'New India Assurance', nullable: true, type: String })
  paid_to: string | null;

  @ApiProperty({ enum: PAYMENT_MODES, example: 'upi' })
  payment_mode: PaymentMode;

  @ApiProperty({ example: null, nullable: true, type: Date })
  reimbursed_at: Date | null;

  @ApiProperty({ type: FileDto, nullable: true })
  bill_file: FileDto | null;

  @ApiProperty({ example: 'Yearly policy', nullable: true, type: String })
  note: string | null;

  @ApiProperty({ example: '2027-11-09', nullable: true, type: String, description: 'New expiry set in Vehicle Master' })
  renewed_until: string | null;

  @ApiProperty({ type: PersonRefDto, nullable: true })
  created_by: PersonRefDto | null;

  @ApiProperty({ example: '2026-11-10T10:00:00.000+05:30' })
  created_at: Date;
}

export class ExpenseInputDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  vehicle_id: number;

  @IsDateOnly('2026-11-10')
  spent_on: string;

  @ApiProperty({ enum: EXPENSE_CATEGORIES, example: 'insurance' })
  @IsIn(EXPENSE_CATEGORIES)
  category: ExpenseCategory;

  @ApiProperty({ example: 38500 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(MAX_AMOUNT)
  amount: number;

  @ApiPropertyOptional({ example: 3, nullable: true, type: Number, description: 'Saved garage or vendor' })
  @IsOptional()
  @IsInt()
  @Min(1)
  vendor_id?: number | null;

  @ApiPropertyOptional({ example: 'New India Assurance', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(100)
  paid_to?: string | null;

  @ApiPropertyOptional({ enum: PAYMENT_MODES, example: 'upi' })
  @IsOptional()
  @IsIn(PAYMENT_MODES)
  payment_mode?: PaymentMode;

  @ApiPropertyOptional({ example: 21, nullable: true, type: Number })
  @IsOptional()
  @IsInt()
  @Min(1)
  bill_file_id?: number | null;

  @ApiPropertyOptional({ example: 'Yearly policy', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @ApiPropertyOptional({
    example: '2027-11-09',
    nullable: true,
    type: String,
    description:
      'For a document renewal (insurance, fitness, permit, puc, road_tax, rc, speed_governor, fire_extinguisher, first_aid): the new expiry, saved to Vehicle Master too',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'renewed_until must be a date in YYYY-MM-DD format' })
  renewed_until?: string | null;
}

export class UpdateExpenseDto {
  @ApiPropertyOptional({ example: '2026-11-10', format: 'date' })
  @ValidateIf(present)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'spent_on must be a date in YYYY-MM-DD format' })
  spent_on?: string;

  @ApiPropertyOptional({ enum: EXPENSE_CATEGORIES })
  @ValidateIf(present)
  @IsIn(EXPENSE_CATEGORIES)
  category?: ExpenseCategory;

  @ApiPropertyOptional({ example: 38500 })
  @ValidateIf(present)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(MAX_AMOUNT)
  amount?: number;

  @ApiPropertyOptional({ example: 3, nullable: true, type: Number })
  @IsOptional()
  @IsInt()
  @Min(1)
  vendor_id?: number | null;

  @ApiPropertyOptional({ example: 'New India Assurance', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(100)
  paid_to?: string | null;

  @ApiPropertyOptional({ enum: PAYMENT_MODES })
  @ValidateIf(present)
  @IsIn(PAYMENT_MODES)
  payment_mode?: PaymentMode;

  @ApiPropertyOptional({ example: 21, nullable: true, type: Number })
  @IsOptional()
  @IsInt()
  @Min(1)
  bill_file_id?: number | null;

  @ApiPropertyOptional({ example: 'Yearly policy', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @ApiPropertyOptional({ example: 'Bill amount corrected', description: 'Why it was changed, kept in the history' })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(300)
  reason?: string | null;
}

export class ExpenseQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  vehicle_id?: number;

  @ApiPropertyOptional({ enum: EXPENSE_CATEGORIES })
  @IsOptional()
  @IsIn(EXPENSE_CATEGORIES)
  category?: ExpenseCategory;

  @ApiPropertyOptional({ enum: PAYMENT_MODES })
  @IsOptional()
  @IsIn(PAYMENT_MODES)
  payment_mode?: PaymentMode;

  @ApiPropertyOptional({
    example: false,
    description: 'Driver-paid entries not yet paid back (false) or paid back (true)',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  reimbursed?: boolean;

  @IsDateOnly('2026-11-01', true)
  from?: string;

  @IsDateOnly('2026-11-30', true)
  to?: string;
}

export class CategoryAmountDto {
  @ApiProperty({ example: 'insurance' })
  category: string;

  @ApiProperty({ example: 38500 })
  amount: number;
}

export class ExpenseInsightsDto {
  @ApiProperty({ example: 4 })
  entries_this_month: number;

  @ApiProperty({ example: 41200 })
  amount_this_month: number;

  @ApiProperty({ type: [CategoryAmountDto] })
  by_category: CategoryAmountDto[];

  @ApiProperty({ example: 1200, description: 'Paid by drivers and not yet paid back' })
  driver_paid_pending: number;
}

export class ReviewFuelDto {
  @ApiPropertyOptional({ example: 'Bill checked', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export class RejectFuelDto {
  @ApiProperty({ example: 'Bill photo does not match the amount' })
  @Transform(trim)
  @IsString()
  @Length(3, 300)
  note: string;
}

export class ReasonDto {
  @ApiPropertyOptional({ example: 'Wrong amount typed', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(300)
  reason?: string | null;
}

export class PreTripMarkDto {
  @ApiProperty({ enum: PRE_TRIP_ITEMS, example: 'brakes' })
  @IsIn(PRE_TRIP_ITEMS)
  item: PreTripItem;

  @ApiProperty({ example: true })
  @IsBoolean()
  ok: boolean;

  @ApiPropertyOptional({ example: 'Left indicator not working', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(200)
  note?: string | null;
}

export class PreTripInputDto {
  @ApiProperty({ type: [PreTripMarkDto], description: 'Each of the 10 items; an item left out counts as not OK' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PRE_TRIP_ITEMS.length)
  @ValidateNested({ each: true })
  @Type(() => PreTripMarkDto)
  items: PreTripMarkDto[];

  @ApiPropertyOptional({ example: 46210, nullable: true, type: Number })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(MAX_ODOMETER)
  odometer_km?: number | null;

  @ApiPropertyOptional({
    example: 30,
    nullable: true,
    type: Number,
    description: 'Photo of a problem, from POST /files',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  photo_file_id?: number | null;
}

export class PreTripMarkViewDto {
  @ApiProperty({ enum: PRE_TRIP_ITEMS, example: 'brakes' })
  item: PreTripItem;

  @ApiProperty({ example: 'Brakes' })
  label: string;

  @ApiProperty({ example: true })
  ok: boolean;

  @ApiProperty({ example: null, nullable: true, type: String })
  note: string | null;

  @ApiProperty({ example: true, description: 'A failure blocks trips until the office clears it' })
  critical: boolean;
}

export class PreTripCheckDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ type: BusRefDto })
  vehicle: BusRefDto;

  @ApiProperty({ example: '2026-11-18' })
  check_date: string;

  @ApiProperty({ type: PersonRefDto })
  checked_by: PersonRefDto;

  @ApiProperty({ type: [PreTripMarkViewDto] })
  items: PreTripMarkViewDto[];

  @ApiProperty({ example: 46210, nullable: true, type: Number })
  odometer_km: number | null;

  @ApiProperty({ example: 1 })
  failed_count: number;

  @ApiProperty({ example: false })
  critical_failed: boolean;

  @ApiProperty({ example: false, description: 'A critical item failed and the office has not cleared it: no trips' })
  blocked: boolean;

  @ApiProperty({ example: 12, nullable: true, type: Number, description: 'Repair ticket opened for the failed items' })
  ticket_id: number | null;

  @ApiProperty({ type: FileDto, nullable: true })
  photo_file: FileDto | null;

  @ApiProperty({ type: PersonRefDto, nullable: true })
  cleared_by: PersonRefDto | null;

  @ApiProperty({ example: null, nullable: true, type: Date })
  cleared_at: Date | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  clear_note: string | null;

  @ApiProperty({ example: '2026-11-18T07:05:00.000+05:30' })
  created_at: Date;
}

export class ClearPreTripDto {
  @ApiProperty({ example: 'Brakes adjusted at the garage, checked by the in-charge' })
  @Transform(trim)
  @IsString()
  @Length(3, 300)
  note: string;
}

export class PreTripQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  vehicle_id?: number;

  @IsDateOnly('2026-11-18', true)
  date?: string;

  @ApiPropertyOptional({ enum: CHECK_STATES, description: 'blocked = critical failure not cleared yet' })
  @IsOptional()
  @IsIn(CHECK_STATES)
  state?: (typeof CHECK_STATES)[number];
}

export class PreTripTodayRowDto {
  @ApiProperty({ type: BusRefDto })
  vehicle: BusRefDto;

  @ApiProperty({ type: PreTripCheckDto, nullable: true })
  check: PreTripCheckDto | null;

  @ApiProperty({ example: true })
  off_road: boolean;
}

export class DriverProblemDto {
  @ApiProperty({ example: 'Brake makes noise' })
  @Transform(trim)
  @IsString()
  @Length(3, 150)
  title: string;

  @ApiPropertyOptional({ example: 'Grinding sound when stopping near the school gate', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiPropertyOptional({ enum: SERVICE_CATEGORIES, example: 'brakes' })
  @IsOptional()
  @IsIn(SERVICE_CATEGORIES)
  category?: ServiceCategory;

  @ApiPropertyOptional({ example: 30, nullable: true, type: Number, description: 'Photo from POST /files' })
  @IsOptional()
  @IsInt()
  @Min(1)
  photo_file_id?: number | null;

  @ApiPropertyOptional({ example: 46210, nullable: true, type: Number })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(MAX_ODOMETER)
  odometer_km?: number | null;
}

export class DriverFuelInputDto {
  @IsDateOnly('2026-11-18', true)
  filled_on?: string;

  @ApiProperty({ example: 60.5 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.1)
  @Max(1000)
  litres: number;

  @ApiProperty({ example: 5800 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(100000)
  amount: number;

  @ApiProperty({ example: 48213 })
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(MAX_ODOMETER)
  odometer_km: number;

  @ApiPropertyOptional({ example: true, description: 'Tank filled to full (default true)' })
  @IsOptional()
  @IsBoolean()
  is_full?: boolean;

  @ApiPropertyOptional({ enum: PAYMENT_MODES, example: 'fuel_card' })
  @IsOptional()
  @IsIn(PAYMENT_MODES)
  payment_mode?: PaymentMode;

  @ApiPropertyOptional({ example: 2, nullable: true, type: Number, description: 'Saved fuel station' })
  @IsOptional()
  @IsInt()
  @Min(1)
  station_id?: number | null;

  @ApiPropertyOptional({ example: 'Indian Oil, Anna Nagar', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(100)
  station?: string | null;

  @ApiProperty({ example: 18, description: 'Bill photo from POST /files' })
  @IsInt()
  @Min(1)
  bill_file_id: number;
}

export class VehicleSummaryDto {
  @ApiProperty({ type: BusRefDto })
  vehicle: BusRefDto;

  @ApiProperty({ example: 46210, nullable: true, type: Number })
  current_km: number | null;

  @ApiProperty({ example: 'tracker', enum: ['tracker', 'entries', 'none'] })
  odometer_source: 'tracker' | 'entries' | 'none';

  @ApiProperty({ example: 160, nullable: true, type: Number })
  tank_litres: number | null;

  @ApiProperty({ example: 40000, nullable: true, type: Number })
  monthly_budget: number | null;

  @ApiProperty({ example: 21400 })
  spent_this_month: number;

  @ApiProperty({ example: 17800 })
  fuel_this_month: number;

  @ApiProperty({ example: 6.8, nullable: true, type: Number })
  km_per_litre_this_month: number | null;

  @ApiProperty({ type: ScheduleDto, nullable: true, description: 'The service due first' })
  next_service: ScheduleDto | null;

  @ApiProperty({ example: 1 })
  open_tickets: number;

  @ApiProperty({ example: false })
  off_road: boolean;
}

export class VehicleLogQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: LOG_TYPES })
  @IsOptional()
  @IsIn(LOG_TYPES)
  type?: LogType;

  @IsDateOnly('2026-11-01', true)
  from?: string;

  @IsDateOnly('2026-11-30', true)
  to?: string;
}

export class VehicleLogEntryDto {
  @ApiProperty({ enum: LOG_TYPES, example: 'fuel' })
  type: LogType;

  @ApiProperty({ example: 14, description: 'Id in its own list (fuel entry, ticket, expense or check)' })
  id: number;

  @ApiProperty({ example: '2026-11-18' })
  on: string;

  @ApiProperty({ example: 'Fuel 60.5 L at Indian Oil' })
  title: string;

  @ApiProperty({ example: 'Odometer 48,213 km · full tank', nullable: true, type: String })
  detail: string | null;

  @ApiProperty({ example: 5800, nullable: true, type: Number })
  amount: number | null;

  @ApiProperty({ example: 'approved', nullable: true, type: String })
  status: string | null;

  @ApiProperty({ example: 48213, nullable: true, type: Number })
  odometer_km: number | null;
}

export class ReportRangeDto {
  @IsDateOnly('2026-06-01', true)
  from?: string;

  @IsDateOnly('2027-04-30', true)
  to?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  vehicle_id?: number;
}

export class SpendQueryDto extends ReportRangeDto {
  @ApiPropertyOptional({ enum: ['vendor', 'category'], example: 'category' })
  @IsOptional()
  @IsIn(['vendor', 'category'])
  group?: 'vendor' | 'category';
}

export class CostRowDto {
  @ApiProperty({ type: BusRefDto })
  vehicle: BusRefDto;

  @ApiProperty({ example: '2026-11' })
  month: string;

  @ApiProperty({ example: 17800 })
  fuel: number;

  @ApiProperty({ example: 4500 })
  service: number;

  @ApiProperty({ example: 2000 })
  repair: number;

  @ApiProperty({ example: 600 })
  other: number;

  @ApiProperty({ example: 24900 })
  total: number;

  @ApiProperty({ example: 2600, nullable: true, type: Number, description: 'km run in the month (odometer readings)' })
  km: number | null;

  @ApiProperty({ example: 9.58, nullable: true, type: Number })
  cost_per_km: number | null;

  @ApiProperty({ example: 622.5, nullable: true, type: Number, description: 'total / seats' })
  cost_per_seat: number | null;

  @ApiProperty({ example: 40000, nullable: true, type: Number })
  budget: number | null;

  @ApiProperty({ example: false })
  over_budget: boolean;
}

export class MileageRowDto {
  @ApiProperty({ type: BusRefDto })
  vehicle: BusRefDto;

  @ApiProperty({ example: '2026-11' })
  month: string;

  @ApiProperty({ example: 380 })
  litres: number;

  @ApiProperty({ example: 2600, nullable: true, type: Number })
  km: number | null;

  @ApiProperty({ example: 6.84, nullable: true, type: Number })
  km_per_litre: number | null;

  @ApiProperty({ example: 7.1, nullable: true, type: Number, description: 'The bus average over the whole range' })
  normal: number | null;

  @ApiProperty({ example: false, description: 'Below normal by more than the low mileage percent' })
  low: boolean;
}

export class DocumentDueDto {
  @ApiProperty({ type: BusRefDto })
  vehicle: BusRefDto;

  @ApiProperty({ example: 'insurance' })
  kind: string;

  @ApiProperty({ example: '2026-12-01' })
  expiry: string;

  @ApiProperty({ example: 13 })
  days_left: number;
}

export class DueReportDto {
  @ApiProperty({ type: [ScheduleDto], description: 'Services due soon or overdue, most urgent first' })
  services: ScheduleDto[];

  @ApiProperty({ type: [DocumentDueDto], description: 'Documents expired or expiring in 30 days' })
  documents: DocumentDueDto[];
}

export class SpendRowDto {
  @ApiProperty({ example: 'tyres' })
  key: string;

  @ApiProperty({ example: 'Tyres' })
  label: string;

  @ApiProperty({ example: 42000 })
  amount: number;

  @ApiProperty({ example: 3 })
  entries: number;
}

export class IdleRowDto {
  @ApiProperty({ type: BusRefDto })
  vehicle: BusRefDto;

  @ApiProperty({ example: 6 })
  alerts: number;

  @ApiProperty({ example: 95 })
  minutes: number;

  @ApiProperty({ example: 4 })
  litres: number;

  @ApiProperty({ example: 380, description: 'litres × the bus average price per litre' })
  amount: number;
}

export class ReimbursementRowDto {
  @ApiProperty({ enum: ['fuel', 'expense'], example: 'fuel' })
  type: 'fuel' | 'expense';

  @ApiProperty({ example: 14 })
  id: number;

  @ApiProperty({ type: BusRefDto })
  vehicle: BusRefDto;

  @ApiProperty({ example: '2026-11-18' })
  on: string;

  @ApiProperty({ example: 1200 })
  amount: number;

  @ApiProperty({ type: PersonRefDto, nullable: true, description: 'Who paid (fuel: filled_by, expense: added by)' })
  paid_by: PersonRefDto | null;

  @ApiProperty({ example: 'Fuel 12 L' })
  title: string;
}

export class FleetInsightsDto {
  @ApiProperty({ example: 52000 })
  fuel_this_month: number;

  @ApiProperty({ example: 14500, description: 'Services and repairs closed this month' })
  maintenance_this_month: number;

  @ApiProperty({ example: 41200 })
  other_this_month: number;

  @ApiProperty({ example: 107700 })
  total_this_month: number;

  @ApiProperty({ example: 1 })
  overdue_services: number;

  @ApiProperty({ example: 3 })
  due_soon_services: number;

  @ApiProperty({ example: 6.9, nullable: true, type: Number })
  avg_km_per_litre: number | null;

  @ApiProperty({ example: 0 })
  off_road_buses: number;

  @ApiProperty({ example: 2 })
  pending_fuel_approvals: number;

  @ApiProperty({ example: 0, description: 'Buses with a critical pre-trip failure not cleared today' })
  blocked_checks: number;

  @ApiProperty({ example: 1200 })
  pending_reimbursements: number;

  @ApiProperty({ example: 1, description: 'Buses over their monthly budget this month' })
  over_budget_buses: number;
}

export class ChangeQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: CHANGE_ENTITIES })
  @IsOptional()
  @IsIn(CHANGE_ENTITIES)
  entity?: ChangeEntity;

  @ApiPropertyOptional({ example: 14 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  entity_id?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  vehicle_id?: number;
}

export class ChangeDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ enum: CHANGE_ENTITIES, example: 'fuel' })
  entity: ChangeEntity;

  @ApiProperty({ example: 14 })
  entity_id: number;

  @ApiProperty({ type: BusRefDto, nullable: true })
  vehicle: BusRefDto | null;

  @ApiProperty({ example: 'update' })
  action: ChangeAction;

  @ApiProperty({ example: { amount: 5800 }, nullable: true, type: Object })
  before: Record<string, unknown> | null;

  @ApiProperty({ example: { amount: 5600 }, nullable: true, type: Object })
  after: Record<string, unknown> | null;

  @ApiProperty({ example: 'Wrong amount typed', nullable: true, type: String })
  note: string | null;

  @ApiProperty({ example: 'amount 5800 → 5600' })
  summary: string;

  @ApiProperty({ type: PersonRefDto, nullable: true })
  changed_by: PersonRefDto | null;

  @ApiProperty({ example: '2026-11-18T10:00:00.000+05:30' })
  at: Date;
}

export class DriverMaintenanceDto {
  @ApiProperty({ type: BusRefDto })
  vehicle: BusRefDto;

  @ApiProperty({ example: 46210, nullable: true, type: Number })
  current_km: number | null;

  @ApiProperty({ type: [ScheduleDto], description: 'Services of my bus, most urgent first' })
  services: ScheduleDto[];

  @ApiProperty({ type: TicketDto, nullable: true })
  last_service: TicketDto | null;

  @ApiProperty({ type: [TicketDto], description: 'Problems still open' })
  open_problems: TicketDto[];

  @ApiProperty({ type: PreTripCheckDto, nullable: true })
  today_check: PreTripCheckDto | null;

  @ApiProperty({ example: false, description: 'The school wants the pre-trip check before every first trip' })
  check_required: boolean;

  @ApiProperty({ example: false })
  off_road: boolean;
}

export class PreTripItemDto {
  @ApiProperty({ enum: PRE_TRIP_ITEMS, example: 'brakes' })
  item: PreTripItem;

  @ApiProperty({ example: 'Brakes' })
  label: string;

  @ApiProperty({ example: true, description: 'Not OK blocks trips until the office clears it' })
  critical: boolean;
}

export class PreTripFormDto {
  @ApiProperty({ type: BusRefDto })
  vehicle: BusRefDto;

  @ApiProperty({ type: [PreTripItemDto], description: 'The 10 items to tick, in order' })
  items: PreTripItemDto[];

  @ApiProperty({ example: false, description: 'Trips cannot start until today’s check is done' })
  required: boolean;

  @ApiProperty({ type: PreTripCheckDto, nullable: true, description: 'Today’s check when already done' })
  today: PreTripCheckDto | null;
}
