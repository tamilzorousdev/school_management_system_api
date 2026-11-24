import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { IsDateOnly } from '../../../shared/dates';
import { ID_CARD_DESIGNS } from '../../../shared/id-card-design';
import { RefDto } from '../../students/dto/student-response.dto';
import {
  NOC_DEPARTMENTS,
  NOC_ITEM_STATUSES,
  NOC_STATUSES,
  NocDepartment,
  NocItemStatus,
  NocStatus,
} from '../entities/student-noc.entity';
import { EXIT_TYPES, ExitType } from '../entities/transfer-certificate.entity';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

export class StartNocDto {
  @ApiProperty({ enum: EXIT_TYPES, example: 'transferred' })
  @IsIn(EXIT_TYPES)
  exit_type: ExitType;

  @IsDateOnly('2026-11-02')
  leaving_date: string;

  @ApiProperty({ example: 'Family moved to Coimbatore' })
  @Transform(trim)
  @IsString()
  @Length(3, 255)
  reason: string;
}

export class ClearNocItemDto {
  @ApiPropertyOptional({ nullable: true, type: String, example: 'All books returned' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @MaxLength(255)
  remarks?: string | null;

  @ApiPropertyOptional({
    default: false,
    description: 'Needed to clear the fees line while fees are unpaid (409 FEE_DUES_PENDING otherwise)',
  })
  @IsOptional()
  @IsBoolean()
  acknowledge_dues?: boolean;
}

export class CancelNocDto {
  @ApiProperty({ example: 'Parents decided to continue' })
  @Transform(trim)
  @IsString()
  @Length(3, 255)
  note: string;
}

export class StudentExitDto {
  @ApiPropertyOptional({ enum: EXIT_TYPES, description: 'Defaults to the cleared NOC' })
  @IsOptional()
  @IsIn(EXIT_TYPES)
  exit_type?: ExitType;

  @IsDateOnly('2026-11-02', true)
  leaving_date?: string;

  @ApiPropertyOptional({ example: 'Family moved to Coimbatore', description: 'Defaults to the cleared NOC' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(3, 255)
  reason?: string;

  @ApiPropertyOptional({ example: 'Good', default: 'Good' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 40)
  conduct?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  promotion_eligible?: boolean;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @MaxLength(255)
  remarks?: string | null;

  @ApiPropertyOptional({
    default: false,
    description:
      'Needed when the student has unpaid fees (409 FEE_DUES_PENDING otherwise). The dues stay on record; write them off with a fee request.',
  })
  @IsOptional()
  @IsBoolean()
  acknowledge_dues?: boolean;
}

export class QrVerifyDto {
  @ApiProperty({ example: 'TZS1.12.1.Xb4cR2d9kLmN0pQr5sTuVw' })
  @Transform(trim)
  @IsString()
  @Length(10, 80)
  token: string;
}

export class IdCardQueryDto {
  @ApiPropertyOptional({ example: 7, description: 'Every student in this class' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  class_id?: number;

  @ApiPropertyOptional({ example: 12, description: 'Every student in this section' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  section_id?: number;

  @ApiPropertyOptional({ example: 'design3', enum: ID_CARD_DESIGNS, description: 'Design template' })
  @IsOptional()
  @IsIn(ID_CARD_DESIGNS)
  design?: string;
}

export class SingleIdCardQueryDto {
  @ApiPropertyOptional({ example: 'design3', enum: ID_CARD_DESIGNS, description: 'Design template' })
  @IsOptional()
  @IsIn(ID_CARD_DESIGNS)
  design?: string;
}

export class PromotionPreviewQueryDto {
  @ApiProperty({ example: 7, description: 'Class being promoted, from the current year' })
  @Type(() => Number)
  @IsInt()
  class_id: number;

  @ApiPropertyOptional({ example: 21, description: 'Section being promoted' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  section_id?: number;
}

export class PromotionDto {
  @ApiProperty({ example: 7, description: 'Class in the current year' })
  @Type(() => Number)
  @IsInt()
  from_class_id: number;

  @ApiPropertyOptional({ example: 3, description: 'Section in the current year' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  from_section_id?: number;

  @ApiProperty({ example: 8, description: 'Class for next year' })
  @Type(() => Number)
  @IsInt()
  to_class_id: number;

  @ApiPropertyOptional({ example: 21, description: 'Section in next year. Leave out to allocate later.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  to_section_id?: number;

  @ApiPropertyOptional({ type: [Number], description: 'Promote only these students. Leave out for the whole class.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  student_ids?: number[];

  @ApiPropertyOptional({ type: [Number], description: 'Students who repeat the same class next year' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  detained_ids?: number[];
}

export class TransferCertificateDto {
  @ApiProperty({ example: 2 })
  id: number;

  @ApiProperty({ example: 'TC-2026-0002' })
  tc_no: string;

  @ApiProperty({ enum: EXIT_TYPES })
  exit_type: ExitType;

  @ApiProperty({ example: '2026-11-02' })
  leaving_date: string;

  @ApiProperty({ example: '2026-11-02' })
  issued_on: string;

  @ApiProperty({ example: 'Family moved to Coimbatore' })
  reason: string;

  @ApiProperty({ example: 'Good' })
  conduct: string;

  @ApiProperty({ nullable: true, type: String, example: '6' })
  class_name: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'A' })
  section_name: string | null;

  @ApiProperty({ nullable: true, type: String, example: '2026-27' })
  academic_year_name: string | null;

  @ApiProperty()
  promotion_eligible: boolean;

  @ApiProperty({ nullable: true, type: String })
  remarks: string | null;

  @ApiProperty({ example: 4500, description: 'Unpaid fees when the TC was issued' })
  fee_balance: number;
}

export class NocItemDto {
  @ApiProperty({ enum: NOC_DEPARTMENTS })
  department: NocDepartment;

  @ApiProperty({ enum: NOC_ITEM_STATUSES })
  status: NocItemStatus;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '2 library books not returned',
    description: 'What is still outstanding right now, or null when nothing is',
  })
  blocker: string | null;

  @ApiProperty({ description: 'True when the blocker stops the line from being cleared' })
  blocking: boolean;

  @ApiProperty({ example: 4500, description: 'Unpaid fees, only on the fees line' })
  amount: number;

  @ApiProperty({ description: 'Whether the signed-in user may clear or reopen this line' })
  can_clear: boolean;

  @ApiProperty({ nullable: true, type: String })
  cleared_by_name: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  cleared_at: string | null;

  @ApiProperty({ nullable: true, type: String })
  remarks: string | null;

  @ApiProperty({ nullable: true, type: String, description: 'What was outstanding when the line was cleared' })
  blocker_snapshot: string | null;
}

export class NocDto {
  @ApiProperty({ example: 4 })
  id: number;

  @ApiProperty({ example: 12 })
  student_id: number;

  @ApiProperty({ enum: NOC_STATUSES })
  status: NocStatus;

  @ApiProperty({ enum: EXIT_TYPES })
  exit_type: ExitType;

  @ApiProperty({ example: '2026-11-30' })
  leaving_date: string;

  @ApiProperty({ example: 'Family moved to Coimbatore' })
  reason: string;

  @ApiProperty({ nullable: true, type: String })
  requested_by_name: string | null;

  @ApiProperty({ format: 'date-time' })
  requested_at: string;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  cleared_at: string | null;

  @ApiProperty({ example: 3 })
  cleared_count: number;

  @ApiProperty({ type: [NocItemDto] })
  items: NocItemDto[];
}

export class DigitalIdDto {
  @ApiProperty({ example: 12 })
  student_id: number;

  @ApiProperty({ example: 'TZS1.12.1.Xb4cR2d9kLmN0pQr5sTuVw', description: 'Draw this text as a QR code' })
  qr_token: string;

  @ApiProperty({ example: 'Kavin Narayanan' })
  full_name: string;

  @ApiProperty({ example: 'TZMS-2026-0012' })
  admission_no: string;

  @ApiProperty({ nullable: true, type: String, example: '6 - A' })
  class_section: string | null;

  @ApiProperty({ nullable: true, type: Number, example: 12 })
  roll_no: number | null;

  @ApiProperty({ example: '2015-04-12' })
  dob: string;

  @ApiProperty({ nullable: true, type: String, example: 'B+' })
  blood_group: string | null;

  @ApiProperty({ nullable: true, type: String })
  photo_url: string | null;

  @ApiProperty({ nullable: true, type: String, example: '2026-27' })
  academic_year: string | null;

  @ApiProperty({ nullable: true, type: String, example: '2027-04-30', description: 'Valid until the year ends' })
  valid_till: string | null;

  @ApiProperty({ type: RefDto })
  school: RefDto;

  @ApiProperty({ nullable: true, type: String, example: '04422334455' })
  school_phone: string | null;
}

export class QrStudentDto {
  @ApiProperty({ example: 12 })
  student_id: number;

  @ApiProperty({ example: 'Kavin Narayanan' })
  full_name: string;

  @ApiProperty({ example: 'TZMS-2026-0012' })
  admission_no: string;

  @ApiProperty({ nullable: true, type: String, example: '6 - A' })
  class_section: string | null;

  @ApiProperty({ nullable: true, type: String })
  photo_url: string | null;

  @ApiProperty({ example: 'active' })
  status: string;
}

export class PromotionStudentDto {
  @ApiProperty({ example: 12 })
  student_id: number;

  @ApiProperty({ example: 'Kavin Narayanan' })
  full_name: string;

  @ApiProperty({ example: 'TZMS-2026-0012' })
  admission_no: string;

  @ApiPropertyOptional({ nullable: true, type: Number, example: 3 })
  section_id: number | null;

  @ApiProperty({ nullable: true, type: String, example: 'A' })
  section_name: string | null;

  @ApiProperty({ nullable: true, type: Number })
  roll_no: number | null;

  @ApiProperty({ description: 'Already has a class in the next year' })
  already_moved: boolean;

  @ApiPropertyOptional({ nullable: true, type: Number, example: 82.5 })
  result_percent: number | null;

  @ApiPropertyOptional({ nullable: true, type: Boolean, example: true })
  passed: boolean | null;
}

export class ResultSummaryDto {
  @ApiProperty({ example: 7 })
  id: number;

  @ApiProperty({ example: '7' })
  name: string;

  @ApiProperty({ example: 38, description: 'Students with published exam marks this year' })
  assessed: number;

  @ApiProperty({ nullable: true, type: Number, example: 89.5 })
  pass_percent: number | null;

  @ApiProperty({ nullable: true, type: Number, example: 71.2 })
  average_percent: number | null;
}

export class PromotionPreviewDto {
  @ApiProperty({ type: RefDto })
  from_year: RefDto;

  @ApiProperty({ type: RefDto })
  to_year: RefDto;

  @ApiProperty({ type: RefDto })
  from_class: RefDto;

  @ApiProperty({ type: [RefDto], description: 'Sections of the class in the current year' })
  from_sections: RefDto[];

  @ApiPropertyOptional({ nullable: true, type: Number, example: 87.5 })
  pass_percent: number | null;

  @ApiPropertyOptional({ nullable: true, type: Number, example: 74.2 })
  average_percent: number | null;

  @ApiProperty({
    type: [ResultSummaryDto],
    description: 'Pass percentage of every class (grade) this year, lowest grade first',
  })
  class_results: ResultSummaryDto[];

  @ApiProperty({ type: [ResultSummaryDto], description: 'Pass percentage of each section of the chosen class' })
  section_results: ResultSummaryDto[];

  @ApiProperty({ type: RefDto, nullable: true, description: 'Next class by grade, if it exists' })
  suggested_class: RefDto | null;

  @ApiProperty({ type: [RefDto], description: 'Sections of the suggested class in the next year' })
  to_sections: RefDto[];

  @ApiProperty({ type: [PromotionStudentDto] })
  students: PromotionStudentDto[];
}

export class PromotionResultDto {
  @ApiProperty({ example: 38 })
  promoted: number;

  @ApiProperty({ example: 1 })
  detained: number;

  @ApiProperty({ example: 2, description: 'Already had a class in the next year' })
  skipped: number;
}
