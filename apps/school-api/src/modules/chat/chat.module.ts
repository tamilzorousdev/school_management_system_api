import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RealtimeModule } from '../realtime/realtime.module';
import { StaffModule } from '../staff/staff.module';
import { ChatAuditController } from './chat.controller';
import { ChatRetentionService } from './chat-retention.service';
import { ChatService } from './chat.service';
import { ChatAuditLog, ChatGroupMember, ChatMessage, ChatMessageHide, ChatThread } from './entities/chat.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatThread, ChatMessage, ChatAuditLog, ChatMessageHide, ChatGroupMember]),
    StaffModule,
    RealtimeModule,
  ],
  controllers: [ChatAuditController],
  providers: [ChatService, ChatRetentionService],
  exports: [ChatService],
})
export class ChatModule {}
