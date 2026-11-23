import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FilesModule } from '../files/files.module';
import { AppraisalCyclesService } from './appraisal-cycles.service';
import { AppraisalGroupsService } from './appraisal-groups.service';
import { AppraisalMetricsService } from './appraisal-metrics.service';
import {
  AppraisalCyclesController,
  AppraisalGroupsController,
  AppraisalsAdminController,
  MeAppraisalReviewsController,
  MeAppraisalsController,
} from './appraisals.controller';
import { AppraisalsService } from './appraisals.service';
import {
  Appraisal,
  AppraisalAppeal,
  AppraisalCycle,
  AppraisalEvidence,
  AppraisalGroup,
  AppraisalGroupMember,
  AppraisalKra,
  AppraisalScore,
} from './entities/appraisal.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AppraisalGroup,
      AppraisalGroupMember,
      AppraisalKra,
      AppraisalCycle,
      Appraisal,
      AppraisalScore,
      AppraisalEvidence,
      AppraisalAppeal,
    ]),
    FilesModule,
  ],
  controllers: [
    AppraisalGroupsController,
    AppraisalCyclesController,
    AppraisalsAdminController,
    MeAppraisalsController,
    MeAppraisalReviewsController,
  ],
  providers: [AppraisalGroupsService, AppraisalCyclesService, AppraisalsService, AppraisalMetricsService],
})
export class AppraisalsModule {}
