import { Global, Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';
import { memoryStorage } from 'multer';
import { storageConfig, StorageConfig } from '../../config/configuration';
import { FileRecord } from './entities/file-record.entity';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { FILE_STORAGE, LocalFileStorage } from './storage/local.storage';
import { MEDIA_MAX_MB } from './files.service';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([FileRecord]),
    MulterModule.registerAsync({
      inject: [storageConfig.KEY],
      useFactory: (storage: StorageConfig) => ({
        storage: memoryStorage(),
        limits: { fileSize: Math.max(storage.maxFileMb, MEDIA_MAX_MB) * 1024 * 1024, files: 1 },
      }),
    }),
  ],
  controllers: [FilesController],
  providers: [FilesService, { provide: FILE_STORAGE, useClass: LocalFileStorage }],
  exports: [FilesService],
})
export class FilesModule {}
