import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExamsModule } from '../exams/exams.module';
import { GateModule } from '../gate/gate.module';
import { OfficeActivityLog, SchoolWing, UserWing } from './entities/office.entity';
import { OfficeMonitorService } from './office-monitor.service';
import { OfficeTeachersService } from './office-teachers.service';
import { OfficeBusService } from './office-bus.service';
import { AdminOfficeController, MobileOfficeController } from './office.controller';
import { OfficeService } from './office.service';

@Module({
  imports: [TypeOrmModule.forFeature([SchoolWing, UserWing, OfficeActivityLog]), ExamsModule, GateModule],
  controllers: [AdminOfficeController, MobileOfficeController],
  providers: [OfficeService, OfficeMonitorService, OfficeTeachersService, OfficeBusService],
})
export class OfficeModule {}
