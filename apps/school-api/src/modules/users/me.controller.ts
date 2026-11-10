import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, AuthUser, CurrentUser, ResponseMessage } from '@app/common';
import { deviceToken, RegisterDeviceDto, RemoveDeviceDto } from './dto/device-input.dto';
import { UpdateMeDto } from './dto/user-input.dto';
import { UserProfileDto } from './dto/user-response.dto';
import { UserDevicesService } from './user-devices.service';
import { UsersService } from './users.service';

@ApiTags('Me')
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED)
@Controller('me')
export class MeController {
  constructor(
    private readonly users: UsersService,
    private readonly devices: UserDevicesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Signed-in user with roles, apps and permissions. Call on app start.' })
  @ApiEnvelope(UserProfileDto)
  me(@CurrentUser() user: AuthUser) {
    return this.users.profile(user.id);
  }

  @Patch()
  @ResponseMessage('Profile updated')
  @ApiOperation({ summary: 'Update own name, email or language' })
  @ApiEnvelope(UserProfileDto, { message: 'Profile updated' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    return this.users.updateMe(user.id, dto);
  }

  @Post('devices')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Device registered')
  @ApiOperation({
    summary: 'Register or refresh this device for push notifications',
    description: 'Call after login and whenever Firebase gives a new token. Safe to call repeatedly.',
  })
  @ApiEnvelope(undefined, { message: 'Device registered' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  async registerDevice(@CurrentUser() user: AuthUser, @Body() dto: RegisterDeviceDto) {
    await this.devices.register(user.id, user.session_id, dto);
    return null;
  }

  @Delete('devices')
  @ResponseMessage('Device removed')
  @ApiOperation({ summary: 'Stop push notifications to this device' })
  @ApiEnvelope(undefined, { message: 'Device removed' })
  async removeDevice(@CurrentUser() user: AuthUser, @Query() dto: RemoveDeviceDto) {
    await this.devices.remove(user.id, deviceToken(dto));
    return null;
  }
}
