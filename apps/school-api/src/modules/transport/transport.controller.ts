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
import {
  ApiEnvelope,
  ApiErrors,
  AuthUser,
  CurrentUser,
  RequirePermissions,
  RequireRoles,
  ResponseMessage,
} from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { VerifyDocumentDto } from '../../shared/verification';
import { PERMISSIONS, ROLES } from '../access/access.catalog';
import { ClearanceService } from '../crew/clearance.service';
import {
  AllowedTodayDto,
  AllowTodayDto,
  AssignResultDto,
  AssignStopStudentsDto,
  AssignTransportDto,
  DeviceOptionDto,
  DriverDto,
  DriverDutyDto,
  ExpiryDto,
  ExpiryQueryDto,
  ExpiryRunDto,
  LicenceInputDto,
  RouteDetailDto,
  RouteDto,
  RouteInputDto,
  StopsInputDto,
  StudentTransportDto,
  StudentTransportQueryDto,
  UpdateRouteDto,
  UpdateVehicleDto,
  VehicleDocumentDto,
  VehicleDocumentInputDto,
  VehicleDto,
  VehicleInputDto,
  VehicleInsightsDto,
  VehicleQueryDto,
} from './dto/transport.dto';
import { RoutesService } from './routes.service';
import { VehicleDocumentsService } from './vehicle-documents.service';
import { VehiclesService } from './vehicles.service';

@ApiTags('Admin · Transport')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/transport')
export class TransportController {
  constructor(
    private readonly vehicles: VehiclesService,
    private readonly routes: RoutesService,
    private readonly vehicleDocuments: VehicleDocumentsService,
    private readonly clearance: ClearanceService,
  ) {}

  @Get('vehicles')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'School buses with tracker, crew, documents, seats taken and road-worthiness',
    description:
      'search matches registration, name and model. sort: name, registration_no, created_at. Filters: status, vehicle_type, flag (not_road_worthy, expired, due_soon, nearly_full, contractor).',
  })
  @ApiEnvelope(VehicleDto, { paginated: true })
  listVehicles(@SchoolId() schoolId: number, @Query() query: VehicleQueryDto) {
    return this.vehicles.list(schoolId, query);
  }

  @Get('vehicles/insights')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Bus insight cards: total, not road-worthy, expired, due soon, nearly full, contractor',
    description: 'Each card maps to the list filter flag with the same name. Active buses only.',
  })
  @ApiEnvelope(VehicleInsightsDto)
  vehicleInsights(@SchoolId() schoolId: number) {
    return this.vehicles.insights(schoolId);
  }

  @Get('vehicles/:id/documents')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary:
      'Bus documents (RC, insurance, fitness, permit, PUC, road tax, speed governor, fire extinguisher, first aid, other), newest first',
    description: 'current is true for the newest copy of each type; older copies are the renewal history.',
  })
  @ApiEnvelope(VehicleDocumentDto, { isArray: true })
  @ApiErrors(HttpStatus.NOT_FOUND)
  vehicleDocumentList(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.vehicleDocuments.list(schoolId, id);
  }

  @Post('vehicles/:id/documents')
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Document added')
  @ApiOperation({
    summary: 'Upload or renew a bus document',
    description:
      'Upload the file first with POST /files (purpose vehicle_document). Every type except other needs expiry_date, which becomes the bus’s date for that document, so renewing updates the expiry and the alerts. The copy waits for verification.',
  })
  @ApiEnvelope(VehicleDocumentDto, { status: HttpStatus.CREATED, message: 'Document added' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  addVehicleDocument(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: VehicleDocumentInputDto,
  ) {
    return this.vehicleDocuments.add(schoolId, id, dto);
  }

  @Post('vehicles/:id/documents/:documentId/verify')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Document checked')
  @ApiOperation({ summary: 'Verify or reject a bus document (remarks required to reject)' })
  @ApiEnvelope(VehicleDocumentDto, { message: 'Document checked' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  verifyVehicleDocument(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('documentId', ParseIntPipe) documentId: number,
    @Body() dto: VerifyDocumentDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.vehicleDocuments.verify(schoolId, id, documentId, dto, actor);
  }

  @Delete('vehicles/:id/documents/:documentId')
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Document removed')
  @ApiOperation({ summary: 'Remove a wrongly uploaded bus document (the expiry date stays)' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  removeVehicleDocument(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('documentId', ParseIntPipe) documentId: number,
  ) {
    return this.vehicleDocuments.remove(schoolId, id, documentId);
  }

  @Post('vehicles/:id/allow-today')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Allowed to run today')
  @ApiOperation({
    summary: 'Let a bus that is not road-worthy run trips today only, with a written reason',
    description: 'Ends at midnight. Saved with who allowed it; sending it again the same day replaces the reason.',
  })
  @ApiEnvelope(AllowedTodayDto, { message: 'Allowed to run today' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  allowVehicleToday(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AllowTodayDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.clearance.allowVehicle(schoolId, id, dto.reason, actor);
  }

  @Get('vehicles/:id')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({ summary: 'One bus' })
  @ApiEnvelope(VehicleDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  vehicle(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.vehicles.get(schoolId, id);
  }

  @Post('vehicles')
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Bus added')
  @ApiOperation({
    summary: 'Add a bus, optionally fitted with a tracker from the Telematics service',
    description:
      '409 VEHICLE_EXISTS for a repeated registration; 409 DEVICE_IN_USE when the tracker is on another bus.',
  })
  @ApiEnvelope(VehicleDto, { status: HttpStatus.CREATED, message: 'Bus added' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT, HttpStatus.SERVICE_UNAVAILABLE)
  createVehicle(@SchoolId() schoolId: number, @Body() dto: VehicleInputDto) {
    return this.vehicles.create(schoolId, dto);
  }

  @Patch('vehicles/:id')
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Bus updated')
  @ApiOperation({
    summary: 'Edit a bus',
    description: '400 CAPACITY_BELOW_ASSIGNED when the seats would go below the students already on its routes.',
  })
  @ApiEnvelope(VehicleDto, { message: 'Bus updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  updateVehicle(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateVehicleDto) {
    return this.vehicles.update(schoolId, id, dto);
  }

  @Delete('vehicles/:id')
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Bus removed')
  @ApiOperation({ summary: 'Remove a bus. Its routes stay, without a bus.' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  async removeVehicle(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.vehicles.remove(schoolId, id);
    return null;
  }

  @Get('devices')
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ApiOperation({ summary: 'Trackers registered in the Telematics service, and which bus uses each' })
  @ApiEnvelope(DeviceOptionDto, { isArray: true })
  @ApiErrors(HttpStatus.SERVICE_UNAVAILABLE)
  devices(@SchoolId() schoolId: number) {
    return this.vehicles.devices(schoolId);
  }

  @Get('drivers')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({ summary: 'Users with the Driver or Attendant role, with licence expiry and bus' })
  @ApiEnvelope(DriverDto, { isArray: true })
  drivers(@SchoolId() schoolId: number) {
    return this.vehicles.drivers(schoolId);
  }

  @Put('drivers/:userId/licence')
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Licence saved')
  @ApiOperation({ summary: 'Save a driver’s licence number and expiry' })
  @ApiEnvelope(DriverDto, { message: 'Licence saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  setLicence(
    @SchoolId() schoolId: number,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: LicenceInputDto,
  ) {
    return this.vehicles.setLicence(schoolId, userId, dto);
  }

  @Get('expiries')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({ summary: 'Insurance, fitness, PUC, permit and licences ending within N days (expired first)' })
  @ApiEnvelope(ExpiryDto, { isArray: true })
  expiries(@SchoolId() schoolId: number, @Query() query: ExpiryQueryDto) {
    return this.vehicles.upcoming(schoolId, query.days ?? 30);
  }

  @Post('expiries/check')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Expiry check done')
  @ApiOperation({
    summary: 'Run the expiry alert job now',
    description:
      'Runs daily at 07:00. The transport in-charge and admin get one alert per document at 30, 7 and 1 days left and on the day it ends.',
  })
  @ApiEnvelope(ExpiryRunDto, { message: 'Expiry check done' })
  checkExpiries(@SchoolId() schoolId: number) {
    return this.vehicles.runExpiryCheck(schoolId);
  }

  @Get('routes')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({ summary: 'Routes with bus, stop count, students and first pickup' })
  @ApiEnvelope(RouteDto, { isArray: true })
  listRoutes(@SchoolId() schoolId: number) {
    return this.routes.list(schoolId);
  }

  @Get('routes/:id')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({ summary: 'Route with its stops in order and the school location, for the map' })
  @ApiEnvelope(RouteDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  route(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.routes.detail(schoolId, id);
  }

  @Post('routes')
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Route created')
  @ApiOperation({ summary: 'Create a route' })
  @ApiEnvelope(RouteDetailDto, { status: HttpStatus.CREATED, message: 'Route created' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  createRoute(@SchoolId() schoolId: number, @Body() dto: RouteInputDto) {
    return this.routes.create(schoolId, dto);
  }

  @Patch('routes/:id')
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Route updated')
  @ApiOperation({ summary: 'Rename a route, change its bus or switch it off' })
  @ApiEnvelope(RouteDetailDto, { message: 'Route updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  updateRoute(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRouteDto) {
    return this.routes.update(schoolId, id, dto);
  }

  @Delete('routes/:id')
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Route deleted')
  @ApiOperation({ summary: 'Delete a route with no students (409 ROUTE_IN_USE otherwise)' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async removeRoute(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.routes.remove(schoolId, id);
    return null;
  }

  @Put('routes/:id/stops')
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Stops saved')
  @ApiOperation({
    summary: 'Save every stop in travel order (the route builder sends the whole list)',
    description:
      'Send id to keep a stop and its students. A removed stop that still has students returns 409 STOP_IN_USE.',
  })
  @ApiEnvelope(RouteDetailDto, { message: 'Stops saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  setStops(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: StopsInputDto) {
    return this.routes.setStops(schoolId, id, dto);
  }

  @Post('routes/:id/auto-sequence')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Stops put in order')
  @ApiOperation({
    summary: 'Order the stops automatically: start at the stop farthest from school, then always the nearest next stop',
  })
  @ApiEnvelope(RouteDetailDto, { message: 'Stops put in order' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  autoSequence(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.routes.autoSequence(schoolId, id);
  }

  @Post('routes/:id/stops/:stopId/students')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Students assigned')
  @ApiOperation({
    summary: 'Put students on this stop. Students on another stop are moved here.',
    description: '409 BUS_FULL when the bus would carry more than its seats.',
  })
  @ApiEnvelope(AssignResultDto, { message: 'Students assigned' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  assignStop(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('stopId', ParseIntPipe) stopId: number,
    @Body() dto: AssignStopStudentsDto,
  ) {
    return this.routes.assignStop(schoolId, id, stopId, dto);
  }

  @Get('students')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Students who use the bus, with route, stop, mode and fee',
    description: 'search matches student name and admission number. sort: name, created_at.',
  })
  @ApiEnvelope(StudentTransportDto, { paginated: true })
  students(@SchoolId() schoolId: number, @Query() query: StudentTransportQueryDto) {
    return this.routes.listStudents(schoolId, query);
  }
}

@ApiTags('Admin · Transport')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/students/:id/transport')
export class StudentTransportController {
  constructor(private readonly routes: RoutesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({ summary: 'The student’s bus route and stop, or null when they do not use the bus' })
  @ApiEnvelope(StudentTransportDto)
  get(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.routes.studentTransport(schoolId, id);
  }

  @Put()
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Bus stop saved')
  @ApiOperation({ summary: 'Give the student a route and stop' })
  @ApiEnvelope(StudentTransportDto, { message: 'Bus stop saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  set(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: AssignTransportDto) {
    return this.routes.assignStudent(schoolId, id, dto);
  }

  @Delete()
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Student taken off the bus')
  @ApiOperation({ summary: 'Stop bus service for the student' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  async remove(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.routes.unassignStudent(schoolId, id);
    return null;
  }
}

@ApiTags('Mobile · Driver')
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@RequireRoles(ROLES.DRIVER, ROLES.ATTENDANT)
@Controller('mobile/driver')
export class MobileDriverController {
  constructor(private readonly routes: RoutesService) {}

  @Get('duty')
  @ApiOperation({ summary: 'My bus, its routes and stops in order, with the students at each stop' })
  @ApiEnvelope(DriverDutyDto)
  duty(@CurrentUser() user: AuthUser) {
    return this.routes.forDriver(user.school_id ?? 0, user.id);
  }
}
