import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AchievementsController, SchoolAchievementsController } from './achievements.controller';
import { AchievementsService } from './achievements.service';
import { StudentAchievement } from './entities/student-achievement.entity';
import { SportsOnDuty } from './entities/sports-on-duty.entity';
import { SportsOnDutyController } from './sports-on-duty.controller';
import { SportsOnDutyService } from './sports-on-duty.service';

@Module({
  imports: [TypeOrmModule.forFeature([StudentAchievement, SportsOnDuty])],
  controllers: [AchievementsController, SchoolAchievementsController, SportsOnDutyController],
  providers: [AchievementsService, SportsOnDutyService],
  exports: [AchievementsService, SportsOnDutyService],
})
export class AchievementsModule {}
