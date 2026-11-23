import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StaffModule } from '../staff/staff.module';
import { ExamMark } from './entities/exam-mark.entity';
import { ExamSubject } from './entities/exam-subject.entity';
import { Exam } from './entities/exam.entity';
import { ReportCardSignature } from './entities/report-card-signature.entity';
import { ExamHall } from './entities/exam-hall.entity';
import { ExamHallAllocation } from './entities/exam-hall-allocation.entity';
import { ExamInvigilator } from './entities/exam-invigilator.entity';
import { GradingScale } from './entities/grading-scale.entity';
import { ExamHallsService } from './exam-halls.service';
import { ExamsController, StudentResultsController } from './exams.controller';
import { ExamSeatingController } from './exam-halls.controller';
import { ExamsService } from './exams.service';
import { MobileParentExamsController, MobileTeacherExamsController } from './mobile-exams.controller';
import {
  MobileParentReportCardController,
  SectionReportCardsController,
  StudentReportCardController,
} from './report-cards.controller';
import { ReportCardsService } from './report-cards.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Exam,
      ExamSubject,
      ExamMark,
      ReportCardSignature,
      ExamHall,
      ExamHallAllocation,
      ExamInvigilator,
      GradingScale,
    ]),
    StaffModule,
  ],
  controllers: [
    ExamsController,
    ExamSeatingController,
    StudentResultsController,
    StudentReportCardController,
    SectionReportCardsController,
    MobileTeacherExamsController,
    MobileParentExamsController,
    MobileParentReportCardController,
  ],
  providers: [ExamsService, ReportCardsService, ExamHallsService],
  exports: [ExamsService, ExamHallsService],
})
export class ExamsModule {}
