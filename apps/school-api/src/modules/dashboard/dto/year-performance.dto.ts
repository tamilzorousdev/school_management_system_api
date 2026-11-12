import { ApiProperty } from '@nestjs/swagger';

export class PerformanceYearDto {
  @ApiProperty({ example: 2 })
  id: number;

  @ApiProperty({ example: '2026-27' })
  name: string;

  @ApiProperty({ example: '2026-06-01' })
  start_date: string;

  @ApiProperty({ example: '2027-04-30' })
  end_date: string;

  @ApiProperty({ example: true })
  is_current: boolean;
}

export class YearStudentsDto {
  @ApiProperty({ example: 412, description: 'Students enrolled in a class that year' })
  enrolled: number;

  @ApiProperty({ example: 380, description: 'Moved up to the next class at the end of the year' })
  promoted: number;

  @ApiProperty({ example: 6, description: 'Left the school that year' })
  left: number;
}

export class YearAttendanceDto {
  @ApiProperty({
    example: 93.4,
    nullable: true,
    type: Number,
    description: 'Student attendance %, half day counts half',
  })
  percent: number | null;

  @ApiProperty({ example: 182, description: 'Days with attendance marked' })
  days_marked: number;

  @ApiProperty({ example: 14, description: 'Students below 75% attendance that year' })
  below_75: number;

  @ApiProperty({ example: 96.1, nullable: true, type: Number, description: 'Staff attendance % that year' })
  staff_percent: number | null;
}

export class YearStudiesDto {
  @ApiProperty({ example: 4, description: 'Published exams with marks' })
  exams: number;

  @ApiProperty({ example: 405, description: 'Students with at least one published result' })
  students: number;

  @ApiProperty({
    example: 71.8,
    nullable: true,
    type: Number,
    description: 'Average result % across every published exam',
  })
  average_percent: number | null;

  @ApiProperty({
    example: 92.5,
    nullable: true,
    type: Number,
    description: 'Share of results with every subject passed',
  })
  pass_percent: number | null;

  @ApiProperty({
    example: 7.5,
    nullable: true,
    type: Number,
    description: 'Share of results with at least one subject failed or missed',
  })
  fail_percent: number | null;

  @ApiProperty({
    example: 2.1,
    nullable: true,
    type: Number,
    description: 'Share of exam papers the student was absent for',
  })
  absent_percent: number | null;
}

export class YearActivitiesDto {
  @ApiProperty({ example: 58, description: 'Achievements in sports, arts, academics and more' })
  total: number;

  @ApiProperty({ example: 31 })
  sports: number;

  @ApiProperty({ example: 22, description: 'Winner, runner-up or third place' })
  podium: number;

  @ApiProperty({ example: 40, description: 'Students with at least one achievement' })
  students: number;

  @ApiProperty({ example: 286 })
  points: number;

  @ApiProperty({ example: 'district', nullable: true, type: String, description: 'Highest level reached' })
  top_level: string | null;
}

export class YearFeeHeadDto {
  @ApiProperty({ example: 'Transport' })
  name: string;

  @ApiProperty({ example: true, description: 'Bus fee head' })
  is_transport: boolean;

  @ApiProperty({ example: 840000, description: 'Billed for this head after discounts' })
  billed: number;

  @ApiProperty({
    example: 790000,
    description: 'Collected for this head: each payment is shared across its invoice lines by amount',
  })
  collected: number;

  @ApiProperty({ example: 94, nullable: true, type: Number })
  collection_percent: number | null;
}

export class YearFeesDto {
  @ApiProperty({ example: 5240000 })
  billed: number;

  @ApiProperty({ example: 4980000 })
  collected: number;

  @ApiProperty({ example: 95, nullable: true, type: Number })
  collection_percent: number | null;

  @ApiProperty({
    type: [YearFeeHeadDto],
    description: 'Tuition, sports, transport and every other fee head, biggest first',
  })
  heads: YearFeeHeadDto[];
}

export class YearPerformanceDto {
  @ApiProperty({ type: PerformanceYearDto })
  academic_year: PerformanceYearDto;

  @ApiProperty({ type: YearStudentsDto, nullable: true, description: 'null without students.view' })
  students: YearStudentsDto | null;

  @ApiProperty({ type: YearAttendanceDto, nullable: true, description: 'null without attendance.view' })
  attendance: YearAttendanceDto | null;

  @ApiProperty({ type: YearStudiesDto, nullable: true, description: 'Exam results; null without exams.view' })
  studies: YearStudiesDto | null;

  @ApiProperty({
    type: YearActivitiesDto,
    nullable: true,
    description: 'Sports and activities; null without students.view',
  })
  activities: YearActivitiesDto | null;

  @ApiProperty({ type: YearFeesDto, nullable: true, description: 'null without fees.view' })
  fees: YearFeesDto | null;
}

export class YearPerformanceListDto {
  @ApiProperty({ type: [YearPerformanceDto], description: 'Newest year first, up to the current year' })
  years: YearPerformanceDto[];
}
