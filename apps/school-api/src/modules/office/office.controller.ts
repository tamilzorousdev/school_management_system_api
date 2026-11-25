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
import {
  ApiEnvelope,
  ApiErrors,
  AuthUser,
  CurrentUser,
  RequirePermissions,
  RequireRoles,
  ResponseMessage,
} from '@app/common';
import { ApiPdf, pdfFile } from '../../shared/pdf-response';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { ReportCardQueryDto } from '../exams/dto/report-card.dto';
import { ReportCardsService } from '../exams/report-cards.service';
import { PERMISSIONS, ROLES } from '../access/access.catalog';
import { DecisionDto, GatePassDto } from '../gate/dto/gate.dto';
import { GatePassesService } from '../gate/gate-passes.service';
import { OFFICE_MODULE_TAGS } from '../mobile/office-modules.catalog';
import {
  AoDetailDto,
  AoWingsInputDto,
  ClassSectionsDto,
  MonitorDto,
  OfficeDashboardDto,
  OfficeHomeDto,
  OfficeMeDto,
  OfficeWingsDto,
  RemindResultDto,
  SectionStudentsDto,
  SectionStudentsQueryDto,
  Student360Dto,
  StudentDocumentDto,
  TimelineItemDto,
  TimelineQueryDto,
  UpdateWingDto,
  WingClassesDto,
  WingInputDto,
  WingSetupPageDto,
} from './dto/office.dto';
import { OfficeTeachersDto, SectionTeachersDto, TeacherDetailDto } from './dto/office-teachers.dto';
import { OfficeMonitorService } from './office-monitor.service';
import { OfficeTeachersService } from './office-teachers.service';
import { OfficeBusService } from './office-bus.service';
import { OfficeDriverDto, SectionBusDto } from './dto/office-bus.dto';
import { OfficeService } from './office.service';

const SCOPE_NOTE =
  'A wing AO sees only the classes of their wings; anything else is 404. The head AO (AO with no wing), principal and admin see the whole school.';
const ADMIN_PDF = '/api/v1/admin/students/{id}/report-card/pdf';
const MOBILE_PDF = '/api/v1/mobile/office/students/{id}/report-card/pdf';

@ApiTags('Admin · Office')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/office')
export class AdminOfficeController {
  constructor(
    private readonly office: OfficeService,
    private readonly monitorService: OfficeMonitorService,
    private readonly teachersService: OfficeTeachersService,
    private readonly busService: OfficeBusService,
  ) {}

  @Get('me')
  @RequirePermissions(PERMISSIONS.OFFICE_VIEW)
  @ApiOperation({
    summary: 'My office scope: limited to wings or the whole school, and whether I can open the AO monitor',
  })
  @ApiEnvelope(OfficeMeDto)
  me(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number) {
    return this.office.me(user, schoolId);
  }

  @Get('dashboard')
  @RequirePermissions(PERMISSIONS.OFFICE_VIEW)
  @ApiOperation({
    summary:
      'AO home dashboard: attendance today, fees collected and due with top defaulters, waiting items, latest exam per class with toppers, alerts; AO cards for the head AO',
    description: SCOPE_NOTE,
  })
  @ApiEnvelope(OfficeDashboardDto)
  dashboard(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number) {
    return this.monitorService.dashboard(user, schoolId);
  }

  @Get('wings')
  @RequirePermissions(PERMISSIONS.OFFICE_VIEW)
  @ApiOperation({
    summary: 'Level 1: wing cards with classes, students, attendance today, fee dues and waiting gate passes',
    description: SCOPE_NOTE,
  })
  @ApiEnvelope(OfficeWingsDto)
  wings(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number) {
    return this.office.wingCards(user, schoolId);
  }

  @Get('wings/:id/classes')
  @RequirePermissions(PERMISSIONS.OFFICE_VIEW)
  @ApiOperation({
    summary: 'Level 2: classes in a wing with their numbers (404 WING_NOT_FOUND)',
    description: SCOPE_NOTE,
  })
  @ApiEnvelope(WingClassesDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  wingClasses(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.office.wingClasses(user, schoolId, id);
  }

  @Get('classes/:id/sections')
  @RequirePermissions(PERMISSIONS.OFFICE_VIEW)
  @ApiOperation({
    summary:
      'Level 3: sections of a class: class teacher, attendance today, defaulters, latest exam average and toppers',
    description: `${SCOPE_NOTE} 404 CLASS_NOT_FOUND.`,
  })
  @ApiEnvelope(ClassSectionsDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  classSections(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.office.classSections(schoolId, id);
  }

  @Get('sections/:id/students')
  @RequirePermissions(PERMISSIONS.OFFICE_VIEW)
  @ApiOperation({
    summary: 'Level 4: students of a section with today, attendance %, fee due, latest exam % and rank, bus and flags',
    description: `${SCOPE_NOTE} filter: all, absent_today, fee_due, low_attendance. sort: roll_no (default), name, attendance, fee_due, last_exam. 404 SECTION_NOT_FOUND.`,
  })
  @ApiEnvelope(SectionStudentsDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  sectionStudents(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: SectionStudentsQueryDto,
  ) {
    return this.office.sectionStudents(schoolId, id, query);
  }

  @Get('students/:id')
  @RequirePermissions(PERMISSIONS.OFFICE_VIEW)
  @ApiOperation({
    summary:
      'Level 5: full student history: profile, family, bus, flags, attendance, fees, exams with rank, every year',
    description: `${SCOPE_NOTE} Every open is logged for the head AO. The other tabs use the existing /admin/students/{id}/… routes.`,
  })
  @ApiEnvelope(Student360Dto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  student(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.office.student(user, schoolId, id, ADMIN_PDF);
  }

  @Get('students/:id/timeline')
  @RequirePermissions(PERMISSIONS.OFFICE_VIEW)
  @ApiOperation({
    summary:
      'Student timeline, newest first: admission, classes, absences, leave, fees, exams, gate, behaviour, achievements, bus, documents, library',
    description: SCOPE_NOTE,
  })
  @ApiEnvelope(TimelineItemDto, { paginated: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  timeline(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Query() query: TimelineQueryDto) {
    return this.office.timeline(schoolId, id, query);
  }

  @Get('students/:id/documents')
  @RequirePermissions(PERMISSIONS.OFFICE_VIEW)
  @ApiOperation({
    summary: 'Student documents (view only) with signed links to open each file; every open is logged',
    description: SCOPE_NOTE,
  })
  @ApiEnvelope(StudentDocumentDto, { isArray: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  documents(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.office.documents(user, schoolId, id);
  }

  @Get('teachers')
  @RequirePermissions(PERMISSIONS.OFFICE_VIEW)
  @ApiOperation({
    summary:
      'Teachers of my wings: today (present, late, on leave, not checked in), subjects, sections, pass % and parent rating',
    description: SCOPE_NOTE,
  })
  @ApiEnvelope(OfficeTeachersDto)
  teachers(@SchoolId() schoolId: number) {
    return this.teachersService.list(schoolId);
  }

  @Get('sections/:id/bus')
  @RequirePermissions(PERMISSIONS.OFFICE_VIEW)
  @ApiOperation({
    summary:
      'School bus for one section today: each route with bus, driver (rating), attendant, trips and every student (boarded, not boarded, away)',
    description: `${SCOPE_NOTE} 404 SECTION_NOT_FOUND.`,
  })
  @ApiEnvelope(SectionBusDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  sectionBus(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.busService.section(schoolId, id);
  }

  @Get('drivers/:userId')
  @RequirePermissions(PERMISSIONS.OFFICE_VIEW)
  @ApiOperation({
    summary:
      'A driver or attendant: contact, routes, bus, licence expiry warnings, parent rating and recent remarks (view only)',
    description: '404 DRIVER_NOT_FOUND.',
  })
  @ApiEnvelope(OfficeDriverDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  driver(@SchoolId() schoolId: number, @Param('userId', ParseIntPipe) userId: number) {
    return this.busService.driver(schoolId, userId);
  }

  @Get('sections/:id/teachers')
  @RequirePermissions(PERMISSIONS.OFFICE_VIEW)
  @ApiOperation({
    summary: 'Teachers of one section: class teacher first, each subject they take with pass % in the latest exam',
    description: `${SCOPE_NOTE} 404 SECTION_NOT_FOUND.`,
  })
  @ApiEnvelope(SectionTeachersDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  sectionTeachers(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.teachersService.section(schoolId, id);
  }

  @Get('teachers/:userId')
  @RequirePermissions(PERMISSIONS.OFFICE_VIEW)
  @ApiOperation({
    summary:
      'One teacher: pass % per paper in the latest exam, parent rating with stars and recent remarks, this month attendance',
    description: `${SCOPE_NOTE} 404 TEACHER_NOT_FOUND.`,
  })
  @ApiEnvelope(TeacherDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  teacher(@SchoolId() schoolId: number, @Param('userId', ParseIntPipe) userId: number) {
    return this.teachersService.detail(schoolId, userId);
  }

  @Get('wing-setup')
  @RequirePermissions(PERMISSIONS.OFFICE_VIEW)
  @ApiOperation({ summary: 'Wings with their classes and AOs, every class with its wing, every AO with their wings' })
  @ApiEnvelope(WingSetupPageDto)
  setup(@SchoolId() schoolId: number) {
    return this.office.setupPage(schoolId);
  }

  @Post('wing-setup/wings')
  @RequirePermissions(PERMISSIONS.OFFICE_WINGS)
  @ResponseMessage('Wing added')
  @ApiOperation({
    summary: 'Add a wing by grade range (-1 LKG, 0 UKG, 1 to 12) or by exact classes',
    description: '409 WING_OVERLAP when a class would be in two wings.',
  })
  @ApiEnvelope(WingSetupPageDto, { status: HttpStatus.CREATED, message: 'Wing added' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  createWing(@SchoolId() schoolId: number, @Body() dto: WingInputDto) {
    return this.office.createWing(schoolId, dto);
  }

  @Patch('wing-setup/wings/:id')
  @RequirePermissions(PERMISSIONS.OFFICE_WINGS)
  @ResponseMessage('Wing saved')
  @ApiOperation({ summary: 'Change a wing (409 WING_OVERLAP, 404 WING_NOT_FOUND)' })
  @ApiEnvelope(WingSetupPageDto, { message: 'Wing saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  updateWing(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateWingDto) {
    return this.office.updateWing(schoolId, id, dto);
  }

  @Delete('wing-setup/wings/:id')
  @RequirePermissions(PERMISSIONS.OFFICE_WINGS)
  @ResponseMessage('Wing removed')
  @ApiOperation({ summary: 'Remove a wing; its AOs lose it (an AO left with no wing becomes a head AO)' })
  @ApiEnvelope(WingSetupPageDto, { message: 'Wing removed' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  removeWing(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.office.removeWing(schoolId, id);
  }

  @Put('wing-setup/aos/:userId')
  @RequirePermissions(PERMISSIONS.OFFICE_WINGS)
  @ResponseMessage('AO wings saved')
  @ApiOperation({
    summary: 'Set the wings of an AO, with optional dates for leave cover. An empty list makes them the head AO.',
    description: '404 AO_NOT_FOUND when the user is not an AO of this school.',
  })
  @ApiEnvelope(WingSetupPageDto, { message: 'AO wings saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  setAoWings(
    @CurrentUser() user: AuthUser,
    @SchoolId() schoolId: number,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: AoWingsInputDto,
  ) {
    return this.office.setAoWings(user, schoolId, userId, dto);
  }

  @Get('monitor')
  @RequirePermissions(PERMISSIONS.OFFICE_MONITOR)
  @ApiOperation({
    summary:
      'AO monitor: school totals and one card per AO (last active, waiting and overdue items, fees collected, attendance marked)',
    description: '403 HEAD_AO_ONLY for a wing AO.',
  })
  @ApiEnvelope(MonitorDto)
  monitor(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number) {
    return this.monitorService.monitor(user, schoolId);
  }

  @Get('monitor/aos/:userId')
  @RequirePermissions(PERMISSIONS.OFFICE_MONITOR)
  @ApiOperation({ summary: 'One AO: card, waiting items with age (oldest first) and the latest 60 actions' })
  @ApiEnvelope(AoDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  aoDetail(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number, @Param('userId', ParseIntPipe) userId: number) {
    return this.monitorService.detail(user, schoolId, userId);
  }

  @Post('monitor/aos/:userId/remind')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.OFFICE_MONITOR)
  @ResponseMessage('Reminder sent')
  @ApiOperation({ summary: 'Push a reminder to an AO about their waiting items (409 NOTHING_PENDING)' })
  @ApiEnvelope(RemindResultDto, { message: 'Reminder sent' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  remind(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number, @Param('userId', ParseIntPipe) userId: number) {
    return this.monitorService.remind(user, schoolId, userId);
  }
}

@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@RequireRoles(ROLES.AO)
@Controller('mobile/office')
export class MobileOfficeController {
  constructor(
    private readonly office: OfficeService,
    private readonly passes: GatePassesService,
    private readonly monitorService: OfficeMonitorService,
    private readonly cards: ReportCardsService,
    private readonly teachersService: OfficeTeachersService,
    private readonly busService: OfficeBusService,
  ) {}

  @Get('home')
  @ApiTags(OFFICE_MODULE_TAGS.MODULE_1)
  @ApiOperation({
    summary: 'Office home: my scope, wing cards and gate passes waiting in my wings',
    description: SCOPE_NOTE,
  })
  @ApiEnvelope(OfficeHomeDto)
  async home(@CurrentUser() user: AuthUser): Promise<OfficeHomeDto> {
    const schoolId = user.school_id!;
    const [me, wings, waiting] = await Promise.all([
      this.office.me(user, schoolId),
      this.office.wingCards(user, schoolId),
      this.passes.toApprove(schoolId, user),
    ]);
    return { me, wings, pending_gate_passes: waiting.length };
  }

  @Get('dashboard')
  @ApiTags(OFFICE_MODULE_TAGS.MODULE_1)
  @ApiOperation({
    summary:
      'Home dashboard: attendance today, fees collected and due with top defaulters, waiting items, latest exam per class with toppers, alerts; AO cards for the head AO',
    description: SCOPE_NOTE,
  })
  @ApiEnvelope(OfficeDashboardDto)
  dashboard(@CurrentUser() user: AuthUser) {
    return this.monitorService.dashboard(user, user.school_id!);
  }

  @Get('wings/:id/classes')
  @ApiTags(OFFICE_MODULE_TAGS.MODULE_2)
  @ApiOperation({ summary: 'Classes in a wing (404 WING_NOT_FOUND)' })
  @ApiEnvelope(WingClassesDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  wingClasses(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.office.wingClasses(user, user.school_id!, id);
  }

  @Get('classes/:id/sections')
  @ApiTags(OFFICE_MODULE_TAGS.MODULE_2)
  @ApiOperation({ summary: 'Sections of a class (404 CLASS_NOT_FOUND)' })
  @ApiEnvelope(ClassSectionsDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  classSections(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.office.classSections(user.school_id!, id);
  }

  @Get('sections/:id/students')
  @ApiTags(OFFICE_MODULE_TAGS.MODULE_2)
  @ApiOperation({
    summary: 'Students of a section (404 SECTION_NOT_FOUND)',
    description:
      'filter: all, absent_today, fee_due, low_attendance. sort: roll_no, name, attendance, fee_due, last_exam.',
  })
  @ApiEnvelope(SectionStudentsDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  sectionStudents(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: SectionStudentsQueryDto,
  ) {
    return this.office.sectionStudents(user.school_id!, id, query);
  }

  @Get('students/:id')
  @ApiTags(OFFICE_MODULE_TAGS.MODULE_3)
  @ApiOperation({ summary: 'Full student history (404 STUDENT_NOT_FOUND outside my wings)' })
  @ApiEnvelope(Student360Dto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  student(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.office.student(user, user.school_id!, id, MOBILE_PDF);
  }

  @Get('students/:id/timeline')
  @ApiTags(OFFICE_MODULE_TAGS.MODULE_3)
  @ApiOperation({ summary: 'Student timeline, newest first; type filters one kind' })
  @ApiEnvelope(TimelineItemDto, { paginated: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  timeline(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() query: TimelineQueryDto) {
    return this.office.timeline(user.school_id!, id, query);
  }

  @Get('students/:id/documents')
  @ApiTags(OFFICE_MODULE_TAGS.MODULE_3)
  @ApiOperation({ summary: 'Student documents (view only); open each with its signed url' })
  @ApiEnvelope(StudentDocumentDto, { isArray: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  documents(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.office.documents(user, user.school_id!, id);
  }

  @Get('students/:id/report-card/pdf')
  @ApiTags(OFFICE_MODULE_TAGS.MODULE_3)
  @ApiOperation({
    summary: 'Printable report card (PDF); same term_id / exam_id options as the admin web',
    description: '404 NO_PUBLISHED_RESULTS when there is nothing to print.',
  })
  @ApiPdf('Report card PDF')
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  async reportCard(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ReportCardQueryDto,
  ) {
    return pdfFile(await this.cards.pdf(user.school_id!, id, query));
  }

  @Get('teachers')
  @ApiTags(OFFICE_MODULE_TAGS.MODULE_2)
  @ApiOperation({ summary: 'Teachers of my wings with today status, pass % and parent rating' })
  @ApiEnvelope(OfficeTeachersDto)
  teachers(@CurrentUser() user: AuthUser) {
    return this.teachersService.list(user.school_id!);
  }

  @Get('sections/:id/bus')
  @ApiTags(OFFICE_MODULE_TAGS.MODULE_2)
  @ApiOperation({
    summary: 'School bus for one section today: routes, driver, trips and each student (404 SECTION_NOT_FOUND)',
  })
  @ApiEnvelope(SectionBusDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  sectionBus(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.busService.section(user.school_id!, id);
  }

  @Get('drivers/:userId')
  @ApiTags(OFFICE_MODULE_TAGS.MODULE_2)
  @ApiOperation({
    summary: 'A driver: contact, routes, licence warnings, parent rating and remarks (404 DRIVER_NOT_FOUND)',
  })
  @ApiEnvelope(OfficeDriverDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  driver(@CurrentUser() user: AuthUser, @Param('userId', ParseIntPipe) userId: number) {
    return this.busService.driver(user.school_id!, userId);
  }

  @Get('sections/:id/teachers')
  @ApiTags(OFFICE_MODULE_TAGS.MODULE_2)
  @ApiOperation({ summary: 'Teachers of one section with their subjects and pass % (404 SECTION_NOT_FOUND)' })
  @ApiEnvelope(SectionTeachersDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  sectionTeachers(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.teachersService.section(user.school_id!, id);
  }

  @Get('teachers/:userId')
  @ApiTags(OFFICE_MODULE_TAGS.MODULE_2)
  @ApiOperation({
    summary: 'One teacher: pass % per paper, parent rating and remarks, this month attendance (404 TEACHER_NOT_FOUND)',
  })
  @ApiEnvelope(TeacherDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  teacher(@CurrentUser() user: AuthUser, @Param('userId', ParseIntPipe) userId: number) {
    return this.teachersService.detail(user.school_id!, userId);
  }

  @Get('gate-passes')
  @ApiTags(OFFICE_MODULE_TAGS.MODULE_4)
  @ApiOperation({ summary: 'Gate passes waiting in my wings, emergencies first' })
  @ApiEnvelope(GatePassDto, { isArray: true })
  gatePasses(@CurrentUser() user: AuthUser) {
    return this.passes.toApprove(user.school_id!, user);
  }

  @Get('gate-passes/:id')
  @ApiTags(OFFICE_MODULE_TAGS.MODULE_4)
  @ApiOperation({ summary: 'One gate pass (404 GATE_PASS_NOT_FOUND outside my wings)' })
  @ApiEnvelope(GatePassDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  gatePass(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.passes.get(user.school_id!, id, false);
  }

  @Post('gate-passes/:id/decision')
  @HttpCode(HttpStatus.OK)
  @ApiTags(OFFICE_MODULE_TAGS.MODULE_4)
  @ResponseMessage('Decision saved')
  @ApiOperation({
    summary: 'Approve or reject; the first answer wins (the class teacher may answer first)',
    description:
      '409 PASS_ALREADY_DECIDED, 409 CONSENT_PENDING, 403 OUTSIDE_YOUR_WING. The parent gets the code by push and SMS.',
  })
  @ApiEnvelope(GatePassDto, { message: 'Decision saved' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  decide(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: DecisionDto) {
    return this.passes.decide(user.school_id!, id, dto, user);
  }
}
