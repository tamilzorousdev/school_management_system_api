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
import { ApiFile } from '../../shared/pdf-response';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import { XLSX } from '../attendance/attendance-export';
import { AppraisalCyclesService } from './appraisal-cycles.service';
import { AppraisalGroupsService } from './appraisal-groups.service';
import { AppraisalsService } from './appraisals.service';
import {
  AcknowledgeDto,
  AppealDto,
  AppealInputDto,
  AppealQueryDto,
  AppraisalDto,
  AppraisalGroupDto,
  AppraisalGroupInputDto,
  AppraisalListItemDto,
  AppraisalQueryDto,
  CopyYearDto,
  CopyYearResultDto,
  CycleDto,
  CycleInputDto,
  CycleInsightsDto,
  CycleQueryDto,
  DecideAppealDto,
  DossierDto,
  DossierQueryDto,
  ExtendCycleDto,
  FinalInputDto,
  GroupMembersDto,
  GroupMembersInputDto,
  HodInputDto,
  KraSetInputDto,
  PublishManyDto,
  PublishResultDto,
  RemindResultDto,
  ReviewsQueryDto,
  SelfInputDto,
  UpdateAppraisalGroupDto,
  UpdateCycleDto,
} from './dto/appraisal.dto';

@ApiTags('Admin · Appraisals')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/appraisal-groups')
export class AppraisalGroupsController {
  constructor(private readonly groups: AppraisalGroupsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.APPRAISALS_VIEW)
  @ApiOperation({
    summary: 'Appraisal groups of the academic year being viewed, each with its KRAs',
    description: 'member_count is who the group would hold today (rules, included and excluded staff).',
  })
  @ApiEnvelope(AppraisalGroupDto, { isArray: true })
  list(@SchoolId() schoolId: number) {
    return this.groups.list(schoolId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.APPRAISALS_CONFIGURE)
  @ResponseMessage('Group created')
  @ApiOperation({
    summary: 'Create a group in the current academic year',
    description:
      'rules pick staff by staff type, department, designation and role (all chosen kinds must match; within a kind any value). starter_kras fills a standard KRA set. 409 GROUP_NAME_TAKEN.',
  })
  @ApiEnvelope(AppraisalGroupDto, { status: HttpStatus.CREATED, message: 'Group created' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  create(@SchoolId() schoolId: number, @Body() dto: AppraisalGroupInputDto) {
    return this.groups.create(schoolId, dto);
  }

  @Post('copy-year')
  @RequirePermissions(PERMISSIONS.APPRAISALS_CONFIGURE)
  @ResponseMessage('Groups copied')
  @ApiOperation({
    summary: 'Copy groups, their people and KRAs to another academic year',
    description:
      'Groups whose name already exists in the target year are skipped. 409 YEAR_NOT_WRITABLE for a closed year.',
  })
  @ApiEnvelope(CopyYearResultDto, { status: HttpStatus.CREATED, message: 'Groups copied' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  copyYear(@SchoolId() schoolId: number, @Body() dto: CopyYearDto) {
    return this.groups.copyYear(schoolId, dto);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.APPRAISALS_VIEW)
  @ApiOperation({ summary: 'One group with its KRAs' })
  @ApiEnvelope(AppraisalGroupDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.groups.get(schoolId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.APPRAISALS_CONFIGURE)
  @ResponseMessage('Group updated')
  @ApiOperation({ summary: 'Rename, change rules or priority, or switch a group off' })
  @ApiEnvelope(AppraisalGroupDto, { message: 'Group updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  update(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateAppraisalGroupDto) {
    return this.groups.update(schoolId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.APPRAISALS_CONFIGURE)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Group deleted')
  @ApiOperation({
    summary: 'Delete a group',
    description: '409 GROUP_IN_USE while a cycle that is not closed uses it.',
  })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async remove(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.groups.remove(schoolId, id);
    return null;
  }

  @Get(':id/members')
  @RequirePermissions(PERMISSIONS.APPRAISALS_VIEW)
  @ApiOperation({
    summary: 'Who is in the group today, and who matches but sits in another group',
    description:
      'A person goes to the group they are included in, else the first matching group by sort_order, else the default group.',
  })
  @ApiEnvelope(GroupMembersDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  members(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.groups.membersOf(schoolId, id);
  }

  @Put(':id/members')
  @RequirePermissions(PERMISSIONS.APPRAISALS_CONFIGURE)
  @ResponseMessage('People updated')
  @ApiOperation({ summary: 'Staff always in (included) and never in (excluded) this group' })
  @ApiEnvelope(GroupMembersDto, { message: 'People updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  setMembers(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: GroupMembersInputDto) {
    return this.groups.setMembers(schoolId, id, dto);
  }

  @Put(':id/kras')
  @RequirePermissions(PERMISSIONS.APPRAISALS_CONFIGURE)
  @ResponseMessage('KRAs saved')
  @ApiOperation({
    summary: "Replace the group's KRA set",
    description:
      'Weights must add up to 100. An auto KRA is scored from school data (auto_metric); the score is value ÷ auto_target × max_score. Open appraisals keep the KRAs they started with.',
  })
  @ApiEnvelope(AppraisalGroupDto, { message: 'KRAs saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  setKras(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: KraSetInputDto) {
    return this.groups.setKras(schoolId, id, dto.kras);
  }
}

@ApiTags('Admin · Appraisals')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/appraisal-cycles')
export class AppraisalCyclesController {
  constructor(private readonly cycles: AppraisalCyclesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.APPRAISALS_VIEW)
  @ApiOperation({ summary: 'Appraisal cycles of the academic year being viewed, with counts per step' })
  @ApiEnvelope(CycleDto, { paginated: true })
  list(@SchoolId() schoolId: number, @Query() query: CycleQueryDto) {
    return this.cycles.list(schoolId, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.APPRAISALS_CONFIGURE)
  @ResponseMessage('Cycle saved')
  @ApiOperation({ summary: 'Save a draft cycle for chosen groups with its deadlines' })
  @ApiEnvelope(CycleDto, { status: HttpStatus.CREATED, message: 'Cycle saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  create(@SchoolId() schoolId: number, @Body() dto: CycleInputDto) {
    return this.cycles.create(schoolId, dto);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.APPRAISALS_VIEW)
  @ApiOperation({ summary: 'One cycle' })
  @ApiEnvelope(CycleDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.cycles.get(schoolId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.APPRAISALS_CONFIGURE)
  @ResponseMessage('Cycle saved')
  @ApiOperation({ summary: 'Change a draft or scheduled cycle', description: '409 CYCLE_LOCKED once it is open.' })
  @ApiEnvelope(CycleDto, { message: 'Cycle saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  update(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCycleDto) {
    return this.cycles.update(schoolId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.APPRAISALS_CONFIGURE)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Cycle deleted')
  @ApiOperation({ summary: 'Delete a draft cycle', description: '409 CYCLE_NOT_DRAFT' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async remove(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.cycles.remove(schoolId, id);
    return null;
  }

  @Post(':id/open')
  @RequirePermissions(PERMISSIONS.APPRAISALS_CONFIGURE)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Cycle opened')
  @ApiOperation({
    summary: 'Open the cycle now, or schedule it for self_opens_at',
    description:
      'Creates one appraisal per person in the groups (with the KRAs of their group and the HOD of their department) and notifies them. 409 GROUP_KRAS_INCOMPLETE, CYCLE_NOT_DRAFT; 400 NO_RECIPIENTS.',
  })
  @ApiEnvelope(CycleDto, { message: 'Cycle opened' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  open(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.cycles.open(schoolId, id);
  }

  @Post(':id/close')
  @RequirePermissions(PERMISSIONS.APPRAISALS_CONFIGURE)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Cycle closed')
  @ApiOperation({
    summary: 'Close the cycle: staff and HODs can no longer change scores',
    description: 'The Principal can still finalise, publish and decide appeals.',
  })
  @ApiEnvelope(CycleDto, { message: 'Cycle closed' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  close(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.cycles.close(schoolId, id);
  }

  @Post(':id/extend')
  @RequirePermissions(PERMISSIONS.APPRAISALS_CONFIGURE)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Deadlines moved')
  @ApiOperation({ summary: 'Move the deadlines later' })
  @ApiEnvelope(CycleDto, { message: 'Deadlines moved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  extend(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: ExtendCycleDto) {
    return this.cycles.extend(schoolId, id, dto);
  }

  @Post(':id/remind')
  @RequirePermissions(PERMISSIONS.APPRAISALS_CONFIGURE)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Reminders sent')
  @ApiOperation({ summary: 'Remind staff whose self-appraisal is not sent and HODs with reviews waiting' })
  @ApiEnvelope(RemindResultDto, { message: 'Reminders sent' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  remind(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.cycles.remind(schoolId, id);
  }

  @Get(':id/insights')
  @RequirePermissions(PERMISSIONS.APPRAISALS_VIEW)
  @ApiOperation({ summary: 'Counts per step, average final % and ratings of the cycle' })
  @ApiEnvelope(CycleInsightsDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  insights(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.cycles.insights(schoolId, id);
  }

  @Get(':id/export')
  @RequirePermissions(PERMISSIONS.APPRAISALS_VIEW)
  @ApiOperation({ summary: 'Excel: a summary sheet and every KRA score' })
  @ApiFile(XLSX, 'Appraisals')
  @ApiErrors(HttpStatus.NOT_FOUND)
  exportFile(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.cycles.export(schoolId, id);
  }
}

@ApiTags('Admin · Appraisals')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/appraisals')
export class AppraisalsAdminController {
  constructor(private readonly appraisals: AppraisalsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.APPRAISALS_VIEW)
  @ApiOperation({
    summary: 'Staff appraisals of the academic year being viewed',
    description: 'Filters: cycle_id, group_id, stage, rating, search (name, employee no, designation, department).',
  })
  @ApiEnvelope(AppraisalListItemDto, { paginated: true })
  list(@SchoolId() schoolId: number, @Query() query: AppraisalQueryDto) {
    return this.appraisals.list(schoolId, query);
  }

  @Post('publish')
  @RequirePermissions(PERMISSIONS.APPRAISALS_FINALIZE)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Results published')
  @ApiOperation({
    summary: 'Publish many results at once',
    description: 'Appraisals not at the Principal step, or with a KRA without any score, are skipped.',
  })
  @ApiEnvelope(PublishResultDto, { message: 'Results published' })
  publishMany(@SchoolId() schoolId: number, @CurrentUser() user: AuthUser, @Body() dto: PublishManyDto) {
    return this.appraisals.publishMany(schoolId, dto.ids, user);
  }

  @Get('appeals')
  @RequirePermissions(PERMISSIONS.APPRAISALS_VIEW)
  @ApiOperation({ summary: 'Appeals of the academic year being viewed' })
  @ApiEnvelope(AppealDto, { paginated: true })
  appeals(@SchoolId() schoolId: number, @Query() query: AppealQueryDto) {
    return this.appraisals.listAppeals(schoolId, query);
  }

  @Post('appeals/:appealId/decide')
  @RequirePermissions(PERMISSIONS.APPRAISALS_FINALIZE)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Appeal decided')
  @ApiOperation({
    summary: 'Accept (optionally with revised final scores and increment) or reject an appeal',
    description: 'Either way the appraisal is completed. 409 APPEAL_DECIDED.',
  })
  @ApiEnvelope(AppealDto, { message: 'Appeal decided' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  decide(
    @SchoolId() schoolId: number,
    @CurrentUser() user: AuthUser,
    @Param('appealId', ParseIntPipe) appealId: number,
    @Body() dto: DecideAppealDto,
  ) {
    return this.appraisals.decideAppeal(schoolId, appealId, user, dto);
  }

  @Get('staff/:staffId/dossier')
  @RequirePermissions(PERMISSIONS.APPRAISALS_VIEW)
  @ApiOperation({
    summary: 'Facts for the review: attendance, classes with pass %, homework, parent and driver ratings',
    description: 'For the academic year being viewed unless academic_year_id is given.',
  })
  @ApiEnvelope(DossierDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  dossier(
    @SchoolId() schoolId: number,
    @Param('staffId', ParseIntPipe) staffId: number,
    @Query() query: DossierQueryDto,
  ) {
    return this.appraisals.dossier(schoolId, staffId, query.academic_year_id);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.APPRAISALS_VIEW)
  @ApiOperation({ summary: 'One appraisal: self, HOD, auto and final score of each KRA, evidence and appeals' })
  @ApiEnvelope(AppraisalDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.appraisals.get(schoolId, id);
  }

  @Put(':id/final')
  @RequirePermissions(PERMISSIONS.APPRAISALS_FINALIZE)
  @ResponseMessage('Final review saved')
  @ApiOperation({
    summary: 'Principal: final scores, recommendation, increment and remarks (not yet published)',
    description:
      'A final score that differs from the proposed one (HOD, else auto, else self) needs override_reason. 409 APPRAISAL_NOT_IN_STAGE.',
  })
  @ApiEnvelope(AppraisalDto, { message: 'Final review saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  saveFinal(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: FinalInputDto) {
    return this.appraisals.saveFinal(schoolId, id, dto);
  }

  @Post(':id/publish')
  @RequirePermissions(PERMISSIONS.APPRAISALS_FINALIZE)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Result published')
  @ApiOperation({
    summary: 'Publish the result to the staff member, who can then acknowledge or appeal',
    description: 'Missing final scores take the proposed score. 400 when a KRA has no score at all.',
  })
  @ApiEnvelope(AppraisalDto, { message: 'Result published' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  publish(@SchoolId() schoolId: number, @CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.appraisals.publish(schoolId, id, user);
  }
}

@ApiTags('Me · Appraisals')
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED)
@Controller('me/appraisals')
export class MeAppraisalsController {
  constructor(private readonly appraisals: AppraisalsService) {}

  @Get()
  @ApiOperation({
    summary: 'My appraisals (Staff app), newest first',
    description: 'hod_percent, final_percent and rating stay empty until the result is published.',
  })
  @ApiEnvelope(AppraisalListItemDto, { isArray: true })
  mine(@CurrentUser() user: AuthUser) {
    return this.appraisals.mine(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One of my appraisals with my KRAs, my scores and, once published, the result' })
  @ApiEnvelope(AppraisalDto)
  @ApiErrors(HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND)
  one(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.appraisals.mineOne(user, id);
  }

  @Put(':id/self')
  @ResponseMessage('Saved')
  @ApiOperation({
    summary: 'Save my self-appraisal without sending it',
    description: 'Scores 1 to max_score. file_ids replaces my evidence. 409 APPRAISAL_NOT_IN_STAGE, CYCLE_NOT_OPEN.',
  })
  @ApiEnvelope(AppraisalDto, { message: 'Saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.FORBIDDEN, HttpStatus.CONFLICT)
  saveSelf(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: SelfInputDto) {
    return this.appraisals.saveSelf(user, id, dto, false);
  }

  @Post(':id/self/submit')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Self-appraisal sent')
  @ApiOperation({
    summary: 'Send my self-appraisal to my HOD (or the Principal)',
    description: 'Every manual KRA needs a score (errors[].field = scores.<kra_id>). It cannot be changed afterwards.',
  })
  @ApiEnvelope(AppraisalDto, { message: 'Self-appraisal sent' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.FORBIDDEN, HttpStatus.CONFLICT)
  submitSelf(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: SelfInputDto) {
    return this.appraisals.saveSelf(user, id, dto, true);
  }

  @Post(':id/acknowledge')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Result acknowledged')
  @ApiOperation({ summary: 'Accept my published result, with an optional remark' })
  @ApiEnvelope(AppraisalDto, { message: 'Result acknowledged' })
  @ApiErrors(HttpStatus.FORBIDDEN, HttpStatus.CONFLICT)
  acknowledge(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: AcknowledgeDto) {
    return this.appraisals.acknowledge(user, id, dto);
  }

  @Post(':id/appeal')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Appeal sent')
  @ApiOperation({
    summary: 'Appeal my published result within the appeal window',
    description: '409 APPEAL_WINDOW_CLOSED, APPRAISAL_NOT_IN_STAGE.',
  })
  @ApiEnvelope(AppraisalDto, { message: 'Appeal sent' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.FORBIDDEN, HttpStatus.CONFLICT)
  appeal(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: AppealInputDto) {
    return this.appraisals.appeal(user, id, dto);
  }
}

@ApiTags('Me · Appraisals')
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED)
@Controller('me/appraisal-reviews')
export class MeAppraisalReviewsController {
  constructor(private readonly appraisals: AppraisalsService) {}

  @Get()
  @ApiOperation({
    summary: 'HOD: appraisals of my department waiting for my scores (state=pending) or already reviewed (done)',
  })
  @ApiEnvelope(AppraisalListItemDto, { isArray: true })
  list(@CurrentUser() user: AuthUser, @Query() query: ReviewsQueryDto) {
    return this.appraisals.reviews(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'HOD: one appraisal with the self scores, comments, evidence and school data' })
  @ApiEnvelope(AppraisalDto)
  @ApiErrors(HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND)
  one(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.appraisals.review(user, id);
  }

  @Put(':id')
  @ResponseMessage('Saved')
  @ApiOperation({ summary: 'HOD: save my scores without sending' })
  @ApiEnvelope(AppraisalDto, { message: 'Saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.FORBIDDEN, HttpStatus.CONFLICT)
  save(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: HodInputDto) {
    return this.appraisals.saveReview(user, id, dto, false);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Review sent to the Principal')
  @ApiOperation({
    summary: 'HOD: send my scores to the Principal',
    description: 'Every manual KRA needs a score; auto KRAs take the school-data score unless changed.',
  })
  @ApiEnvelope(AppraisalDto, { message: 'Review sent to the Principal' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.FORBIDDEN, HttpStatus.CONFLICT)
  submit(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: HodInputDto) {
    return this.appraisals.saveReview(user, id, dto, true);
  }
}
