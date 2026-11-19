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
  AwardInputDto,
  AwardQueryDto,
  AwardResultDto,
  BenefitInputDto,
  BenefitQueryDto,
  FeeAwardDto,
  FeeBenefitDto,
  RevokeAwardDto,
  UpdateBenefitDto,
} from './dto/fees.dto';
import { FeeBenefitsService } from './fee-benefits.service';

@ApiTags('Admin · Fees')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/fees')
export class FeeBenefitsController {
  constructor(private readonly benefits: FeeBenefitsService) {}

  @Get('benefits')
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiOperation({
    summary: 'Concessions and scholarships for the year',
    description:
      'search: name, description. sort: name, value, created_at. Rules when invoices are raised: concessions first, then scholarships; a percentage is taken from the fee head amount; a fixed amount is a yearly figure spread over the installments; a fee line never goes below 0.',
  })
  @ApiEnvelope(FeeBenefitDto, { paginated: true })
  list(@SchoolId() schoolId: number, @Query() query: BenefitQueryDto) {
    return this.benefits.list(schoolId, query);
  }

  @Get('benefits/:id')
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiOperation({ summary: 'One concession or scholarship' })
  @ApiEnvelope(FeeBenefitDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    return this.benefits.get(schoolId, id);
  }

  @Post('benefits')
  @RequirePermissions(PERMISSIONS.FEES_CONFIGURE)
  @ResponseMessage('Saved')
  @ApiOperation({ summary: 'Add a concession or scholarship for the year' })
  @ApiEnvelope(FeeBenefitDto, { status: HttpStatus.CREATED, message: 'Saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  create(@SchoolId() schoolId: number, @Body() dto: BenefitInputDto, @CurrentUser() actor: AuthUser) {
    return this.benefits.create(schoolId, dto, actor);
  }

  @Patch('benefits/:id')
  @RequirePermissions(PERMISSIONS.FEES_CONFIGURE)
  @ResponseMessage('Saved')
  @ApiOperation({ summary: 'Change a concession or scholarship. Invoices already raised keep their amounts.' })
  @ApiEnvelope(FeeBenefitDto, { message: 'Saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  update(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBenefitDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.benefits.update(schoolId, id, dto, actor);
  }

  @Delete('benefits/:id')
  @RequirePermissions(PERMISSIONS.FEES_CONFIGURE)
  @ResponseMessage('Deleted')
  @ApiOperation({ summary: 'Delete one that was never given to a student (409 BENEFIT_IN_USE otherwise)' })
  @ApiEnvelope(undefined, { message: 'Deleted' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async remove(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthUser) {
    await this.benefits.remove(schoolId, id, actor);
    return null;
  }

  @Get('benefit-awards')
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiOperation({
    summary: 'Students given a concession or scholarship this year',
    description: 'search: student name, admission no., concession or scholarship name. sort: created_at, student.',
  })
  @ApiEnvelope(FeeAwardDto, { paginated: true })
  awards(@SchoolId() schoolId: number, @Query() query: AwardQueryDto) {
    return this.benefits.listAwards(schoolId, query);
  }

  @Post('benefit-awards')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FEES_ADJUST)
  @ResponseMessage('Given to the students')
  @ApiOperation({
    summary: 'Give a concession or scholarship to students',
    description:
      'Students must be studying this year, in a class it is open to. Students who already have it are skipped. It applies to invoices raised from now on.',
  })
  @ApiEnvelope(AwardResultDto, { message: 'Given to the students' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  award(@SchoolId() schoolId: number, @Body() dto: AwardInputDto, @CurrentUser() actor: AuthUser) {
    return this.benefits.award(schoolId, dto, actor);
  }

  @Post('benefit-awards/:id/revoke')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FEES_ADJUST)
  @ResponseMessage('Withdrawn')
  @ApiOperation({ summary: 'Withdraw it from a student. Invoices already raised keep their amounts.' })
  @ApiEnvelope(FeeAwardDto, { message: 'Withdrawn' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  revoke(
    @SchoolId() schoolId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RevokeAwardDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.benefits.revoke(schoolId, id, dto, actor);
  }
}
