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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelope,
  ApiErrors,
  AppException,
  AuthUser,
  CurrentUser,
  ListQueryDto,
  RequirePermissions,
  RequireRoles,
  ResponseMessage,
} from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS, ROLES } from '../access/access.catalog';
import { PARENT_MODULE_TAGS } from '../mobile/parent-modules.catalog';
import { TEACHER_MODULE_TAGS } from '../mobile/teacher-modules.catalog';
import {
  DoseDto,
  DoseInputDto,
  HealthLogDto,
  HealthLogInputDto,
  HealthLogNoteDto,
  HealthLogPatchDto,
  HealthLogQueryDto,
  LaundryBatchDto,
  LaundryDetailDto,
  LaundryInputDto,
  LaundryItemsInputDto,
  LaundryMissingDto,
  LaundryMissingQueryDto,
  LaundryQueryDto,
  LaundryReturnDto,
  LaundrySentDto,
  MedicationDto,
  MedicationDueDto,
  MedicationDueQueryDto,
  MedicationInputDto,
  MedicationQueryDto,
  MessAttendanceSheetDto,
  MessDayDto,
  MessDayQueryDto,
  MessFeedbackDto,
  MessFeedbackInputDto,
  MessFeedbackQueryDto,
  MessFeedbackSummaryDto,
  MessFeedbackSummaryQueryDto,
  MessHeadcountDto,
  MessMarkDto,
  MessMenuInputDto,
  MessMenuQueryDto,
  MessOverrideDto,
  MessOverrideInputDto,
  MessOverrideQueryDto,
  MessScanDto,
  MessScanResultDto,
  MessSkipDto,
  MessSkipInputDto,
  MessSkipQueryDto,
  MessSlotQueryDto,
  MessWeekDto,
  ParentLaundryDto,
  ParentMedicationQueryDto,
  ParentMessDayQueryDto,
  ParentMessFeedbackInputDto,
  ParentMessSkipInputDto,
  ParentMessSkipQueryDto,
} from './dto/hostel-care.dto';
import { HostelCareParentService } from './hostel-care-parent.service';
import { HostelHealthService } from './hostel-health.service';
import { HostelLaundryService } from './hostel-laundry.service';
import { HostelMessService } from './hostel-mess.service';
import { HostelModuleGate, HostelModuleGuard } from './hostel-module.guard';

export const HOSTEL_CARE_TAG = 'Admin · Hostel mess, health & laundry';

const schoolOf = (user: AuthUser): number => {
  if (!user.school_id) throw AppException.forbidden('Your account is not linked to a school', 'NO_SCHOOL');
  return user.school_id;
};

@ApiTags(HOSTEL_CARE_TAG)
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@UseGuards(HostelModuleGuard)
@HostelModuleGate('mess')
@Controller('admin/hostel')
export class HostelMessController {
  constructor(private readonly mess: HostelMessService) {}

  @Get('mess/menu')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Weekly menu, 7 days x 4 meals; hostel rows win over the school-wide menu' })
  @ApiEnvelope(MessWeekDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  menu(@SchoolId() schoolId: number, @Query() query: MessMenuQueryDto) {
    return this.mess.week(schoolId, query.hostel_id);
  }

  @Put('mess/menu')
  @RequirePermissions(PERMISSIONS.HOSTEL_MESS)
  @ResponseMessage('Menu saved')
  @ApiOperation({ summary: 'Replace the weekly menu of a hostel (or the school-wide menu when hostel_id is left out)' })
  @ApiEnvelope(MessWeekDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  saveMenu(@SchoolId() schoolId: number, @Body() dto: MessMenuInputDto, @CurrentUser() user: AuthUser) {
    return this.mess.saveWeek(schoolId, dto, user);
  }

  @Get('mess/overrides')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Menu changes for dates (default: today to 30 days ahead)' })
  @ApiEnvelope(MessOverrideDto, { isArray: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  overrides(@SchoolId() schoolId: number, @Query() query: MessOverrideQueryDto) {
    return this.mess.overrides(schoolId, query);
  }

  @Post('mess/overrides')
  @RequirePermissions(PERMISSIONS.HOSTEL_MESS)
  @ResponseMessage('Menu change saved')
  @ApiOperation({ summary: 'Set a special menu for a date and meal (replaces one already set for that date and meal)' })
  @ApiEnvelope(MessOverrideDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  addOverride(@SchoolId() schoolId: number, @Body() dto: MessOverrideInputDto, @CurrentUser() user: AuthUser) {
    return this.mess.saveOverride(schoolId, dto, user);
  }

  @Delete('mess/overrides/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_MESS)
  @ResponseMessage('Menu change removed')
  @ApiOperation({ summary: 'Remove a date menu change; the weekly menu applies again' })
  @ApiEnvelope()
  @ApiErrors(HttpStatus.NOT_FOUND)
  async removeOverride(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.mess.removeOverride(schoolId, id);
  }

  @Get('mess/day')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Menu of one date per meal: date change, else hostel week, else school week' })
  @ApiEnvelope(MessDayDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  day(@SchoolId() schoolId: number, @Query() query: MessDayQueryDto) {
    return this.mess.day(schoolId, query.date, query.hostel_id);
  }

  @Get('mess/headcount')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Meals to cook: residents minus home leave minus meal skips, split by diet' })
  @ApiEnvelope(MessHeadcountDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  headcount(@SchoolId() schoolId: number, @Query() query: MessSlotQueryDto) {
    return this.mess.headcount(schoolId, query.hostel_id, query.date, query.meal);
  }

  @Get('mess/attendance')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Meal attendance sheet: residents with their mark, skip and leave' })
  @ApiEnvelope(MessAttendanceSheetDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  attendance(@SchoolId() schoolId: number, @Query() query: MessSlotQueryDto) {
    return this.mess.sheet(schoolId, query.hostel_id, query.date, query.meal);
  }

  @Post('mess/attendance/mark')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_MESS)
  @ResponseMessage('Meal attendance saved')
  @ApiOperation({ summary: 'Mark ate or skipped for today or yesterday' })
  @ApiEnvelope(MessAttendanceSheetDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  mark(@SchoolId() schoolId: number, @Body() dto: MessMarkDto, @CurrentUser() user: AuthUser) {
    return this.mess.mark(schoolId, dto, user);
  }

  @Post('mess/attendance/scan')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_MESS)
  @ResponseMessage('Meal marked')
  @ApiOperation({ summary: 'Scan the student ID card QR at the mess: marks ate for today' })
  @ApiEnvelope(MessScanResultDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  scan(@SchoolId() schoolId: number, @Body() dto: MessScanDto, @CurrentUser() user: AuthUser) {
    return this.mess.scan(schoolId, dto, user);
  }

  @Get('mess/skips')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Meal skips. sort: from_date, created_at' })
  @ApiEnvelope(MessSkipDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  skips(@SchoolId() schoolId: number, @Query() query: MessSkipQueryDto) {
    return this.mess.skips(schoolId, query);
  }

  @Post('mess/skips')
  @RequirePermissions(PERMISSIONS.HOSTEL_MESS)
  @ResponseMessage('Meal skip saved')
  @ApiOperation({ summary: 'Record that a resident will skip meals (from today, up to 30 days)' })
  @ApiEnvelope(MessSkipDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  addSkip(@SchoolId() schoolId: number, @Body() dto: MessSkipInputDto, @CurrentUser() user: AuthUser) {
    return this.mess.createSkip(schoolId, dto.admission_id, dto, 'warden', user);
  }

  @Post('mess/skips/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_MESS)
  @ResponseMessage('Meal skip cancelled')
  @ApiOperation({ summary: 'Cancel a meal skip that is not over yet' })
  @ApiEnvelope(MessSkipDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  cancelSkip(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.mess.cancelSkip(schoolId, id, user);
  }

  @Get('mess/feedback')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Mess feedback from parents and staff. sort: created_at, meal_date, rating' })
  @ApiEnvelope(MessFeedbackDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  feedback(@SchoolId() schoolId: number, @Query() query: MessFeedbackQueryDto) {
    return this.mess.feedback(schoolId, query);
  }

  @Get('mess/feedback/summary')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Average rating and count per meal (default: last 30 days)' })
  @ApiEnvelope(MessFeedbackSummaryDto)
  @ApiErrors(HttpStatus.BAD_REQUEST)
  feedbackSummary(@SchoolId() schoolId: number, @Query() query: MessFeedbackSummaryQueryDto) {
    return this.mess.feedbackSummary(schoolId, query);
  }

  @Post('mess/feedback')
  @RequirePermissions(PERMISSIONS.HOSTEL_MESS)
  @ResponseMessage('Feedback saved')
  @ApiOperation({ summary: 'Record staff feedback on a meal' })
  @ApiEnvelope(MessFeedbackDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  addFeedback(@SchoolId() schoolId: number, @Body() dto: MessFeedbackInputDto, @CurrentUser() user: AuthUser) {
    return this.mess.addFeedback(schoolId, dto.hostel_id, null, dto, user);
  }
}

@ApiTags(HOSTEL_CARE_TAG)
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@UseGuards(HostelModuleGuard)
@HostelModuleGate('medical')
@Controller('admin/hostel')
export class HostelHealthController {
  constructor(private readonly health: HostelHealthService) {}

  @Get('health')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Health log. sort: logged_at, created_at. in_sick_bay=true lists the sick bay' })
  @ApiEnvelope(HealthLogDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  logs(@SchoolId() schoolId: number, @Query() query: HealthLogQueryDto) {
    return this.health.logs(schoolId, query);
  }

  @Get('health/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'One health record' })
  @ApiEnvelope(HealthLogDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  log(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.health.log(schoolId, id);
  }

  @Post('health')
  @RequirePermissions(PERMISSIONS.HOSTEL_MEDICAL)
  @ResponseMessage('Health record saved')
  @ApiOperation({
    summary: 'Record illness, injury or a check-up',
    description: 'sick_bay moves the student to the sick bay now. notify_parent (default true) sends HOSTEL_HEALTH.',
  })
  @ApiEnvelope(HealthLogDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  create(@SchoolId() schoolId: number, @Body() dto: HealthLogInputDto, @CurrentUser() user: AuthUser) {
    return this.health.createLog(schoolId, dto, user);
  }

  @Patch('health/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_MEDICAL)
  @ResponseMessage('Health record updated')
  @ApiOperation({ summary: 'Update an open health record (treatment, doctor, sick bay)' })
  @ApiEnvelope(HealthLogDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  patch(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: HealthLogPatchDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.health.patchLog(schoolId, id, dto, user);
  }

  @Post('health/:id/discharge')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_MEDICAL)
  @ResponseMessage('Discharged from the sick bay')
  @ApiOperation({ summary: 'Discharge the student from the sick bay' })
  @ApiEnvelope(HealthLogDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  discharge(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: HealthLogNoteDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.health.discharge(schoolId, id, dto, user);
  }

  @Post('health/:id/close')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_MEDICAL)
  @ResponseMessage('Health record closed')
  @ApiOperation({ summary: 'Close a health record (also discharges from the sick bay)' })
  @ApiEnvelope(HealthLogDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  close(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: HealthLogNoteDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.health.close(schoolId, id, dto, user);
  }

  @Get('medications')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Medication courses. sort: created_at, from_date' })
  @ApiEnvelope(MedicationDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  medications(@SchoolId() schoolId: number, @Query() query: MedicationQueryDto) {
    return this.health.medications(schoolId, query);
  }

  @Get('medications/due')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Doses of a date (default today): each running medication x time with its status' })
  @ApiEnvelope(MedicationDueDto, { isArray: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  due(@SchoolId() schoolId: number, @Query() query: MedicationDueQueryDto) {
    return this.health.due(schoolId, query);
  }

  @Post('medications')
  @RequirePermissions(PERMISSIONS.HOSTEL_MEDICAL)
  @ResponseMessage('Medication added')
  @ApiOperation({ summary: 'Start a medication course for a resident' })
  @ApiEnvelope(MedicationDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  addMedication(@SchoolId() schoolId: number, @Body() dto: MedicationInputDto, @CurrentUser() user: AuthUser) {
    return this.health.createMedication(schoolId, dto, user);
  }

  @Post('medications/:id/stop')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_MEDICAL)
  @ResponseMessage('Medication stopped')
  @ApiOperation({ summary: 'Stop a medication course' })
  @ApiEnvelope(MedicationDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  stop(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.health.stopMedication(schoolId, id, user);
  }

  @Post('medications/:id/doses')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_MEDICAL)
  @ResponseMessage('Dose recorded')
  @ApiOperation({
    summary: 'Record a dose as given, missed or refused (today or the last 2 days); records again overwrite',
  })
  @ApiEnvelope(DoseDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  dose(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DoseInputDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.health.recordDose(schoolId, id, dto, user);
  }
}

@ApiTags(HOSTEL_CARE_TAG)
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@UseGuards(HostelModuleGuard)
@HostelModuleGate('laundry')
@Controller('admin/hostel')
export class HostelLaundryController {
  constructor(private readonly laundry: HostelLaundryService) {}

  @Get('laundry')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Laundry batches with counts. sort: collected_on, created_at' })
  @ApiEnvelope(LaundryBatchDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  list(@SchoolId() schoolId: number, @Query() query: LaundryQueryDto) {
    return this.laundry.list(schoolId, query);
  }

  @Get('laundry/missing')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Clothes not returned by the laundry (default: batches collected in the last 90 days)' })
  @ApiEnvelope(LaundryMissingDto)
  @ApiErrors(HttpStatus.BAD_REQUEST)
  missing(@SchoolId() schoolId: number, @Query() query: LaundryMissingQueryDto) {
    return this.laundry.missing(schoolId, query);
  }

  @Get('laundry/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'One laundry batch with each resident’s count' })
  @ApiEnvelope(LaundryDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.laundry.get(schoolId, id);
  }

  @Post('laundry')
  @RequirePermissions(PERMISSIONS.HOSTEL_LAUNDRY)
  @ResponseMessage('Laundry batch created')
  @ApiOperation({ summary: 'Collect clothes: one batch with the count handed in by each resident' })
  @ApiEnvelope(LaundryDetailDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  create(@SchoolId() schoolId: number, @Body() dto: LaundryInputDto, @CurrentUser() user: AuthUser) {
    return this.laundry.create(schoolId, dto, user);
  }

  @Put('laundry/:id/items')
  @RequirePermissions(PERMISSIONS.HOSTEL_LAUNDRY)
  @ResponseMessage('Laundry items saved')
  @ApiOperation({ summary: 'Replace the residents and counts while the batch is still collected' })
  @ApiEnvelope(LaundryDetailDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  items(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LaundryItemsInputDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.laundry.replaceItems(schoolId, id, dto, user);
  }

  @Post('laundry/:id/sent')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_LAUNDRY)
  @ResponseMessage('Laundry sent')
  @ApiOperation({ summary: 'Hand the batch to the laundry' })
  @ApiEnvelope(LaundryDetailDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  sent(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LaundrySentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.laundry.sent(schoolId, id, dto, user);
  }

  @Post('laundry/:id/returned')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_LAUNDRY)
  @ResponseMessage('Laundry returned')
  @ApiOperation({
    summary: 'Clothes came back: list only residents with fewer items; everyone else got all back',
  })
  @ApiEnvelope(LaundryDetailDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  returned(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LaundryReturnDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.laundry.returned(schoolId, id, dto, user);
  }

  @Post('laundry/:id/close')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_LAUNDRY)
  @ResponseMessage('Laundry batch closed')
  @ApiOperation({ summary: 'Close a returned batch once clothes are handed out' })
  @ApiEnvelope(LaundryDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  close(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.laundry.close(schoolId, id, user);
  }
}

@ApiTags(TEACHER_MODULE_TAGS.MODULE_14)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@UseGuards(HostelModuleGuard)
@HostelModuleGate('mess')
@Controller('mobile/teacher/hostel')
export class MobileHostelMessController {
  constructor(private readonly mess: HostelMessService) {}

  @Get('mess/menu')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Weekly mess menu' })
  @ApiEnvelope(MessWeekDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  menu(@CurrentUser() user: AuthUser, @Query() query: MessMenuQueryDto) {
    return this.mess.week(schoolOf(user), query.hostel_id);
  }

  @Put('mess/menu')
  @RequirePermissions(PERMISSIONS.HOSTEL_MESS)
  @ResponseMessage('Menu saved')
  @ApiOperation({ summary: 'Replace the weekly menu' })
  @ApiEnvelope(MessWeekDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  saveMenu(@CurrentUser() user: AuthUser, @Body() dto: MessMenuInputDto) {
    return this.mess.saveWeek(schoolOf(user), dto, user);
  }

  @Get('mess/overrides')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Menu changes for dates' })
  @ApiEnvelope(MessOverrideDto, { isArray: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  overrides(@CurrentUser() user: AuthUser, @Query() query: MessOverrideQueryDto) {
    return this.mess.overrides(schoolOf(user), query);
  }

  @Post('mess/overrides')
  @RequirePermissions(PERMISSIONS.HOSTEL_MESS)
  @ResponseMessage('Menu change saved')
  @ApiOperation({ summary: 'Set a special menu for a date and meal' })
  @ApiEnvelope(MessOverrideDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  addOverride(@CurrentUser() user: AuthUser, @Body() dto: MessOverrideInputDto) {
    return this.mess.saveOverride(schoolOf(user), dto, user);
  }

  @Delete('mess/overrides/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_MESS)
  @ResponseMessage('Menu change removed')
  @ApiOperation({ summary: 'Remove a date menu change' })
  @ApiEnvelope()
  @ApiErrors(HttpStatus.NOT_FOUND)
  async removeOverride(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.mess.removeOverride(schoolOf(user), id);
  }

  @Get('mess/day')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Menu of one date per meal' })
  @ApiEnvelope(MessDayDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  day(@CurrentUser() user: AuthUser, @Query() query: MessDayQueryDto) {
    return this.mess.day(schoolOf(user), query.date, query.hostel_id);
  }

  @Get('mess/headcount')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Meals to cook, split by diet, with marks so far' })
  @ApiEnvelope(MessHeadcountDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  headcount(@CurrentUser() user: AuthUser, @Query() query: MessSlotQueryDto) {
    return this.mess.headcount(schoolOf(user), query.hostel_id, query.date, query.meal);
  }

  @Get('mess/attendance')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Meal attendance sheet' })
  @ApiEnvelope(MessAttendanceSheetDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  attendance(@CurrentUser() user: AuthUser, @Query() query: MessSlotQueryDto) {
    return this.mess.sheet(schoolOf(user), query.hostel_id, query.date, query.meal);
  }

  @Post('mess/attendance/mark')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_MESS)
  @ResponseMessage('Meal attendance saved')
  @ApiOperation({ summary: 'Mark ate or skipped for today or yesterday' })
  @ApiEnvelope(MessAttendanceSheetDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  mark(@CurrentUser() user: AuthUser, @Body() dto: MessMarkDto) {
    return this.mess.mark(schoolOf(user), dto, user);
  }

  @Post('mess/attendance/scan')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_MESS)
  @ResponseMessage('Meal marked')
  @ApiOperation({ summary: 'Scan the student ID card QR: marks ate for today' })
  @ApiEnvelope(MessScanResultDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  scan(@CurrentUser() user: AuthUser, @Body() dto: MessScanDto) {
    return this.mess.scan(schoolOf(user), dto, user);
  }

  @Get('mess/skips')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Meal skips (active=true for skips still running)' })
  @ApiEnvelope(MessSkipDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  skips(@CurrentUser() user: AuthUser, @Query() query: MessSkipQueryDto) {
    return this.mess.skips(schoolOf(user), query);
  }

  @Post('mess/skips')
  @RequirePermissions(PERMISSIONS.HOSTEL_MESS)
  @ResponseMessage('Meal skip saved')
  @ApiOperation({ summary: 'Record that a resident will skip meals' })
  @ApiEnvelope(MessSkipDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  addSkip(@CurrentUser() user: AuthUser, @Body() dto: MessSkipInputDto) {
    return this.mess.createSkip(schoolOf(user), dto.admission_id, dto, 'warden', user);
  }

  @Post('mess/skips/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_MESS)
  @ResponseMessage('Meal skip cancelled')
  @ApiOperation({ summary: 'Cancel a meal skip' })
  @ApiEnvelope(MessSkipDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  cancelSkip(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.mess.cancelSkip(schoolOf(user), id, user);
  }

  @Get('mess/feedback')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Mess feedback' })
  @ApiEnvelope(MessFeedbackDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  feedback(@CurrentUser() user: AuthUser, @Query() query: MessFeedbackQueryDto) {
    return this.mess.feedback(schoolOf(user), query);
  }

  @Get('mess/feedback/summary')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Average rating and count per meal' })
  @ApiEnvelope(MessFeedbackSummaryDto)
  @ApiErrors(HttpStatus.BAD_REQUEST)
  feedbackSummary(@CurrentUser() user: AuthUser, @Query() query: MessFeedbackSummaryQueryDto) {
    return this.mess.feedbackSummary(schoolOf(user), query);
  }

  @Post('mess/feedback')
  @RequirePermissions(PERMISSIONS.HOSTEL_MESS)
  @ResponseMessage('Feedback saved')
  @ApiOperation({ summary: 'Record staff feedback on a meal' })
  @ApiEnvelope(MessFeedbackDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  addFeedback(@CurrentUser() user: AuthUser, @Body() dto: MessFeedbackInputDto) {
    return this.mess.addFeedback(schoolOf(user), dto.hostel_id, null, dto, user);
  }
}

@ApiTags(TEACHER_MODULE_TAGS.MODULE_14)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@UseGuards(HostelModuleGuard)
@HostelModuleGate('medical')
@Controller('mobile/teacher/hostel')
export class MobileHostelHealthController {
  constructor(private readonly health: HostelHealthService) {}

  @Get('health')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Health log (in_sick_bay=true for the sick bay list)' })
  @ApiEnvelope(HealthLogDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  logs(@CurrentUser() user: AuthUser, @Query() query: HealthLogQueryDto) {
    return this.health.logs(schoolOf(user), query);
  }

  @Get('health/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'One health record' })
  @ApiEnvelope(HealthLogDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  log(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.health.log(schoolOf(user), id);
  }

  @Post('health')
  @RequirePermissions(PERMISSIONS.HOSTEL_MEDICAL)
  @ResponseMessage('Health record saved')
  @ApiOperation({
    summary: 'Record illness, injury or a check-up; parents get HOSTEL_HEALTH unless notify_parent=false',
  })
  @ApiEnvelope(HealthLogDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  create(@CurrentUser() user: AuthUser, @Body() dto: HealthLogInputDto) {
    return this.health.createLog(schoolOf(user), dto, user);
  }

  @Patch('health/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_MEDICAL)
  @ResponseMessage('Health record updated')
  @ApiOperation({ summary: 'Update an open health record' })
  @ApiEnvelope(HealthLogDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  patch(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: HealthLogPatchDto) {
    return this.health.patchLog(schoolOf(user), id, dto, user);
  }

  @Post('health/:id/discharge')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_MEDICAL)
  @ResponseMessage('Discharged from the sick bay')
  @ApiOperation({ summary: 'Discharge from the sick bay' })
  @ApiEnvelope(HealthLogDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  discharge(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: HealthLogNoteDto) {
    return this.health.discharge(schoolOf(user), id, dto, user);
  }

  @Post('health/:id/close')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_MEDICAL)
  @ResponseMessage('Health record closed')
  @ApiOperation({ summary: 'Close a health record' })
  @ApiEnvelope(HealthLogDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  close(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: HealthLogNoteDto) {
    return this.health.close(schoolOf(user), id, dto, user);
  }

  @Get('medications')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Medication courses' })
  @ApiEnvelope(MedicationDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  medications(@CurrentUser() user: AuthUser, @Query() query: MedicationQueryDto) {
    return this.health.medications(schoolOf(user), query);
  }

  @Get('medications/due')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Doses to give today (or a date) with their status' })
  @ApiEnvelope(MedicationDueDto, { isArray: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  due(@CurrentUser() user: AuthUser, @Query() query: MedicationDueQueryDto) {
    return this.health.due(schoolOf(user), query);
  }

  @Post('medications')
  @RequirePermissions(PERMISSIONS.HOSTEL_MEDICAL)
  @ResponseMessage('Medication added')
  @ApiOperation({ summary: 'Start a medication course' })
  @ApiEnvelope(MedicationDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  addMedication(@CurrentUser() user: AuthUser, @Body() dto: MedicationInputDto) {
    return this.health.createMedication(schoolOf(user), dto, user);
  }

  @Post('medications/:id/stop')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_MEDICAL)
  @ResponseMessage('Medication stopped')
  @ApiOperation({ summary: 'Stop a medication course' })
  @ApiEnvelope(MedicationDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  stop(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.health.stopMedication(schoolOf(user), id, user);
  }

  @Post('medications/:id/doses')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_MEDICAL)
  @ResponseMessage('Dose recorded')
  @ApiOperation({ summary: 'Record a dose as given, missed or refused' })
  @ApiEnvelope(DoseDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  dose(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: DoseInputDto) {
    return this.health.recordDose(schoolOf(user), id, dto, user);
  }
}

@ApiTags(TEACHER_MODULE_TAGS.MODULE_14)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@UseGuards(HostelModuleGuard)
@HostelModuleGate('laundry')
@Controller('mobile/teacher/hostel')
export class MobileHostelLaundryController {
  constructor(private readonly laundry: HostelLaundryService) {}

  @Get('laundry')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Laundry batches (status=collected|sent for work in progress)' })
  @ApiEnvelope(LaundryBatchDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  list(@CurrentUser() user: AuthUser, @Query() query: LaundryQueryDto) {
    return this.laundry.list(schoolOf(user), query);
  }

  @Get('laundry/missing')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Clothes not returned by the laundry' })
  @ApiEnvelope(LaundryMissingDto)
  @ApiErrors(HttpStatus.BAD_REQUEST)
  missing(@CurrentUser() user: AuthUser, @Query() query: LaundryMissingQueryDto) {
    return this.laundry.missing(schoolOf(user), query);
  }

  @Get('laundry/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'One laundry batch with each resident’s count' })
  @ApiEnvelope(LaundryDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.laundry.get(schoolOf(user), id);
  }

  @Post('laundry')
  @RequirePermissions(PERMISSIONS.HOSTEL_LAUNDRY)
  @ResponseMessage('Laundry batch created')
  @ApiOperation({ summary: 'Collect clothes into a batch' })
  @ApiEnvelope(LaundryDetailDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  create(@CurrentUser() user: AuthUser, @Body() dto: LaundryInputDto) {
    return this.laundry.create(schoolOf(user), dto, user);
  }

  @Put('laundry/:id/items')
  @RequirePermissions(PERMISSIONS.HOSTEL_LAUNDRY)
  @ResponseMessage('Laundry items saved')
  @ApiOperation({ summary: 'Replace the residents and counts while still collected' })
  @ApiEnvelope(LaundryDetailDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  items(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: LaundryItemsInputDto) {
    return this.laundry.replaceItems(schoolOf(user), id, dto, user);
  }

  @Post('laundry/:id/sent')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_LAUNDRY)
  @ResponseMessage('Laundry sent')
  @ApiOperation({ summary: 'Hand the batch to the laundry' })
  @ApiEnvelope(LaundryDetailDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  sent(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: LaundrySentDto) {
    return this.laundry.sent(schoolOf(user), id, dto, user);
  }

  @Post('laundry/:id/returned')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_LAUNDRY)
  @ResponseMessage('Laundry returned')
  @ApiOperation({ summary: 'Clothes came back: list only residents with fewer items' })
  @ApiEnvelope(LaundryDetailDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  returned(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: LaundryReturnDto) {
    return this.laundry.returned(schoolOf(user), id, dto, user);
  }

  @Post('laundry/:id/close')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_LAUNDRY)
  @ResponseMessage('Laundry batch closed')
  @ApiOperation({ summary: 'Close a returned batch' })
  @ApiEnvelope(LaundryDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  close(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.laundry.close(schoolOf(user), id, user);
  }
}

@ApiTags(PARENT_MODULE_TAGS.MODULE_11)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND)
@RequireRoles(ROLES.PARENT)
@Controller('mobile/parent/children/:id/hostel')
export class ParentHostelCareController {
  constructor(private readonly care: HostelCareParentService) {}

  @Get('mess/menu')
  @ApiOperation({ summary: 'Weekly mess menu of my child’s hostel' })
  @ApiEnvelope(MessWeekDto)
  menu(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.care.menu(user, id);
  }

  @Get('mess/day')
  @ApiOperation({ summary: 'What is served on a date (default today), per meal' })
  @ApiEnvelope(MessDayDto)
  @ApiErrors(HttpStatus.BAD_REQUEST)
  day(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() query: ParentMessDayQueryDto) {
    return this.care.day(user, id, query.date);
  }

  @Get('mess/skips')
  @ApiOperation({ summary: 'Meal skips of my child (active=true for skips still running)' })
  @ApiEnvelope(MessSkipDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  skips(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() query: ParentMessSkipQueryDto) {
    return this.care.skips(user, id, query);
  }

  @Post('mess/skips')
  @ResponseMessage('Meal skip sent to the hostel')
  @ApiOperation({ summary: 'Tell the mess my child will skip meals (from today, up to 30 days)' })
  @ApiEnvelope(MessSkipDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  addSkip(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: ParentMessSkipInputDto) {
    return this.care.addSkip(user, id, dto);
  }

  @Post('mess/skips/:skipId/cancel')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Meal skip cancelled')
  @ApiOperation({ summary: 'Cancel a meal skip of my child that is not over yet' })
  @ApiEnvelope(MessSkipDto)
  @ApiErrors(HttpStatus.CONFLICT)
  cancelSkip(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('skipId', ParseIntPipe) skipId: number,
  ) {
    return this.care.cancelSkip(user, id, skipId);
  }

  @Post('mess/feedback')
  @ResponseMessage('Thank you for the feedback')
  @ApiOperation({ summary: 'Rate a meal (today or the last 7 days); once per meal' })
  @ApiEnvelope(MessFeedbackDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  feedback(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ParentMessFeedbackInputDto,
  ) {
    return this.care.feedback(user, id, dto);
  }

  @Get('health')
  @ApiOperation({ summary: 'Health records of my child, newest first' })
  @ApiEnvelope(HealthLogDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  health(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() query: ListQueryDto) {
    return this.care.healthLogs(user, id, query);
  }

  @Get('medications')
  @ApiOperation({ summary: 'Medicines the hostel gives my child (active=true for running courses)' })
  @ApiEnvelope(MedicationDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  medications(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ParentMedicationQueryDto,
  ) {
    return this.care.medications(user, id, query);
  }

  @Get('laundry')
  @ApiOperation({ summary: 'My child’s clothes in laundry batches, newest first' })
  @ApiEnvelope(ParentLaundryDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  laundry(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() query: ListQueryDto) {
    return this.care.laundryItems(user, id, query);
  }
}
