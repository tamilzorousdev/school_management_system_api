import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MobileModule } from '../mobile/mobile.module';
import { SpecialClass, SpecialClassStudent } from './entities/special-class.entity';
import {
  MobileParentSpecialClassesController,
  MobileTeacherSpecialClassesController,
  PerformanceController,
  SpecialClassesController,
} from './performance.controller';
import { PerformanceService } from './performance.service';
import { SpecialClassesService } from './special-classes.service';

@Module({
  imports: [TypeOrmModule.forFeature([SpecialClass, SpecialClassStudent]), MobileModule],
  controllers: [
    PerformanceController,
    SpecialClassesController,
    MobileTeacherSpecialClassesController,
    MobileParentSpecialClassesController,
  ],
  providers: [PerformanceService, SpecialClassesService],
})
export class PerformanceModule {}
