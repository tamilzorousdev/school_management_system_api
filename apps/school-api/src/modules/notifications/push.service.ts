import { Inject, Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'fs';
import { App, cert, initializeApp, ServiceAccount } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { pushConfig, PushConfig } from '../../config/configuration';
import { KAFKA_CALL_TEMPLATE, KAFKA_PUSH_TEMPLATE, KafkaNotifyService } from '../sms/kafka-notify.service';

export interface PushTarget {
  token: string;
  oneSignalAppId: string | null;
}

export interface PushMessage {
  tokens: string[];
  targets?: PushTarget[];
  title: string;
  body: string;
  data: Record<string, string>;
  userId?: number;
  variables?: Record<string, string>;
  ttlSeconds?: number;
}

export interface DataPushMessage {
  userId: number;
  tokens: string[];
  targets?: PushTarget[];
  data: Record<string, string>;
  ttlSeconds: number;
}

export interface PushResult {
  status: 'sent' | 'failed' | 'skipped';
  provider: string;
  successCount: number;
  invalidTokens: string[];
  error?: string;
}

const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

@Injectable()
export class PushService {
  private readonly logger = new Logger('Push');
  private app?: App;

  constructor(
    @Inject(pushConfig.KEY) private readonly config: PushConfig,
    private readonly kafka: KafkaNotifyService,
  ) {}

  get enabled(): boolean {
    return this.config.driver !== 'off';
  }

  async send(message: PushMessage): Promise<PushResult> {
    if (!this.enabled) {
      return {
        status: 'skipped',
        provider: 'off',
        successCount: 0,
        invalidTokens: [],
        error: 'Push is turned off (PUSH_DRIVER=off)',
      };
    }
    if (this.config.driver === 'kafka') return this.sendKafka(message);
    if (!message.tokens.length) {
      return {
        status: 'skipped',
        provider: this.config.driver,
        successCount: 0,
        invalidTokens: [],
        error: 'No registered device for this user',
      };
    }

    if (this.config.driver === 'onesignal') {
      return this.sendOneSignal(message);
    }
    return this.sendFcm(message);
  }

  async sendData(message: DataPushMessage): Promise<PushResult> {
    const driver = this.config.callDriver;
    if (driver === 'off') {
      return { status: 'skipped', provider: 'off', successCount: 0, invalidTokens: [], error: 'Call push is off' };
    }
    if (!message.tokens.length) {
      return {
        status: 'skipped',
        provider: driver,
        successCount: 0,
        invalidTokens: [],
        error: 'No phone is registered for this side of the call',
      };
    }
    if (driver === 'kafka') {
      await this.kafka.sendPush({
        templateId: this.kafka.templateId(KAFKA_CALL_TEMPLATE),
        variables: message.data,
        externalIds: [],
        playerIds: message.tokens,
        dataOnly: { data: message.data, ttlSeconds: message.ttlSeconds },
      });
      return { status: 'sent', provider: 'kafka', successCount: 1, invalidTokens: [] };
    }
    if (driver === 'onesignal') return this.sendOneSignalData(message);
    const response = await getMessaging(this.firebase()).sendEachForMulticast({
      tokens: message.tokens,
      data: message.data,
      android: { priority: 'high', ttl: message.ttlSeconds * 1000 },
      apns: {
        headers: { 'apns-priority': '10', 'apns-push-type': 'background' },
        payload: { aps: { contentAvailable: true } },
      },
    });
    const invalidTokens = response.responses
      .map((result, index) =>
        !result.success && result.error && INVALID_TOKEN_CODES.has(result.error.code) ? message.tokens[index] : null,
      )
      .filter((token): token is string => token !== null);
    return {
      status: response.successCount > 0 ? 'sent' : 'failed',
      provider: 'fcm',
      successCount: response.successCount,
      invalidTokens,
    };
  }

  private async sendOneSignalData(message: DataPushMessage): Promise<PushResult> {
    const groups = this.oneSignalGroups(message.tokens, message.targets);
    if (!groups.size) {
      return {
        status: 'failed',
        provider: 'onesignal',
        successCount: 0,
        invalidTokens: [],
        error: 'No OneSignal app is configured for any of these devices',
      };
    }

    let sent = 0;
    let notSubscribed = 0;
    const errors: string[] = [];
    for (const [appId, tokens] of groups) {
      const apiKey = this.oneSignalKey(appId);
      if (!apiKey) {
        errors.push(`${appId}: No REST API key configured for this OneSignal app`);
        continue;
      }
      const response = await fetch('https://api.onesignal.com/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Key ${apiKey}` },
        body: JSON.stringify({
          app_id: appId,
          target_channel: 'push',
          include_subscription_ids: tokens,
          data: message.data,
          content_available: true,
          priority: 10,
          ttl: message.ttlSeconds,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { id?: string; errors?: unknown };
      if (response.ok && body.id) {
        sent += 1;
        continue;
      }
      if (response.ok && JSON.stringify(body.errors ?? '').includes('not subscribed')) {
        notSubscribed += 1;
        continue;
      }
      errors.push(`${appId}: OneSignal error (${response.status}): ${JSON.stringify(body.errors ?? body)}`);
    }

    if (sent > 0) return { status: 'sent', provider: 'onesignal', successCount: sent, invalidTokens: [] };
    if (errors.length) throw new Error(errors.join(' | '));
    if (notSubscribed > 0) {
      return {
        status: 'skipped',
        provider: 'onesignal',
        successCount: 0,
        invalidTokens: [],
        error: 'The phone is not subscribed to push in OneSignal',
      };
    }
    return { status: 'failed', provider: 'onesignal', successCount: 0, invalidTokens: [] };
  }

  private async sendKafka(message: PushMessage): Promise<PushResult> {
    if (!message.userId) {
      return {
        status: 'skipped',
        provider: 'kafka',
        successCount: 0,
        invalidTokens: [],
        error: 'No user for this push',
      };
    }
    const variables = {
      ...(message.variables ?? {}),
      ...message.data,
      title: message.title,
      body: message.body,
      ...(message.ttlSeconds ? { ttl_seconds: String(message.ttlSeconds) } : {}),
    };
    const groups = this.oneSignalGroups(message.tokens, message.targets);
    if (!groups.size) {
      await this.kafka.sendPush({
        templateId: this.kafka.templateId(KAFKA_PUSH_TEMPLATE),
        variables,
        externalIds: [String(message.userId)],
        playerIds: message.tokens,
      });
      return { status: 'sent', provider: 'kafka', successCount: 1, invalidTokens: [] };
    }
    for (const [appId, tokens] of groups) {
      await this.kafka.sendPush({
        templateId: this.kafka.templateId(KAFKA_PUSH_TEMPLATE),
        variables,
        externalIds: [String(message.userId)],
        playerIds: tokens,
        oneSignalAppId: appId,
      });
    }
    return { status: 'sent', provider: 'kafka', successCount: groups.size, invalidTokens: [] };
  }

  private async sendFcm(message: PushMessage): Promise<PushResult> {
    const response = await getMessaging(this.firebase()).sendEachForMulticast({
      tokens: message.tokens,
      notification: { title: message.title, body: message.body },
      data: message.data,
      android: {
        priority: 'high',
        notification: { sound: 'default' },
        ...(message.ttlSeconds ? { ttl: message.ttlSeconds * 1000 } : {}),
      },
      apns: {
        payload: { aps: { sound: 'default' } },
        ...(message.ttlSeconds
          ? { headers: { 'apns-expiration': String(Math.floor(Date.now() / 1000) + message.ttlSeconds) } }
          : {}),
      },
    });

    const invalidTokens: string[] = [];
    const errors: string[] = [];
    response.responses.forEach((result, index) => {
      if (result.success || !result.error) return;
      if (INVALID_TOKEN_CODES.has(result.error.code)) invalidTokens.push(message.tokens[index]);
      else errors.push(result.error.message);
    });

    if (response.successCount > 0) {
      return { status: 'sent', provider: 'fcm', successCount: response.successCount, invalidTokens };
    }
    if (errors.length) throw new Error(errors[0]);
    return {
      status: 'failed',
      provider: 'fcm',
      successCount: 0,
      invalidTokens,
      error: 'Every device token was invalid',
    };
  }

  private oneSignalGroups(tokens: string[], targets?: PushTarget[]): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    const appIdOf = new Map((targets ?? []).map((target) => [target.token, target.oneSignalAppId]));
    for (const token of tokens) {
      const appId = appIdOf.get(token) || this.config.oneSignalAppId;
      if (!appId) continue;
      const group = groups.get(appId);
      if (group) group.push(token);
      else groups.set(appId, [token]);
    }
    return groups;
  }

  private oneSignalKey(appId: string): string {
    return this.config.oneSignalApps[appId] ?? '';
  }

  private async postOneSignal(
    appId: string,
    body: Record<string, unknown>,
  ): Promise<{ recipients: number; invalidTokens: string[]; error?: string }> {
    const apiKey = this.oneSignalKey(appId);
    if (!apiKey) {
      return { recipients: 0, invalidTokens: [], error: `No REST API key configured for OneSignal app ${appId}` };
    }
    const response = await fetch('https://api.onesignal.com/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Key ${apiKey}` },
      body: JSON.stringify({ app_id: appId, ...body }),
    });
    const resJson = (await response.json().catch(() => ({}))) as {
      id?: string;
      recipients?: number;
      errors?: string[] | Record<string, unknown>;
      invalid_player_ids?: string[];
    };
    if (!response.ok && !resJson.recipients) {
      const errMsg = Array.isArray(resJson.errors)
        ? resJson.errors.join(', ')
        : typeof resJson.errors === 'object'
          ? JSON.stringify(resJson.errors)
          : `OneSignal error (${response.status})`;
      return { recipients: 0, invalidTokens: resJson.invalid_player_ids ?? [], error: errMsg };
    }
    const sentTo = (body.include_subscription_ids as string[] | undefined)?.length ?? 0;
    return {
      recipients: resJson.recipients ?? (resJson.id ? sentTo : 0),
      invalidTokens: resJson.invalid_player_ids ?? [],
    };
  }

  private async fanOutOneSignal(
    tokens: string[],
    targets: PushTarget[] | undefined,
    body: (groupTokens: string[]) => Record<string, unknown>,
  ): Promise<PushResult> {
    const groups = this.oneSignalGroups(tokens, targets);
    if (!groups.size) {
      return {
        status: 'failed',
        provider: 'onesignal',
        successCount: 0,
        invalidTokens: [],
        error: 'No OneSignal app is configured for any of these devices',
      };
    }

    let successCount = 0;
    const invalidTokens: string[] = [];
    const errors: string[] = [];
    for (const [appId, groupTokens] of groups) {
      const result = await this.postOneSignal(appId, body(groupTokens));
      successCount += result.recipients;
      invalidTokens.push(...result.invalidTokens);
      if (result.error) errors.push(`${appId}: ${result.error}`);
    }

    if (successCount > 0) {
      return { status: 'sent', provider: 'onesignal', successCount, invalidTokens };
    }
    if (errors.length) throw new Error(errors.join(' | '));
    return { status: 'failed', provider: 'onesignal', successCount: 0, invalidTokens };
  }

  private sendOneSignal(message: PushMessage): Promise<PushResult> {
    return this.fanOutOneSignal(message.tokens, message.targets, (tokens) => ({
      include_subscription_ids: tokens,
      headings: { en: message.title },
      contents: { en: message.body },
      data: message.data,
      ...(message.ttlSeconds ? { ttl: message.ttlSeconds } : {}),
    }));
  }

  private firebase(): App {
    if (this.app) return this.app;
    const account = JSON.parse(readFileSync(this.config.credentialsFile, 'utf8')) as ServiceAccount;
    this.app = initializeApp({ credential: cert(account) }, 'school-api');
    this.logger.log('Firebase messaging ready');
    return this.app;
  }
}
