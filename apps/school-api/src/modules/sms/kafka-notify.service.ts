import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Kafka, logLevel, Producer } from 'kafkajs';
import {
  kafkaNotifyConfig,
  KafkaNotifyConfig,
  otpConfig,
  OtpConfig,
  pushConfig,
  PushConfig,
  smsConfig,
  SmsConfig,
} from '../../config/configuration';

export type KafkaChannel = 'sms' | 'email';

export interface KafkaTemplateMessage {
  type: KafkaChannel;
  tenantId: string;
  to: string;
  templateId: string;
  variables: Record<string, string>;
}

export interface KafkaSendInput {
  channel: KafkaChannel;
  to: string;
  templateId: string;
  variables: Record<string, string>;
}

export interface KafkaPushMessage {
  type: 'push';
  tenantId: string;
  templateId: string;
  variables: Record<string, string>;
  externalIds: string[];
  playerIds?: string[];
  dataOnly?: true;
  data?: Record<string, string>;
  priority?: 'high';
  ttl?: number;
}

export interface KafkaPushInput {
  templateId: string;
  variables: Record<string, string>;
  externalIds: string[];
  playerIds: string[];
  dataOnly?: { data: Record<string, string>; ttlSeconds: number };
}

export const KAFKA_OTP_TEMPLATE = 'otp';
export const KAFKA_PUSH_TEMPLATE = 'push';
export const KAFKA_CALL_TEMPLATE = 'call';

@Injectable()
export class KafkaNotifyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('KafkaNotify');
  private producer?: Producer;
  private connecting?: Promise<boolean>;
  private connected = false;

  constructor(
    @Inject(kafkaNotifyConfig.KEY) private readonly config: KafkaNotifyConfig,
    @Inject(smsConfig.KEY) private readonly sms: SmsConfig,
    @Inject(otpConfig.KEY) private readonly otp: OtpConfig,
    @Inject(pushConfig.KEY) private readonly push: PushConfig,
  ) {}

  get enabled(): boolean {
    return (
      this.sms.driver === 'kafka' ||
      this.push.driver === 'kafka' ||
      this.push.callDriver === 'kafka' ||
      (this.otp.mode === 'sms' && this.sms.otpDriver === 'kafka')
    );
  }

  get topic(): string {
    return this.config.topic;
  }

  async onModuleInit(): Promise<void> {
    if (this.enabled) await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.connected) await this.producer?.disconnect();
  }

  templateId(code: string, language: string = 'en'): string {
    const suffix = language === 'en' ? '' : `_${language}`;
    return `${this.config.templatePrefix}${code.toLowerCase()}${suffix}`;
  }

  recipient(channel: KafkaChannel, to: string): string {
    return channel === 'sms' && /^\d{10}$/.test(to) ? `91${to}` : to;
  }

  message(input: KafkaSendInput): KafkaTemplateMessage {
    return {
      type: input.channel,
      tenantId: this.config.tenantId,
      to: this.recipient(input.channel, input.to),
      templateId: input.templateId,
      variables: input.variables,
    };
  }

  async send(input: KafkaSendInput): Promise<KafkaTemplateMessage> {
    const message = this.message(input);
    if (!(await this.connect())) throw new Error('Kafka notification service is not reachable');
    await this.producer!.send({
      topic: this.config.topic,
      messages: [{ key: message.to, value: JSON.stringify(message) }],
    });
    this.logger.log(`${message.type} ${message.templateId} published for ${message.to}`);
    return message;
  }

  pushMessage(input: KafkaPushInput): KafkaPushMessage {
    return {
      type: 'push',
      tenantId: this.config.tenantId,
      templateId: input.templateId,
      variables: input.variables,
      externalIds: input.externalIds,
      ...(input.playerIds.length ? { playerIds: input.playerIds } : {}),
      ...(input.dataOnly
        ? {
            dataOnly: true as const,
            data: input.dataOnly.data,
            priority: 'high' as const,
            ttl: input.dataOnly.ttlSeconds,
          }
        : {}),
    };
  }

  async sendPush(input: KafkaPushInput): Promise<KafkaPushMessage> {
    const message = this.pushMessage(input);
    if (!(await this.connect())) throw new Error('Kafka notification service is not reachable');
    await this.producer!.send({
      topic: this.config.topic,
      messages: [{ key: input.externalIds[0] ?? input.templateId, value: JSON.stringify(message) }],
    });
    this.logger.log(`push ${message.templateId} published for users ${message.externalIds.join(', ')}`);
    return message;
  }

  private connect(): Promise<boolean> {
    if (this.connected) return Promise.resolve(true);
    if (this.connecting) return this.connecting;
    this.connecting = this.open().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  private async open(): Promise<boolean> {
    try {
      const kafka = new Kafka({
        clientId: this.config.clientId,
        brokers: this.config.brokers,
        ssl: this.config.ssl,
        sasl: this.config.username
          ? { mechanism: 'plain', username: this.config.username, password: this.config.password }
          : undefined,
        connectionTimeout: 5000,
        retry: { retries: 2 },
        logLevel: this.config.logEnabled ? logLevel.ERROR : logLevel.NOTHING,
      });
      this.producer = kafka.producer();
      this.producer.on('producer.disconnect', () => {
        this.connected = false;
      });
      await this.producer.connect();
      this.connected = true;
      this.logger.log(`Connected to ${this.config.brokers.join(', ')}, topic ${this.config.topic}`);
      return true;
    } catch (error) {
      this.connected = false;
      this.logger.warn(`Kafka unavailable: ${(error as Error).message}. Messages will retry and then show as failed.`);
      return false;
    }
  }
}
