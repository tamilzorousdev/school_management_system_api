import { Body, Controller, Delete, Get, HttpStatus, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
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
import {
  BelowAverageDto,
  BelowAverageQueryDto,
  ClassPerformanceDto,
  PerformanceQueryDto,
  SpecialClassDto,
  SpecialClassInputDto,
  SpecialClassQueryDto,
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
  @ApiOperation({ summary: 'Special classes, with the day, period, teacher and students' })
  @ApiEnvelope(SpecialClassDto, { isArray: true })
  list(@SchoolId() schoolId: number, @Query() query: SpecialClassQueryDto) {
    return this.specials.list(schoolId, query.section_id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.TIMETABLE_MANAGE)
  @ResponseMessage('Special class created')
  @ApiOperation({
    summary: 'Create a special class for chosen students: one dedicated period every week',
    description:
      'The period repeats every week on day_of_week. The teacher must be free then (409 TEACHER_CLASH) and within their weekly limit (409 TEACHER_OVER_LIMIT); a section has one special class per period (409 SPECIAL_CLASS_CLASH). Every student must be in the section (400 STUDENT_NOT_IN_SECTION). Parents of the students get a notification.',
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
    summary: 'Change a special class: students, teacher, day, period or title',
    description: 'Same checks as create. Parents of newly added students get a notification.',
  })
  @ApiEnvelope(SpecialClassDto, { message: 'Special class saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  update(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSpecialClassDto) {
    return this.specials.update(schoolId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.TIMETABLE_MANAGE)
  @ResponseMessage('Special class removed')
  @ApiOperation({ summary: 'Stop a special class' })
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
  ) {}

  @Get()
  @ApiOperation({ summary: 'Special classes I take: day, period, time, section and students' })
  @ApiEnvelope(SpecialClassDto, { isArray: true })
  mine(@CurrentUser() user: AuthUser) {
    return this.specials.forTeacher(this.access.teacherSchool(user), user.id);
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
    summary: 'Special classes the child attends: subject, teacher, day, period and time',
    description: 'students holds only this child.',
  })
  @ApiEnvelope(SpecialClassDto, { isArray: true })
  async forChild(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.specials.forStudent(await this.access.childSchool(user.id, id), id);
  }
}
