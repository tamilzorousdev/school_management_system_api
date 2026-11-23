import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';
import { memoryStorage } from 'multer';
import { storageConfig, StorageConfig } from '../../config/configuration';
import {
  GalleryAlbum,
  GalleryAuditLog,
  GalleryCategory,
  GalleryCleanupJob,
  GalleryCleanupJobItem,
  GalleryMedia,
  GalleryRetentionHold,
  GalleryRetentionPolicy,
  GallerySettings,
  GalleryUploadSession,
} from './entities/gallery.entity';
import { GalleryAccessService } from './gallery-access.service';
import { GalleryAlertsService } from './gallery-alerts.service';
import { GalleryAuditService } from './gallery-audit.service';
import { GalleryCleanupService } from './gallery-cleanup.service';
import { GalleryConfigController } from './gallery-config.controller';
import { GalleryContentController } from './gallery-content.controller';
import { GalleryContentService } from './gallery-content.service';
import { GalleryMediaService } from './gallery-media.service';
import { GalleryReportsService } from './gallery-reports.service';
import { GalleryRetentionService } from './gallery-retention.service';
import { GallerySettingsService } from './gallery-settings.service';
import { GalleryController, MAX_FILES_PER_REQUEST } from './gallery.controller';
import { GalleryService } from './gallery.service';
import { ParentGalleryController, TeacherGalleryController } from './mobile-gallery.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      GallerySettings,
      GalleryCategory,
      GalleryAlbum,
      GalleryMedia,
      GalleryRetentionPolicy,
      GalleryRetentionHold,
      GalleryCleanupJob,
      GalleryCleanupJobItem,
      GalleryUploadSession,
      GalleryAuditLog,
    ]),
    MulterModule.registerAsync({
      inject: [storageConfig.KEY],
      useFactory: (storage: StorageConfig) => ({
        storage: memoryStorage(),
        limits: { fileSize: storage.galleryMaxUploadMb * 1024 * 1024, files: MAX_FILES_PER_REQUEST },
      }),
    }),
  ],
  controllers: [
    GalleryController,
    GalleryConfigController,
    TeacherGalleryController,
    ParentGalleryController,
    GalleryContentController,
  ],
  providers: [
    GalleryAuditService,
    GallerySettingsService,
    GalleryRetentionService,
    GalleryAccessService,
    GalleryMediaService,
    GalleryAlertsService,
    GalleryService,
    GalleryCleanupService,
    GalleryReportsService,
    GalleryContentService,
  ],
})
export class GalleryModule {}
