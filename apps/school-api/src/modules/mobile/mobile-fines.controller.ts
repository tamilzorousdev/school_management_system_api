import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequireRoles, ResponseMessage } from '@app/common';
import { ROLES } from '../access/access.catalog';
import { FineDto, FineTypeDto, MyFineQueryDto, StudentFineInputDto } from '../fees/dto/fee-fines.dto';
import { FeeFinesService } from '../fees/fee-fines.service';
import { AssignmentsService } from '../staff/assignments.service';
import { MobileAccessService } from './mobile-access.service';
import { TEACHER_MODULE_TAGS } from './teacher-modules.catalog';

@ApiTags(TEACHER_MODULE_TAGS.MODULE_3)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@RequireRoles(ROLES.TEACHER, ROLES.HOD, ROLES.PRINCIPAL)
@Controller('mobile/teacher')
export class MobileTeacherFinesController {
  constructor(
    private readonly access: MobileAccessService,
    private readonly assignments: AssignmentsService,
    private readonly fines: FeeFinesService,
  ) {}

  @Get('fine-types')
  @ApiOperation({ summary: 'Fine types the school uses, with the default amount, for the Raise fine form' })
  @ApiEnvelope(FineTypeDto, { isArray: true })
  types(@CurrentUser() user: AuthUser) {
    return this.fines.listTypes(this.access.teacherSchool(user), { active: true });
  }

  @Get('fines')
  @ApiOperation({
    summary: 'Fines I raised, newest first, with their approval status',
    description:
      'status filter: pending, approved, rejected, withdrawn. search: student name, admission no., fine no., title.',
  })
  @ApiEnvelope(FineDto, { paginated: true })
  mine(@CurrentUser() user: AuthUser, @Query() query: MyFineQueryDto) {
    return this.fines.list(this.access.teacherSchool(user), query, user.id);
  }

  @Post('students/:id/fines')
  @ResponseMessage('Fine sent for approval')
  @ApiOperation({
    summary: 'Raise a fine on a student of my sections for misconduct or damage',
    description:
      'Send fine_type_id to use its name and amount, or title and amount (the amount can be changed). It waits for approval by the AO, Principal or Admin; parents see it only once approved. A disciplinary behaviour note is added. Students outside my sections return 403 NOT_YOUR_SECTION.',
  })
  @ApiEnvelope(FineDto, { status: HttpStatus.CREATED, message: 'Fine sent for approval' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async raise(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: StudentFineInputDto) {
    const schoolId = this.access.teacherSchool(user);
    await this.assignments.assertTeachesStudent(schoolId, user.id, id);
    return this.fines.raise(schoolId, { ...dto, student_id: id }, user);
  }

  @Post('fines/:id/withdraw')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Fine withdrawn')
  @ApiOperation({ summary: 'Withdraw my own fine while it is waiting for approval' })
  @ApiEnvelope(FineDto, { message: 'Fine withdrawn' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async withdraw(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const schoolId = this.access.teacherSchool(user);
    await this.fines.assertOwnFine(schoolId, id, user.id);
    return this.fines.withdraw(schoolId, id, user);
  }
}
