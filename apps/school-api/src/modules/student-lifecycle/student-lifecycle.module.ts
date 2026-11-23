import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AcademicYear } from '../setup/entities/academic-year.entity';
import { Student } from '../students/entities/student.entity';
import { TransferCertificate } from './entities/transfer-certificate.entity';
import { StudentLifecycleController } from './student-lifecycle.controller';
import { StudentLifecycleService } from './student-lifecycle.service';
import { AlumniModule } from '../alumni/alumni.module';

@Module({
  imports: [TypeOrmModule.forFeature([Student, TransferCertificate, AcademicYear]), AlumniModule],
  controllers: [StudentLifecycleController],
  providers: [StudentLifecycleService],
  exports: [StudentLifecycleService],
})
export class StudentLifecycleModule {}
