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
import { ApiEnvelope, ApiErrors, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import { CanteenTablesService } from './canteen-tables.service';
import {
  CanteenBookingDto,
  CanteenBookingInputDto,
  CanteenBookingQueryDto,
  CanteenBookingReleaseDto,
  CanteenTableDto,
  CanteenTableInputDto,
  CanteenTableLayoutQueryDto,
  CanteenTableLayoutRowDto,
  CanteenTableQueryDto,
  CanteenTablesInsightsDto,
  CanteenTableStatusDto,
  CanteenTableUpdateDto,
} from './dto/canteen-supply.dto';

const P = PERMISSIONS;

@ApiTags('Admin · Canteen tables')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/canteen/tables')
export class CanteenTablesController {
  constructor(private readonly tables: CanteenTablesService) {}

  @Get('insights')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'Seating cards: total, occupied and free seats, bookings reserved today' })
  @ApiEnvelope(CanteenTablesInsightsDto)
  insights(@SchoolId() schoolId: number) {
    return this.tables.insights(schoolId);
  }

  @Get('layout')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'Every active table with its current booking for a date and slot' })
  @ApiEnvelope(CanteenTableLayoutRowDto, { isArray: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  layout(@SchoolId() schoolId: number, @Query() query: CanteenTableLayoutQueryDto) {
    return this.tables.layout(schoolId, query);
  }

  @Get('bookings')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({
    summary: 'Table bookings',
    description: 'search: guest name, table name. sort: booking_date, slot, created_at.',
  })
  @ApiEnvelope(CanteenBookingDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  bookings(@SchoolId() schoolId: number, @Query() query: CanteenBookingQueryDto) {
    return this.tables.listBookings(schoolId, query);
  }

  @Post('bookings')
  @RequirePermissions(P.CANTEEN_ORDER)
  @ResponseMessage('Table booked')
  @ApiOperation({ summary: 'Reserve a table for a date and slot (TABLE_BOOKED when taken)' })
  @ApiEnvelope(CanteenBookingDto, { status: HttpStatus.CREATED, message: 'Table booked' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  book(@SchoolId() schoolId: number, @Body() dto: CanteenBookingInputDto) {
    return this.tables.book(schoolId, dto);
  }

  @Post('bookings/:id/seat')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.CANTEEN_ORDER)
  @ResponseMessage('Guests seated')
  @ApiOperation({ summary: 'Seat the party; the table becomes occupied' })
  @ApiEnvelope(CanteenBookingDto, { message: 'Guests seated' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  seat(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.tables.seat(schoolId, id);
  }

  @Post('bookings/:id/release')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.CANTEEN_ORDER)
  @ResponseMessage('Table released')
  @ApiOperation({ summary: 'Finish the booking; the table becomes free, or cleaning when asked' })
  @ApiEnvelope(CanteenBookingDto, { message: 'Table released' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  release(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: CanteenBookingReleaseDto) {
    return this.tables.release(schoolId, id, dto);
  }

  @Post('bookings/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.CANTEEN_ORDER)
  @ResponseMessage('Booking cancelled')
  @ApiOperation({ summary: 'Cancel a reserved or seated booking' })
  @ApiEnvelope(CanteenBookingDto, { message: 'Booking cancelled' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  cancelBooking(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.tables.cancelBooking(schoolId, id);
  }

  @Get()
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'Tables', description: 'search: name, area. sort: name, seats, area, created_at.' })
  @ApiEnvelope(CanteenTableDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  list(@SchoolId() schoolId: number, @Query() query: CanteenTableQueryDto) {
    return this.tables.list(schoolId, query);
  }

  @Post()
  @RequirePermissions(P.CANTEEN_MANAGE)
  @ResponseMessage('Table added')
  @ApiOperation({ summary: 'Add a table' })
  @ApiEnvelope(CanteenTableDto, { status: HttpStatus.CREATED, message: 'Table added' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  create(@SchoolId() schoolId: number, @Body() dto: CanteenTableInputDto) {
    return this.tables.create(schoolId, dto);
  }

  @Get(':id')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'One table' })
  @ApiEnvelope(CanteenTableDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.tables.get(schoolId, id);
  }

  @Patch(':id')
  @RequirePermissions(P.CANTEEN_MANAGE)
  @ResponseMessage('Table saved')
  @ApiOperation({ summary: 'Edit a table' })
  @ApiEnvelope(CanteenTableDto, { message: 'Table saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  update(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: CanteenTableUpdateDto) {
    return this.tables.update(schoolId, id, dto);
  }

  @Patch(':id/status')
  @RequirePermissions(P.CANTEEN_ORDER)
  @ResponseMessage('Table status changed')
  @ApiOperation({ summary: 'Mark a table free, occupied, reserved or cleaning' })
  @ApiEnvelope(CanteenTableDto, { message: 'Table status changed' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  setStatus(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: CanteenTableStatusDto) {
    return this.tables.setStatus(schoolId, id, dto.status);
  }

  @Delete(':id')
  @RequirePermissions(P.CANTEEN_MANAGE)
  @ResponseMessage('Table deleted')
  @ApiOperation({ summary: 'Delete a table without active bookings (TABLE_IN_USE otherwise)' })
  @ApiEnvelope(undefined, { message: 'Table deleted' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async remove(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.tables.remove(schoolId, id);
    return null;
  }
}
