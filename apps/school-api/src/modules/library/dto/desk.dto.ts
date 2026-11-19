import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
import { ListQueryDto, PaginationDto, toBoolean } from '@app/common';
import { IsDateOnly } from '../../../shared/dates';
import { PAYMENT_MODES, PaymentMode } from '../../fees/entities/fee-payment.entity';
import { RefDto } from '../../students/dto/student-response.dto';
import { FINE_KINDS, FINE_STATUSES, FineKind, FineStatus } from '../entities/library-fine.entity';
import { MEMBER_TYPES, MemberType } from '../entities/library-member.entity';
import {
  AUDIT_FINDINGS,
  AUDIT_STATUSES,
  AuditFinding,
  AuditStatus,
  VISIT_KINDS,
  VISIT_PURPOSES,
  VisitKind,
  VisitPurpose,
} from '../entities/library-visit.entity';
import { BookInsightsDto, CopyDto, MemberRefDto } from './catalogue.dto';
import { IssueInsightsDto, LoanDto, MemberFineDto } from './circulation.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const notNull = (_object: unknown, value: unknown) => value !== null && value !== undefined;

export class FineLoanDto {
  @ApiProperty({ example: 41 }) id: number;
  @ApiProperty({ example: 'Wings of Fire' }) book_title: string;
  @ApiProperty({ example: 'TZMS-000088' }) accession_no: string;
  @ApiProperty({ example: '2026-11-10' }) due_date: string;
}

export class FineDto {
  @ApiProperty({ example: 9 }) id: number;
  @ApiProperty({ enum: FINE_KINDS }) kind: FineKind;
  @ApiProperty({ enum: FINE_STATUSES }) status: FineStatus;
  @ApiProperty({ example: 6 }) amount: number;
  @ApiProperty({ example: 0 }) waived: number;
  @ApiProperty({ example: 0 }) paid: number;
  @ApiProperty({ example: 6 }) balance: number;
  @ApiProperty({ nullable: true, type: Number, example: 6 }) days_late: number | null;
  @ApiProperty({ example: '6 days late: Wings of Fire' }) reason: string;
  @ApiProperty({ type: MemberRefDto }) member: MemberRefDto;
  @ApiProperty({ nullable: true, type: FineLoanDto }) loan: FineLoanDto | null;
  @ApiProperty({ nullable: true, type: String }) waive_reason: string | null;
  @ApiProperty({ nullable: true, type: String }) waived_by: string | null;
  @ApiProperty() created_at: Date;
}

export class FineQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: FINE_STATUSES }) @IsOptional() @IsIn(FINE_STATUSES) status?: FineStatus;
  @ApiPropertyOptional({ enum: FINE_KINDS }) @IsOptional() @IsIn(FINE_KINDS) kind?: FineKind;
  @ApiPropertyOptional() @IsOptional() @IsInt() member_id?: number;
  @ApiPropertyOptional({ enum: MEMBER_TYPES }) @IsOptional() @IsIn(MEMBER_TYPES) member_type?: MemberType;
  @ApiPropertyOptional() @IsOptional() @IsInt() class_id?: number;
  @ApiPropertyOptional({ description: 'Only fines with a balance' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  outstanding?: boolean;
}

export class FineInsightsDto {
  @ApiProperty({ example: 420 }) outstanding: number;
  @ApiProperty({ example: 18 }) outstanding_count: number;
  @ApiProperty({ example: 260 }) collected_this_month: number;
  @ApiProperty({ example: 40 }) waived_this_month: number;
  @ApiProperty({ example: 520 }) raised_this_month: number;
  @ApiProperty({ example: 35 }) collected_today: number;
}

export class FinePaymentInputDto {
  @ApiProperty({ example: 6 }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount: number;
  @ApiProperty({ enum: PAYMENT_MODES, example: 'cash' }) @IsIn(PAYMENT_MODES) mode: PaymentMode;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(60)
  reference?: string | null;

  @IsDateOnly('2026-11-18', true) paid_on?: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  notes?: string | null;
}

export class FineWaiveDto {
  @ApiPropertyOptional({ description: 'Amount to waive; the whole balance when left out' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount?: number;

  @ApiProperty({ example: 'Student was in hospital' }) @Transform(trim) @IsString() @Length(3, 255) reason: string;
}

export class FinePaymentDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'TZMS-LIB-2026-0004' }) receipt_no: string;
  @ApiProperty({ example: 6 }) amount: number;
  @ApiProperty({ enum: PAYMENT_MODES }) mode: PaymentMode;
  @ApiProperty({ nullable: true, type: String }) reference: string | null;
  @ApiProperty({ example: '2026-11-18' }) paid_on: string;
  @ApiProperty({ nullable: true, type: String }) notes: string | null;
  @ApiProperty({ nullable: true, type: String }) received_by: string | null;
  @ApiProperty() fine_id: number;
  @ApiProperty({ example: '6 days late: Wings of Fire' }) fine_reason: string;
  @ApiProperty({ type: MemberRefDto }) member: MemberRefDto;
  @ApiProperty() created_at: Date;
}

export class FinePaymentQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: PAYMENT_MODES }) @IsOptional() @IsIn(PAYMENT_MODES) mode?: PaymentMode;
  @ApiPropertyOptional() @IsOptional() @IsInt() member_id?: number;
  @IsDateOnly('2026-11-01', true) from?: string;
  @IsDateOnly('2026-11-30', true) to?: string;
}

export class FinePaymentResultDto {
  @ApiProperty({ type: FineDto }) fine: FineDto;
  @ApiProperty({ type: FinePaymentDto }) payment: FinePaymentDto;
}

export class VisitorDto {
  @ApiProperty({ enum: MEMBER_TYPES }) member_type: MemberType;
  @ApiProperty({ nullable: true, type: Number }) student_id: number | null;
  @ApiProperty({ nullable: true, type: Number }) user_id: number | null;
  @ApiProperty({ example: 'Kavin Narayanan' }) name: string;
  @ApiProperty({ nullable: true, type: String, example: '6 - A' }) detail: string | null;
  @ApiProperty({ nullable: true, type: String }) photo_url: string | null;
}

export class VisitDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: VISIT_KINDS }) kind: VisitKind;
  @ApiProperty({ type: VisitorDto }) visitor: VisitorDto;
  @ApiProperty({ example: '2026-11-18' }) visit_date: string;
  @ApiProperty({ nullable: true, type: Date }) in_at: Date | null;
  @ApiProperty({ nullable: true, type: Date }) out_at: Date | null;
  @ApiProperty({ nullable: true, type: Number, example: 35, description: 'Time spent; null while inside' })
  minutes: number | null;
  @ApiProperty({ enum: VISIT_PURPOSES }) purpose: VisitPurpose;
  @ApiProperty({ example: true }) present: boolean;
  @ApiProperty({ nullable: true, type: Number }) period_no: number | null;
  @ApiProperty({ nullable: true, type: RefDto }) section: RefDto | null;
}

export class VisitScanDto {
  @ApiProperty({
    example: 'TZS1.14.1.abc',
    description: 'ID card QR, library card number, admission number, employee number or staff mobile',
  })
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  code: string;

  @ApiPropertyOptional({ enum: VISIT_PURPOSES, default: 'read' })
  @IsOptional()
  @IsIn(VISIT_PURPOSES)
  purpose?: VisitPurpose;
}

export class VisitScanResultDto {
  @ApiProperty({ enum: ['checked_in', 'checked_out'] }) action: 'checked_in' | 'checked_out';
  @ApiProperty({ type: VisitDto }) visit: VisitDto;
}

export class VisitQueryDto extends ListQueryDto {
  @IsDateOnly('2026-11-18', true) date?: string;
  @IsDateOnly('2026-11-01', true) from?: string;
  @IsDateOnly('2026-11-30', true) to?: string;
  @ApiPropertyOptional({ enum: VISIT_KINDS }) @IsOptional() @IsIn(VISIT_KINDS) kind?: VisitKind;
  @ApiPropertyOptional({ enum: MEMBER_TYPES }) @IsOptional() @IsIn(MEMBER_TYPES) member_type?: MemberType;
  @ApiPropertyOptional() @IsOptional() @IsInt() class_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() section_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() student_id?: number;
  @ApiPropertyOptional({ description: 'Only people inside now' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  inside?: boolean;
  @ApiPropertyOptional({ description: 'Period attendance: false = absent only' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  present?: boolean;
}

export class DateQueryDto {
  @IsDateOnly('2026-11-18', true) date?: string;
}

export class VisitInsightsDto {
  @ApiProperty({ example: '2026-11-18' }) date: string;
  @ApiProperty({ example: 12 }) inside_now: number;
  @ApiProperty({ example: 64 }) visitors_today: number;
  @ApiProperty({ example: 58 }) students_today: number;
  @ApiProperty({ example: 6 }) staff_today: number;
  @ApiProperty({ nullable: true, type: Number, example: 32 }) average_minutes: number | null;
  @ApiProperty({ example: 3 }) periods_today: number;
  @ApiProperty({ example: 2 }) periods_marked: number;
  @ApiProperty({ nullable: true, type: Number, example: 11, description: 'Hour of day with the most check-ins' })
  busiest_hour: number | null;
}

export class LibraryPeriodDto {
  @ApiProperty({ example: 120 }) slot_id: number;
  @ApiProperty({ example: '2026-11-18' }) date: string;
  @ApiProperty({ example: 4 }) period_no: number;
  @ApiProperty({ nullable: true, type: String, example: 'Period 4' }) period_name: string | null;
  @ApiProperty({ nullable: true, type: String, example: '11:10' }) start_time: string | null;
  @ApiProperty({ nullable: true, type: String, example: '11:50' }) end_time: string | null;
  @ApiProperty({ type: RefDto, description: 'The section, named "6 - A"' }) section: RefDto;
  @ApiProperty({ nullable: true, type: String }) teacher: string | null;
  @ApiProperty({ example: false }) marked: boolean;
  @ApiProperty({ example: 0 }) present: number;
  @ApiProperty({ example: 0 }) absent: number;
  @ApiProperty({ example: 32 }) total: number;
}

export class PeriodStudentDto {
  @ApiProperty() student_id: number;
  @ApiProperty({ example: 'Kavin Narayanan' }) name: string;
  @ApiProperty({ nullable: true, type: Number }) roll_no: number | null;
  @ApiProperty({ example: 'ADM-2026-014' }) admission_no: string;
  @ApiProperty({ nullable: true, type: String }) photo_url: string | null;
  @ApiProperty({ nullable: true, type: Boolean, description: 'null until marked' }) present: boolean | null;
}

export class PeriodRosterDto {
  @ApiProperty({ type: LibraryPeriodDto }) period: LibraryPeriodDto;
  @ApiProperty({ type: [PeriodStudentDto] }) students: PeriodStudentDto[];
}

export class PeriodAttendanceDto {
  @IsDateOnly('2026-11-18', true) date?: string;

  @ApiProperty({ type: [Number], description: 'Everyone else in the section is marked present' })
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsInt({ each: true })
  absent_student_ids: number[];
}

export class AuditDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'Annual stock check 2026' }) name: string;
  @ApiProperty({ enum: AUDIT_STATUSES }) status: AuditStatus;
  @ApiProperty({ nullable: true, type: RefDto }) category: RefDto | null;
  @ApiProperty({ nullable: true, type: String }) rack: string | null;
  @ApiProperty({ example: 400, description: 'Copies that should be on the shelves in this scope' }) expected: number;
  @ApiProperty({ example: 380 }) scanned: number;
  @ApiProperty({ example: 372 }) found: number;
  @ApiProperty({ example: 4, description: 'Scanned but from another rack or category' }) misplaced: number;
  @ApiProperty({ example: 2, description: 'Scanned on the shelf but shown as issued or lost' }) mismatched: number;
  @ApiProperty({ example: 1, description: 'Scanned on the shelf but shown as on loan' }) was_issued: number;
  @ApiProperty({ example: 1, description: 'Scanned on the shelf but shown as lost or withdrawn' }) was_lost: number;
  @ApiProperty({ example: 2, description: 'Codes not in the catalogue' }) unknown: number;
  @ApiProperty({ example: 28, description: 'Expected but not scanned yet' }) missing: number;
  @ApiProperty({ nullable: true, type: String }) notes: string | null;
  @ApiProperty({ nullable: true, type: String }) started_by: string | null;
  @ApiProperty() created_at: Date;
  @ApiProperty({ nullable: true, type: Date }) closed_at: Date | null;
}

export class AuditCreateDto {
  @ApiProperty({ example: 'Annual stock check 2026' }) @Transform(trim) @IsString() @Length(3, 80) name: string;
  @ApiPropertyOptional({ description: 'Only this category' }) @IsOptional() @IsInt() category_id?: number;

  @ApiPropertyOptional({ description: 'Only this rack' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(20)
  rack?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  notes?: string | null;
}

export class AuditScanDto {
  @ApiProperty({ example: 'TZMS-000088' }) @Transform(trim) @IsString() @Length(1, 60) code: string;
}

export class AuditScanResultDto {
  @ApiProperty({ enum: AUDIT_FINDINGS }) finding: AuditFinding;
  @ApiProperty({ example: 'Found on the shelf' }) message: string;
  @ApiProperty({ example: false, description: 'true when this code was already scanned in this check' })
  repeated: boolean;
  @ApiProperty({ nullable: true, type: CopyDto }) copy: CopyDto | null;
  @ApiProperty({ type: AuditDto }) audit: AuditDto;
}

export class AuditItemDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'TZMS-000088' }) code: string;
  @ApiProperty({ enum: AUDIT_FINDINGS }) finding: AuditFinding;
  @ApiProperty({ nullable: true, type: CopyDto }) copy: CopyDto | null;
  @ApiProperty() scanned_at: Date;
}

export class AuditItemsQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: [...AUDIT_FINDINGS, 'missing'],
    description: 'missing lists copies expected but not scanned',
  })
  @IsOptional()
  @IsIn([...AUDIT_FINDINGS, 'missing'])
  finding?: AuditFinding | 'missing';
}

export class AuditCloseDto {
  @ApiPropertyOptional({
    default: false,
    description: 'Mark copies still missing as withdrawn (they can be restored later)',
  })
  @IsOptional()
  @IsBoolean()
  withdraw_missing?: boolean;
}

export class ReportQueryDto {
  @IsDateOnly('2026-06-01', true) from?: string;
  @IsDateOnly('2026-11-30', true) to?: string;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ enum: MEMBER_TYPES }) @IsOptional() @IsIn(MEMBER_TYPES) member_type?: MemberType;
}

export class MostBorrowedDto {
  @ApiProperty({ example: 12 }) book_id: number;
  @ApiProperty({ example: 'Wings of Fire' }) title: string;
  @ApiProperty({ nullable: true, type: String }) authors: string | null;
  @ApiProperty({ nullable: true, type: String }) category: string | null;
  @ApiProperty({ example: 18 }) loans: number;
  @ApiProperty({ example: 15 }) readers: number;
}

export class CategoryReportDto {
  @ApiProperty({ nullable: true, type: Number }) category_id: number | null;
  @ApiProperty({ example: 'Fiction' }) category: string;
  @ApiProperty({ example: 40 }) titles: number;
  @ApiProperty({ example: 120 }) copies: number;
  @ApiProperty({ example: 90 }) available: number;
  @ApiProperty({ example: 75 }) loans: number;
  @ApiProperty({ example: 50 }) readers: number;
  @ApiProperty({ example: 25000 }) stock_value: number;
}

export class TopReaderDto {
  @ApiProperty({ type: MemberRefDto }) member: MemberRefDto;
  @ApiProperty({ example: 9 }) loans: number;
  @ApiProperty({ example: 2 }) late_returns: number;
}

export class ClassReportDto {
  @ApiProperty() section_id: number;
  @ApiProperty({ example: '6 - A' }) section: string;
  @ApiProperty({ example: 32 }) students: number;
  @ApiProperty({ example: 25 }) members: number;
  @ApiProperty({ example: 40 }) loans: number;
  @ApiProperty({ example: 3 }) overdue: number;
  @ApiProperty({ example: 70 }) visits: number;
  @ApiProperty({ example: 28 }) period_present: number;
  @ApiProperty({ example: 4 }) period_absent: number;
}

export class StockStatusDto {
  @ApiProperty({ example: 'available' }) status: string;
  @ApiProperty({ example: 760 }) copies: number;
  @ApiProperty({ example: 152000 }) value: number;
}

export class StockReportDto {
  @ApiProperty({ example: 320 }) titles: number;
  @ApiProperty({ example: 980 }) copies: number;
  @ApiProperty({ example: 196000 }) value: number;
  @ApiProperty({ type: [StockStatusDto] }) by_status: StockStatusDto[];
  @ApiProperty({ type: [CategoryReportDto] }) by_category: CategoryReportDto[];
}

export class LibraryDashboardDto {
  @ApiProperty({ type: BookInsightsDto }) books: BookInsightsDto;
  @ApiProperty({ type: IssueInsightsDto }) loans: IssueInsightsDto;
  @ApiProperty({ type: FineInsightsDto }) fines: FineInsightsDto;
  @ApiProperty({ type: VisitInsightsDto }) visits: VisitInsightsDto;
  @ApiProperty({ type: [LoanDto], description: 'Due today (up to 10)' }) due_today: LoanDto[];
  @ApiProperty({ type: [LoanDto], description: 'Overdue needing a follow-up (up to 10)' }) follow_ups: LoanDto[];
  @ApiProperty({ type: [LoanDto], description: 'Latest issues and returns (up to 10)' }) recent: LoanDto[];
  @ApiProperty({ type: [LibraryPeriodDto] }) periods_today: LibraryPeriodDto[];
}

export class PersonLibraryDto {
  @ApiProperty({ nullable: true, type: MemberRefDto, description: 'null when not a library member' })
  member: MemberRefDto | null;
  @ApiProperty({ nullable: true, type: String }) status: string | null;
  @ApiProperty({ example: 2 }) max_books: number;
  @ApiProperty({ example: 1 }) books_left: number;
  @ApiProperty({ type: [LoanDto] }) loans: LoanDto[];
  @ApiProperty({ type: [MemberFineDto] }) fines: MemberFineDto[];
  @ApiProperty({ example: 6 }) unpaid_fines: number;
  @ApiProperty({ type: [LoanDto], description: 'Last 20 returned or lost' }) history: LoanDto[];
  @ApiProperty({ example: 12 }) total_loans: number;
  @ApiProperty({ example: 4 }) visits_this_month: number;
}

export class CatalogueQueryDto extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() category_id?: number;
  @ApiPropertyOptional() @IsOptional() @Transform(toBoolean) @IsBoolean() available_only?: boolean;
}

export class CatalogueBookDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'Wings of Fire' }) title: string;
  @ApiProperty({ nullable: true, type: String }) authors: string | null;
  @ApiProperty({ nullable: true, type: String }) category: string | null;
  @ApiProperty({ example: 'English' }) language: string;
  @ApiProperty({ nullable: true, type: String }) cover_url: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'R3 / S2' }) location: string | null;
  @ApiProperty({ example: 3 }) available_copies: number;
  @ApiProperty({ example: 5 }) total_copies: number;
  @ApiProperty({ example: false }) is_reference: boolean;
}

export class ClassOverdueDto {
  @ApiProperty({ type: RefDto }) section: RefDto;
  @ApiProperty({ type: [LoanDto] }) loans: LoanDto[];
}

export class ReminderRunResultDto {
  @ApiProperty({ example: 12, description: 'Loans due soon, due today or overdue' }) checked: number;
  @ApiProperty({ example: 5, description: 'New reminders sent now (each step is sent once per loan)' }) sent: number;
  @ApiProperty({ example: { overdue: 3, due_soon: 2 }, type: 'object', additionalProperties: { type: 'number' } })
  by_kind: Record<string, number>;
}

export class SectionLibraryStudentDto {
  @ApiProperty({ example: 14 }) student_id: number;
  @ApiProperty({ example: 'Kavin Narayanan' }) full_name: string;
  @ApiProperty({ example: 'TZMS-2026-0014' }) admission_no: string;
  @ApiProperty({ nullable: true, type: Number, example: 5 }) roll_no: number | null;
  @ApiProperty({ nullable: true, type: String }) photo_url: string | null;
  @ApiProperty({ nullable: true, type: Number, description: 'null when not a library member' }) member_id:
    number | null;
  @ApiProperty({ nullable: true, type: String, example: 'TZMS-LS-00007' }) card_no: string | null;
  @ApiProperty({ example: 1, description: 'Books with the student now' }) books_held: number;
  @ApiProperty({ example: 1 }) overdue_books: number;
  @ApiProperty({ example: 6, description: 'Days late of the oldest overdue book (0 when none)' })
  max_days_overdue: number;
  @ApiProperty({ example: 6, description: 'Late fine building up on books still out' }) running_fine: number;
  @ApiProperty({ example: 14, description: 'Raised fines not yet paid (the dues)' }) unpaid_fines: number;
  @ApiProperty({ nullable: true, type: String, example: '9000000005', description: 'First parent mobile' })
  parent_phone: string | null;
  @ApiProperty({ enum: ['overdue', 'dues', 'holding', 'clear'], description: 'The one status to show for the row' })
  status: 'overdue' | 'dues' | 'holding' | 'clear';
  @ApiProperty({ type: [LoanDto], description: 'Books with the student now' }) loans: LoanDto[];
}

export class SectionLibraryCountsDto {
  @ApiProperty({ example: 32 }) students: number;
  @ApiProperty({ example: 28 }) members: number;
  @ApiProperty({ example: 9, description: 'Students holding at least one book' }) holding: number;
  @ApiProperty({ example: 3, description: 'Students with an overdue book' }) overdue: number;
  @ApiProperty({ example: 2, description: 'Students with unpaid library fines' }) with_dues: number;
}

export class SectionLibraryDto {
  @ApiProperty({ example: 8 }) section_id: number;
  @ApiProperty({ example: '6 - A' }) class_section: string;
  @ApiProperty({ type: SectionLibraryCountsDto }) counts: SectionLibraryCountsDto;
  @ApiProperty({ example: 40, description: 'Unpaid library fines of the whole class' }) unpaid_fines: number;
  @ApiProperty({ example: 12, description: 'Late fines building up in the class' }) running_fines: number;
  @ApiProperty({
    type: [SectionLibraryStudentDto],
    description: 'Overdue first, then dues, then holding, then by roll no',
  })
  students: SectionLibraryStudentDto[];
}
