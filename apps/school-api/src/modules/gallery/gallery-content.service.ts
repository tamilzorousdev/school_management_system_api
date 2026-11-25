import { Injectable, StreamableFile } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppException, AuthUser } from '@app/common';
import { SignedMediaQueryDto } from './dto/gallery.dto';
import { GalleryMedia } from './entities/gallery.entity';
import { GalleryAuditService } from './gallery-audit.service';
import { GalleryMediaService } from './gallery-media.service';
import { GallerySettingsService } from './gallery-settings.service';

@Injectable()
export class GalleryContentService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(GalleryMedia) private readonly media: Repository<GalleryMedia>,
    private readonly mediaService: GalleryMediaService,
    private readonly settings: GallerySettingsService,
    private readonly audit: GalleryAuditService,
  ) {}

  async open(
    id: number,
    query: SignedMediaQueryDto,
    range: string | undefined,
  ): Promise<{ file: StreamableFile; status: number; headers: Record<string, string> }> {
    if (!this.mediaService.verify(id, query)) {
      throw AppException.forbidden('This link has expired or is not valid', 'LINK_EXPIRED');
    }
    const row = await this.media.findOne({ where: { id }, withDeleted: true });
    if (!row) throw AppException.notFound('Photo or video not found', 'MEDIA_NOT_FOUND');
    const result = await this.mediaService.stream(row, query.variant, range);
    if (query.variant === 'download' && !range) await this.auditDownload(row, query.user);
    return result;
  }

  private async auditDownload(row: GalleryMedia, userId: number): Promise<void> {
    const settings = await this.settings.forSchool(row.school_id);
    if (!settings.download_audit_enabled) return;
    const [user] = await this.dataSource.query(
      `SELECT u.id, u.name, COALESCE(array_agg(r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles
       FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id
       WHERE u.id = $1 GROUP BY u.id`,
      [userId],
    );
    const actor = user
      ? ({ id: Number(user.id), name: user.name, roles: user.roles, permissions: [] } as unknown as AuthUser)
      : null;
    this.audit.recordQuietly({
      school_id: row.school_id,
      actor,
      action: 'media.downloaded',
      album_id: row.album_id,
      media_id: row.id,
      details: { name: row.original_name },
    });
  }
}
