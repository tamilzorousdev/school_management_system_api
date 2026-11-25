import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { RefDto } from '../../students/dto/student-response.dto';
import { BOARDING_ACTIONS, BOARDING_METHODS, BoardingAction, BoardingMethod } from '../entities/trip-boarding.entity';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const PICK_ONE = 'Scan the ID card (qr_token) or choose a student (student_id)';

export class RecordBoardingDto {
  @ApiProperty({
    enum: BOARDING_ACTIONS,
    example: 'boarded',
    description:
      'boarded (got on), alighted (got off) or missed (the bus came to the stop and the child was not there; the parent is told)',
  })
  @IsIn(BOARDING_ACTIONS, { message: 'action must be boarded, alighted or missed' })
  action: BoardingAction;

  @ApiPropertyOptional({
    example: 'TZS1.12.1.q2W9xP0aLk3mNc7Rt5Vb1z',
    description: 'The scanned ID card QR. Send this or student_id.',
  })
  @ValidateIf((dto: RecordBoardingDto) => dto.student_id === undefined)
  @Transform(trim)
  @MaxLength(200)
  @MinLength(1, { message: PICK_ONE })
  @IsString({ message: PICK_ONE })
  qr_token?: string;

  @ApiPropertyOptional({ example: 12, description: 'Manual tap from the trip student list. Send this or qr_token.' })
  @ValidateIf((dto: RecordBoardingDto) => dto.qr_token === undefined)
  @Min(1)
  @IsInt({ message: PICK_ONE })
  student_id?: number;

  @ApiPropertyOptional({
    example: 'Lakshmi Narayanan (Mother)',
    maxLength: 160,
    description: 'Drop (alighted) only: who the child was handed to. Parents see it in the push.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(160)
  handed_to?: string;

  @ApiPropertyOptional({
    example: '2026-11-25T07:42:10+05:30',
    description: 'When the tap happened, for taps saved offline and sent later. Up to 12 hours back; defaults to now.',
  })
  @IsOptional()
  @IsISO8601()
  occurred_at?: string;
}

export class BoardingDto {
  @ApiProperty({ example: 31 })
  id: number;

  @ApiProperty({ example: 41 })
  trip_id: number;

  @ApiProperty({ example: 12 })
  student_id: number;

  @ApiProperty({ example: 'Kavin Narayanan' })
  full_name: string;

  @ApiProperty({ nullable: true, type: String, example: '6 - A' })
  class_section: string | null;

  @ApiProperty({ enum: BOARDING_ACTIONS })
  action: BoardingAction;

  @ApiProperty({ enum: BOARDING_METHODS, description: 'qr (ID card scanned) or manual (tapped in the list)' })
  method: BoardingMethod;

  @ApiProperty({ type: RefDto, nullable: true, description: 'The stop; null at the school gate' })
  stop: RefDto | null;

  @ApiProperty({ type: RefDto, nullable: true, description: 'Driver or attendant who recorded it' })
  recorded_by: RefDto | null;

  @ApiProperty({ nullable: true, type: String, example: 'Lakshmi Narayanan (Mother)', description: 'Drop only' })
  handed_to: string | null;

  @ApiProperty({
    example: false,
    description: 'The bus pass was on hold when the child got on; the parent and the office were told',
  })
  pass_on_hold: boolean;

  @ApiProperty()
  occurred_at: Date;
}

export class BoardingResultDto extends BoardingDto {
  @ApiProperty({
    example: false,
    description: 'true when this was already recorded (double scan); nothing new is saved or sent',
  })
  already_recorded: boolean;

  @ApiProperty({ example: 2, description: 'Parents told' })
  notified: number;
}

export class ChildBoardingDto {
  @ApiProperty({ enum: BOARDING_ACTIONS })
  action: BoardingAction;

  @ApiProperty({ enum: BOARDING_METHODS })
  method: BoardingMethod;

  @ApiProperty({ type: RefDto, nullable: true })
  stop: RefDto | null;

  @ApiProperty()
  occurred_at: Date;
}
