import { Inject, Injectable, Logger, StreamableFile } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import sharp from 'sharp';
import { In, Repository } from 'typeorm';
import { AppException, AuthUser } from '@app/common';
import { appConfig, AppConfig, storageConfig, StorageConfig } from '../../config/configuration';
import { ROLES } from '../access/access.catalog';
import { FileDto } from './dto/file.dto';
import { FileRecord } from './entities/file-record.entity';
import { FileSigner, SignedQuery } from './file-signer';
import { FILE_STORAGE, FileStorage } from './storage/local.storage';

export interface UploadedFileInput {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const DOCUMENT_TYPES: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'text/csv': '.csv',
};
const MAX_IMAGE_SIDE = 1600;
const THUMB_SIDE = 320;

@Injectable()
export class FilesService {
  private readonly logger = new Logger('Files');
  private readonly signer: FileSigner;

  constructor(
    @InjectRepository(FileRecord) private readonly files: Repository<FileRecord>,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(storageConfig.KEY) settings: StorageConfig,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {
    this.signer = new FileSigner(settings.signingSecret, settings.urlTtlSeconds);
  }

  async upload(input: UploadedFileInput | undefined, purpose: string | undefined, actor: AuthUser): Promise<FileDto> {
    if (!input?.buffer?.length) throw AppException.badRequest('Choose a file to upload', 'FILE_MISSING');
    const isImage = input.mimetype in IMAGE_TYPES;
    const extension = IMAGE_TYPES[input.mimetype] ?? DOCUMENT_TYPES[input.mimetype];
    if (!extension) {
      throw AppException.badRequest(
        'This file type is not allowed. Upload an image, PDF, Word, Excel or CSV file.',
        'FILE_TYPE_NOT_ALLOWED',
      );
    }

    const folder = new Date().toISOString().slice(0, 7).replace('-', '/');
    const id = randomUUID();
    const storageKey = `${folder}/${id}${extension}`;
    let content = input.buffer;
    let width: number | null = null;
    let height: number | null = null;
    let thumbnailKey: string | null = null;

    if (isImage) {
      const image = await this.processImage(input.buffer, input.mimetype, purpose);
      content = image.content;
      width = image.width;
      height = image.height;
      thumbnailKey = `${folder}/${id}_thumb.webp`;
      await this.storage.put(thumbnailKey, image.thumbnail);
    }
    await this.storage.put(storageKey, content);

    const record = await this.files.save(
      this.files.create({
        school_id: actor.school_id,
        storage_key: storageKey,
        thumbnail_key: thumbnailKey,
        original_name: this.safeName(input.originalname, extension),
        mime_type: input.mimetype,
        size_bytes: content.length,
        width,
        height,
        purpose: purpose ?? 'general',
        scan_status: 'not_scanned',
      }),
    );
    return this.present(record);
  }

  async get(id: number, actor: AuthUser): Promise<FileDto> {
    return this.present(await this.findScoped(id, actor));
  }

  async content(id: number, query: SignedQuery): Promise<StreamableFile> {
    if (!this.signer.verify(id, query))
      throw AppException.forbidden('This link has expired or is not valid', 'LINK_EXPIRED');
    const record = await this.files.findOneBy({ id });
    if (!record) throw AppException.notFound('File not found');
    const key = query.variant === 'thumb' ? record.thumbnail_key : record.storage_key;
    if (!key) throw AppException.notFound('This file has no preview');
    const stream = await this.storage.read(key).catch(() => {
      throw AppException.notFound('File content is missing');
    });
    return new StreamableFile(stream, {
      type: query.variant === 'thumb' ? 'image/webp' : record.mime_type,
      disposition: `inline; filename="${encodeURIComponent(record.original_name)}"`,
    });
  }

  async remove(id: number, actor: AuthUser): Promise<{ id: number }> {
    const record = await this.findScoped(id, actor);
    const isAdmin = actor.roles.some((role) => role === ROLES.SUPER_ADMIN || role === ROLES.ADMIN);
    if (record.created_by !== actor.id && !isAdmin)
      throw AppException.forbidden('You can only delete files you uploaded');
    await this.files.softDelete(id);
    return { id };
  }

  async assertAttachable(fileId: number, schoolId: number, field = 'file_id'): Promise<FileRecord> {
    const record = await this.files.findOneBy({ id: fileId });
    if (!record || (record.school_id !== null && record.school_id !== schoolId)) {
      throw AppException.validation([{ field, message: `${field} does not match an uploaded file` }]);
    }
    return record;
  }

  async presentMany(ids: (number | null)[]): Promise<Map<number, FileDto>> {
    const wanted = [...new Set(ids.filter((id): id is number => typeof id === 'number'))];
    if (!wanted.length) return new Map();
    const records = await this.files.findBy({ id: In(wanted) });
    return new Map(records.map((record) => [record.id, this.present(record)]));
  }

  async readImage(id: number | null): Promise<Buffer | null> {
    if (!id) return null;
    const record = await this.files.findOneBy({ id });
    if (!record || !(record.mime_type in IMAGE_TYPES)) return null;
    try {
      const stream = await this.storage.read(record.storage_key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
      return await sharp(Buffer.concat(chunks)).jpeg({ quality: 85 }).toBuffer();
    } catch {
      return null;
    }
  }

  present(record: FileRecord): FileDto {
    const original = this.signer.sign(record.id, 'original');
    return {
      id: record.id,
      name: record.original_name,
      mime_type: record.mime_type,
      size_bytes: record.size_bytes,
      width: record.width,
      height: record.height,
      purpose: record.purpose,
      scan_status: record.scan_status,
      url: this.url(record.id, original),
      thumbnail_url: record.thumbnail_key ? this.url(record.id, this.signer.sign(record.id, 'thumb')) : null,
      url_expires_at: new Date(original.expires * 1000),
      created_at: record.created_at,
    };
  }

  linkFor(id: number | null): string | null {
    return id ? this.url(id, this.signer.sign(id, 'original')) : null;
  }

  private url(id: number, query: SignedQuery): string {
    const params = new URLSearchParams({
      variant: query.variant,
      expires: String(query.expires),
      signature: query.signature,
    });
    return `${this.app.publicUrl}/api/v1/files/${id}/content?${params.toString()}`;
  }

  private async processImage(buffer: Buffer, mimetype: string, purpose?: string) {
    try {
      let pipeline = sharp(buffer, { failOn: 'error' }).rotate();
      if (purpose === 'school_signature' || purpose === 'school_seal') {
        pipeline = pipeline.trim();
      }
      const resized = pipeline
        .clone()
        .resize({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE, fit: 'inside', withoutEnlargement: true });
      const encoded =
        mimetype === 'image/png'
          ? resized.png({ compressionLevel: 9 })
          : mimetype === 'image/webp'
            ? resized.webp({ quality: 82 })
            : resized.jpeg({ quality: 82, mozjpeg: true });
      const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
      const thumbnail = await pipeline
        .clone()
        .resize({ width: THUMB_SIDE, height: THUMB_SIDE, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 75 })
        .toBuffer();
      return { content: data, width: info.width, height: info.height, thumbnail };
    } catch (error) {
      this.logger.warn(`Image rejected: ${(error as Error).message}`);
      throw AppException.badRequest(
        'This image could not be read. Upload a valid JPG, PNG or WebP file.',
        'IMAGE_INVALID',
      );
    }
  }

  private safeName(name: string, extension: string): string {
    const base =
      name
        .replace(/[^\w.\- ]+/g, '')
        .trim()
        .slice(0, 200) || 'file';
    return extname(base).toLowerCase() === extension ? base : `${base.replace(/\.[^.]*$/, '')}${extension}`;
  }

  private async findScoped(id: number, actor: AuthUser): Promise<FileRecord> {
    const record = await this.files.findOneBy({ id });
    const sameSchool = record && (record.school_id === actor.school_id || actor.roles.includes(ROLES.SUPER_ADMIN));
    if (!record || !sameSchool) throw AppException.notFound('File not found');
    return record;
  }
}
