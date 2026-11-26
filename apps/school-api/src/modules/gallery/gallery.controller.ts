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
  Put,
  Query,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequirePermissions, ResponseMessage } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { ApiFile } from '../../shared/pdf-response';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import { XLSX } from '../attendance/attendance-export';
import {
  AlbumDetailDto,
  AlbumDto,
  AlbumQueryDto,
  AuditLogDto,
  AuditQueryDto,
  BulkMediaDto,
  ConfirmDto,
  CreateAlbumDto,
  DashboardQueryDto,
  DeleteDto,
  ExportQueryDto,
  FeatureAlbumDto,
  GalleryDashboardDto,
  GalleryMediaQueryDto,
  GalleryReportDto,
  MediaDto,
  MediaQueryDto,
  POSTER_SCHEMA,
  PublishAlbumDto,
  PurgeDto,
  PurgeResultDto,
  ReportQueryDto,
  RestoreDto,
  RestoreResultDto,
  TrashItemDto,
  TrashQueryDto,
  UpdateAlbumDto,
  UpdateMediaDto,
  UPLOAD_MEDIA_SCHEMA,
  UploadMediaDto,
  UploadResultDto,
} from './dto/gallery.dto';
import { GalleryAuditService } from './gallery-audit.service';
import { tableFile } from './gallery-export';
import { IncomingFile } from './gallery-media.service';
import { GalleryReportsService } from './gallery-reports.service';
import { GalleryService } from './gallery.service';

export const MAX_FILES_PER_REQUEST = 50;

@ApiTags('Admin · Gallery')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/gallery')
export class GalleryController {
  constructor(
    private readonly gallery: GalleryService,
    private readonly reports: GalleryReportsService,
    private readonly audit: GalleryAuditService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  @Get('dashboard')
  @RequirePermissions(PERMISSIONS.GALLERY_VIEW)
  @ApiOperation({
    summary:
      'Gallery dashboard: totals, storage, this month, expiring, Trash, holds, class and section counts, recent uploads',
    description: 'Filters narrow every count except storage. Without academic_year_id the year being viewed is used.',
  })
  @ApiEnvelope(GalleryDashboardDto)
  dashboard(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number, @Query() query: DashboardQueryDto) {
    return this.reports.dashboard(schoolId, query, user);
  }

  @Get('albums')
  @RequirePermissions(PERMISSIONS.GALLERY_VIEW)
  @ApiOperation({
    summary: 'Albums of the year being viewed, across the App, Class-wise and Section-wise galleries',
    description: 'sort: created_at, event_date, title, published_at. from/to filter on the event date.',
  })
  @ApiEnvelope(AlbumDto, { paginated: true })
  async albums(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number, @Query() query: AlbumQueryDto) {
    return this.gallery.listAlbums(await this.gallery.context(user, schoolId, 'admin'), query, { yearScoped: true });
  }

  @Post('albums')
  @RequirePermissions(PERMISSIONS.GALLERY_MANAGE)
  @ResponseMessage('Album created')
  @ApiOperation({
    summary: 'Create an album (draft unless publish is true)',
    description:
      'scope school = App Media Gallery (visibility everyone, staff, parents or classes); class needs class_id; section needs section_id and takes the section year.',
  })
  @ApiEnvelope(AlbumDetailDto, { status: HttpStatus.CREATED, message: 'Album created' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  async create(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number, @Body() dto: CreateAlbumDto) {
    return this.gallery.createAlbum(await this.gallery.context(user, schoolId, 'admin'), dto);
  }

  @Get('albums/:id')
  @RequirePermissions(PERMISSIONS.GALLERY_VIEW)
  @ApiOperation({ summary: 'Album details with the viewer switches (slideshow, downloads, sharing)' })
  @ApiEnvelope(AlbumDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  async album(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.gallery.getAlbum(await this.gallery.context(user, schoolId, 'admin'), id);
  }

  @Patch('albums/:id')
  @RequirePermissions(PERMISSIONS.GALLERY_MANAGE)
  @ResponseMessage('Album saved')
  @ApiOperation({ summary: 'Edit album details, visibility, downloads or cover' })
  @ApiEnvelope(AlbumDetailDto, { message: 'Album saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  async update(
    @CurrentUser() user: AuthUser,
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAlbumDto,
  ) {
    return this.gallery.updateAlbum(await this.gallery.context(user, schoolId, 'admin'), id, dto);
  }

  @Post('albums/:id/publish')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.GALLERY_MANAGE)
  @ResponseMessage('Album published')
  @ApiOperation({ summary: 'Publish a draft or archived album; notify tells its audience in the app' })
  @ApiEnvelope(AlbumDetailDto, { message: 'Album published' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async publish(
    @CurrentUser() user: AuthUser,
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PublishAlbumDto,
  ) {
    return this.gallery.publish(await this.gallery.context(user, schoolId, 'admin'), id, dto.notify ?? true);
  }

  @Post('albums/:id/unpublish')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.GALLERY_MANAGE)
  @ResponseMessage('Album moved back to draft')
  @ApiOperation({ summary: 'Hide an album from staff and parents by making it a draft again' })
  @ApiEnvelope(AlbumDetailDto, { message: 'Album moved back to draft' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async unpublish(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.gallery.unpublish(await this.gallery.context(user, schoolId, 'admin'), id);
  }

  @Post('albums/:id/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.GALLERY_MANAGE)
  @ResponseMessage('Album archived')
  @ApiOperation({
    summary: 'Archive an album: hidden from parents, read-only, and kept by the archived-albums retention policy',
  })
  @ApiEnvelope(AlbumDetailDto, { message: 'Album archived' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async archive(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.gallery.archive(await this.gallery.context(user, schoolId, 'admin'), id);
  }

  @Patch('albums/:id/feature')
  @RequirePermissions(PERMISSIONS.GALLERY_MANAGE)
  @ResponseMessage('Album saved')
  @ApiOperation({ summary: 'Add an album to, or remove it from, the featured albums' })
  @ApiEnvelope(AlbumDetailDto, { message: 'Album saved' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  async feature(
    @CurrentUser() user: AuthUser,
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: FeatureAlbumDto,
  ) {
    return this.gallery.feature(await this.gallery.context(user, schoolId, 'admin'), id, dto.is_featured);
  }

  @Post('albums/:id/share')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.GALLERY_MANAGE)
  @ResponseMessage('Album shared')
  @ApiOperation({
    summary: 'Send an in-app notice about a published album to everyone who can see it',
    description: '403 SHARING_DISABLED when sharing is off; 409 ALBUM_NOT_PUBLISHED. Returns { recipients }.',
  })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async share(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.gallery.share(await this.gallery.context(user, schoolId, 'admin'), id);
  }

  @Delete('albums/:id')
  @RequirePermissions(PERMISSIONS.GALLERY_MANAGE)
  @ResponseMessage('Album moved to Trash')
  @ApiOperation({ summary: 'Move an album and its media to Trash (restorable for the recovery period)' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  async remove(
    @CurrentUser() user: AuthUser,
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: DeleteDto,
  ) {
    await this.gallery.deleteAlbum(await this.gallery.context(user, schoolId, 'admin'), id, query.note);
    return null;
  }

  @Get('albums/:id/media')
  @RequirePermissions(PERMISSIONS.GALLERY_VIEW)
  @ApiOperation({
    summary: 'Photos and videos of an album with signed view, thumbnail and download links',
    description:
      'Default order is sort_order then upload order. Links expire at url_expires_at; fetch again for fresh ones.',
  })
  @ApiEnvelope(MediaDto, { paginated: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  async albumMedia(
    @CurrentUser() user: AuthUser,
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: MediaQueryDto,
  ) {
    return this.gallery.listAlbumMedia(await this.gallery.context(user, schoolId, 'admin'), id, query);
  }

  @Post('albums/:id/media')
  @RequirePermissions(PERMISSIONS.GALLERY_MANAGE)
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FilesInterceptor('files', MAX_FILES_PER_REQUEST))
  @ResponseMessage('Upload finished')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: UPLOAD_MEDIA_SCHEMA })
  @ApiOperation({
    summary: 'Upload photos and videos (multipart field "files", several at once)',
    description:
      'Each file is checked by its content, size and duration against the gallery settings. Photos are auto-rotated, resized, compressed and stripped of EXIF/GPS; a thumbnail is made. Video location metadata is removed. Duplicates in the album are skipped. Per-file results come back in items: retry only the failed ones.',
  })
  @ApiEnvelope(UploadResultDto, { message: 'Upload finished' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT, HttpStatus.PAYLOAD_TOO_LARGE)
  async upload(
    @CurrentUser() user: AuthUser,
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFiles() files: IncomingFile[] | undefined,
    @Body() dto: UploadMediaDto,
  ) {
    return this.gallery.upload(await this.gallery.context(user, schoolId, 'admin'), id, files ?? [], dto.checksums);
  }

  @Get('media')
  @RequirePermissions(PERMISSIONS.GALLERY_VIEW)
  @ApiOperation({
    summary: 'Search photos and videos across albums',
    description:
      'expiring=true lists media whose retention ends within the notice period. sort: created_at, size_bytes, expires_at, trash_at.',
  })
  @ApiEnvelope(MediaDto, { paginated: true })
  async media(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number, @Query() query: GalleryMediaQueryDto) {
    return this.gallery.listAllMedia(await this.gallery.context(user, schoolId, 'admin'), query);
  }

  @Post('media/delete')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.GALLERY_MANAGE)
  @ResponseMessage('Moved to Trash')
  @ApiOperation({ summary: 'Move several photos and videos to Trash' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  async bulkDelete(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number, @Body() dto: BulkMediaDto) {
    return this.gallery.deleteMedia(await this.gallery.context(user, schoolId, 'admin'), dto.media_ids, dto.note);
  }

  @Get('media/:id')
  @RequirePermissions(PERMISSIONS.GALLERY_VIEW)
  @ApiOperation({ summary: 'One photo or video with fresh signed links' })
  @ApiEnvelope(MediaDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  async mediaItem(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.gallery.getMedia(await this.gallery.context(user, schoolId, 'admin'), id);
  }

  @Patch('media/:id')
  @RequirePermissions(PERMISSIONS.GALLERY_MANAGE)
  @ResponseMessage('Saved')
  @ApiOperation({ summary: 'Edit the caption, description or position of a photo or video' })
  @ApiEnvelope(MediaDto, { message: 'Saved' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  async updateMedia(
    @CurrentUser() user: AuthUser,
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMediaDto,
  ) {
    return this.gallery.updateMedia(await this.gallery.context(user, schoolId, 'admin'), id, dto);
  }

  @Put('media/:id/poster')
  @RequirePermissions(PERMISSIONS.GALLERY_MANAGE)
  @UseInterceptors(FileInterceptor('file'))
  @ResponseMessage('Video still saved')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: POSTER_SCHEMA })
  @ApiOperation({ summary: 'Set the still image (thumbnail) of a video, taken by the app from a frame' })
  @ApiEnvelope(MediaDto, { message: 'Video still saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  async poster(
    @CurrentUser() user: AuthUser,
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: IncomingFile | undefined,
  ) {
    return this.gallery.setPoster(await this.gallery.context(user, schoolId, 'admin'), id, file);
  }

  @Delete('media/:id')
  @RequirePermissions(PERMISSIONS.GALLERY_MANAGE)
  @ResponseMessage('Moved to Trash')
  @ApiOperation({ summary: 'Move a photo or video to Trash' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  async removeMedia(
    @CurrentUser() user: AuthUser,
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: DeleteDto,
  ) {
    await this.gallery.deleteMedia(await this.gallery.context(user, schoolId, 'admin'), [id], query.note);
    return null;
  }

  @Get('trash')
  @RequirePermissions(PERMISSIONS.GALLERY_MANAGE)
  @ApiOperation({
    summary: 'Gallery Trash: deleted media (kind=media) or deleted albums (kind=album)',
    description:
      'Shows why and when each item was deleted, where it came from and when it is deleted for good. sort: deleted_at, purge_after, size_bytes (media) or title (albums).',
  })
  @ApiEnvelope(TrashItemDto, { paginated: true })
  async trash(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number, @Query() query: TrashQueryDto) {
    return this.gallery.listTrash(await this.gallery.context(user, schoolId, 'admin'), query);
  }

  @Post('trash/restore')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.GALLERY_MANAGE)
  @ResponseMessage('Restored')
  @ApiOperation({
    summary: 'Restore media and albums from Trash',
    description:
      'Media go back to their album. If that album is gone they are listed in needs_album: send target_album_id to put them in another album. Media restored after a retention deletion get a fresh deletion notice at the next cleanup unless you add a hold.',
  })
  @ApiEnvelope(RestoreResultDto, { message: 'Restored' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  async restore(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number, @Body() dto: RestoreDto) {
    return this.gallery.restore(await this.gallery.context(user, schoolId, 'admin'), dto);
  }

  @Post('trash/purge')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.GALLERY_CONFIGURE)
  @ResponseMessage('Deleted for good')
  @ApiOperation({ summary: 'Delete chosen Trash items for good, with their files and thumbnails (confirm: true)' })
  @ApiEnvelope(PurgeResultDto, { message: 'Deleted for good' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  async purge(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number, @Body() dto: PurgeDto) {
    return this.gallery.purgeSelected(await this.gallery.context(user, schoolId, 'admin'), dto);
  }

  @Post('trash/empty')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.GALLERY_CONFIGURE)
  @ResponseMessage('Trash emptied')
  @ApiOperation({
    summary: 'Empty the Trash (confirm: true)',
    description:
      'Deletes up to 5000 items per call; call again while media_purged is 5000. A manual empty is an explicit admin action, so it also deletes held media in Trash; albums with an active hold stay.',
  })
  @ApiEnvelope(PurgeResultDto, { message: 'Trash emptied' })
  async empty(@CurrentUser() user: AuthUser, @SchoolId() schoolId: number, @Body() dto: ConfirmDto) {
    return this.gallery.emptyTrash(await this.gallery.context(user, schoolId, 'admin'), dto.confirm);
  }

  @Get('reports/:report')
  @RequirePermissions(PERMISSIONS.GALLERY_VIEW)
  @ApiOperation({
    summary: 'A gallery report as columns and rows',
    description:
      'report: class_usage, section_usage, album_counts, category_usage, upload_activity, user_uploads, storage, expiring, deleted, restored, purged, cleanup_activity, cleanup_failures.',
  })
  @ApiEnvelope(GalleryReportDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  report(@SchoolId() schoolId: number, @Param('report') report: string, @Query() query: ReportQueryDto) {
    return this.reports.report(schoolId, report, query);
  }

  @Get('reports/:report/export')
  @RequirePermissions(PERMISSIONS.GALLERY_VIEW)
  @ApiOperation({ summary: 'Download a gallery report as Excel (format=xlsx) or CSV (format=csv)' })
  @ApiFile(XLSX, 'Excel or CSV file')
  @ApiErrors(HttpStatus.NOT_FOUND)
  exportReport(@SchoolId() schoolId: number, @Param('report') report: string, @Query() query: ExportQueryDto) {
    return this.reports.exportReport(schoolId, report, query, query.format);
  }

  @Get('audit-logs')
  @RequirePermissions(PERMISSIONS.GALLERY_AUDIT)
  @ApiOperation({
    summary:
      'Gallery audit log: uploads, edits, deletions, restores, permanent deletions, settings, holds, cleanup runs',
    description: 'Read-only: the database refuses changes to audit rows. sort: created_at, action, user_name.',
  })
  @ApiEnvelope(AuditLogDto, { paginated: true })
  auditLogs(@SchoolId() schoolId: number, @Query() query: AuditQueryDto) {
    return this.audit.list(schoolId, query, this.app.timeZone);
  }

  @Get('audit-logs/export')
  @RequirePermissions(PERMISSIONS.GALLERY_AUDIT)
  @ApiOperation({
    summary: 'Download the filtered audit log as Excel (every matching row, up to 10,000; page and limit are ignored)',
  })
  @ApiFile(XLSX, 'Excel file')
  async exportAudit(@SchoolId() schoolId: number, @Query() query: AuditQueryDto) {
    const rows = await this.audit.exportRows(schoolId, query, this.app.timeZone);
    return tableFile(
      {
        name: 'gallery-audit-log',
        title: 'Gallery audit log',
        subtitle: [query.from, query.to].filter(Boolean).join(' to ') || 'All dates',
        columns: [
          { key: 'created_at', label: 'When' },
          { key: 'user_name', label: 'User' },
          { key: 'user_role', label: 'Role' },
          { key: 'action', label: 'Action' },
          { key: 'album_id', label: 'Album' },
          { key: 'media_id', label: 'Media' },
          { key: 'class_id', label: 'Class' },
          { key: 'section_id', label: 'Section' },
          { key: 'result', label: 'Result' },
          { key: 'details', label: 'Details' },
          { key: 'ip', label: 'IP' },
        ],
        rows: rows.map((row) => ({ ...row })),
      },
      'xlsx',
    );
  }
}
