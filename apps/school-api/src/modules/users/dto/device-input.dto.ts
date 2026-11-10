import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { CLIENT_APPS, ClientApp } from '../../access/entities/role.entity';
import { Platform, PLATFORMS } from '../entities/user-device.entity';

export class RegisterDeviceDto {
  @ApiPropertyOptional({
    example: '7c1e9f0a-2b3d-4e5f-8a9b-0c1d2e3f4a5b',
    description: 'Push id of this phone: the OneSignal subscription id (or the FCM token with PUSH_DRIVER=fcm)',
  })
  @ValidateIf((dto: { fcm_token?: string }) => !dto.fcm_token)
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  push_token?: string;

  @ApiPropertyOptional({ deprecated: true, description: 'Old name of push_token, still accepted' })
  @ValidateIf((dto: { push_token?: string }) => !dto.push_token)
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  fcm_token?: string;

  @ApiProperty({ enum: PLATFORMS, example: 'android' })
  @IsIn(PLATFORMS)
  platform: Platform;

  @ApiPropertyOptional({
    enum: CLIENT_APPS,
    example: 'parent',
    description: 'Which app section is open on this device',
  })
  @IsOptional()
  @IsIn(CLIENT_APPS)
  app?: ClientApp;

  @ApiPropertyOptional({ example: 'Pixel 7' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  device_name?: string;

  @ApiPropertyOptional({ example: '1.0.0+12' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  app_version?: string;
}

export class RemoveDeviceDto {
  @ApiPropertyOptional({
    example: '7c1e9f0a-2b3d-4e5f-8a9b-0c1d2e3f4a5b',
    description: 'Push id of this phone: the OneSignal subscription id (or the FCM token with PUSH_DRIVER=fcm)',
  })
  @ValidateIf((dto: { fcm_token?: string }) => !dto.fcm_token)
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  push_token?: string;

  @ApiPropertyOptional({ deprecated: true, description: 'Old name of push_token, still accepted' })
  @ValidateIf((dto: { push_token?: string }) => !dto.push_token)
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  fcm_token?: string;
}

export const deviceToken = (dto: { push_token?: string; fcm_token?: string }): string =>
  dto.push_token ?? dto.fcm_token ?? '';
