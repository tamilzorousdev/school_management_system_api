import { Body, Controller, Get, HttpStatus, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import {
  AddGrievanceNoteDto,
  AssignGrievanceDto,
  CreateGrievanceDto,
  EscalateGrievanceDto,
  GrievanceDetailDto,
  GrievanceInsightsDto,
  GrievanceItemDto,
  GrievanceQueryDto,
  GrievanceTimelineItemDto,
  ResolveGrievanceDto,
  UpdateGrievanceStatusDto,
} from './dto/grievance.dto';
import { GrievancesService } from './grievances.service';

@ApiTags('Admin · Grievances')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/grievances')
export class GrievancesController {
  constructor(private readonly grievancesService: GrievancesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.GRIEVANCES_VIEW)
  @ApiOperation({ summary: 'List and filter grievances and complaints with SLA breach indicator' })
  @ApiEnvelope(GrievanceItemDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  list(@SchoolId() schoolId: number, @Query() query: GrievanceQueryDto) {
    return this.grievancesService.list(schoolId, query);
  }

  @Get('insights')
  @RequirePermissions(PERMISSIONS.GRIEVANCES_VIEW)
  @ApiOperation({ summary: 'Summary counters, SLA breaches, and category breakdown for grievances' })
  @ApiEnvelope(GrievanceInsightsDto)
  insights(@SchoolId() schoolId: number) {
    return this.grievancesService.insights(schoolId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.GRIEVANCES_VIEW)
  @ApiOperation({ summary: 'Get grievance dossier with timeline and investigation notes' })
  @ApiEnvelope(GrievanceDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  getById(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.grievancesService.getById(schoolId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.GRIEVANCES_MANAGE)
  @ResponseMessage('Grievance ticket created')
  @ApiOperation({ summary: 'Register a walk-in, phone, or administrative grievance ticket' })
  @ApiEnvelope(GrievanceDetailDto, { message: 'Grievance ticket created' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  create(@SchoolId() schoolId: number, @Body() dto: CreateGrievanceDto, @CurrentUser() actor: AuthUser) {
    return this.grievancesService.create(schoolId, dto, actor);
  }

  @Patch(':id/assign')
  @RequirePermissions(PERMISSIONS.GRIEVANCES_MANAGE)
  @ResponseMessage('Grievance handler assigned')
  @ApiOperation({ summary: 'Assign or reassign an officer to investigate the grievance' })
  @ApiEnvelope(GrievanceDetailDto, { message: 'Grievance handler assigned' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.BAD_REQUEST)
  assign(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignGrievanceDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.grievancesService.assign(schoolId, id, dto, actor);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.GRIEVANCES_MANAGE)
  @ResponseMessage('Grievance status updated')
  @ApiOperation({ summary: 'Update workflow progress status of a grievance ticket' })
  @ApiEnvelope(GrievanceDetailDto, { message: 'Grievance status updated' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.BAD_REQUEST)
  updateStatus(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateGrievanceStatusDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.grievancesService.updateStatus(schoolId, id, dto, actor);
  }

  @Post(':id/notes')
  @RequirePermissions(PERMISSIONS.GRIEVANCES_MANAGE)
  @ResponseMessage('Grievance note added')
  @ApiOperation({ summary: 'Add a confidential internal investigation note or public update' })
  @ApiEnvelope(GrievanceTimelineItemDto, { message: 'Grievance note added' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.BAD_REQUEST)
  addNote(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddGrievanceNoteDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.grievancesService.addNote(schoolId, id, dto, actor);
  }

  @Post(':id/resolve')
  @RequirePermissions(PERMISSIONS.GRIEVANCES_RESOLVE)
  @ResponseMessage('Grievance marked as resolved')
  @ApiOperation({ summary: 'Submit resolution summary and conclude grievance' })
  @ApiEnvelope(GrievanceDetailDto, { message: 'Grievance marked as resolved' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.BAD_REQUEST)
  resolve(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResolveGrievanceDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.grievancesService.resolve(schoolId, id, dto, actor);
  }

  @Post(':id/escalate')
  @RequirePermissions(PERMISSIONS.GRIEVANCES_RESOLVE)
  @ResponseMessage('Grievance escalated')
  @ApiOperation({ summary: 'Escalate ticket to Principal executive review' })
  @ApiEnvelope(GrievanceDetailDto, { message: 'Grievance escalated' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.BAD_REQUEST)
  escalate(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EscalateGrievanceDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.grievancesService.escalate(schoolId, id, dto, actor);
  }
}
