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
import { AlumniService } from './alumni.service';
import { AlumniSubmissionsService } from './alumni-submissions.service';
import { alumniFile, XLSX } from './alumni-export';
import {
  AlumniDetailDto,
  AlumniInsightsDto,
  AlumniItemDto,
  AlumniQueryDto,
  AlumniStatusInputDto,
  ApproveSubmissionDto,
  BatchCountDto,
  PassOutPreviewDto,
  PassOutPreviewQueryDto,
  RejectSubmissionDto,
  ReplaceHistoryDto,
  SubmissionDto,
  SubmissionQueryDto,
  UpdateAlumniDto,
  UpdateLinkDto,
} from './dto/alumni.dto';

@ApiTags('Admin · Alumni')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/alumni')
export class AlumniController {
  constructor(
    private readonly alumni: AlumniService,
    private readonly submissions: AlumniSubmissionsService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ALUMNI_VIEW)
  @ApiOperation({ summary: 'List alumni with batch, occupation, source and contact filters' })
  @ApiEnvelope(AlumniItemDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  list(@SchoolId() schoolId: number, @Query() query: AlumniQueryDto) {
    return this.alumni.list(schoolId, query);
  }

  @Get('insights')
  @RequirePermissions(PERMISSIONS.ALUMNI_VIEW)
  @ApiOperation({ summary: 'Alumni counters: total, reachable, latest batch, pending approvals, occupations' })
  @ApiEnvelope(AlumniInsightsDto)
  insights(@SchoolId() schoolId: number) {
    return this.alumni.insights(schoolId);
  }

  @Get('batches')
  @RequirePermissions(PERMISSIONS.ALUMNI_VIEW)
  @ApiOperation({ summary: 'Batches (years of leaving) with alumni counts, newest first' })
  @ApiEnvelope(BatchCountDto, { isArray: true })
  batches(@SchoolId() schoolId: number) {
    return this.alumni.batches(schoolId);
  }

  @Get('pass-out-preview')
  @RequirePermissions(PERMISSIONS.ALUMNI_VIEW)
  @ApiOperation({
    summary: 'Who becomes an alumnus when this academic year closes',
    description:
      'Final-class students still studying become alumni automatically when the year is closed (another year is made current). Detained students stay.',
  })
  @ApiEnvelope(PassOutPreviewDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.BAD_REQUEST)
  passOutPreview(@SchoolId() schoolId: number, @Query() query: PassOutPreviewQueryDto) {
    return this.alumni.passOutPreview(schoolId, query.academic_year_id);
  }

  @Get('export')
  @RequirePermissions(PERMISSIONS.ALUMNI_VIEW)
  @ApiOperation({ summary: 'Download alumni as Excel, using the same filters as the list' })
  @ApiFile(XLSX, 'Alumni register')
  async export(@SchoolId() schoolId: number, @Query() query: AlumniQueryDto) {
    return alumniFile(await this.alumni.exportRows(schoolId, query));
  }

  @Get('submissions')
  @RequirePermissions(PERMISSIONS.ALUMNI_VIEW)
  @ApiOperation({ summary: 'Self-registrations and self-updates waiting for review' })
  @ApiEnvelope(SubmissionDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  listSubmissions(@SchoolId() schoolId: number, @Query() query: SubmissionQueryDto) {
    return this.submissions.list(schoolId, query);
  }

  @Post('submissions/:id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.ALUMNI_MANAGE)
  @ResponseMessage('Submission approved')
  @ApiOperation({
    summary: 'Approve a submission',
    description:
      'Registration: creates an alumni record, or merges contact details into alumni_id. Update: applies the submitted contact and career details.',
  })
  @ApiEnvelope(SubmissionDto, { message: 'Submission approved' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  approve(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApproveSubmissionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.submissions.approve(schoolId, id, dto, user);
  }

  @Post('submissions/:id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.ALUMNI_MANAGE)
  @ResponseMessage('Submission rejected')
  @ApiOperation({ summary: 'Reject a submission with a reason' })
  @ApiEnvelope(SubmissionDto, { message: 'Submission rejected' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  reject(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectSubmissionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.submissions.reject(schoolId, id, dto, user);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.ALUMNI_VIEW)
  @ApiOperation({ summary: 'Alumni profile with academic history and change history' })
  @ApiEnvelope(AlumniDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.alumni.get(schoolId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.ALUMNI_MANAGE)
  @ResponseMessage('Alumni profile updated')
  @ApiOperation({ summary: 'Update an alumni profile; every changed field is recorded' })
  @ApiEnvelope(AlumniDetailDto, { message: 'Alumni profile updated' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.BAD_REQUEST)
  update(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAlumniDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.alumni.update(schoolId, id, dto, user);
  }

  @Put(':id/academic-history')
  @RequirePermissions(PERMISSIONS.ALUMNI_MANAGE)
  @ResponseMessage('Academic history saved')
  @ApiOperation({ summary: 'Replace the manually entered years; years copied from the system stay' })
  @ApiEnvelope(AlumniDetailDto, { message: 'Academic history saved' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.BAD_REQUEST)
  replaceHistory(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReplaceHistoryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.alumni.replaceHistory(schoolId, id, dto, user);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.ALUMNI_MANAGE)
  @ResponseMessage('Alumni status updated')
  @ApiOperation({ summary: 'Mark an alumnus active or inactive (do not contact)' })
  @ApiEnvelope(AlumniDetailDto, { message: 'Alumni status updated' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  setStatus(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AlumniStatusInputDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.alumni.setStatus(schoolId, id, dto, user);
  }

  @Post(':id/update-link')
  @RequirePermissions(PERMISSIONS.ALUMNI_MANAGE)
  @ResponseMessage('Update link created')
  @ApiOperation({
    summary: 'Create a 14-day link the alumnus can use to update their own details',
    description: 'Earlier unused links for this alumnus stop working. Their changes wait for approval.',
  })
  @ApiEnvelope(UpdateLinkDto, { message: 'Update link created' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  updateLink(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.alumni.issueLink(schoolId, id, user);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.ALUMNI_MANAGE)
  @ResponseMessage('Alumni record deleted')
  @ApiOperation({ summary: 'Delete an alumni record; the student record is kept' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  remove(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.alumni.remove(schoolId, id);
  }
}
