import { Body, Controller, Delete, Get, HttpStatus, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import { BulkUpdateKraConfigDto, CreateKraConfigDto, KraConfigDto, UpdateKraConfigDto } from './dto/kra-config.dto';
import { KraConfigService } from './kra-config.service';

@ApiTags('Admin · Staff KRA Configuration')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/staff-kra-configs')
export class KraConfigController {
  constructor(private readonly kraService: KraConfigService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.STAFF_VIEW)
  @ApiOperation({ summary: 'List active KRA configurations for school' })
  @ApiEnvelope(KraConfigDto, { isArray: true })
  list(@SchoolId() schoolId: number) {
    return this.kraService.list(schoolId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  @ResponseMessage('KRA configuration created')
  @ApiOperation({ summary: 'Create a new KRA configuration dimension' })
  @ApiEnvelope(KraConfigDto, { status: HttpStatus.CREATED, message: 'KRA configuration created' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  create(@SchoolId() schoolId: number, @Body() dto: CreateKraConfigDto) {
    return this.kraService.create(schoolId, dto);
  }

  @Put('bulk')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  @ResponseMessage('KRA configurations updated')
  @ApiOperation({ summary: 'Bulk update KRA weights and active states' })
  @ApiEnvelope(KraConfigDto, { isArray: true, message: 'KRA configurations updated' })
  bulkUpdate(@SchoolId() schoolId: number, @Body() dto: BulkUpdateKraConfigDto) {
    return this.kraService.bulkUpdate(schoolId, dto);
  }

  @Put(':id')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  @ResponseMessage('KRA configuration updated')
  @ApiOperation({ summary: 'Update a KRA configuration' })
  @ApiEnvelope(KraConfigDto, { message: 'KRA configuration updated' })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.BAD_REQUEST)
  update(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateKraConfigDto) {
    return this.kraService.update(schoolId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  @ResponseMessage('KRA configuration deactivated')
  @ApiOperation({ summary: 'Deactivate a KRA configuration' })
  @ApiEnvelope(Boolean, { message: 'KRA configuration deactivated' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  async delete(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.kraService.delete(schoolId, id);
    return true;
  }

  @Post('reset-defaults')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  @ResponseMessage('KRA configurations reset to standard school template')
  @ApiOperation({ summary: 'Reset school KRAs to default balanced 5-dimension template' })
  @ApiEnvelope(KraConfigDto, { isArray: true, message: 'KRAs reset to default template' })
  resetDefaults(@SchoolId() schoolId: number) {
    return this.kraService.resetDefaults(schoolId);
  }
}
