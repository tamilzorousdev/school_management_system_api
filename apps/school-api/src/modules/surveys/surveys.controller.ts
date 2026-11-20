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
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiFile } from '../../shared/pdf-response';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import { XLSX } from '../attendance/attendance-export';
import {
  CreateSurveyDto,
  ExtendSurveyDto,
  MySurveyDto,
  MySurveyItemDto,
  MySurveyQueryDto,
  MySurveysQueryDto,
  NotAnsweredDto,
  NotAnsweredQueryDto,
  RemindResultDto,
  ResultsQueryDto,
  SendSurveyDto,
  SubmitAnswersDto,
  SurveyDto,
  SurveyInsightsDto,
  SurveyPreviewDto,
  SurveyPreviewInputDto,
  SurveyQueryDto,
  SurveyResultsDto,
  SurveyTemplateDto,
  SurveyTemplateInputDto,
  SurveyTemplateUpdateDto,
  TemplateQueryDto,
  UpdateSurveyDto,
} from './dto/survey.dto';
import { SurveysService } from './surveys.service';

@ApiTags('Admin · Surveys')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/surveys')
export class SurveysController {
  constructor(private readonly surveys: SurveysService) {}

  @Get('insights')
  @RequirePermissions(PERMISSIONS.SURVEYS_VIEW)
  @ApiOperation({ summary: 'Open forms, drafts, answers this month and the average response rate this year' })
  @ApiEnvelope(SurveyInsightsDto)
  insights(@SchoolId() schoolId: number) {
    return this.surveys.insights(schoolId);
  }

  @Get('templates')
  @RequirePermissions(PERMISSIONS.SURVEYS_VIEW)
  @ApiOperation({
    summary: "The school's ready-made forms",
    description:
      'Starts with PTM, Event, Transport, Canteen, Annual parent satisfaction and Staff satisfaction; the school can change them. all=true also lists the switched-off ones.',
  })
  @ApiEnvelope(SurveyTemplateDto, { isArray: true })
  templates(@SchoolId() schoolId: number, @Query() query: TemplateQueryDto) {
    return this.surveys.templates(schoolId, query.all);
  }

  @Post('templates')
  @RequirePermissions(PERMISSIONS.SURVEYS_MANAGE)
  @ResponseMessage('Ready-made form added')
  @ApiOperation({ summary: 'Add a ready-made form' })
  @ApiEnvelope(SurveyTemplateDto, { status: HttpStatus.CREATED, message: 'Ready-made form added' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  addTemplate(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number, @Body() dto: SurveyTemplateInputDto) {
    return this.surveys.createTemplate(user, schoolId, dto);
  }

  @Patch('templates/:templateId')
  @RequirePermissions(PERMISSIONS.SURVEYS_MANAGE)
  @ResponseMessage('Ready-made form saved')
  @ApiOperation({ summary: 'Change a ready-made form, or switch it off with is_active false' })
  @ApiEnvelope(SurveyTemplateDto, { message: 'Ready-made form saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  updateTemplate(
    @SchoolId() schoolId: number,
    @Param('templateId', ParseIntPipe) templateId: number,
    @Body() dto: SurveyTemplateUpdateDto,
  ) {
    return this.surveys.updateTemplate(schoolId, templateId, dto);
  }

  @Delete('templates/:templateId')
  @RequirePermissions(PERMISSIONS.SURVEYS_MANAGE)
  @ResponseMessage('Ready-made form removed')
  @ApiOperation({ summary: 'Remove a ready-made form', description: '404 TEMPLATE_NOT_FOUND.' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  async removeTemplate(@SchoolId() schoolId: number, @Param('templateId', ParseIntPipe) templateId: number) {
    await this.surveys.removeTemplate(schoolId, templateId);
    return null;
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.SURVEYS_MANAGE)
  @ApiOperation({
    summary: 'How many will get the form, before sending',
    description:
      'Same audience choices as Emergency broadcast. recipients counts answer slots (people, or children with per_child); people without the app cannot answer and are counted in without_app.',
  })
  @ApiEnvelope(SurveyPreviewDto)
  @ApiErrors(HttpStatus.BAD_REQUEST)
  preview(@SchoolId() schoolId: number, @Body() dto: SurveyPreviewInputDto) {
    return this.surveys.preview(schoolId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.SURVEYS_VIEW)
  @ApiOperation({
    summary: 'Surveys and feedback forms of the academic year being viewed',
    description:
      'search matches title and description. status = draft, scheduled, open or closed. sort: created_at, title, closes_at, sent_at.',
  })
  @ApiEnvelope(SurveyDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  list(@SchoolId() schoolId: number, @Query() query: SurveyQueryDto) {
    return this.surveys.list(schoolId, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SURVEYS_MANAGE)
  @ResponseMessage('Draft saved')
  @ApiOperation({
    summary: 'Save a new form as a draft',
    description: 'Choice questions need 2 to 10 different options; other types take none. 400 VALIDATION_FAILED.',
  })
  @ApiEnvelope(SurveyDto, { status: HttpStatus.CREATED, message: 'Draft saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  create(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number, @Body() dto: CreateSurveyDto) {
    return this.surveys.create(user, schoolId, dto);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.SURVEYS_VIEW)
  @ApiOperation({ summary: 'One form with its questions, audience and answer counts' })
  @ApiEnvelope(SurveyDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  detail(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.surveys.detail(schoolId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.SURVEYS_MANAGE)
  @ResponseMessage('Saved')
  @ApiOperation({
    summary: 'Change a draft; after sending only the title, description and questions, until the first answer',
    description:
      'Sending questions replaces them all. 409 SURVEY_LOCKED once answers exist, SURVEY_CLOSED when closed.',
  })
  @ApiEnvelope(SurveyDto, { message: 'Saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  update(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSurveyDto) {
    return this.surveys.update(schoolId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.SURVEYS_MANAGE)
  @ResponseMessage('Draft deleted')
  @ApiOperation({
    summary: 'Delete a draft',
    description: '409 SURVEY_NOT_DRAFT once it has been sent: close it instead.',
  })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async remove(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.surveys.remove(schoolId, id);
    return null;
  }

  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.SURVEYS_MANAGE)
  @ResponseMessage('Form sent')
  @ApiOperation({
    summary: 'Send the form now or later, with a close date',
    description:
      'Fixes the list of people at this moment (one row per person, or per child with per_child), then sends push and in-app (SURVEY_NEW, no SMS) when it opens. Only people with the app get it. 400 NO_RECIPIENTS, VALIDATION_FAILED (questions, send_at, closes_at); 409 SURVEY_NOT_DRAFT.',
  })
  @ApiEnvelope(SurveyDto, { message: 'Form sent' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  send(
    @CurrentUser() user: AuthUser,
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SendSurveyDto,
  ) {
    return this.surveys.send(user, schoolId, id, dto);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.SURVEYS_MANAGE)
  @ResponseMessage('Form closed')
  @ApiOperation({
    summary: 'Close now: later answers get SURVEY_CLOSED',
    description: '409 SURVEY_CLOSED, SURVEY_NOT_OPEN.',
  })
  @ApiEnvelope(SurveyDto, { message: 'Form closed' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  close(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.surveys.close(schoolId, id);
  }

  @Post(':id/extend')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.SURVEYS_MANAGE)
  @ResponseMessage('Close date moved')
  @ApiOperation({
    summary: 'Move the close date later; works even after answers have come in',
    description: '400 VALIDATION_FAILED (closes_at), 409 SURVEY_CLOSED, SURVEY_NOT_OPEN.',
  })
  @ApiEnvelope(SurveyDto, { message: 'Close date moved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  extend(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: ExtendSurveyDto) {
    return this.surveys.extend(schoolId, id, dto);
  }

  @Post(':id/remind')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.SURVEYS_MANAGE)
  @ResponseMessage('Reminder sent')
  @ApiOperation({
    summary: 'Remind now everyone who has not answered (push and in-app, SURVEY_REMINDER)',
    description:
      'The automatic reminder also goes once, 24 hours before closes_at. 409 SURVEY_NOT_OPEN, SURVEY_CLOSED.',
  })
  @ApiEnvelope(RemindResultDto, { message: 'Reminder sent' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  remind(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.surveys.remind(schoolId, id);
  }

  @Get(':id/results')
  @RequirePermissions(PERMISSIONS.SURVEYS_VIEW)
  @ApiOperation({
    summary: 'Response rate and a summary per question, filtered by class, section or role',
    description:
      'Choices: count and % per option; rating: average and count per star; number: average, min, max; text and date: the answers (no names when anonymous). search narrows written answers.',
  })
  @ApiEnvelope(SurveyResultsDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  results(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Query() query: ResultsQueryDto) {
    return this.surveys.results(schoolId, id, query);
  }

  @Get(':id/not-answered')
  @RequirePermissions(PERMISSIONS.SURVEYS_VIEW)
  @ApiOperation({
    summary: 'People who have not answered yet',
    description: '403 SURVEY_ANONYMOUS for an anonymous form: names are never shown.',
  })
  @ApiEnvelope(NotAnsweredDto, { paginated: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  notAnswered(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: NotAnsweredQueryDto,
  ) {
    return this.surveys.notAnswered(schoolId, id, query);
  }

  @Get(':id/export')
  @RequirePermissions(PERMISSIONS.SURVEYS_VIEW)
  @ApiOperation({
    summary: 'Excel download: every answer and a summary sheet',
    description: 'Same filters as results. No names when the form is anonymous.',
  })
  @ApiFile(XLSX, 'Survey answers')
  @ApiErrors(HttpStatus.NOT_FOUND)
  exportFile(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Query() query: ResultsQueryDto) {
    return this.surveys.exportFile(schoolId, id, query);
  }
}

@ApiTags('Me · Surveys')
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED)
@Controller('me/surveys')
export class MeSurveysController {
  constructor(private readonly surveys: SurveysService) {}

  @Get()
  @ApiOperation({
    summary: 'Forms sent to me (Parent, Teacher and Driver apps)',
    description:
      'state=waiting (default): open and not answered, closing soonest first. state=done: answered, newest first. A form answered once per child appears once for each child (student).',
  })
  @ApiEnvelope(MySurveyItemDto, { isArray: true })
  mine(@CurrentUser() user: AuthUser, @Query() query: MySurveysQueryDto) {
    return this.surveys.mine(user, query.state, query.role);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'One form with its questions; my_answers once I have answered',
    description:
      'student_id picks the child when it is answered once per child. 403 SURVEY_NOT_FOR_YOU, 404 SURVEY_NOT_FOUND, 409 SURVEY_NOT_OPEN.',
  })
  @ApiEnvelope(MySurveyDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  one(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() query: MySurveyQueryDto) {
    return this.surveys.mineOne(user, id, query.student_id);
  }

  @Post(':id/answers')
  @ResponseMessage('Thank you, your answers are saved')
  @ApiOperation({
    summary: 'Send my answers once; they cannot be changed afterwards',
    description:
      'value: text for single_choice, short_text, long_text; YYYY-MM-DD for date; list of options for multi_choice; 1-5 for rating; a number for number. errors[].field is answers.<question_id>. 400 SURVEY_ANSWER_REQUIRED, SURVEY_ANSWER_INVALID; 403 SURVEY_NOT_FOR_YOU; 409 SURVEY_ALREADY_ANSWERED, SURVEY_CLOSED, SURVEY_NOT_OPEN.',
  })
  @ApiEnvelope(MySurveyDto, { status: HttpStatus.CREATED, message: 'Thank you, your answers are saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  answer(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: SubmitAnswersDto) {
    return this.surveys.submit(user, id, dto);
  }
}
