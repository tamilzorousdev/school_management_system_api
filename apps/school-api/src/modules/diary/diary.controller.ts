import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import {
  DiaryDetailDto,
  DiaryEntryDto,
  DiaryInsightsDto,
  DiaryOptionalNoteDto,
  DiaryQueryDto,
  DiaryReviewDto,
  DiarySubmissionDto,
  GradeHomeworkDto,
} from './dto/diary.dto';
import { DiaryService } from './diary.service';

@ApiTags('Admin · Diary')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/diary')
export class DiaryController {
  constructor(private readonly diary: DiaryService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.DIARY_VIEW)
  @ApiOperation({
    summary: 'Diary posts of the current academic year: homework, remarks, feedback and notes',
    description: 'Sort: created_at (default), published_at, status, type. Older academic years are not shown.',
  })
  @ApiEnvelope(DiaryEntryDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  list(@SchoolId() schoolId: number, @Query() query: DiaryQueryDto) {
    return this.diary.list(schoolId, query);
  }

  @Get('insights')
  @RequirePermissions(PERMISSIONS.DIARY_VIEW)
  @ApiOperation({ summary: 'Counts for the insight cards and the review mode the school uses' })
  @ApiEnvelope(DiaryInsightsDto)
  insights(@SchoolId() schoolId: number) {
    return this.diary.insights(schoolId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.DIARY_VIEW)
  @ApiOperation({ summary: 'One post with every student it reaches and whether a parent has seen it' })
  @ApiEnvelope(DiaryDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  detail(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.diary.detail(schoolId, id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.DIARY_MODERATE)
  @ResponseMessage('Diary post published')
  @ApiOperation({ summary: 'Approve a post waiting for review. Parents get it with a push.' })
  @ApiEnvelope(DiaryDetailDto, { message: 'Diary post published' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  approve(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthUser) {
    return this.diary.approve(schoolId, id, actor);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.DIARY_MODERATE)
  @ResponseMessage('Diary post sent back')
  @ApiOperation({ summary: 'Send a post back to the teacher with a reason. Parents never see it.' })
  @ApiEnvelope(DiaryDetailDto, { message: 'Diary post sent back' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  reject(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DiaryReviewDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.diary.reject(schoolId, id, dto.note, actor);
  }

  @Post(':id/hide')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.DIARY_MODERATE)
  @ResponseMessage('Diary post hidden')
  @ApiOperation({ summary: 'Take a published post out of the parent feed' })
  @ApiEnvelope(DiaryDetailDto, { message: 'Diary post hidden' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  hide(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DiaryOptionalNoteDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.diary.hide(schoolId, id, dto.note, actor);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.DIARY_MODERATE)
  @ResponseMessage('Diary post shown again')
  @ApiOperation({ summary: 'Put a hidden post back in the parent feed (no new push)' })
  @ApiEnvelope(DiaryDetailDto, { message: 'Diary post shown again' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  restore(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthUser) {
    return this.diary.restore(schoolId, id, actor);
  }

  @Get(':id/submissions')
  @RequirePermissions(PERMISSIONS.DIARY_VIEW)
  @ApiOperation({ summary: 'List all student submissions for this homework post' })
  @ApiEnvelope(DiarySubmissionDto, { isArray: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  submissions(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthUser) {
    return this.diary.listSubmissions(schoolId, id, actor);
  }

  @Post(':id/submissions/:submissionId/grade')
  @RequirePermissions(PERMISSIONS.DIARY_MODERATE)
  @ResponseMessage('Submission graded')
  @ApiOperation({ summary: 'Grade a student submission (marks/grade + feedback)' })
  @ApiEnvelope(DiarySubmissionDto, { message: 'Submission graded' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  grade(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('submissionId', ParseIntPipe) submissionId: number,
    @Body() dto: GradeHomeworkDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.diary.gradeSubmission(schoolId, id, submissionId, actor, dto);
  }
}
