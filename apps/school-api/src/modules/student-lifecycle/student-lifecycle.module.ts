import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AcademicYear } from '../setup/entities/academic-year.entity';
import { Student } from '../students/entities/student.entity';
import { StudentNoc, StudentNocItem } from './entities/student-noc.entity';
import { TransferCertificate } from './entities/transfer-certificate.entity';
import { NocService } from './noc.service';
import { TransportModule } from '../transport/transport.module';
import { StudentLifecycleController } from './student-lifecycle.controller';
import { StudentLifecycleService } from './student-lifecycle.service';
import { AlumniModule } from '../alumni/alumni.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Student, TransferCertificate, AcademicYear, StudentNoc, StudentNocItem]),
    AlumniModule,
    TransportModule,
  ],
  controllers: [StudentLifecycleController],
  providers: [StudentLifecycleService, NocService],
  exports: [StudentLifecycleService],
})
export class StudentLifecycleModule {}
