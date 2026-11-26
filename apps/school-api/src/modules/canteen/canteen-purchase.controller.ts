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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import { CanteenPurchaseService } from './canteen-purchase.service';
import {
  CanteenPurchaseDto,
  CanteenPurchaseInputDto,
  CanteenPurchaseInsightsDto,
  CanteenPurchaseQueryDto,
  CanteenReceiveDto,
  CanteenSupplierDetailDto,
  CanteenSupplierDto,
  CanteenSupplierInputDto,
  CanteenSupplierQueryDto,
  CanteenSupplierUpdateDto,
} from './dto/canteen-supply.dto';

const P = PERMISSIONS;

@ApiTags('Admin · Canteen suppliers')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/canteen/suppliers')
export class CanteenSuppliersController {
  constructor(private readonly purchases: CanteenPurchaseService) {}

  @Get()
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({
    summary: 'Suppliers',
    description: 'search: name, contact_person, mobile, supplies. sort: name, created_at.',
  })
  @ApiEnvelope(CanteenSupplierDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  list(@SchoolId() schoolId: number, @Query() query: CanteenSupplierQueryDto) {
    return this.purchases.listSuppliers(schoolId, query);
  }

  @Post()
  @RequirePermissions(P.CANTEEN_STOCK)
  @ResponseMessage('Supplier added')
  @ApiOperation({ summary: 'Add a supplier' })
  @ApiEnvelope(CanteenSupplierDto, { status: HttpStatus.CREATED, message: 'Supplier added' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  create(@SchoolId() schoolId: number, @Body() dto: CanteenSupplierInputDto) {
    return this.purchases.createSupplier(schoolId, dto);
  }

  @Get(':id')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'One supplier with purchase totals' })
  @ApiEnvelope(CanteenSupplierDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.purchases.getSupplier(schoolId, id);
  }

  @Patch(':id')
  @RequirePermissions(P.CANTEEN_STOCK)
  @ResponseMessage('Supplier saved')
  @ApiOperation({ summary: 'Edit a supplier' })
  @ApiEnvelope(CanteenSupplierDto, { message: 'Supplier saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  update(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: CanteenSupplierUpdateDto) {
    return this.purchases.updateSupplier(schoolId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(P.CANTEEN_STOCK)
  @ResponseMessage('Supplier deleted')
  @ApiOperation({ summary: 'Delete a supplier without open purchase orders (SUPPLIER_IN_USE otherwise)' })
  @ApiEnvelope(undefined, { message: 'Supplier deleted' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async remove(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.purchases.removeSupplier(schoolId, id);
    return null;
  }
}

@ApiTags('Admin · Canteen purchases')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/canteen/purchases')
export class CanteenPurchasesController {
  constructor(private readonly purchases: CanteenPurchaseService) {}

  @Get('insights')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'Purchase cards: orders by status, this month total, overdue deliveries' })
  @ApiEnvelope(CanteenPurchaseInsightsDto)
  insights(@SchoolId() schoolId: number) {
    return this.purchases.insights(schoolId);
  }

  @Get()
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({
    summary: 'Purchase orders with their lines',
    description: 'search: po_no, note. sort: order_date, total_amount, po_no, created_at.',
  })
  @ApiEnvelope(CanteenPurchaseDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  list(@SchoolId() schoolId: number, @Query() query: CanteenPurchaseQueryDto) {
    return this.purchases.list(schoolId, query);
  }

  @Post()
  @RequirePermissions(P.CANTEEN_STOCK)
  @ResponseMessage('Purchase order created')
  @ApiOperation({ summary: 'Create a draft purchase order for an active supplier' })
  @ApiEnvelope(CanteenPurchaseDto, { status: HttpStatus.CREATED, message: 'Purchase order created' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  create(@SchoolId() schoolId: number, @Body() dto: CanteenPurchaseInputDto) {
    return this.purchases.create(schoolId, dto);
  }

  @Get(':id')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'One purchase order' })
  @ApiEnvelope(CanteenPurchaseDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.purchases.get(schoolId, id);
  }

  @Post(':id/order')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.CANTEEN_STOCK)
  @ResponseMessage('Purchase order placed')
  @ApiOperation({ summary: 'Place a draft order with the supplier (draft to ordered)' })
  @ApiEnvelope(CanteenPurchaseDto, { message: 'Purchase order placed' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  place(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.purchases.place(schoolId, id);
  }

  @Post(':id/receive')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.CANTEEN_STOCK)
  @ResponseMessage('Stock received')
  @ApiOperation({
    summary: 'Receive goods against order lines and add them to stock',
    description:
      'Order becomes partial until every line is complete, then received. The stock item cost follows the latest unit cost.',
  })
  @ApiEnvelope(CanteenPurchaseDto, { message: 'Stock received' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  receive(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CanteenReceiveDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.purchases.receive(schoolId, id, dto, actor.id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.CANTEEN_STOCK)
  @ResponseMessage('Purchase order cancelled')
  @ApiOperation({ summary: 'Cancel a draft or ordered purchase with nothing received' })
  @ApiEnvelope(CanteenPurchaseDto, { message: 'Purchase order cancelled' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  cancel(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.purchases.cancel(schoolId, id);
  }
}
