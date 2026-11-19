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
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ListQueryDto, toBoolean } from '@app/common';
import { IsDateOnly } from '../../../shared/dates';
import { RefDto } from '../../students/dto/student-response.dto';
import { COPY_CONDITIONS, CopyCondition } from '../entities/book.entity';
import {
  FOLLOW_UP_ACTIONS,
  FollowUpAction,
  ISSUE_PURPOSES,
  ISSUE_STATUSES,
  IssuePurpose,
  IssueStatus,
} from '../entities/library-issue.entity';
import { MEMBER_STATUSES, MEMBER_TYPES, MemberStatus, MemberType } from '../entities/library-member.entity';
import { LOAN_STATES, LoanState, Refusal } from '../library.logic';
import { MemberRefDto } from './catalogue.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const notNull = (_object: unknown, value: unknown) => value !== null && value !== undefined;

export class MemberStudentDto {
  @ApiProperty({ example: 14 }) id: number;
  @ApiProperty({ example: 'ADM-2026-014' }) admission_no: string;
  @ApiProperty({ nullable: true, type: String, example: '6 - A' }) class_section: string | null;
  @ApiProperty({ nullable: true, type: Number }) section_id: number | null;
  @ApiProperty({ example: 'active' }) status: string;
}

export class MemberStaffDto {
  @ApiProperty({ example: 21 }) user_id: number;
  @ApiProperty({ nullable: true, type: String, example: 'EMP-021' }) employee_no: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'PG Assistant' }) designation: string | null;
  @ApiProperty({ example: '9000000004' }) mobile: string;
  @ApiProperty({ example: 'active' }) status: string;
}

export class MemberDto {
  @ApiProperty({ example: 7 }) id: number;
  @ApiProperty({ enum: MEMBER_TYPES }) member_type: MemberType;
  @ApiProperty({ example: 'TZMS-LS-00007' }) card_no: string;
  @ApiProperty({ example: 'Kavin Narayanan' }) name: string;
  @ApiProperty({ nullable: true, type: String }) detail: string | null;
  @ApiProperty({ nullable: true, type: String }) photo_url: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'First parent mobile for a student, own mobile for staff' })
  phone: string | null;
  @ApiProperty({ enum: MEMBER_STATUSES }) status: MemberStatus;
  @ApiProperty({ nullable: true, type: String }) status_reason: string | null;
  @ApiProperty({ example: 2, description: 'Books allowed at a time (the override or the school default)' })
  max_books: number;
  @ApiProperty({ example: 14, description: 'Loan days (the override or the school default)' }) loan_days: number;
  @ApiProperty({ nullable: true, type: Number }) max_books_override: number | null;
  @ApiProperty({ nullable: true, type: Number }) loan_days_override: number | null;
  @ApiProperty({ example: '2026-06-10' }) joined_on: string;
  @ApiProperty({ nullable: true, type: MemberStudentDto }) student: MemberStudentDto | null;
  @ApiProperty({ nullable: true, type: MemberStaffDto }) staff: MemberStaffDto | null;
  @ApiProperty({ example: 1 }) open_loans: number;
  @ApiProperty({ example: 0 }) overdue_loans: number;
  @ApiProperty({ example: 0 }) unpaid_fines: number;
  @ApiProperty({ example: 12 }) total_loans: number;
  @ApiProperty({ nullable: true, type: Date }) last_visit_at: Date | null;
}

export class MemberQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: MEMBER_TYPES }) @IsOptional() @IsIn(MEMBER_TYPES) member_type?: MemberType;
  @ApiPropertyOptional({ enum: MEMBER_STATUSES }) @IsOptional() @IsIn(MEMBER_STATUSES) status?: MemberStatus;
  @ApiPropertyOptional() @IsOptional() @IsInt() class_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() section_id?: number;
  @ApiPropertyOptional() @IsOptional() @Transform(toBoolean) @IsBoolean() has_overdue?: boolean;
  @ApiPropertyOptional() @IsOptional() @Transform(toBoolean) @IsBoolean() has_fines?: boolean;
}

export class MemberInsightsDto {
  @ApiProperty({ example: 420 }) members: number;
  @ApiProperty({ example: 380 }) students: number;
  @ApiProperty({ example: 40 }) staff: number;
  @ApiProperty({ example: 2 }) suspended: number;
  @ApiProperty({ example: 11 }) with_overdue: number;
  @ApiProperty({ example: 6 }) with_fines: number;
  @ApiProperty({ example: 120, description: 'Active students who are not members yet' }) students_not_enrolled: number;
}

export class MemberCreateDto {
  @ApiPropertyOptional({ description: 'Enrol a student' }) @IsOptional() @IsInt() student_id?: number;
  @ApiPropertyOptional({ description: 'Enrol a staff member (their user id)' }) @IsOptional() @IsInt() user_id?: number;
}

export class MemberBulkDto {
  @ApiPropertyOptional({ description: 'Every student of this section' }) @IsOptional() @IsInt() section_id?: number;
  @ApiPropertyOptional({ description: 'Every student of this class' }) @IsOptional() @IsInt() class_id?: number;
  @ApiPropertyOptional({ description: 'Every active student of the school' })
  @IsOptional()
  @IsBoolean()
  all_students?: boolean;
  @ApiPropertyOptional({ description: 'Every active staff member' }) @IsOptional() @IsBoolean() all_staff?: boolean;
}

export class MemberBulkResultDto {
  @ApiProperty({ example: 38 }) created: number;
  @ApiProperty({ example: 2 }) already_members: number;
}

export class MemberUpdateDto {
  @ApiPropertyOptional({ enum: ['active', 'suspended'] })
  @IsOptional()
  @IsIn(['active', 'suspended'])
  status?: 'active' | 'suspended';

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  status_reason?: string | null;

  @ApiPropertyOptional({ nullable: true, type: Number, description: 'null = school default' })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(0)
  max_books?: number | null;

  @ApiPropertyOptional({ nullable: true, type: Number, description: 'null = school default' })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1)
  loan_days?: number | null;
}

export class PeopleQueryDto {
  @ApiPropertyOptional({ description: 'Name, admission number, employee number, mobile or card number' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: MEMBER_TYPES }) @IsOptional() @IsIn(MEMBER_TYPES) member_type?: MemberType;
}

export class PersonDto {
  @ApiProperty({ enum: MEMBER_TYPES }) member_type: MemberType;
  @ApiProperty({ nullable: true, type: Number }) student_id: number | null;
  @ApiProperty({ nullable: true, type: Number }) user_id: number | null;
  @ApiProperty({ example: 'Kavin Narayanan' }) name: string;
  @ApiProperty({ nullable: true, type: String, example: '6 - A · ADM-2026-014' }) detail: string | null;
  @ApiProperty({ nullable: true, type: String }) photo_url: string | null;
  @ApiProperty({ nullable: true, type: Number }) member_id: number | null;
  @ApiProperty({ nullable: true, type: String }) card_no: string | null;
  @ApiProperty({ nullable: true, enum: MEMBER_STATUSES }) member_status: MemberStatus | null;
}

export class MemberLookupQueryDto {
  @ApiProperty({
    example: 'TZMS-LS-00007',
    description:
      'Library card number, ID card QR (TZS1…), admission number, employee number or staff mobile. A student or staff member who is not a member yet is enrolled on the spot.',
  })
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  code: string;
}

export class LoanBookDto {
  @ApiProperty({ example: 12 }) id: number;
  @ApiProperty({ example: 'Wings of Fire' }) title: string;
  @ApiProperty({ nullable: true, type: String }) authors: string | null;
  @ApiProperty({ nullable: true, type: String }) isbn: string | null;
  @ApiProperty({ nullable: true, type: String }) cover_url: string | null;
}

export class LoanCopyDto {
  @ApiProperty({ example: 88 }) id: number;
  @ApiProperty({ example: 'TZMS-000088' }) accession_no: string;
  @ApiProperty({ example: 'TZMS-000088' }) barcode: string;
}

export class FollowUpDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: FOLLOW_UP_ACTIONS }) action: FollowUpAction;
  @ApiProperty({ nullable: true, type: String }) note: string | null;
  @ApiProperty({ nullable: true, type: String }) promised_on: string | null;
  @ApiProperty({ nullable: true, type: String }) next_follow_up_on: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'Librarian' }) by: string | null;
  @ApiProperty() created_at: Date;
}

export class LoanDto {
  @ApiProperty({ example: 41 }) id: number;
  @ApiProperty({ enum: ISSUE_STATUSES }) status: IssueStatus;
  @ApiProperty({ enum: LOAN_STATES, description: 'on_loan, due_soon, due_today, overdue, returned or lost' })
  state: LoanState;
  @ApiProperty({ enum: ISSUE_PURPOSES }) purpose: IssuePurpose;
  @ApiProperty({ type: LoanBookDto }) book: LoanBookDto;
  @ApiProperty({ type: LoanCopyDto }) copy: LoanCopyDto;
  @ApiProperty({ type: MemberRefDto }) member: MemberRefDto;
  @ApiProperty({ nullable: true, type: RefDto, description: 'The class a class set is for' }) section: RefDto | null;
  @ApiProperty() issued_at: Date;
  @ApiProperty({ example: '2026-11-30' }) due_date: string;
  @ApiProperty({ nullable: true, type: Date }) returned_at: Date | null;
  @ApiProperty({ nullable: true, enum: COPY_CONDITIONS }) return_condition: CopyCondition | null;
  @ApiProperty({ example: 0 }) renew_count: number;
  @ApiProperty({ example: 3, description: 'Days past the due date (0 when not late)' }) days_overdue: number;
  @ApiProperty({ example: 3, description: 'Late fine if it were returned today (not yet raised)' })
  running_fine: number;
  @ApiProperty({ nullable: true, type: String }) remarks: string | null;
  @ApiProperty({ nullable: true, type: String }) issued_by: string | null;
  @ApiProperty({ nullable: true, type: String }) returned_by: string | null;
  @ApiProperty({ nullable: true, type: FollowUpDto }) last_follow_up: FollowUpDto | null;
}

export class RefusalDto implements Refusal {
  @ApiProperty({ example: 'BOOK_LIMIT_REACHED' }) code: string;
  @ApiProperty({ example: 'The member can hold 2 books and already has 2' }) message: string;
}

export class MemberFineDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'overdue' }) kind: string;
  @ApiProperty({ example: 'unpaid' }) status: string;
  @ApiProperty({ example: 6 }) amount: number;
  @ApiProperty({ example: 6 }) balance: number;
  @ApiProperty({ example: '6 days late: Wings of Fire' }) reason: string;
  @ApiProperty() created_at: Date;
}

export class MemberSummaryDto {
  @ApiProperty({ type: MemberDto }) member: MemberDto;
  @ApiProperty({ type: [LoanDto], description: 'Books with the member now' }) loans: LoanDto[];
  @ApiProperty({ type: [MemberFineDto], description: 'Fines not fully paid' }) fines: MemberFineDto[];
  @ApiProperty({ example: 1, description: 'More books the member may take now' }) books_left: number;
  @ApiProperty({ example: true }) can_borrow: boolean;
  @ApiProperty({ nullable: true, type: RefusalDto, description: 'Why the member cannot borrow now' })
  refusal: RefusalDto | null;
  @ApiProperty({ example: false, description: 'true when the member was enrolled by this lookup' })
  enrolled_now: boolean;
}

export class IssueBooksDto {
  @ApiProperty({ example: 7 }) @IsInt() member_id: number;

  @ApiProperty({ type: [String], example: ['TZMS-000088'], description: 'Copy barcodes or accession numbers' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @Length(1, 60, { each: true })
  codes: string[];

  @IsDateOnly('2026-12-02', true)
  due_date?: string;

  @ApiPropertyOptional({ enum: ISSUE_PURPOSES, default: 'personal', description: 'class_set: books for a classroom' })
  @IsOptional()
  @IsIn(ISSUE_PURPOSES)
  purpose?: IssuePurpose;

  @ApiPropertyOptional({ description: 'The section a class set is for' }) @IsOptional() @IsInt() section_id?: number;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  remarks?: string | null;
}

export class ReturnItemDto {
  @ApiProperty({ example: 'TZMS-000088' }) @Transform(trim) @IsString() @Length(1, 60) code: string;
  @ApiPropertyOptional({ enum: COPY_CONDITIONS }) @IsOptional() @IsIn(COPY_CONDITIONS) condition?: CopyCondition;

  @ApiPropertyOptional({ description: 'Raise a damage fine of this amount; the copy goes to in_repair' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  damage_fine?: number;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  remarks?: string | null;
}

export class ReturnBooksDto {
  @ApiProperty({ type: [ReturnItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ReturnItemDto)
  items: ReturnItemDto[];
}

export class ReturnedItemDto {
  @ApiProperty({ type: LoanDto }) loan: LoanDto;
  @ApiProperty({ type: [MemberFineDto], description: 'Fines raised by this return' }) fines: MemberFineDto[];
}

export class RenewDto {
  @IsDateOnly('2026-12-16', true)
  due_date?: string;
}

export class LostDto {
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  note?: string | null;
}

export class IssueQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: ISSUE_STATUSES }) @IsOptional() @IsIn(ISSUE_STATUSES) status?: IssueStatus;

  @ApiPropertyOptional({ enum: ['on_loan', 'due_soon', 'due_today', 'overdue'], description: 'Only books still out' })
  @IsOptional()
  @IsIn(['on_loan', 'due_soon', 'due_today', 'overdue'])
  state?: 'on_loan' | 'due_soon' | 'due_today' | 'overdue';

  @ApiPropertyOptional() @IsOptional() @IsInt() member_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() book_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() copy_id?: number;
  @ApiPropertyOptional({ enum: MEMBER_TYPES }) @IsOptional() @IsIn(MEMBER_TYPES) member_type?: MemberType;
  @ApiPropertyOptional() @IsOptional() @IsInt() class_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() section_id?: number;
  @ApiPropertyOptional({ enum: ISSUE_PURPOSES }) @IsOptional() @IsIn(ISSUE_PURPOSES) purpose?: IssuePurpose;
  @IsDateOnly('2026-11-01', true) from?: string;
  @IsDateOnly('2026-11-30', true) to?: string;

  @ApiPropertyOptional({ example: '2026-11-18', description: 'Issued or returned on this day (the desk’s day list)' })
  @IsDateOnly('2026-11-18', true)
  on?: string;
}

export class IssueInsightsDto {
  @ApiProperty({ example: 190 }) on_loan: number;
  @ApiProperty({ example: 14 }) overdue: number;
  @ApiProperty({ example: 6 }) due_today: number;
  @ApiProperty({ example: 11 }) due_soon: number;
  @ApiProperty({ example: 23 }) issued_today: number;
  @ApiProperty({ example: 19 }) returned_today: number;
  @ApiProperty({ example: 3 }) lost: number;
  @ApiProperty({ example: 340, description: 'Late fines building up on books still out' }) running_fines: number;
  @ApiProperty({ example: 4, description: 'Overdue loans needing a follow-up today' }) follow_ups_due: number;
}

export class LoanReminderDto {
  @ApiProperty({ example: 'overdue' }) kind: string;
  @ApiProperty() sent_at: Date;
  @ApiProperty({ example: 2 }) recipients: number;
}

export class LoanDetailDto extends LoanDto {
  @ApiProperty({ type: [FollowUpDto] }) follow_ups: FollowUpDto[];
  @ApiProperty({ type: [MemberFineDto] }) fines: MemberFineDto[];
  @ApiProperty({ type: [LoanReminderDto] }) reminders: LoanReminderDto[];
}

export class FollowUpInputDto {
  @ApiProperty({ enum: FOLLOW_UP_ACTIONS }) @IsIn(FOLLOW_UP_ACTIONS) action: FollowUpAction;

  @ApiPropertyOptional({ nullable: true, type: String, example: 'Mother said the book will come on Monday' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @IsDateOnly('2026-11-24', true) promised_on?: string;
  @IsDateOnly('2026-11-25', true) next_follow_up_on?: string;
}

export class FollowUpQueryDto extends ListQueryDto {
  @ApiPropertyOptional({
    enum: ['due', 'all'],
    default: 'due',
    description: 'due: overdue loans with no follow-up yet or a next follow-up date today or earlier',
  })
  @IsOptional()
  @IsIn(['due', 'all'])
  show?: 'due' | 'all';

  @ApiPropertyOptional({ enum: MEMBER_TYPES }) @IsOptional() @IsIn(MEMBER_TYPES) member_type?: MemberType;
  @ApiPropertyOptional() @IsOptional() @IsInt() class_id?: number;
}
