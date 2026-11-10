import { ApiProperty } from '@nestjs/swagger';
import { RecordCountsDto } from '../../student-records/dto/records.dto';
import { ParentChildDto } from '../../students/dto/student-response.dto';

export class ChildCardDto extends ParentChildDto {
  @ApiProperty({ nullable: true, type: String, description: 'Signed link, valid for an hour' })
  photo_url: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'B+' })
  blood_group: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'Blue' })
  house: string | null;

  @ApiProperty({ example: '2024-06-03' })
  admission_date: string;

  @ApiProperty({ nullable: true, type: String, example: '2026-27' })
  academic_year: string | null;

  @ApiProperty({ type: RecordCountsDto, description: 'Badges for the documents, health and behaviour tiles' })
  counts: RecordCountsDto;
}

export class TodayAttendanceDto {
  @ApiProperty({ example: '2026-11-05' })
  date: string;

  @ApiProperty({
    nullable: true,
    type: String,
    enum: ['present', 'absent', 'late', 'half_day', 'leave'],
    description: 'The day from both sessions (absent in one = half_day); null until attendance is marked',
  })
  status: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    enum: ['present', 'absent', 'late', 'half_day', 'leave'],
    example: 'present',
    description: 'Morning session (1st period)',
  })
  morning: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    enum: ['present', 'absent', 'late', 'half_day', 'leave'],
    example: null,
    description: 'Afternoon session (5th period); null until marked',
  })
  afternoon: string | null;
}
