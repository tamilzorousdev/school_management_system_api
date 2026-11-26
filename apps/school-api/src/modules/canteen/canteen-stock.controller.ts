import { Body, Controller, Delete, Get, HttpStatus, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import { CanteenStockService } from './canteen-stock.service';
import {
  CanteenStockAdjustDto,
  CanteenStockInsightsDto,
  CanteenStockItemDto,
  CanteenStockItemInputDto,
  CanteenStockItemQueryDto,
  CanteenStockItemUpdateDto,
  CanteenStockMovementDto,
  CanteenStockMovementQueryDto,
} from './dto/canteen-supply.dto';

const P = PERMISSIONS;

@ApiTags('Admin · Canteen stock')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/canteen/stock')
export class CanteenStockController {
  constructor(private readonly stock: CanteenStockService) {}

  @Get('insights')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'Stock cards: total items, out of stock, low, expiring soon and stock value' })
  @ApiEnvelope(CanteenStockInsightsDto)
  insights(@SchoolId() schoolId: number) {
    return this.stock.insights(schoolId);
  }

  @Get('low')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({
    summary: 'Items at or below their reorder level, for purchasing',
    description: 'search: name, code. sort: name, quantity, expiry_date, cost_per_unit, created_at.',
  })
  @ApiEnvelope(CanteenStockItemDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  low(@SchoolId() schoolId: number, @Query() query: CanteenStockItemQueryDto) {
    return this.stock.lowStock(schoolId, query);
  }

  @Get()
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({
    summary: 'Stock items with status, expiry and supplier',
    description: 'search: name, code. sort: name, quantity, expiry_date, cost_per_unit, created_at.',
  })
  @ApiEnvelope(CanteenStockItemDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  list(@SchoolId() schoolId: number, @Query() query: CanteenStockItemQueryDto) {
    return this.stock.list(schoolId, query);
  }

  @Post()
  @RequirePermissions(P.CANTEEN_STOCK)
  @ResponseMessage('Stock item added')
  @ApiOperation({ summary: 'Add a stock item, optionally with opening stock' })
  @ApiEnvelope(CanteenStockItemDto, { status: HttpStatus.CREATED, message: 'Stock item added' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  create(@SchoolId() schoolId: number, @Body() dto: CanteenStockItemInputDto, @CurrentUser() actor: AuthUser) {
    return this.stock.create(schoolId, dto, actor.id);
  }

  @Get(':id')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'One stock item' })
  @ApiEnvelope(CanteenStockItemDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.stock.get(schoolId, id);
  }

  @Patch(':id')
  @RequirePermissions(P.CANTEEN_STOCK)
  @ResponseMessage('Stock item saved')
  @ApiOperation({ summary: 'Edit a stock item (quantity changes go through adjust)' })
  @ApiEnvelope(CanteenStockItemDto, { message: 'Stock item saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  update(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: CanteenStockItemUpdateDto) {
    return this.stock.update(schoolId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(P.CANTEEN_STOCK)
  @ResponseMessage('Stock item deleted')
  @ApiOperation({
    summary: 'Delete a stock item not used in a recipe or an open purchase (STOCK_ITEM_IN_USE otherwise)',
  })
  @ApiEnvelope(undefined, { message: 'Stock item deleted' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async remove(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.stock.remove(schoolId, id);
    return null;
  }

  @Post(':id/adjust')
  @RequirePermissions(P.CANTEEN_STOCK)
  @ResponseMessage('Stock updated')
  @ApiOperation({
    summary: 'Change the quantity on hand: adjustment (signed), return (adds) or issue (removes)',
    description: 'Refuses to go below zero with STOCK_INSUFFICIENT. Every change writes a movement with the balance.',
  })
  @ApiEnvelope(CanteenStockMovementDto, { status: HttpStatus.CREATED, message: 'Stock updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  adjust(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CanteenStockAdjustDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.stock.adjust(schoolId, id, dto, actor.id);
  }

  @Get(':id/movements')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({
    summary: 'Stock movements of one item, newest first',
    description: 'search: note. sort: created_at, quantity.',
  })
  @ApiEnvelope(CanteenStockMovementDto, { paginated: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  movements(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: CanteenStockMovementQueryDto,
  ) {
    return this.stock.movementsOf(schoolId, id, query);
  }
}
