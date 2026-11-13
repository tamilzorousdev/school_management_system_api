import { Body, Controller, Get, HttpStatus, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
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
import { AssignmentsService } from '../staff/assignments.service';
import {
  MarksQueryDto,
  MarksSheetDto,
  RankingQueryDto,
  SaveMarksDto,
  SectionRankingDto,
  StudentExamResultDto,
  TeacherExamDto,
} from './dto/exams.dto';
import { ExamsService } from './exams.service';
import { ReportCardsService } from './report-cards.service';
import {
  ReportCardDto,
  SectionReportCardQueryDto,
  SectionSignaturesStatusDto,
  SignReportCardDto,
} from './dto/report-card.dto';
import { TEACHER_MODULE_TAGS } from '../mobile/teacher-modules.catalog';
import { PARENT_MODULE_TAGS } from '../mobile/parent-modules.catalog';

const teacherSchool = (user: AuthUser): number => {
  if (!user.school_id) throw AppException.forbidden('Your account is not linked to a school', 'NO_SCHOOL');
  return user.school_id;
};

@ApiTags(TEACHER_MODULE_TAGS.MODULE_5)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@RequireRoles(ROLES.TEACHER, ROLES.HOD, ROLES.PRINCIPAL)
@Controller('mobile/teacher')
export class MobileTeacherExamsController {
  constructor(
    private readonly exams: ExamsService,
    private readonly assignments: AssignmentsService,
    private readonly cards: ReportCardsService,
  ) {}

  @Get('exams')
  @ApiOperation({
    summary: 'Exams this year with my sections and the subjects I enter marks for',
    description: 'A class teacher gets every subject of the section; others only the subjects they teach.',
  })
  @ApiEnvelope(TeacherExamDto, { isArray: true })
  list(@CurrentUser() user: AuthUser) {
    return this.exams.teacherExams(teacherSchool(user), user.id);
  }

  @Get('exams/:id/sections/:sectionId/marks')
  @ApiOperation({ summary: 'Marks sheet of my section for one subject' })
  @ApiEnvelope(MarksSheetDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  async marks(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Query() query: MarksQueryDto,
  ) {
    const schoolId = teacherSchool(user);
    await this.exams.assertTeacherSubject(schoolId, user.id, sectionId, query.subject_id);
    return this.exams.marksSheet(schoolId, id, sectionId, query.subject_id, true);
  }

  @Put('exams/:id/sections/:sectionId/marks')
  @ResponseMessage('Marks saved')
  @ApiOperation({
    summary: 'Save marks for my section and subject',
    description:
      'items: [{ student_id, marks, is_absent }]. marks 0 to max marks; null with is_absent false clears. 403 NOT_YOUR_SECTION, NOT_YOUR_SUBJECT; 409 EXAM_PUBLISHED after results are out.',
  })
  @ApiEnvelope(MarksSheetDto, { message: 'Marks saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async saveMarks(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Query() query: MarksQueryDto,
    @Body() dto: SaveMarksDto,
  ) {
    const schoolId = teacherSchool(user);
    await this.exams.assertTeacherSubject(schoolId, user.id, sectionId, query.subject_id);
    return this.exams.saveMarks(schoolId, id, sectionId, query.subject_id, dto, user, true);
  }

  @Get('sections/:id/ranking')
  @ApiOperation({
    summary: 'Students of my section by rank for an exam (default: latest published)',
    description: 'Competition ranking on total (1, 2, 2, 4). Incomplete students come last with rank null.',
  })
  @ApiEnvelope(SectionRankingDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  async ranking(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() query: RankingQueryDto) {
    const schoolId = teacherSchool(user);
    await this.assignments.assertTeachesSection(schoolId, user.id, id);
    return this.exams.sectionRanking(schoolId, id, query.exam_id);
  }

  @Post('sections/:id/report-cards/sign')
  @ApiOperation({ summary: 'Sign report cards for all students in my section' })
  @ApiEnvelope(SectionSignaturesStatusDto)
  signSection(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) sectionId: number,
    @Body() dto: SignReportCardDto,
  ) {
    return this.cards.signSection(teacherSchool(user), user.id, sectionId, dto);
  }

  @Post('students/:id/report-card/sign')
  @ApiOperation({ summary: "Sign a specific student's report card" })
  @ApiEnvelope(ReportCardDto)
  signStudent(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) studentId: number,
    @Body() dto: SignReportCardDto,
  ) {
    return this.cards.signStudent(teacherSchool(user), user.id, studentId, dto);
  }

  @Get('sections/:id/report-cards/signatures')
  @ApiOperation({ summary: 'View signed and non-signed (pending) report card status of my section' })
  @ApiEnvelope(SectionSignaturesStatusDto)
  signaturesStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) sectionId: number,
    @Query() query: SectionReportCardQueryDto,
  ) {
    return this.cards.sectionSignaturesStatus(teacherSchool(user), user.id, sectionId, query);
  }
}

@ApiTags(PARENT_MODULE_TAGS.MODULE_3)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND)
@RequireRoles(ROLES.PARENT)
@Controller('mobile/parent/children/:id')
export class MobileParentExamsController {
  constructor(private readonly exams: ExamsService) {}

  @Get('results')
  @ApiOperation({ summary: 'Published exam results of my child, newest first: marks, %, grade and ranks' })
  @ApiEnvelope(StudentExamResultDto, { isArray: true })
  results(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.exams.childResults(user.id, id);
  }
}
