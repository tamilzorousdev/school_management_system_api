import { Body, Controller, Get, HttpStatus, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequireRoles, ResponseMessage } from '@app/common';
import { ROLES } from '../access/access.catalog';
import { AppraisalsService } from '../staff/appraisals.service';
import { StaffAppraisalCommentDto, StaffAppraisalDto, StaffHikeRequestDto } from '../staff/dto/staff-appraisal.dto';
import { MobileAccessService } from './mobile-access.service';
import { TEACHER_MODULE_TAGS } from './teacher-modules.catalog';

@ApiTags(TEACHER_MODULE_TAGS.MODULE_1)
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@RequireRoles(ROLES.TEACHER, ROLES.HOD, ROLES.PRINCIPAL)
@Controller('mobile/teacher/appraisals')
export class MobileTeacherAppraisalsController {
  constructor(
    private readonly access: MobileAccessService,
    private readonly appraisals: AppraisalsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Teacher performance reviews and appraisals',
    description:
      'Lists all appraisals for the logged-in teacher, including draft review requests and finalized reviews.',
  })
  @ApiEnvelope(StaffAppraisalDto, { isArray: true })
  list(@CurrentUser() user: AuthUser) {
    const schoolId = this.access.teacherSchool(user);
    return this.appraisals.myAppraisals(schoolId, user.id);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'View appraisal details and scorecard',
    description: 'Detailed view of ratings, strengths, improvement areas, approved salary increment, and remarks.',
  })
  @ApiEnvelope(StaffAppraisalDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const schoolId = this.access.teacherSchool(user);
    return this.appraisals.myAppraisal(schoolId, user.id, id);
  }

  @Post(':id/hike-request')
  @ResponseMessage('Increment request submitted')
  @ApiOperation({
    summary: 'Submit requested salary increment percentage and justification',
    description:
      'Allows a teacher to request their desired percentage hike and provide justification during appraisal review.',
  })
  @ApiEnvelope(StaffAppraisalDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  submitHikeRequest(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: StaffHikeRequestDto,
  ) {
    const schoolId = this.access.teacherSchool(user);
    return this.appraisals.submitHikeRequest(schoolId, user.id, id, dto);
  }

  @Post(':id/remarks')
  @ResponseMessage('Staff remarks submitted')
  @ApiOperation({
    summary: 'Submit acknowledgment and feedback on finalized review',
    description: 'Allows teacher to add their closing remarks or feedback after review is published.',
  })
  @ApiEnvelope(StaffAppraisalDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  addRemarks(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: StaffAppraisalCommentDto,
  ) {
    const schoolId = this.access.teacherSchool(user);
    return this.appraisals.addStaffRemarks(schoolId, user.id, id, dto);
  }
}
