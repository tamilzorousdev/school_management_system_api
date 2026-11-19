import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
} from 'class-validator';
import { ListQueryDto, toBoolean } from '@app/common';
import { IsDateOnly } from '../../../shared/dates';
import { FileDto } from '../../files/dto/file.dto';
import { TripDto } from '../../tracking/dto/tracking.dto';
import { PAYMENT_MODES, PaymentMode, SERVICE_CATEGORIES, ServiceCategory } from '../entities/fleet-maintenance.entity';
import { FUEL_STATUSES, FuelStatus } from '../entities/fuel-log.entity';
import {
  TICKET_KINDS,
  TICKET_SEVERITIES,
  TICKET_SOURCES,
  TICKET_STATUSES,
  TicketKind,
  TicketSeverity,
  TicketSource,
  TicketStatus,
} from '../entities/maintenance-ticket.entity';
import { DTC_PATTERN } from '../fleet-ops.logic';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const upperToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() || null : value;
const present = (_dto: object, value: unknown) => value !== undefined;

const MAX_ODOMETER = 2000000;
const MAX_COST = 1000000;

export class BusRefDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'TN01AB1234' })
  registration_no: string;

  @ApiProperty({ example: 'Bus 1' })
  name: string;
}

export class PersonRefDto {
  @ApiProperty({ example: 7 })
  id: number;

  @ApiProperty({ example: 'Ganesan Pillai' })
  name: string;
}

export class VendorRefDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ example: 'Sri Murugan Motors' })
  name: string;

  @ApiProperty({ example: '9876500011', nullable: true, type: String })
  phone: string | null;
}

export class WarrantyClaimDto {
  @ApiProperty({ example: 7, description: 'The earlier ticket whose part is still under warranty' })
  ticket_id: number;

  @ApiProperty({ example: '2027-06-10', nullable: true, type: String })
  until: string | null;

  @ApiProperty({ example: null, nullable: true, type: Number })
  until_km: number | null;
}

export class GpsCheckDto {
  @ApiProperty({
    example: 420,
    nullable: true,
    type: Number,
    description: 'km on the odometer since the last full fill',
  })
  odometer_km: number | null;

  @ApiProperty({ example: 395, nullable: true, type: Number, description: 'km the GPS tracker recorded on trips' })
  gps_km: number | null;

  @ApiProperty({ enum: ['ok', 'mismatch', 'unknown'], example: 'ok' })
  status: 'ok' | 'mismatch' | 'unknown';
}

export class TicketFieldsDto {
  @ApiPropertyOptional({ example: 'Coolant leak near the radiator hose', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiPropertyOptional({ example: 'P0217', nullable: true, type: String, description: 'OBD code like P0301' })
  @IsOptional()
  @Transform(upperToNull)
  @Matches(DTC_PATTERN, { message: 'fault_code must look like P0301 (P, C, B or U, then 4 characters 0-9 or A-F)' })
  fault_code?: string | null;

  @ApiPropertyOptional({ enum: TICKET_SEVERITIES, nullable: true })
  @IsOptional()
  @IsIn(TICKET_SEVERITIES)
  severity?: TicketSeverity | null;

  @ApiPropertyOptional({ example: 48213.7, nullable: true, type: Number })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 }, { message: 'odometer_km must be a number with at most 1 decimal' })
  @Min(0)
  @Max(MAX_ODOMETER)
  odometer_km?: number | null;

  @ApiPropertyOptional({ example: 'Sri Murugan Motors', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(100)
  vendor?: string | null;

  @ApiPropertyOptional({ example: 4500, nullable: true, type: Number, description: 'Rupees' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'cost must be a number with at most 2 decimals' })
  @Min(0)
  @Max(MAX_COST)
  cost?: number | null;

  @ApiPropertyOptional({ example: 'Hose replaced, coolant topped up', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(1000)
  notes?: string | null;

  @ApiPropertyOptional({ enum: TICKET_KINDS, description: 'service = planned work, repair = breakdown or fault' })
  @IsOptional()
  @IsIn(TICKET_KINDS)
  kind?: TicketKind;

  @ApiPropertyOptional({ enum: SERVICE_CATEGORIES, nullable: true })
  @IsOptional()
  @IsIn(SERVICE_CATEGORIES)
  category?: ServiceCategory | null;

  @ApiPropertyOptional({ example: 4, nullable: true, type: Number, description: 'The service rule this work is for' })
  @IsOptional()
  @IsInt()
  @Min(1)
  schedule_id?: number | null;

  @ApiPropertyOptional({ example: 3000, nullable: true, type: Number, description: 'Parts, rupees' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'parts_cost must be a number with at most 2 decimals' })
  @Min(0)
  @Max(MAX_COST)
  parts_cost?: number | null;

  @ApiPropertyOptional({ example: 1500, nullable: true, type: Number, description: 'Labour, rupees' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'labour_cost must be a number with at most 2 decimals' })
  @Min(0)
  @Max(MAX_COST)
  labour_cost?: number | null;

  @ApiPropertyOptional({ example: 3, nullable: true, type: Number, description: 'Saved garage' })
  @IsOptional()
  @IsInt()
  @Min(1)
  vendor_id?: number | null;

  @ApiPropertyOptional({ example: 21, nullable: true, type: Number, description: 'Bill from POST /files' })
  @IsOptional()
  @IsInt()
  @Min(1)
  bill_file_id?: number | null;

  @ApiPropertyOptional({ example: 30, nullable: true, type: Number, description: 'Photo from POST /files' })
  @IsOptional()
  @IsInt()
  @Min(1)
  photo_file_id?: number | null;

  @ApiPropertyOptional({ example: false, description: 'The bus cannot run until this ticket is closed' })
  @IsOptional()
  @IsBoolean()
  off_road?: boolean;

  @ApiPropertyOptional({
    example: 12,
    nullable: true,
    type: Number,
    description: 'Warranty of the part fitted, months',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  warranty_months?: number | null;

  @ApiPropertyOptional({ example: null, nullable: true, type: Number, description: 'Warranty of the part fitted, km' })
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(500000)
  warranty_km?: number | null;
}

export class CreateTicketDto extends TicketFieldsDto {
  @ApiProperty({ example: 1, description: 'The bus (vehicles.id)' })
  @IsInt()
  @Min(1)
  vehicle_id: number;

  @ApiProperty({ example: 'Coolant leak' })
  @Transform(trim)
  @IsString()
  @Length(3, 150)
  title: string;
}

export class UpdateTicketDto extends TicketFieldsDto {
  @ApiPropertyOptional({ example: 'Coolant leak' })
  @ValidateIf(present)
  @Transform(trim)
  @IsString()
  @Length(3, 150)
  title?: string;

  @ApiPropertyOptional({ enum: TICKET_STATUSES, description: 'done sets closed_at; moving out of done clears it' })
  @ValidateIf(present)
  @IsIn(TICKET_STATUSES)
  status?: TicketStatus;
}

export class CloseTicketDto {
  @ApiPropertyOptional({ example: 4500, nullable: true, type: Number })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'cost must be a number with at most 2 decimals' })
  @Min(0)
  @Max(MAX_COST)
  cost?: number | null;

  @ApiPropertyOptional({ example: 'Sri Murugan Motors', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(100)
  vendor?: string | null;

  @ApiPropertyOptional({ example: 48230, nullable: true, type: Number })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 }, { message: 'odometer_km must be a number with at most 1 decimal' })
  @Min(0)
  @Max(MAX_ODOMETER)
  odometer_km?: number | null;

  @ApiPropertyOptional({ example: 'Hose replaced', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(1000)
  notes?: string | null;

  @ApiPropertyOptional({ example: 3000, nullable: true, type: Number })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'parts_cost must be a number with at most 2 decimals' })
  @Min(0)
  @Max(MAX_COST)
  parts_cost?: number | null;

  @ApiPropertyOptional({ example: 1500, nullable: true, type: Number })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'labour_cost must be a number with at most 2 decimals' })
  @Min(0)
  @Max(MAX_COST)
  labour_cost?: number | null;

  @ApiPropertyOptional({ example: 3, nullable: true, type: Number })
  @IsOptional()
  @IsInt()
  @Min(1)
  vendor_id?: number | null;

  @ApiPropertyOptional({ example: 21, nullable: true, type: Number })
  @IsOptional()
  @IsInt()
  @Min(1)
  bill_file_id?: number | null;

  @ApiPropertyOptional({ example: 12, nullable: true, type: Number })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  warranty_months?: number | null;

  @ApiPropertyOptional({ example: null, nullable: true, type: Number })
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(500000)
  warranty_km?: number | null;
}

export class TicketQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: TICKET_STATUSES })
  @IsOptional()
  @IsIn(TICKET_STATUSES)
  status?: TicketStatus;

  @ApiPropertyOptional({ enum: TICKET_SOURCES })
  @IsOptional()
  @IsIn(TICKET_SOURCES)
  source?: TicketSource;

  @ApiPropertyOptional({ enum: TICKET_KINDS })
  @IsOptional()
  @IsIn(TICKET_KINDS)
  kind?: TicketKind;

  @ApiPropertyOptional({ enum: SERVICE_CATEGORIES })
  @IsOptional()
  @IsIn(SERVICE_CATEGORIES)
  category?: ServiceCategory;

  @ApiPropertyOptional({ example: true, description: 'Only tickets that keep a bus off the road' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  off_road?: boolean;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  vehicle_id?: number;
}

export class BusFilterDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  vehicle_id?: number;
}

export class TicketDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ type: BusRefDto })
  vehicle: BusRefDto;

  @ApiProperty({ enum: TICKET_SOURCES, example: 'obd' })
  source: TicketSource;

  @ApiProperty({ example: 'P0217', nullable: true, type: String })
  fault_code: string | null;

  @ApiProperty({ enum: TICKET_SEVERITIES, nullable: true, example: 'high' })
  severity: TicketSeverity | null;

  @ApiProperty({ example: 'P0217: Engine coolant over temperature' })
  title: string;

  @ApiProperty({ example: 'Engine coolant over temperature', nullable: true, type: String })
  description: string | null;

  @ApiProperty({ enum: TICKET_STATUSES, example: 'open' })
  status: TicketStatus;

  @ApiProperty({ example: '2026-11-04T08:15:00.000+05:30' })
  opened_at: Date;

  @ApiProperty({ example: null, nullable: true, type: Date })
  closed_at: Date | null;

  @ApiProperty({ example: 4500, nullable: true, type: Number })
  cost: number | null;

  @ApiProperty({ example: 'Sri Murugan Motors', nullable: true, type: String })
  vendor: string | null;

  @ApiProperty({ example: 48213.7, nullable: true, type: Number })
  odometer_km: number | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  notes: string | null;

  @ApiProperty({ enum: TICKET_KINDS, example: 'repair' })
  kind: TicketKind;

  @ApiProperty({ enum: SERVICE_CATEGORIES, nullable: true, example: 'brakes' })
  category: ServiceCategory | null;

  @ApiProperty({ example: null, nullable: true, type: Number })
  schedule_id: number | null;

  @ApiProperty({ example: 3000, nullable: true, type: Number })
  parts_cost: number | null;

  @ApiProperty({ example: 1500, nullable: true, type: Number })
  labour_cost: number | null;

  @ApiProperty({ type: VendorRefDto, nullable: true })
  garage: VendorRefDto | null;

  @ApiProperty({ type: FileDto, nullable: true })
  bill_file: FileDto | null;

  @ApiProperty({ type: FileDto, nullable: true })
  photo_file: FileDto | null;

  @ApiProperty({ example: false, description: 'The bus cannot start trips while this is open' })
  off_road: boolean;

  @ApiProperty({ example: 12, nullable: true, type: Number })
  warranty_months: number | null;

  @ApiProperty({ example: null, nullable: true, type: Number })
  warranty_km: number | null;

  @ApiProperty({
    type: WarrantyClaimDto,
    nullable: true,
    description: 'The same part was fitted earlier and is still under warranty: claim it',
  })
  warranty_claim: WarrantyClaimDto | null;

  @ApiProperty({ type: PersonRefDto, nullable: true, description: 'Driver or attendant who reported it' })
  reported_by: PersonRefDto | null;

  @ApiProperty({ example: '2026-11-04T08:15:00.000+05:30' })
  created_at: Date;

  @ApiProperty({ example: '2026-11-04T08:15:00.000+05:30' })
  updated_at: Date;
}

export class TicketInsightsDto {
  @ApiProperty({ example: 12 })
  total: number;

  @ApiProperty({ example: 3 })
  open: number;

  @ApiProperty({ example: 2 })
  in_progress: number;

  @ApiProperty({ example: 7 })
  done: number;

  @ApiProperty({ example: 1, description: 'Opened by an OBD fault and not done yet' })
  obd_open: number;

  @ApiProperty({ example: 12500, description: 'Cost of tickets closed this month, rupees' })
  cost_this_month: number;

  @ApiProperty({ example: 0, description: 'Open tickets keeping a bus off the road' })
  off_road: number;
}

export class FuelInputDto {
  @ApiProperty({ example: 1, description: 'The bus (vehicles.id)' })
  @IsInt()
  @Min(1)
  vehicle_id: number;

  @IsDateOnly('2026-11-03')
  filled_on: string;

  @ApiProperty({ example: 60.5 })
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'litres must be a number with at most 2 decimals' })
  @Min(0.1)
  @Max(1000)
  litres: number;

  @ApiProperty({ example: 5800, description: 'Rupees' })
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'amount must be a number with at most 2 decimals' })
  @Min(1)
  @Max(100000)
  amount: number;

  @ApiProperty({ example: 48213, description: 'Odometer at the fill; km/l is worked out from the previous fill' })
  @IsNumber({ maxDecimalPlaces: 1 }, { message: 'odometer_km must be a number with at most 1 decimal' })
  @Min(0)
  @Max(MAX_ODOMETER)
  odometer_km: number;

  @ApiPropertyOptional({ example: 'Indian Oil, Anna Nagar', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(100)
  station?: string | null;

  @ApiPropertyOptional({ example: 18, nullable: true, type: Number, description: 'Bill photo or PDF from POST /files' })
  @IsOptional()
  @IsInt()
  @Min(1)
  bill_file_id?: number | null;

  @ApiPropertyOptional({ example: 7, nullable: true, type: Number, description: 'Driver or attendant user id' })
  @IsOptional()
  @IsInt()
  @Min(1)
  filled_by?: number | null;

  @ApiPropertyOptional({
    example: true,
    description: 'Tank filled to full (default true). km/l is worked out between full fills',
  })
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
}

export class UpdateFuelDto {
  @ApiPropertyOptional({ example: 1 })
  @ValidateIf(present)
  @IsInt()
  @Min(1)
  vehicle_id?: number;

  @ApiPropertyOptional({ example: '2026-11-03', format: 'date' })
  @ValidateIf(present)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'filled_on must be a date in YYYY-MM-DD format' })
  filled_on?: string;

  @ApiPropertyOptional({ example: 60.5 })
  @ValidateIf(present)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'litres must be a number with at most 2 decimals' })
  @Min(0.1)
  @Max(1000)
  litres?: number;

  @ApiPropertyOptional({ example: 5800 })
  @ValidateIf(present)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'amount must be a number with at most 2 decimals' })
  @Min(1)
  @Max(100000)
  amount?: number;

  @ApiPropertyOptional({ example: 48213 })
  @ValidateIf(present)
  @IsNumber({ maxDecimalPlaces: 1 }, { message: 'odometer_km must be a number with at most 1 decimal' })
  @Min(0)
  @Max(MAX_ODOMETER)
  odometer_km?: number;

  @ApiPropertyOptional({ example: 'Indian Oil, Anna Nagar', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(100)
  station?: string | null;

  @ApiPropertyOptional({ example: 18, nullable: true, type: Number })
  @IsOptional()
  @IsInt()
  @Min(1)
  bill_file_id?: number | null;

  @ApiPropertyOptional({ example: 7, nullable: true, type: Number })
  @IsOptional()
  @IsInt()
  @Min(1)
  filled_by?: number | null;

  @ApiPropertyOptional({ example: true })
  @ValidateIf(present)
  @IsBoolean()
  is_full?: boolean;

  @ApiPropertyOptional({ enum: PAYMENT_MODES })
  @ValidateIf(present)
  @IsIn(PAYMENT_MODES)
  payment_mode?: PaymentMode;

  @ApiPropertyOptional({ example: 2, nullable: true, type: Number })
  @IsOptional()
  @IsInt()
  @Min(1)
  station_id?: number | null;

  @ApiPropertyOptional({
    example: 'Wrong amount typed',
    nullable: true,
    type: String,
    description: 'Kept in the history',
  })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(300)
  reason?: string | null;
}

export class FuelQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  vehicle_id?: number;

  @IsDateOnly('2026-11-01', true)
  from?: string;

  @IsDateOnly('2026-11-30', true)
  to?: string;

  @ApiPropertyOptional({ enum: FUEL_STATUSES, description: 'pending = added by a driver, waiting for the office' })
  @IsOptional()
  @IsIn(FUEL_STATUSES)
  status?: FuelStatus;

  @ApiPropertyOptional({ enum: PAYMENT_MODES })
  @IsOptional()
  @IsIn(PAYMENT_MODES)
  payment_mode?: PaymentMode;

  @ApiPropertyOptional({
    example: false,
    description: 'Driver-paid fills not yet paid back (false) or paid back (true)',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  reimbursed?: boolean;
}

export class FuelLogDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ type: BusRefDto })
  vehicle: BusRefDto;

  @ApiProperty({ example: '2026-11-03' })
  filled_on: string;

  @ApiProperty({ example: 60.5 })
  litres: number;

  @ApiProperty({ example: 5800 })
  amount: number;

  @ApiProperty({ example: 95.87 })
  price_per_litre: number;

  @ApiProperty({ example: 48213 })
  odometer_km: number;

  @ApiProperty({ example: 420, nullable: true, type: Number, description: 'Distance since the previous fill' })
  km_since_last: number | null;

  @ApiProperty({
    example: 6.94,
    nullable: true,
    type: Number,
    description: 'km_since_last / litres of this fill (full-tank method); null for the first fill of a bus',
  })
  km_per_litre: number | null;

  @ApiProperty({ example: 'Indian Oil, Anna Nagar', nullable: true, type: String })
  station: string | null;

  @ApiProperty({ type: FileDto, nullable: true })
  bill_file: FileDto | null;

  @ApiProperty({ type: PersonRefDto, nullable: true })
  filled_by: PersonRefDto | null;

  @ApiProperty({ example: true })
  is_full: boolean;

  @ApiProperty({ enum: FUEL_STATUSES, example: 'approved' })
  status: FuelStatus;

  @ApiProperty({ example: null, nullable: true, type: String })
  review_note: string | null;

  @ApiProperty({ type: PersonRefDto, nullable: true })
  reviewed_by: PersonRefDto | null;

  @ApiProperty({ enum: PAYMENT_MODES, example: 'cash' })
  payment_mode: PaymentMode;

  @ApiProperty({ example: null, nullable: true, type: Date })
  reimbursed_at: Date | null;

  @ApiProperty({ type: VendorRefDto, nullable: true })
  fuel_station: VendorRefDto | null;

  @ApiProperty({ example: null, nullable: true, type: String, description: 'Price far from this bus’s recent average' })
  price_warning: string | null;

  @ApiProperty({ type: GpsCheckDto, nullable: true, description: 'Full fills only: odometer km against GPS trip km' })
  gps_check: GpsCheckDto | null;

  @ApiProperty({ example: '2026-11-03T18:20:00.000+05:30' })
  created_at: Date;
}

export class FuelInsightsDto {
  @ApiProperty({ example: 4 })
  entries_this_month: number;

  @ApiProperty({ example: 240.5 })
  litres_this_month: number;

  @ApiProperty({ example: 23000 })
  amount_this_month: number;

  @ApiProperty({ example: 6.8, nullable: true, type: Number, description: 'Fills in the last 90 days' })
  avg_km_per_litre: number | null;

  @ApiProperty({ example: 2, description: 'Entries added by drivers waiting for the office' })
  pending_approvals: number;

  @ApiProperty({ example: 1200, description: 'Paid by drivers and not yet paid back' })
  driver_paid_pending: number;
}

export class ActiveFaultDto {
  @ApiProperty({ example: 'P0217' })
  code: string;

  @ApiProperty({ example: 'Engine coolant over temperature' })
  description: string;

  @ApiProperty({ enum: TICKET_SEVERITIES, example: 'high' })
  severity: TicketSeverity;

  @ApiProperty({ example: '2026-11-04T08:15:00.000+05:30', nullable: true, type: String })
  first_seen_at: string | null;
}

export class HealthReadingDto {
  @ApiProperty({ example: 1 })
  device_id: number;

  @ApiProperty({ enum: ['good', 'warning', 'critical', 'unknown'], example: 'warning' })
  status: 'good' | 'warning' | 'critical' | 'unknown';

  @ApiProperty({ example: ['Coolant 102 °C (running hot)'], type: [String] })
  reasons: string[];

  @ApiProperty({ example: '2026-11-04T08:15:00.000+05:30', nullable: true, type: String })
  reading_at: string | null;

  @ApiProperty({ example: 13.9, nullable: true, type: Number })
  battery_v: number | null;

  @ApiProperty({ example: 89.5, nullable: true, type: Number })
  coolant_c: number | null;

  @ApiProperty({ example: 1450, nullable: true, type: Number })
  rpm: number | null;

  @ApiProperty({ example: 63.4, nullable: true, type: Number })
  fuel_pct: number | null;

  @ApiProperty({ example: 48213.7, nullable: true, type: Number })
  odometer_km: number | null;

  @ApiProperty({ example: 42, nullable: true, type: Number })
  engine_load_pct: number | null;

  @ApiProperty({ type: [ActiveFaultDto] })
  faults: ActiveFaultDto[];
}

export class BusHealthDto {
  @ApiProperty({ type: BusRefDto })
  bus: BusRefDto;

  @ApiProperty({ example: true })
  has_tracker: boolean;

  @ApiProperty({ example: 1, description: 'Maintenance tickets not done yet' })
  open_tickets: number;

  @ApiProperty({ type: HealthReadingDto, nullable: true, description: 'null when the bus has no tracker' })
  health: HealthReadingDto | null;
}

export class ObdLogQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({ example: '2026-11-04T00:00:00+05:30' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}T/, { message: 'from must be an ISO date and time' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-04T23:59:59+05:30' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}T/, { message: 'to must be an ISO date and time' })
  to?: string;
}

export class ObdLogDto {
  @ApiProperty({ example: '1024' })
  id: string;

  @ApiProperty({ example: '2026-11-04T08:15:00.000+05:30' })
  recorded_at: string;

  @ApiProperty({ example: 1450, nullable: true, type: Number })
  rpm: number | null;

  @ApiProperty({ example: 34, nullable: true, type: Number })
  speed: number | null;

  @ApiProperty({ example: 89.5, nullable: true, type: Number })
  coolant_c: number | null;

  @ApiProperty({ example: 42, nullable: true, type: Number })
  engine_load_pct: number | null;

  @ApiProperty({ example: 18, nullable: true, type: Number })
  throttle_pct: number | null;

  @ApiProperty({ example: 63.4, nullable: true, type: Number })
  fuel_pct: number | null;

  @ApiProperty({ example: 13.9, nullable: true, type: Number })
  battery_v: number | null;

  @ApiProperty({ example: 48213.7, nullable: true, type: Number })
  odometer_km: number | null;

  @ApiProperty({ example: ['P0301'], type: [String] })
  dtc: string[];
}

export class PlaybackQueryDto {
  @ApiPropertyOptional({ default: 1500, minimum: 50, maximum: 5000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(50)
  @Max(5000)
  max_points: number = 1500;
}

export class LatLngDto {
  @ApiProperty({ example: 13.0846 })
  lat: number;

  @ApiProperty({ example: 80.1767 })
  lng: number;
}

export class PlaybackPointDto extends LatLngDto {
  @ApiProperty({ example: '2026-11-09T07:12:30.000+05:30' })
  at: string;

  @ApiProperty({ example: 28, nullable: true, type: Number })
  speed: number | null;

  @ApiProperty({ example: 90, nullable: true, type: Number })
  heading: number | null;
}

export class StopArrivalDto extends LatLngDto {
  @ApiProperty({ example: 12 })
  stop_id: number;

  @ApiProperty({ example: 'Mogappair East bus stand' })
  name: string;

  @ApiProperty({ example: 1 })
  sequence: number;

  @ApiProperty({ example: 'departed' })
  status: string;

  @ApiProperty({ example: '07:00', nullable: true, type: String })
  planned_time: string | null;

  @ApiProperty({ example: '2026-11-09T07:01:10.000+05:30', nullable: true, type: String })
  arrived_at: string | null;

  @ApiProperty({ example: '2026-11-09T07:01:45.000+05:30', nullable: true, type: String })
  departed_at: string | null;
}

export class PlaybackSafetyEventDto extends LatLngDto {
  @ApiProperty({ example: 31 })
  id: number;

  @ApiProperty({ enum: ['overspeed', 'harsh_braking', 'idle', 'route_deviation'], example: 'overspeed' })
  kind: string;

  @ApiProperty({ enum: TICKET_SEVERITIES, example: 'medium' })
  severity: string;

  @ApiProperty({ example: 'Overspeed: 62 km/h for 12 s (limit 50 km/h)' })
  message: string;

  @ApiProperty({ example: 62, nullable: true, type: Number })
  value: number | null;

  @ApiProperty({ example: 50, nullable: true, type: Number })
  limit: number | null;

  @ApiProperty({ example: '2026-11-09T07:12:30.000+05:30' })
  at: string;

  @ApiProperty({ example: 62, nullable: true, type: Number })
  speed_kmh: number | null;
}

export class TripPlaybackDto {
  @ApiProperty({ type: TripDto })
  trip: TripDto;

  @ApiProperty({ type: LatLngDto, nullable: true })
  school: LatLngDto | null;

  @ApiProperty({ type: [LatLngDto], description: 'Planned route in travel order, with the school' })
  path: LatLngDto[];

  @ApiProperty({ type: [PlaybackPointDto], description: 'GPS track, oldest first' })
  points: PlaybackPointDto[];

  @ApiProperty({ example: 1840 })
  total_points: number;

  @ApiProperty({ example: true, description: 'Points were thinned to max_points' })
  sampled: boolean;

  @ApiProperty({ example: 12.4 })
  distance_km: number;

  @ApiProperty({ example: 3120 })
  duration_seconds: number;

  @ApiProperty({ example: 54, nullable: true, type: Number })
  max_speed: number | null;

  @ApiProperty({ example: 23.1, nullable: true, type: Number })
  avg_speed: number | null;

  @ApiProperty({ type: [StopArrivalDto] })
  stop_arrivals: StopArrivalDto[];

  @ApiProperty({ type: [PlaybackSafetyEventDto] })
  safety_events: PlaybackSafetyEventDto[];
}
