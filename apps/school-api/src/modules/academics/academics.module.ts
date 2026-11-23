import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { MeetingsModule } from '../meetings/meetings.module';
import { AcademicsController } from './academics.controller';
import { AcademicsService } from './academics.service';

@Module({
  imports: [DatabaseModule, MeetingsModule],
  controllers: [AcademicsController],
  providers: [AcademicsService],
  exports: [AcademicsService],
})
export class AcademicsModule {}
