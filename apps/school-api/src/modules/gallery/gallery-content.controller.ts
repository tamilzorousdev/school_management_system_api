import { Controller, Get, Headers, HttpStatus, Param, ParseIntPipe, Query, Res } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ApiErrors, Public } from '@app/common';
import { SignedMediaQueryDto } from './dto/gallery.dto';
import { GalleryContentService } from './gallery-content.service';

@ApiTags('Files')
@Controller('files/gallery')
export class GalleryContentController {
  constructor(private readonly content: GalleryContentService) {}

  @Public()
  @Get(':id/content')
  @ApiProduces('image/*', 'video/*')
  @ApiHeader({
    name: 'Range',
    required: false,
    description: 'bytes=start-end, for video seeking (206 Partial Content)',
  })
  @ApiOperation({
    summary: 'Gallery photo, thumbnail, video or download through a signed link. No token needed; the link expires.',
    description:
      'Links come from the gallery endpoints (url, thumbnail_url, download_url). Supports Range for video players.',
  })
  @ApiErrors(HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND)
  async stream(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: SignedMediaQueryDto,
    @Headers('range') range: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.content.open(id, query, range);
    res.status(result.status);
    res.set(result.headers);
    return result.file;
  }
}
