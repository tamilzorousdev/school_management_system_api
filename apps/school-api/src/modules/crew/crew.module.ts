import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StaffDocument } from '../staff/entities/staff-document.entity';
import { Staff } from '../staff/entities/staff.entity';
import { StaffModule } from '../staff/staff.module';
import { TransportRoute } from '../transport/entities/transport-route.entity';
import { Vehicle } from '../transport/entities/vehicle.entity';
import { DutyOverride } from '../transport/entities/duty-override.entity';
import { ClearanceService } from './clearance.service';
import { CrewController } from './crew.controller';
import { CrewService } from './crew.service';

@Module({
  imports: [TypeOrmModule.forFeature([Staff, StaffDocument, Vehicle, TransportRoute, DutyOverride]), StaffModule],
  controllers: [CrewController],
  providers: [CrewService, ClearanceService],
  exports: [CrewService, ClearanceService],
})
export class CrewModule {}
