import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppException, AuthUser } from '@app/common';
import { maskMobile } from '../../shared/mobile';
import { AccessService } from '../access/access.service';
import { canOpen, ClientApp } from '../access/entities/role.entity';
import { UserDevicesService } from '../users/user-devices.service';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { LoginResponseDto, OtpSentDto, RequestOtpDto, TokenPairDto, VerifyOtpDto } from './dto/auth.dto';
import {
  CENTRAL_OTP_TTL_SECONDS,
  CENTRAL_RESEND_SECONDS,
  CentralAuthClient,
  CentralTokens,
  CentralUserMissing,
} from './central-auth.client';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly users: UsersService,
    private readonly devices: UserDevicesService,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly central: CentralAuthClient,
    private readonly access: AccessService,
  ) {}

  requestOtp(dto: RequestOtpDto, meta: RequestMeta): Promise<OtpSentDto> {
    return this.sendOtp(dto, meta, false);
  }

  resendOtp(dto: RequestOtpDto, meta: RequestMeta): Promise<OtpSentDto> {
    return this.sendOtp(dto, meta, true);
  }

  private async sendOtp(dto: RequestOtpDto, meta: RequestMeta, resend: boolean): Promise<OtpSentDto> {
    const user = await this.activeUser(dto.mobile);
    if (dto.app) await this.assertApp(user, dto.app);
    const appHash = dto.app_hash ?? dto.app_signature ?? null;
    if (!this.central.enabled) return this.otp.issue(dto.mobile, meta.ip, appHash ?? undefined, user.name);
    try {
      if (resend) await this.central.resendOtp(user.mobile, appHash);
      else await this.central.sendOtp(user.mobile, appHash);
    } catch (error) {
      if (!(error instanceof CentralUserMissing)) throw error;
      await this.registerCentral(user);
      await this.central.sendOtp(user.mobile, appHash);
    }
    return {
      mobile_masked: maskMobile(user.mobile),
      expires_in: CENTRAL_OTP_TTL_SECONDS,
      resend_in: CENTRAL_RESEND_SECONDS,
      otp_length: 6,
    };
  }

  async verifyOtp(dto: VerifyOtpDto, meta: RequestMeta): Promise<LoginResponseDto> {
    const user = await this.activeUser(dto.mobile);
    await this.assertApp(user, dto.client.app);
    let central: CentralTokens | null = null;
    if (this.central.enabled) {
      const login = await this.central.verifyOtp(user.mobile, dto.otp).catch((error: unknown) => {
        if (error instanceof CentralUserMissing) {
          throw AppException.unauthorized('This code has expired. Ask for a new OTP.', 'OTP_EXPIRED');
        }
        throw error;
      });
      if (!user.auth_user_id && login.user?.id !== undefined) {
        await this.userRepo.update(user.id, { auth_user_id: String(login.user.id) });
      }
      central = { accessToken: login.accessToken, refreshToken: login.refreshToken };
    } else {
      await this.otp.verify(dto.mobile, dto.otp);
    }

    const client = dto.client;
    const { session_id: sessionId, ...pair } = await this.tokens.issue(
      user,
      {
        app: client.app,
        platform: client.platform,
        device_name: client.device_name,
        ip: meta.ip,
        user_agent: meta.userAgent,
      },
      central,
    );
    await this.userRepo.update(user.id, { last_login_at: new Date() });
    const pushToken = client.push_token ?? client.fcm_token;
    if (pushToken && client.platform) {
      await this.devices.register(user.id, sessionId, {
        push_token: pushToken,
        platform: client.platform,
        app: client.app,
        device_name: client.device_name,
        app_version: client.app_version,
      });
    }
    return { ...pair, user: await this.users.profile(user.id) };
  }

  refresh(refreshToken: string): Promise<TokenPairDto> {
    return this.tokens.rotate(refreshToken, (userId) => this.userRepo.findOneBy({ id: userId }));
  }

  async logout(user: AuthUser): Promise<void> {
    await this.tokens.endCentral(user.session_id);
    await this.tokens.revoke(user.session_id);
    await this.devices.removeForSession(user.session_id);
  }

  private async assertApp(user: User, app: ClientApp): Promise<void> {
    const access = await this.access.load(user.id);
    if (access && canOpen(app, access.apps)) return;
    throw AppException.forbidden(
      app === 'admin'
        ? 'This number cannot sign in to the admin web. Use the mobile app.'
        : 'This number has no Parent, Staff or Driver access. Contact the school office.',
      'APP_NOT_ALLOWED',
    );
  }

  private async registerCentral(user: User): Promise<void> {
    const access = await this.access.load(user.id);
    const created = await this.central.register({
      name: user.name,
      mobile: user.mobile,
      email: user.email,
      roles: access?.roles.map((role) => role.code) ?? [],
    });
    await this.userRepo.update(user.id, {
      auth_registered_at: new Date(),
      ...(created?.id !== undefined ? { auth_user_id: String(created.id) } : {}),
    });
    this.logger.log(`User ${user.id} registered in the Auth Service on first sign-in`);
  }

  private async activeUser(mobile: string): Promise<User> {
    const user = await this.users.findActiveByMobile(mobile);
    if (!user) {
      throw AppException.notFound(
        'This mobile number is not registered. Contact the school office.',
        'MOBILE_NOT_REGISTERED',
      );
    }
    if (user.status !== 'active') {
      throw AppException.forbidden('Your account is not active. Contact the school office.', 'ACCOUNT_INACTIVE');
    }
    return user;
  }
}
