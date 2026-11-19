import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelope,
  ApiErrors,
  AuthUser,
  CurrentUser,
  RequirePermissions,
  RequireRoles,
  ResponseMessage,
} from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS, ROLES } from '../access/access.catalog';
import { PARENT_MODULE_TAGS } from '../mobile/parent-modules.catalog';
import {
  CancelEventDto,
  EventDto,
  EventInputDto,
  EventInsightsDto,
  EventQueryDto,
  EventResponseDto,
  EventResponsesQueryDto,
  MyEventDto,
  MyEventsQueryDto,
  RsvpInputDto,
} from './dto/event.dto';
import { EventsService } from './events.service';

@ApiTags('Admin · Events')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.EVENTS_VIEW)
  @ApiOperation({
    summary: 'School events of the current academic year with reply counts',
    description:
      'Month view: from and to. Filters: status, class_id (whole-school events included), upcoming, search (title, venue, description). Sort: event_date (default, ascending), title, created_at.',
  })
  @ApiEnvelope(EventDto, { paginated: true })
  list(@SchoolId() schoolId: number, @Query() query: EventQueryDto) {
    return this.events.list(schoolId, query);
  }

  @Get('insights')
  @RequirePermissions(PERMISSIONS.EVENTS_VIEW)
  @ApiOperation({ summary: 'This month, upcoming, still taking replies, drafts and cancelled' })
  @ApiEnvelope(EventInsightsDto)
  insights(@SchoolId() schoolId: number) {
    return this.events.insights(schoolId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.EVENTS_MANAGE)
  @ResponseMessage('Event saved')
  @ApiOperation({
    summary: 'Create an event; publish: true tells the parents straight away',
    description: 'Times are 24-hour HH:MM; leave both empty for all day. rsvp_deadline must be before the start.',
  })
  @ApiEnvelope(EventDto, { status: HttpStatus.CREATED, message: 'Event saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  create(@SchoolId() schoolId: number, @Body() dto: EventInputDto, @CurrentUser() actor: AuthUser) {
    return this.events.create(schoolId, dto, actor);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.EVENTS_VIEW)
  @ApiOperation({ summary: 'One event with reply counts' })
  @ApiEnvelope(EventDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.events.get(schoolId, id);
  }

  @Get(':id/responses')
  @RequirePermissions(PERMISSIONS.EVENTS_VIEW)
  @ApiOperation({
    summary: 'Every invited student with the reply (attending, not_attending, maybe or no_response)',
    description: 'Filters: response, class_id, search (name or admission number).',
  })
  @ApiEnvelope(EventResponseDto, { paginated: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  responses(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: EventResponsesQueryDto,
  ) {
    return this.events.responses(schoolId, id, query);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.EVENTS_MANAGE)
  @ResponseMessage('Event updated')
  @ApiOperation({
    summary: 'Edit an event (send the whole event)',
    description:
      'A published event whose date, time or venue changes sends EVENT_UPDATED to the parents, and the reminders run again. Cancelled: 409 EVENT_CANCELLED.',
  })
  @ApiEnvelope(EventDto, { message: 'Event updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  update(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: EventInputDto) {
    return this.events.update(schoolId, id, dto);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.EVENTS_MANAGE)
  @ResponseMessage('Event published')
  @ApiOperation({ summary: 'Publish a draft and tell the parents' })
  @ApiEnvelope(EventDto, { message: 'Event published' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  publish(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.events.publish(schoolId, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.EVENTS_MANAGE)
  @ResponseMessage('Event cancelled')
  @ApiOperation({ summary: 'Cancel an event; parents of a published one are told' })
  @ApiEnvelope(EventDto, { message: 'Event cancelled' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  cancel(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: CancelEventDto) {
    return this.events.cancel(schoolId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.EVENTS_MANAGE)
  @ResponseMessage('Event deleted')
  @ApiOperation({ summary: 'Delete an event (no message is sent; cancel it first to tell the parents)' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  async remove(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.events.remove(schoolId, id);
    return null;
  }
}

@ApiTags(PARENT_MODULE_TAGS.MODULE_8)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@RequireRoles(ROLES.PARENT)
@Controller('mobile/parent/events')
export class MobileParentEventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  @ApiOperation({
    summary: 'School events my children are invited to, newest date first',
    description:
      'Month view: from and to. search matches title, venue and description. student_id: one child. Cancelled events stay in the list with cancel_reason.',
  })
  @ApiEnvelope(MyEventDto, { paginated: true })
  list(@CurrentUser() user: AuthUser, @Query() query: MyEventsQueryDto) {
    return this.events.mine(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One event with my children’s replies' })
  @ApiEnvelope(MyEventDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  one(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.events.mineOne(user, id);
  }

  @Put(':id/rsvp')
  @ResponseMessage('Reply saved')
  @ApiOperation({
    summary: 'Reply for one child: attending, not_attending or maybe. Change it any time before the deadline.',
    description:
      '409 EVENT_RSVP_CLOSED after the deadline, EVENT_CANCELLED, EVENT_NO_RSVP, EVENT_NOT_INVITED. 404 CHILD_NOT_FOUND.',
  })
  @ApiEnvelope(MyEventDto, { message: 'Reply saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  rsvp(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: RsvpInputDto) {
    return this.events.rsvp(user, id, dto);
  }
}
