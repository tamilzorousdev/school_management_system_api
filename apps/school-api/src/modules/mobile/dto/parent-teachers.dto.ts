import { ApiProperty } from '@nestjs/swagger';
import { IsDateOnly } from '../../../shared/dates';

export class ChildTeacherDto {
  @ApiProperty({ example: 9, description: 'Teacher user id: use it for the profile, chat and meetings' })
  id: number;

  @ApiProperty({ example: 'Priya Venkatesh' })
  name: string;

  @ApiProperty({ example: true, description: 'Class teacher of this child' })
  is_class_teacher: boolean;

  @ApiProperty({ example: ['Mathematics'], type: String, isArray: true, description: 'What they teach this child' })
  subjects: string[];

  @ApiProperty({
    example: false,
    description: 'This teacher is the signed-in parent. Hide for meetings (400 SAME_PERSON); chat is allowed.',
  })
  is_me: boolean;

  @ApiProperty({ example: 'PG Assistant', nullable: true, type: String })
  designation: string | null;

  @ApiProperty({ example: 'Mathematics', nullable: true, type: String })
  department: string | null;

  @ApiProperty({ example: 8, description: 'Years of teaching: before joining plus years at this school' })
  experience_years: number;

  @ApiProperty({ nullable: true, type: String, description: 'Signed photo link, or null' })
  photo_url: string | null;
}

export class TeacherQualificationDto {
  @ApiProperty({ example: 'M.Sc.' })
  degree: string;

  @ApiProperty({ example: 'Mathematics', nullable: true, type: String })
  specialization: string | null;

  @ApiProperty({ example: 'Madras University', nullable: true, type: String })
  institution: string | null;

  @ApiProperty({ example: 2012, nullable: true, type: Number })
  year_completed: number | null;
}

export class TeacherClassDto {
  @ApiProperty({ example: 12 })
  section_id: number;

  @ApiProperty({ example: '6 - A' })
  class_section: string;

  @ApiProperty({ example: ['Mathematics'], type: String, isArray: true })
  subjects: string[];

  @ApiProperty({ example: false })
  is_class_teacher: boolean;
}

export class ChildTeacherProfileDto extends ChildTeacherDto {
  @ApiProperty({ example: 2023, nullable: true, type: Number, description: 'Year they joined this school' })
  joined_year: number | null;

  @ApiProperty({ type: [TeacherQualificationDto] })
  qualifications: TeacherQualificationDto[];

  @ApiProperty({ type: [TeacherClassDto], description: 'Every class they handle this year' })
  classes: TeacherClassDto[];

  @ApiProperty({ example: 24, description: 'Periods a week they teach' })
  periods_per_week: number;
}

export class ChildTimetableQueryDto {
  @IsDateOnly('2026-11-11', true)
  date?: string;
}

export class PeriodTeacherDto {
  @ApiProperty({ example: 9 })
  id: number;

  @ApiProperty({ example: 'Priya Venkatesh' })
  name: string;

  @ApiProperty({ nullable: true, type: String })
  photo_url: string | null;
}

export class ChildPeriodDto {
  @ApiProperty({ example: 3, nullable: true, type: Number, description: 'null for a break' })
  period_no: number | null;

  @ApiProperty({ example: 'Period 3' })
  name: string;

  @ApiProperty({ example: '10:35' })
  start_time: string;

  @ApiProperty({ example: '11:20' })
  end_time: string;

  @ApiProperty({ example: false })
  is_break: boolean;

  @ApiProperty({ enum: ['done', 'now', 'next', 'later'], example: 'next', description: 'Only for today' })
  state: 'done' | 'now' | 'next' | 'later';

  @ApiProperty({ example: { id: 4, name: 'Mathematics', code: 'MATH' }, nullable: true })
  subject: { id: number; name: string; code: string } | null;

  @ApiProperty({
    type: PeriodTeacherDto,
    nullable: true,
    description: 'Who takes the class (the proxy if one is assigned)',
  })
  teacher: PeriodTeacherDto | null;

  @ApiProperty({
    type: PeriodTeacherDto,
    nullable: true,
    description: 'The usual teacher when a proxy takes the class today',
  })
  usual_teacher: PeriodTeacherDto | null;

  @ApiProperty({ example: null, nullable: true, type: String, description: 'For example "Combined with 6 - B"' })
  note: string | null;

  @ApiProperty({ example: 'Room 1', nullable: true, type: String })
  room: string | null;
}

export class ChildTimetableDto {
  @ApiProperty({ example: '2026-11-11' })
  date: string;

  @ApiProperty({ example: 'Wednesday' })
  day: string;

  @ApiProperty({ example: '6 - A', nullable: true, type: String })
  class_section: string | null;

  @ApiProperty({ example: true })
  working_day: boolean;

  @ApiProperty({ example: null, nullable: true, type: String })
  holiday: string | null;

  @ApiProperty({ type: [ChildPeriodDto], description: 'Bell order, breaks included; empty on Sundays and holidays' })
  periods: ChildPeriodDto[];
}

export class ChildTeachersOverviewDto {
  @ApiProperty({
    type: ChildTeacherDto,
    nullable: true,
    description: 'The class teacher, shown on its own; subjects lists what they teach this child (can be empty)',
  })
  class_teacher: ChildTeacherDto | null;

  @ApiProperty({
    type: [ChildTeacherDto],
    description: 'Subject teachers of this child, without the class teacher, by name',
  })
  subject_teachers: ChildTeacherDto[];
}
