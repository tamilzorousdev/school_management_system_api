import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Alumni } from './entities/alumni.entity';
import {
  AlumniAcademicHistory,
  AlumniSubmission,
  AlumniTimeline,
  AlumniUpdateLink,
} from './entities/alumni-records.entity';
import { AlumniController } from './alumni.controller';
import { AlumniPublicController } from './alumni-public.controller';
import { AlumniService } from './alumni.service';
import { AlumniRecordsService } from './alumni-records.service';
import { AlumniSubmissionsService } from './alumni-submissions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Alumni, AlumniAcademicHistory, AlumniSubmission, AlumniTimeline, AlumniUpdateLink]),
  ],
  controllers: [AlumniController, AlumniPublicController],
  providers: [AlumniService, AlumniRecordsService, AlumniSubmissionsService],
  exports: [AlumniRecordsService],
})
export class AlumniModule {}
