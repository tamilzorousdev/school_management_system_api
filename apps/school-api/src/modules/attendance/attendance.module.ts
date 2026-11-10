import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttendanceAlertsService } from './attendance-alerts.service';
import { AttendanceController, StudentLeavesController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceRecord } from './entities/attendance-record.entity';
import { AttendanceSession } from './entities/attendance-session.entity';
import { StudentLeave } from './entities/student-leave.entity';
import { StudentLeaveService } from './student-leave.service';

@Module({
  imports: [TypeOrmModule.forFeature([AttendanceSession, AttendanceRecord, StudentLeave])],
  controllers: [AttendanceController, StudentLeavesController],
  providers: [AttendanceService, StudentLeaveService, AttendanceAlertsService],
  exports: [AttendanceService, StudentLeaveService],
})
export class AttendanceModule {}
