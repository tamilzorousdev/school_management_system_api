import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';
import { ResultStatus } from '../exam-results';

export class SectionReportCardQueryDto {
  @ApiPropertyOptional({ example: 2, description: 'Only the exams of this term' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  term_id?: number;

  @ApiPropertyOptional({ example: 5, description: 'Only this exam (wins over term_id)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  exam_id?: number;
}

export class ReportCardQueryDto extends SectionReportCardQueryDto {
  @ApiPropertyOptional({ example: 1, description: "Default: the student's current academic year" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  academic_year_id?: number;
}

export class ReportCardOptionDto {
  @ApiProperty({ example: 2 })
  id: number;

  @ApiProperty({ example: 'Term 1' })
  name: string;
}

export class ReportCardExamOptionDto extends ReportCardOptionDto {
  @ApiProperty({ example: 2, nullable: true, type: Number })
  term_id: number | null;
}

export class ReportCardOptionsDto {
  @ApiProperty({ type: [ReportCardOptionDto], description: 'Years in which the student wrote a published exam' })
  academic_years: ReportCardOptionDto[];

  @ApiProperty({ type: [ReportCardOptionDto] })
  terms: ReportCardOptionDto[];

  @ApiProperty({ type: [ReportCardExamOptionDto] })
  exams: ReportCardExamOptionDto[];
}

export class ReportCardSchoolDto {
  @ApiProperty({ example: 'Tamilzorous Model School' })
  name: string;

  @ApiProperty({ example: '12, Avinashi Road, Coimbatore, Tamil Nadu 641018', nullable: true, type: String })
  address: string | null;

  @ApiProperty({ example: '0422 2345678', nullable: true, type: String })
  phone: string | null;

  @ApiProperty({ example: 'office@tzschool.in', nullable: true, type: String })
  email: string | null;

  @ApiProperty({ example: 'CBSE', nullable: true, type: String })
  board: string | null;

  @ApiProperty({ example: '/api/v1/files/3/content?expires=…&signature=…', nullable: true, type: String })
  logo_url: string | null;

  @ApiPropertyOptional({ example: 'Meenakshi Sundaram', nullable: true, type: String })
  principal_name?: string | null;

  @ApiPropertyOptional({ example: '/api/v1/files/4/content?expires=…&signature=…', nullable: true, type: String })
  signature_url?: string | null;

  @ApiPropertyOptional({
    example: '/api/v1/files/5/content?expires=…&signature=…',
    nullable: true,
    type: String,
    description: 'School seal, uploaded in School setup',
  })
  seal_url?: string | null;
}

export class ReportCardStudentDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 'Kavin Narayanan' })
  full_name: string;

  @ApiProperty({ example: 'TZMS-2026-0012' })
  admission_no: string;

  @ApiProperty({ example: '6' })
  class_name: string;

  @ApiProperty({ example: 'A' })
  section_name: string;

  @ApiProperty({ example: 12, nullable: true, type: Number })
  roll_no: number | null;

  @ApiProperty({ example: '2014-06-12' })
  dob: string;

  @ApiProperty({ example: 'Narayanan K', nullable: true, type: String })
  parent_name: string | null;

  @ApiProperty({ example: 'Priya S', nullable: true, type: String })
  class_teacher: string | null;

  @ApiProperty({ example: '/api/v1/files/9/content?expires=…&signature=…', nullable: true, type: String })
  photo_url: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  class_teacher_signature_url?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  parent_signature_url?: string | null;

  @ApiPropertyOptional({ example: false })
  parent_signed?: boolean;

  @ApiPropertyOptional({ nullable: true, type: Date })
  parent_signed_at?: Date | null;

  @ApiPropertyOptional({ example: false })
  teacher_signed?: boolean;

  @ApiPropertyOptional({ nullable: true, type: Date })
  teacher_signed_at?: Date | null;
}

export class ReportCardScopeDto {
  @ApiProperty({ enum: ['year', 'term', 'exam'], example: 'year' })
  kind: 'year' | 'term' | 'exam';

  @ApiProperty({ example: 'Annual report card' })
  title: string;

  @ApiProperty({ type: ReportCardOptionDto })
  academic_year: ReportCardOptionDto;

  @ApiProperty({ type: ReportCardOptionDto, nullable: true })
  term: ReportCardOptionDto | null;

  @ApiProperty({ type: ReportCardOptionDto, nullable: true })
  exam: ReportCardOptionDto | null;

  @ApiProperty({ example: '2026-06-01' })
  from: string;

  @ApiProperty({ example: '2027-03-31' })
  to: string;
}

export class ReportCardTermDto {
  @ApiProperty({ example: 1, nullable: true, type: Number })
  term_id: number | null;

  @ApiProperty({ example: 'Term 1' })
  name: string;

  @ApiProperty({ example: [3, 4], type: [Number], description: 'Exam ids of this term, in column order' })
  exam_ids: number[];
}

export class ReportCardColumnDto {
  @ApiProperty({ example: 3 })
  exam_id: number;

  @ApiProperty({ example: 'Quarterly exam' })
  name: string;

  @ApiProperty({ example: '2026-09-14' })
  start_date: string;

  @ApiProperty({ example: '2026-09-24' })
  end_date: string;

  @ApiProperty({ example: 100, nullable: true, type: Number, description: 'Max marks when every paper has the same' })
  common_max: number | null;

  @ApiProperty({ example: 452 })
  total: number;

  @ApiProperty({ example: 500 })
  max_total: number;

  @ApiProperty({ example: 90.4, nullable: true, type: Number })
  percent: number | null;

  @ApiProperty({ example: 'A2', nullable: true, type: String })
  grade: string | null;

  @ApiProperty({ enum: ['pass', 'fail', 'incomplete'], example: 'pass' })
  result: ResultStatus;

  @ApiProperty({ example: 1, nullable: true, type: Number })
  section_rank: number | null;

  @ApiProperty({ example: 32 })
  section_size: number;

  @ApiProperty({ example: 2, nullable: true, type: Number })
  class_rank: number | null;

  @ApiProperty({ example: 64 })
  class_size: number;
}

export class ReportCardCellDto {
  @ApiProperty({ example: 3 })
  exam_id: number;

  @ApiProperty({ example: 88, nullable: true, type: Number })
  marks: number | null;

  @ApiProperty({ example: 100 })
  max_marks: number;

  @ApiProperty({ example: 35 })
  pass_marks: number;

  @ApiProperty({ example: false })
  is_absent: boolean;

  @ApiProperty({ example: true, nullable: true, type: Boolean, description: 'null = marks not entered' })
  passed: boolean | null;
}

export class ReportCardSubjectDto {
  @ApiProperty({ example: 4 })
  subject_id: number;

  @ApiProperty({ example: 'Mathematics' })
  name: string;

  @ApiProperty({ example: 'MATH' })
  code: string;

  @ApiProperty({
    type: [ReportCardCellDto],
    nullable: true,
    description: 'One cell per column in the same order; null when the subject was not in that exam',
  })
  cells: (ReportCardCellDto | null)[];

  @ApiProperty({ example: 176 })
  total: number;

  @ApiProperty({ example: 200 })
  max_total: number;

  @ApiProperty({ example: 88, nullable: true, type: Number })
  percent: number | null;

  @ApiProperty({ example: 'A2', nullable: true, type: String })
  grade: string | null;

  @ApiProperty({
    example: true,
    nullable: true,
    type: Boolean,
    description: 'Total reaches the sum of the pass marks; null = no marks yet',
  })
  passed: boolean | null;
}

export class ReportCardOverallDto {
  @ApiProperty({ example: 904 })
  total: number;

  @ApiProperty({ example: 1000 })
  max_total: number;

  @ApiProperty({ example: 90.4, nullable: true, type: Number })
  percent: number | null;

  @ApiProperty({ example: 'A2', nullable: true, type: String })
  grade: string | null;

  @ApiProperty({ enum: ['pass', 'fail', 'incomplete'], example: 'pass' })
  result: ResultStatus;
}

export class ReportCardAttendanceDto {
  @ApiProperty({ example: 118 })
  working_days: number;

  @ApiProperty({ example: 112.5 })
  present_days: number;

  @ApiProperty({ example: 95.3, nullable: true, type: Number })
  percent: number | null;
}

export class GradeStepDto {
  @ApiProperty({ example: 'A1' })
  grade: string;

  @ApiProperty({ example: 91 })
  min: number;

  @ApiProperty({ example: 100 })
  max: number;
}

export class ReportCardDto {
  @ApiProperty({ type: ReportCardSchoolDto })
  school: ReportCardSchoolDto;

  @ApiProperty({ type: ReportCardStudentDto })
  student: ReportCardStudentDto;

  @ApiProperty({ type: ReportCardScopeDto })
  scope: ReportCardScopeDto;

  @ApiProperty({ type: [ReportCardTermDto] })
  terms: ReportCardTermDto[];

  @ApiProperty({ type: [ReportCardColumnDto] })
  columns: ReportCardColumnDto[];

  @ApiProperty({ type: [ReportCardSubjectDto] })
  subjects: ReportCardSubjectDto[];

  @ApiProperty({ type: ReportCardOverallDto })
  overall: ReportCardOverallDto;

  @ApiProperty({ type: ReportCardAttendanceDto })
  attendance: ReportCardAttendanceDto;

  @ApiProperty({ example: 'Excellent work, consistent across subjects.' })
  remarks: string;

  @ApiProperty({ type: [GradeStepDto] })
  grade_scale: GradeStepDto[];

  @ApiProperty({ type: ReportCardOptionsDto, description: 'Choices for the year, term and exam pickers' })
  options: ReportCardOptionsDto;

  @ApiProperty({ example: '/api/v1/admin/students/12/report-card/pdf?term_id=1' })
  pdf_path: string;

  @ApiProperty({ example: '2026-11-05T10:30:00.000+05:30' })
  generated_at: Date;
}

export class UpdateSignatureDto {
  @ApiPropertyOptional({ example: 140, nullable: true, type: Number })
  @IsOptional()
  @IsInt()
  signature_file_id?: number | null;
}

export class SignatureResponseDto {
  @ApiProperty({ example: 140, nullable: true, type: Number })
  signature_file_id: number | null;

  @ApiProperty({ example: 'https://...', nullable: true, type: String })
  signature_url: string | null;
}

export class SignReportCardDto {
  @ApiPropertyOptional({ example: 1, nullable: true, type: Number })
  @IsOptional()
  @IsInt()
  academic_year_id?: number;

  @ApiPropertyOptional({ example: 2, nullable: true, type: Number })
  @IsOptional()
  @IsInt()
  term_id?: number;

  @ApiPropertyOptional({ example: 5, nullable: true, type: Number })
  @IsOptional()
  @IsInt()
  exam_id?: number;
}

export class SectionSignaturesSummaryDto {
  @ApiProperty({ example: 32 })
  total: number;

  @ApiProperty({ example: 32 })
  teacher_signed: number;

  @ApiProperty({ example: 28 })
  parent_signed: number;

  @ApiProperty({ example: 4 })
  parent_pending: number;
}

export class SectionStudentSignatureItemDto {
  @ApiProperty({ example: 12 })
  student_id: number;

  @ApiProperty({ example: 'TZMS-2026-0012' })
  admission_no: string;

  @ApiProperty({ example: 'Kavin Narayanan' })
  full_name: string;

  @ApiProperty({ example: 12, nullable: true, type: Number })
  roll_no: number | null;

  @ApiProperty({ nullable: true, type: String })
  photo_url: string | null;

  @ApiProperty({ example: 'Narayanan K', nullable: true, type: String })
  parent_name: string | null;

  @ApiProperty({ example: '9000000005', nullable: true, type: String })
  parent_mobile: string | null;

  @ApiProperty({ example: true })
  teacher_signed: boolean;

  @ApiProperty({ nullable: true, type: Date })
  teacher_signed_at: Date | null;

  @ApiProperty({ example: false })
  parent_signed: boolean;

  @ApiProperty({ nullable: true, type: Date })
  parent_signed_at: Date | null;

  @ApiProperty({ example: 'pending_parent' })
  status: 'signed' | 'pending_parent' | 'pending_teacher';
}

export class SectionSignaturesStatusDto {
  @ApiProperty({ type: SectionSignaturesSummaryDto })
  summary: SectionSignaturesSummaryDto;

  @ApiProperty({ type: [SectionStudentSignatureItemDto] })
  students: SectionStudentSignatureItemDto[];
}
