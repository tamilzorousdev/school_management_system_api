import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelope,
  ApiErrors,
  AppException,
  AuthUser,
  CurrentUser,
  ListQueryDto,
  RequirePermissions,
  RequireRoles,
  ResponseMessage,
} from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS, ROLES } from '../access/access.catalog';
import { PARENT_MODULE_TAGS } from '../mobile/parent-modules.catalog';
import { TEACHER_MODULE_TAGS } from '../mobile/teacher-modules.catalog';
import { ApplicationDto } from './dto/hostel-admission.dto';
import {
  ParentApplicationInputDto,
  ParentHostelOptionsDto,
  RuleAckQueryDto,
  RuleAckRowDto,
  RuleAckSummaryDto,
  RulesDto,
  SosCloseDto,
  SosDetailDto,
  SosDto,
  SosInputDto,
  SosMarkDto,
  SosQueryDto,
} from './dto/hostel-safety.dto';
import { HostelIdQueryDto } from './dto/hostel-setup.dto';
import { HostelSafetyService } from './hostel-safety.service';

const schoolOf = (user: AuthUser): number => {
  if (!user.school_id) throw AppException.forbidden('Your account is not linked to a school', 'NO_SCHOOL');
  return user.school_id;
};

@ApiTags('Admin · Hostel safety & rules')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/hostel')
export class HostelSafetyController {
  constructor(private readonly safety: HostelSafetyService) {}

  @Get('sos/active')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Open emergency alerts with the live headcount' })
  @ApiEnvelope(SosDto, { isArray: true })
  active(@SchoolId() schoolId: number, @Query() query: HostelIdQueryDto) {
    return this.safety.active(schoolId, query.hostel_id);
  }

  @Get('sos')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Emergency alerts and drills, newest first' })
  @ApiEnvelope(SosDto, { paginated: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  list(@SchoolId() schoolId: number, @Query() query: SosQueryDto) {
    return this.safety.list(schoolId, query);
  }

  @Get('sos/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'One alert with every resident and their headcount mark' })
  @ApiEnvelope(SosDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.safety.get(schoolId, id);
  }

  @Post('sos')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ResponseMessage('Alert raised')
  @ApiOperation({
    summary: 'Raise an emergency alert or start a drill',
    description:
      'Wardens, assistant wardens, the principal and admins get HOSTEL_SOS by push and SMS. notify_parents also tells every resident’s parents (never for drills).',
  })
  @ApiEnvelope(SosDetailDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  raise(@SchoolId() schoolId: number, @Body() dto: SosInputDto, @CurrentUser() user: AuthUser) {
    return this.safety.raise(schoolId, dto, user);
  }

  @Post('sos/:id/mark')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_ATTENDANCE)
  @ResponseMessage('Headcount saved')
  @ApiOperation({ summary: 'Mark residents safe, missing, injured or away' })
  @ApiEnvelope(SosDetailDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  mark(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SosMarkDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.safety.mark(schoolId, id, dto, user);
  }

  @Post('sos/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_ATTENDANCE)
  @ResponseMessage('Alert resolved')
  @ApiOperation({ summary: 'Close the alert when everyone is accounted for' })
  @ApiEnvelope(SosDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  resolve(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SosCloseDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.safety.close(schoolId, id, dto, user, false);
  }

  @Post('sos/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_ATTENDANCE)
  @ResponseMessage('Alert cancelled')
  @ApiOperation({ summary: 'Cancel an alert raised by mistake' })
  @ApiEnvelope(SosDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  cancel(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SosCloseDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.safety.close(schoolId, id, dto, user, true);
  }

  @Get('rules')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Current hostel rules and timings with their version' })
  @ApiEnvelope(RulesDto)
  rules(@SchoolId() schoolId: number) {
    return this.safety.rules(schoolId, null, null);
  }

  @Get('rules/acknowledgements/summary')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'How many residents’ parents agreed to the current rules' })
  @ApiEnvelope(RuleAckSummaryDto)
  ackSummary(@SchoolId() schoolId: number, @Query() query: HostelIdQueryDto) {
    return this.safety.acknowledgeSummary(schoolId, query.hostel_id);
  }

  @Get('rules/acknowledgements')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Residents and whether a parent agreed to the current rules (acknowledged=false to chase)' })
  @ApiEnvelope(RuleAckRowDto, { paginated: true })
  acks(@SchoolId() schoolId: number, @Query() query: RuleAckQueryDto) {
    return this.safety.acknowledges(schoolId, query);
  }
}

@ApiTags(TEACHER_MODULE_TAGS.MODULE_14)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('mobile/teacher/hostel')
export class MobileHostelSafetyController {
  constructor(private readonly safety: HostelSafetyService) {}

  @Get('sos/active')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Open emergency alerts (show a red banner on the hostel home)' })
  @ApiEnvelope(SosDto, { isArray: true })
  active(@CurrentUser() user: AuthUser, @Query() query: HostelIdQueryDto) {
    return this.safety.active(schoolOf(user), query.hostel_id);
  }

  @Get('sos')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Past alerts and drills' })
  @ApiEnvelope(SosDto, { paginated: true })
  list(@CurrentUser() user: AuthUser, @Query() query: SosQueryDto) {
    return this.safety.list(schoolOf(user), query);
  }

  @Get('sos/:id')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Emergency headcount screen' })
  @ApiEnvelope(SosDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.safety.get(schoolOf(user), id);
  }

  @Post('sos')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ResponseMessage('Alert raised')
  @ApiOperation({ summary: 'SOS button: raise an emergency alert or start a drill' })
  @ApiEnvelope(SosDetailDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  raise(@CurrentUser() user: AuthUser, @Body() dto: SosInputDto) {
    return this.safety.raise(schoolOf(user), dto, user);
  }

  @Post('sos/:id/mark')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_ATTENDANCE)
  @ResponseMessage('Headcount saved')
  @ApiOperation({ summary: 'Mark residents safe, missing, injured or away' })
  @ApiEnvelope(SosDetailDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  mark(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: SosMarkDto) {
    return this.safety.mark(schoolOf(user), id, dto, user);
  }

  @Post('sos/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_ATTENDANCE)
  @ResponseMessage('Alert resolved')
  @ApiOperation({ summary: 'Close the alert' })
  @ApiEnvelope(SosDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  resolve(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: SosCloseDto) {
    return this.safety.close(schoolOf(user), id, dto, user, false);
  }

  @Post('sos/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.HOSTEL_ATTENDANCE)
  @ResponseMessage('Alert cancelled')
  @ApiOperation({ summary: 'Cancel an alert raised by mistake' })
  @ApiEnvelope(SosDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: SosCloseDto) {
    return this.safety.close(schoolOf(user), id, dto, user, true);
  }

  @Get('rules/acknowledgements')
  @RequirePermissions(PERMISSIONS.HOSTEL_VIEW)
  @ApiOperation({ summary: 'Residents whose parents have or have not agreed to the rules' })
  @ApiEnvelope(RuleAckRowDto, { paginated: true })
  acks(@CurrentUser() user: AuthUser, @Query() query: RuleAckQueryDto) {
    return this.safety.acknowledges(schoolOf(user), query);
  }
}

@ApiTags(PARENT_MODULE_TAGS.MODULE_11)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND)
@RequireRoles(ROLES.PARENT)
@Controller('mobile/parent/children/:id/hostel')
export class ParentHostelSafetyController {
  constructor(private readonly safety: HostelSafetyService) {}

  @Get('options')
  @ApiOperation({ summary: 'Before applying: hostels that fit my child, room types with fees, caution deposit' })
  @ApiEnvelope(ParentHostelOptionsDto)
  options(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.safety.parentOptions(user, id);
  }

  @Get('applications')
  @ApiOperation({ summary: 'My hostel applications for this child' })
  @ApiEnvelope(ApplicationDto, { paginated: true })
  applications(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() query: ListQueryDto) {
    return this.safety.parentApplications(user, id, query);
  }

  @Post('applications')
  @ResponseMessage('Hostel application sent')
  @ApiOperation({
    summary: 'Apply for the hostel for my child',
    description:
      'The warden and the office are told. HOSTEL_ALREADY_ADMITTED or HOSTEL_APPLICATION_EXISTS when not possible.',
  })
  @ApiEnvelope(ApplicationDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  apply(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: ParentApplicationInputDto) {
    return this.safety.parentApply(user, id, dto);
  }

  @Get('rules')
  @ApiOperation({ summary: 'Hostel rules and timings, and whether I agreed to this version' })
  @ApiEnvelope(RulesDto)
  rules(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.safety.parentRules(user, id);
  }

  @Post('rules/acknowledge')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Thank you')
  @ApiOperation({ summary: 'I have read and agree to the hostel rules' })
  @ApiEnvelope(RulesDto)
  acknowledge(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.safety.parentAcknowledge(user, id);
  }
}
