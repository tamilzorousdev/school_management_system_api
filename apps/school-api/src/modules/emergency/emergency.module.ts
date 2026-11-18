import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from '../notifications/entities/notification.entity';
import { RealtimeModule } from '../realtime/realtime.module';
import { EmergencyController, MeEmergencyController } from './emergency.controller';
import { EmergencyDeliveryService } from './emergency-delivery.service';
import { EmergencyService } from './emergency.service';
import { EmergencyBroadcast, EmergencyMessageTemplate, EmergencyRecipient } from './entities/emergency.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([EmergencyBroadcast, EmergencyRecipient, EmergencyMessageTemplate, Notification]),
    RealtimeModule,
  ],
  controllers: [EmergencyController, MeEmergencyController],
  providers: [EmergencyService, EmergencyDeliveryService],
})
export class EmergencyModule {}
