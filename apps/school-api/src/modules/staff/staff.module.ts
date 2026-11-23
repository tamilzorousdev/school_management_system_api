import { SignaturesModule } from '../signatures/signatures.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessModule } from '../access/access.module';
import { AcademicYear } from '../setup/entities/academic-year.entity';
import { User } from '../users/entities/user.entity';
import { AssignmentsService } from './assignments.service';
import { StaffBankAccount } from './entities/staff-bank-account.entity';
import { StaffDocument } from './entities/staff-document.entity';
import { StaffQualification } from './entities/staff-qualification.entity';
import { Staff } from './entities/staff.entity';
import { TeacherAssignmentChange } from './entities/teacher-assignment-change.entity';
import { TeacherAssignment } from './entities/teacher-assignment.entity';
import { StaffController, TeacherAssignmentsController } from './staff.controller';
import { StaffService } from './staff.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TeacherAssignmentChange,
      Staff,
      StaffQualification,
      StaffDocument,
      StaffBankAccount,
      TeacherAssignment,
      AcademicYear,
      User,
    ]),
    AccessModule,
    SignaturesModule,
  ],
  controllers: [StaffController, TeacherAssignmentsController],
  providers: [StaffService, AssignmentsService],
  exports: [StaffService, AssignmentsService],
})
export class StaffModule {}
