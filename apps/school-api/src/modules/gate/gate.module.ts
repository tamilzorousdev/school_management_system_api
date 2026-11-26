import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthorisedPickup, GateBlock, GateEvent, GatePass, GateSettings, GateVisit } from './entities/gate.entity';
import { GateBoardService } from './gate-board.service';
import { GateCoreService } from './gate-core.service';
import { GatePassesService } from './gate-passes.service';
import { GateVisitsService } from './gate-visits.service';
import {
  AdminGateController,
  MeVisitorsController,
  MobileGateController,
  ParentGateController,
} from './gate.controller';

@Module({
  imports: [TypeOrmModule.forFeature([GateSettings, GatePass, AuthorisedPickup, GateVisit, GateBlock, GateEvent])],
  controllers: [AdminGateController, MobileGateController, ParentGateController, MeVisitorsController],
  providers: [GateCoreService, GatePassesService, GateVisitsService, GateBoardService],
  exports: [GatePassesService],
})
export class GateModule {}
