import { Body, Controller, Get, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequireRoles, ResponseMessage } from '@app/common';
import { ROLES } from '../access/access.catalog';
import { AssignmentsService } from '../staff/assignments.service';
import { DigitalIdDto } from '../student-lifecycle/dto/lifecycle.dto';
import { StudentLifecycleService } from '../student-lifecycle/student-lifecycle.service';
import { BehaviourInputDto, BehaviourNoteDto, HealthDto, StudentDocumentDto } from '../student-records/dto/records.dto';
import { StudentRecordsService } from '../student-records/student-records.service';
import { StudentDetailDto } from '../students/dto/student-response.dto';
import { StudentsService } from '../students/students.service';
import { ChildCardDto } from './dto/mobile.dto';
import { BenchPlanDto, BenchQueryDto, RosterQueryDto, RosterStudentDto } from './dto/teacher-app.dto';
import {
  ChildTeacherProfileDto,
  ChildTeachersOverviewDto,
  ChildTimetableDto,
  ChildTimetableQueryDto,
} from './dto/parent-teachers.dto';
import { MobileAccessService } from './mobile-access.service';
import { ParentTeachersService } from './parent-teachers.service';
import { MyClassDto, TeacherProfileDto } from './dto/teacher-insights.dto';
import { TeacherAppService } from './teacher-app.service';
import { TeacherInsightsService } from './teacher-insights.service';
import { BankDetailsDto, QualificationDto, StaffDocumentDto } from '../staff/dto/staff-response.dto';
import { StaffService } from '../staff/staff.service';
import { AppraisalsService } from '../staff/appraisals.service';
import { StaffAppraisalCommentDto, StaffAppraisalDto } from '../staff/dto/staff-appraisal.dto';
import { HolidaysService } from '../setup/holidays.service';
import { HolidayQueryDto, MobileHolidayOverviewDto } from '../setup/dto/setup.dto';
import { TEACHER_MODULE_TAGS } from './teacher-modules.catalog';
import { PARENT_MODULE_TAGS } from './parent-modules.catalog';

@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND)
@RequireRoles(ROLES.PARENT)
@Controller('mobile/parent/children/:id')
export class MobileParentChildController {
  constructor(
    private readonly access: MobileAccessService,
    private readonly records: StudentRecordsService,
    private readonly lifecycle: StudentLifecycleService,
    private readonly parentTeachers: ParentTeachersService,
  ) {}

  @Get('timetable')
  @ApiTags(PARENT_MODULE_TAGS.MODULE_1)
  @ApiOperation({
    summary: 'The child\u2019s periods for a day (default today) with subject, teacher and room, breaks included',
    description:
      'state is done, now, next or later (only today). When a proxy takes a period, teacher is the proxy and usual_teacher the regular one; a combined class has a note. Empty periods on Sundays and holidays.',
  })
  @ApiEnvelope(ChildTimetableDto)
  @ApiErrors(HttpStatus.BAD_REQUEST)
  async timetable(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ChildTimetableQueryDto,
  ) {
    return this.parentTeachers.timetable(await this.access.childSchool(user.id, id), id, query.date);
  }

  @Get('teachers-overview')
  @ApiTags(PARENT_MODULE_TAGS.MODULE_1)
  @ApiOperation({
    summary: 'The child’s class teacher on its own, then the subject teachers',
    description:
      'class_teacher is null when the section has no class teacher. subject_teachers leaves out the class teacher. Each has designation, experience, photo and the subjects taught to this child; open one with GET .../teachers/{teacherId}.',
  })
  @ApiEnvelope(ChildTeachersOverviewDto)
  async teachersOverview(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.parentTeachers.overview(await this.access.childSchool(user.id, id), id, user.id);
  }

  @Get('teachers/:teacherId')
  @ApiTags(PARENT_MODULE_TAGS.MODULE_1)
  @ApiOperation({
    summary: 'Teacher profile: photo, designation, experience, qualifications and the classes they handle',
    description:
      'Only teachers of this child (404 TEACHER_NOT_FOUND otherwise). Phone, email, address and other staff records are never shown.',
  })
  @ApiEnvelope(ChildTeacherProfileDto)
  async teacherProfile(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('teacherId', ParseIntPipe) teacherId: number,
  ) {
    return this.parentTeachers.teacherProfile(await this.access.childSchool(user.id, id), id, teacherId, user.id);
  }

  @Get()
  @ApiTags(PARENT_MODULE_TAGS.MODULE_1)
  @ApiOperation({ summary: 'Child card: class, section, class teacher, photo, blood group and tile badges' })
  @ApiEnvelope(ChildCardDto)
  card(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.access.childCard(user.id, id);
  }

  @Get('id-card')
  @ApiTags(PARENT_MODULE_TAGS.MODULE_1)
  @ApiOperation({ summary: 'Digital ID card. Draw qr_token as a QR code; the bus attendant scans it.' })
  @ApiEnvelope(DigitalIdDto)
  async idCard(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.lifecycle.digitalId(await this.access.childSchool(user.id, id), id);
  }

  @Get('documents')
  @ApiTags(PARENT_MODULE_TAGS.MODULE_4)
  @ApiOperation({ summary: 'Documents the school shares with parents, with their verification status' })
  @ApiEnvelope(StudentDocumentDto, { isArray: true })
  async documents(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.records.listDocuments(await this.access.childSchool(user.id, id), id, { parent: true });
  }

  @Get('health')
  @ApiTags(PARENT_MODULE_TAGS.MODULE_4)
  @ApiOperation({ summary: 'Health summary and vaccination log (read-only)' })
  @ApiEnvelope(HealthDto)
  async health(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.records.getHealth(await this.access.childSchool(user.id, id), id);
  }

  @Get('behaviour')
  @ApiTags(PARENT_MODULE_TAGS.MODULE_4)
  @ApiOperation({ summary: 'Behaviour notes shared with parents (read-only)' })
  @ApiEnvelope(BehaviourNoteDto, { isArray: true })
  async behaviour(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.records.listBehaviour(await this.access.childSchool(user.id, id), id, { parent: true });
  }
}

@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@RequireRoles(ROLES.TEACHER, ROLES.HOD, ROLES.PRINCIPAL)
@Controller('mobile/teacher')
export class MobileTeacherController {
  constructor(
    private readonly access: MobileAccessService,
    private readonly assignments: AssignmentsService,
    private readonly students: StudentsService,
    private readonly records: StudentRecordsService,
    private readonly teacherApp: TeacherAppService,
    private readonly insights: TeacherInsightsService,
    private readonly staff: StaffService,
    private readonly holidaysService: HolidaysService,
    private readonly appraisalsService: AppraisalsService,
  ) {}

  @Get('classes')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_3)
  @ApiOperation({
    summary: 'My classes this year: class teacher sections first, then sections I teach, with my subjects',
    description:
      'Each class has periods_per_week (my timetable periods there) and academic_year. My class-teacher sections also have class_teacher_summary: present and absent today, attendance marked, fees overdue and due, and parent leave requests waiting.',
  })
  @ApiEnvelope(MyClassDto, { isArray: true })
  classes(@CurrentUser() user: AuthUser) {
    return this.insights.myClasses(this.access.teacherSchool(user), user.id);
  }

  @Get('profile')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_1)
  @ApiOperation({
    summary: 'My staff profile: designation, department, subjects, HOD, class teacher of, weekly load',
    description: 'headline is ready for the Me screen, for example "Mathematics · HOD · Class teacher 6 - A".',
  })
  @ApiEnvelope(TeacherProfileDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  profile(@CurrentUser() user: AuthUser) {
    return this.insights.profile(this.access.teacherSchool(user), user);
  }

  @Get('qualifications')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_1)
  @ApiOperation({
    summary: 'My academic and professional qualifications',
    description: 'Degrees, specializations, institutions and completion years on file with the school.',
  })
  @ApiEnvelope(QualificationDto, { isArray: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  qualifications(@CurrentUser() user: AuthUser) {
    return this.staff.getQualificationsByUserId(this.access.teacherSchool(user), user.id);
  }

  @Get('documents')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_1)
  @ApiOperation({
    summary: 'My uploaded staff verification documents',
    description:
      'ID proof, address proof, degree certificate, experience letter, etc. with verification status, verifier name, remarks and download file URL.',
  })
  @ApiEnvelope(StaffDocumentDto, { isArray: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  documents(@CurrentUser() user: AuthUser) {
    return this.staff.getDocumentsByUserId(this.access.teacherSchool(user), user.id);
  }

  @Get('documents/:id')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_1)
  @ApiOperation({
    summary: 'View one of my uploaded staff verification documents by ID with signed URL',
    description: 'Document details, verification status, verifier name, remarks and file download/view URL.',
  })
  @ApiEnvelope(StaffDocumentDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  document(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.staff.getDocumentByUserId(this.access.teacherSchool(user), user.id, id);
  }

  @Get('bank')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_1)
  @ApiOperation({
    summary: 'My registered bank account and PAN details',
    description: 'Account holder, bank name, IFSC, account number and PAN on file with the school.',
  })
  @ApiEnvelope(BankDetailsDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  bank(@CurrentUser() user: AuthUser) {
    return this.staff.getBankByUserId(this.access.teacherSchool(user), user.id);
  }

  @Get('appraisals')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_1)
  @ApiOperation({
    summary: 'My performance reviews and appraisals, newest first',
    description: 'Evaluations, scores across teaching, student outcomes, discipline, conduct, and overall rating.',
  })
  @ApiEnvelope(StaffAppraisalDto, { isArray: true })
  appraisals(@CurrentUser() user: AuthUser) {
    return this.appraisalsService.myAppraisals(this.access.teacherSchool(user), user.id);
  }

  @Get('appraisals/:id')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_1)
  @ApiOperation({
    summary: 'Details of one of my performance reviews by ID',
    description: 'Metrics breakdown, scores, reviewer remarks, goals, strengths, and recommended increment.',
  })
  @ApiEnvelope(StaffAppraisalDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  appraisal(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.appraisalsService.myAppraisal(this.access.teacherSchool(user), user.id, id);
  }

  @Post('appraisals/:id/comments')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_1)
  @ResponseMessage('Appraisal comments submitted')
  @ApiOperation({
    summary: 'Add my comments / self-acknowledgement to a finalized appraisal',
  })
  @ApiEnvelope(StaffAppraisalDto, { message: 'Appraisal comments submitted' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  addAppraisalComment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: StaffAppraisalCommentDto,
  ) {
    return this.appraisalsService.addStaffRemarks(this.access.teacherSchool(user), user.id, id, dto);
  }

  @Get('holidays')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_10)
  @ApiOperation({
    summary: 'School holidays calendar, upcoming holidays, and next holiday countdown',
    description:
      'Next upcoming school holiday countdown, list of upcoming holidays from today, and full academic year holiday calendar with date ranges and day counts.',
  })
  @ApiEnvelope(MobileHolidayOverviewDto)
  holidays(@CurrentUser() user: AuthUser, @Query() query: HolidayQueryDto) {
    return this.holidaysService.overview(this.access.teacherSchool(user), query);
  }

  @Get('sections/:id/students')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_3)
  @ApiOperation({
    summary: 'Class roster, sorted by roll number, name or exam rank, ascending or descending',
    description:
      'Default roll_no asc. sort=rank uses the latest published exam of the class (or exam_id); students without a roll number or rank come last in both directions. fee is filled only for the class teacher of the section (paid, partly_paid, due, overdue with balance and next due date).',
  })
  @ApiEnvelope(RosterStudentDto, { isArray: true })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.BAD_REQUEST)
  async roster(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() query: RosterQueryDto) {
    const schoolId = this.access.teacherSchool(user);
    await this.assignments.assertTeachesSection(schoolId, user.id, id);
    const classTeacher = (await this.access.classTeacherSections(schoolId, user.id)).includes(id);
    return this.teacherApp.roster(schoolId, id, classTeacher, query);
  }

  @Get('sections/:id/benches')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_3)
  @ApiOperation({
    summary: 'Students split into bench groups (First, Second, … Last), in roll number, name or rank order',
    description:
      'The section is sorted (sort and order, as in the roster) and split into `groups` (default 3) as evenly as possible, front groups first: 30 students give First 10, Second 10, Last 10; 31 give 11, 10, 10. Each student has the same fields as the roster.',
  })
  @ApiEnvelope(BenchPlanDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.BAD_REQUEST)
  async benches(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() query: BenchQueryDto) {
    const schoolId = this.access.teacherSchool(user);
    await this.assignments.assertTeachesSection(schoolId, user.id, id);
    const classTeacher = (await this.access.classTeacherSections(schoolId, user.id)).includes(id);
    return this.teacherApp.benches(schoolId, id, classTeacher, query);
  }

  @Get('students/:id')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_3)
  @ApiOperation({ summary: 'Student detail (read-only) for a student in one of my sections' })
  @ApiEnvelope(StudentDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  async student(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const schoolId = this.access.teacherSchool(user);
    await this.assignments.assertTeachesStudent(schoolId, user.id, id);
    return this.students.get(schoolId, id);
  }

  @Get('students/:id/behaviour')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_3)
  @ApiOperation({ summary: 'Behaviour notes of a student in one of my sections' })
  @ApiEnvelope(BehaviourNoteDto, { isArray: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  async behaviour(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const schoolId = this.access.teacherSchool(user);
    await this.assignments.assertTeachesStudent(schoolId, user.id, id);
    return this.records.listBehaviour(schoolId, id);
  }

  @Post('students/:id/behaviour')
  @ApiTags(TEACHER_MODULE_TAGS.MODULE_3)
  @ResponseMessage('Note added')
  @ApiOperation({ summary: 'Add a behaviour note. Parents see it unless visible_to_parent is false.' })
  @ApiEnvelope(BehaviourNoteDto, { status: HttpStatus.CREATED, message: 'Note added' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  async addBehaviour(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: BehaviourInputDto,
  ) {
    const schoolId = this.access.teacherSchool(user);
    await this.assignments.assertTeachesStudent(schoolId, user.id, id);
    return this.records.addBehaviour(schoolId, id, dto);
  }
}
