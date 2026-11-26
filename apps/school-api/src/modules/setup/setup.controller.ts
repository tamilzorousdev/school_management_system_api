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
import { AcademicYearsService } from './academic-years.service';
import { ClassesService } from './classes.service';
import {
  AcademicYearDto,
  AcademicYearInputDto,
  ClassDto,
  ClassInputDto,
  ClassSubjectDto,
  HolidayDto,
  HolidayInputDto,
  HolidayQueryDto,
  PersonRefDto,
  SectionDto,
  SectionInputDto,
  SectionQueryDto,
  SetClassSubjectsDto,
  SetupSummaryDto,
  SubjectDto,
  SubjectInputDto,
  SubjectQueryDto,
  TermInputDto,
  UpdateAcademicYearDto,
  UpdateClassDto,
  UpdateHolidayDto,
  UpdateSectionDto,
  UpdateSubjectDto,
  UpdateTermDto,
  YearQueryDto,
} from './dto/setup.dto';
import { HolidaysService } from './holidays.service';
import { SetupService } from './setup.service';
import { SubjectsService } from './subjects.service';

const VIEW = PERMISSIONS.SCHOOLS_VIEW;
const MANAGE = PERMISSIONS.SCHOOLS_MANAGE;

@ApiTags('Admin · School setup')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin')
export class SetupController {
  constructor(
    private readonly setup: SetupService,
    private readonly years: AcademicYearsService,
    private readonly classes: ClassesService,
    private readonly subjects: SubjectsService,
    private readonly holidays: HolidaysService,
  ) {}

  @Get('setup/summary')
  @RequirePermissions(VIEW)
  @ApiOperation({ summary: 'Counts and the current year for the School setup page' })
  @ApiEnvelope(SetupSummaryDto)
  summary(@SchoolId() schoolId: number) {
    return this.setup.summary(schoolId);
  }

  @Get('setup/teachers')
  @RequirePermissions(VIEW)
  @ApiOperation({ summary: 'Active teachers, HODs and principals, for the class teacher picker' })
  @ApiEnvelope(PersonRefDto, { isArray: true })
  teachers(@SchoolId() schoolId: number) {
    return this.classes.teachers(schoolId);
  }

  @Get('academic-years')
  @ApiOperation({
    summary: 'Academic years with their terms, newest first',
    description:
      'Open to every signed-in user of the school: the admin web year picker loads it on every page, whatever the role.',
  })
  @ApiEnvelope(AcademicYearDto, { isArray: true })
  listYears(@SchoolId() schoolId: number) {
    return this.years.list(schoolId);
  }

  @Post('academic-years')
  @RequirePermissions(MANAGE)
  @ResponseMessage('Academic year created')
  @ApiOperation({
    summary: 'Create an academic year. The first one becomes current automatically.',
    description:
      'A new year is draft unless is_current is true. Dates may not overlap another year (409 YEAR_OVERLAPS).',
  })
  @ApiEnvelope(AcademicYearDto, { status: HttpStatus.CREATED, message: 'Academic year created' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  createYear(@SchoolId() schoolId: number, @Body() dto: AcademicYearInputDto, @CurrentUser() actor: AuthUser) {
    return this.years.create(schoolId, dto, actor);
  }

  @Patch('academic-years/:id')
  @RequirePermissions(MANAGE)
  @ResponseMessage('Academic year updated')
  @ApiOperation({
    summary: 'Update name, dates or description, or make this the current year',
    description:
      'is_current: true works like POST .../activate. Dates of a closed or archived year cannot change (409 YEAR_CLOSED).',
  })
  @ApiEnvelope(AcademicYearDto, { message: 'Academic year updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  updateYear(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAcademicYearDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.years.update(schoolId, id, dto, actor);
  }

  @Post('academic-years/:id/activate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(MANAGE)
  @ResponseMessage('Academic year is now current')
  @ApiOperation({
    summary: 'Make this the current (active) year',
    description:
      'The year that was current becomes closed. An archived year must be restored first (409 YEAR_ARCHIVED).',
  })
  @ApiEnvelope(AcademicYearDto, { message: 'Academic year is now current' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  activateYear(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthUser) {
    return this.years.activate(schoolId, id, actor);
  }

  @Post('academic-years/:id/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(MANAGE)
  @ResponseMessage('Academic year archived')
  @ApiOperation({
    summary: 'Archive a closed year',
    description:
      'An archived year takes no fee changes at all, not even payments. 409 INVALID_STATUS_TRANSITION unless closed.',
  })
  @ApiEnvelope(AcademicYearDto, { message: 'Academic year archived' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  archiveYear(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthUser) {
    return this.years.archive(schoolId, id, actor);
  }

  @Post('academic-years/:id/restore')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(MANAGE)
  @ResponseMessage('Academic year restored')
  @ApiOperation({ summary: 'Take an archived year back to closed' })
  @ApiEnvelope(AcademicYearDto, { message: 'Academic year restored' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  restoreYear(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.years.restore(schoolId, id);
  }

  @Delete('academic-years/:id')
  @RequirePermissions(MANAGE)
  @ResponseMessage('Academic year deleted')
  @ApiOperation({ summary: 'Delete an unused, non-current year' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  removeYear(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.years.remove(schoolId, id);
  }

  @Post('academic-years/:id/terms')
  @RequirePermissions(MANAGE)
  @ResponseMessage('Term added')
  @ApiOperation({ summary: 'Add a term inside the year' })
  @ApiEnvelope(AcademicYearDto, { status: HttpStatus.CREATED, message: 'Term added' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  addTerm(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: TermInputDto) {
    return this.years.addTerm(schoolId, id, dto);
  }

  @Patch('terms/:id')
  @RequirePermissions(MANAGE)
  @ResponseMessage('Term updated')
  @ApiOperation({ summary: 'Update a term' })
  @ApiEnvelope(AcademicYearDto, { message: 'Term updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  updateTerm(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTermDto) {
    return this.years.updateTerm(schoolId, id, dto);
  }

  @Delete('terms/:id')
  @RequirePermissions(MANAGE)
  @ResponseMessage('Term deleted')
  @ApiOperation({ summary: 'Delete a term' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  removeTerm(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.years.removeTerm(schoolId, id);
  }

  @Get('classes')
  @RequirePermissions(VIEW)
  @ApiOperation({ summary: 'Classes with their sections and student counts for a year' })
  @ApiEnvelope(ClassDto, { isArray: true })
  listClasses(@SchoolId() schoolId: number, @Query() query: YearQueryDto) {
    return this.classes.list(schoolId, query.academic_year_id);
  }

  @Post('classes')
  @RequirePermissions(MANAGE)
  @ResponseMessage('Class created')
  @ApiOperation({ summary: 'Create a class' })
  @ApiEnvelope(ClassDto, { status: HttpStatus.CREATED, message: 'Class created' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  createClass(@SchoolId() schoolId: number, @Body() dto: ClassInputDto) {
    return this.classes.createClass(schoolId, dto);
  }

  @Post('classes/standard')
  @RequirePermissions(MANAGE)
  @ResponseMessage('Standard classes added')
  @ApiOperation({ summary: 'Add LKG, UKG and classes 1 to 12 where missing' })
  @ApiEnvelope(ClassDto, { isArray: true, status: HttpStatus.CREATED, message: 'Standard classes added' })
  createStandard(@SchoolId() schoolId: number) {
    return this.classes.createStandard(schoolId);
  }

  @Patch('classes/:id')
  @RequirePermissions(MANAGE)
  @ResponseMessage('Class updated')
  @ApiOperation({ summary: 'Rename a class or change its order' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  updateClass(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateClassDto) {
    return this.classes.updateClass(schoolId, id, dto);
  }

  @Delete('classes/:id')
  @RequirePermissions(MANAGE)
  @ResponseMessage('Class deleted')
  @ApiOperation({ summary: 'Delete a class with no sections, students or applications' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  removeClass(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.classes.removeClass(schoolId, id);
  }

  @Get('classes/:id/subjects')
  @RequirePermissions(VIEW)
  @ApiOperation({ summary: 'Subjects taught in a class for a year' })
  @ApiEnvelope(ClassSubjectDto, { isArray: true })
  classSubjects(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Query() query: YearQueryDto) {
    return this.classes.classSubjects(schoolId, id, query.academic_year_id);
  }

  @Put('classes/:id/subjects')
  @RequirePermissions(MANAGE)
  @ResponseMessage('Class subjects saved')
  @ApiOperation({ summary: 'Replace the subjects of a class for a year' })
  @ApiEnvelope(ClassSubjectDto, { isArray: true, message: 'Class subjects saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  setClassSubjects(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetClassSubjectsDto,
  ) {
    return this.classes.setClassSubjects(schoolId, id, dto);
  }

  @Get('sections')
  @RequirePermissions(VIEW)
  @ApiOperation({ summary: 'Sections for a year, optionally for one class' })
  @ApiEnvelope(SectionDto, { isArray: true })
  listSections(@SchoolId() schoolId: number, @Query() query: SectionQueryDto) {
    return this.classes.listSections(schoolId, query);
  }

  @Post('sections')
  @RequirePermissions(MANAGE)
  @ResponseMessage('Section created')
  @ApiOperation({ summary: 'Create a section in a class (current year unless academic_year_id is given)' })
  @ApiEnvelope(SectionDto, { status: HttpStatus.CREATED, message: 'Section created' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  createSection(@SchoolId() schoolId: number, @Body() dto: SectionInputDto) {
    return this.classes.createSection(schoolId, dto);
  }

  @Patch('sections/:id')
  @RequirePermissions(MANAGE)
  @ResponseMessage('Section updated')
  @ApiOperation({ summary: 'Rename a section, change room, capacity or class teacher' })
  @ApiEnvelope(SectionDto, { message: 'Section updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  updateSection(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSectionDto) {
    return this.classes.updateSection(schoolId, id, dto);
  }

  @Delete('sections/:id')
  @RequirePermissions(MANAGE)
  @ResponseMessage('Section deleted')
  @ApiOperation({ summary: 'Delete an empty section' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  removeSection(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.classes.removeSection(schoolId, id);
  }

  @Get('subjects')
  @RequirePermissions(VIEW)
  @ApiOperation({ summary: 'Subjects', description: 'search matches name and code. sort: name, code, created_at.' })
  @ApiEnvelope(SubjectDto, { paginated: true })
  listSubjects(@SchoolId() schoolId: number, @Query() query: SubjectQueryDto) {
    return this.subjects.list(schoolId, query);
  }

  @Post('subjects')
  @RequirePermissions(MANAGE)
  @ResponseMessage('Subject created')
  @ApiOperation({ summary: 'Create a subject' })
  @ApiEnvelope(SubjectDto, { status: HttpStatus.CREATED, message: 'Subject created' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  createSubject(@SchoolId() schoolId: number, @Body() dto: SubjectInputDto) {
    return this.subjects.create(schoolId, dto);
  }

  @Patch('subjects/:id')
  @RequirePermissions(MANAGE)
  @ResponseMessage('Subject updated')
  @ApiOperation({ summary: 'Update a subject' })
  @ApiEnvelope(SubjectDto, { message: 'Subject updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  updateSubject(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSubjectDto) {
    return this.subjects.update(schoolId, id, dto);
  }

  @Delete('subjects/:id')
  @RequirePermissions(MANAGE)
  @ResponseMessage('Subject deleted')
  @ApiOperation({ summary: 'Delete a subject that no class uses' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  removeSubject(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.subjects.remove(schoolId, id);
  }

  @Get('holidays')
  @RequirePermissions(VIEW)
  @ApiOperation({ summary: 'Holiday calendar, oldest first' })
  @ApiEnvelope(HolidayDto, { isArray: true })
  listHolidays(@SchoolId() schoolId: number, @Query() query: HolidayQueryDto) {
    return this.holidays.list(schoolId, query);
  }

  @Post('holidays')
  @RequirePermissions(MANAGE)
  @ResponseMessage('Holiday added')
  @ApiOperation({ summary: 'Add a holiday, emergency closure or event' })
  @ApiEnvelope(HolidayDto, { status: HttpStatus.CREATED, message: 'Holiday added' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  createHoliday(@SchoolId() schoolId: number, @Body() dto: HolidayInputDto) {
    return this.holidays.create(schoolId, dto);
  }

  @Patch('holidays/:id')
  @RequirePermissions(MANAGE)
  @ResponseMessage('Holiday updated')
  @ApiOperation({ summary: 'Update a holiday' })
  @ApiEnvelope(HolidayDto, { message: 'Holiday updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  updateHoliday(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateHolidayDto) {
    return this.holidays.update(schoolId, id, dto);
  }

  @Delete('holidays/:id')
  @RequirePermissions(MANAGE)
  @ResponseMessage('Holiday deleted')
  @ApiOperation({ summary: 'Delete a holiday' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  removeHoliday(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.holidays.remove(schoolId, id);
  }
}
