import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ListQueryDto, toBoolean } from '@app/common';
import { IsDateOnly } from '../../../shared/dates';
import { RefDto } from '../../students/dto/student-response.dto';
import {
  ALERT_KINDS,
  ALERT_SEVERITIES,
  ALERT_SOURCES,
  ALERT_STATUSES,
  AlertKind,
  AlertSeverity,
  AlertSource,
  AlertStatus,
} from '../entities/fleet-alert.entity';
import { TRIP_KINDS, TripKind } from '../entities/transport-trip.entity';
import { TripVehicleDto } from './tracking.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const NOTE_NEEDED = 'Write what was done to resolve this alert (at least 3 characters)';

export class RaiseSosDto {
  @ApiPropertyOptional({ example: 41, description: 'The trip running now; defaults to the active trip of my bus' })
  @IsOptional()
  @IsInt()
  @Min(1)
  trip_id?: number;

  @ApiPropertyOptional({ example: 13.0849, description: 'Phone location; send together with lng' })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiPropertyOptional({ example: 80.2105 })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @ApiPropertyOptional({ example: 'Child unwell, stopping near Anna Nagar', maxLength: 300 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class AlertQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: ALERT_KINDS })
  @IsOptional()
  @IsIn(ALERT_KINDS)
  kind?: AlertKind;

  @ApiPropertyOptional({ enum: ALERT_STATUSES })
  @IsOptional()
  @IsIn(ALERT_STATUSES)
  status?: AlertStatus;

  @ApiPropertyOptional({ enum: ALERT_SEVERITIES })
  @IsOptional()
  @IsIn(ALERT_SEVERITIES)
  severity?: AlertSeverity;

  @ApiPropertyOptional({ example: true, description: 'true: only alerts not resolved yet (open or acknowledged)' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ example: 1, description: 'Bus id' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  vehicle_id?: number;

  @ApiPropertyOptional({ example: 41 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  trip_id?: number;

  @IsDateOnly('2026-11-01', true)
  from?: string;

  @IsDateOnly('2026-11-30', true)
  to?: string;
}

export class ResolveAlertDto {
  @ApiProperty({ example: 'Called the driver; the parent took the child home.', minLength: 3, maxLength: 500 })
  @Transform(trim)
  @MaxLength(500)
  @MinLength(3, { message: NOTE_NEEDED })
  @IsString({ message: NOTE_NEEDED })
  resolution_note: string;
}

export class AlertPersonDto extends RefDto {
  @ApiProperty({ example: '9000000007', nullable: true, type: String })
  mobile: string | null;
}

export class AlertTripDto {
  @ApiProperty({ example: 41 })
  id: number;

  @ApiProperty({ enum: TRIP_KINDS })
  kind: TripKind;
}

export class AlertPositionDto {
  @ApiProperty({ example: 13.0849 })
  lat: number;

  @ApiProperty({ example: 80.2105 })
  lng: number;

  @ApiProperty({ example: 62, nullable: true, type: Number })
  speed_kmh: number | null;
}

export class AlertDto {
  @ApiProperty({ example: 7 })
  id: number;

  @ApiProperty({ enum: ALERT_KINDS })
  kind: AlertKind;

  @ApiProperty({ example: 'SOS' })
  kind_label: string;

  @ApiProperty({ enum: ALERT_SEVERITIES })
  severity: AlertSeverity;

  @ApiProperty({ enum: ALERT_STATUSES })
  status: AlertStatus;

  @ApiProperty({ enum: ALERT_SOURCES, description: 'driver_app (SOS) or telematics (safety rules)' })
  source: AlertSource;

  @ApiProperty({ example: 'SOS from Murugan (Driver): Child unwell' })
  message: string;

  @ApiProperty({ type: AlertTripDto, nullable: true })
  trip: AlertTripDto | null;

  @ApiProperty({ type: TripVehicleDto, nullable: true })
  vehicle: TripVehicleDto | null;

  @ApiProperty({ type: RefDto, nullable: true })
  route: RefDto | null;

  @ApiProperty({ type: AlertPersonDto, nullable: true, description: 'Driver or attendant who raised an SOS' })
  raised_by: AlertPersonDto | null;

  @ApiProperty({ type: AlertPositionDto, nullable: true })
  position: AlertPositionDto | null;

  @ApiProperty({ type: Object, example: { value: 72, limit: 50 } })
  data: Record<string, unknown>;

  @ApiProperty()
  raised_at: Date;

  @ApiProperty({ example: 3, description: 'People told' })
  notified: number;

  @ApiProperty({ type: RefDto, nullable: true })
  acknowledged_by: RefDto | null;

  @ApiProperty({ nullable: true, type: Date })
  acknowledged_at: Date | null;

  @ApiProperty({ type: RefDto, nullable: true })
  resolved_by: RefDto | null;

  @ApiProperty({ nullable: true, type: Date })
  resolved_at: Date | null;

  @ApiProperty({ nullable: true, type: String })
  resolution_note: string | null;
}

export class SosLocationDto {
  @ApiProperty({ example: 13.0849 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @ApiProperty({ example: 80.2105 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;
}

export class CancelSosDto {
  @ApiPropertyOptional({ example: 'Pressed by mistake', maxLength: 300 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class SosResultDto extends AlertDto {
  @ApiProperty({
    example: false,
    description: 'true when I already raised an SOS in the last 2 minutes; the office was not told again',
  })
  already_raised: boolean;
}

export class AlertInsightsDto {
  @ApiProperty({ example: 3, description: 'Open (not acknowledged yet)' })
  open: number;

  @ApiProperty({ example: 1, description: 'SOS not resolved yet (open or acknowledged)' })
  sos_active: number;

  @ApiProperty({
    example: 2,
    description: 'High severity safety alerts not resolved yet (SOS is counted in sos_active)',
  })
  high_active: number;

  @ApiProperty({ example: 2 })
  acknowledged: number;

  @ApiProperty({ example: 5 })
  resolved_today: number;

  @ApiProperty({ example: 9 })
  raised_today: number;

  @ApiProperty({ type: Object, example: { overspeed: 2, sos: 1 }, description: 'Unresolved alerts per kind' })
  active_by_kind: Partial<Record<AlertKind, number>>;
}
