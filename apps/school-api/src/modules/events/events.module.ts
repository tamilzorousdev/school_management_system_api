import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventRsvp, EventTarget, SchoolEvent } from './entities/school-event.entity';
import { EventsController, MobileParentEventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [TypeOrmModule.forFeature([SchoolEvent, EventTarget, EventRsvp])],
  controllers: [EventsController, MobileParentEventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
