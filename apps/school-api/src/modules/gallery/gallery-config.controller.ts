import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequirePermissions, ResponseMessage } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { ApiFile } from '../../shared/pdf-response';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import { XLSX } from '../attendance/attendance-export';
import {
  CategoryDto,
  CategoryInputDto,
  CategoryQueryDto,
  CategoryUpdateDto,
  CleanupJobDto,
  CleanupJobItemDto,
  CleanupPreviewDto,
  CleanupStatusDto,
  ConfirmQueryDto,
  FormatQueryDto,
  GallerySettingsDto,
  HoldDto,
  HoldInputDto,
  HoldQueryDto,
  JobItemQueryDto,
  JobQueryDto,
  PolicyDto,
  PolicyInputDto,
  PolicyUpdateDto,
  ReleaseHoldDto,
  RetentionOverviewDto,
  RunCleanupDto,
  UpdateGallerySettingsDto,
} from './dto/gallery-config.dto';
import { ConfirmDto } from './dto/gallery.dto';
import { GalleryCleanupService } from './gallery-cleanup.service';
import { GalleryRetentionService } from './gallery-retention.service';
import { GallerySettingsService } from './gallery-settings.service';

@ApiTags('Admin · Gallery settings & retention')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/gallery')
export class GalleryConfigController {
  constructor(
    private readonly settings: GallerySettingsService,
    private readonly retention: GalleryRetentionService,
    private readonly cleanup: GalleryCleanupService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  @Get('settings')
  @RequirePermissions(PERMISSIONS.GALLERY_VIEW)
  @ApiOperation({
    summary: 'Gallery configuration: switches, upload limits, storage, retention and cleanup schedule',
    description: 'Defaults: retention 1 year from upload, daily cleanup at 02:00, 30 days notice, 30 days recovery.',
  })
  @ApiEnvelope(GallerySettingsDto)
  view(@SchoolId() schoolId: number) {
    return this.settings.view(schoolId);
  }

  @Patch('settings')
  @RequirePermissions(PERMISSIONS.GALLERY_CONFIGURE)
  @ResponseMessage('Gallery settings saved')
  @ApiOperation({
    summary: 'Change gallery settings (send only what changes)',
    description:
      '409 CONFIRMATION_REQUIRED when the change can delete media sooner (shorter retention, notice or recovery; automatic or permanent deletion switched on): show a confirmation, then send again with confirm: true. Retention changes recalculate every expiry date.',
  })
  @ApiEnvelope(GallerySettingsDto, { message: 'Gallery settings saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  async update(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number, @Body() dto: UpdateGallerySettingsDto) {
    const result = await this.settings.update(schoolId, dto, user);
    if (result.retention_changed) await this.retention.refresh(schoolId);
    return result.settings;
  }

  @Post('settings/reset')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.GALLERY_CONFIGURE)
  @ResponseMessage('Gallery settings reset to defaults')
  @ApiOperation({ summary: 'Reset every gallery setting to its default (confirm: true)' })
  @ApiEnvelope(GallerySettingsDto, { message: 'Gallery settings reset to defaults' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  async reset(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number, @Body() dto: ConfirmDto) {
    const settings = await this.settings.reset(schoolId, user, dto.confirm);
    await this.retention.refresh(schoolId);
    return settings;
  }

  @Get('categories')
  @RequirePermissions(PERMISSIONS.GALLERY_VIEW)
  @ApiOperation({ summary: 'Gallery categories (school events, sports, annual day and the school’s own)' })
  @ApiEnvelope(CategoryDto, { isArray: true })
  categories(@SchoolId() schoolId: number, @Query() query: CategoryQueryDto) {
    return this.settings.listCategories(schoolId, query.all);
  }

  @Post('categories')
  @RequirePermissions(PERMISSIONS.GALLERY_CONFIGURE)
  @ResponseMessage('Category added')
  @ApiOperation({ summary: 'Add a gallery category' })
  @ApiEnvelope(CategoryDto, { status: HttpStatus.CREATED, message: 'Category added' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  addCategory(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number, @Body() dto: CategoryInputDto) {
    return this.settings.createCategory(schoolId, dto, user);
  }

  @Patch('categories/:id')
  @RequirePermissions(PERMISSIONS.GALLERY_CONFIGURE)
  @ResponseMessage('Category saved')
  @ApiOperation({ summary: 'Rename, reorder or switch off a category' })
  @ApiEnvelope(CategoryDto, { message: 'Category saved' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  updateCategory(
    @CurrentUser() user: AuthUser,
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CategoryUpdateDto,
  ) {
    return this.settings.updateCategory(schoolId, id, dto, user);
  }

  @Delete('categories/:id')
  @RequirePermissions(PERMISSIONS.GALLERY_CONFIGURE)
  @ResponseMessage('Category removed')
  @ApiOperation({ summary: 'Remove an unused category', description: '409 CATEGORY_IN_USE when albums use it.' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async removeCategory(
    @CurrentUser() user: AuthUser,
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.settings.removeCategory(schoolId, id, user);
    return null;
  }

  @Get('retention')
  @RequirePermissions(PERMISSIONS.GALLERY_VIEW)
  @ApiOperation({
    summary: 'Retention overview: the default and every policy with how many items it covers',
    description:
      'The most specific policy wins: album, archived albums, category, academic year, gallery (App/Class/Section), photos or videos, then the default.',
  })
  @ApiEnvelope(RetentionOverviewDto)
  overview(@SchoolId() schoolId: number) {
    return this.retention.overview(schoolId);
  }

  @Post('retention/policies')
  @RequirePermissions(PERMISSIONS.GALLERY_CONFIGURE)
  @ResponseMessage('Retention policy added')
  @ApiOperation({
    summary: 'Add a retention policy for an album, archived albums, a category, a year, a gallery or a media type',
    description:
      '409 POLICY_EXISTS for a duplicate target; 409 CONFIRMATION_REQUIRED when it is shorter than the default.',
  })
  @ApiEnvelope(PolicyDto, { status: HttpStatus.CREATED, message: 'Retention policy added' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  addPolicy(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number, @Body() dto: PolicyInputDto) {
    return this.retention.createPolicy(schoolId, dto, user);
  }

  @Patch('retention/policies/:id')
  @RequirePermissions(PERMISSIONS.GALLERY_CONFIGURE)
  @ResponseMessage('Retention policy saved')
  @ApiOperation({
    summary: 'Change a retention policy',
    description: '409 CONFIRMATION_REQUIRED when it shortens retention.',
  })
  @ApiEnvelope(PolicyDto, { message: 'Retention policy saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  updatePolicy(
    @CurrentUser() user: AuthUser,
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PolicyUpdateDto,
  ) {
    return this.retention.updatePolicy(schoolId, id, dto, user);
  }

  @Delete('retention/policies/:id')
  @RequirePermissions(PERMISSIONS.GALLERY_CONFIGURE)
  @ResponseMessage('Retention policy removed')
  @ApiOperation({
    summary: 'Remove a retention policy; its media fall back to the next rule',
    description: '409 CONFIRMATION_REQUIRED (send ?confirm=true) when the policy kept media longer than the default.',
  })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async removePolicy(
    @CurrentUser() user: AuthUser,
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ConfirmQueryDto,
  ) {
    await this.retention.removePolicy(schoolId, id, user, query.confirm ?? false);
    return null;
  }

  @Get('retention/holds')
  @RequirePermissions(PERMISSIONS.GALLERY_VIEW)
  @ApiOperation({
    summary: 'Retention holds: albums and media protected from automatic deletion, with reason and who applied them',
    description: 'active=false lists released and ended holds.',
  })
  @ApiEnvelope(HoldDto, { paginated: true })
  holds(@SchoolId() schoolId: number, @Query() query: HoldQueryDto) {
    return this.retention.listHolds(schoolId, query, this.app.timeZone);
  }

  @Post('retention/holds')
  @RequirePermissions(PERMISSIONS.GALLERY_CONFIGURE)
  @ResponseMessage('Retention hold applied')
  @ApiOperation({
    summary: 'Protect an album or a photo/video from automatic deletion',
    description:
      'No keep_until = kept until released (permanent retention); a keep_until date extends retention to that day. Items already scheduled for Trash are taken off the schedule.',
  })
  @ApiEnvelope(HoldDto, { status: HttpStatus.CREATED, message: 'Retention hold applied' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  applyHold(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number, @Body() dto: HoldInputDto) {
    return this.retention.applyHold(schoolId, dto, user, this.app.timeZone);
  }

  @Post('retention/holds/:id/release')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.GALLERY_CONFIGURE)
  @ResponseMessage('Retention hold released')
  @ApiOperation({
    summary: 'Release a retention hold (with a reason)',
    description:
      '409 CONFIRMATION_REQUIRED when protected items are already past retention: they will be scheduled for Trash.',
  })
  @ApiEnvelope(HoldDto, { message: 'Retention hold released' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  releaseHold(
    @CurrentUser() user: AuthUser,
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReleaseHoldDto,
  ) {
    return this.retention.releaseHold(schoolId, id, dto, user, this.app.timeZone);
  }

  @Get('cleanup/status')
  @RequirePermissions(PERMISSIONS.GALLERY_VIEW)
  @ApiOperation({ summary: 'Cleanup monitoring: last run, next run, running or paused, failed items to retry' })
  @ApiEnvelope(CleanupStatusDto)
  status(@SchoolId() schoolId: number) {
    return this.cleanup.status(schoolId);
  }

  @Get('cleanup/preview')
  @RequirePermissions(PERMISSIONS.GALLERY_CONFIGURE)
  @ApiOperation({
    summary: 'What a cleanup run would do now, without changing anything',
    description: 'Show this before Run cleanup now.',
  })
  @ApiEnvelope(CleanupPreviewDto)
  preview(@SchoolId() schoolId: number) {
    return this.cleanup.preview(schoolId);
  }

  @Post('cleanup/run')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.GALLERY_CONFIGURE)
  @ResponseMessage('Cleanup finished')
  @ApiOperation({
    summary: 'Run the cleanup now (confirm: true after showing the preview)',
    description: '409 CONFIRMATION_REQUIRED without confirm; 409 CLEANUP_RUNNING when one is already running.',
  })
  @ApiEnvelope(CleanupJobDto, { message: 'Cleanup finished' })
  @ApiErrors(HttpStatus.CONFLICT)
  run(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number, @Body() dto: RunCleanupDto) {
    return this.cleanup.runNow(schoolId, user, dto.confirm);
  }

  @Post('cleanup/pause')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.GALLERY_CONFIGURE)
  @ResponseMessage('Scheduled cleanup paused')
  @ApiOperation({ summary: 'Pause the scheduled cleanup' })
  @ApiEnvelope(CleanupStatusDto, { message: 'Scheduled cleanup paused' })
  async pause(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number) {
    await this.settings.setPaused(schoolId, true, user);
    return this.cleanup.status(schoolId);
  }

  @Post('cleanup/resume')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.GALLERY_CONFIGURE)
  @ResponseMessage('Scheduled cleanup resumed')
  @ApiOperation({ summary: 'Resume the scheduled cleanup from the next scheduled time' })
  @ApiEnvelope(CleanupStatusDto, { message: 'Scheduled cleanup resumed' })
  async resume(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number) {
    await this.settings.setPaused(schoolId, false, user);
    return this.cleanup.status(schoolId);
  }

  @Get('cleanup/jobs')
  @RequirePermissions(PERMISSIONS.GALLERY_VIEW)
  @ApiOperation({ summary: 'Cleanup execution history', description: 'sort: started_at, duration_ms.' })
  @ApiEnvelope(CleanupJobDto, { paginated: true })
  jobs(@SchoolId() schoolId: number, @Query() query: JobQueryDto) {
    return this.cleanup.listJobs(schoolId, query);
  }

  @Get('cleanup/jobs/:id')
  @RequirePermissions(PERMISSIONS.GALLERY_VIEW)
  @ApiOperation({ summary: 'One cleanup run with its counts, duration, storage freed and error' })
  @ApiEnvelope(CleanupJobDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  job(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.cleanup.getJob(schoolId, id);
  }

  @Get('cleanup/jobs/:id/items')
  @RequirePermissions(PERMISSIONS.GALLERY_VIEW)
  @ApiOperation({ summary: 'What a cleanup run did, item by item (filter by action, e.g. failed)' })
  @ApiEnvelope(CleanupJobItemDto, { paginated: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  items(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Query() query: JobItemQueryDto) {
    return this.cleanup.listItems(schoolId, id, query);
  }

  @Post('cleanup/jobs/:id/retry')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.GALLERY_CONFIGURE)
  @ResponseMessage('Retry finished')
  @ApiOperation({ summary: 'Retry the failed deletions of a cleanup run', description: '409 NOTHING_TO_RETRY.' })
  @ApiEnvelope(CleanupJobDto, { message: 'Retry finished' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  retry(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.cleanup.retry(schoolId, id, user);
  }

  @Get('cleanup/jobs/:id/export')
  @RequirePermissions(PERMISSIONS.GALLERY_VIEW)
  @ApiOperation({ summary: 'Download the cleanup report of one run (xlsx or csv)' })
  @ApiFile(XLSX, 'Excel or CSV file')
  @ApiErrors(HttpStatus.NOT_FOUND)
  exportJob(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Query() query: FormatQueryDto) {
    return this.cleanup.exportJob(schoolId, id, query.format);
  }
}
