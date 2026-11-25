import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import {
  AdmissionDetailDto,
  AdmissionDto,
  AdmissionInputDto,
  AdmissionInsightsDto,
  AdmissionQueryDto,
  AdmissionUpdateDto,
  AllocateDto,
  ApplicationDto,
  ApplicationInputDto,
  ApplicationQueryDto,
  AuditLogDto,
  AuditQueryDto,
  CheckoutDto,
  CheckoutQueryDto,
  CheckoutStartDto,
  ClearanceUpdateDto,
  DecisionDto,
  StudentHostelDto,
  SwapDto,
  TransferDto,
  VacateDto,
} from './dto/hostel-admission.dto';
import { HostelIdQueryDto } from './dto/hostel-setup.dto';
import { HostelAdmissionsService } from './hostel-admissions.service';
import { HostelAuditService } from './hostel-audit.service';
import { HostelCheckoutService } from './hostel-checkout.service';
import { APPLICATION_ACTIONS, ApplicationAction } from './hostel.logic';

@ApiTags('Admin · Hostel admissions')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/hostel')
export class HostelAdmissionsController {
  constructor(
    private readonly admissions: HostelAdmissionsService,
    private readonly checkouts: HostelCheckoutService,
    private readonly audit: HostelAuditService,
  ) {}

  @Get('applications')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Hostel applications and waitlist. sort: created_at, priority, wanted_from' })
  @ApiEnvelope(ApplicationDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  listApplications(@SchoolId() schoolId: number, @Query() query: ApplicationQueryDto) {
    return this.admissions.listApplications(schoolId, query);
  }

  @Get('applications/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'One hostel application' })
  @ApiEnvelope(ApplicationDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  getApplication(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.admissions.getApplication(schoolId, id);
  }

  @Post('applications')
  @RequirePermissions(PERMISSIONS.HOSTEL_ALLOCATE)
  @ResponseMessage('Hostel application recorded')
  @ApiOperation({ summary: 'Record a hostel application for a student (office)' })
  @ApiEnvelope(ApplicationDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  createApplication(@SchoolId() schoolId: number, @Body() dto: ApplicationInputDto, @CurrentUser() user: AuthUser) {
    return this.admissions.createApplication(schoolId, dto, user);
  }

  @Post('applications/:id/:action')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_ALLOCATE)
  @ResponseMessage('Hostel application updated')
  @ApiParam({ name: 'action', enum: Object.values(APPLICATION_ACTIONS) })
  @ApiOperation({
    summary: 'Approve, waitlist, reject or cancel an application',
    description: 'An approved application is filled with POST admissions { application_id }.',
  })
  @ApiEnvelope(ApplicationDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  decideApplication(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('action', new ParseEnumPipe(APPLICATION_ACTIONS)) action: ApplicationAction,
    @Body() dto: DecisionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.admissions.decideApplication(schoolId, id, action, dto, user);
  }

  @Get('admissions/insights')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Counts for the residents page: active, on leave, checking out, without bed, applications' })
  @ApiEnvelope(AdmissionInsightsDto)
  insights(@SchoolId() schoolId: number, @Query() query: HostelIdQueryDto) {
    return this.admissions.insights(schoolId, query.hostel_id);
  }

  @Get('admissions')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({
    summary: 'Hostel residents with their bed. Default: everyone not checked out.',
    description: 'sort: created_at, admitted_on, admission_no, name, room_no',
  })
  @ApiEnvelope(AdmissionDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  listAdmissions(@SchoolId() schoolId: number, @Query() query: AdmissionQueryDto) {
    return this.admissions.listAdmissions(schoolId, query);
  }

  @Get('admissions/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'One resident with bed history, transfers and any open checkout' })
  @ApiEnvelope(AdmissionDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  getAdmission(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.admissions.getAdmission(schoolId, id);
  }

  @Post('admissions')
  @RequirePermissions(PERMISSIONS.HOSTEL_ALLOCATE)
  @ResponseMessage('Student admitted to the hostel')
  @ApiOperation({ summary: 'Admit a student to the hostel, optionally into a vacant bed' })
  @ApiEnvelope(AdmissionDetailDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  admit(@SchoolId() schoolId: number, @Body() dto: AdmissionInputDto, @CurrentUser() user: AuthUser) {
    return this.admissions.admit(schoolId, dto, user);
  }

  @Patch('admissions/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_ALLOCATE)
  @ResponseMessage('Resident details updated')
  @ApiOperation({ summary: 'Change diet, local guardian, medical notes or notes' })
  @ApiEnvelope(AdmissionDetailDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  updateAdmission(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AdmissionUpdateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.admissions.updateAdmission(schoolId, id, dto, user);
  }

  @Post('admissions/:id/allocate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_ALLOCATE)
  @ResponseMessage('Bed allocated')
  @ApiOperation({ summary: 'Give a resident without a bed a vacant bed' })
  @ApiEnvelope(AdmissionDetailDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  allocate(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AllocateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.admissions.allocate(schoolId, id, dto, user);
  }

  @Post('admissions/:id/transfer')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_ALLOCATE)
  @ResponseMessage('Resident moved')
  @ApiOperation({ summary: 'Move a resident to another vacant bed (same or another hostel)' })
  @ApiEnvelope(AdmissionDetailDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  transfer(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TransferDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.admissions.transfer(schoolId, id, dto, user);
  }

  @Post('admissions/:id/swap')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_ALLOCATE)
  @ResponseMessage('Beds swapped')
  @ApiOperation({ summary: 'Swap beds between two residents' })
  @ApiEnvelope(AdmissionDetailDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  swap(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SwapDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.admissions.swap(schoolId, id, dto, user);
  }

  @Post('admissions/:id/vacate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_ALLOCATE)
  @ResponseMessage('Bed vacated')
  @ApiOperation({ summary: 'Free the bed but keep the student admitted (allocate again later)' })
  @ApiEnvelope(AdmissionDetailDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  vacate(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: VacateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.admissions.vacate(schoolId, id, dto, user);
  }

  @Post('admissions/:id/checkout')
  @RequirePermissions(PERMISSIONS.HOSTEL_CHECKOUT)
  @ResponseMessage('Checkout started')
  @ApiOperation({ summary: 'Start checkout: creates the clearance checklist; the bed is freed on completion' })
  @ApiEnvelope(CheckoutDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  startCheckout(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CheckoutStartDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.checkouts.start(schoolId, id, dto, user);
  }

  @Get('students/:studentId')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Hostel tab of the student profile: current stay and past stays' })
  @ApiEnvelope(StudentHostelDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  studentHostel(@SchoolId() schoolId: number, @Param('studentId', ParseIntPipe) studentId: number) {
    return this.admissions.studentHostel(schoolId, studentId);
  }

  @Get('checkouts')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Checkouts with their clearance checklist. sort: created_at, checkout_date' })
  @ApiEnvelope(CheckoutDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  listCheckouts(@SchoolId() schoolId: number, @Query() query: CheckoutQueryDto) {
    return this.checkouts.list(schoolId, query);
  }

  @Get('checkouts/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'One checkout with its clearance checklist' })
  @ApiEnvelope(CheckoutDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  getCheckout(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.checkouts.get(schoolId, id);
  }

  @Patch('checkouts/:id/items/:code')
  @RequirePermissions(PERMISSIONS.HOSTEL_CHECKOUT)
  @ResponseMessage('Clearance updated')
  @ApiOperation({ summary: 'Mark one clearance item cleared, waived or pending again' })
  @ApiEnvelope(CheckoutDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  updateItem(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('code') code: string,
    @Body() dto: ClearanceUpdateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.checkouts.updateItem(schoolId, id, code, dto, user);
  }

  @Post('checkouts/:id/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_CHECKOUT)
  @ResponseMessage('Checked out of the hostel')
  @ApiOperation({ summary: 'Finish checkout when every item is cleared or waived: frees the bed' })
  @ApiEnvelope(CheckoutDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  complete(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.checkouts.complete(schoolId, id, user);
  }

  @Post('checkouts/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_CHECKOUT)
  @ResponseMessage('Checkout cancelled')
  @ApiOperation({ summary: 'Cancel an open checkout; the student stays in the hostel' })
  @ApiEnvelope(CheckoutDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  cancel(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.checkouts.cancel(schoolId, id, user);
  }

  @Get('audit-log')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Who changed what: applications, admissions, beds and checkouts' })
  @ApiEnvelope(AuditLogDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  auditLog(@SchoolId() schoolId: number, @Query() query: AuditQueryDto) {
    return this.audit.list(schoolId, query);
  }
}
