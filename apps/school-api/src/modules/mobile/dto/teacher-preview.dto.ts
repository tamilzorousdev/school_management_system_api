import { ApiProperty } from '@nestjs/swagger';
import { TeacherClassDto } from '../../staff/dto/staff-response.dto';
import { TodayTimetableDto } from './teacher-app.dto';

export class PreviewTeacherDto {
  @ApiProperty({ example: 14 })
  staff_id: number;

  @ApiProperty({ example: 52, description: 'The teacher login whose app is shown' })
  user_id: number;

  @ApiProperty({ example: 'Priya Natarajan' })
  name: string;

  @ApiProperty({ example: 'TGT Mathematics' })
  designation: string;

  @ApiProperty({ example: 'EMP-014' })
  employee_no: string;

  @ApiProperty({ example: true, description: 'false when the login is switched off; the app would not open' })
  can_sign_in: boolean;

  @ApiProperty({ example: 42, nullable: true, type: Number })
  photo_file_id: number | null;

  @ApiProperty({ nullable: true, type: String })
  photo_url: string | null;
}

export class TeacherPreviewCountsDto {
  @ApiProperty({ example: 2, description: 'Diary posts waiting for review' })
  diary_pending: number;

  @ApiProperty({ example: 3, description: 'Scheduled, in progress or over time' })
  meetings_upcoming: number;

  @ApiProperty({ example: 4, description: 'Unread parent messages across all threads' })
  chat_unread: number;

  @ApiProperty({ example: 1 })
  announcements_unread: number;
}

export class TeacherPreviewDto {
  @ApiProperty({ type: PreviewTeacherDto })
  teacher: PreviewTeacherDto;

  @ApiProperty({ type: TodayTimetableDto, description: 'Same as GET /mobile/teacher/timetable/today' })
  today: TodayTimetableDto;

  @ApiProperty({ type: TeacherClassDto, isArray: true, description: 'Same as GET /mobile/teacher/classes' })
  classes: TeacherClassDto[];

  @ApiProperty({ type: TeacherPreviewCountsDto })
  counts: TeacherPreviewCountsDto;
}
