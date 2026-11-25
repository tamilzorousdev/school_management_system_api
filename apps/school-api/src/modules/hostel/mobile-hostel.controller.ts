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
import { ApiBearerAuth, ApiOperation, ApiParam, ApiProperty, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelope,
  ApiErrors,
  AppException,
  AuthUser,
  CurrentUser,
  RequirePermissions,
  ResponseMessage,
} from '@app/common';
import { PERMISSIONS } from '../access/access.catalog';
import { TEACHER_MODULE_TAGS } from '../mobile/teacher-modules.catalog';
import {
  AdmissionDetailDto,
  AdmissionDto,
  AdmissionInputDto,
  AdmissionInsightsDto,
  AdmissionQueryDto,
  AdmissionUpdateDto,
  AllocateDto,
  ApplicationDto,
  ApplicationQueryDto,
  CheckoutDto,
  CheckoutQueryDto,
  CheckoutStartDto,
  ClearanceUpdateDto,
  DecisionDto,
  StudentPickDto,
  StudentSearchQueryDto,
  SwapDto,
  TransferDto,
  VacateDto,
} from './dto/hostel-admission.dto';
import {
  AvailableBedDto,
  BedAvailabilityQueryDto,
  HostelDashboardDto,
  HostelDto,
  HostelIdQueryDto,
  HostelModulesDto,
  RoomDetailDto,
  RoomDto,
  RoomQueryDto,
} from './dto/hostel-setup.dto';
import { HostelAdmissionsService } from './hostel-admissions.service';
import { HostelCheckoutService } from './hostel-checkout.service';
import { HostelSettingsService } from './hostel-settings.service';
import { HostelSetupService } from './hostel-setup.service';
import { APPLICATION_ACTIONS, ApplicationAction } from './hostel.logic';

export class WardenHomeDto {
  @ApiProperty({ type: HostelDashboardDto }) beds: HostelDashboardDto;
  @ApiProperty({ type: AdmissionInsightsDto }) residents: AdmissionInsightsDto;
}

const schoolOf = (user: AuthUser): number => {
  if (!user.school_id) throw AppException.forbidden('Your account is not linked to a school', 'NO_SCHOOL');
  return user.school_id;
};

@ApiTags(TEACHER_MODULE_TAGS.MODULE_14)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('mobile/teacher/hostel')
export class MobileHostelController {
  constructor(
    private readonly setup: HostelSetupService,
    private readonly settings: HostelSettingsService,
    private readonly admissions: HostelAdmissionsService,
    private readonly checkouts: HostelCheckoutService,
  ) {}

  @Get('config')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Which optional hostel screens to show (staff duty, lockers, study hall, ...)' })
  @ApiEnvelope(HostelModulesDto)
  config(@CurrentUser() user: AuthUser) {
    return this.settings.modules(schoolOf(user));
  }

  @Get('home')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Warden home: bed occupancy and resident counts' })
  @ApiEnvelope(WardenHomeDto)
  async home(@CurrentUser() user: AuthUser, @Query() query: HostelIdQueryDto): Promise<WardenHomeDto> {
    const schoolId = schoolOf(user);
    const [beds, residents] = await Promise.all([
      this.setup.dashboard(schoolId, query),
      this.admissions.insights(schoolId, query.hostel_id),
    ]);
    return { beds, residents };
  }

  @Get('hostels')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Hostels for the hostel picker' })
  @ApiEnvelope(HostelDto, { isArray: true })
  hostels(@CurrentUser() user: AuthUser) {
    return this.setup.listHostels(schoolOf(user));
  }

  @Get('rooms')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Rooms with vacant and occupied beds. sort: room_no, created_at, capacity, vacant_beds' })
  @ApiEnvelope(RoomDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  rooms(@CurrentUser() user: AuthUser, @Query() query: RoomQueryDto) {
    return this.setup.listRooms(schoolOf(user), query);
  }

  @Get('rooms/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'One room: each bed with the student in it' })
  @ApiEnvelope(RoomDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  room(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.setup.getRoom(schoolOf(user), id);
  }

  @Get('beds/available')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Vacant beds to allocate or transfer into' })
  @ApiEnvelope(AvailableBedDto, { isArray: true })
  availableBeds(@CurrentUser() user: AuthUser, @Query() query: BedAvailabilityQueryDto) {
    return this.setup.availableBeds(schoolOf(user), query);
  }

  @Get('students')
  @RequirePermissions(PERMISSIONS.HOSTEL_ALLOCATE)
  @ApiOperation({
    summary: 'Find a studying student to admit (up to 20)',
    description: 'Each row says if the student is already in the hostel or has an open application.',
  })
  @ApiEnvelope(StudentPickDto, { isArray: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  students(@CurrentUser() user: AuthUser, @Query() query: StudentSearchQueryDto) {
    return this.admissions.searchStudents(schoolOf(user), query.search);
  }

  @Get('applications')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Hostel applications and waitlist. sort: created_at, priority, wanted_from' })
  @ApiEnvelope(ApplicationDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  applications(@CurrentUser() user: AuthUser, @Query() query: ApplicationQueryDto) {
    return this.admissions.listApplications(schoolOf(user), query);
  }

  @Post('applications/:id/:action')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_ALLOCATE)
  @ResponseMessage('Hostel application updated')
  @ApiParam({ name: 'action', enum: Object.values(APPLICATION_ACTIONS) })
  @ApiOperation({ summary: 'Approve, waitlist, reject or cancel an application' })
  @ApiEnvelope(ApplicationDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  decide(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('action', new ParseEnumPipe(APPLICATION_ACTIONS)) action: ApplicationAction,
    @Body() dto: DecisionDto,
  ) {
    return this.admissions.decideApplication(schoolOf(user), id, action, dto, user);
  }

  @Post('residents')
  @RequirePermissions(PERMISSIONS.HOSTEL_ALLOCATE)
  @ResponseMessage('Student admitted to the hostel')
  @ApiOperation({ summary: 'Admit a student to the hostel, optionally straight into a vacant bed' })
  @ApiEnvelope(AdmissionDetailDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  admit(@CurrentUser() user: AuthUser, @Body() dto: AdmissionInputDto) {
    return this.admissions.admit(schoolOf(user), dto, user);
  }

  @Get('residents')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({
    summary: 'Find residents by name, admission number or room',
    description: 'sort: created_at, admitted_on, admission_no, name, room_no',
  })
  @ApiEnvelope(AdmissionDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  residents(@CurrentUser() user: AuthUser, @Query() query: AdmissionQueryDto) {
    return this.admissions.listAdmissions(schoolOf(user), query);
  }

  @Get('residents/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'One resident: bed, parent and local guardian to call, medical notes, bed history' })
  @ApiEnvelope(AdmissionDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  resident(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.admissions.getAdmission(schoolOf(user), id);
  }

  @Patch('residents/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_ALLOCATE)
  @ResponseMessage('Resident details updated')
  @ApiOperation({ summary: 'Change diet, local guardian, medical notes or notes' })
  @ApiEnvelope(AdmissionDetailDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  updateResident(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AdmissionUpdateDto,
  ) {
    return this.admissions.updateAdmission(schoolOf(user), id, dto, user);
  }

  @Post('residents/:id/allocate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_ALLOCATE)
  @ResponseMessage('Bed allocated')
  @ApiOperation({ summary: 'Give a resident without a bed a vacant bed' })
  @ApiEnvelope(AdmissionDetailDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  allocate(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: AllocateDto) {
    return this.admissions.allocate(schoolOf(user), id, dto, user);
  }

  @Post('residents/:id/transfer')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_ALLOCATE)
  @ResponseMessage('Resident moved')
  @ApiOperation({ summary: 'Move a resident to another vacant bed' })
  @ApiEnvelope(AdmissionDetailDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  transfer(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: TransferDto) {
    return this.admissions.transfer(schoolOf(user), id, dto, user);
  }

  @Post('residents/:id/swap')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_ALLOCATE)
  @ResponseMessage('Beds swapped')
  @ApiOperation({ summary: 'Swap beds between two residents' })
  @ApiEnvelope(AdmissionDetailDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  swap(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: SwapDto) {
    return this.admissions.swap(schoolOf(user), id, dto, user);
  }

  @Post('residents/:id/vacate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_ALLOCATE)
  @ResponseMessage('Bed vacated')
  @ApiOperation({ summary: 'Free the bed but keep the student admitted' })
  @ApiEnvelope(AdmissionDetailDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  vacate(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: VacateDto) {
    return this.admissions.vacate(schoolOf(user), id, dto, user);
  }

  @Post('residents/:id/checkout')
  @RequirePermissions(PERMISSIONS.HOSTEL_CHECKOUT)
  @ResponseMessage('Checkout started')
  @ApiOperation({ summary: 'Start checkout: creates the clearance checklist' })
  @ApiEnvelope(CheckoutDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  startCheckout(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: CheckoutStartDto) {
    return this.checkouts.start(schoolOf(user), id, dto, user);
  }

  @Post('checkouts/:id/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_CHECKOUT)
  @ResponseMessage('Checked out of the hostel')
  @ApiOperation({ summary: 'Finish checkout when every item is cleared or waived: frees the bed' })
  @ApiEnvelope(CheckoutDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  completeCheckout(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.checkouts.complete(schoolOf(user), id, user);
  }

  @Post('checkouts/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_CHECKOUT)
  @ResponseMessage('Checkout cancelled')
  @ApiOperation({ summary: 'Cancel an open checkout; the student stays' })
  @ApiEnvelope(CheckoutDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  cancelCheckout(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.checkouts.cancel(schoolOf(user), id, user);
  }

  @Get('checkouts')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Checkouts and their clearance checklist (status=open for the to-do list)' })
  @ApiEnvelope(CheckoutDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  checkoutList(@CurrentUser() user: AuthUser, @Query() query: CheckoutQueryDto) {
    return this.checkouts.list(schoolOf(user), query);
  }

  @Get('checkouts/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'One checkout with its clearance checklist' })
  @ApiEnvelope(CheckoutDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  checkout(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.checkouts.get(schoolOf(user), id);
  }

  @Patch('checkouts/:id/items/:code')
  @RequirePermissions(PERMISSIONS.HOSTEL_CHECKOUT)
  @ResponseMessage('Clearance updated')
  @ApiOperation({ summary: 'Tick a clearance item: room handed over, key returned, damage checked...' })
  @ApiEnvelope(CheckoutDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  clearItem(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('code') code: string,
    @Body() dto: ClearanceUpdateDto,
  ) {
    return this.checkouts.updateItem(schoolOf(user), id, code, dto, user);
  }
}
