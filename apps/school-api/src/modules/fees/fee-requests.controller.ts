import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import {
  DecideRequestDto,
  FeeRequestDto,
  FeeRequestQueryDto,
  FeeSettingsDto,
  FeeSettingsInputDto,
  LateFeeRunDto,
  RejectRequestDto,
} from './dto/fees.dto';
import { FeeRequestsService } from './fee-requests.service';
import { FeeSettingsService } from './fee-settings.service';

@ApiTags('Admin · Fees')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/fees')
export class FeeRequestsController {
  constructor(
    private readonly requests: FeeRequestsService,
    private readonly settings: FeeSettingsService,
  ) {}

  @Get('requests')
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiOperation({
    summary: 'Discounts, cancellations, payment reversals and refunds asked for, newest first',
    description:
      'Filters: status (pending, approved, rejected, withdrawn), kind, invoice_id, student_id. search: student name, admission no., invoice no., reason. sort: created_at, decided_at.',
  })
  @ApiEnvelope(FeeRequestDto, { paginated: true })
  list(@SchoolId() schoolId: number, @Query() query: FeeRequestQueryDto) {
    return this.requests.list(schoolId, query);
  }

  @Get('requests/:id')
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiOperation({ summary: 'One request' })
  @ApiEnvelope(FeeRequestDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.requests.get(schoolId, id);
  }

  @Post('requests/:id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FEES_APPROVE)
  @ResponseMessage('Approved')
  @ApiOperation({
    summary: 'Approve a request and apply it',
    description:
      'The change is checked again and applied in the same transaction. The person who asked cannot approve it (403 SELF_APPROVAL). 409 REQUEST_NOT_PENDING if already decided.',
  })
  @ApiEnvelope(FeeRequestDto, { message: 'Approved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  approve(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DecideRequestDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.requests.approve(schoolId, id, dto, actor);
  }

  @Post('requests/:id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FEES_APPROVE)
  @ResponseMessage('Rejected')
  @ApiOperation({ summary: 'Reject a request, with the reason. Nothing changes on the invoice.' })
  @ApiEnvelope(FeeRequestDto, { message: 'Rejected' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  reject(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectRequestDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.requests.reject(schoolId, id, dto, actor);
  }

  @Post('requests/:id/withdraw')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FEES_ADJUST)
  @ResponseMessage('Withdrawn')
  @ApiOperation({ summary: 'Withdraw my own pending request (403 NOT_REQUESTER for someone else’s)' })
  @ApiEnvelope(FeeRequestDto, { message: 'Withdrawn' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  withdraw(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthUser) {
    return this.requests.withdraw(schoolId, id, actor);
  }

  @Get('settings')
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiOperation({ summary: 'Grace days and late fee of the school' })
  @ApiEnvelope(FeeSettingsDto)
  getSettings(@SchoolId() schoolId: number) {
    return this.settings.get(schoolId);
  }

  @Put('settings')
  @RequirePermissions(PERMISSIONS.FEES_CONFIGURE)
  @ResponseMessage('Fee settings saved')
  @ApiOperation({
    summary: 'Set the grace days and the late fee',
    description:
      'After due date + grace_days an unpaid invoice gets the late fee once (a "Late fee" line): late_fee_type flat = late_fee_value rupees, percent = late_fee_value % of the balance then, none = no late fee. Applied daily at 06:30. Overdue reminders also wait for the grace days. A late fee can be removed with a discount request.',
  })
  @ApiEnvelope(FeeSettingsDto, { message: 'Fee settings saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  putSettings(@SchoolId() schoolId: number, @Body() dto: FeeSettingsInputDto, @CurrentUser() actor: AuthUser) {
    return this.settings.update(schoolId, dto, actor);
  }

  @Post('late-fees/run')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FEES_CONFIGURE)
  @ResponseMessage('Late fees applied')
  @ApiOperation({ summary: 'Apply late fees now instead of waiting for the daily run' })
  @ApiEnvelope(LateFeeRunDto, { message: 'Late fees applied' })
  runLateFees(@SchoolId() schoolId: number, @CurrentUser() actor: AuthUser) {
    return this.settings.runLateFees(schoolId, actor.id);
  }
}
