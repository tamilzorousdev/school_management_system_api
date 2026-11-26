import { ApiProperty } from '@nestjs/swagger';

export const TEACHER_TODAY = ['present', 'late', 'on_leave', 'not_checked_in'] as const;
export type TeacherToday = (typeof TEACHER_TODAY)[number];

export class TeachersTodayDto {
  @ApiProperty({ example: 24, description: 'Teachers who teach or are class teacher in my wings' })
  total: number;

  @ApiProperty({ example: 18, description: 'Checked in on time' })
  present: number;

  @ApiProperty({ example: 2, description: 'Checked in late' })
  late: number;

  @ApiProperty({ example: 1, description: 'On approved leave today' })
  on_leave: number;

  @ApiProperty({ example: 3, description: 'Not checked in and not on leave' })
  not_checked_in: number;
}

export class TeacherRatingDto {
  @ApiProperty({ example: 4.2, nullable: true, type: Number })
  average: number | null;

  @ApiProperty({ example: 36 })
  count: number;
}

export class TeacherCardDto {
  @ApiProperty({ example: 229 })
  user_id: number;

  @ApiProperty({ example: 'Venkatesh' })
  name: string;

  @ApiProperty({ nullable: true, type: String })
  photo_url: string | null;

  @ApiProperty({ example: 'PG Assistant', nullable: true, type: String })
  designation: string | null;

  @ApiProperty({ example: '9566331808', nullable: true, type: String })
  mobile: string | null;

  @ApiProperty({ example: ['English', 'Mathematics'] })
  subjects: string[];

  @ApiProperty({ example: ['3 - A', '4 - B'], description: 'Sections taught in my wings' })
  sections: string[];

  @ApiProperty({ example: ['3 - A'] })
  class_teacher_of: string[];

  @ApiProperty({ enum: TEACHER_TODAY, example: 'present' })
  today: TeacherToday;

  @ApiProperty({ example: '2026-11-23T08:41:00.000+05:30', nullable: true, type: Date })
  check_in_at: Date | null;

  @ApiProperty({
    example: 92.5,
    nullable: true,
    type: Number,
    description: 'Pass % of my papers in the latest published exam',
  })
  pass_percent: number | null;

  @ApiProperty({ type: TeacherRatingDto })
  rating: TeacherRatingDto;
}

export class OfficeTeachersDto {
  @ApiProperty({ type: TeachersTodayDto })
  today: TeachersTodayDto;

  @ApiProperty({ type: [TeacherCardDto] })
  teachers: TeacherCardDto[];
}

export class TeacherPaperDto {
  @ApiProperty({ example: '3 - A' })
  class_section: string;

  @ApiProperty({ example: 'English' })
  subject: string;

  @ApiProperty({ example: 'Half-yearly exam' })
  exam: string;

  @ApiProperty({ example: 13 })
  students: number;

  @ApiProperty({ example: 12 })
  passed: number;

  @ApiProperty({ example: 92.3, nullable: true, type: Number })
  pass_percent: number | null;

  @ApiProperty({ example: 78.4, nullable: true, type: Number, description: 'Average marks %' })
  average_percent: number | null;
}

export class RatingRemarkDto {
  @ApiProperty({ example: 4 })
  stars: number;

  @ApiProperty({ example: 'Explains very clearly', nullable: true, type: String })
  remark: string | null;

  @ApiProperty({ example: '3 - A', nullable: true, type: String })
  class_section: string | null;

  @ApiProperty({ example: '2026-11-10T10:00:00.000+05:30' })
  created_at: Date;
}

export class TeacherRatingDetailDto extends TeacherRatingDto {
  @ApiProperty({ example: { '1': 0, '2': 1, '3': 5, '4': 14, '5': 16 } })
  stars: Record<string, number>;

  @ApiProperty({ type: [RatingRemarkDto], description: 'Latest 5 written remarks (parent names not shown)' })
  recent: RatingRemarkDto[];
}

export class TeacherMonthDto {
  @ApiProperty({ example: 16 })
  present_days: number;

  @ApiProperty({ example: 2 })
  late_days: number;

  @ApiProperty({ example: 1 })
  leave_days: number;
}

export class TeacherDetailDto {
  @ApiProperty({ type: TeacherCardDto })
  teacher: TeacherCardDto;

  @ApiProperty({
    type: [TeacherPaperDto],
    description: 'My papers in my wings in the latest published exam of each class',
  })
  papers: TeacherPaperDto[];

  @ApiProperty({ type: TeacherRatingDetailDto })
  rating: TeacherRatingDetailDto;

  @ApiProperty({ type: TeacherMonthDto, description: 'This month' })
  month: TeacherMonthDto;
}

export class SectionSubjectDto {
  @ApiProperty({ example: 'Mathematics' })
  subject: string;

  @ApiProperty({ example: 6, nullable: true, type: Number })
  periods_per_week: number | null;

  @ApiProperty({ example: 'Half-yearly exam', nullable: true, type: String })
  exam: string | null;

  @ApiProperty({ example: 13 })
  students: number;

  @ApiProperty({ example: 12 })
  passed: number;

  @ApiProperty({ example: 92.3, nullable: true, type: Number, description: 'Pass % in this section, latest exam' })
  pass_percent: number | null;

  @ApiProperty({ example: 78.4, nullable: true, type: Number })
  average_percent: number | null;
}

export class SectionTeacherDto {
  @ApiProperty({ type: TeacherCardDto })
  teacher: TeacherCardDto;

  @ApiProperty({ example: true })
  is_class_teacher: boolean;

  @ApiProperty({ type: [SectionSubjectDto], description: 'Subjects this teacher takes in this section' })
  subjects: SectionSubjectDto[];
}

export class SectionTeachersDto {
  @ApiProperty({ example: 21 })
  section_id: number;

  @ApiProperty({ example: '6 - A' })
  class_section: string;

  @ApiProperty({ type: [SectionTeacherDto], description: 'Class teacher first, then by subject' })
  teachers: SectionTeacherDto[];
}
