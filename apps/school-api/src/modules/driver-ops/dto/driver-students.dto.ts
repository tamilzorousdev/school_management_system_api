import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { RefDto } from '../../students/dto/student-response.dto';
import { BUS_PASS_STATES, BusPassState } from '../../transport/bus-pass.logic';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ScanInputDto {
  @ApiPropertyOptional({
    example: 'TZS1.12.1.q2W9xP0aLk3mNc7Rt5Vb1z',
    description: 'QR scanned from the bus pass or the ID card. Send this or pass_no.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  qr_token?: string;

  @ApiPropertyOptional({ example: 'TZMS-BP-2026-0012', description: 'Pass number typed when the QR will not scan' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  pass_no?: string;

  @ApiPropertyOptional({ example: 41, description: 'The running trip, to get the action to mark' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  trip_id?: number;
}

export const SCAN_WARNINGS = [
  'PASS_ON_HOLD',
  'PASS_EXPIRED',
  'PASS_AWAITING_PAYMENT',
  'WRONG_BUS',
  'NOT_ON_THIS_TRIP',
  'AWAY_TODAY',
  'ALREADY_DONE',
] as const;
export type ScanWarning = (typeof SCAN_WARNINGS)[number];

class ScanStudentDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 'Kavin Narayanan' })
  full_name: string;

  @ApiProperty({ nullable: true, type: String, example: 'TZMS-2020-0001' })
  admission_no: string | null;

  @ApiProperty({ nullable: true, type: String, example: '6 - A' })
  class_section: string | null;

  @ApiProperty({ nullable: true, type: String })
  photo_url: string | null;
}

class ScanPassDto {
  @ApiProperty({ example: 'TZMS-BP-2026-0012' })
  pass_no: string;

  @ApiProperty({ enum: BUS_PASS_STATES, example: 'on_hold' })
  state: BusPassState;

  @ApiProperty({ example: 'Pass on hold – fee pending, contact office', description: 'Text for the banner' })
  label: string;

  @ApiProperty({ enum: ['fee', 'office'], nullable: true })
  hold_kind: 'fee' | 'office' | null;

  @ApiProperty({ nullable: true, type: String, example: 'Term 2 bus fee pending' })
  reason: string | null;

  @ApiProperty({ example: '2027-03-31' })
  valid_until: string;

  @ApiProperty({ example: 2400, description: 'Bus fee still unpaid (rupees)' })
  fee_pending: number;
}

class ScanTripDto {
  @ApiProperty({ example: 41 })
  trip_id: number;

  @ApiProperty({ enum: ['pickup', 'drop'] })
  kind: 'pickup' | 'drop';

  @ApiProperty({ example: true, description: 'The child rides this trip (route and morning/evening)' })
  rides: boolean;

  @ApiProperty()
  boarded: boolean;

  @ApiProperty()
  alighted: boolean;

  @ApiProperty({ description: 'Marked not at stop' })
  missed: boolean;

  @ApiProperty({ nullable: true, type: String, example: 'Parent: not taking the bus' })
  away_note: string | null;

  @ApiProperty({
    enum: ['boarded', 'alighted'],
    nullable: true,
    description: 'What to mark with POST …/boardings (send qr_token); null when nothing is left to mark',
  })
  suggested_action: 'boarded' | 'alighted' | null;
}

export class ScanResultDto {
  @ApiProperty({ type: ScanStudentDto })
  student: ScanStudentDto;

  @ApiProperty({ type: ScanPassDto })
  pass: ScanPassDto;

  @ApiProperty({ type: RefDto })
  route: RefDto;

  @ApiProperty({ nullable: true, type: String, example: 'Kilpauk Garden Road' })
  stop: string | null;

  @ApiProperty({ type: RefDto, nullable: true, description: 'The bus the child rides today' })
  bus: RefDto | null;

  @ApiProperty({ example: true })
  on_my_bus: boolean;

  @ApiProperty({ type: ScanTripDto, nullable: true, description: 'Only when trip_id is sent' })
  trip: ScanTripDto | null;

  @ApiProperty({
    enum: SCAN_WARNINGS,
    isArray: true,
    example: ['PASS_ON_HOLD'],
    description:
      'Show each as a banner. PASS_ON_HOLD: red, ask "Allow on bus?" (never leave the child behind); boarding then tells the parent and the office.',
  })
  warnings: ScanWarning[];
}

class MyStudentPassDto {
  @ApiProperty({ enum: ['active', 'on_hold'] })
  state: 'active' | 'on_hold';

  @ApiProperty({ nullable: true, type: String, example: 'Pass on hold – fee pending, contact office' })
  label: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'Term 2 bus fee pending' })
  reason: string | null;
}

class PickupPersonTodayDto {
  @ApiProperty({ example: 'Murugan' })
  name: string;

  @ApiProperty({ example: 'Uncle' })
  relation: string;

  @ApiProperty({ example: '9876543210' })
  mobile: string;
}

class EarlyLeaveDto {
  @ApiProperty({ example: 'Murugan' })
  person: string;

  @ApiProperty({ nullable: true, type: String, example: 'Uncle' })
  relation: string | null;

  @ApiProperty({ description: 'When the gate released the child' })
  released_at: Date;

  @ApiProperty({ example: 'Fever, parent collected' })
  reason: string;
}

class StudentLeaveDto {
  @ApiProperty({ example: '2026-11-25' })
  from_date: string;

  @ApiProperty({ example: '2026-11-27' })
  to_date: string;

  @ApiProperty({ enum: ['morning', 'afternoon'], nullable: true, description: 'Half-day leave; null for full days' })
  half_day: 'morning' | 'afternoon' | null;

  @ApiProperty({ example: 'Family function' })
  reason: string;
}

class MyStudentTodayDto {
  @ApiProperty({ enum: ['coming', 'away', 'not_riding'] })
  pickup: 'coming' | 'away' | 'not_riding';

  @ApiProperty({ nullable: true, type: String, example: 'On leave' })
  pickup_note: string | null;

  @ApiProperty({ enum: ['coming', 'away', 'not_riding'] })
  drop: 'coming' | 'away' | 'not_riding';

  @ApiProperty({ nullable: true, type: String, example: 'Parent: not taking the bus' })
  drop_note: string | null;

  @ApiProperty({ type: PickupPersonTodayDto, nullable: true, description: 'One-time pickup person for today' })
  pickup_person: PickupPersonTodayDto | null;

  @ApiProperty({
    type: EarlyLeaveDto,
    nullable: true,
    description: 'Went home early today on a gate pass: not on the evening bus',
  })
  early_leave: EarlyLeaveDto | null;
}

class MyStudentParentDto {
  @ApiProperty({ example: 'Lakshmi Narayanan' })
  name: string;

  @ApiProperty({ example: 'mother' })
  relation: string;

  @ApiProperty({ nullable: true, type: String, example: '9000000005' })
  mobile: string | null;

  @ApiProperty({ description: 'May collect the child at drop' })
  can_pickup: boolean;

  @ApiProperty()
  is_primary: boolean;
}

export class MyStudentDto {
  @ApiProperty({ example: 12 })
  student_id: number;

  @ApiProperty({ example: 'Kavin Narayanan' })
  full_name: string;

  @ApiProperty({ example: 'TZMS-2020-0001' })
  admission_no: string;

  @ApiProperty({ nullable: true, type: String, example: '6 - A' })
  class_section: string | null;

  @ApiProperty({ nullable: true, type: Number, example: 4 })
  roll_no: number | null;

  @ApiProperty({ nullable: true, type: String })
  photo_url: string | null;

  @ApiProperty({ enum: ['both', 'pickup', 'drop'], description: 'Rides morning, evening or both' })
  mode: 'both' | 'pickup' | 'drop';

  @ApiProperty({ nullable: true, type: String, description: 'Evening stop when it differs from the morning stop' })
  drop_stop: string | null;

  @ApiProperty({ type: MyStudentPassDto })
  pass: MyStudentPassDto;

  @ApiProperty({ type: MyStudentTodayDto })
  today: MyStudentTodayDto;

  @ApiProperty({ nullable: true, type: String, example: 'Peanut allergy; inhaler in bag' })
  medical_note: string | null;

  @ApiProperty({
    type: [StudentLeaveDto],
    description: 'Approved leave from today up to 14 days ahead (one or many days)',
  })
  leaves: StudentLeaveDto[];

  @ApiProperty({ type: [MyStudentParentDto] })
  parents: MyStudentParentDto[];
}

class MyStopDto {
  @ApiProperty({ example: 5 })
  id: number;

  @ApiProperty({ example: 'Kilpauk Garden Road' })
  name: string;

  @ApiProperty({ example: 1 })
  sequence: number;

  @ApiProperty({ nullable: true, type: String, example: '07:10' })
  pickup_time: string | null;

  @ApiProperty({ nullable: true, type: String, example: '16:20' })
  drop_time: string | null;
}

class MyStopGroupDto {
  @ApiProperty({ type: MyStopDto })
  stop: MyStopDto;

  @ApiProperty({ type: RefDto })
  route: RefDto;

  @ApiProperty({ type: [MyStudentDto] })
  students: MyStudentDto[];
}

class MyStudentsSummaryDto {
  @ApiProperty({ example: 18 })
  total: number;

  @ApiProperty({ example: 15 })
  coming_pickup: number;

  @ApiProperty({ example: 16 })
  coming_drop: number;

  @ApiProperty({ example: 3, description: 'Away for the morning or the evening (leave, absent, OD, no-bus day)' })
  away: number;

  @ApiProperty({ example: 1, description: 'Parent said not taking the bus today' })
  no_bus: number;

  @ApiProperty({ example: 2 })
  on_hold: number;

  @ApiProperty({ example: 1, description: 'Has a one-time pickup person today' })
  pickup_persons: number;

  @ApiProperty({ example: 1, description: 'On leave today (full or half day)' })
  on_leave: number;

  @ApiProperty({ example: 1, description: 'Went home early today on a gate pass' })
  early_leave: number;
}

export class MyStudentsDto {
  @ApiProperty({ example: '2026-11-25' })
  date: string;

  @ApiProperty({ type: RefDto })
  vehicle: RefDto;

  @ApiProperty({ type: MyStudentsSummaryDto })
  summary: MyStudentsSummaryDto;

  @ApiProperty({ type: [MyStopGroupDto], description: 'Stops in route order, each with its students' })
  stops: MyStopGroupDto[];
}
