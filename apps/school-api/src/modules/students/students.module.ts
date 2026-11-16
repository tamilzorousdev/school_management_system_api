import { SignaturesModule } from '../signatures/signatures.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AcademicYear } from '../setup/entities/academic-year.entity';
import { AdmissionsService } from './admissions.service';
import { Admission } from './entities/admission.entity';
import { EmergencyContact } from './entities/emergency-contact.entity';
import { Guardian } from './entities/guardian.entity';
import { StudentEnrollment } from './entities/student-enrollment.entity';
import { StudentGuardian } from './entities/student-guardian.entity';
import { Student } from './entities/student.entity';
import { GuardiansService } from './guardians.service';
import {
  AdmissionsController,
  GuardiansController,
  MobileParentController,
  SectionRollController,
  StudentsController,
} from './students.controller';
import { StudentsService } from './students.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Student,
      StudentEnrollment,
      StudentGuardian,
      Guardian,
      EmergencyContact,
      Admission,
      AcademicYear,
    ]),
    SignaturesModule,
  ],
  controllers: [
    StudentsController,
    SectionRollController,
    GuardiansController,
    AdmissionsController,
    MobileParentController,
  ],
  providers: [StudentsService, GuardiansService, AdmissionsService],
  exports: [StudentsService, GuardiansService, AdmissionsService],
})
export class StudentsModule {}
