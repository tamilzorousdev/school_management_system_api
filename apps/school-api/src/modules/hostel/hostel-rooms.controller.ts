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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelope,
  ApiErrors,
  AppException,
  AuthUser,
  CurrentUser,
  RequirePermissions,
  RequireRoles,
  ResponseMessage,
} from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS, ROLES } from '../access/access.catalog';
import { PARENT_MODULE_TAGS } from '../mobile/parent-modules.catalog';
import { TEACHER_MODULE_TAGS } from '../mobile/teacher-modules.catalog';
import {
  AssetApplyDto,
  AssetApplyResultDto,
  AssetQueryDto,
  BelongingDto,
  BelongingInputDto,
  BelongingUpdateDto,
  ChecklistDto,
  InspectionDetailDto,
  InspectionDto,
  InspectionDueDto,
  InspectionDueQueryDto,
  InspectionInputDto,
  InspectionQueryDto,
  LockerAllocateDto,
  LockerBulkDto,
  LockerBulkResultDto,
  LockerDetailDto,
  LockerDto,
  LockerInputDto,
  LockerQueryDto,
  LockerReturnDto,
  LockerSummaryDto,
  LockerUpdateDto,
  ParentLockerDto,
  RoomAssetDto,
  RoomAssetInputDto,
  RoomAssetUpdateDto,
} from './dto/hostel-rooms.dto';
import { HostelIdQueryDto } from './dto/hostel-setup.dto';
import { HostelAssetsService } from './hostel-assets.service';
import { HostelInspectionsService } from './hostel-inspections.service';
import { HostelLockersService } from './hostel-lockers.service';
import { HostelModuleGate, HostelModuleGuard } from './hostel-module.guard';

export const HOSTEL_ROOMS_ADMIN_TAG = 'Admin · Hostel lockers, inspections & assets';

const schoolOf = (user: AuthUser): number => {
  if (!user.school_id) throw AppException.forbidden('Your account is not linked to a school', 'NO_SCHOOL');
  return user.school_id;
};

@ApiTags(HOSTEL_ROOMS_ADMIN_TAG)
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@UseGuards(HostelModuleGuard)
@HostelModuleGate('lockers')
@Controller('admin/hostel')
export class HostelLockersController {
  constructor(private readonly lockers: HostelLockersService) {}

  @Get('lockers/summary')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Locker counts: total, available, allotted, damaged, blocked' })
  @ApiEnvelope(LockerSummaryDto)
  summary(@SchoolId() schoolId: number, @Query() query: HostelIdQueryDto) {
    return this.lockers.summary(schoolId, query.hostel_id);
  }

  @Get('lockers')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({
    summary: 'Lockers with the student holding each one. sort: locker_no, created_at, status',
    description: 'search matches the locker number or the holder’s name and admission number.',
  })
  @ApiEnvelope(LockerDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  list(@SchoolId() schoolId: number, @Query() query: LockerQueryDto) {
    return this.lockers.list(schoolId, query);
  }

  @Get('lockers/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'One locker with its allocation history' })
  @ApiEnvelope(LockerDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.lockers.get(schoolId, id);
  }

  @Post('lockers')
  @RequirePermissions(PERMISSIONS.HOSTEL_LOCKER)
  @ResponseMessage('Locker added')
  @ApiOperation({ summary: 'Add a locker to a hostel (optionally in a block or room)' })
  @ApiEnvelope(LockerDetailDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  create(@SchoolId() schoolId: number, @Body() dto: LockerInputDto, @CurrentUser() user: AuthUser) {
    return this.lockers.create(schoolId, dto, user);
  }

  @Post('lockers/bulk')
  @RequirePermissions(PERMISSIONS.HOSTEL_LOCKER)
  @ResponseMessage('Lockers added')
  @ApiOperation({ summary: 'Add a run of numbered lockers, e.g. L-001 to L-040' })
  @ApiEnvelope(LockerBulkResultDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  bulk(@SchoolId() schoolId: number, @Body() dto: LockerBulkDto, @CurrentUser() user: AuthUser) {
    return this.lockers.bulk(schoolId, dto, user);
  }

  @Patch('lockers/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_LOCKER)
  @ResponseMessage('Locker updated')
  @ApiOperation({ summary: 'Mark available, damaged or blocked (not while allotted); change size, place or notes' })
  @ApiEnvelope(LockerDetailDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  update(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LockerUpdateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.lockers.update(schoolId, id, dto, user);
  }

  @Delete('lockers/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_LOCKER)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Locker removed')
  @ApiOperation({ summary: 'Remove a locker that is not allotted' })
  @ApiEnvelope()
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async remove(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    await this.lockers.remove(schoolId, id, user);
  }

  @Post('lockers/:id/allocate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_LOCKER)
  @ResponseMessage('Locker allotted')
  @ApiOperation({
    summary: 'Give an available locker to a resident of the same hostel',
    description: 'One locker per student: 409 HOSTEL_LOCKER_HELD when the student already has one.',
  })
  @ApiEnvelope(LockerDetailDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  allocate(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LockerAllocateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.lockers.allocate(schoolId, id, dto, user);
  }

  @Post('locker-allocations/:id/return')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_LOCKER)
  @ResponseMessage('Locker returned')
  @ApiOperation({
    summary: 'Take a locker back: it becomes available, or damaged when damaged=true',
    description: 'Keys not returned are noted on the allocation.',
  })
  @ApiEnvelope(LockerDetailDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  returnLocker(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LockerReturnDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.lockers.returnAllocation(schoolId, id, dto, user);
  }
}

@ApiTags(HOSTEL_ROOMS_ADMIN_TAG)
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/hostel')
export class HostelRoomsController {
  constructor(
    private readonly assets: HostelAssetsService,
    private readonly inspections: HostelInspectionsService,
  ) {}

  @Get('rooms/:roomId/assets')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Furniture and fittings of one room' })
  @ApiEnvelope(RoomAssetDto, { isArray: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  roomAssets(@SchoolId() schoolId: number, @Param('roomId', ParseIntPipe) roomId: number) {
    return this.assets.roomAssets(schoolId, roomId);
  }

  @Post('rooms/:roomId/assets')
  @RequirePermissions(PERMISSIONS.HOSTEL_INVENTORY)
  @ResponseMessage('Asset added')
  @ApiOperation({ summary: 'Add an item to a room (bed, cupboard, fan...)' })
  @ApiEnvelope(RoomAssetDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  addAsset(
    @SchoolId() schoolId: number,
    @Param('roomId', ParseIntPipe) roomId: number,
    @Body() dto: RoomAssetInputDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assets.addAsset(schoolId, roomId, dto, user);
  }

  @Get('assets')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({
    summary: 'Room assets across rooms (condition=damaged or missing for the repair list)',
    description: 'sort: room_no, item_name, condition, updated_at. search matches item, room number or asset tag.',
  })
  @ApiEnvelope(RoomAssetDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  listAssets(@SchoolId() schoolId: number, @Query() query: AssetQueryDto) {
    return this.assets.list(schoolId, query);
  }

  @Post('assets/apply')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_INVENTORY)
  @ResponseMessage('Assets added to rooms')
  @ApiOperation({
    summary: 'Add a standard set of items to many rooms (by ids, room type or hostel)',
    description: 'A room that already has an item with the same name keeps it; that item is skipped there.',
  })
  @ApiEnvelope(AssetApplyResultDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  applyAssets(@SchoolId() schoolId: number, @Body() dto: AssetApplyDto, @CurrentUser() user: AuthUser) {
    return this.assets.apply(schoolId, dto, user);
  }

  @Patch('assets/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_INVENTORY)
  @ResponseMessage('Asset updated')
  @ApiOperation({ summary: 'Edit a room asset; a new condition also sets last_checked_at' })
  @ApiEnvelope(RoomAssetDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  updateAsset(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RoomAssetUpdateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assets.updateAsset(schoolId, id, dto, user);
  }

  @Delete('assets/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_INVENTORY)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Asset removed')
  @ApiOperation({ summary: 'Remove an item from a room' })
  @ApiEnvelope()
  @ApiErrors(HttpStatus.NOT_FOUND)
  async removeAsset(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    await this.assets.removeAsset(schoolId, id, user);
  }

  @Get('inspections/checklist')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Default room inspection checklist' })
  @ApiEnvelope(ChecklistDto)
  checklist() {
    return this.inspections.checklist();
  }

  @Get('inspections/due')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({
    summary: 'Active rooms not inspected in the last `days` days (default 30), never inspected first',
    description: 'sort: last_inspected_at (default), room_no.',
  })
  @ApiEnvelope(InspectionDueDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  due(@SchoolId() schoolId: number, @Query() query: InspectionDueQueryDto) {
    return this.inspections.due(schoolId, query);
  }

  @Get('inspections')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Room inspections. sort: inspected_at, score' })
  @ApiEnvelope(InspectionDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  listInspections(@SchoolId() schoolId: number, @Query() query: InspectionQueryDto) {
    return this.inspections.list(schoolId, query);
  }

  @Get('inspections/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'One inspection with its checklist' })
  @ApiEnvelope(InspectionDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  getInspection(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.inspections.get(schoolId, id);
  }

  @Post('inspections')
  @RequirePermissions(PERMISSIONS.HOSTEL_MAINTENANCE)
  @ResponseMessage('Inspection recorded')
  @ApiOperation({
    summary: 'Record a room inspection',
    description:
      'score = ok / (ok + issue) x 100 (100 when nothing is marked); result is issues when any item is an issue. update_assets sets the condition of room assets; raise_ticket opens a maintenance ticket for the room; raise_case records a discipline case and needs hostel.discipline.',
  })
  @ApiEnvelope(InspectionDetailDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  createInspection(@SchoolId() schoolId: number, @Body() dto: InspectionInputDto, @CurrentUser() user: AuthUser) {
    return this.inspections.create(schoolId, dto, user);
  }

  @Get('admissions/:id/belongings')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Valuables a resident keeps in the hostel (phone, laptop, cycle...)' })
  @ApiEnvelope(BelongingDto, { isArray: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  belongings(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.assets.belongings(schoolId, id);
  }

  @Post('admissions/:id/belongings')
  @RequirePermissions(PERMISSIONS.HOSTEL_INVENTORY)
  @ResponseMessage('Belonging recorded')
  @ApiOperation({ summary: 'Record an item the resident brought' })
  @ApiEnvelope(BelongingDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  addBelonging(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: BelongingInputDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assets.addBelonging(schoolId, id, dto, user);
  }

  @Patch('belongings/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_INVENTORY)
  @ResponseMessage('Belonging updated')
  @ApiOperation({ summary: 'Mark an item with the student, returned home, lost or confiscated' })
  @ApiEnvelope(BelongingDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  updateBelonging(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: BelongingUpdateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assets.updateBelonging(schoolId, id, dto, user);
  }

  @Delete('belongings/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_INVENTORY)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Belonging removed')
  @ApiOperation({ summary: 'Remove an item recorded by mistake' })
  @ApiEnvelope()
  @ApiErrors(HttpStatus.NOT_FOUND)
  async removeBelonging(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    await this.assets.removeBelonging(schoolId, id, user);
  }
}

@ApiTags(TEACHER_MODULE_TAGS.MODULE_14)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@UseGuards(HostelModuleGuard)
@HostelModuleGate('lockers')
@Controller('mobile/teacher/hostel')
export class MobileHostelLockersController {
  constructor(private readonly lockers: HostelLockersService) {}

  @Get('lockers/summary')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Locker counts: total, available, allotted, damaged, blocked' })
  @ApiEnvelope(LockerSummaryDto)
  summary(@CurrentUser() user: AuthUser, @Query() query: HostelIdQueryDto) {
    return this.lockers.summary(schoolOf(user), query.hostel_id);
  }

  @Get('lockers')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Lockers with their holder (available=true for free ones)' })
  @ApiEnvelope(LockerDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  list(@CurrentUser() user: AuthUser, @Query() query: LockerQueryDto) {
    return this.lockers.list(schoolOf(user), query);
  }

  @Get('lockers/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'One locker with its allocation history' })
  @ApiEnvelope(LockerDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.lockers.get(schoolOf(user), id);
  }

  @Post('lockers')
  @RequirePermissions(PERMISSIONS.HOSTEL_LOCKER)
  @ResponseMessage('Locker added')
  @ApiOperation({ summary: 'Add a locker' })
  @ApiEnvelope(LockerDetailDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  create(@CurrentUser() user: AuthUser, @Body() dto: LockerInputDto) {
    return this.lockers.create(schoolOf(user), dto, user);
  }

  @Post('lockers/bulk')
  @RequirePermissions(PERMISSIONS.HOSTEL_LOCKER)
  @ResponseMessage('Lockers added')
  @ApiOperation({ summary: 'Add a run of numbered lockers' })
  @ApiEnvelope(LockerBulkResultDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  bulk(@CurrentUser() user: AuthUser, @Body() dto: LockerBulkDto) {
    return this.lockers.bulk(schoolOf(user), dto, user);
  }

  @Patch('lockers/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_LOCKER)
  @ResponseMessage('Locker updated')
  @ApiOperation({ summary: 'Mark a locker available, damaged or blocked; change size, place or notes' })
  @ApiEnvelope(LockerDetailDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: LockerUpdateDto) {
    return this.lockers.update(schoolOf(user), id, dto, user);
  }

  @Delete('lockers/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_LOCKER)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Locker removed')
  @ApiOperation({ summary: 'Remove a locker that is not allotted' })
  @ApiEnvelope()
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.lockers.remove(schoolOf(user), id, user);
  }

  @Post('lockers/:id/allocate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_LOCKER)
  @ResponseMessage('Locker allotted')
  @ApiOperation({ summary: 'Give an available locker to a resident (one per student)' })
  @ApiEnvelope(LockerDetailDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  allocate(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: LockerAllocateDto) {
    return this.lockers.allocate(schoolOf(user), id, dto, user);
  }

  @Post('locker-allocations/:id/return')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_LOCKER)
  @ResponseMessage('Locker returned')
  @ApiOperation({ summary: 'Take a locker back with its keys' })
  @ApiEnvelope(LockerDetailDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  returnLocker(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: LockerReturnDto) {
    return this.lockers.returnAllocation(schoolOf(user), id, dto, user);
  }
}

@ApiTags(TEACHER_MODULE_TAGS.MODULE_14)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('mobile/teacher/hostel')
export class MobileHostelRoomsController {
  constructor(
    private readonly assets: HostelAssetsService,
    private readonly inspections: HostelInspectionsService,
  ) {}

  @Get('rooms/:roomId/assets')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Furniture and fittings of one room' })
  @ApiEnvelope(RoomAssetDto, { isArray: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  roomAssets(@CurrentUser() user: AuthUser, @Param('roomId', ParseIntPipe) roomId: number) {
    return this.assets.roomAssets(schoolOf(user), roomId);
  }

  @Post('rooms/:roomId/assets')
  @RequirePermissions(PERMISSIONS.HOSTEL_INVENTORY)
  @ResponseMessage('Asset added')
  @ApiOperation({ summary: 'Add an item to a room' })
  @ApiEnvelope(RoomAssetDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  addAsset(
    @CurrentUser() user: AuthUser,
    @Param('roomId', ParseIntPipe) roomId: number,
    @Body() dto: RoomAssetInputDto,
  ) {
    return this.assets.addAsset(schoolOf(user), roomId, dto, user);
  }

  @Get('assets')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Room assets across rooms (condition=damaged or missing for repairs)' })
  @ApiEnvelope(RoomAssetDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  listAssets(@CurrentUser() user: AuthUser, @Query() query: AssetQueryDto) {
    return this.assets.list(schoolOf(user), query);
  }

  @Post('assets/apply')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_INVENTORY)
  @ResponseMessage('Assets added to rooms')
  @ApiOperation({ summary: 'Add a standard set of items to many rooms' })
  @ApiEnvelope(AssetApplyResultDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  applyAssets(@CurrentUser() user: AuthUser, @Body() dto: AssetApplyDto) {
    return this.assets.apply(schoolOf(user), dto, user);
  }

  @Patch('assets/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_INVENTORY)
  @ResponseMessage('Asset updated')
  @ApiOperation({ summary: 'Edit a room asset (condition, quantity, notes)' })
  @ApiEnvelope(RoomAssetDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  updateAsset(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: RoomAssetUpdateDto) {
    return this.assets.updateAsset(schoolOf(user), id, dto, user);
  }

  @Delete('assets/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_INVENTORY)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Asset removed')
  @ApiOperation({ summary: 'Remove an item from a room' })
  @ApiEnvelope()
  @ApiErrors(HttpStatus.NOT_FOUND)
  async removeAsset(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.assets.removeAsset(schoolOf(user), id, user);
  }

  @Get('inspections/checklist')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Default room inspection checklist' })
  @ApiEnvelope(ChecklistDto)
  checklist() {
    return this.inspections.checklist();
  }

  @Get('inspections/due')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Rooms due for inspection (not inspected in `days` days, default 30)' })
  @ApiEnvelope(InspectionDueDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  due(@CurrentUser() user: AuthUser, @Query() query: InspectionDueQueryDto) {
    return this.inspections.due(schoolOf(user), query);
  }

  @Get('inspections')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Room inspections, newest first' })
  @ApiEnvelope(InspectionDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  listInspections(@CurrentUser() user: AuthUser, @Query() query: InspectionQueryDto) {
    return this.inspections.list(schoolOf(user), query);
  }

  @Get('inspections/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'One inspection with its checklist' })
  @ApiEnvelope(InspectionDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  getInspection(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.inspections.get(schoolOf(user), id);
  }

  @Post('inspections')
  @RequirePermissions(PERMISSIONS.HOSTEL_MAINTENANCE)
  @ResponseMessage('Inspection recorded')
  @ApiOperation({
    summary: 'Record a room inspection from the checklist',
    description:
      'Can also update asset conditions, raise a maintenance ticket (raise_ticket) and record a discipline case (raise_case, needs hostel.discipline).',
  })
  @ApiEnvelope(InspectionDetailDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  createInspection(@CurrentUser() user: AuthUser, @Body() dto: InspectionInputDto) {
    return this.inspections.create(schoolOf(user), dto, user);
  }

  @Get('residents/:id/belongings')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Valuables a resident keeps in the hostel (id is the hostel admission id)' })
  @ApiEnvelope(BelongingDto, { isArray: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  belongings(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.assets.belongings(schoolOf(user), id);
  }

  @Post('residents/:id/belongings')
  @RequirePermissions(PERMISSIONS.HOSTEL_INVENTORY)
  @ResponseMessage('Belonging recorded')
  @ApiOperation({ summary: 'Record an item the resident brought' })
  @ApiEnvelope(BelongingDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  addBelonging(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: BelongingInputDto) {
    return this.assets.addBelonging(schoolOf(user), id, dto, user);
  }

  @Patch('belongings/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_INVENTORY)
  @ResponseMessage('Belonging updated')
  @ApiOperation({ summary: 'Mark an item with the student, returned home, lost or confiscated' })
  @ApiEnvelope(BelongingDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  updateBelonging(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: BelongingUpdateDto,
  ) {
    return this.assets.updateBelonging(schoolOf(user), id, dto, user);
  }

  @Delete('belongings/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_INVENTORY)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Belonging removed')
  @ApiOperation({ summary: 'Remove an item recorded by mistake' })
  @ApiEnvelope()
  @ApiErrors(HttpStatus.NOT_FOUND)
  async removeBelonging(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.assets.removeBelonging(schoolOf(user), id, user);
  }
}

@ApiTags(PARENT_MODULE_TAGS.MODULE_11)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND)
@RequireRoles(ROLES.PARENT)
@Controller('mobile/parent/children/:id/hostel')
export class ParentHostelRoomsController {
  constructor(
    private readonly lockers: HostelLockersService,
    private readonly assets: HostelAssetsService,
  ) {}

  @Get('locker')
  @ApiOperation({
    summary: 'My child’s hostel locker',
    description:
      'data is null when no locker is given. 403 HOSTEL_MODULE_DISABLED when the school does not use lockers.',
  })
  @ApiEnvelope(ParentLockerDto)
  locker(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.lockers.parentLocker(user, id);
  }

  @Get('belongings')
  @ApiOperation({ summary: 'Valuables declared for my child in the hostel' })
  @ApiEnvelope(BelongingDto, { isArray: true })
  belongings(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.assets.parentBelongings(user, id);
  }

  @Post('belongings')
  @ResponseMessage('Item declared')
  @ApiOperation({ summary: 'Declare an item my child keeps in the hostel (phone, laptop, cycle...)' })
  @ApiEnvelope(BelongingDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  declare(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: BelongingInputDto) {
    return this.assets.parentDeclare(user, id, dto);
  }
}
