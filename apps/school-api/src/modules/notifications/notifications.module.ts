import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RealtimeModule } from '../realtime/realtime.module';
import { User } from '../users/entities/user.entity';
import { AdminNotificationsController } from './admin-notifications.controller';
import { NotificationTemplate } from './entities/notification-template.entity';
import { Notification } from './entities/notification.entity';
import { MeNotificationsController } from './me-notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';
import { JOB_QUEUE, MemoryJobQueue } from './queue/job-queue';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Notification, NotificationTemplate, User]), RealtimeModule],
  controllers: [MeNotificationsController, AdminNotificationsController],
  providers: [NotificationsService, PushService, { provide: JOB_QUEUE, useClass: MemoryJobQueue }],
  exports: [NotificationsService, JOB_QUEUE],
})
export class NotificationsModule {}
