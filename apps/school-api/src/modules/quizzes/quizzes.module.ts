import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '../notifications/notifications.module';
import { StaffModule } from '../staff/staff.module';
import { OnlineQuiz } from './entities/online-quiz.entity';
import { QuizAnswer } from './entities/quiz-answer.entity';
import { QuizQuestion } from './entities/quiz-question.entity';
import { QuizSubmission } from './entities/quiz-submission.entity';
import { ParentQuizzesController } from './parent-quizzes.controller';
import { QuizzesController } from './quizzes.controller';
import { QuizzesService } from './quizzes.service';
import { TeacherQuizzesController } from './teacher-quizzes.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([OnlineQuiz, QuizQuestion, QuizSubmission, QuizAnswer]),
    NotificationsModule,
    StaffModule,
  ],
  controllers: [QuizzesController, TeacherQuizzesController, ParentQuizzesController],
  providers: [QuizzesService],
  exports: [QuizzesService],
})
export class QuizzesModule {}
