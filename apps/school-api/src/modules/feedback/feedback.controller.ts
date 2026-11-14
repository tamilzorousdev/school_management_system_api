import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelope,
  ApiErrors,
  AuthUser,
  CurrentUser,
  RequirePermissions,
  RequireRoles,
  ResponseMessage,
} from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS, ROLES } from '../access/access.catalog';
import {
  FeedbackRosterDto,
  FeedbackSettingsDto,
  FeedbackSettingsInputDto,
  OwnRatingsDto,
  RankingRowDto,
  RateableTeacherDto,
  RateableTeachersDto,
  RateTeacherDto,
  RatingDto,
  RatingsQueryDto,
  StudentFeedbackDto,
  StudentFeedbackInputDto,
  StudentFeedbackQueryDto,
  TeacherReportDto,
  TeacherReportQueryDto,
} from './dto/feedback.dto';
import { FeedbackService } from './feedback.service';

@ApiTags('Admin · Teacher feedback')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Get('settings')
  @RequirePermissions(PERMISSIONS.FEEDBACK_VIEW)
  @ApiOperation({ summary: 'Parent rating and student feedback settings, with the rating window and term today' })
  @ApiEnvelope(FeedbackSettingsDto)
  settings(@SchoolId() schoolId: number) {
    return this.feedback.settings(schoolId);
  }

  @Put('settings')
  @RequirePermissions(PERMISSIONS.FEEDBACK_MANAGE)
  @ResponseMessage('Feedback settings saved')
  @ApiOperation({
    summary: 'Turn parent ratings and student feedback on or off, and choose how often parents can rate',
    description:
      'teacher_rating_months is 1, 2, 3, 6 or 12. Windows start on the first day of the academic year; a parent can rate each of their child’s teachers once per window.',
  })
  @ApiEnvelope(FeedbackSettingsDto, { message: 'Feedback settings saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  saveSettings(@SchoolId() schoolId: number, @Body() dto: FeedbackSettingsInputDto) {
    return this.feedback.updateSettings(schoolId, dto);
  }

  @Get('ratings')
  @RequirePermissions(PERMISSIONS.FEEDBACK_VIEW)
  @ApiOperation({
    summary: 'Parent ratings of teachers, with the parent and child (office only)',
    description: 'Search teacher, parent, student or remark. sort = created_at (default) or stars.',
  })
  @ApiEnvelope(RatingDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  ratings(@SchoolId() schoolId: number, @Query() query: RatingsQueryDto) {
    return this.feedback.ratings(schoolId, query);
  }

  @Delete('ratings/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FEEDBACK_MANAGE)
  @ResponseMessage('Rating removed')
  @ApiOperation({
    summary: 'Remove a parent rating (for example an abusive remark)',
    description: 'The parent can rate that teacher again in the same window.',
  })
  @ApiEnvelope(undefined, { message: 'Rating removed' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  async removeRating(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.feedback.removeRating(schoolId, id);
    return null;
  }

  @Get('ranking')
  @RequirePermissions(PERMISSIONS.FEEDBACK_VIEW)
  @ApiOperation({
    summary: 'Teachers ranked by parent ratings this academic year',
    description:
      'Average stars, then % good behaviour, then number of ratings. Teachers without a rating come last with rank null.',
  })
  @ApiEnvelope(RankingRowDto, { isArray: true })
  ranking(@SchoolId() schoolId: number) {
    return this.feedback.ranking(schoolId);
  }

  @Get('student-feedback')
  @RequirePermissions(PERMISSIONS.FEEDBACK_VIEW)
  @ApiOperation({ summary: 'Feedback teachers gave students (studies, behaviour, sports) this academic year' })
  @ApiEnvelope(StudentFeedbackDto, { paginated: true })
  studentFeedback(@SchoolId() schoolId: number, @Query() query: StudentFeedbackQueryDto) {
    return this.feedback.studentFeedback(schoolId, query);
  }

  @Delete('student-feedback/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FEEDBACK_MANAGE)
  @ResponseMessage('Feedback removed')
  @ApiOperation({ summary: 'Remove a teacher’s feedback on a student; the teacher can give it again this term' })
  @ApiEnvelope(undefined, { message: 'Feedback removed' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  async removeStudentFeedback(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.feedback.removeStudentFeedback(schoolId, id);
    return null;
  }

  @Get('teacher-report')
  @RequirePermissions(PERMISSIONS.FEEDBACK_VIEW)
  @ApiOperation({
    summary: 'Teacher-wise results: each class and subject a teacher takes, with pass, fail and average %',
    description:
      'From published exams (one with exam_id), matched to teachers through teacher assignments. A paper is one student in one subject of one exam; it passes at or above the pass mark. Includes the teacher’s parent ratings and latest remarks.',
  })
  @ApiEnvelope(TeacherReportDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  teacherReport(@SchoolId() schoolId: number, @Query() query: TeacherReportQueryDto) {
    return this.feedback.teacherReport(schoolId, query);
  }
}

@ApiTags('Mobile · Parent · Teacher rating')
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND)
@RequireRoles(ROLES.PARENT)
@Controller('mobile/parent/children/:id')
export class MobileParentFeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Get('teacher-ratings')
  @ApiOperation({
    summary: 'The child’s teachers I can rate now, and my rating in this window',
    description:
      'enabled is false when the school has ratings off: hide the Rate button. One rating per teacher per window (cycle). The teacher never sees who rated.',
  })
  @ApiEnvelope(RateableTeachersDto)
  rateable(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.feedback.rateable(user.id, id);
  }

  @Post('teacher-ratings')
  @ResponseMessage('Thank you for your rating')
  @ApiOperation({
    summary: 'Rate one of the child’s teachers: stars 1–5, behaviour good or bad, optional remark',
    description:
      'The school admin is told at once. 403 RATING_CLOSED, 400 NOT_CHILD_TEACHER, 409 ALREADY_RATED (one per window).',
  })
  @ApiEnvelope(RateableTeacherDto, { message: 'Thank you for your rating' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  rate(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: RateTeacherDto) {
    return this.feedback.rate(user, id, dto);
  }

  @Get('feedback')
  @ApiOperation({
    summary: 'Teachers’ feedback on the child this year: studies, behaviour and sports in stars',
    description: '5 Excellent, 4 Very good, 3 Good, 2 Average, 1 Needs improvement. Newest first.',
  })
  @ApiEnvelope(StudentFeedbackDto, { isArray: true })
  childFeedback(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.feedback.childFeedback(user.id, id);
  }
}

@ApiTags('Mobile · Teacher · Feedback')
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@RequireRoles(ROLES.TEACHER, ROLES.HOD, ROLES.PRINCIPAL)
@Controller('mobile/teacher')
export class MobileTeacherFeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Get('ratings')
  @ApiOperation({
    summary: 'My parent ratings: this year, this window and each rating without the parent or child',
    description: 'Only the teacher’s own ratings. Remarks show the window, never who gave them or when.',
  })
  @ApiEnvelope(OwnRatingsDto)
  ratings(@CurrentUser() user: AuthUser) {
    return this.feedback.ownRatings(user);
  }

  @Get('feedback/sections/:sectionId')
  @ApiOperation({
    summary: 'Students of my section with the feedback I gave them this term',
    description: 'enabled is false when the school has student feedback off. 403 NOT_YOUR_SECTION.',
  })
  @ApiEnvelope(FeedbackRosterDto)
  roster(@CurrentUser() user: AuthUser, @Param('sectionId', ParseIntPipe) sectionId: number) {
    return this.feedback.roster(user, sectionId);
  }

  @Post('feedback/students/:studentId')
  @ResponseMessage('Feedback sent to the parents')
  @ApiOperation({
    summary: 'Give a student feedback for this term: studies, behaviour and (optional) sports in stars',
    description:
      'Once per student per term; the parents get a notification. 403 FEEDBACK_CLOSED, NOT_YOUR_SECTION; 404 STUDENT_NOT_FOUND; 400 NO_TERM_NOW; 409 FEEDBACK_ALREADY_GIVEN.',
  })
  @ApiEnvelope(StudentFeedbackDto, { message: 'Feedback sent to the parents' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  give(
    @CurrentUser() user: AuthUser,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Body() dto: StudentFeedbackInputDto,
  ) {
    return this.feedback.giveFeedback(user, studentId, dto);
  }
}
