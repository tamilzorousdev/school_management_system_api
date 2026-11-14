import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StaffModule } from '../staff/staff.module';
import { StudentFeedback, TeacherRating } from './entities/feedback.entity';
import {
  FeedbackController,
  MobileParentFeedbackController,
  MobileTeacherFeedbackController,
} from './feedback.controller';
import { FeedbackService } from './feedback.service';

@Module({
  imports: [TypeOrmModule.forFeature([TeacherRating, StudentFeedback]), StaffModule],
  controllers: [FeedbackController, MobileParentFeedbackController, MobileTeacherFeedbackController],
  providers: [FeedbackService],
})
export class FeedbackModule {}
