import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
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
import { MobileAccessService } from '../mobile/mobile-access.service';
import { AssignmentsService } from '../staff/assignments.service';
import {
  BelowAverageDto,
  BelowAverageQueryDto,
  ClassPerformanceDto,
  PerformanceQueryDto,
  SpecialClassDto,
  SpecialClassInputDto,
  SpecialClassQueryDto,
  SpecialClassSettingsDto,
  SpecialClassSettingsResultDto,
  SpecialMarkDto,
  SpecialRosterDto,
  SpecialRosterQueryDto,
  UpdateSpecialClassDto,
} from './dto/performance.dto';
import { PerformanceService } from './performance.service';
import { SpecialClassesService } from './special-classes.service';

@ApiTags('Admin · Class performance')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/performance')
export class PerformanceController {
  constructor(private readonly performance: PerformanceService) {}

  @Get('classes')
  @RequirePermissions(PERMISSIONS.EXAMS_VIEW)
  @ApiOperation({
    summary: 'Class-wise report: average, pass, fail and attendance % for every section',
    description:
      'Counts every published exam of the academic year, or one exam with exam_id. pass_percent and fail_percent are shares of results (a student in one exam); a result fails when any subject is below its pass mark or absent. attendance_percent is this academic year (half day counts half). below_average is how many students are under the section average. totals is the whole school.',
  })
  @ApiEnvelope(ClassPerformanceDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  classes(@SchoolId() schoolId: number, @Query() query: PerformanceQueryDto) {
    return this.performance.classes(schoolId, query);
  }

  @Get('sections/:id/below-average')
  @RequirePermissions(PERMISSIONS.EXAMS_VIEW)
  @ApiOperation({
    summary: 'Students below the section average, lowest first, with weak subjects and attendance',
    description:
      'line is the section average, or the % given in below. weak_subjects are up to 3 subjects where the student is most below the section. special_classes shows support classes the student already attends. Pick students here and create a special class for them.',
  })
  @ApiEnvelope(BelowAverageDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  belowAverage(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: BelowAverageQueryDto,
  ) {
    return this.performance.belowAverage(schoolId, id, query);
  }
}

@ApiTags('Admin · Special classes')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/special-classes')
export class SpecialClassesController {
  constructor(private readonly specials: SpecialClassesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.TIMETABLE_VIEW)
  @ApiOperation({
    summary: 'Special and extra classes, with when they run, the teacher and students',
    description: 'Filter by section_id (who in this class has one) or teacher_user_id (what a teacher takes).',
  })
  @ApiEnvelope(SpecialClassDto, { isArray: true })
  list(@SchoolId() schoolId: number, @Query() query: SpecialClassQueryDto) {
    return this.specials.list(schoolId, query);
  }

  @Get('settings')
  @RequirePermissions(PERMISSIONS.TIMETABLE_VIEW)
  @ApiOperation({ summary: 'Classes that can have a whole-class special class' })
  @ApiEnvelope(SpecialClassSettingsResultDto)
  settings(@SchoolId() schoolId: number) {
    return this.specials.settings(schoolId);
  }

  @Put('settings')
  @RequirePermissions(PERMISSIONS.TIMETABLE_MANAGE)
  @ResponseMessage('Special class settings saved')
  @ApiOperation({ summary: 'Choose the classes that can have a whole-class special class (null = every class)' })
  @ApiEnvelope(SpecialClassSettingsResultDto, { message: 'Special class settings saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  saveSettings(@SchoolId() schoolId: number, @Body() dto: SpecialClassSettingsDto) {
    return this.specials.saveSettings(schoolId, dto.class_ids);
  }

  @Get(':id/attendance')
  @RequirePermissions(PERMISSIONS.TIMETABLE_VIEW)
  @ApiOperation({ summary: 'Attendance of a special or extra class for a date' })
  @ApiEnvelope(SpecialRosterDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  roster(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Query() query: SpecialRosterQueryDto) {
    return this.specials.roster(schoolId, id, query.date);
  }

  @Put(':id/attendance')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_MANAGE)
  @ResponseMessage('Attendance saved')
  @ApiOperation({
    summary: 'Save attendance of a special or extra class',
    description: 'Students not sent stay present. 400 NOT_A_CLASS_DAY, FUTURE_DATE, STUDENT_NOT_IN_CLASS.',
  })
  @ApiEnvelope(SpecialRosterDto, { message: 'Attendance saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  mark(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SpecialMarkDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.specials.mark(schoolId, id, dto, user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.TIMETABLE_MANAGE)
  @ResponseMessage('Special class created')
  @ApiOperation({
    summary: 'Create a special class (whole section) or an extra class (chosen students)',
    description:
      'timing=period keeps one period every week (the students miss that regular period). timing=extra_time runs at its own time before or after school, in a break or lunch, or on a Sunday or holiday, on the chosen weekdays between start_date and end_date (no weekdays = that one date). Checks: 409 DURING_CLASS_TIME (overlaps a teaching period on a school day), TEACHER_CLASH, STUDENT_CLASH, SPECIAL_CLASS_CLASH; 409 TEACHER_OVER_LIMIT only for period classes; 400 CLASS_NOT_ALLOWED when whole-class special classes are not turned on for the class. The teacher and the parents are told at once.',
  })
  @ApiEnvelope(SpecialClassDto, { message: 'Special class created' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  create(@SchoolId() schoolId: number, @Body() dto: SpecialClassInputDto) {
    return this.specials.create(schoolId, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.TIMETABLE_MANAGE)
  @ResponseMessage('Special class saved')
  @ApiOperation({
    summary: 'Change a special or extra class',
    description:
      'Same checks as create. New students\u2019 parents are told it was added, removed students\u2019 parents that it is cancelled, and when the time changes the teacher and parents are told the new time.',
  })
  @ApiEnvelope(SpecialClassDto, { message: 'Special class saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  update(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSpecialClassDto) {
    return this.specials.update(schoolId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.TIMETABLE_MANAGE)
  @ResponseMessage('Special class removed')
  @ApiOperation({ summary: 'Stop a special or extra class; the teacher and parents are told it is cancelled' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  remove(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.specials.remove(schoolId, id);
  }
}

@ApiTags('Mobile · Teacher · Special classes')
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@RequireRoles(ROLES.TEACHER, ROLES.HOD, ROLES.PRINCIPAL)
@Controller('mobile/teacher/special-classes')
export class MobileTeacherSpecialClassesController {
  constructor(
    private readonly access: MobileAccessService,
    private readonly specials: SpecialClassesService,
    private readonly assignments: AssignmentsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Special and extra classes I take: when, section and students' })
  @ApiEnvelope(SpecialClassDto, { isArray: true })
  mine(@CurrentUser() user: AuthUser) {
    return this.specials.forTeacher(this.access.teacherSchool(user), user.id);
  }

  @Get('sections/:sectionId')
  @ApiOperation({ summary: 'Who in this section has a special or extra class' })
  @ApiEnvelope(SpecialClassDto, { isArray: true })
  async forSection(@CurrentUser() user: AuthUser, @Param('sectionId', ParseIntPipe) sectionId: number) {
    const schoolId = this.access.teacherSchool(user);
    await this.assignments.assertTeachesSection(schoolId, user.id, sectionId);
    return this.specials.list(schoolId, { section_id: sectionId });
  }

  @Get(':id/attendance')
  @ApiOperation({ summary: 'Attendance list of my special or extra class for a date (default present)' })
  @ApiEnvelope(SpecialRosterDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  roster(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() query: SpecialRosterQueryDto) {
    return this.specials.roster(this.access.teacherSchool(user), id, query.date, user.id);
  }

  @Put(':id/attendance')
  @ResponseMessage('Attendance saved')
  @ApiOperation({
    summary: 'Save attendance of my special or extra class',
    description:
      'Send the students to mark (present, absent or late); the rest stay present. Parents of absent students get an alert the same day. 403 NOT_YOUR_SPECIAL_CLASS, 400 NOT_A_CLASS_DAY, FUTURE_DATE.',
  })
  @ApiEnvelope(SpecialRosterDto, { message: 'Attendance saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  mark(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: SpecialMarkDto) {
    return this.specials.mark(this.access.teacherSchool(user), id, dto, user, true);
  }
}

@ApiTags('Mobile · Parent · Special classes')
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND)
@RequireRoles(ROLES.PARENT)
@Controller('mobile/parent/children/:id/special-classes')
export class MobileParentSpecialClassesController {
  constructor(
    private readonly access: MobileAccessService,
    private readonly specials: SpecialClassesService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Special and extra classes the child attends, with when they run and the child\u2019s attendance',
    description: 'students holds only this child; attendance counts the days taken in that class.',
  })
  @ApiEnvelope(SpecialClassDto, { isArray: true })
  async forChild(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.specials.forStudent(await this.access.childSchool(user.id, id), id);
  }
}
