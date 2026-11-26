import { Inject, Injectable, Logger, StreamableFile } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import sharp from 'sharp';
import { DataSource, Repository } from 'typeorm';
import { AppException, AuthUser } from '@app/common';
import { appConfig, AppConfig, storageConfig, StorageConfig } from '../../config/configuration';
import { FILE_STORAGE, FileStorage } from '../files/storage/local.storage';
import { MediaDto, UploadResultDto } from './dto/gallery.dto';
import {
  GalleryAlbum,
  GalleryMedia,
  GallerySettings,
  GalleryUploadSession,
  UploadResult,
} from './entities/gallery.entity';
import { GalleryAuditService } from './gallery-audit.service';
import { GalleryRetentionService } from './gallery-retention.service';
import { GallerySigner, MediaVariant, SignedMediaQuery } from './gallery-signer';
import {
  expiryFor,
  isoVideoSeconds,
  parseRange,
  PolicyRule,
  resolveRetention,
  safeFileName,
  sniffFormat,
  SniffedFormat,
} from './gallery.logic';

export interface IncomingFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface MediaFlags {
  downloads: boolean;
  held: Set<number>;
  heldAlbums: Set<number>;
  canDelete: (media: GalleryMedia) => boolean;
  names: Map<number, string>;
}

export interface PurgeOutcome {
  media_id: number;
  album_id: number;
  name: string;
  size_bytes: number;
  error: string | null;
}

interface PreparedMedia {
  content: Buffer;
  thumbnail: Buffer | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  metadata: Record<string, unknown>;
}

class UploadRejected extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const MB = 1024 * 1024;
const PRIVATE_ISO_BOXES = new Set(['udta', 'meta']);

export function scrubIsoMetadata(buffer: Buffer): number {
  let scrubbed = 0;
  const walk = (from: number, to: number, depth: number) => {
    let offset = from;
    while (offset + 8 <= to) {
      let size = buffer.readUInt32BE(offset);
      const type = buffer.subarray(offset + 4, offset + 8).toString('latin1');
      let header = 8;
      if (size === 1) {
        if (offset + 16 > to) return;
        size = Number(buffer.readBigUInt64BE(offset + 8));
        header = 16;
      } else if (size === 0) {
        size = to - offset;
      }
      if (size < header || offset + size > to) return;
      if (depth > 0 && PRIVATE_ISO_BOXES.has(type)) {
        buffer.write('free', offset + 4, 'latin1');
        scrubbed += 1;
      } else if (type === 'moov' || (depth > 0 && type === 'trak')) {
        walk(offset + header, offset + size, depth + 1);
      }
      offset += size;
    }
  };
  walk(0, buffer.length, 0);
  return scrubbed;
}

@Injectable()
export class GalleryMediaService {
  private readonly logger = new Logger('GalleryMedia');
  private readonly signer: GallerySigner;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(GalleryMedia) private readonly media: Repository<GalleryMedia>,
    @InjectRepository(GalleryUploadSession) private readonly sessions: Repository<GalleryUploadSession>,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(storageConfig.KEY) storageSettings: StorageConfig,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
    private readonly retention: GalleryRetentionService,
    private readonly audit: GalleryAuditService,
  ) {
    this.signer = new GallerySigner(storageSettings.signingSecret, storageSettings.urlTtlSeconds);
  }

  acceptedTypes(settings: GallerySettings): string[] {
    const images: Record<string, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
    const videos: Record<string, string> = {
      mp4: 'video/mp4',
      mov: 'video/quicktime',
      webm: 'video/webm',
      '3gp': 'video/3gpp',
    };
    return [
      ...settings.image_formats.map((format) => images[format]!),
      ...(settings.videos_enabled ? settings.video_formats.map((format) => videos[format]!) : []),
    ];
  }

  async usedBytes(schoolId: number): Promise<number> {
    const [row] = await this.dataSource.query(
      `SELECT COALESCE(SUM(size_bytes + thumbnail_bytes), 0) AS used FROM gallery_media WHERE school_id = $1`,
      [schoolId],
    );
    return Number(row.used);
  }

  async upload(
    album: GalleryAlbum,
    files: IncomingFile[],
    checksums: string[] | undefined,
    settings: GallerySettings,
    actor: AuthUser,
    flags: Omit<MediaFlags, 'names'>,
  ): Promise<UploadResultDto> {
    if (!files.length) throw AppException.badRequest('Choose photos or videos to upload', 'FILE_MISSING');
    if (files.length > settings.max_files_per_upload) {
      throw AppException.badRequest(
        `Upload at most ${settings.max_files_per_upload} files at a time`,
        'TOO_MANY_FILES',
      );
    }
    const session = await this.sessions.save(
      this.sessions.create({ school_id: album.school_id, album_id: album.id, total: files.length }),
    );
    const rules = await this.retention.rules(album.school_id);
    const quota = settings.storage_quota_mb * MB;
    let used = await this.usedBytes(album.school_id);
    const seen = new Set<string>();
    const results: UploadResult[] = [];
    const saved: GalleryMedia[] = [];
    let bytes = 0;

    for (const [index, file] of files.entries()) {
      const name = file.originalname?.slice(0, 255) || `file-${index + 1}`;
      try {
        const hash = createHash('sha256').update(file.buffer).digest('hex');
        const expected = checksums?.[index]?.toLowerCase();
        if (expected && expected !== hash) {
          throw new UploadRejected('CHECKSUM_MISMATCH', 'The file changed on the way. Upload it again.');
        }
        const format = this.check(file, settings);
        if (seen.has(hash) || (await this.media.existsBy({ album_id: album.id, content_hash: hash }))) {
          results.push({
            index,
            name,
            status: 'duplicate',
            media_id: null,
            error: 'DUPLICATE_MEDIA',
            message: 'Already in this album',
          });
          continue;
        }
        seen.add(hash);
        const prepared = await this.prepare(file, format, settings);
        const total = prepared.content.length + (prepared.thumbnail?.length ?? 0);
        if (used + total > quota) {
          throw new UploadRejected('STORAGE_FULL', 'Gallery storage is full. Ask the admin to free space.');
        }
        const row = await this.store(album, file, name, format, prepared, hash, session.id, actor, settings, rules);
        used += total;
        bytes += total;
        saved.push(row);
        results.push({ index, name, status: 'accepted', media_id: row.id, error: null, message: null });
      } catch (error) {
        const known = error instanceof UploadRejected;
        if (!known) this.logger.warn(`Album ${album.id}: upload of "${name}" failed: ${(error as Error).message}`);
        results.push({
          index,
          name,
          status: known && error.code === 'DUPLICATE_MEDIA' ? 'duplicate' : 'failed',
          media_id: null,
          error: known ? error.code : 'UPLOAD_FAILED',
          message: known ? error.message : 'This file could not be saved. Try again.',
        });
      }
    }

    const accepted = results.filter((item) => item.status === 'accepted').length;
    const duplicates = results.filter((item) => item.status === 'duplicate').length;
    const failed = results.filter((item) => item.status === 'failed').length;
    await this.sessions.update(session.id, {
      accepted,
      duplicates,
      failed,
      bytes: String(bytes),
      results,
      status: failed === 0 ? 'completed' : accepted ? 'partial' : 'failed',
    });
    if (accepted && !album.cover_media_id) {
      const cover = saved.find((item) => item.media_type === 'image') ?? saved[0]!;
      await this.dataSource.query(
        `UPDATE gallery_albums SET cover_media_id = $1 WHERE id = $2 AND cover_media_id IS NULL`,
        [cover.id, album.id],
      );
    }
    await this.audit.record({
      school_id: album.school_id,
      actor,
      action: 'media.uploaded',
      album_id: album.id,
      class_id: album.class_id,
      section_id: album.section_id,
      result: accepted || duplicates ? 'success' : 'failure',
      details: { session_id: session.id, accepted, duplicates, failed, bytes, media_ids: saved.map((item) => item.id) },
    });
    const names = new Map([[actor.id, actor.name]]);
    return {
      session_id: session.id,
      total: files.length,
      accepted,
      duplicates,
      failed,
      items: results,
      media: saved.map((row) => this.present(row, album, actor.id, { ...flags, names })),
    };
  }

  async setPoster(
    media: GalleryMedia,
    file: IncomingFile | undefined,
    settings: GallerySettings,
  ): Promise<GalleryMedia> {
    if (!file?.buffer?.length) throw AppException.badRequest('Choose a still image', 'FILE_MISSING');
    if (media.media_type !== 'video') throw AppException.badRequest('Only videos take a poster image', 'NOT_A_VIDEO');
    const format = sniffFormat(file.buffer);
    if (!format || format.media_type !== 'image') {
      throw AppException.badRequest('The poster must be a JPEG, PNG or WebP image', 'FILE_TYPE_NOT_ALLOWED');
    }
    if (file.buffer.length > settings.max_image_mb * MB) {
      throw AppException.badRequest(`The image is larger than ${settings.max_image_mb} MB`, 'FILE_TOO_LARGE');
    }
    const thumbnail = await this.thumbnail(file.buffer, settings.thumbnail_side).catch(() => {
      throw AppException.badRequest(
        'This image could not be read. Upload a valid JPEG, PNG or WebP file.',
        'IMAGE_INVALID',
      );
    });
    const key = media.thumbnail_key ?? media.storage_key.replace(/\.[^.]+$/, '_thumb.webp');
    await this.storage.put(key, thumbnail);
    media.thumbnail_key = key;
    media.thumbnail_bytes = thumbnail.length;
    return this.media.save(media);
  }

  present(row: GalleryMedia, album: Pick<GalleryAlbum, 'allow_download'>, userId: number, flags: MediaFlags): MediaDto {
    const view = this.signer.sign(row.id, 'view', userId);
    const downloads = flags.downloads && album.allow_download;
    return {
      id: row.id,
      album_id: row.album_id,
      media_type: row.media_type,
      title: row.title,
      description: row.description,
      original_name: row.original_name,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
      width: row.width,
      height: row.height,
      duration_seconds: row.duration_seconds,
      url: this.url(row.id, view),
      thumbnail_url: row.thumbnail_key ? this.url(row.id, this.signer.sign(row.id, 'thumb', userId)) : null,
      download_url: downloads ? this.url(row.id, this.signer.sign(row.id, 'download', userId)) : null,
      url_expires_at: new Date(view.expires * 1000),
      uploaded_by: row.created_by,
      uploaded_by_name: row.created_by ? (flags.names.get(row.created_by) ?? null) : null,
      created_at: row.created_at,
      status: row.status,
      expires_at: row.expires_at,
      trash_at: row.trash_at,
      on_hold: flags.held.has(row.id) || flags.heldAlbums.has(row.album_id),
      can_delete: flags.canDelete(row),
    };
  }

  thumbUrl(mediaId: number, userId: number): string {
    return this.url(mediaId, this.signer.sign(mediaId, 'thumb', userId));
  }

  verify(mediaId: number, query: SignedMediaQuery): boolean {
    return this.signer.verify(mediaId, query);
  }

  async stream(
    row: GalleryMedia,
    variant: MediaVariant,
    rangeHeader: string | undefined,
  ): Promise<{ file: StreamableFile; status: number; headers: Record<string, string> }> {
    const thumb = variant === 'thumb';
    const key = thumb ? row.thumbnail_key : row.storage_key;
    if (!key) throw AppException.notFound('This item has no preview', 'NO_PREVIEW');
    const size = thumb ? row.thumbnail_bytes : row.size_bytes;
    const range = !thumb && rangeHeader ? parseRange(rangeHeader, size) : null;
    if (range === 'invalid') {
      throw new AppException(416, 'The requested range is not valid', 'RANGE_NOT_SATISFIABLE');
    }
    const stream = await this.storage.read(key, range ?? undefined).catch(() => {
      throw AppException.notFound('The stored file is missing', 'MEDIA_CONTENT_MISSING');
    });
    const kind = variant === 'download' ? 'attachment' : 'inline';
    const headers: Record<string, string> = { 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' };
    if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
    const length = range ? range.end - range.start + 1 : size;
    return {
      status: range ? 206 : 200,
      headers,
      file: new StreamableFile(stream, {
        type: thumb ? 'image/webp' : row.mime_type,
        disposition: `${kind}; filename="${encodeURIComponent(row.original_name)}"`,
        length: length || undefined,
      }),
    };
  }

  async purge(rows: GalleryMedia[]): Promise<PurgeOutcome[]> {
    const outcomes: PurgeOutcome[] = [];
    for (const row of rows) {
      const outcome: PurgeOutcome = {
        media_id: row.id,
        album_id: row.album_id,
        name: row.original_name,
        size_bytes: row.size_bytes + row.thumbnail_bytes,
        error: null,
      };
      try {
        await this.storage.remove(row.storage_key);
        if (row.thumbnail_key) await this.storage.remove(row.thumbnail_key);
        await this.dataSource.transaction(async (manager) => {
          await manager.query(`UPDATE gallery_albums SET cover_media_id = NULL WHERE cover_media_id = $1`, [row.id]);
          await manager.query(`DELETE FROM gallery_media WHERE id = $1`, [row.id]);
        });
      } catch (error) {
        outcome.error = (error as Error).message.slice(0, 500);
        this.logger.warn(`Media ${row.id}: permanent deletion failed: ${outcome.error}`);
      }
      outcomes.push(outcome);
    }
    return outcomes;
  }

  async removeKeys(keys: string[]): Promise<string[]> {
    const left: string[] = [];
    for (const key of keys) {
      try {
        await this.storage.remove(key);
      } catch {
        left.push(key);
      }
    }
    return left;
  }

  private check(file: IncomingFile, settings: GallerySettings): SniffedFormat {
    const format = sniffFormat(file.buffer);
    if (!format) {
      throw new UploadRejected(
        'FILE_TYPE_NOT_ALLOWED',
        'This is not a supported photo or video. Use JPEG, PNG, WebP, MP4, MOV, WebM or 3GP.',
      );
    }
    if (format.media_type === 'video' && !settings.videos_enabled) {
      throw new UploadRejected('VIDEOS_DISABLED', 'Video uploads are switched off for this school');
    }
    const allowed =
      format.media_type === 'image'
        ? (settings.image_formats as string[]).includes(format.format)
        : (settings.video_formats as string[]).includes(format.format);
    if (!allowed) {
      throw new UploadRejected(
        'FILE_TYPE_NOT_ALLOWED',
        `${format.format.toUpperCase()} files are not allowed by the school`,
      );
    }
    const limit = format.media_type === 'image' ? settings.max_image_mb : settings.max_video_mb;
    if (file.buffer.length > limit * MB)
      throw new UploadRejected('FILE_TOO_LARGE', `The file is larger than ${limit} MB`);
    return format;
  }

  private async prepare(file: IncomingFile, format: SniffedFormat, settings: GallerySettings): Promise<PreparedMedia> {
    if (format.media_type === 'video') {
      const duration = format.format === 'webm' ? null : isoVideoSeconds(file.buffer);
      if (duration !== null && duration > settings.max_video_seconds) {
        throw new UploadRejected(
          'VIDEO_TOO_LONG',
          `The video is ${duration} seconds long. The limit is ${settings.max_video_seconds} seconds.`,
        );
      }
      const content = Buffer.from(file.buffer);
      const scrubbed = format.format === 'webm' ? 0 : scrubIsoMetadata(content);
      return {
        content,
        thumbnail: null,
        width: null,
        height: null,
        duration,
        metadata: { format: format.format, duration_checked: duration !== null, metadata_boxes_removed: scrubbed },
      };
    }
    try {
      const source = sharp(file.buffer, { failOn: 'error' });
      const info = await source.metadata();
      const resized = source.clone().rotate().resize({
        width: settings.image_max_side,
        height: settings.image_max_side,
        fit: 'inside',
        withoutEnlargement: true,
      });
      const encoded =
        format.format === 'png'
          ? resized.png({ compressionLevel: 9, quality: settings.image_quality })
          : format.format === 'webp'
            ? resized.webp({ quality: settings.image_quality })
            : resized.jpeg({ quality: settings.image_quality, mozjpeg: true });
      const { data, info: out } = await encoded.toBuffer({ resolveWithObject: true });
      const thumbnail = await this.thumbnail(file.buffer, settings.thumbnail_side);
      return {
        content: data,
        thumbnail,
        width: out.width,
        height: out.height,
        duration: null,
        metadata: {
          format: format.format,
          original_width: info.width ?? null,
          original_height: info.height ?? null,
          original_bytes: file.buffer.length,
          exif_removed: Boolean(info.exif || info.xmp || info.iptc),
        },
      };
    } catch {
      throw new UploadRejected('IMAGE_INVALID', 'This image could not be read. Upload a valid JPEG, PNG or WebP file.');
    }
  }

  private thumbnail(buffer: Buffer, side: number): Promise<Buffer> {
    return sharp(buffer, { failOn: 'error' })
      .rotate()
      .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 72 })
      .toBuffer();
  }

  private async store(
    album: GalleryAlbum,
    file: IncomingFile,
    name: string,
    format: SniffedFormat,
    prepared: PreparedMedia,
    hash: string,
    sessionId: number,
    actor: AuthUser,
    settings: GallerySettings,
    rules: PolicyRule[],
  ): Promise<GalleryMedia> {
    const now = new Date();
    const folder = `gallery/${album.school_id}/${now.toISOString().slice(0, 7).replace('-', '/')}`;
    const id = randomUUID();
    const storageKey = `${folder}/${id}${format.extension}`;
    const thumbnailKey = prepared.thumbnail ? `${folder}/${id}_thumb.webp` : null;
    const written: string[] = [];
    try {
      await this.storage.put(storageKey, prepared.content);
      written.push(storageKey);
      if (thumbnailKey && prepared.thumbnail) {
        await this.storage.put(thumbnailKey, prepared.thumbnail);
        written.push(thumbnailKey);
      }
      const retention = resolveRetention(
        {
          album_id: album.id,
          album_status: album.status,
          category_id: album.category_id,
          academic_year_id: album.academic_year_id,
          scope: album.scope,
          media_type: format.media_type,
        },
        rules,
        settings,
      );
      return await this.media.save(
        this.media.create({
          school_id: album.school_id,
          album_id: album.id,
          media_type: format.media_type,
          original_name: safeFileName(name, format.extension),
          storage_key: storageKey,
          thumbnail_key: thumbnailKey,
          mime_type: format.mime_type,
          size_bytes: prepared.content.length,
          thumbnail_bytes: prepared.thumbnail?.length ?? 0,
          width: prepared.width,
          height: prepared.height,
          duration_seconds: prepared.duration,
          content_hash: hash,
          upload_session_id: sessionId,
          expires_at: expiryFor(now, retention),
          retention_source: retention.source,
          metadata: { ...prepared.metadata, client_type: file.mimetype?.slice(0, 60) ?? null },
          created_by: actor.id,
          created_at: now,
        }),
      );
    } catch (error) {
      const left = await this.removeKeys(written);
      if (left.length) {
        await this.dataSource.query(
          `UPDATE gallery_upload_sessions SET orphan_keys = orphan_keys || $1::text[] WHERE id = $2`,
          [left, sessionId],
        );
      }
      if ((error as { code?: string }).code === '23505') {
        throw new UploadRejected('DUPLICATE_MEDIA', 'Already in this album');
      }
      throw error;
    }
  }

  private url(mediaId: number, query: SignedMediaQuery): string {
    const params = new URLSearchParams({
      variant: query.variant,
      expires: String(query.expires),
      user: String(query.user),
      signature: query.signature,
    });
    return `${this.app.publicUrl}/api/v1/files/gallery/${mediaId}/content?${params.toString()}`;
  }
}
