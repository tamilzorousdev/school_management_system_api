import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { Student } from '../students/entities/student.entity';
import { StudentEnrollment } from '../students/entities/student-enrollment.entity';
import { Grievance } from './entities/grievance.entity';
import { GrievanceTimeline } from './entities/grievance-timeline.entity';
import { GrievanceAttachment } from './entities/grievance-attachment.entity';
import { GrievancesController } from './grievances.controller';
import { GrievancesService } from './grievances.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Grievance, GrievanceTimeline, GrievanceAttachment, User, Student, StudentEnrollment]),
  ],
  controllers: [GrievancesController],
  providers: [GrievancesService],
  exports: [GrievancesService],
})
export class GrievancesModule {}
