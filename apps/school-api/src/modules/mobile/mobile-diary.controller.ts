import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelope,
  ApiErrors,
  AppException,
  AuthUser,
  CurrentUser,
  RequireRoles,
  ResponseMessage,
} from '@app/common';
import { ROLES } from '../access/access.catalog';
import {
  DiaryDetailDto,
  DiaryEntryDto,
  DiaryFeedItemDto,
  DiaryInputDto,
  DiarySubmissionDto,
  DiaryUpdateDto,
  GradeHomeworkDto,
  ParentDiaryQueryDto,
  SubmitHomeworkDto,
  TeacherDiaryQueryDto,
} from '../diary/dto/diary.dto';
import { DiaryService } from '../diary/diary.service';
import { MobileAccessService } from './mobile-access.service';
import { TEACHER_MODULE_TAGS } from './teacher-modules.catalog';
import { PARENT_MODULE_TAGS } from './parent-modules.catalog';

@ApiTags(TEACHER_MODULE_TAGS.MODULE_4)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@RequireRoles(ROLES.TEACHER, ROLES.HOD, ROLES.PRINCIPAL)
@Controller('mobile/teacher/diary')
export class MobileTeacherDiaryController {
  constructor(private readonly diary: DiaryService) {}

  @Get()
  @ApiOperation({ summary: 'My diary posts this academic year, newest first, with how many parents have seen each' })
  @ApiEnvelope(DiaryEntryDto, { paginated: true })
  list(@CurrentUser() user: AuthUser, @Query() query: TeacherDiaryQueryDto) {
    return this.diary.listForTeacher(user, query);
  }

  @Post()
  @ResponseMessage('Diary post saved')
  @ApiOperation({
    summary: 'Post homework, a remark, feedback or a note to a class, a section or chosen students',
    description:
      'Published at once with a push to parents, or kept as pending_review when the school reviews this type ' +
      '(School setup → Diary review). 403 NOT_YOUR_SECTION; 409 NO_STUDENTS.',
  })
  @ApiEnvelope(DiaryDetailDto, { status: HttpStatus.CREATED, message: 'Diary post saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  create(@CurrentUser() user: AuthUser, @Body() dto: DiaryInputDto) {
    return this.diary.create(user, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One of my posts with every student and when their parent saw it' })
  @ApiEnvelope(DiaryDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  detail(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.diary.getForTeacher(user, id);
  }

  @Patch(':id')
  @ResponseMessage('Diary post updated')
  @ApiOperation({
    summary: 'Edit a post that is waiting for review or was sent back; it goes for review again if needed',
    description: '409 DIARY_NOT_EDITABLE once published or hidden',
  })
  @ApiEnvelope(DiaryDetailDto, { message: 'Diary post updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: DiaryUpdateDto) {
    return this.diary.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Diary post deleted')
  @ApiOperation({ summary: 'Delete one of my posts; it leaves the parent feed' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.diary.remove(user, id);
    return null;
  }

  @Get(':id/submissions')
  @ApiOperation({ summary: 'List all student submissions for this homework post' })
  @ApiEnvelope(DiarySubmissionDto, { isArray: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  submissions(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    if (!user.school_id) throw AppException.forbidden('Your account is not linked to a school', 'NO_SCHOOL');
    return this.diary.listSubmissions(user.school_id, id, user);
  }

  @Post(':id/submissions/:submissionId/grade')
  @ResponseMessage('Submission graded')
  @ApiOperation({ summary: 'Grade a student homework submission (marks/grade + feedback)' })
  @ApiEnvelope(DiarySubmissionDto, { message: 'Submission graded' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  grade(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('submissionId', ParseIntPipe) submissionId: number,
    @Body() dto: GradeHomeworkDto,
  ) {
    if (!user.school_id) throw AppException.forbidden('Your account is not linked to a school', 'NO_SCHOOL');
    return this.diary.gradeSubmission(user.school_id, id, submissionId, user, dto);
  }
}

@ApiTags(PARENT_MODULE_TAGS.MODULE_4)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND)
@RequireRoles(ROLES.PARENT)
@Controller('mobile/parent/children/:id/diary')
export class MobileParentDiaryController {
  constructor(
    private readonly diary: DiaryService,
    private readonly access: MobileAccessService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Diary feed for this child this academic year, newest first, with a seen flag' })
  @ApiEnvelope(DiaryFeedItemDto, { paginated: true })
  async feed(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ParentDiaryQueryDto,
  ) {
    return this.diary.feed(await this.access.childSchool(user.id, id), id, query);
  }

  @Post(':entryId/seen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a diary post as seen; the teacher sees it on the post' })
  async seen(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('entryId', ParseIntPipe) entryId: number,
  ) {
    return this.diary.markSeen(await this.access.childSchool(user.id, id), id, entryId, user);
  }

  @Post(':entryId/submit')
  @ResponseMessage('Homework submitted')
  @ApiOperation({ summary: 'Submit homework files or notes for this child' })
  @ApiEnvelope(DiarySubmissionDto, { status: HttpStatus.CREATED, message: 'Homework submitted' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async submit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('entryId', ParseIntPipe) entryId: number,
    @Body() dto: SubmitHomeworkDto,
  ) {
    return this.diary.submitHomework(await this.access.childSchool(user.id, id), id, entryId, user, dto);
  }

  @Get(':entryId/submission')
  @ApiOperation({ summary: 'Get current submission details and grade for this child' })
  @ApiEnvelope(DiarySubmissionDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  async submission(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('entryId', ParseIntPipe) entryId: number,
  ) {
    return this.diary.getSubmissionForStudent(await this.access.childSchool(user.id, id), id, entryId);
  }
}
