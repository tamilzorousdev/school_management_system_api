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
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequireRoles, ResponseMessage } from '@app/common';
import { ROLES } from '../access/access.catalog';
import { PARENT_MODULE_TAGS } from '../mobile/parent-modules.catalog';
import { TEACHER_MODULE_TAGS } from '../mobile/teacher-modules.catalog';
import {
  AlbumDetailDto,
  AlbumDto,
  CreateAlbumDto,
  DeleteDto,
  GalleryCategoryOptionDto,
  MediaDto,
  MediaQueryDto,
  MobileAlbumQueryDto,
  ParentAlbumQueryDto,
  ParentCategoryQueryDto,
  POSTER_SCHEMA,
  PublishAlbumDto,
  UpdateAlbumDto,
  UpdateMediaDto,
  UPLOAD_MEDIA_SCHEMA,
  UploadMediaDto,
  UploadOptionsDto,
  UploadResultDto,
} from './dto/gallery.dto';
import { GalleryAccessService } from './gallery-access.service';
import { MAX_FILES_PER_REQUEST } from './gallery.controller';
import { IncomingFile } from './gallery-media.service';
import { GalleryService } from './gallery.service';

@ApiTags(TEACHER_MODULE_TAGS.MODULE_13)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@RequireRoles(ROLES.TEACHER, ROLES.HOD, ROLES.PRINCIPAL, ROLES.GATE_INCHARGE)
@Controller('mobile/teacher/gallery')
export class TeacherGalleryController {
  constructor(
    private readonly gallery: GalleryService,
    private readonly access: GalleryAccessService,
  ) {}

  @Get('options')
  @ApiOperation({
    summary: 'Can I upload, to which classes and sections, which categories, file types and limits',
    description:
      'targets lists the current-year sections I teach or am class teacher of. Use it for the upload screen pickers.',
  })
  @ApiEnvelope(UploadOptionsDto)
  async options(@CurrentUser() user: AuthUser) {
    return this.gallery.uploadOptions(await this.staff(user));
  }

  @Get('albums')
  @ApiOperation({
    summary: 'Albums I can see: school albums open to staff and the albums of my classes and sections',
    description:
      'mine=true shows only albums I created (drafts included). sort: created_at, event_date, title, published_at.',
  })
  @ApiEnvelope(AlbumDto, { paginated: true })
  async albums(@CurrentUser() user: AuthUser, @Query() query: MobileAlbumQueryDto) {
    return this.gallery.listAlbums(await this.staff(user), query, { yearScoped: false, mine: query.mine });
  }

  @Post('albums')
  @ResponseMessage('Album created')
  @ApiOperation({
    summary: 'Create a class or section album for a class or section I teach',
    description:
      'scope class (class_id) or section (section_id). 403 CLASS_NOT_ASSIGNED for other classes, GALLERY_UPLOAD_NOT_ALLOWED when the school does not let my role upload.',
  })
  @ApiEnvelope(AlbumDetailDto, { status: HttpStatus.CREATED, message: 'Album created' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateAlbumDto) {
    return this.gallery.createAlbum(await this.staff(user), dto);
  }

  @Get('albums/:id')
  @ApiOperation({ summary: 'Album details with the viewer switches (slideshow, downloads)' })
  @ApiEnvelope(AlbumDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  async album(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.gallery.getAlbum(await this.staff(user), id);
  }

  @Patch('albums/:id')
  @ResponseMessage('Album saved')
  @ApiOperation({ summary: 'Edit an album I manage (mine, or any album of a section I am class teacher of)' })
  @ApiEnvelope(AlbumDetailDto, { message: 'Album saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateAlbumDto) {
    return this.gallery.updateAlbum(await this.staff(user), id, dto);
  }

  @Post('albums/:id/publish')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Album published')
  @ApiOperation({
    summary: 'Publish an album so parents of the class or section can see it; notify sends them a notice',
  })
  @ApiEnvelope(AlbumDetailDto, { message: 'Album published' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async publish(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: PublishAlbumDto) {
    return this.gallery.publish(await this.staff(user), id, dto.notify ?? true);
  }

  @Post('albums/:id/unpublish')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Album moved back to draft')
  @ApiOperation({ summary: 'Hide an album again by making it a draft' })
  @ApiEnvelope(AlbumDetailDto, { message: 'Album moved back to draft' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async unpublish(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.gallery.unpublish(await this.staff(user), id);
  }

  @Post('albums/:id/share')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Album shared')
  @ApiOperation({ summary: 'Send the class or section a notice about a published album. Returns { recipients }.' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async share(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.gallery.share(await this.staff(user), id);
  }

  @Delete('albums/:id')
  @ResponseMessage('Album moved to Trash')
  @ApiOperation({ summary: 'Move an album I manage to Trash (the admin can restore it)' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() query: DeleteDto) {
    await this.gallery.deleteAlbum(await this.staff(user), id, query.note);
    return null;
  }

  @Get('albums/:id/media')
  @ApiOperation({ summary: 'Photos and videos of an album with signed view, thumbnail and download links' })
  @ApiEnvelope(MediaDto, { paginated: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  async media(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() query: MediaQueryDto) {
    return this.gallery.listAlbumMedia(await this.staff(user), id, query);
  }

  @Post('albums/:id/media')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FilesInterceptor('files', MAX_FILES_PER_REQUEST))
  @ResponseMessage('Upload finished')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: UPLOAD_MEDIA_SCHEMA })
  @ApiOperation({
    summary: 'Upload photos and videos to an album of my class or section (multipart field "files")',
    description:
      'Send several files per request, or one per request to show progress per file. items has the result of each file; retry only those with status failed.',
  })
  @ApiEnvelope(UploadResultDto, { message: 'Upload finished' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT, HttpStatus.PAYLOAD_TOO_LARGE)
  async upload(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFiles() files: IncomingFile[] | undefined,
    @Body() dto: UploadMediaDto,
  ) {
    return this.gallery.upload(await this.staff(user), id, files ?? [], dto.checksums);
  }

  @Get('media/:id')
  @ApiOperation({ summary: 'One photo or video with fresh signed links' })
  @ApiEnvelope(MediaDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  async item(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.gallery.getMedia(await this.staff(user), id);
  }

  @Patch('media/:id')
  @ResponseMessage('Saved')
  @ApiOperation({ summary: 'Edit the caption of my upload (class teachers: any upload of their section)' })
  @ApiEnvelope(MediaDto, { message: 'Saved' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  async updateMedia(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateMediaDto) {
    return this.gallery.updateMedia(await this.staff(user), id, dto);
  }

  @Put('media/:id/poster')
  @UseInterceptors(FileInterceptor('file'))
  @ResponseMessage('Video still saved')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: POSTER_SCHEMA })
  @ApiOperation({ summary: 'Set the still image of a video I uploaded (take a frame in the app)' })
  @ApiEnvelope(MediaDto, { message: 'Video still saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  async poster(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: IncomingFile | undefined,
  ) {
    return this.gallery.setPoster(await this.staff(user), id, file);
  }

  @Delete('media/:id')
  @ResponseMessage('Moved to Trash')
  @ApiOperation({
    summary: 'Delete my upload (when the school allows it) or, as class teacher, any upload of my section',
    description: '403 MEDIA_DELETE_NOT_ALLOWED otherwise.',
  })
  @ApiErrors(HttpStatus.NOT_FOUND)
  async removeMedia(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() query: DeleteDto) {
    await this.gallery.deleteMedia(await this.staff(user), [id], query.note);
    return null;
  }

  private staff(user: AuthUser) {
    return this.gallery.context(user, this.access.schoolOf(user), 'staff');
  }
}

@ApiTags(PARENT_MODULE_TAGS.MODULE_10)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND)
@RequireRoles(ROLES.PARENT)
@Controller('mobile/parent/gallery')
export class ParentGalleryController {
  constructor(
    private readonly gallery: GalleryService,
    private readonly access: GalleryAccessService,
  ) {}

  @Get('albums')
  @ApiOperation({
    summary: 'Albums my children can see: school albums for parents and the albums of their classes and sections',
    description:
      'student_id narrows to one child. Includes earlier years of the child’s classes. featured=true for the home strip.',
  })
  @ApiEnvelope(AlbumDto, { paginated: true })
  async albums(@CurrentUser() user: AuthUser, @Query() query: ParentAlbumQueryDto) {
    return this.gallery.listAlbums(await this.parent(user, query.student_id), query, { yearScoped: false });
  }

  @Get('categories')
  @ApiOperation({
    summary: 'Gallery categories of the school, for the album filter',
    description: 'Active categories only, in the school order. student_id picks the child’s school.',
  })
  @ApiEnvelope(GalleryCategoryOptionDto, { isArray: true })
  async categories(@CurrentUser() user: AuthUser, @Query() query: ParentCategoryQueryDto) {
    return this.gallery.categoryOptions(await this.parent(user, query.student_id));
  }

  @Get('albums/:id')
  @ApiOperation({ summary: 'Album details with the viewer switches (slideshow, downloads)' })
  @ApiEnvelope(AlbumDetailDto)
  async album(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.gallery.getAlbum(await this.parent(user), id);
  }

  @Get('albums/:id/media')
  @ApiOperation({
    summary: 'Photos and videos of an album',
    description: 'download_url is null when the school or album does not allow downloads.',
  })
  @ApiEnvelope(MediaDto, { paginated: true })
  async media(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() query: MediaQueryDto) {
    return this.gallery.listAlbumMedia(await this.parent(user), id, query);
  }

  @Get('media/:id')
  @ApiOperation({ summary: 'One photo or video with fresh signed links' })
  @ApiEnvelope(MediaDto)
  async item(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.gallery.getMedia(await this.parent(user), id);
  }

  private async parent(user: AuthUser, studentId?: number) {
    const schoolId = await this.access.parentSchool(user, studentId);
    return this.gallery.context(user, schoolId, 'parent', studentId);
  }
}
