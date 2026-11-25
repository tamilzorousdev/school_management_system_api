import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
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
import { ListQueryDto, toBoolean } from '@app/common';
import { IsDateOnly } from '../../../shared/dates';
import {
  CASE_STATUSES,
  CaseStatus,
  CHARGE_KINDS,
  ChargeKind,
  COMPLAINT_CATEGORIES,
  COMPLAINT_STATES,
  ComplaintCategory,
  DISCIPLINE_ACTIONS,
  DISCIPLINE_CATEGORIES,
  DisciplineAction,
  DisciplineCategory,
  MAINTENANCE_CATEGORIES,
  MaintenanceCategory,
  REFUND_MODES,
  RefundMode,
  SEVERITIES,
  Severity,
  TICKET_STATES,
} from '../entities/hostel-conduct.entity';
import { ComplaintState, TICKET_PRIORITIES, TicketPriority, TicketState } from '../hostel.logic';
import { HostelStudentDto } from './hostel-admission.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const notNull = (_object: unknown, value: unknown) => value !== null && value !== undefined;

export class ScheduleItemDto {
  @ApiProperty({ example: 3 }) id: number;
  @ApiProperty({ example: 'Term 1' }) label: string;
  @ApiProperty({ example: '2026-06-10' }) due_date: string;
  @ApiProperty({ example: 40 }) share_percent: number;
  @ApiProperty({ example: 120, description: 'Residents already billed for this instalment' }) invoiced: number;
}

export class ScheduleDto {
  @ApiProperty({ example: 4 }) academic_year_id: number;
  @ApiProperty({ example: '2026-27' }) year_name: string;
  @ApiProperty({ type: [ScheduleItemDto] }) items: ScheduleItemDto[];
  @ApiProperty({ example: false, description: 'Some instalments are billed; only labels can change now' })
  locked: boolean;
}

export class ScheduleItemInputDto {
  @ApiProperty({ example: 'Term 1' }) @Transform(trim) @IsString() @Length(1, 40) label: string;
  @IsDateOnly('2026-06-10') due_date: string;
  @ApiProperty({ example: 40, description: 'Percent of the room type annual fee' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100)
  share_percent: number;
}

export class ScheduleInputDto {
  @ApiProperty({
    type: [ScheduleItemInputDto],
    description: 'Whole schedule for the current year; shares add up to 100',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => ScheduleItemInputDto)
  items: ScheduleItemInputDto[];
}

export class BillDto {
  @ApiPropertyOptional({ description: 'Only these residents; default every resident with a bed' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsInt({ each: true })
  admission_ids?: number[];
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
}

export class BillSkipDto {
  @ApiProperty({ example: 21 }) admission_id: number;
  @ApiProperty({ example: 'Arun Kumar' }) student_name: string;
  @ApiProperty({ example: 'No bed yet' }) reason: string;
}

export class BillResultDto {
  @ApiProperty({ example: 42 }) invoices_created: number;
  @ApiProperty({ example: 6 }) deposits_created: number;
  @ApiProperty({ example: 1260000 }) amount: number;
  @ApiProperty({ type: [BillSkipDto] }) skipped: BillSkipDto[];
}

export class ChargeDto {
  @ApiProperty({ example: 7 }) id: number;
  @ApiProperty({ enum: CHARGE_KINDS }) kind: ChargeKind;
  @ApiProperty({ example: 'Hostel fee · Term 1' }) label: string;
  @ApiProperty({ example: 24000 }) amount: number;
  @ApiProperty({ example: 812 }) invoice_id: number;
  @ApiProperty({ example: 'TZS-FEE-2026-0812' }) invoice_no: string;
  @ApiProperty({ example: '2026-06-10' }) due_date: string;
  @ApiProperty({ example: 'paid' }) invoice_status: string;
  @ApiProperty({ example: 24000 }) paid: number;
  @ApiProperty({ example: 0 }) balance: number;
  @ApiProperty({ nullable: true, type: String }) settled_at: Date | null;
  @ApiProperty({ nullable: true, type: Number }) deduction_amount: number | null;
  @ApiProperty({ nullable: true, type: String }) deduction_reason: string | null;
  @ApiProperty({ nullable: true, type: Number }) refund_amount: number | null;
  @ApiProperty({ nullable: true, enum: REFUND_MODES }) refund_mode: RefundMode | null;
  @ApiProperty({ nullable: true, type: String }) refund_reference: string | null;
}

export class ResidentFeesDto {
  @ApiProperty({ example: 21 }) admission_id: number;
  @ApiProperty({ type: HostelStudentDto }) student: HostelStudentDto;
  @ApiProperty({ nullable: true, type: String, example: '4-sharing non-AC' }) room_type: string | null;
  @ApiProperty({ nullable: true, type: Number, example: 60000 }) annual_fee: number | null;
  @ApiProperty({ example: 60000 }) billed: number;
  @ApiProperty({ example: 36000 }) paid: number;
  @ApiProperty({ example: 24000 }) balance: number;
  @ApiProperty({ example: 24000, description: 'Unpaid hostel fee and deposit; blocks checkout' }) dues: number;
  @ApiProperty({ type: [ChargeDto] }) charges: ChargeDto[];
}

export class DuesRowDto {
  @ApiProperty({ example: 21 }) admission_id: number;
  @ApiProperty({ type: HostelStudentDto }) student: HostelStudentDto;
  @ApiProperty({ example: 'Boys Hostel' }) hostel_name: string;
  @ApiProperty({ nullable: true, type: String, example: 'A-101 / B' }) bed: string | null;
  @ApiProperty({ example: 60000 }) billed: number;
  @ApiProperty({ example: 36000 }) paid: number;
  @ApiProperty({ example: 24000 }) balance: number;
  @ApiProperty({ example: 2, description: 'Instalments of this year not billed yet' }) unbilled: number;
  @ApiProperty({ enum: ['none', 'unpaid', 'paid', 'settled'] }) deposit_status: string;
}

export class DuesQueryDto extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
  @ApiPropertyOptional({ description: 'Only residents who still owe' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  with_balance?: boolean;
}

export class FeesInsightsDto {
  @ApiProperty({ example: 1800000 }) billed: number;
  @ApiProperty({ example: 1500000 }) collected: number;
  @ApiProperty({ example: 300000 }) outstanding: number;
  @ApiProperty({ example: 14 }) residents_with_dues: number;
  @ApiProperty({ example: 3, description: 'Residents with a bed missing an instalment that is due' })
  unbilled_residents: number;
  @ApiProperty({ example: 400000 }) deposits_held: number;
}

export class DepositSettleDto {
  @ApiPropertyOptional({ example: 500, default: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999)
  deduction_amount?: number;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'Broken chair' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  deduction_reason?: string | null;
  @ApiProperty({ enum: REFUND_MODES }) @IsIn(REFUND_MODES) refund_mode: RefundMode;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'UTR 1234' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(60)
  refund_reference?: string | null;
}

export class CaseDto {
  @ApiProperty({ example: 4 }) id: number;
  @ApiProperty({ example: 'HDC-2026-0004' }) case_no: string;
  @ApiProperty({ example: 21 }) admission_id: number;
  @ApiProperty({ type: HostelStudentDto }) student: HostelStudentDto;
  @ApiProperty({ example: 'Boys Hostel' }) hostel_name: string;
  @ApiProperty({ nullable: true, type: String }) bed: string | null;
  @ApiProperty({ nullable: true, type: Number }) leave_id: number | null;
  @ApiProperty({ enum: DISCIPLINE_CATEGORIES }) category: DisciplineCategory;
  @ApiProperty({ enum: SEVERITIES }) severity: Severity;
  @ApiProperty() incident_at: Date;
  @ApiProperty({ nullable: true, type: String }) location: string | null;
  @ApiProperty() description: string;
  @ApiProperty({ nullable: true, type: String }) witnesses: string | null;
  @ApiProperty({ enum: CASE_STATUSES }) status: CaseStatus;
  @ApiProperty({ nullable: true, enum: DISCIPLINE_ACTIONS }) action: DisciplineAction | null;
  @ApiProperty({ nullable: true, type: String }) action_note: string | null;
  @ApiProperty({ nullable: true, type: String }) suspended_from: string | null;
  @ApiProperty({ nullable: true, type: String }) suspended_to: string | null;
  @ApiProperty({ nullable: true, type: Number }) fine_amount: number | null;
  @ApiProperty({ nullable: true, type: Number }) fee_fine_id: number | null;
  @ApiProperty({ nullable: true, type: String, example: 'pending', description: 'Fee fine approval state' })
  fine_status: string | null;
  @ApiProperty() visible_to_parent: boolean;
  @ApiProperty({ nullable: true, type: String }) reported_by_name: string | null;
  @ApiProperty({ nullable: true, type: String }) decided_by_name: string | null;
  @ApiProperty({ example: 2, description: 'Cases for this resident in this academic year' }) strikes: number;
  @ApiProperty() created_at: Date;
}

export class CaseInputDto {
  @ApiProperty({ example: 21 }) @IsInt() @Min(1) admission_id: number;
  @ApiProperty({ enum: DISCIPLINE_CATEGORIES }) @IsIn(DISCIPLINE_CATEGORIES) category: DisciplineCategory;
  @ApiProperty({ enum: SEVERITIES }) @IsIn(SEVERITIES) severity: Severity;
  @ApiPropertyOptional({ example: '2026-07-12T21:40:00+05:30', description: 'Default now' })
  @IsOptional()
  @IsISO8601()
  incident_at?: string;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'A Block, 1st floor corridor' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(120)
  location?: string | null;
  @ApiProperty({ example: 'Came back 45 minutes after the in-time without telling the warden' })
  @Transform(trim)
  @IsString()
  @Length(5, 1000)
  description: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  witnesses?: string | null;
  @ApiPropertyOptional({ description: 'The hostel leave this case is about (late return)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  leave_id?: number;
  @ApiPropertyOptional({ default: true, description: 'Parents see the case and get HOSTEL_DISCIPLINE' })
  @IsOptional()
  @IsBoolean()
  visible_to_parent?: boolean;
}

export class CaseActionDto {
  @ApiProperty({ enum: DISCIPLINE_ACTIONS }) @IsIn(DISCIPLINE_ACTIONS) action: DisciplineAction;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(500)
  action_note?: string | null;
  @ApiPropertyOptional({ example: 500, description: 'Required for action fine; goes to fee fine approval' })
  @ValidateIf((dto: CaseActionDto) => dto.action === 'fine')
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(1000000)
  fine_amount?: number;
  @ValidateIf((dto: CaseActionDto) => dto.action === 'hostel_suspension')
  @IsDateOnly('2026-07-15')
  suspended_from?: string;
  @ValidateIf((dto: CaseActionDto) => dto.action === 'hostel_suspension')
  @IsDateOnly('2026-07-22')
  suspended_to?: string;
}

export class CaseCloseDto {
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class CaseQueryDto extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) admission_id?: number;
  @ApiPropertyOptional({ enum: CASE_STATUSES }) @IsOptional() @IsIn(CASE_STATUSES) status?: CaseStatus;
  @ApiPropertyOptional({ enum: DISCIPLINE_CATEGORIES })
  @IsOptional()
  @IsIn(DISCIPLINE_CATEGORIES)
  category?: DisciplineCategory;
  @ApiPropertyOptional({ enum: SEVERITIES }) @IsOptional() @IsIn(SEVERITIES) severity?: Severity;
}

export class TicketUpdateDto {
  @ApiProperty({ example: 'in_progress', nullable: true, type: String }) status: string | null;
  @ApiProperty({ nullable: true, type: String }) note: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'R. Kumar' }) actor_name: string | null;
  @ApiProperty() created_at: Date;
}

export class ComplaintDto {
  @ApiProperty({ example: 11 }) id: number;
  @ApiProperty({ example: 'HCP-2026-0011' }) complaint_no: string;
  @ApiProperty({ example: 1 }) hostel_id: number;
  @ApiProperty({ example: 'Boys Hostel' }) hostel_name: string;
  @ApiProperty({ nullable: true, type: Number }) room_id: number | null;
  @ApiProperty({ nullable: true, type: String, example: 'A-101' }) room_no: string | null;
  @ApiProperty({ nullable: true, type: Number }) admission_id: number | null;
  @ApiProperty({ nullable: true, type: HostelStudentDto }) student: HostelStudentDto | null;
  @ApiProperty({ enum: COMPLAINT_CATEGORIES }) category: ComplaintCategory;
  @ApiProperty({ enum: TICKET_PRIORITIES }) priority: TicketPriority;
  @ApiProperty({ example: 'Fan not working' }) title: string;
  @ApiProperty() description: string;
  @ApiProperty({ nullable: true, type: Number }) photo_file_id: number | null;
  @ApiProperty({ enum: ['parent', 'staff'] }) raised_by_role: 'parent' | 'staff';
  @ApiProperty({ nullable: true, type: String }) raised_by_name: string | null;
  @ApiProperty({ enum: COMPLAINT_STATES }) status: ComplaintState;
  @ApiProperty({ nullable: true, type: Number }) assigned_to: number | null;
  @ApiProperty({ nullable: true, type: String }) assigned_to_name: string | null;
  @ApiProperty({ description: 'Expected fix time from the priority' }) due_at: Date;
  @ApiProperty({ example: false }) overdue: boolean;
  @ApiProperty({ nullable: true, type: String }) resolution: string | null;
  @ApiProperty({ nullable: true, type: String }) resolved_at: Date | null;
  @ApiProperty({ nullable: true, type: Number, example: 4 }) rating: number | null;
  @ApiProperty({ nullable: true, type: String }) rating_comment: string | null;
  @ApiProperty({ nullable: true, type: Number }) maintenance_ticket_id: number | null;
  @ApiProperty() created_at: Date;
}

export class ComplaintDetailDto extends ComplaintDto {
  @ApiProperty({ type: [TicketUpdateDto] }) updates: TicketUpdateDto[];
}

export class ParentComplaintInputDto {
  @ApiProperty({ enum: COMPLAINT_CATEGORIES }) @IsIn(COMPLAINT_CATEGORIES) category: ComplaintCategory;
  @ApiProperty({ example: 'Fan not working' }) @Transform(trim) @IsString() @Length(3, 120) title: string;
  @ApiProperty({ example: 'The ceiling fan in A-101 stopped two days ago' })
  @Transform(trim)
  @IsString()
  @Length(5, 1000)
  description: string;
  @ApiPropertyOptional({ description: 'Photo uploaded through /files' })
  @IsOptional()
  @IsInt()
  @Min(1)
  photo_file_id?: number;
}

export class ComplaintInputDto extends ParentComplaintInputDto {
  @ApiPropertyOptional({ description: 'Hostel; taken from the room or resident when left out' })
  @IsOptional()
  @IsInt()
  @Min(1)
  hostel_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) room_id?: number;
  @ApiPropertyOptional({ description: 'Resident the complaint is about or from' })
  @IsOptional()
  @IsInt()
  @Min(1)
  admission_id?: number;
  @ApiPropertyOptional({ enum: TICKET_PRIORITIES, default: 'normal' })
  @IsOptional()
  @IsIn(TICKET_PRIORITIES)
  priority?: TicketPriority;
}

export class ComplaintPatchDto {
  @ApiPropertyOptional({ enum: TICKET_PRIORITIES }) @IsOptional() @IsIn(TICKET_PRIORITIES) priority?: TicketPriority;
  @ApiPropertyOptional({ nullable: true, type: Number, description: 'Staff user handling it' })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1)
  assigned_to?: number | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class ComplaintActionDto {
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Required to resolve or reject' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class RatingDto {
  @ApiProperty({ example: 4 }) @IsInt() @Min(1) @Max(5) rating: number;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  comment?: string | null;
  @ApiPropertyOptional({ default: false, description: 'Not fixed: open it again instead of closing' })
  @IsOptional()
  @IsBoolean()
  reopen?: boolean;
}

export class ComplaintQueryDto extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) admission_id?: number;
  @ApiPropertyOptional({ enum: COMPLAINT_STATES }) @IsOptional() @IsIn(COMPLAINT_STATES) status?: ComplaintState;
  @ApiPropertyOptional({ enum: COMPLAINT_CATEGORIES })
  @IsOptional()
  @IsIn(COMPLAINT_CATEGORIES)
  category?: ComplaintCategory;
  @ApiPropertyOptional({ enum: TICKET_PRIORITIES }) @IsOptional() @IsIn(TICKET_PRIORITIES) priority?: TicketPriority;
  @ApiPropertyOptional() @IsOptional() @Transform(toBoolean) @IsBoolean() overdue?: boolean;
}

export class TicketDto {
  @ApiProperty({ example: 8 }) id: number;
  @ApiProperty({ example: 'HMT-2026-0008' }) ticket_no: string;
  @ApiProperty({ example: 1 }) hostel_id: number;
  @ApiProperty({ example: 'Boys Hostel' }) hostel_name: string;
  @ApiProperty({ nullable: true, type: Number }) room_id: number | null;
  @ApiProperty({ nullable: true, type: String }) room_no: string | null;
  @ApiProperty({ nullable: true, type: Number }) bed_id: number | null;
  @ApiProperty({ nullable: true, type: String }) bed_no: string | null;
  @ApiProperty({ enum: MAINTENANCE_CATEGORIES }) category: MaintenanceCategory;
  @ApiProperty({ enum: TICKET_PRIORITIES }) priority: TicketPriority;
  @ApiProperty({ example: 'Replace ceiling fan' }) title: string;
  @ApiProperty({ nullable: true, type: String }) description: string | null;
  @ApiProperty({ nullable: true, type: Number }) photo_file_id: number | null;
  @ApiProperty({ enum: TICKET_STATES }) status: TicketState;
  @ApiProperty({ nullable: true, type: Number }) assigned_to: number | null;
  @ApiProperty({ nullable: true, type: String }) assigned_to_name: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'Sri Electricals' }) vendor_name: string | null;
  @ApiProperty({ nullable: true, type: String }) scheduled_on: string | null;
  @ApiProperty({ example: false, description: 'The room is closed for new students while open' }) blocks_room: boolean;
  @ApiProperty({ nullable: true, type: Number, example: 1800 }) cost: number | null;
  @ApiProperty() due_at: Date;
  @ApiProperty({ example: false }) overdue: boolean;
  @ApiProperty({ nullable: true, type: String }) completed_at: Date | null;
  @ApiProperty({ nullable: true, type: Number }) complaint_id: number | null;
  @ApiProperty({ nullable: true, type: Number }) charged_admission_id: number | null;
  @ApiProperty({ nullable: true, type: Number }) charged_fine_id: number | null;
  @ApiProperty({ nullable: true, type: String }) created_by_name: string | null;
  @ApiProperty() created_at: Date;
}

export class TicketDetailDto extends TicketDto {
  @ApiProperty({ type: [TicketUpdateDto] }) updates: TicketUpdateDto[];
}

export class TicketInputDto {
  @ApiPropertyOptional({ description: 'Taken from the room when left out' })
  @IsOptional()
  @IsInt()
  @Min(1)
  hostel_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) room_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) bed_id?: number;
  @ApiProperty({ enum: MAINTENANCE_CATEGORIES }) @IsIn(MAINTENANCE_CATEGORIES) category: MaintenanceCategory;
  @ApiPropertyOptional({ enum: TICKET_PRIORITIES, default: 'normal' })
  @IsOptional()
  @IsIn(TICKET_PRIORITIES)
  priority?: TicketPriority;
  @ApiProperty({ example: 'Replace ceiling fan' }) @Transform(trim) @IsString() @Length(3, 120) title: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(1000)
  description?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) photo_file_id?: number;
  @ApiPropertyOptional({ default: false, description: 'Close the room for new students until done' })
  @IsOptional()
  @IsBoolean()
  blocks_room?: boolean;
}

export class TicketChangeDto {
  @ApiPropertyOptional({ enum: TICKET_STATES }) @IsOptional() @IsIn(TICKET_STATES) status?: TicketState;
  @ApiPropertyOptional({ enum: TICKET_PRIORITIES }) @IsOptional() @IsIn(TICKET_PRIORITIES) priority?: TicketPriority;
  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1)
  assigned_to?: number | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(120)
  vendor_name?: string | null;
  @IsDateOnly('2026-07-15', true) scheduled_on?: string;
  @ApiPropertyOptional({ nullable: true, type: Number, example: 1800 })
  @IsOptional()
  @ValidateIf(notNull)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999)
  cost?: number | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class TicketChargeDto {
  @ApiProperty({ example: 21, description: 'Resident who caused the damage' }) @IsInt() @Min(1) admission_id: number;
  @ApiProperty({ example: 800 }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(1000000) amount: number;
  @ApiProperty({ example: 'Broke the window pane' }) @Transform(trim) @IsString() @Length(3, 120) reason: string;
}

export class TicketQueryDto extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) hostel_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) room_id?: number;
  @ApiPropertyOptional({ enum: TICKET_STATES }) @IsOptional() @IsIn(TICKET_STATES) status?: TicketState;
  @ApiPropertyOptional({ enum: MAINTENANCE_CATEGORIES })
  @IsOptional()
  @IsIn(MAINTENANCE_CATEGORIES)
  category?: MaintenanceCategory;
  @ApiPropertyOptional({ enum: TICKET_PRIORITIES }) @IsOptional() @IsIn(TICKET_PRIORITIES) priority?: TicketPriority;
  @ApiPropertyOptional({ description: 'Not done or cancelled' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  open?: boolean;
  @ApiPropertyOptional() @IsOptional() @Transform(toBoolean) @IsBoolean() overdue?: boolean;
}

export class ConductInsightsDto {
  @ApiProperty({ example: 6 }) open_cases: number;
  @ApiProperty({ example: 12 }) open_complaints: number;
  @ApiProperty({ example: 3 }) overdue_complaints: number;
  @ApiProperty({ example: 7 }) open_tickets: number;
  @ApiProperty({ example: 2 }) overdue_tickets: number;
  @ApiProperty({ example: 4.2, nullable: true, type: Number, description: 'Average parent rating, last 90 days' })
  average_rating: number | null;
}
