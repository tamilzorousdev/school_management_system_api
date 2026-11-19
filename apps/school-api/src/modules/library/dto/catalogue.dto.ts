import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
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
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ListQueryDto, toBoolean } from '@app/common';
import { IsDateOnly } from '../../../shared/dates';
import { RefDto } from '../../students/dto/student-response.dto';
import {
  COPY_CONDITIONS,
  COPY_SOURCES,
  COPY_STATUSES,
  CopyCondition,
  CopySource,
  CopyStatus,
} from '../entities/book.entity';
import { LOAN_STATES, LoanState } from '../library.logic';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const notNull = (_object: unknown, value: unknown) => value !== null && value !== undefined;
const idList = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isInteger(item) && item > 0)
    : value;

export class LibrarySettingsDto {
  @ApiProperty({ example: 14 }) student_loan_days: number;
  @ApiProperty({ example: 30 }) staff_loan_days: number;
  @ApiProperty({ example: 2 }) student_max_books: number;
  @ApiProperty({ example: 5 }) staff_max_books: number;
  @ApiProperty({ example: 1, description: 'Rupees per late day' }) fine_per_day: number;
  @ApiProperty({ example: 0, description: 'Late days with no fine' }) grace_days: number;
  @ApiProperty({ example: 100, nullable: true, type: Number, description: 'null = no cap' })
  max_fine_per_book: number | null;
  @ApiProperty({ example: 50, description: 'Added to the book price for a lost book' }) lost_processing_fee: number;
  @ApiProperty({ example: 1 }) max_renewals: number;
  @ApiProperty({ example: 50, description: 'No new books while unpaid fines are above this; 0 = never block' })
  block_issue_above_fine: number;
  @ApiProperty({ example: true, description: 'Due dates skip Sundays and holidays; late days ignore them' })
  skip_holidays: boolean;
  @ApiProperty({ example: false, description: 'Charge late fines to staff too' }) charge_staff_fines: boolean;
  @ApiProperty({ example: 2 }) due_soon_days: number;
  @ApiProperty({ example: 7, description: 'Days late before the class teacher is told' }) escalate_after_days: number;
  @ApiProperty({ example: 30, description: 'Days late before the office is told to mark the book lost' })
  long_overdue_days: number;
  @ApiProperty({ example: '08:00' }) opening_time: string;
  @ApiProperty({ example: '16:30' }) closing_time: string;
  @ApiProperty({ example: true, description: 'Fill new books from the online ISBN lookup' }) isbn_lookup: boolean;
  @ApiProperty({ example: true, description: 'false when the server has no BOOK_LOOKUP_URL' })
  isbn_lookup_available: boolean;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class LibrarySettingsInputDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 120 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  student_loan_days?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 365 }) @IsOptional() @IsInt() @Min(1) @Max(365) staff_loan_days?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 20 }) @IsOptional() @IsInt() @Min(0) @Max(20) student_max_books?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 50 }) @IsOptional() @IsInt() @Min(0) @Max(50) staff_max_books?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 1000 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000)
  fine_per_day?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 30 }) @IsOptional() @IsInt() @Min(0) @Max(30) grace_days?: number;
  @ApiPropertyOptional({ nullable: true, type: Number, minimum: 0 })
  @IsOptional()
  @ValidateIf(notNull)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  max_fine_per_book?: number | null;
  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  lost_processing_fee?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 10 }) @IsOptional() @IsInt() @Min(0) @Max(10) max_renewals?: number;
  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  block_issue_above_fine?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() skip_holidays?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() charge_staff_fines?: boolean;
  @ApiPropertyOptional({ minimum: 0, maximum: 14 }) @IsOptional() @IsInt() @Min(0) @Max(14) due_soon_days?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 90 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  escalate_after_days?: number;
  @ApiPropertyOptional({ minimum: 2, maximum: 365 })
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(365)
  long_overdue_days?: number;
  @ApiPropertyOptional({ example: '08:00' })
  @IsOptional()
  @Matches(TIME, { message: 'opening_time must be HH:mm' })
  opening_time?: string;
  @ApiPropertyOptional({ example: '16:30' })
  @IsOptional()
  @Matches(TIME, { message: 'closing_time must be HH:mm' })
  closing_time?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isbn_lookup?: boolean;
}

export class CategoryDto {
  @ApiProperty({ example: 3 }) id: number;
  @ApiProperty({ example: 'Fiction' }) name: string;
  @ApiProperty({ example: 'FIC' }) code: string;
  @ApiProperty({ example: false, description: 'Reference books are read in the library and never issued' })
  is_reference: boolean;
  @ApiProperty({ nullable: true, type: String }) description: string | null;
  @ApiProperty({ example: 42 }) book_count: number;
  @ApiProperty({ example: 120 }) copy_count: number;
}

export class CategoryInputDto {
  @ApiProperty({ example: 'Fiction' }) @Transform(trim) @IsString() @Length(2, 60) name: string;
  @ApiProperty({ example: 'FIC' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z0-9-]{1,20}$/, { message: 'code must be 1 to 20 letters, digits or dashes' })
  code: string;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() is_reference?: boolean;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  description?: string | null;
}

export class CategoryUpdateDto extends PartialType(CategoryInputDto) {}

export class CopyCountsDto {
  @ApiProperty({ example: 5 }) total: number;
  @ApiProperty({ example: 3 }) available: number;
  @ApiProperty({ example: 2 }) issued: number;
  @ApiProperty({ example: 0 }) lost: number;
  @ApiProperty({ example: 0 }) damaged: number;
  @ApiProperty({ example: 0 }) in_repair: number;
  @ApiProperty({ example: 0 }) withdrawn: number;
}

export class BookDto {
  @ApiProperty({ example: 12 }) id: number;
  @ApiProperty({ example: 'Wings of Fire' }) title: string;
  @ApiProperty({ nullable: true, type: String, example: 'An Autobiography' }) subtitle: string | null;
  @ApiProperty({ nullable: true, type: String, example: '9788173711466' }) isbn: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'A. P. J. Abdul Kalam, Arun Tiwari' }) authors: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'Universities Press' }) publisher: string | null;
  @ApiProperty({ nullable: true, type: String }) edition: string | null;
  @ApiProperty({ nullable: true, type: Number, example: 1999 }) published_year: number | null;
  @ApiProperty({ example: 'English' }) language: string;
  @ApiProperty({ nullable: true, type: RefDto }) category: RefDto | null;
  @ApiProperty({ nullable: true, type: RefDto }) subject: RefDto | null;
  @ApiProperty({ nullable: true, type: Number }) pages: number | null;
  @ApiProperty({ nullable: true, type: String, example: 'R3' }) rack: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'S2' }) shelf: string | null;
  @ApiProperty({ nullable: true, type: Number, example: 250 }) price: number | null;
  @ApiProperty({ nullable: true, type: Number }) cover_file_id: number | null;
  @ApiProperty({ nullable: true, type: String }) cover_url: string | null;
  @ApiProperty({ nullable: true, type: String }) description: string | null;
  @ApiProperty({ nullable: true, type: String }) keywords: string | null;
  @ApiProperty({ example: true }) is_active: boolean;
  @ApiProperty({ example: false }) is_reference: boolean;
  @ApiProperty({ type: CopyCountsDto }) copies: CopyCountsDto;
  @ApiProperty() created_at: Date;
}

export const BOOK_AVAILABILITY = ['available', 'none_available'] as const;

export class BookQueryDto extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() category_id?: number;
  @ApiPropertyOptional({ example: 'Tamil' }) @IsOptional() @IsString() @MaxLength(30) language?: string;
  @ApiPropertyOptional({ enum: BOOK_AVAILABILITY })
  @IsOptional()
  @IsIn(BOOK_AVAILABILITY)
  availability?: (typeof BOOK_AVAILABILITY)[number];
  @ApiPropertyOptional() @IsOptional() @Transform(toBoolean) @IsBoolean() is_active?: boolean;
}

export class BookInsightsDto {
  @ApiProperty({ example: 320 }) titles: number;
  @ApiProperty({ example: 980 }) copies: number;
  @ApiProperty({ example: 760 }) available: number;
  @ApiProperty({ example: 190 }) issued: number;
  @ApiProperty({ example: 14 }) overdue: number;
  @ApiProperty({ example: 6 }) lost: number;
  @ApiProperty({ example: 10 }) damaged: number;
  @ApiProperty({ example: 25 }) added_this_month: number;
}

export class CopyInputDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 200,
    description: 'How many copies; defaults to the barcodes given or 1',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  count?: number;

  @ApiPropertyOptional({
    type: [String],
    description: 'Barcodes already on the books (scanned). Copies without one get their accession number as barcode.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsString({ each: true })
  @Length(3, 60, { each: true })
  barcodes?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Accession numbers from an existing register' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsString({ each: true })
  @Length(1, 30, { each: true })
  accession_nos?: string[];

  @ApiPropertyOptional({ enum: COPY_CONDITIONS, default: 'new' })
  @IsOptional()
  @IsIn(COPY_CONDITIONS)
  condition?: CopyCondition;

  @ApiPropertyOptional({ enum: COPY_SOURCES, default: 'purchase' })
  @IsOptional()
  @IsIn(COPY_SOURCES)
  source?: CopySource;

  @ApiPropertyOptional({ nullable: true, type: String, example: 'Higginbothams' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(120)
  vendor?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(40)
  bill_no?: string | null;

  @IsDateOnly('2026-06-10', true)
  acquired_on?: string;

  @ApiPropertyOptional({ nullable: true, type: Number, description: 'Defaults to the book price' })
  @IsOptional()
  @ValidateIf(notNull)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price?: number | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  notes?: string | null;
}

export class BookInputDto {
  @ApiProperty({ example: 'Wings of Fire' }) @Transform(trim) @IsString() @Length(1, 200) title: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(200)
  subtitle?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, example: '9788173711466', description: 'ISBN-10 or ISBN-13' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @Length(10, 17)
  isbn?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(200)
  authors?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(120)
  publisher?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(40)
  edition?: string | null;

  @ApiPropertyOptional({ nullable: true, type: Number, example: 1999 })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1400)
  @Max(2100)
  published_year?: number | null;

  @ApiPropertyOptional({ example: 'English', default: 'English' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 30)
  language?: string;

  @ApiPropertyOptional({ nullable: true, type: Number }) @IsOptional() @ValidateIf(notNull) @IsInt() category_id?:
    number | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) @IsOptional() @ValidateIf(notNull) @IsInt() subject_id?:
    number | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1)
  @Max(20000)
  pages?: number | null;

  @ApiPropertyOptional({ nullable: true, type: String, example: 'R3' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(20)
  rack?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, example: 'S2' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(20)
  shelf?: string | null;

  @ApiPropertyOptional({ nullable: true, type: Number, example: 250 })
  @IsOptional()
  @ValidateIf(notNull)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000000)
  price?: number | null;

  @ApiPropertyOptional({ nullable: true, type: Number, description: 'A file uploaded through POST /files' })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  cover_file_id?: number | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, example: 'biography, science, India' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(200)
  keywords?: string | null;
}

export class BookCreateDto extends BookInputDto {
  @ApiPropertyOptional({ type: CopyInputDto, description: 'Copies to add with the book (count, scanned barcodes…)' })
  @IsOptional()
  @Type(() => CopyInputDto)
  copies?: CopyInputDto;
}

export class BookUpdateDto extends PartialType(BookInputDto) {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_active?: boolean;
}

export class BookSuggestionDto {
  @ApiProperty({ example: 'Wings of Fire' }) title: string;
  @ApiProperty({ nullable: true, type: String }) subtitle: string | null;
  @ApiProperty({ nullable: true, type: String }) authors: string | null;
  @ApiProperty({ nullable: true, type: String }) publisher: string | null;
  @ApiProperty({ nullable: true, type: Number }) published_year: number | null;
  @ApiProperty({ nullable: true, type: Number }) pages: number | null;
  @ApiProperty({ nullable: true, type: String }) description: string | null;
}

export class IsbnLookupDto {
  @ApiProperty({ example: '9788173711466', description: 'The ISBN as ISBN-13' }) isbn: string;
  @ApiProperty({ nullable: true, type: BookDto, description: 'The title already in this library' })
  book: BookDto | null;
  @ApiProperty({ nullable: true, type: BookSuggestionDto, description: 'Details from the online lookup' })
  suggestion: BookSuggestionDto | null;
}

export class MemberRefDto {
  @ApiProperty({ example: 7 }) id: number;
  @ApiProperty({ enum: ['student', 'staff'] }) member_type: 'student' | 'staff';
  @ApiProperty({ example: 'TZMS-LS-00007' }) card_no: string;
  @ApiProperty({ example: 'Kavin Narayanan' }) name: string;
  @ApiProperty({
    nullable: true,
    type: String,
    example: '6 - A',
    description: 'Class for students, designation for staff',
  })
  detail: string | null;
  @ApiProperty({ nullable: true, type: Number }) student_id: number | null;
  @ApiProperty({ nullable: true, type: Number }) user_id: number | null;
  @ApiProperty({ nullable: true, type: String }) photo_url: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    example: '9000000005',
    description: 'Who to call: the first parent for a student, the staff member’s own mobile',
  })
  phone: string | null;
}

export class CopyLoanDto {
  @ApiProperty({ example: 41 }) issue_id: number;
  @ApiProperty({ type: MemberRefDto }) member: MemberRefDto;
  @ApiProperty({ example: '2026-11-30' }) due_date: string;
  @ApiProperty({ enum: LOAN_STATES }) state: LoanState;
  @ApiProperty({ example: 0 }) days_overdue: number;
  @ApiProperty({ example: 0, description: 'Late fine if returned today' }) running_fine: number;
}

export class CopyBookDto {
  @ApiProperty({ example: 12 }) id: number;
  @ApiProperty({ example: 'Wings of Fire' }) title: string;
  @ApiProperty({ nullable: true, type: String }) authors: string | null;
  @ApiProperty({ nullable: true, type: String }) isbn: string | null;
  @ApiProperty({ nullable: true, type: RefDto }) category: RefDto | null;
  @ApiProperty({ example: false }) is_reference: boolean;
  @ApiProperty({ nullable: true, type: String }) cover_url: string | null;
}

export class CopyDto {
  @ApiProperty({ example: 88 }) id: number;
  @ApiProperty({ example: 12 }) book_id: number;
  @ApiProperty({ type: CopyBookDto }) book: CopyBookDto;
  @ApiProperty({ example: 'TZMS-000088' }) accession_no: string;
  @ApiProperty({ example: 'TZMS-000088' }) barcode: string;
  @ApiProperty({ enum: COPY_STATUSES }) status: CopyStatus;
  @ApiProperty({ enum: COPY_CONDITIONS }) condition: CopyCondition;
  @ApiProperty({ enum: COPY_SOURCES }) source: CopySource;
  @ApiProperty({ nullable: true, type: String }) vendor: string | null;
  @ApiProperty({ nullable: true, type: String }) bill_no: string | null;
  @ApiProperty({ nullable: true, type: String }) acquired_on: string | null;
  @ApiProperty({ nullable: true, type: Number }) price: number | null;
  @ApiProperty({ nullable: true, type: String }) notes: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'R3 / S2' }) location: string | null;
  @ApiProperty({ nullable: true, type: CopyLoanDto, description: 'Who has it now' }) current_loan: CopyLoanDto | null;
  @ApiProperty() created_at: Date;
}

export class CopyQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: COPY_STATUSES }) @IsOptional() @IsIn(COPY_STATUSES) status?: CopyStatus;
  @ApiPropertyOptional({ enum: COPY_CONDITIONS }) @IsOptional() @IsIn(COPY_CONDITIONS) condition?: CopyCondition;
  @ApiPropertyOptional() @IsOptional() @IsInt() book_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() category_id?: number;
}

export const EDITABLE_COPY_STATUSES = ['available', 'damaged', 'in_repair', 'withdrawn'] as const;

export class CopyUpdateDto {
  @ApiPropertyOptional({ example: '8901234567890' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(3, 60)
  barcode?: string;

  @ApiPropertyOptional({
    enum: EDITABLE_COPY_STATUSES,
    description: 'Issued and lost change through the issue desk; this sets shelf states',
  })
  @IsOptional()
  @IsIn(EDITABLE_COPY_STATUSES)
  status?: (typeof EDITABLE_COPY_STATUSES)[number];

  @ApiPropertyOptional({ enum: COPY_CONDITIONS }) @IsOptional() @IsIn(COPY_CONDITIONS) condition?: CopyCondition;
  @ApiPropertyOptional({ enum: COPY_SOURCES }) @IsOptional() @IsIn(COPY_SOURCES) source?: CopySource;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(120)
  vendor?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(40)
  bill_no?: string | null;

  @IsDateOnly('2026-06-10', true)
  acquired_on?: string;

  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @ValidateIf(notNull)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price?: number | null;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'Why the status changed' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(255)
  notes?: string | null;
}

export class CopyLookupQueryDto {
  @ApiProperty({ example: 'TZMS-000088', description: 'Barcode or accession number' })
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  code: string;
}

export class CopyEventDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'issued' }) kind: string;
  @ApiProperty({ nullable: true, type: String }) note: string | null;
  @ApiProperty({ nullable: true, type: Number }) issue_id: number | null;
  @ApiProperty({ nullable: true, type: MemberRefDto }) member: MemberRefDto | null;
  @ApiProperty({ nullable: true, type: String, example: 'Librarian' }) actor: string | null;
  @ApiProperty() created_at: Date;
}

export class LabelsQueryDto {
  @ApiPropertyOptional({ example: '88,89,90', description: 'Copy ids, comma separated' })
  @IsOptional()
  @Transform(idList)
  @IsArray()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  copy_ids?: number[];

  @ApiPropertyOptional({ description: 'All copies of one book' }) @IsOptional() @IsInt() book_id?: number;

  @ApiPropertyOptional({ description: 'Copies added on or after this date' })
  @IsDateOnly('2026-11-01', true)
  added_from?: string;
}

export const IMPORT_MODES = ['validate', 'import'] as const;

export class BookImportOptionsDto {
  @ApiPropertyOptional({ enum: IMPORT_MODES, default: 'validate' })
  @IsOptional()
  @IsIn(IMPORT_MODES)
  mode?: (typeof IMPORT_MODES)[number];
}

export const BOOK_IMPORT_UPLOAD_SCHEMA = {
  type: 'object',
  required: ['file'],
  properties: {
    file: {
      type: 'string',
      format: 'binary',
      description: 'The Excel template (.xlsx) or a CSV with the same columns',
    },
    mode: { type: 'string', enum: [...IMPORT_MODES], default: 'validate' },
  },
};

export class BookImportRowDto {
  @ApiProperty({ example: 2 }) row: number;
  @ApiProperty({ enum: ['ok', 'error'] }) status: 'ok' | 'error';
  @ApiProperty({ nullable: true, type: String }) title: string | null;
  @ApiProperty({ nullable: true, type: String }) isbn: string | null;
  @ApiProperty({ example: 3 }) copies: number;
  @ApiProperty({ enum: ['new_book', 'add_copies'], nullable: true }) action: 'new_book' | 'add_copies' | null;
  @ApiProperty({ nullable: true, type: String }) message: string | null;
  @ApiProperty({ nullable: true, type: Number }) book_id: number | null;
}

export class BookImportReportDto {
  @ApiProperty({ enum: IMPORT_MODES }) mode: 'validate' | 'import';
  @ApiProperty({ example: 40 }) total_rows: number;
  @ApiProperty({ example: 38 }) ok_rows: number;
  @ApiProperty({ example: 2 }) error_rows: number;
  @ApiProperty({ example: 30 }) books_created: number;
  @ApiProperty({ example: 95 }) copies_added: number;
  @ApiProperty({ example: 2 }) categories_created: number;
  @ApiProperty({ type: [BookImportRowDto] }) rows: BookImportRowDto[];
}
