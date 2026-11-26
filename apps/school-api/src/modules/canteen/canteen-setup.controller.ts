import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, RequirePermissions, ResponseMessage } from '@app/common';
import { ApiSchoolHeader, SchoolId } from '../../shared/school-context';
import { PERMISSIONS } from '../access/access.catalog';
import { CanteenSetupService } from './canteen-setup.service';
import {
  CanteenSettingsDto,
  CanteenSettingsInputDto,
  CounterDto,
  CounterInputDto,
  CounterQueryDto,
  CounterUpdateDto,
} from './dto/canteen-menu.dto';

const P = PERMISSIONS;

@ApiTags('Admin · Canteen setup')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/canteen')
export class CanteenSetupController {
  constructor(private readonly setup: CanteenSetupService) {}

  @Get('settings')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'Canteen timings, wallet rules, token prefix and tax' })
  @ApiEnvelope(CanteenSettingsDto)
  settings(@SchoolId() schoolId: number) {
    return this.setup.getSettings(schoolId);
  }

  @Put('settings')
  @RequirePermissions(P.CANTEEN_MANAGE)
  @ResponseMessage('Canteen settings saved')
  @ApiOperation({ summary: 'Change the canteen settings' })
  @ApiEnvelope(CanteenSettingsDto, { message: 'Canteen settings saved' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  updateSettings(@SchoolId() schoolId: number, @Body() dto: CanteenSettingsInputDto, @CurrentUser() actor: AuthUser) {
    return this.setup.updateSettings(schoolId, dto, actor);
  }

  @Get('counters')
  @RequirePermissions(P.CANTEEN_VIEW)
  @ApiOperation({ summary: 'Serving counters' })
  @ApiEnvelope(CounterDto, { paginated: true })
  counters(@SchoolId() schoolId: number, @Query() query: CounterQueryDto) {
    return this.setup.counters(schoolId, query);
  }

  @Post('counters')
  @RequirePermissions(P.CANTEEN_MANAGE)
  @ResponseMessage('Counter added')
  @ApiOperation({ summary: 'Add a counter' })
  @ApiEnvelope(CounterDto, { status: HttpStatus.CREATED, message: 'Counter added' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  createCounter(@SchoolId() schoolId: number, @Body() dto: CounterInputDto) {
    return this.setup.createCounter(schoolId, dto);
  }

  @Patch('counters/:id')
  @RequirePermissions(P.CANTEEN_MANAGE)
  @ResponseMessage('Counter updated')
  @ApiOperation({ summary: 'Rename, describe or deactivate a counter' })
  @ApiEnvelope(CounterDto, { message: 'Counter updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  updateCounter(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: CounterUpdateDto) {
    return this.setup.updateCounter(schoolId, id, dto);
  }

  @Delete('counters/:id')
  @RequirePermissions(P.CANTEEN_MANAGE)
  @ResponseMessage('Counter deleted')
  @ApiOperation({ summary: 'Delete a counter' })
  @ApiEnvelope(undefined, { message: 'Counter deleted' })
  @ApiErrors(HttpStatus.NOT_FOUND)
  async deleteCounter(@SchoolId() schoolId: number, @Param('id', ParseIntPipe) id: number) {
    await this.setup.deleteCounter(schoolId, id);
    return null;
  }
}
