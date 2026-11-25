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
import { ApiErrors, AuthUser, CurrentUser, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import { AcademicsService } from './academics.service';
import {
  CreateLessonPlanDto,
  CreateOnlineClassDto,
  CreateStudyMaterialDto,
  CreateSyllabusUnitDto,
  UpdateLessonPlanDto,
  UpdateOnlineClassStatusDto,
  UpdateSyllabusUnitDto,
} from './dto/academics.dto';

@ApiTags('Admin · Academics')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/academics')
export class AcademicsController {
  constructor(private readonly academics: AcademicsService) {}

  // === 1. SYLLABUS UNITS ===
  @Get('syllabus')
  @RequirePermissions(PERMISSIONS.TIMETABLE_VIEW)
  @ApiOperation({ summary: 'List syllabus curriculum units with completion progress' })
  listSyllabus(
    @SchoolId() schoolId: number,
    @Query('class_id') classId?: string,
    @Query('subject_id') subjectId?: string,
    @Query('academic_year_id') yearId?: string,
  ) {
    return this.academics.listSyllabusUnits(
      schoolId,
      classId ? Number(classId) : undefined,
      subjectId ? Number(subjectId) : undefined,
      yearId ? Number(yearId) : undefined,
    );
  }

  @Post('syllabus')
  @RequirePermissions(PERMISSIONS.TIMETABLE_MANAGE)
  @ResponseMessage('Syllabus unit created')
  @ApiOperation({ summary: 'Create a syllabus unit / chapter' })
  createSyllabus(@SchoolId() schoolId: number, @Body() dto: CreateSyllabusUnitDto) {
    return this.academics.createSyllabusUnit(schoolId, dto);
  }

  @Patch('syllabus/:id')
  @RequirePermissions(PERMISSIONS.TIMETABLE_MANAGE)
  @ResponseMessage('Syllabus unit updated')
  @ApiOperation({ summary: 'Update syllabus unit completion % and details' })
  updateSyllabus(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) unitId: number,
    @Body() dto: UpdateSyllabusUnitDto,
  ) {
    return this.academics.updateSyllabusUnit(schoolId, unitId, dto);
  }

  @Delete('syllabus/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.TIMETABLE_MANAGE)
  @ApiOperation({ summary: 'Delete a syllabus unit' })
  deleteSyllabus(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) unitId: number) {
    return this.academics.deleteSyllabusUnit(schoolId, unitId);
  }

  // === 2. LESSON PLANS ===
  @Get('lesson-plans')
  @RequirePermissions(PERMISSIONS.TIMETABLE_VIEW)
  @ApiOperation({ summary: 'List teacher lesson plans' })
  listLessonPlans(
    @SchoolId() schoolId: number,
    @Query('section_id') sectionId?: string,
    @Query('teacher_id') teacherId?: string,
    @Query('unit_id') unitId?: string,
    @Query('date') date?: string,
  ) {
    return this.academics.listLessonPlans(
      schoolId,
      sectionId ? Number(sectionId) : undefined,
      teacherId ? Number(teacherId) : undefined,
      unitId ? Number(unitId) : undefined,
      date,
    );
  }

  @Post('lesson-plans')
  @RequirePermissions(PERMISSIONS.TIMETABLE_VIEW)
  @ResponseMessage('Lesson plan drafted')
  @ApiOperation({ summary: 'Draft a new weekly lesson plan' })
  createLessonPlan(@SchoolId() schoolId: number, @CurrentUser() user: AuthUser, @Body() dto: CreateLessonPlanDto) {
    return this.academics.createLessonPlan(schoolId, user.id, dto);
  }

  @Patch('lesson-plans/:id')
  @RequirePermissions(PERMISSIONS.TIMETABLE_VIEW)
  @ResponseMessage('Lesson plan updated')
  @ApiOperation({ summary: 'Update or approve a lesson plan' })
  updateLessonPlan(
    @SchoolId() schoolId: number,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) planId: number,
    @Body() dto: UpdateLessonPlanDto,
  ) {
    return this.academics.updateLessonPlan(schoolId, planId, user.id, dto);
  }

  // === 3. STUDY MATERIALS & E-CONTENT ===
  @Get('study-materials')
  @RequirePermissions(PERMISSIONS.TIMETABLE_VIEW)
  @ApiOperation({ summary: 'List study materials, worksheets, and e-learning resources' })
  listStudyMaterials(
    @SchoolId() schoolId: number,
    @Query('class_id') classId?: string,
    @Query('subject_id') subjectId?: string,
    @Query('section_id') sectionId?: string,
    @Query('unit_id') unitId?: string,
  ) {
    return this.academics.listStudyMaterials(
      schoolId,
      classId ? Number(classId) : undefined,
      subjectId ? Number(subjectId) : undefined,
      sectionId ? Number(sectionId) : undefined,
      unitId ? Number(unitId) : undefined,
    );
  }

  @Post('study-materials')
  @RequirePermissions(PERMISSIONS.TIMETABLE_VIEW)
  @ResponseMessage('Study material published')
  @ApiOperation({ summary: 'Upload/share study notes, PDF, or video link' })
  createStudyMaterial(
    @SchoolId() schoolId: number,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateStudyMaterialDto,
  ) {
    return this.academics.createStudyMaterial(schoolId, user.id, dto);
  }

  @Delete('study-materials/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.TIMETABLE_VIEW)
  @ApiOperation({ summary: 'Delete a study material item' })
  deleteStudyMaterial(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) materialId: number) {
    return this.academics.deleteStudyMaterial(schoolId, materialId);
  }

  // === 4. ONLINE CLASSES (AGORA RTC) ===
  @Get('online-classes')
  @RequirePermissions(PERMISSIONS.TIMETABLE_VIEW)
  @ApiOperation({ summary: 'List live and scheduled group online classes' })
  listOnlineClasses(
    @SchoolId() schoolId: number,
    @Query('section_id') sectionId?: string,
    @Query('teacher_id') teacherId?: string,
    @Query('status') status?: string,
  ) {
    return this.academics.listOnlineClasses(
      schoolId,
      sectionId ? Number(sectionId) : undefined,
      teacherId ? Number(teacherId) : undefined,
      status,
    );
  }

  @Post('online-classes')
  @RequirePermissions(PERMISSIONS.TIMETABLE_VIEW)
  @ResponseMessage('Online class scheduled')
  @ApiOperation({ summary: 'Schedule a new online live video class' })
  createOnlineClass(@SchoolId() schoolId: number, @CurrentUser() user: AuthUser, @Body() dto: CreateOnlineClassDto) {
    return this.academics.createOnlineClass(schoolId, user.id, dto);
  }

  @Get('online-classes/:id/rtc-token')
  @RequirePermissions(PERMISSIONS.TIMETABLE_VIEW)
  @ApiOperation({ summary: 'Retrieve Agora RTC broadcast token for online classroom' })
  getOnlineClassRtcToken(
    @SchoolId() schoolId: number,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) classId: number,
  ) {
    return this.academics.getOnlineClassRtcToken(schoolId, classId, user.id);
  }

  @Patch('online-classes/:id/status')
  @RequirePermissions(PERMISSIONS.TIMETABLE_VIEW)
  @ResponseMessage('Online class status updated')
  @ApiOperation({ summary: 'Update online class status (live, completed)' })
  updateOnlineClassStatus(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) classId: number,
    @Body() dto: UpdateOnlineClassStatusDto,
  ) {
    return this.academics.updateOnlineClassStatus(schoolId, classId, dto.status);
  }
}
