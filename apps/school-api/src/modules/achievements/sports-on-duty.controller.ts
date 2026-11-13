import { Body, Controller, Delete, Get, HttpStatus, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import { SportsOnDutyService } from './sports-on-duty.service';
import {
  CreateSportsOnDutyDto,
  SportsOnDutyDto,
  SportsOnDutyQueryDto,
  UpdateSportsOnDutyDto,
} from './dto/sports-on-duty.dto';

@ApiTags('Admin · Sports and activities')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/sports-on-duty')
export class SportsOnDutyController {
  constructor(private readonly service: SportsOnDutyService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.STUDENTS_VIEW)
  @ApiOperation({ summary: 'List sports On Duty (OD) records' })
  @ApiEnvelope(SportsOnDutyDto, { isArray: true })
  list(@SchoolId() schoolId: number, @Query() query: SportsOnDutyQueryDto) {
    return this.service.list(schoolId, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  @ResponseMessage('Sports OD assigned')
  @ApiOperation({ summary: 'Assign students to sports On Duty (OD)' })
  @ApiEnvelope(SportsOnDutyDto, { isArray: true, status: HttpStatus.CREATED, message: 'Sports OD assigned' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  create(@SchoolId() schoolId: number, @Body() dto: CreateSportsOnDutyDto, @CurrentUser() actor: AuthUser) {
    return this.service.create(schoolId, dto, actor);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  @ResponseMessage('Sports OD updated')
  @ApiOperation({ summary: 'Update sports On Duty (OD) record' })
  @ApiEnvelope(SportsOnDutyDto, { message: 'Sports OD updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  update(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSportsOnDutyDto) {
    return this.service.update(schoolId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  @ResponseMessage('Sports OD removed')
  @ApiOperation({ summary: 'Cancel sports On Duty (OD) record' })
  async remove(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.service.remove(schoolId, id);
    return null;
  }
}
