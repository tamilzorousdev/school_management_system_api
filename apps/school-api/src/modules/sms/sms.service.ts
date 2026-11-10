import { Inject, Injectable, Logger } from '@nestjs/common';
import { smsConfig, SmsConfig } from '../../config/configuration';
import { Language } from '../users/entities/user.entity';
import { KAFKA_OTP_TEMPLATE, KafkaNotifyService, KafkaSendInput } from './kafka-notify.service';

export interface SmsResult {
  status: 'sent' | 'failed' | 'skipped';
  provider: string;
  providerRef?: string;
  error?: string;
}

export interface SmsMessage {
  mobile: string;
  text: string;
  dltTemplateId: string | null;
  templateCode?: string | null;
  variables?: Record<string, string>;
  language?: Language;
}

export interface OtpSms {
  mobile: string;
  otp: string;
  expiryMinutes: number;
  name?: string;
  appSignature?: string;
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger('SMS');

  constructor(
    @Inject(smsConfig.KEY) private readonly config: SmsConfig,
    private readonly kafka: KafkaNotifyService,
  ) {}

  otpText(otp: string, appSignature?: string): string {
    return `Your OTP for verification is ${otp}. Please enter this code within 10 minutes. Do not share this with anyone. -TAMILZOROUS ${appSignature ?? ''}`;
  }

  sendOtp(input: OtpSms): Promise<SmsResult> {
    if (this.config.otpDriver === 'kafka') {
      return this.viaKafka({
        channel: 'sms',
        to: input.mobile,
        templateId: KAFKA_OTP_TEMPLATE,
        variables: {
          otp: input.otp,
          expiry: `${input.expiryMinutes} minutes`,
          name: input.name ?? '',
          mobile: input.mobile,
          app_hash: input.appSignature ?? '',
          ...(input.appSignature ? { app_signature: input.appSignature } : {}),
        },
      });
    }
    return this.ping4sms({
      mobile: input.mobile,
      text: this.otpText(input.otp, input.appSignature),
      dltTemplateId: this.config.pingOtpTemplateId,
    });
  }

  async send(message: SmsMessage): Promise<SmsResult> {
    if (this.config.driver === 'log') {
      this.logger.log(`[log mode] to ${message.mobile}: ${message.text}`);
      return { status: 'skipped', provider: 'log', error: 'SMS_DRIVER is log, so no SMS was sent' };
    }
    if (this.config.driver === 'kafka') {
      if (!message.templateCode) {
        return { status: 'skipped', provider: 'kafka', error: 'No template code for this message' };
      }
      return this.viaKafka({
        channel: 'sms',
        to: message.mobile,
        templateId: this.kafka.templateId(message.templateCode, message.language),
        variables: message.variables ?? {},
      });
    }
    if (!message.dltTemplateId) {
      return { status: 'skipped', provider: 'ping4sms', error: 'No DLT template id for this message yet' };
    }
    return this.ping4sms(message);
  }

  private async viaKafka(input: KafkaSendInput): Promise<SmsResult> {
    try {
      const published = await this.kafka.send(input);
      return { status: 'sent', provider: 'kafka', providerRef: `${this.kafka.topic}:${published.templateId}` };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Kafka SMS ${input.templateId} for ${input.to} failed: ${reason}`);
      return { status: 'failed', provider: 'kafka', error: reason };
    }
  }

  private async ping4sms(message: SmsMessage): Promise<SmsResult> {
    const params = new URLSearchParams({
      key: this.config.pingApiKey,
      route: this.config.pingRoute,
      sender: this.config.pingSender,
      number: message.mobile,
      sms: message.text,
      templateid: message.dltTemplateId ?? '',
    });
    try {
      const response = await fetch(this.config.pingUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        signal: AbortSignal.timeout(10000),
      });
      const text = (await response.text()).slice(0, 255);
      if (!response.ok) {
        this.logger.error(`Ping4SMS ${response.status} for ${message.mobile}: ${text}`);
        return { status: 'failed', provider: 'ping4sms', error: `HTTP ${response.status}: ${text}` };
      }
      return { status: 'sent', provider: 'ping4sms', providerRef: text };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Ping4SMS request failed for ${message.mobile}: ${reason}`);
      return { status: 'failed', provider: 'ping4sms', error: reason };
    }
  }
}
