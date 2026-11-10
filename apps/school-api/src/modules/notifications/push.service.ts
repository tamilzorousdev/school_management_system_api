import { Inject, Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'fs';
import { App, cert, initializeApp, ServiceAccount } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { pushConfig, PushConfig } from '../../config/configuration';
import { KAFKA_PUSH_TEMPLATE, KafkaNotifyService } from '../sms/kafka-notify.service';

export interface PushMessage {
  tokens: string[];
  title: string;
  body: string;
  data: Record<string, string>;
  userId?: number;
  variables?: Record<string, string>;
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
    await this.kafka.sendPush({
      templateId: this.kafka.templateId(KAFKA_PUSH_TEMPLATE),
      variables: { ...(message.variables ?? {}), ...message.data, title: message.title, body: message.body },
      externalIds: [String(message.userId)],
      playerIds: message.tokens,
    });
    return { status: 'sent', provider: 'kafka', successCount: 1, invalidTokens: [] };
  }

  private async sendFcm(message: PushMessage): Promise<PushResult> {
    const response = await getMessaging(this.firebase()).sendEachForMulticast({
      tokens: message.tokens,
      notification: { title: message.title, body: message.body },
      data: message.data,
      android: { priority: 'high', notification: { sound: 'default' } },
      apns: { payload: { aps: { sound: 'default' } } },
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

  private async sendOneSignal(message: PushMessage): Promise<PushResult> {
    if (!this.config.oneSignalAppId || !this.config.oneSignalApiKey) {
      return {
        status: 'failed',
        provider: 'onesignal',
        successCount: 0,
        invalidTokens: [],
        error: 'OneSignal App ID or REST API Key is missing in .env',
      };
    }

    const payload = {
      app_id: this.config.oneSignalAppId,
      include_subscription_ids: message.tokens,
      headings: { en: message.title },
      contents: { en: message.body },
      data: message.data,
    };

    const response = await fetch('https://api.onesignal.com/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Key ${this.config.oneSignalApiKey}`,
      },
      body: JSON.stringify(payload),
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
      throw new Error(errMsg);
    }

    const recipients = resJson.recipients ?? (resJson.id ? message.tokens.length : 0);
    return {
      status: recipients > 0 ? 'sent' : 'failed',
      provider: 'onesignal',
      successCount: recipients,
      invalidTokens: resJson.invalid_player_ids ?? [],
    };
  }

  private firebase(): App {
    if (this.app) return this.app;
    const account = JSON.parse(readFileSync(this.config.credentialsFile, 'utf8')) as ServiceAccount;
    this.app = initializeApp({ credential: cert(account) }, 'school-api');
    this.logger.log('Firebase messaging ready');
    return this.app;
  }
}
