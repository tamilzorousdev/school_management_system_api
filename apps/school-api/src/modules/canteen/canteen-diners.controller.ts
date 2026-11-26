import { Body, Controller, Get, HttpStatus, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import { CanteenDinersService } from './canteen-diners.service';
import {
  CardBlockDto,
  CardLookupQueryDto,
  DinerDetailDto,
  DinerDto,
  DinerInputDto,
  DinerInsightsDto,
  DinerQueryDto,
  DinerStatusDto,
  DinerUpdateDto,
} from './dto/canteen-sales.dto';

const P = PERMISSIONS;

@ApiTags('Admin · Canteen diners')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/canteen')
export class CanteenDinersController {
  constructor(private readonly diners: CanteenDinersService) {}

  @Get('diners/insights')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'Diner cards: totals, students, staff, blocked cards, low balances' })
  @ApiEnvelope(DinerInsightsDto)
  insights(@SchoolId() schoolId: number) {
    return this.diners.insights(schoolId);
  }

  @Get('cards/lookup')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({
    summary: 'Find a diner from a meal card number or a student ID card QR',
    description:
      'Refuses blocked, lost or expired cards (CARD_NOT_ACTIVE) and suspended or left diners (DINER_NOT_ACTIVE).',
  })
  @ApiEnvelope(DinerDetailDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  lookup(@SchoolId() schoolId: number, @Query() query: CardLookupQueryDto) {
    return this.diners.lookup(schoolId, query);
  }

  @Get('diners')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'Enrolled students and staff with meal card, diet and wallet balance' })
  @ApiEnvelope(DinerDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  list(@SchoolId() schoolId: number, @Query() query: DinerQueryDto) {
    return this.diners.list(schoolId, query);
  }

  @Post('diners')
  @RequirePermissions(P.CANTEEN_MANAGE)
  @ResponseMessage('Diner enrolled')
  @ApiOperation({ summary: 'Enrol a student or staff member for canteen meals and issue a meal card' })
  @ApiEnvelope(DinerDetailDto, { status: HttpStatus.CREATED, message: 'Diner enrolled' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  create(@SchoolId() schoolId: number, @Body() dto: DinerInputDto, @CurrentUser() actor: AuthUser) {
    return this.diners.create(schoolId, dto, actor);
  }

  @Get('diners/:id')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'One diner with balance, today spend and the last orders' })
  @ApiEnvelope(DinerDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.diners.get(schoolId, id);
  }

  @Patch('diners/:id')
  @RequirePermissions(P.CANTEEN_MANAGE)
  @ResponseMessage('Diner saved')
  @ApiOperation({ summary: 'Change diet, allergies, meal slots, daily limit or notes' })
  @ApiEnvelope(DinerDetailDto, { message: 'Diner saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  update(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: DinerUpdateDto) {
    return this.diners.update(schoolId, id, dto);
  }

  @Patch('diners/:id/status')
  @RequirePermissions(P.CANTEEN_MANAGE)
  @ResponseMessage('Diner status changed')
  @ApiOperation({ summary: 'Activate, suspend or mark a diner as left' })
  @ApiEnvelope(DinerDetailDto, { message: 'Diner status changed' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  setStatus(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: DinerStatusDto) {
    return this.diners.setStatus(schoolId, id, dto);
  }

  @Post('diners/:id/card/replace')
  @RequirePermissions(P.CANTEEN_MANAGE)
  @ResponseMessage('Meal card replaced')
  @ApiOperation({ summary: 'Issue a new meal card; the old card number stops working' })
  @ApiEnvelope(DinerDetailDto, { status: HttpStatus.CREATED, message: 'Meal card replaced' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  replaceCard(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.diners.replaceCard(schoolId, id);
  }

  @Post('diners/:id/card/block')
  @RequirePermissions(P.CANTEEN_MANAGE)
  @ResponseMessage('Meal card blocked')
  @ApiOperation({ summary: 'Block a meal card (lost or misused)' })
  @ApiEnvelope(DinerDetailDto, { status: HttpStatus.CREATED, message: 'Meal card blocked' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  blockCard(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: CardBlockDto) {
    return this.diners.blockCard(schoolId, id, dto);
  }

  @Post('diners/:id/card/unblock')
  @RequirePermissions(P.CANTEEN_MANAGE)
  @ResponseMessage('Meal card unblocked')
  @ApiOperation({ summary: 'Make a blocked meal card work again' })
  @ApiEnvelope(DinerDetailDto, { status: HttpStatus.CREATED, message: 'Meal card unblocked' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  unblockCard(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.diners.unblockCard(schoolId, id);
  }
}
