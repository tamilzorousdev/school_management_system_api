import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StaffModule } from '../staff/staff.module';
import { ExamMark } from './entities/exam-mark.entity';
import { ExamSubject } from './entities/exam-subject.entity';
import { Exam } from './entities/exam.entity';
import { ReportCardSignature } from './entities/report-card-signature.entity';
import { ExamsController, StudentResultsController } from './exams.controller';
import { ExamsService } from './exams.service';
import { MobileParentExamsController, MobileTeacherExamsController } from './mobile-exams.controller';
import {
  MobileParentReportCardController,
  SectionReportCardsController,
  StudentReportCardController,
} from './report-cards.controller';
import { ReportCardsService } from './report-cards.service';

@Module({
  imports: [TypeOrmModule.forFeature([Exam, ExamSubject, ExamMark, ReportCardSignature]), StaffModule],
  controllers: [
    ExamsController,
    StudentResultsController,
    StudentReportCardController,
    SectionReportCardsController,
    MobileTeacherExamsController,
    MobileParentExamsController,
    MobileParentReportCardController,
  ],
  providers: [ExamsService, ReportCardsService],
  exports: [ExamsService],
})
export class ExamsModule {}
