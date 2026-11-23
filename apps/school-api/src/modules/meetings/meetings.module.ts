import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RealtimeModule } from '../realtime/realtime.module';
import { StaffModule } from '../staff/staff.module';
import { AgoraTokenService } from './agora-token.service';
import { MeetingCallLog } from './entities/meeting-call-log.entity';
import { MeetingMessage } from './entities/meeting-message.entity';
import { MeetingNote } from './entities/meeting-note.entity';
import { Meeting } from './entities/meeting.entity';
import { AgoraWebhookController, MeetingsController } from './meetings.controller';
import { MeetingRecordsService } from './meeting-records.service';
import { MeetingsService } from './meetings.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Meeting, MeetingCallLog, MeetingNote, MeetingMessage]),
    StaffModule,
    RealtimeModule,
  ],
  controllers: [MeetingsController, AgoraWebhookController],
  providers: [MeetingsService, MeetingRecordsService, AgoraTokenService],
  exports: [MeetingsService, MeetingRecordsService, AgoraTokenService],
})
export class MeetingsModule {}
