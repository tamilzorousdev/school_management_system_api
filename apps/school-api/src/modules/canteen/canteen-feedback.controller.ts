import { Body, Controller, Get, HttpStatus, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import { CanteenFeedbackService } from './canteen-feedback.service';
import {
  FeedbackDto,
  FeedbackInputDto,
  FeedbackInsightsDto,
  FeedbackQueryDto,
  FeedbackStatusDto,
} from './dto/canteen-people.dto';

const P = PERMISSIONS;

@ApiTags('Admin · Canteen feedback')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/canteen/feedback')
export class CanteenFeedbackController {
  constructor(private readonly feedback: CanteenFeedbackService) {}

  @Post()
  @RequirePermissions(P.CANTEEN_ORDER)
  @ResponseMessage('Feedback logged')
  @ApiOperation({
    summary: 'Log feedback or a complaint',
    description: 'A rating from 1 to 5 is required for feedback. diner_id and order_id must belong to this school.',
  })
  @ApiEnvelope(FeedbackDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  create(@SchoolId() schoolId: number, @Body() dto: FeedbackInputDto) {
    return this.feedback.create(schoolId, dto);
  }

  @Get()
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({
    summary: 'List feedback and complaints',
    description:
      'Filters: kind, category, status, rating, from, to, search (subject, message). Sort: created_at, rating, status, category, resolved_at.',
  })
  @ApiEnvelope(FeedbackDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  list(@SchoolId() schoolId: number, @Query() query: FeedbackQueryDto) {
    return this.feedback.list(schoolId, query);
  }

  @Get('insights')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'Counts by status and kind, average rating, rating distribution and top categories' })
  @ApiEnvelope(FeedbackInsightsDto)
  insights(@SchoolId() schoolId: number) {
    return this.feedback.insights(schoolId);
  }

  @Get(':id')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'One feedback or complaint' })
  @ApiEnvelope(FeedbackDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.feedback.get(schoolId, id);
  }

  @Patch(':id/status')
  @RequirePermissions(P.CANTEEN_MANAGE)
  @ResponseMessage('Feedback status updated')
  @ApiOperation({
    summary: 'Move a feedback or complaint along: open, in_progress, resolved, closed',
    description: 'Resolving needs a resolution text. A resolved item can be reopened or closed.',
  })
  @ApiEnvelope(FeedbackDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  changeStatus(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: FeedbackStatusDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.feedback.changeStatus(schoolId, id, dto, actor);
  }
}
