import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AcademicYearsService } from './academic-years.service';
import { ClassesService } from './classes.service';
import { AcademicYear } from './entities/academic-year.entity';
import { ClassSubject } from './entities/class-subject.entity';
import { Holiday } from './entities/holiday.entity';
import { SchoolClass } from './entities/school-class.entity';
import { Section } from './entities/section.entity';
import { Subject } from './entities/subject.entity';
import { Term } from './entities/term.entity';
import { HolidaysService } from './holidays.service';
import { SetupController } from './setup.controller';
import { SetupService } from './setup.service';
import { SubjectsService } from './subjects.service';
import { AlumniModule } from '../alumni/alumni.module';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([AcademicYear, Term, Holiday, SchoolClass, Section, Subject, ClassSubject]),
    AlumniModule,
  ],
  controllers: [SetupController],
  providers: [SetupService, AcademicYearsService, ClassesService, SubjectsService, HolidaysService],
  exports: [AcademicYearsService, ClassesService, HolidaysService],
})
export class SetupModule {}
