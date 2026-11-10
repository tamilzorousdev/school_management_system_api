import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { deviceToken, RegisterDeviceDto } from './dto/device-input.dto';
import { UserDevice } from './entities/user-device.entity';

@Injectable()
export class UserDevicesService {
  constructor(@InjectRepository(UserDevice) private readonly devices: Repository<UserDevice>) {}

  async register(userId: number, sessionId: number | null, dto: RegisterDeviceDto): Promise<UserDevice> {
    const token = deviceToken(dto);
    const existing = await this.devices.findOneBy({ fcm_token: token });
    const device = this.devices.merge(existing ?? this.devices.create(), {
      user_id: userId,
      session_id: sessionId,
      fcm_token: token,
      platform: dto.platform,
      app: dto.app ?? null,
      device_name: dto.device_name ?? null,
      app_version: dto.app_version ?? null,
      last_seen_at: new Date(),
    });
    return this.devices.save(device);
  }

  async remove(userId: number, fcmToken: string): Promise<void> {
    await this.devices.delete({ user_id: userId, fcm_token: fcmToken });
  }

  async removeForSession(sessionId: number): Promise<void> {
    await this.devices.delete({ session_id: sessionId });
  }

  tokensFor(userId: number): Promise<UserDevice[]> {
    return this.devices.find({ where: { user_id: userId }, order: { last_seen_at: 'DESC' }, take: 10 });
  }

  async removeTokens(tokens: string[]): Promise<void> {
    if (tokens.length) await this.devices.delete({ fcm_token: In(tokens) });
  }
}
