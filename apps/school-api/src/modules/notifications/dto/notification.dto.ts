import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ListQueryDto, PaginationDto, toBoolean } from '@app/common';
import {
  CATEGORIES,
  Channel,
  CHANNELS,
  NOTIFICATION_STATUSES,
  NotificationCategory,
  NotificationStatus,
} from '../entities/notification.entity';
import { SMS_MODES, SmsMode } from '../entities/notification-template.entity';
import { NOTIFICATION_APPS, NotificationApp } from '../notification-apps';

export class MyNotificationsQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'true: only unread' })
  @IsOptional()
  @Transform(toBoolean)
  @IsIn([true, false])
  unread?: boolean;

  @ApiPropertyOptional({ enum: CATEGORIES })
  @IsOptional()
  @IsIn(CATEGORIES)
  category?: NotificationCategory;

  @ApiPropertyOptional({
    enum: NOTIFICATION_APPS,
    description:
      'The app asking. One account can hold several roles; this hides notifications meant for the other apps.',
  })
  @IsOptional()
  @IsIn(NOTIFICATION_APPS)
  app?: NotificationApp;
}

export class UnreadCountQueryDto {
  @ApiPropertyOptional({ enum: NOTIFICATION_APPS })
  @IsOptional()
  @IsIn(NOTIFICATION_APPS)
  app?: NotificationApp;
}

export class OutboxQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: CHANNELS })
  @IsOptional()
  @IsIn(CHANNELS)
  channel?: Channel;

  @ApiPropertyOptional({ enum: NOTIFICATION_STATUSES })
  @IsOptional()
  @IsIn(NOTIFICATION_STATUSES)
  status?: NotificationStatus;

  @ApiPropertyOptional({ enum: CATEGORIES })
  @IsOptional()
  @IsIn(CATEGORIES)
  category?: NotificationCategory;
}

export class SendTestDto {
  @ApiProperty({ example: 5, description: 'User who should receive the test notification' })
  @IsInt()
  @Min(1)
  user_id: number;
}

export class MyNotificationDto {
  @ApiProperty({ example: 120 })
  id: number;

  @ApiProperty({ enum: CATEGORIES, example: 'transport' })
  category: NotificationCategory;

  @ApiProperty({ example: 'BUS_APPROACHING', nullable: true, type: String })
  template_code: string | null;

  @ApiProperty({ example: 'Bus is 5 min away' })
  title: string;

  @ApiProperty({ example: 'TN 01 AB 1234 will reach Anna Nagar 2nd Ave in about 5 minutes.' })
  body: string;

  @ApiProperty({
    example: { bus: 'TN 01 AB 1234', stop: 'Anna Nagar 2nd Ave', minutes: '5' },
    description: 'Values used in the message. Use them to open the right screen.',
  })
  data: Record<string, string>;

  @ApiProperty({ example: false })
  is_read: boolean;

  @ApiProperty({ example: null, nullable: true, type: String })
  read_at: Date | null;

  @ApiProperty({ example: '2026-11-02T07:40:00.000+05:30' })
  created_at: Date;
}

export class UnreadCountDto {
  @ApiProperty({ example: 3 })
  unread: number;
}

export class OutboxItemDto {
  @ApiProperty({ example: 340 })
  id: number;

  @ApiProperty({ enum: CHANNELS, example: 'sms' })
  channel: Channel;

  @ApiProperty({ enum: CATEGORIES, example: 'attendance' })
  category: NotificationCategory;

  @ApiProperty({ example: 'STUDENT_ABSENT', nullable: true, type: String })
  template_code: string | null;

  @ApiProperty({ example: 'Kavin is absent today' })
  title: string;

  @ApiProperty({ example: 'Dear parent, Kavin (6-A) was marked absent on 02 Nov 2026. -TAMILZOROUS' })
  body: string;

  @ApiProperty({ enum: NOTIFICATION_STATUSES, example: 'skipped' })
  status: NotificationStatus;

  @ApiProperty({ example: '9876543210', nullable: true, type: String })
  recipient: string | null;

  @ApiProperty({ example: 'ping4sms', nullable: true, type: String })
  provider: string | null;

  @ApiProperty({ example: 'No DLT template id for this message yet', nullable: true, type: String })
  error: string | null;

  @ApiProperty({ example: 1 })
  attempts: number;

  @ApiProperty({ example: null, nullable: true, type: String })
  sent_at: Date | null;

  @ApiProperty({ example: '2026-11-02T09:05:00.000+05:30' })
  created_at: Date;

  @ApiProperty({ example: { id: 7, name: 'Lakshmi R', mobile: '9876543210' } })
  user: { id: number; name: string; mobile: string } | null;
}

export class OutboxInsightsDto {
  @ApiProperty({ example: 52, description: 'All messages in the last 24 hours' })
  last_24h: number;

  @ApiProperty({ example: { sent: 30, skipped: 4, failed: 1, queued: 0 } })
  push: Record<string, number>;

  @ApiProperty({ example: { sent: 12, skipped: 6, failed: 0, queued: 0 } })
  sms: Record<string, number>;

  @ApiProperty({ example: 9, description: 'In-app notifications not yet read' })
  unread_in_app: number;
}

export class TemplateDto {
  @ApiProperty({ example: 'STUDENT_ABSENT' })
  code: string;

  @ApiProperty({ example: 'en' })
  language: string;

  @ApiProperty({ enum: CATEGORIES })
  category: NotificationCategory;

  @ApiProperty({ example: '{{student}} is absent today' })
  title: string;

  @ApiProperty()
  body: string;

  @ApiProperty({ nullable: true, type: String })
  sms_body: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Set after DLT approval. SMS for this template is skipped until then.',
  })
  dlt_template_id: string | null;

  @ApiProperty()
  push: boolean;

  @ApiProperty({ enum: SMS_MODES })
  sms: SmsMode;

  @ApiProperty()
  critical: boolean;
}

export class TestPushDto {
  @ApiPropertyOptional({ example: 'Test notification', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;

  @ApiPropertyOptional({ example: 'Push notifications are working on this phone.', maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  body?: string;

  @ApiPropertyOptional({
    example: { category: 'chat', thread_id: '8' },
    description: 'Extra data to test tap routing (values are sent as strings)',
  })
  @IsOptional()
  @IsObject()
  data?: Record<string, string>;
}

export class TestPushResultDto {
  @ApiProperty({ example: 2051 })
  notification_id: number;

  @ApiProperty({ enum: ['sent', 'failed', 'skipped'], example: 'sent' })
  status: 'sent' | 'failed' | 'skipped';

  @ApiProperty({ example: 'kafka', description: 'off, kafka, onesignal or fcm' })
  provider: string;

  @ApiProperty({ example: '5', description: 'The OneSignal External ID we sent to: OneSignal.login must use this' })
  external_id: string;

  @ApiProperty({ example: 1, description: 'Devices registered with POST /me/devices' })
  devices: number;

  @ApiProperty({ nullable: true, type: String, example: null })
  error: string | null;
}

export class DispatchResultDto {
  @ApiProperty({ example: '7c1d0f8e-2f5b-4f3a-9b8a-0c1e2d3f4a5b' })
  batch_id: string;

  @ApiProperty({ example: 1 })
  recipients: number;
}
