import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppException } from '@app/common';
import { centralAuthConfig, CentralAuthConfig } from '../../config/configuration';
import { maskMobile } from '../../shared/mobile';
import { ROLES } from '../access/access.catalog';

export const CENTRAL_ROLES = ['SUPER_ADMIN', 'TENANT', 'TECHNICIAN'] as const;
export type CentralRole = (typeof CENTRAL_ROLES)[number];

export const CENTRAL_OTP_TTL_SECONDS = 15 * 60;
export const CENTRAL_RESEND_SECONDS = 30;

interface CentralEnvelope<T> {
  success?: boolean;
  statusCode?: number;
  message?: string | string[];
  data?: T;
}

export interface CentralUser {
  id: string | number;
  email?: string | null;
  mobile?: string | null;
  name?: string | null;
  role?: string | null;
}

export interface CentralLogin {
  accessToken: string;
  refreshToken: string;
  user: CentralUser;
}

export interface CentralTokens {
  accessToken: string;
  refreshToken: string;
}

export interface CentralRegistration {
  name: string;
  mobile: string;
  email: string | null;
  roles: string[];
}

export function centralRole(roles: string[]): CentralRole {
  return roles.includes(ROLES.SUPER_ADMIN) || roles.includes(ROLES.ADMIN) ? 'TENANT' : 'TECHNICIAN';
}

export function authEmail(name: string, mobile: string, domain: string, withFullMobile = false): string {
  const slug =
    name
      .normalize('NFKD')
      .replace(/[^\x00-\x7F]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^\.+|\.+$/g, '')
      .slice(0, 40) || 'user';
  return `${slug}.${withFullMobile ? mobile : mobile.slice(-4)}@${domain}`;
}

export function centralMessage(body: CentralEnvelope<unknown> | null): string {
  const message = body?.message;
  return (Array.isArray(message) ? message.join('; ') : message) ?? '';
}

export function mapCentralError(status: number, message: string): AppException {
  const text = message.toLowerCase();
  const wait = /wait (\d+) second/.exec(text);
  if (wait) {
    return AppException.tooManyRequests(`Wait ${wait[1]} seconds before requesting a new OTP`, 'OTP_RESEND_TOO_SOON');
  }
  if (text.includes('maximum otp attempts') || text.includes('locked')) {
    return AppException.tooManyRequests('Too many wrong codes. Ask for a new OTP.', 'OTP_ATTEMPTS_EXCEEDED');
  }
  if (text.includes('expired') || text.includes('otp not found')) {
    return AppException.unauthorized('This code has expired. Ask for a new OTP.', 'OTP_EXPIRED');
  }
  if (text.includes('invalid otp') || text.includes('invalid credentials') || text.includes('incorrect')) {
    return AppException.unauthorized('Wrong code. Check the SMS and try again.', 'OTP_INVALID');
  }
  if (status === 429) {
    return AppException.tooManyRequests('Too many OTP requests. Try again in a few minutes.', 'OTP_RATE_LIMITED');
  }
  return AppException.unavailable(
    'Sign-in is not available right now. Try again in a minute.',
    'AUTH_SERVICE_UNAVAILABLE',
  );
}

export type OtpPath = 'send-otp' | 'resend-otp';

export function otpPayload(mobile: string, appHash?: string | null): { mobile: string; app_hash?: string } {
  return appHash ? { mobile, app_hash: appHash } : { mobile };
}

const SECRET_KEYS = /otp|code|token|secret|password|hash/i;

function withoutSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSecrets);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SECRET_KEYS.test(key) ? '***' : withoutSecrets(item),
    ]),
  );
}

export function otpSendSummary(status: number, body: CentralEnvelope<unknown> | null): string {
  const data = body?.data === undefined ? '' : ` data=${JSON.stringify(withoutSecrets(body.data))}`;
  const text = `HTTP ${status}, "${centralMessage(body) || 'no message'}"${data}`;
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

export function appHashRejected(status: number, body: CentralEnvelope<unknown> | null): boolean {
  return status === 400 && centralMessage(body).toLowerCase().includes('app_hash should not exist');
}

export class CentralUserMissing extends Error {}

export class CentralSessionEnded extends Error {}

@Injectable()
export class CentralAuthClient {
  private readonly logger = new Logger('CentralAuth');

  constructor(@Inject(centralAuthConfig.KEY) private readonly config: CentralAuthConfig) {}

  get enabled(): boolean {
    return this.config.provider === 'central' && !this.config.otpTest;
  }

  sendOtp(mobile: string, appHash?: string | null): Promise<void> {
    return this.otp('send-otp', mobile, appHash);
  }

  resendOtp(mobile: string, appHash?: string | null): Promise<void> {
    return this.otp('resend-otp', mobile, appHash);
  }

  private async otp(path: OtpPath, mobile: string, appHash?: string | null): Promise<void> {
    let { status, body } = await this.post(path, otpPayload(mobile, appHash));
    if (appHash && appHashRejected(status, body)) {
      this.logger.warn(`${path} does not accept app_hash yet; sent without it`);
      ({ status, body } = await this.post(path, otpPayload(mobile)));
    }
    const tenant = this.config.tenantId || 'default';
    if (status >= 200 && status < 300) {
      this.logger.log(
        `${path} accepted for ${maskMobile(mobile)} (tenant ${tenant}). The Auth Service sends the SMS through the Notification Service (Kafka); its reply: ${otpSendSummary(status, body)}`,
      );
      return;
    }
    this.logger.warn(`${path} refused for ${maskMobile(mobile)} (tenant ${tenant}): ${otpSendSummary(status, body)}`);
    const message = centralMessage(body);
    if (message.toLowerCase().includes('user not found')) throw new CentralUserMissing(mobile);
    throw mapCentralError(status, message);
  }

  async verifyOtp(mobile: string, otp: string): Promise<CentralLogin> {
    const { status, body } = await this.post<CentralLogin>('verify-otp', { mobile, otp });
    if (status >= 200 && status < 300 && body?.data?.accessToken) return body.data;
    const message = centralMessage(body);
    if (message.toLowerCase().includes('user not found')) throw new CentralUserMissing(mobile);
    throw mapCentralError(status, message);
  }

  async refresh(refreshToken: string): Promise<CentralTokens> {
    const { status, body } = await this.post<CentralTokens>('refresh', { refreshToken });
    if (status >= 200 && status < 300 && body?.data?.accessToken && body.data.refreshToken) {
      return { accessToken: body.data.accessToken, refreshToken: body.data.refreshToken };
    }
    if (status === 400 || status === 401 || status === 403) throw new CentralSessionEnded();
    throw AppException.unavailable(
      'Sign-in is not available right now. Try again in a minute.',
      'AUTH_SERVICE_UNAVAILABLE',
    );
  }

  async logout(accessToken: string): Promise<boolean> {
    const { status } = await this.post('logout', {}, { authorization: `Bearer ${accessToken}` });
    return status >= 200 && status < 300;
  }

  async register(input: CentralRegistration): Promise<CentralUser | null> {
    const emails = input.email
      ? [input.email, authEmail(input.name, input.mobile, this.config.emailDomain, true)]
      : [
          authEmail(input.name, input.mobile, this.config.emailDomain),
          authEmail(input.name, input.mobile, this.config.emailDomain, true),
        ];
    for (const email of emails) {
      const { status, body } = await this.post<CentralUser>('register', {
        email,
        mobile: input.mobile,
        name: input.name,
        role: centralRole(input.roles),
        ...(this.config.tenantId ? { tenantId: this.config.tenantId } : {}),
      });
      if (status >= 200 && status < 300) {
        this.logger.log(`Registered ${input.mobile} in the Auth Service as ${email}`);
        return body?.data ?? null;
      }
      if (status === 409) {
        this.logger.warn(`Register ${input.mobile} with ${email}: ${centralMessage(body)}`);
        continue;
      }
      throw mapCentralError(status, centralMessage(body));
    }
    return null;
  }

  private async post<T>(
    path: string,
    payload: object,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: CentralEnvelope<T> | null }> {
    let response: Response;
    try {
      response = await fetch(`${this.config.url}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      this.logger.warn(`POST ${path} failed: ${(error as Error).message}`);
      throw AppException.unavailable(
        'Sign-in is not available right now. Try again in a minute.',
        'AUTH_SERVICE_UNAVAILABLE',
      );
    }
    const body = (await response.json().catch(() => null)) as CentralEnvelope<T> | null;
    if (response.status >= 500) {
      this.logger.warn(`POST ${path} returned ${response.status}: ${centralMessage(body)}`);
    }
    return { status: response.status, body };
  }
}
