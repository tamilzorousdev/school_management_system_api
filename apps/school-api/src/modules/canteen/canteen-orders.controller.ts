import { Body, Controller, Get, HttpStatus, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import { CanteenOrdersService } from './canteen-orders.service';
import {
  OrderDateQueryDto,
  OrderDetailDto,
  OrderDto,
  OrderInputDto,
  OrderInsightsDto,
  OrderPlacedDto,
  OrderQueryDto,
  OrderStatusDto,
  TokenBoardDto,
} from './dto/canteen-sales.dto';

const P = PERMISSIONS;

@ApiTags('Admin · Canteen orders')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/canteen/orders')
export class CanteenOrdersController {
  constructor(private readonly orders: CanteenOrdersService) {}

  @Get('board')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'Token board for the counter display: tokens being prepared and tokens ready' })
  @ApiEnvelope(TokenBoardDto)
  @ApiErrors(HttpStatus.BAD_REQUEST)
  board(@SchoolId() schoolId: number, @Query() query: OrderDateQueryDto) {
    return this.orders.board(schoolId, query);
  }

  @Get('insights')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'Orders of a day by status, with revenue and unpaid amount' })
  @ApiEnvelope(OrderInsightsDto)
  @ApiErrors(HttpStatus.BAD_REQUEST)
  insights(@SchoolId() schoolId: number, @Query() query: OrderDateQueryDto) {
    return this.orders.insights(schoolId, query);
  }

  @Get()
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'Orders with filters on date, status, slot, payment, diner and counter' })
  @ApiEnvelope(OrderDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  list(@SchoolId() schoolId: number, @Query() query: OrderQueryDto) {
    return this.orders.list(schoolId, query);
  }

  @Post()
  @RequirePermissions(P.CANTEEN_ORDER)
  @ResponseMessage('Order placed')
  @ApiOperation({
    summary: 'Place an order at the counter, for a diner or a walk-in, optionally paying at once',
    description:
      'Gives the next token of the day. The response lists warnings for allergens and diet; they do not stop the order.',
  })
  @ApiEnvelope(OrderPlacedDto, { status: HttpStatus.CREATED, message: 'Order placed' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  create(@SchoolId() schoolId: number, @Body() dto: OrderInputDto, @CurrentUser() actor: AuthUser) {
    return this.orders.create(schoolId, dto, actor);
  }

  @Get(':id')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'One order with items, payments and the diner' })
  @ApiEnvelope(OrderDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.orders.get(schoolId, id);
  }

  @Patch(':id/status')
  @RequirePermissions(P.CANTEEN_ORDER)
  @ResponseMessage('Order status changed')
  @ApiOperation({
    summary: 'Move an order through placed, preparing, ready, served, or cancel it',
    description: 'Cancelling needs a reason, gives the menu quantities back and refunds a paid order.',
  })
  @ApiEnvelope(OrderDetailDto, { message: 'Order status changed' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  changeStatus(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: OrderStatusDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.orders.changeStatus(schoolId, id, dto, actor);
  }
}
