import { Body, Controller, Get, HttpStatus, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelope,
  ApiErrors,
  AppException,
  AuthUser,
  CurrentUser,
  RequirePermissions,
  ResponseMessage,
} from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS, ROLES } from '../access/access.catalog';
import { AppraisalsService } from './appraisals.service';
import {
  AppraisalQueryDto,
  StaffAppraisalDto,
  StaffAppraisalInputDto,
  StaffPerformanceMetricsDto,
} from './dto/staff-appraisal.dto';
import { AppraisalAppealDto, ResolveAppealDto } from './dto/kra-config.dto';

@ApiTags('Admin · Staff')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/staff-appraisals')
export class StaffAppraisalController {
  constructor(private readonly appraisals: AppraisalsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.STAFF_VIEW)
  @ApiOperation({
    summary: 'List staff appraisals with ratings, scores, and status filters',
  })
  @ApiEnvelope(StaffAppraisalDto, { paginated: true })
  list(@SchoolId() schoolId: number, @Query() query: AppraisalQueryDto) {
    return this.appraisals.list(schoolId, query);
  }

  @Get('staff/:staffId/metrics')
  @RequirePermissions(PERMISSIONS.STAFF_VIEW)
  @ApiOperation({
    summary: 'Get objective performance metrics (attendance %, periods taught, student pass %) for a teacher',
  })
  @ApiEnvelope(StaffPerformanceMetricsDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  metrics(
    @SchoolId() schoolId: number,
    @Param('staffId', ParseIntPipe) staffId: number,
    @Query('academic_year_id') academicYearId?: number,
  ) {
    return this.appraisals.metrics(schoolId, staffId, academicYearId ? Number(academicYearId) : undefined);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.STAFF_VIEW)
  @ApiOperation({ summary: 'Get details of a single staff performance review' })
  @ApiEnvelope(StaffAppraisalDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.appraisals.get(schoolId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  @ResponseMessage('Staff appraisal created')
  @ApiOperation({ summary: 'Conduct and save a new staff performance review (draft)' })
  @ApiEnvelope(StaffAppraisalDto, { status: HttpStatus.CREATED, message: 'Staff appraisal created' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  create(@SchoolId() schoolId: number, @CurrentUser() user: AuthUser, @Body() dto: StaffAppraisalInputDto) {
    return this.appraisals.create(schoolId, user, dto);
  }

  @Post('bulk')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  @ResponseMessage('Staff appraisals uploaded and imported')
  @ApiOperation({ summary: 'Bulk upload / import staff appraisals from spreadsheet' })
  @ApiEnvelope(StaffAppraisalDto, { isArray: true })
  bulkImport(
    @SchoolId() schoolId: number,
    @CurrentUser() user: AuthUser,
    @Body() dtos: StaffAppraisalInputDto[],
  ) {
    const canManage =
      user.roles.includes(ROLES.SUPER_ADMIN) ||
      user.roles.includes(ROLES.ADMIN) ||
      user.roles.includes(ROLES.PRINCIPAL);
    if (!canManage) {
      throw AppException.forbidden(
        'Only an Admin, Super Admin, or Principal can upload or edit appraisals.',
      );
    }
    return this.appraisals.bulkImport(schoolId, user, dtos);
  }

  @Put(':id')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  @ResponseMessage('Staff appraisal updated')
  @ApiOperation({ summary: 'Update scores or feedback on a draft staff performance review' })
  @ApiEnvelope(StaffAppraisalDto, { message: 'Staff appraisal updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.FORBIDDEN)
  update(
    @SchoolId() schoolId: number,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: StaffAppraisalInputDto,
  ) {
    const canManage =
      user.roles.includes(ROLES.SUPER_ADMIN) ||
      user.roles.includes(ROLES.ADMIN) ||
      user.roles.includes(ROLES.PRINCIPAL);
    if (!canManage) {
      throw AppException.forbidden(
        'Only an Admin, Super Admin, or Principal can edit appraisals.',
      );
    }
    return this.appraisals.update(schoolId, id, dto);
  }

  @Post(':id/finalize')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  @ResponseMessage('Staff appraisal finalized and published to staff')
  @ApiOperation({ summary: 'Finalize and publish the appraisal to the teacher mobile app' })
  @ApiEnvelope(StaffAppraisalDto, { message: 'Staff appraisal finalized and published to staff' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.FORBIDDEN)
  finalize(@SchoolId() schoolId: number, @CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const canManage =
      user.roles.includes(ROLES.SUPER_ADMIN) ||
      user.roles.includes(ROLES.ADMIN) ||
      user.roles.includes(ROLES.PRINCIPAL);
    if (!canManage) {
      throw AppException.forbidden(
        'Only an Admin, Super Admin, or Principal can approve and finalize appraisals.',
      );
    }
    return this.appraisals.finalize(schoolId, id, user);
  }

  @Post(':id/appeal')
  @RequirePermissions(PERMISSIONS.STAFF_VIEW)
  @ResponseMessage('Appraisal appeal submitted successfully')
  @ApiOperation({ summary: 'Submit an appeal / hike review request for an appraisal' })
  @ApiEnvelope(StaffAppraisalDto, { message: 'Appraisal appeal submitted successfully' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  appeal(
    @SchoolId() schoolId: number,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AppraisalAppealDto,
  ) {
    return this.appraisals.raiseAppeal(schoolId, user, id, dto);
  }

  @Post(':id/resolve-appeal')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  @ResponseMessage('Appraisal appeal resolved successfully')
  @ApiOperation({ summary: 'Resolve an appraisal appeal and finalize revised hike' })
  @ApiEnvelope(StaffAppraisalDto, { message: 'Appraisal appeal resolved successfully' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.FORBIDDEN)
  resolveAppeal(
    @SchoolId() schoolId: number,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResolveAppealDto,
  ) {
    const canManage =
      user.roles.includes(ROLES.SUPER_ADMIN) ||
      user.roles.includes(ROLES.ADMIN) ||
      user.roles.includes(ROLES.PRINCIPAL);
    if (!canManage) {
      throw AppException.forbidden(
        'Only an Admin, Super Admin, or Principal can review and resolve appraisal appeals.',
      );
    }
    return this.appraisals.resolveAppeal(schoolId, user, id, dto);
  }
}
