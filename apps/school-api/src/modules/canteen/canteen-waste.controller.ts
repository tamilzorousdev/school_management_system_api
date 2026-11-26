import { Body, Controller, Delete, Get, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import { CanteenWasteService } from './canteen-waste.service';
import {
  CanteenWasteDto,
  CanteenWasteInputDto,
  CanteenWasteQueryDto,
  CanteenWasteSummaryDto,
  CanteenWasteSummaryQueryDto,
} from './dto/canteen-supply.dto';

const P = PERMISSIONS;

@ApiTags('Admin · Canteen waste')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/canteen/waste')
export class CanteenWasteController {
  constructor(private readonly waste: CanteenWasteService) {}

  @Get('summary')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'Waste totals by reason and by day, and the most wasted items' })
  @ApiEnvelope(CanteenWasteSummaryDto)
  @ApiErrors(HttpStatus.BAD_REQUEST)
  summary(@SchoolId() schoolId: number, @Query() query: CanteenWasteSummaryQueryDto) {
    return this.waste.summary(schoolId, query);
  }

  @Get()
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({
    summary: 'Food waste log',
    description: 'search: item_name, note. sort: waste_date, cost, quantity, created_at.',
  })
  @ApiEnvelope(CanteenWasteDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  list(@SchoolId() schoolId: number, @Query() query: CanteenWasteQueryDto) {
    return this.waste.list(schoolId, query);
  }

  @Post()
  @RequirePermissions(P.CANTEEN_STOCK)
  @ResponseMessage('Waste recorded')
  @ApiOperation({
    summary: 'Record wasted food or ingredients',
    description:
      'Cost defaults to the stock cost, or the recipe cost of a food item. A stock item is also deducted from stock as wastage.',
  })
  @ApiEnvelope(CanteenWasteDto, { status: HttpStatus.CREATED, message: 'Waste recorded' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  create(@SchoolId() schoolId: number, @Body() dto: CanteenWasteInputDto, @CurrentUser() actor: AuthUser) {
    return this.waste.create(schoolId, dto, actor.id);
  }

  @Delete(':id')
  @RequirePermissions(P.CANTEEN_STOCK)
  @ResponseMessage('Waste entry deleted')
  @ApiOperation({
    summary: 'Delete a waste entry of today (WASTE_LOCKED otherwise); stock is returned',
  })
  @ApiEnvelope(undefined, { message: 'Waste entry deleted' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async remove(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthUser) {
    await this.waste.remove(schoolId, id, actor.id);
    return null;
  }
}
