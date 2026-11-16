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
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ListQueryDto } from '@app/common';
import { IsDateOnly } from '../../../shared/dates';
import { RefDto } from '../../students/dto/student-response.dto';
import { EXPIRY_KINDS, ExpiryKind } from '../entities/expiry-alert.entity';
import { TRANSPORT_MODES, TransportMode } from '../entities/student-transport.entity';
import {
  FUEL_TYPES,
  FuelType,
  OWNERSHIPS,
  Ownership,
  VEHICLE_STATUSES,
  VEHICLE_TYPES,
  VehicleStatus,
  VehicleType,
} from '../entities/vehicle.entity';
import { VERIFICATION_STATUSES, VerificationStatus } from '../../../shared/verification';
import { FileDto } from '../../files/dto/file.dto';
import { VEHICLE_DOCUMENT_TYPES, VehicleDocumentType } from '../entities/vehicle-document.entity';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const REGISTRATION = /^[A-Z]{2}[ -]?\d{1,2}[ -]?[A-Z]{0,3}[ -]?\d{1,4}$/;
const notNull = (_dto: object, value: unknown) => value !== null;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const upperToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase().replace(/\s+/g, '') || null : value;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase().replace(/\s+/g, ' ') : value;

export class VehicleInputDto {
  @ApiProperty({ example: 'TN 09 AB 1234' })
  @Transform(upper)
  @IsString()
  @Matches(REGISTRATION, { message: 'registration_no must look like TN 09 AB 1234' })
  registration_no: string;

  @ApiProperty({ example: 'Bus 1' })
  @Transform(trim)
  @IsString()
  @Length(1, 40)
  name: string;

  @ApiPropertyOptional({ example: 'Tata Starbus 40', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(60)
  make_model?: string | null;

  @ApiPropertyOptional({
    example: 40,
    default: 40,
    description: 'Seats for students; cannot go below the students already on its routes',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  capacity?: number;

  @ApiPropertyOptional({ enum: VEHICLE_TYPES, default: 'bus' })
  @IsOptional()
  @IsIn(VEHICLE_TYPES)
  vehicle_type?: VehicleType;

  @ApiPropertyOptional({ enum: FUEL_TYPES, nullable: true })
  @IsOptional()
  @ValidateIf(notNull)
  @IsIn(FUEL_TYPES)
  fuel_type?: FuelType | null;

  @ApiPropertyOptional({ example: 2019, nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1980)
  @Max(2100)
  manufacture_year?: number | null;

  @ApiPropertyOptional({ example: 'MAT448123K1A12345', nullable: true, type: String })
  @IsOptional()
  @Transform(upperToNull)
  @ValidateIf(notNull)
  @IsString()
  @Length(5, 30)
  chassis_no?: string | null;

  @ApiPropertyOptional({ example: '497TC81ABC123456', nullable: true, type: String })
  @IsOptional()
  @Transform(upperToNull)
  @ValidateIf(notNull)
  @IsString()
  @Length(5, 30)
  engine_no?: string | null;

  @ApiPropertyOptional({ enum: OWNERSHIPS, default: 'school', description: 'contractor = hired bus' })
  @IsOptional()
  @IsIn(OWNERSHIPS)
  ownership?: Ownership;

  @ApiPropertyOptional({ example: 'Sri Murugan Travels', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(80)
  contractor_name?: string | null;

  @ApiPropertyOptional({ example: '9840012345', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @Matches(/^[6-9]\d{9}$/, { message: 'contractor_mobile must be a 10-digit mobile number' })
  contractor_mobile?: string | null;

  @ApiPropertyOptional({
    example: 2,
    nullable: true,
    type: Number,
    description: 'Tracker id from GET /admin/transport/devices',
  })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  device_id?: number | null;

  @ApiPropertyOptional({ example: 31, nullable: true, type: Number, description: 'Staff user with the Driver role' })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  driver_user_id?: number | null;

  @ApiPropertyOptional({ example: 32, nullable: true, type: Number, description: 'Staff user with the Attendant role' })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  attendant_user_id?: number | null;

  @IsDateOnly('2027-03-31', true)
  insurance_expiry?: string | null;

  @IsDateOnly('2027-06-30', true)
  fitness_expiry?: string | null;

  @IsDateOnly('2026-12-15', true)
  puc_expiry?: string | null;

  @IsDateOnly('2027-09-30', true)
  permit_expiry?: string | null;

  @IsDateOnly('2034-05-31', true)
  rc_expiry?: string | null;

  @IsDateOnly('2027-03-31', true)
  road_tax_expiry?: string | null;

  @IsDateOnly('2027-01-31', true)
  speed_governor_expiry?: string | null;

  @IsDateOnly('2027-02-28', true)
  fire_extinguisher_expiry?: string | null;

  @IsDateOnly('2026-12-31', true)
  first_aid_expiry?: string | null;

  @ApiPropertyOptional({ enum: VEHICLE_STATUSES, default: 'active' })
  @IsOptional()
  @IsIn(VEHICLE_STATUSES)
  status?: VehicleStatus;
}

export class UpdateVehicleDto extends PartialType(VehicleInputDto) {}

export const VEHICLE_FLAGS = ['not_road_worthy', 'expired', 'due_soon', 'nearly_full', 'contractor'] as const;
export type VehicleFlag = (typeof VEHICLE_FLAGS)[number];

export class VehicleQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: VEHICLE_STATUSES })
  @IsOptional()
  @IsIn(VEHICLE_STATUSES)
  status?: VehicleStatus;

  @ApiPropertyOptional({ enum: VEHICLE_TYPES })
  @IsOptional()
  @IsIn(VEHICLE_TYPES)
  vehicle_type?: VehicleType;

  @ApiPropertyOptional({
    enum: VEHICLE_FLAGS,
    description:
      'not_road_worthy: insurance, fitness or permit expired. expired / due_soon: any document. nearly_full: 90% of seats or more. contractor: hired buses.',
  })
  @IsOptional()
  @IsIn(VEHICLE_FLAGS)
  flag?: VehicleFlag;
}

export class AllowTodayDto {
  @ApiProperty({ example: 'Insurance renewed today, copy comes tomorrow', description: 'Why it may run today' })
  @Transform(trim)
  @IsString()
  @Length(5, 255)
  reason: string;
}

export class AllowedTodayDto {
  @ApiProperty({ example: '2026-11-16' })
  on_date: string;

  @ApiProperty({ example: 'Insurance renewed today, copy comes tomorrow' })
  reason: string;

  @ApiProperty({ type: RefDto, nullable: true })
  by: RefDto | null;

  @ApiProperty()
  at: Date;
}

export class VehicleDocumentInputDto {
  @ApiProperty({ enum: VEHICLE_DOCUMENT_TYPES, example: 'insurance' })
  @IsIn(VEHICLE_DOCUMENT_TYPES)
  type: VehicleDocumentType;

  @ApiProperty({ example: 140, description: 'From POST /files (purpose vehicle_document)' })
  @IsInt()
  file_id: number;

  @ApiPropertyOptional({ example: 'Insurance 2026-27', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(120)
  title?: string | null;

  @ApiPropertyOptional({
    example: 'POL123456789',
    nullable: true,
    type: String,
    description: 'Policy, permit or certificate number',
  })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(40)
  number?: string | null;

  @IsDateOnly('2027-11-15', true)
  expiry_date?: string | null;
}

export class VehicleDocumentDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ enum: VEHICLE_DOCUMENT_TYPES })
  type: VehicleDocumentType;

  @ApiProperty({ example: 'Insurance' })
  title: string;

  @ApiProperty({ nullable: true, type: String })
  number: string | null;

  @ApiProperty({ nullable: true, type: String, example: '2027-11-15' })
  expiry_date: string | null;

  @ApiProperty({ enum: VERIFICATION_STATUSES })
  status: VerificationStatus;

  @ApiProperty({ nullable: true, type: String })
  remarks: string | null;

  @ApiProperty({ type: RefDto, nullable: true })
  verified_by: RefDto | null;

  @ApiProperty({ nullable: true, type: Date })
  verified_at: Date | null;

  @ApiProperty({ type: FileDto, nullable: true })
  file: FileDto | null;

  @ApiProperty({ description: 'The newest copy of this type; older copies are history' })
  current: boolean;

  @ApiProperty()
  created_at: Date;
}

export class VehicleInsightsDto {
  @ApiProperty({ example: 6 })
  total: number;

  @ApiProperty({ example: 1, description: 'Insurance, fitness or permit expired' })
  not_road_worthy: number;

  @ApiProperty({ example: 2, description: 'Any document expired' })
  expired: number;

  @ApiProperty({ example: 3, description: 'Any document ends within 30 days' })
  due_soon: number;

  @ApiProperty({ example: 1, description: '90% of seats or more taken' })
  nearly_full: number;

  @ApiProperty({ example: 2 })
  contractor: number;
}

export class LicenceInputDto {
  @ApiProperty({ example: 'TN0920190012345', nullable: true, type: String })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase().replace(/\s+/g, '') || null : value,
  )
  @ValidateIf(notNull)
  @IsString()
  @Length(6, 20)
  licence_no: string | null;

  @IsDateOnly('2030-05-31', true)
  licence_expiry?: string | null;
}

export class RouteInputDto {
  @ApiProperty({ example: 'R1' })
  @Transform(upper)
  @IsString()
  @Length(1, 20)
  code: string;

  @ApiProperty({ example: 'Anna Nagar - School' })
  @Transform(trim)
  @IsString()
  @Length(2, 60)
  name: string;

  @ApiPropertyOptional({ example: 1, nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  vehicle_id?: number | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateRouteDto extends PartialType(RouteInputDto) {}

export class StopInputDto {
  @ApiPropertyOptional({ example: 12, description: 'Send the id to keep an existing stop and its students' })
  @IsOptional()
  @IsInt()
  id?: number;

  @ApiProperty({ example: 'Anna Nagar Tower' })
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  name: string;

  @ApiPropertyOptional({ example: 'Opposite the park gate', nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(120)
  landmark?: string | null;

  @ApiProperty({ example: 13.085 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @ApiProperty({ example: 80.2101 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;

  @ApiPropertyOptional({ example: '07:25', nullable: true, type: String })
  @IsOptional()
  @ValidateIf(notNull)
  @Matches(TIME, { message: 'pickup_time must be HH:MM' })
  pickup_time?: string | null;

  @ApiPropertyOptional({ example: '16:10', nullable: true, type: String })
  @IsOptional()
  @ValidateIf(notNull)
  @Matches(TIME, { message: 'drop_time must be HH:MM' })
  drop_time?: string | null;

  @ApiPropertyOptional({ example: 100, default: 100, description: 'Metres; the bus counts as at the stop inside it' })
  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(1000)
  geofence_radius_m?: number;

  @ApiPropertyOptional({ example: 1200, default: 0, description: 'Transport fee a month for students at this stop' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  monthly_fee?: number;
}

export class StopsInputDto {
  @ApiProperty({ type: [StopInputDto], description: 'Every stop in travel order; missing ids are removed' })
  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => StopInputDto)
  items: StopInputDto[];
}

export class AssignTransportDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  route_id: number;

  @ApiProperty({ example: 4 })
  @IsInt()
  stop_id: number;

  @ApiPropertyOptional({ enum: TRANSPORT_MODES, default: 'both' })
  @IsOptional()
  @IsIn(TRANSPORT_MODES)
  mode?: TransportMode;

  @IsDateOnly('2026-11-09', true)
  start_date?: string;
}

export class AssignStopStudentsDto {
  @ApiProperty({ example: [12, 14, 15] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  student_ids: number[];

  @ApiPropertyOptional({ enum: TRANSPORT_MODES, default: 'both' })
  @IsOptional()
  @IsIn(TRANSPORT_MODES)
  mode?: TransportMode;
}

export class StudentTransportQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  route_id?: number;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  stop_id?: number;
}

export class ExpiryQueryDto {
  @ApiPropertyOptional({ example: 30, default: 30, description: 'Look this many days ahead' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  days?: number;
}

export class PersonContactDto {
  @ApiProperty({ example: 31 })
  id: number;

  @ApiProperty({ example: 'Murugan K' })
  name: string;

  @ApiProperty({ example: '9000000007' })
  mobile: string;
}

export class DeviceRefDto {
  @ApiProperty({ example: 2 })
  id: number;

  @ApiProperty({ example: '356938035643809', nullable: true, type: String })
  imei: string | null;
}

export class ExpiryStateDto {
  @ApiProperty({ enum: EXPIRY_KINDS })
  kind: ExpiryKind;

  @ApiProperty({ example: 'Insurance' })
  label: string;

  @ApiProperty({ nullable: true, type: String, example: '2027-03-31' })
  date: string | null;

  @ApiProperty({ nullable: true, type: Number, example: 148 })
  days_left: number | null;

  @ApiProperty({ enum: ['ok', 'due_soon', 'expired', 'missing'] })
  state: 'ok' | 'due_soon' | 'expired' | 'missing';
}

export class VehicleDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'TN 09 AB 1234' })
  registration_no: string;

  @ApiProperty({ example: 'Bus 1' })
  name: string;

  @ApiProperty({ nullable: true, type: String })
  make_model: string | null;

  @ApiProperty({ example: 40 })
  capacity: number;

  @ApiProperty({ type: DeviceRefDto, nullable: true })
  device: DeviceRefDto | null;

  @ApiProperty({ type: PersonContactDto, nullable: true })
  driver: PersonContactDto | null;

  @ApiProperty({ type: PersonContactDto, nullable: true })
  attendant: PersonContactDto | null;

  @ApiProperty({ nullable: true, type: String })
  insurance_expiry: string | null;

  @ApiProperty({ nullable: true, type: String })
  fitness_expiry: string | null;

  @ApiProperty({ nullable: true, type: String })
  puc_expiry: string | null;

  @ApiProperty({ nullable: true, type: String })
  permit_expiry: string | null;

  @ApiProperty({ nullable: true, type: String })
  rc_expiry: string | null;

  @ApiProperty({ nullable: true, type: String })
  road_tax_expiry: string | null;

  @ApiProperty({ nullable: true, type: String })
  speed_governor_expiry: string | null;

  @ApiProperty({ nullable: true, type: String })
  fire_extinguisher_expiry: string | null;

  @ApiProperty({ nullable: true, type: String })
  first_aid_expiry: string | null;

  @ApiProperty({ type: [ExpiryStateDto], description: 'Every bus document with days left' })
  expiries: ExpiryStateDto[];

  @ApiProperty({ enum: VEHICLE_TYPES })
  vehicle_type: VehicleType;

  @ApiProperty({ enum: FUEL_TYPES, nullable: true })
  fuel_type: FuelType | null;

  @ApiProperty({ nullable: true, type: Number })
  manufacture_year: number | null;

  @ApiProperty({ nullable: true, type: String })
  chassis_no: string | null;

  @ApiProperty({ nullable: true, type: String })
  engine_no: string | null;

  @ApiProperty({ enum: OWNERSHIPS })
  ownership: Ownership;

  @ApiProperty({ nullable: true, type: String })
  contractor_name: string | null;

  @ApiProperty({ nullable: true, type: String })
  contractor_mobile: string | null;

  @ApiProperty({ description: 'false when insurance, fitness or permit has expired; trips cannot start' })
  road_worthy: boolean;

  @ApiProperty({ type: [String], example: ['Fitness certificate'], description: 'Expired documents that stop trips' })
  road_blockers: string[];

  @ApiProperty({ type: AllowedTodayDto, nullable: true, description: 'Allowed to run today despite expired documents' })
  allowed_today: AllowedTodayDto | null;

  @ApiProperty({ example: 95 })
  occupancy_percent: number;

  @ApiProperty({ description: '90% of seats or more taken' })
  nearly_full: boolean;

  @ApiProperty({ description: 'More students than seats' })
  over_capacity: boolean;

  @ApiProperty({ type: [RefDto], description: 'Routes this bus runs' })
  routes: RefDto[];

  @ApiProperty({ example: 38, description: 'Students on this bus’s routes' })
  students: number;

  @ApiProperty({ enum: VEHICLE_STATUSES })
  status: VehicleStatus;
}

export class DeviceOptionDto {
  @ApiProperty({ example: 2 })
  id: number;

  @ApiProperty({ example: '356938035643809' })
  imei: string;

  @ApiProperty({ example: 'Bus tracker 2' })
  name: string;

  @ApiProperty({ nullable: true, type: String })
  vehicle_no: string | null;

  @ApiProperty({ nullable: true, type: Date })
  last_seen_at: Date | null;

  @ApiProperty({ type: RefDto, nullable: true, description: 'School bus already using this tracker' })
  linked_vehicle: RefDto | null;
}

export class DriverDto {
  @ApiProperty({ example: 31 })
  user_id: number;

  @ApiProperty({ example: 'Murugan K' })
  name: string;

  @ApiProperty({ example: '9000000007' })
  mobile: string;

  @ApiProperty({ enum: ['driver', 'attendant'] })
  role: 'driver' | 'attendant';

  @ApiProperty({ nullable: true, type: String })
  licence_no: string | null;

  @ApiProperty({ nullable: true, type: String })
  licence_expiry: string | null;

  @ApiProperty({ type: ExpiryStateDto, nullable: true, description: 'Drivers only' })
  licence: ExpiryStateDto | null;

  @ApiProperty({ type: RefDto, nullable: true, description: 'Bus they are assigned to' })
  vehicle: RefDto | null;

  @ApiProperty({
    enum: ['pending', 'approved', 'blocked'],
    description: 'Only approved crew can be put on a bus or start a trip',
  })
  duty_status: 'pending' | 'approved' | 'blocked';
}

export class StopDto {
  @ApiProperty({ example: 4 })
  id: number;

  @ApiProperty({ example: 'Anna Nagar Tower' })
  name: string;

  @ApiProperty({ nullable: true, type: String })
  landmark: string | null;

  @ApiProperty({ example: 13.085 })
  lat: number;

  @ApiProperty({ example: 80.2101 })
  lng: number;

  @ApiProperty({ example: 1 })
  sequence: number;

  @ApiProperty({ nullable: true, type: String, example: '07:25' })
  pickup_time: string | null;

  @ApiProperty({ nullable: true, type: String, example: '16:10' })
  drop_time: string | null;

  @ApiProperty({ example: 100 })
  geofence_radius_m: number;

  @ApiProperty({ example: 1200 })
  monthly_fee: number;

  @ApiProperty({ example: 6 })
  students: number;
}

export class RouteVehicleDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'TN 09 AB 1234' })
  registration_no: string;

  @ApiProperty({ example: 'Bus 1' })
  name: string;

  @ApiProperty({ example: 40 })
  capacity: number;
}

export class RouteDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'R1' })
  code: string;

  @ApiProperty({ example: 'Anna Nagar - School' })
  name: string;

  @ApiProperty({ type: RouteVehicleDto, nullable: true })
  vehicle: RouteVehicleDto | null;

  @ApiProperty()
  is_active: boolean;

  @ApiProperty({ example: 8 })
  stops: number;

  @ApiProperty({ example: 34 })
  students: number;

  @ApiProperty({ nullable: true, type: String, example: '07:05', description: 'First pickup time' })
  first_pickup: string | null;
}

export class LatLngDto {
  @ApiProperty({ example: 13.0827 })
  lat: number;

  @ApiProperty({ example: 80.2707 })
  lng: number;
}

export class RouteDetailDto extends RouteDto {
  @ApiProperty({ type: [StopDto], description: 'Stops in travel order' })
  stop_list: StopDto[];

  @ApiProperty({ type: LatLngDto, nullable: true, description: 'School gate, where pickup routes end' })
  school_location: LatLngDto | null;

  @ApiProperty({ example: 14.6, description: 'Straight-line length through every stop to school, km' })
  distance_km: number;
}

export class TransportStudentRefDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 'Kavin Narayanan' })
  full_name: string;

  @ApiProperty({ example: 'TZMS-2026-0012' })
  admission_no: string;

  @ApiProperty({ nullable: true, type: String, example: '6 - A' })
  class_section: string | null;
}

export class TransportStopRefDto {
  @ApiProperty({ example: 4 })
  id: number;

  @ApiProperty({ example: 'Anna Nagar Tower' })
  name: string;

  @ApiProperty({ nullable: true, type: String })
  pickup_time: string | null;

  @ApiProperty({ nullable: true, type: String })
  drop_time: string | null;
}

export class StudentTransportDto {
  @ApiProperty({ example: 21 })
  id: number;

  @ApiProperty({ type: TransportStudentRefDto })
  student: TransportStudentRefDto;

  @ApiProperty({ type: RefDto })
  route: RefDto;

  @ApiProperty({ type: TransportStopRefDto })
  stop: TransportStopRefDto;

  @ApiProperty({ enum: TRANSPORT_MODES })
  mode: TransportMode;

  @ApiProperty({ example: '2026-11-09' })
  start_date: string;

  @ApiProperty({ example: 'P7f3a9c2e1b4d', description: 'Opaque id the bus system uses; never a student id' })
  passenger_ref: string;

  @ApiProperty({ example: 1200 })
  monthly_fee: number;
}

export class AssignResultDto {
  @ApiProperty({ example: 3 })
  assigned: number;

  @ApiProperty({ example: 1, description: 'Students moved from another stop' })
  moved: number;

  @ApiProperty({ type: RouteDetailDto })
  route: RouteDetailDto;
}

export class ExpiryDto {
  @ApiProperty({ enum: EXPIRY_KINDS })
  kind: ExpiryKind;

  @ApiProperty({ example: 'PUC certificate' })
  label: string;

  @ApiProperty({ example: 'TN 09 AB 1234', description: 'Bus registration, or the crew member name' })
  subject: string;

  @ApiProperty({ example: 1, description: 'Bus id, or the crew member user id' })
  ref_id: number;

  @ApiProperty({ nullable: true, type: Number, description: 'Set for bus documents' })
  vehicle_id: number | null;

  @ApiProperty({ nullable: true, type: Number, description: 'Set for crew documents (opens /crew/{staff_id})' })
  staff_id: number | null;

  @ApiProperty({ example: '2026-11-20' })
  date: string;

  @ApiProperty({ example: 17 })
  days_left: number;
}

export class ExpiryRunDto {
  @ApiProperty({ example: 2 })
  alerts_sent: number;

  @ApiProperty({ type: [ExpiryDto] })
  upcoming: ExpiryDto[];
}

export class ParentTransportDto {
  @ApiProperty({ type: RefDto })
  route: RefDto;

  @ApiProperty({ type: StopDto })
  stop: StopDto;

  @ApiProperty({ enum: TRANSPORT_MODES })
  mode: TransportMode;

  @ApiProperty({ type: RouteVehicleDto, nullable: true })
  vehicle: RouteVehicleDto | null;

  @ApiProperty({ type: PersonContactDto, nullable: true })
  driver: PersonContactDto | null;

  @ApiProperty({ type: PersonContactDto, nullable: true })
  attendant: PersonContactDto | null;

  @ApiProperty({ example: 1200 })
  monthly_fee: number;
}

export class DriverStopStudentDto extends TransportStudentRefDto {
  @ApiProperty({ example: 'P7f3a9c2e1b4d' })
  passenger_ref: string;

  @ApiProperty({ enum: TRANSPORT_MODES })
  mode: TransportMode;
}

export class DriverStopDto extends StopDto {
  @ApiProperty({ type: [DriverStopStudentDto] })
  student_list: DriverStopStudentDto[];
}

export class DriverRouteDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'R1' })
  code: string;

  @ApiProperty({ example: 'Anna Nagar - School' })
  name: string;

  @ApiProperty({ type: [DriverStopDto] })
  stops: DriverStopDto[];
}

export class DriverDutyDto {
  @ApiProperty({ type: RouteVehicleDto, nullable: true })
  vehicle: RouteVehicleDto | null;

  @ApiProperty({ type: [DriverRouteDto] })
  routes: DriverRouteDto[];
}
