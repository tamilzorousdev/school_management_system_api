import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import { CanteenKitchenService } from './canteen-kitchen.service';
import {
  CanteenKitchenBatchCompleteDto,
  CanteenKitchenBatchDto,
  CanteenKitchenBatchInputDto,
  CanteenKitchenBatchQueryDto,
  CanteenKitchenBatchUpdateDto,
  CanteenKitchenInsightsDto,
  CanteenKitchenPlanQueryDto,
  CanteenKitchenPlanRowDto,
  CanteenKitchenQueueDto,
  CanteenKitchenQueueQueryDto,
} from './dto/canteen-supply.dto';

const P = PERMISSIONS;

@ApiTags('Admin · Canteen kitchen')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/canteen/kitchen')
export class CanteenKitchenController {
  constructor(private readonly kitchen: CanteenKitchenService) {}

  @Get('queue')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({
    summary: 'Preparation queue: what to cook now from placed and preparing orders',
    description:
      'Items are grouped by food item with total quantity and order tokens. Meals expand into their food items.',
  })
  @ApiEnvelope(CanteenKitchenQueueDto)
  @ApiErrors(HttpStatus.BAD_REQUEST)
  queue(@SchoolId() schoolId: number, @Query() query: CanteenKitchenQueueQueryDto) {
    return this.kitchen.queue(schoolId, query.date);
  }

  @Get('plan')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'Suggested quantities to cook from the daily menu limits and sales' })
  @ApiEnvelope(CanteenKitchenPlanRowDto, { isArray: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  plan(@SchoolId() schoolId: number, @Query() query: CanteenKitchenPlanQueryDto) {
    return this.kitchen.plan(schoolId, query);
  }

  @Get('insights')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'Kitchen cards for a day: batches by status, planned and prepared portions' })
  @ApiEnvelope(CanteenKitchenInsightsDto)
  @ApiErrors(HttpStatus.BAD_REQUEST)
  insights(@SchoolId() schoolId: number, @Query() query: CanteenKitchenQueueQueryDto) {
    return this.kitchen.insights(schoolId, query.date);
  }

  @Get('batches')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({
    summary: 'Preparation batches',
    description: 'search: food item name, note. sort: batch_date, created_at, planned_quantity.',
  })
  @ApiEnvelope(CanteenKitchenBatchDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  batches(@SchoolId() schoolId: number, @Query() query: CanteenKitchenBatchQueryDto) {
    return this.kitchen.list(schoolId, query);
  }

  @Post('batches')
  @RequirePermissions(P.CANTEEN_ORDER)
  @ResponseMessage('Batch planned')
  @ApiOperation({ summary: 'Plan a batch of a food item for a slot' })
  @ApiEnvelope(CanteenKitchenBatchDto, { status: HttpStatus.CREATED, message: 'Batch planned' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  createBatch(@SchoolId() schoolId: number, @Body() dto: CanteenKitchenBatchInputDto) {
    return this.kitchen.create(schoolId, dto);
  }

  @Get('batches/:id')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'One batch' })
  @ApiEnvelope(CanteenKitchenBatchDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  batch(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.kitchen.get(schoolId, id);
  }

  @Patch('batches/:id')
  @RequirePermissions(P.CANTEEN_ORDER)
  @ResponseMessage('Batch saved')
  @ApiOperation({ summary: 'Change the planned quantity, cook or note of a planned or cooking batch' })
  @ApiEnvelope(CanteenKitchenBatchDto, { message: 'Batch saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  updateBatch(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CanteenKitchenBatchUpdateDto,
  ) {
    return this.kitchen.update(schoolId, id, dto);
  }

  @Post('batches/:id/start')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.CANTEEN_ORDER)
  @ResponseMessage('Batch started')
  @ApiOperation({ summary: 'Start cooking a planned batch' })
  @ApiEnvelope(CanteenKitchenBatchDto, { message: 'Batch started' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  start(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.kitchen.start(schoolId, id);
  }

  @Post('batches/:id/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.CANTEEN_ORDER)
  @ResponseMessage('Batch completed')
  @ApiOperation({
    summary: 'Finish a batch and use up the recipe ingredients from stock',
    description:
      'Each recipe line is deducted for the prepared quantity. If any ingredient is short the call fails with STOCK_INSUFFICIENT naming it and nothing changes.',
  })
  @ApiEnvelope(CanteenKitchenBatchDto, { message: 'Batch completed' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  complete(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CanteenKitchenBatchCompleteDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.kitchen.complete(schoolId, id, dto, actor.id);
  }

  @Post('batches/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.CANTEEN_ORDER)
  @ResponseMessage('Batch cancelled')
  @ApiOperation({ summary: 'Cancel a batch that is not finished' })
  @ApiEnvelope(CanteenKitchenBatchDto, { message: 'Batch cancelled' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  cancel(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.kitchen.cancel(schoolId, id);
  }
}
