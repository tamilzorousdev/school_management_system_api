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
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS, ROLES } from '../access/access.catalog';
import { AdmissionsService } from './admissions.service';
import {
  AdmissionInputDto,
  AdmissionQueryDto,
  CreateStudentDto,
  DecisionDto,
  EmergencyContactsDto,
  EnrolAdmissionDto,
  EnrollmentInputDto,
  GuardianInputDto,
  GuardianQueryDto,
  RollNumbersDto,
  StudentQueryDto,
  UpdateAdmissionDto,
  UpdateGuardianDto,
  UpdateGuardianLinkDto,
  UpdateMyParentProfileDto,
  UpdateStudentDto,
} from './dto/student-input.dto';
import {
  AdmissionDto,
  AdmissionInsightsDto,
  GuardianDetailDto,
  GuardianInsightsDto,
  GuardianListItemDto,
  ParentChildDto,
  StudentDetailDto,
  StudentInsightsDto,
  StudentListItemDto,
} from './dto/student-response.dto';
import { GuardiansService } from './guardians.service';
import { StudentsService } from './students.service';
import { PARENT_MODULE_TAGS } from '../mobile/parent-modules.catalog';

@ApiTags('Admin · Students')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/students')
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.STUDENTS_VIEW)
  @ApiOperation({
    summary: 'List students with their class, section and guardians this year',
    description:
      'search matches first and last name, admission number, guardian name and mobile. sort: name, admission_no, admission_date, created_at, roll_no, class.',
  })
  @ApiEnvelope(StudentListItemDto, { paginated: true })
  list(@SchoolId() schoolId: number, @Query() query: StudentQueryDto) {
    return this.students.list(schoolId, query);
  }

  @Get('insights')
  @RequirePermissions(PERMISSIONS.STUDENTS_VIEW)
  @ApiOperation({ summary: 'Counts for the students page insight cards' })
  @ApiEnvelope(StudentInsightsDto)
  insights(@SchoolId() schoolId: number) {
    return this.students.insights(schoolId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.STUDENTS_VIEW)
  @ApiOperation({ summary: 'Student profile with guardians, siblings, class history and emergency contacts' })
  @ApiEnvelope(StudentDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.students.get(schoolId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  @ResponseMessage('Student added')
  @ApiOperation({
    summary: 'Add an existing student directly (without an application)',
    description:
      'Guardians with a mobile already in the school are reused, which links siblings. Each guardian who receives alerts gets a Parent app login and an invite.',
  })
  @ApiEnvelope(StudentDetailDto, { status: HttpStatus.CREATED, message: 'Student added' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  create(@SchoolId() schoolId: number, @Body() dto: CreateStudentDto) {
    return this.students.create(schoolId, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  @ResponseMessage('Student updated')
  @ApiOperation({ summary: 'Update profile fields or status' })
  @ApiEnvelope(StudentDetailDto, { message: 'Student updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  update(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateStudentDto) {
    return this.students.update(schoolId, id, dto);
  }

  @Put(':id/enrollment')
  @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  @ResponseMessage('Class and section saved')
  @ApiOperation({ summary: 'Set class, section and roll number for the current year' })
  @ApiEnvelope(StudentDetailDto, { message: 'Class and section saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  enrollment(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: EnrollmentInputDto) {
    return this.students.setEnrollment(schoolId, id, dto);
  }

  @Post(':id/guardians')
  @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  @ResponseMessage('Guardian linked')
  @ApiOperation({ summary: 'Add or link a guardian by mobile. An existing guardian is reused, which links siblings.' })
  @ApiEnvelope(StudentDetailDto, { status: HttpStatus.CREATED, message: 'Guardian linked' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  addGuardian(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: GuardianInputDto) {
    return this.students.addGuardian(schoolId, id, dto);
  }

  @Patch(':id/guardians/:guardianId')
  @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  @ResponseMessage('Guardian updated')
  @ApiOperation({ summary: 'Change relation, main contact, pickup or alert settings for one guardian of this student' })
  @ApiEnvelope(StudentDetailDto, { message: 'Guardian updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  updateGuardian(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('guardianId', ParseIntPipe) guardianId: number,
    @Body() dto: UpdateGuardianLinkDto,
  ) {
    return this.students.updateGuardianLink(schoolId, id, guardianId, dto);
  }

  @Delete(':id/guardians/:guardianId')
  @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  @ResponseMessage('Guardian unlinked')
  @ApiOperation({ summary: 'Unlink a guardian from this student (the guardian record stays)' })
  @ApiEnvelope(StudentDetailDto, { message: 'Guardian unlinked' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  removeGuardian(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('guardianId', ParseIntPipe) guardianId: number,
  ) {
    return this.students.removeGuardian(schoolId, id, guardianId);
  }

  @Put(':id/emergency-contacts')
  @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  @ResponseMessage('Emergency contacts saved')
  @ApiOperation({ summary: 'Replace emergency contacts' })
  @ApiEnvelope(StudentDetailDto, { message: 'Emergency contacts saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  emergencyContacts(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EmergencyContactsDto,
  ) {
    return this.students.setEmergencyContacts(schoolId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  @ResponseMessage('Student deleted')
  @ApiOperation({ summary: 'Delete a student added by mistake. Use status for transfers and withdrawals.' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  remove(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.students.remove(schoolId, id);
  }
}

@ApiTags('Admin · Students')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/sections')
export class SectionRollController {
  constructor(private readonly students: StudentsService) {}

  @Post(':id/roll-numbers')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  @ResponseMessage('Roll numbers assigned')
  @ApiOperation({
    summary: 'Number every student in a section 1, 2, 3… by name, admission number, or gender then name',
  })
  @ApiErrors(HttpStatus.NOT_FOUND)
  rollNumbers(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: RollNumbersDto) {
    return this.students.assignRollNumbers(schoolId, id, dto);
  }
}

@ApiTags('Admin · Parents and guardians')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/guardians')
export class GuardiansController {
  constructor(private readonly guardians: GuardiansService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.STUDENTS_VIEW)
  @ApiOperation({
    summary: 'Parents and guardians with their children',
    description: 'search matches name, mobile, email and occupation. sort: name, created_at, last_login_at.',
  })
  @ApiEnvelope(GuardianListItemDto, { paginated: true })
  list(@SchoolId() schoolId: number, @Query() query: GuardianQueryDto) {
    return this.guardians.list(schoolId, query);
  }

  @Get('insights')
  @RequirePermissions(PERMISSIONS.STUDENTS_VIEW)
  @ApiOperation({ summary: 'Counts for the parents page insight cards' })
  @ApiEnvelope(GuardianInsightsDto)
  insights(@SchoolId() schoolId: number) {
    return this.guardians.insights(schoolId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.STUDENTS_VIEW)
  @ApiOperation({ summary: 'Parent profile with children, years in school and the other parent' })
  @ApiEnvelope(GuardianDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.guardians.get(schoolId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  @ResponseMessage('Parent updated')
  @ApiOperation({ summary: 'Update parent details. Name, mobile and language also update their login.' })
  @ApiEnvelope(GuardianDetailDto, { message: 'Parent updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  update(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateGuardianDto) {
    return this.guardians.update(schoolId, id, dto);
  }
}

@ApiTags('Admin · Admissions')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/admissions')
export class AdmissionsController {
  constructor(private readonly admissions: AdmissionsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.STUDENTS_VIEW)
  @ApiOperation({
    summary: 'Applications',
    description:
      'search matches application number, student and guardian name, guardian mobile. sort: created_at, first_name, status, class.',
  })
  @ApiEnvelope(AdmissionDto, { paginated: true })
  list(@SchoolId() schoolId: number, @Query() query: AdmissionQueryDto) {
    return this.admissions.list(schoolId, query);
  }

  @Get('insights')
  @RequirePermissions(PERMISSIONS.STUDENTS_VIEW)
  @ApiOperation({ summary: 'Application counts for the current year' })
  @ApiEnvelope(AdmissionInsightsDto)
  insights(@SchoolId() schoolId: number) {
    return this.admissions.insights(schoolId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.STUDENTS_VIEW)
  @ApiOperation({ summary: 'One application' })
  @ApiEnvelope(AdmissionDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.admissions.get(schoolId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ADMISSIONS_MANAGE)
  @ResponseMessage('Application created')
  @ApiOperation({ summary: 'Take an application. The application number is generated.' })
  @ApiEnvelope(AdmissionDto, { status: HttpStatus.CREATED, message: 'Application created' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  create(@SchoolId() schoolId: number, @Body() dto: AdmissionInputDto) {
    return this.admissions.create(schoolId, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.ADMISSIONS_MANAGE)
  @ResponseMessage('Application updated')
  @ApiOperation({ summary: 'Edit an application that is not yet enrolled or rejected' })
  @ApiEnvelope(AdmissionDto, { message: 'Application updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  update(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateAdmissionDto) {
    return this.admissions.update(schoolId, id, dto);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.ADMISSIONS_MANAGE)
  @ResponseMessage('Application approved')
  @ApiOperation({ summary: 'applied → approved' })
  @ApiEnvelope(AdmissionDto, { message: 'Application approved' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  approve(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DecisionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.admissions.approve(schoolId, id, dto, actor);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.ADMISSIONS_MANAGE)
  @ResponseMessage('Application rejected')
  @ApiOperation({ summary: 'applied or approved → rejected, with an optional reason' })
  @ApiEnvelope(AdmissionDto, { message: 'Application rejected' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  reject(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DecisionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.admissions.reject(schoolId, id, dto, actor);
  }

  @Post(':id/enrol')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.ADMISSIONS_MANAGE)
  @ResponseMessage('Student enrolled')
  @ApiOperation({
    summary: 'approved → enrolled: creates the student, links the guardian and sends the Parent app invite',
  })
  @ApiEnvelope(AdmissionDto, { message: 'Student enrolled' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  enrol(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EnrolAdmissionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.admissions.enrol(schoolId, id, dto, actor);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.ADMISSIONS_MANAGE)
  @ResponseMessage('Application deleted')
  @ApiOperation({ summary: 'Delete an application that was not enrolled' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  remove(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.admissions.remove(schoolId, id);
  }
}

@ApiTags(PARENT_MODULE_TAGS.MODULE_1)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@RequireRoles(ROLES.PARENT)
@Controller('mobile/parent')
export class MobileParentController {
  constructor(private readonly guardians: GuardiansService) {}

  @Get('children')
  @ApiOperation({
    summary: 'The signed-in parent’s children with class, section, roll number and class teacher',
    description: 'Shows the child switcher. Empty list means no child is linked to this mobile yet.',
  })
  @ApiEnvelope(ParentChildDto, { isArray: true })
  children(@CurrentUser() user: AuthUser) {
    return this.guardians.childrenForUser(user.id);
  }

  @Get('profile')
  @ApiOperation({
    summary: 'My parent profile: contact details, address, my children and the other parent',
    description:
      'Name, mobile, children and relation are kept by the school office; the parent can change the rest with PATCH /mobile/parent/profile.',
  })
  @ApiEnvelope(GuardianDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  profile(@CurrentUser() user: AuthUser) {
    return this.guardians.profileForUser(user.id);
  }

  @Patch('profile')
  @ResponseMessage('Profile updated')
  @ApiOperation({
    summary: 'Update my alternate mobile, email, occupation, qualification, address and app language',
    description:
      'Send only the fields to change; null clears a field. Name and mobile number (the login) can only be changed by the school office. language (en or ta) also changes the app and notification language.',
  })
  @ApiEnvelope(GuardianDetailDto, { message: 'Profile updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateMyParentProfileDto) {
    return this.guardians.updateProfileForUser(user.id, dto);
  }
}
