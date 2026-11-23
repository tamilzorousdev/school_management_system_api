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
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import {
  ClassToppersDto,
  ExamDetailDto,
  ExamDto,
  ExamInputDto,
  ExamQueryDto,
  ExamSubjectDto,
  ExamSubjectsInputDto,
  ExamToppersDto,
  MarksQueryDto,
  MarksSheetDto,
  SaveMarksDto,
  SectionResultsDto,
  StudentExamResultDto,
  ToppersQueryDto,
  UpdateExamDto,
} from './dto/exams.dto';
import { CreateExamHallDto, SaveGradingScaleDto, UpdateExamHallDto } from './dto/halls.dto';
import { ExamHallsService } from './exam-halls.service';
import { ExamsService } from './exams.service';

@ApiTags('Admin · Exams')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/exams')
export class ExamsController {
  constructor(
    private readonly exams: ExamsService,
    private readonly halls: ExamHallsService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.EXAMS_VIEW)
  @ApiOperation({
    summary: 'Exams with classes, papers and marks progress',
    description: 'search matches the exam name. sort: start_date (default), created_at, published_at, name.',
  })
  @ApiEnvelope(ExamDto, { paginated: true })
  list(@SchoolId() schoolId: number, @Query() query: ExamQueryDto) {
    return this.exams.list(schoolId, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.EXAMS_MANAGE)
  @ResponseMessage('Exam created')
  @ApiOperation({
    summary: 'Create an exam for some classes',
    description:
      'Papers come from each class’s subjects this year (activities left out) with max 100 and pass 35. 400 CLASS_HAS_NO_SUBJECTS, OUTSIDE_YEAR, TERM_NOT_IN_YEAR; 409 EXAM_EXISTS.',
  })
  @ApiEnvelope(ExamDetailDto, { status: HttpStatus.CREATED, message: 'Exam created' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  create(@SchoolId() schoolId: number, @Body() dto: ExamInputDto) {
    return this.exams.create(schoolId, dto);
  }

  // === STATIC SUB-ROUTES (Must precede :id to avoid ParseIntPipe 400 conflicts) ===
  @Get('halls')
  @RequirePermissions(PERMISSIONS.EXAMS_VIEW)
  @ApiOperation({ summary: 'List physical exam halls and rooms with capacities' })
  listHalls(@SchoolId() schoolId: number) {
    return this.halls.listHalls(schoolId);
  }

  @Post('halls')
  @RequirePermissions(PERMISSIONS.EXAMS_MANAGE)
  @ResponseMessage('Exam hall created')
  @ApiOperation({ summary: 'Create a new exam hall / room' })
  createHall(@SchoolId() schoolId: number, @Body() dto: CreateExamHallDto) {
    return this.halls.createHall(schoolId, dto);
  }

  @Get('halls/:hallId')
  @RequirePermissions(PERMISSIONS.EXAMS_VIEW)
  @ApiOperation({ summary: 'Get details of an exam hall' })
  getHall(@SchoolId() schoolId: number, @Param('hallId', ParseIntPipe) hallId: number) {
    return this.halls.getHall(schoolId, hallId);
  }

  @Put('halls/:hallId')
  @RequirePermissions(PERMISSIONS.EXAMS_MANAGE)
  @ResponseMessage('Exam hall updated')
  @ApiOperation({ summary: 'Update an exam hall' })
  updateHall(
    @SchoolId() schoolId: number,
    @Param('hallId', ParseIntPipe) hallId: number,
    @Body() dto: UpdateExamHallDto,
  ) {
    return this.halls.updateHall(schoolId, hallId, dto);
  }

  @Delete('halls/:hallId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.EXAMS_MANAGE)
  @ApiOperation({ summary: 'Delete an exam hall' })
  deleteHall(@SchoolId() schoolId: number, @Param('hallId', ParseIntPipe) hallId: number) {
    return this.halls.deleteHall(schoolId, hallId);
  }

  @Get('grading-scales')
  @RequirePermissions(PERMISSIONS.EXAMS_VIEW)
  @ApiOperation({ summary: 'List grading scales configured for the school' })
  listGradingScales(@SchoolId() schoolId: number) {
    return this.halls.listGradingScales(schoolId);
  }

  @Post('grading-scales')
  @RequirePermissions(PERMISSIONS.EXAMS_MANAGE)
  @ResponseMessage('Grading scale saved')
  @ApiOperation({ summary: 'Create or update a grading scale (CBSE, State, ICSE, Custom)' })
  saveGradingScale(@SchoolId() schoolId: number, @Body() dto: SaveGradingScaleDto) {
    return this.halls.saveGradingScale(schoolId, dto);
  }

  @Put('grading-scales/:scaleId/set-default')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.EXAMS_MANAGE)
  @ResponseMessage('Default grading scale updated')
  @ApiOperation({ summary: 'Set default grading scale for the school' })
  setDefaultGradingScale(@SchoolId() schoolId: number, @Param('scaleId', ParseIntPipe) scaleId: number) {
    return this.halls.setDefaultGradingScale(schoolId, scaleId);
  }

  @Delete('grading-scales/:scaleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.EXAMS_MANAGE)
  @ApiOperation({ summary: 'Delete a grading scale' })
  deleteGradingScale(@SchoolId() schoolId: number, @Param('scaleId', ParseIntPipe) scaleId: number) {
    return this.halls.deleteGradingScale(schoolId, scaleId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.EXAMS_VIEW)
  @ApiOperation({ summary: 'One exam with its classes, sections and papers' })
  @ApiEnvelope(ExamDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.exams.get(schoolId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.EXAMS_MANAGE)
  @ResponseMessage('Exam updated')
  @ApiOperation({
    summary: 'Rename, move dates, change term or classes',
    description: '409 CLASS_HAS_MARKS when removing a class that already has marks.',
  })
  @ApiEnvelope(ExamDetailDto, { message: 'Exam updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  update(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateExamDto) {
    return this.exams.update(schoolId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.EXAMS_MANAGE)
  @ResponseMessage('Exam deleted')
  @ApiOperation({ summary: 'Delete a draft exam with its marks', description: '409 EXAM_PUBLISHED once published.' })
  @ApiEnvelope(undefined, { message: 'Exam deleted' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async remove(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.exams.remove(schoolId, id);
    return null;
  }

  @Get(':id/subjects')
  @RequirePermissions(PERMISSIONS.EXAMS_VIEW)
  @ApiOperation({ summary: 'Papers: max marks, pass marks and date for each class and subject' })
  @ApiEnvelope(ExamSubjectDto, { isArray: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  subjects(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.exams.subjects(schoolId, id);
  }

  @Put(':id/subjects')
  @RequirePermissions(PERMISSIONS.EXAMS_MANAGE)
  @ResponseMessage('Subjects saved')
  @ApiOperation({
    summary: 'Replace the papers of the exam',
    description:
      'Send every paper. 409 SUBJECT_HAS_MARKS when removing a paper with marks; 409 MARKS_ABOVE_MAX when max marks is below marks already entered.',
  })
  @ApiEnvelope(ExamSubjectDto, { isArray: true, message: 'Subjects saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  setSubjects(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: ExamSubjectsInputDto) {
    return this.exams.setSubjects(schoolId, id, dto);
  }

  @Get(':id/sections/:sectionId/marks')
  @RequirePermissions(PERMISSIONS.EXAMS_VIEW)
  @ApiOperation({ summary: 'Marks sheet of one section for one subject, in roll-number order' })
  @ApiEnvelope(MarksSheetDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  marks(
    @SchoolId() schoolId: number,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Query() query: MarksQueryDto,
  ) {
    return this.exams.marksSheet(schoolId, id, sectionId, query.subject_id, user);
  }

  @Put(':id/sections/:sectionId/marks')
  @RequirePermissions(PERMISSIONS.EXAMS_VIEW)
  @ResponseMessage('Marks saved')
  @ApiOperation({
    summary: 'Save marks of one subject for some or all students of a section',
    description:
      'marks 0 to max marks (2 decimals). Only the assigned class teacher or subject teacher can enter marks.',
  })
  @ApiEnvelope(MarksSheetDto, { message: 'Marks saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.FORBIDDEN)
  saveMarks(
    @SchoolId() schoolId: number,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Query() query: MarksQueryDto,
    @Body() dto: SaveMarksDto,
  ) {
    return this.exams.saveMarks(schoolId, id, sectionId, query.subject_id, dto, user);
  }

  @Get(':id/sections/:sectionId/results')
  @RequirePermissions(PERMISSIONS.EXAMS_VIEW)
  @ApiOperation({
    summary: 'Ranked results of a section: total, %, grade, pass or fail, section and class rank',
    description:
      'Grades: A1 91+, A2 81+, B1 71+, B2 61+, C1 51+, C2 41+, D 33+, E below. A student fails with any subject below pass marks or absent. Ranks use competition ranking (1, 2, 2, 4) on total; students with a missing mark are incomplete and not ranked.',
  })
  @ApiEnvelope(SectionResultsDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  results(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('sectionId', ParseIntPipe) sectionId: number,
  ) {
    return this.exams.sectionResults(schoolId, id, sectionId);
  }

  @Get(':id/classes/:classId/toppers')
  @RequirePermissions(PERMISSIONS.EXAMS_VIEW)
  @ApiOperation({ summary: 'Top rank holders of a class across its sections' })
  @ApiEnvelope(ClassToppersDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  classToppers(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('classId', ParseIntPipe) classId: number,
    @Query() query: ToppersQueryDto,
  ) {
    return this.exams.classToppers(schoolId, id, classId, query.limit);
  }

  @Get(':id/toppers')
  @RequirePermissions(PERMISSIONS.EXAMS_VIEW)
  @ApiOperation({ summary: 'Top rank holders of every class in the exam (dashboard card)' })
  @ApiEnvelope(ExamToppersDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  toppers(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Query() query: ToppersQueryDto) {
    return this.exams.examToppers(schoolId, id, query.limit);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.EXAMS_MANAGE)
  @ResponseMessage('Results published')
  @ApiOperation({
    summary: 'Publish results',
    description:
      'Parents of every student with a complete result get RESULT_PUBLISHED (push, in-app). Teachers can no longer change marks; the office still can. 409 EXAM_PUBLISHED, 400 NO_MARKS.',
  })
  @ApiEnvelope(ExamDetailDto, { message: 'Results published' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  publish(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.exams.publish(schoolId, id);
  }
}

@ApiTags('Admin · Exams')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/students')
export class StudentResultsController {
  constructor(private readonly exams: ExamsService) {}

  @Get(':id/results')
  @RequirePermissions(PERMISSIONS.EXAMS_VIEW)
  @ApiOperation({ summary: 'Published exam results of a student, newest first, with ranks' })
  @ApiEnvelope(StudentExamResultDto, { isArray: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  results(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.exams.studentResults(schoolId, id);
  }
}
