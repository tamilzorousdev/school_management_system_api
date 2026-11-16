import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
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
import { PERMISSIONS, ROLES } from '../access/access.catalog';
import { PARENT_MODULE_TAGS } from '../mobile/parent-modules.catalog';
import { TEACHER_MODULE_TAGS } from '../mobile/teacher-modules.catalog';
import { SetSignatureDto, SignatureDetailDto, SignatureSavedDto } from './dto/signature.dto';
import { SignaturesService } from './signatures.service';

const REUSE_RULES =
  'Makes a signature from the history current again, with no new drawing or photo. It is recorded as changed with the note "Used an earlier signature again", and report cards signed this year switch to it like any other change. 404 SIGNATURE_CHANGE_NOT_FOUND when the history row is not this person’s; 400 SIGNATURE_ALREADY_IN_USE when it is the current one.';

const SIGNATURE_RULES =
  'Upload the image first with purpose signature_pad (drawn on screen) or signature (photo of a paper signature); both become a clean transparent PNG. null removes it. Report cards signed this year switch to the new signature and show "updated" with the date; earlier years and removals leave signed cards as they are.';

@ApiTags('Admin · Signatures')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin')
export class AdminSignaturesController {
  constructor(private readonly signatures: SignaturesService) {}

  @Get('staff/:id/signature')
  @RequirePermissions(PERMISSIONS.STAFF_VIEW)
  @ApiOperation({ summary: 'A teacher’s current signature and every change (who, when, old and new)' })
  @ApiEnvelope(SignatureDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  async staffSignature(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.signatures.teacherDetail(await this.signatures.staffById(schoolId, id));
  }

  @Put('staff/:id/signature')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  @ResponseMessage('Signature saved')
  @ApiOperation({
    summary: 'Set or remove a teacher’s signature for them',
    description: `${SIGNATURE_RULES} Recorded as done by the school office; the teacher gets an in-app note. Their Parent app signature is never changed.`,
  })
  @ApiEnvelope(SignatureSavedDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.BAD_REQUEST)
  async setStaffSignature(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
    @Body() dto: SetSignatureDto,
  ) {
    const staff = await this.signatures.staffById(schoolId, id);
    return this.signatures.saveTeacher(staff, dto.signature_file_id ?? null, { user_id: user.id, by_admin: true });
  }

  @Get('guardians/:id/signature')
  @RequirePermissions(PERMISSIONS.STUDENTS_VIEW)
  @ApiOperation({ summary: 'A parent’s current signature and every change (who, when, old and new)' })
  @ApiEnvelope(SignatureDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  async guardianSignature(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.signatures.parentDetail(await this.signatures.guardianById(schoolId, id));
  }

  @Put('guardians/:id/signature')
  @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  @ResponseMessage('Signature saved')
  @ApiOperation({
    summary: 'Set or remove a parent’s signature for them',
    description: `${SIGNATURE_RULES} Recorded as done by the school office; the parent gets an in-app note. Their Staff app signature is never changed.`,
  })
  @ApiEnvelope(SignatureSavedDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.BAD_REQUEST)
  async setGuardianSignature(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
    @Body() dto: SetSignatureDto,
  ) {
    const guardian = await this.signatures.guardianById(schoolId, id);
    return this.signatures.saveParent(guardian, dto.signature_file_id ?? null, { user_id: user.id, by_admin: true });
  }

  @Post('staff/:id/signature/history/:changeId/use')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  @ResponseMessage('Signature saved')
  @ApiOperation({ summary: 'Use an earlier teacher signature again', description: REUSE_RULES })
  @ApiEnvelope(SignatureSavedDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.BAD_REQUEST)
  async reuseStaffSignature(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('changeId', ParseIntPipe) changeId: number,
    @CurrentUser() user: AuthUser,
  ) {
    const staff = await this.signatures.staffById(schoolId, id);
    return this.signatures.reuseTeacher(staff, changeId, { user_id: user.id, by_admin: true });
  }

  @Post('guardians/:id/signature/history/:changeId/use')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  @ResponseMessage('Signature saved')
  @ApiOperation({ summary: 'Use an earlier parent signature again', description: REUSE_RULES })
  @ApiEnvelope(SignatureSavedDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.BAD_REQUEST)
  async reuseGuardianSignature(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('changeId', ParseIntPipe) changeId: number,
    @CurrentUser() user: AuthUser,
  ) {
    const guardian = await this.signatures.guardianById(schoolId, id);
    return this.signatures.reuseParent(guardian, changeId, { user_id: user.id, by_admin: true });
  }
}

@ApiTags(TEACHER_MODULE_TAGS.MODULE_1)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@RequireRoles(ROLES.TEACHER)
@Controller('mobile/teacher/signature')
export class MobileTeacherSignatureController {
  constructor(private readonly signatures: SignaturesService) {}

  @Get()
  @ApiOperation({ summary: 'My teacher signature and its change history' })
  @ApiEnvelope(SignatureDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  async mine(@CurrentUser() user: AuthUser) {
    return this.signatures.teacherDetail(await this.signatures.ownStaff(user.school_id, user.id));
  }

  @Post('history/:changeId/use')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Signature saved')
  @ApiOperation({ summary: 'Use one of my earlier teacher signatures again', description: REUSE_RULES })
  @ApiEnvelope(SignatureSavedDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.BAD_REQUEST)
  async reuse(@CurrentUser() user: AuthUser, @Param('changeId', ParseIntPipe) changeId: number) {
    const staff = await this.signatures.ownStaff(user.school_id, user.id);
    return this.signatures.reuseTeacher(staff, changeId, { user_id: user.id, by_admin: false });
  }
}

@ApiTags(PARENT_MODULE_TAGS.MODULE_1)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@RequireRoles(ROLES.PARENT)
@Controller('mobile/parent/signature')
export class MobileParentSignatureController {
  constructor(private readonly signatures: SignaturesService) {}

  @Get()
  @ApiOperation({ summary: 'My parent signature and its change history' })
  @ApiEnvelope(SignatureDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  async mine(@CurrentUser() user: AuthUser) {
    return this.signatures.parentDetail(await this.signatures.ownGuardian(user.id));
  }

  @Post('history/:changeId/use')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Signature saved')
  @ApiOperation({ summary: 'Use one of my earlier parent signatures again', description: REUSE_RULES })
  @ApiEnvelope(SignatureSavedDto)
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.BAD_REQUEST)
  async reuse(@CurrentUser() user: AuthUser, @Param('changeId', ParseIntPipe) changeId: number) {
    const guardian = await this.signatures.ownGuardian(user.id);
    return this.signatures.reuseParent(guardian, changeId, { user_id: user.id, by_admin: false });
  }
}
