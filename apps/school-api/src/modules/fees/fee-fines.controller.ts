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
import {
  ApproveFineDto,
  FineDto,
  FineInputDto,
  FineQueryDto,
  FineTypeDto,
  FineTypeInputDto,
  FineTypeQueryDto,
  RejectFineDto,
  UpdateFineTypeDto,
} from './dto/fee-fines.dto';
import { FeeFinesService } from './fee-fines.service';

@ApiTags('Admin · Fees')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/fees')
export class FeeFinesController {
  constructor(private readonly fines: FeeFinesService) {}

  @Get('fine-types')
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiOperation({ summary: 'Fine types with their default amount; active=true for the ones that can be used now' })
  @ApiEnvelope(FineTypeDto, { isArray: true })
  listTypes(@SchoolId() schoolId: number, @Query() query: FineTypeQueryDto) {
    return this.fines.listTypes(schoolId, query);
  }

  @Post('fine-types')
  @RequirePermissions(PERMISSIONS.FEES_CONFIGURE)
  @ResponseMessage('Fine type added')
  @ApiOperation({ summary: 'Add a fine type (409 FINE_TYPE_EXISTS for a name in use)' })
  @ApiEnvelope(FineTypeDto, { status: HttpStatus.CREATED, message: 'Fine type added' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  createType(@SchoolId() schoolId: number, @Body() dto: FineTypeInputDto, @CurrentUser() actor: AuthUser) {
    return this.fines.createType(schoolId, dto, actor);
  }

  @Patch('fine-types/:id')
  @RequirePermissions(PERMISSIONS.FEES_CONFIGURE)
  @ResponseMessage('Fine type updated')
  @ApiOperation({ summary: 'Change a fine type or switch it off. Fines already raised keep their amount.' })
  @ApiEnvelope(FineTypeDto, { message: 'Fine type updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  updateType(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFineTypeDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.fines.updateType(schoolId, id, dto, actor);
  }

  @Delete('fine-types/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FEES_CONFIGURE)
  @ResponseMessage('Fine type deleted')
  @ApiOperation({ summary: 'Delete a fine type. Fines already raised keep their title and amount.' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  async removeType(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() actor: AuthUser,
  ) {
    await this.fines.removeType(schoolId, id, actor);
    return null;
  }

  @Get('fines')
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiOperation({
    summary: 'Fines raised on students for misconduct or damage, newest first',
    description:
      'Filters: status (pending, approved, rejected, withdrawn), student_id, fine_type_id. search: student name, admission no., fine no., title. sort: created_at, decided_at, amount.',
  })
  @ApiEnvelope(FineDto, { paginated: true })
  list(@SchoolId() schoolId: number, @Query() query: FineQueryDto) {
    return this.fines.list(schoolId, query);
  }

  @Get('fines/:id')
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiOperation({ summary: 'One fine' })
  @ApiEnvelope(FineDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.fines.get(schoolId, id);
  }

  @Post('fines')
  @RequirePermissions(PERMISSIONS.FEES_FINE)
  @ResponseMessage('Fine sent for approval')
  @ApiOperation({
    summary: 'Raise a fine on a student; it waits for approval',
    description:
      'Send fine_type_id to use its name and amount, or title and amount. A disciplinary behaviour note is written at once and stays hidden from parents until the fine is approved. Approvers (fees.approve) are told.',
  })
  @ApiEnvelope(FineDto, { status: HttpStatus.CREATED, message: 'Fine sent for approval' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  raise(@SchoolId() schoolId: number, @Body() dto: FineInputDto, @CurrentUser() actor: AuthUser) {
    return this.fines.raise(schoolId, dto, actor);
  }

  @Post('fines/:id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FEES_APPROVE)
  @ResponseMessage('Fine approved')
  @ApiOperation({
    summary: 'Approve a fine: it becomes a fine invoice the parent can pay',
    description:
      'due_date defaults to 7 days from today. Advance credit is used first. The behaviour note becomes visible to parents and parents are told. The person who raised it cannot approve it (403 SELF_APPROVAL). 409 FINE_NOT_PENDING if already decided.',
  })
  @ApiEnvelope(FineDto, { message: 'Fine approved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  approve(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApproveFineDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.fines.approve(schoolId, id, dto, actor);
  }

  @Post('fines/:id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FEES_APPROVE)
  @ResponseMessage('Fine rejected')
  @ApiOperation({ summary: 'Reject a fine, with the reason. Nothing is charged.' })
  @ApiEnvelope(FineDto, { message: 'Fine rejected' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  reject(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectFineDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.fines.reject(schoolId, id, dto, actor);
  }

  @Post('fines/:id/withdraw')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FEES_FINE)
  @ResponseMessage('Fine withdrawn')
  @ApiOperation({ summary: 'Withdraw my own pending fine (403 NOT_REQUESTER for someone else’s)' })
  @ApiEnvelope(FineDto, { message: 'Fine withdrawn' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  withdraw(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthUser) {
    return this.fines.withdraw(schoolId, id, actor);
  }
}
