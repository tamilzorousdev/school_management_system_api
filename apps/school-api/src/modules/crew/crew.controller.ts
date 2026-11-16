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
import { VerifyDocumentDto } from '../../shared/verification';
import { PERMISSIONS } from '../access/access.catalog';
import { StaffDocumentInputDto } from '../staff/dto/staff-input.dto';
import { StaffDocumentDto } from '../staff/dto/staff-response.dto';
import { AllowedTodayDto, AllowTodayDto } from '../transport/dto/transport.dto';
import { ClearanceService } from './clearance.service';
import { CrewService } from './crew.service';
import {
  CreateCrewDto,
  CrewDetailDto,
  CrewInsightsDto,
  CrewListItemDto,
  CrewQueryDto,
  RemindManyDto,
  RemindResultDto,
  UpdateCrewDto,
} from './dto/crew.dto';

@ApiTags('Admin · Drivers and attendants')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/crew')
export class CrewController {
  constructor(
    private readonly crew: CrewService,
    private readonly clearance: ClearanceService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({
    summary: 'Drivers and attendants with duty status, bus and document expiry',
    description:
      'search matches name, mobile, employee number, licence and badge number. sort: name, employee_no, licence_expiry, joining_date, created_at.',
  })
  @ApiEnvelope(CrewListItemDto, { paginated: true })
  list(@SchoolId() schoolId: number, @Query() query: CrewQueryDto) {
    return this.crew.list(schoolId, query);
  }

  @Get('insights')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({ summary: 'Counts for the insight cards' })
  @ApiEnvelope(CrewInsightsDto)
  insights(@SchoolId() schoolId: number) {
    return this.crew.insights(schoolId);
  }

  @Post('remind')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Reminders sent')
  @ApiOperation({
    summary: 'Push a renewal reminder to several crew members',
    description: 'Skips people with nothing ending in 30 days or reminded in the last 6 hours.',
  })
  @ApiEnvelope(RemindResultDto, { message: 'Reminders sent' })
  remindMany(@SchoolId() schoolId: number, @Body() dto: RemindManyDto, @CurrentUser() actor: AuthUser) {
    return this.crew.remindMany(schoolId, dto, actor);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.FLEET_VIEW)
  @ApiOperation({ summary: 'Profile with clearance checks, approval, documents and bus' })
  @ApiEnvelope(CrewDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.crew.get(schoolId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Crew member added')
  @ApiOperation({
    summary: 'Add a driver or attendant with a driver app login',
    description:
      '409 MOBILE_TAKEN, STAFF_EXISTS or EMPLOYEE_NO_TAKEN. Licence and badge fields are ignored for attendants.',
  })
  @ApiEnvelope(CrewDetailDto, { status: HttpStatus.CREATED, message: 'Crew member added' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  create(@SchoolId() schoolId: number, @Body() dto: CreateCrewDto, @CurrentUser() actor: AuthUser) {
    return this.crew.create(schoolId, dto, actor);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Crew member updated')
  @ApiOperation({
    summary: 'Edit a driver or attendant',
    description: 'Changing a licence, badge, medical or police field clears the duty approval.',
  })
  @ApiEnvelope(CrewDetailDto, { message: 'Crew member updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  update(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCrewDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.crew.update(schoolId, id, dto, actor);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Crew member removed')
  @ApiOperation({ summary: 'Remove from staff and take them off their bus' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  remove(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthUser) {
    return this.crew.remove(schoolId, id, actor);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Approved for duty')
  @ApiOperation({
    summary: 'Approve for duty when every check is clear',
    description: '400 CREW_NOT_CLEAR lists the failing checks. 400 CREW_INACTIVE for crew on leave or resigned.',
  })
  @ApiEnvelope(CrewDetailDto, { message: 'Approved for duty' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  approve(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthUser) {
    return this.crew.approve(schoolId, id, actor);
  }

  @Post(':id/allow-today')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Allowed on duty today')
  @ApiOperation({
    summary: 'Let a crew member who is not cleared work today only, with a written reason',
    description:
      'Trips can start with them until midnight. Saved with who allowed it; the same day again replaces the reason.',
  })
  @ApiEnvelope(AllowedTodayDto, { message: 'Allowed on duty today' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  allowToday(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AllowTodayDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.clearance.allowCrew(schoolId, id, dto.reason, actor);
  }

  @Post(':id/remind')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Reminder sent')
  @ApiOperation({
    summary: 'Push a renewal reminder to this crew member',
    description: '400 NOTHING_DUE when nothing ends in 30 days. 429 REMINDER_TOO_SOON within 6 hours of the last one.',
  })
  @ApiEnvelope(CrewDetailDto, { message: 'Reminder sent' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.TOO_MANY_REQUESTS)
  remind(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthUser) {
    return this.crew.remind(schoolId, id, actor);
  }

  @Post(':id/documents')
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Document added')
  @ApiOperation({ summary: 'Attach an uploaded file (POST /files). A new clearance document clears the approval.' })
  @ApiEnvelope(StaffDocumentDto, { status: HttpStatus.CREATED, message: 'Document added' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  addDocument(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: StaffDocumentInputDto) {
    return this.crew.addDocument(schoolId, id, dto);
  }

  @Post(':id/documents/:documentId/verify')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Verification saved')
  @ApiOperation({ summary: 'Mark a document verified, or rejected with a reason' })
  @ApiEnvelope(StaffDocumentDto, { message: 'Verification saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  verifyDocument(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('documentId', ParseIntPipe) documentId: number,
    @Body() dto: VerifyDocumentDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.crew.verifyDocument(schoolId, id, documentId, dto, actor);
  }

  @Delete(':id/documents/:documentId')
  @RequirePermissions(PERMISSIONS.FLEET_MANAGE)
  @ResponseMessage('Document deleted')
  @ApiOperation({ summary: 'Delete a document' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  removeDocument(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('documentId', ParseIntPipe) documentId: number,
  ) {
    return this.crew.removeDocument(schoolId, id, documentId);
  }
}
