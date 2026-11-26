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
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import {
  AvailableBedDto,
  BedAvailabilityQueryDto,
  BedDto,
  BedUpdateDto,
  BlockDto,
  BlockInputDto,
  BlockQueryDto,
  BlockUpdateDto,
  FloorDto,
  FloorInputDto,
  FloorQueryDto,
  FloorUpdateDto,
  HostelDashboardDto,
  HostelDto,
  HostelIdQueryDto,
  HostelInputDto,
  HostelModulesDto,
  HostelSettingsDto,
  HostelSettingsInputDto,
  HostelUpdateDto,
  RoomBulkDto,
  RoomBulkResultDto,
  RoomDetailDto,
  RoomDto,
  RoomInputDto,
  RoomQueryDto,
  RoomTypeDto,
  RoomTypeInputDto,
  RoomTypeUpdateDto,
  RoomUpdateDto,
} from './dto/hostel-setup.dto';
import { HostelSettingsService } from './hostel-settings.service';
import { HostelSetupService } from './hostel-setup.service';

@ApiTags('Admin · Hostel')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/hostel')
export class HostelSetupController {
  constructor(
    private readonly setup: HostelSetupService,
    private readonly settings: HostelSettingsService,
  ) {}

  @Get('dashboard')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Hostel dashboard: beds, occupancy, rooms under maintenance and enabled modules' })
  @ApiEnvelope(HostelDashboardDto)
  dashboard(@SchoolId() schoolId: number, @Query() query: HostelIdQueryDto) {
    return this.setup.dashboard(schoolId, query);
  }

  @Get('settings')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Hostel timings, rules and optional modules (staff duty, lockers, study hall, ...)' })
  @ApiEnvelope(HostelSettingsDto)
  getSettings(@SchoolId() schoolId: number) {
    return this.settings.get(schoolId);
  }

  @Put('settings')
  @RequirePermissions(PERMISSIONS.HOSTEL_SETTINGS)
  @ResponseMessage('Hostel settings saved')
  @ApiOperation({ summary: 'Change hostel timings, rules or turn optional modules on and off' })
  @ApiEnvelope(HostelSettingsDto)
  @ApiErrors(HttpStatus.BAD_REQUEST)
  updateSettings(@SchoolId() schoolId: number, @Body() dto: HostelSettingsInputDto, @CurrentUser() user: AuthUser) {
    return this.settings.update(schoolId, dto, user);
  }

  @Get('modules')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Which optional hostel modules are on, to show or hide menu items' })
  @ApiEnvelope(HostelModulesDto)
  modules(@SchoolId() schoolId: number) {
    return this.settings.modules(schoolId);
  }

  @Get('hostels')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Hostels with block, room, bed and occupancy counts' })
  @ApiEnvelope(HostelDto, { isArray: true })
  listHostels(@SchoolId() schoolId: number) {
    return this.setup.listHostels(schoolId);
  }

  @Get('hostels/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'One hostel' })
  @ApiEnvelope(HostelDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  getHostel(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.setup.getHostel(schoolId, id);
  }

  @Post('hostels')
  @RequirePermissions(PERMISSIONS.HOSTEL_MANAGE)
  @ResponseMessage('Hostel created')
  @ApiOperation({ summary: 'Add a hostel' })
  @ApiEnvelope(HostelDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  createHostel(@SchoolId() schoolId: number, @Body() dto: HostelInputDto, @CurrentUser() user: AuthUser) {
    return this.setup.createHostel(schoolId, dto, user);
  }

  @Patch('hostels/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_MANAGE)
  @ResponseMessage('Hostel updated')
  @ApiOperation({ summary: 'Edit a hostel' })
  @ApiEnvelope(HostelDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  updateHostel(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: HostelUpdateDto) {
    return this.setup.updateHostel(schoolId, id, dto);
  }

  @Delete('hostels/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Hostel removed')
  @ApiOperation({ summary: 'Remove a hostel that has no blocks' })
  @ApiEnvelope()
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async removeHostel(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.setup.removeHostel(schoolId, id);
  }

  @Get('blocks')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Blocks with floor, room and bed counts' })
  @ApiEnvelope(BlockDto, { isArray: true })
  listBlocks(@SchoolId() schoolId: number, @Query() query: BlockQueryDto) {
    return this.setup.listBlocks(schoolId, query);
  }

  @Post('blocks')
  @RequirePermissions(PERMISSIONS.HOSTEL_MANAGE)
  @ResponseMessage('Block created')
  @ApiOperation({ summary: 'Add a block to a hostel' })
  @ApiEnvelope(BlockDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  createBlock(@SchoolId() schoolId: number, @Body() dto: BlockInputDto, @CurrentUser() user: AuthUser) {
    return this.setup.createBlock(schoolId, dto, user);
  }

  @Patch('blocks/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_MANAGE)
  @ResponseMessage('Block updated')
  @ApiOperation({ summary: 'Edit a block' })
  @ApiEnvelope(BlockDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  updateBlock(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: BlockUpdateDto) {
    return this.setup.updateBlock(schoolId, id, dto);
  }

  @Delete('blocks/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Block removed')
  @ApiOperation({ summary: 'Remove a block that has no floors' })
  @ApiEnvelope()
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async removeBlock(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.setup.removeBlock(schoolId, id);
  }

  @Get('floors')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Floors with room and bed counts' })
  @ApiEnvelope(FloorDto, { isArray: true })
  listFloors(@SchoolId() schoolId: number, @Query() query: FloorQueryDto) {
    return this.setup.listFloors(schoolId, query);
  }

  @Post('floors')
  @RequirePermissions(PERMISSIONS.HOSTEL_MANAGE)
  @ResponseMessage('Floor created')
  @ApiOperation({ summary: 'Add a floor to a block' })
  @ApiEnvelope(FloorDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  createFloor(@SchoolId() schoolId: number, @Body() dto: FloorInputDto, @CurrentUser() user: AuthUser) {
    return this.setup.createFloor(schoolId, dto, user);
  }

  @Patch('floors/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_MANAGE)
  @ResponseMessage('Floor updated')
  @ApiOperation({ summary: 'Rename a floor or change its level' })
  @ApiEnvelope(FloorDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  updateFloor(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: FloorUpdateDto) {
    return this.setup.updateFloor(schoolId, id, dto);
  }

  @Delete('floors/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Floor removed')
  @ApiOperation({ summary: 'Remove a floor that has no rooms' })
  @ApiEnvelope()
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async removeFloor(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.setup.removeFloor(schoolId, id);
  }

  @Get('room-types')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Room types (sharing, AC, fee)' })
  @ApiEnvelope(RoomTypeDto, { isArray: true })
  listRoomTypes(@SchoolId() schoolId: number) {
    return this.setup.listRoomTypes(schoolId);
  }

  @Post('room-types')
  @RequirePermissions(PERMISSIONS.HOSTEL_MANAGE)
  @ResponseMessage('Room type created')
  @ApiOperation({ summary: 'Add a room type' })
  @ApiEnvelope(RoomTypeDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  createRoomType(@SchoolId() schoolId: number, @Body() dto: RoomTypeInputDto, @CurrentUser() user: AuthUser) {
    return this.setup.createRoomType(schoolId, dto, user);
  }

  @Patch('room-types/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_MANAGE)
  @ResponseMessage('Room type updated')
  @ApiOperation({ summary: 'Edit a room type' })
  @ApiEnvelope(RoomTypeDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  updateRoomType(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: RoomTypeUpdateDto) {
    return this.setup.updateRoomType(schoolId, id, dto);
  }

  @Delete('room-types/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Room type removed')
  @ApiOperation({ summary: 'Remove a room type no room uses' })
  @ApiEnvelope()
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async removeRoomType(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.setup.removeRoomType(schoolId, id);
  }

  @Get('rooms')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Rooms with occupied and vacant beds. sort: room_no, created_at, capacity, vacant_beds' })
  @ApiEnvelope(RoomDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  listRooms(@SchoolId() schoolId: number, @Query() query: RoomQueryDto) {
    return this.setup.listRooms(schoolId, query);
  }

  @Get('rooms/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'One room with its beds' })
  @ApiEnvelope(RoomDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  getRoom(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.setup.getRoom(schoolId, id);
  }

  @Post('rooms')
  @RequirePermissions(PERMISSIONS.HOSTEL_MANAGE)
  @ResponseMessage('Room created')
  @ApiOperation({ summary: 'Add a room; its beds (A, B, C...) are created with it' })
  @ApiEnvelope(RoomDetailDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  createRoom(@SchoolId() schoolId: number, @Body() dto: RoomInputDto, @CurrentUser() user: AuthUser) {
    return this.setup.createRoom(schoolId, dto, user);
  }

  @Post('rooms/bulk')
  @RequirePermissions(PERMISSIONS.HOSTEL_MANAGE)
  @ResponseMessage('Rooms created')
  @ApiOperation({ summary: 'Add a run of numbered rooms on one floor, e.g. A-101 to A-110' })
  @ApiEnvelope(RoomBulkResultDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  bulkRooms(@SchoolId() schoolId: number, @Body() dto: RoomBulkDto, @CurrentUser() user: AuthUser) {
    return this.setup.bulkRooms(schoolId, dto, user);
  }

  @Patch('rooms/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_MANAGE)
  @ResponseMessage('Room updated')
  @ApiOperation({ summary: 'Edit a room; changing capacity adds beds or removes vacant ones' })
  @ApiEnvelope(RoomDetailDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  updateRoom(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RoomUpdateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.setup.updateRoom(schoolId, id, dto, user);
  }

  @Delete('rooms/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Room removed')
  @ApiOperation({ summary: 'Remove a room with no students in it' })
  @ApiEnvelope()
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async removeRoom(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.setup.removeRoom(schoolId, id);
  }

  @Patch('beds/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_MANAGE)
  @ResponseMessage('Bed updated')
  @ApiOperation({ summary: 'Block a bed, send it for maintenance or make it vacant again' })
  @ApiEnvelope(BedDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  updateBed(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: BedUpdateDto) {
    return this.setup.updateBed(schoolId, id, dto);
  }

  @Get('beds/available')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Vacant beds in active rooms, for allocation (up to 500)' })
  @ApiEnvelope(AvailableBedDto, { isArray: true })
  availableBeds(@SchoolId() schoolId: number, @Query() query: BedAvailabilityQueryDto) {
    return this.setup.availableBeds(schoolId, query);
  }
}
