import { SignaturesModule } from '../signatures/signatures.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessModule } from '../access/access.module';
import { AcademicYear } from '../setup/entities/academic-year.entity';
import { User } from '../users/entities/user.entity';
import { AssignmentsService } from './assignments.service';
import { StaffAppraisal } from './entities/staff-appraisal.entity';
import { KraConfig } from './entities/kra-config.entity';
import { StaffBankAccount } from './entities/staff-bank-account.entity';
import { StaffDocument } from './entities/staff-document.entity';
import { StaffQualification } from './entities/staff-qualification.entity';
import { Staff } from './entities/staff.entity';
import { TeacherAssignmentChange } from './entities/teacher-assignment-change.entity';
import { TeacherAssignment } from './entities/teacher-assignment.entity';
import { AppraisalsService } from './appraisals.service';
import { KraConfigService } from './kra-config.service';
import { StaffAppraisalController } from './staff-appraisal.controller';
import { KraConfigController } from './kra-config.controller';
import { StaffController, TeacherAssignmentsController } from './staff.controller';
import { StaffService } from './staff.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TeacherAssignmentChange,
      Staff,
      StaffQualification,
      StaffDocument,
      StaffAppraisal,
      KraConfig,
      StaffBankAccount,
      TeacherAssignment,
      AcademicYear,
      User,
    ]),
    AccessModule,
    SignaturesModule,
  ],
  controllers: [StaffController, TeacherAssignmentsController, StaffAppraisalController, KraConfigController],
  providers: [StaffService, AssignmentsService, AppraisalsService, KraConfigService],
  exports: [StaffService, AssignmentsService, AppraisalsService, KraConfigService],
})
export class StaffModule {}
