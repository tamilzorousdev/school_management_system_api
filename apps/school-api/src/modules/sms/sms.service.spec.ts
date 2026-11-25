import { Logger } from '@nestjs/common';
import { KafkaNotifyConfig, OtpConfig, PushConfig, SmsConfig } from '../../config/configuration';
import { KAFKA_MAX_BATCH, KafkaNotifyService } from './kafka-notify.service';
import { SmsService } from './sms.service';

const kafkaConfig: KafkaNotifyConfig = {
  brokers: ['broker:9094'],
  username: 'producer',
  password: 'secret',
  ssl: false,
  topic: 'notifications',
  clientId: 'school-api',
  tenantByOneSignalApp: {},
  tenantId: 'tenant-1',
  templatePrefix: 'school_',
  logEnabled: false,
};

const smsBase: SmsConfig = {
  driver: 'kafka',
  otpDriver: 'kafka',
  pingUrl: 'http://ping',
  pingApiKey: '',
  pingRoute: '',
  pingSender: '',
  pingOtpTemplateId: '',
};

const otp = { mode: 'sms' } as OtpConfig;
const pushOff = { driver: 'off' } as PushConfig;

function setup(sms: Partial<SmsConfig> = {}) {
  const config = { ...smsBase, ...sms };
  const kafka = new KafkaNotifyService(kafkaConfig, config, otp, pushOff);
  const send = jest.spyOn(kafka, 'send').mockImplementation(async (input) => kafka.message(input));
  return { service: new SmsService(config, kafka), kafka, send };
}

describe('KafkaNotifyService', () => {
  const kafka = new KafkaNotifyService(kafkaConfig, smsBase, otp, pushOff);

  it('builds the same payload as the SoftSilk notification service', () => {
    expect(
      kafka.message({
        channel: 'sms',
        to: '9876543210',
        templateId: 'school_student_absent',
        variables: { student: 'Kavin' },
      }),
    ).toEqual({
      type: 'sms',
      tenantId: 'tenant-1',
      to: '919876543210',
      templateId: 'school_student_absent',
      variables: { student: 'Kavin' },
    });
  });

  it('keeps email addresses as they are', () => {
    expect(kafka.recipient('email', 'office@tzms.edu.in')).toBe('office@tzms.edu.in');
  });

  it('prefixes and lowercases template codes, with a suffix for Tamil', () => {
    expect(kafka.templateId('BUS_APPROACHING')).toBe('school_bus_approaching');
    expect(kafka.templateId('BUS_APPROACHING', 'en')).toBe('school_bus_approaching');
    expect(kafka.templateId('BUS_APPROACHING', 'ta')).toBe('school_bus_approaching_ta');
  });

  it('is enabled only when SMS or OTP uses Kafka', () => {
    expect(
      new KafkaNotifyService(kafkaConfig, { ...smsBase, driver: 'log', otpDriver: 'ping4sms' }, otp, pushOff).enabled,
    ).toBe(false);
    expect(
      new KafkaNotifyService(kafkaConfig, { ...smsBase, driver: 'log', otpDriver: 'kafka' }, otp, pushOff).enabled,
    ).toBe(true);
  });
});

describe('SmsService', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('publishes alert SMS to Kafka with the template code and variables', async () => {
    const { service, send } = setup();
    const result = await service.send({
      mobile: '9876543210',
      text: 'ignored by Kafka',
      dltTemplateId: null,
      templateCode: 'STUDENT_ABSENT',
      variables: { student: 'Kavin', class: '6-A' },
    });
    expect(send).toHaveBeenCalledWith({
      channel: 'sms',
      to: '9876543210',
      templateId: 'school_student_absent',
      variables: { student: 'Kavin', class: '6-A' },
    });
    expect(result).toEqual({ status: 'sent', provider: 'kafka', providerRef: 'notifications:school_student_absent' });
  });

  it('uses the Tamil template for Tamil-speaking users', async () => {
    const { service, send } = setup();
    await service.send({
      mobile: '9000000005',
      text: 'x',
      dltTemplateId: null,
      templateCode: 'STUDENT_ABSENT',
      variables: { student: 'Kavin' },
      language: 'ta',
    });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ templateId: 'school_student_absent_ta' }));
  });

  it('reports a failure when Kafka cannot be reached', async () => {
    const { service, send } = setup();
    send.mockRejectedValueOnce(new Error('Kafka notification service is not reachable'));
    const result = await service.send({
      mobile: '9876543210',
      text: 'x',
      dltTemplateId: null,
      templateCode: 'SOS_ALERT',
    });
    expect(result).toMatchObject({
      status: 'failed',
      provider: 'kafka',
      error: 'Kafka notification service is not reachable',
    });
  });

  it('sends the OTP with the shared otp template', async () => {
    const { service, send } = setup();
    await service.sendOtp({ mobile: '9876543210', otp: '482913', expiryMinutes: 10, name: 'Priya' });
    expect(send).toHaveBeenCalledWith({
      channel: 'sms',
      to: '9876543210',
      templateId: 'otp',
      variables: { otp: '482913', expiry: '10 minutes', name: 'Priya', mobile: '9876543210', app_hash: '' },
    });
  });

  it('skips sending in log mode', async () => {
    const { service, send } = setup({ driver: 'log' });
    const result = await service.send({
      mobile: '9876543210',
      text: 'hello',
      dltTemplateId: null,
      templateCode: 'SYSTEM_TEST',
    });
    expect(result.status).toBe('skipped');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('Kafka push', () => {
  const pushKafka = { driver: 'kafka' } as PushConfig;
  const kafka = new KafkaNotifyService(
    kafkaConfig,
    { ...smsBase, driver: 'log', otpDriver: 'ping4sms' },
    otp,
    pushKafka,
  );

  it('turns Kafka on when push goes through the notification service', () => {
    expect(kafka.enabled).toBe(true);
  });

  it('targets our user id and the registered devices', () => {
    expect(
      kafka.pushMessage({
        templateId: 'school_chat_message',
        variables: { sender: 'Priya', thread_id: '7' },
        externalIds: ['12'],
        playerIds: [],
      }),
    ).toEqual({
      type: 'push',
      tenantId: kafkaConfig.tenantId,
      templateId: 'school_chat_message',
      variables: { sender: 'Priya', thread_id: '7' },
      externalIds: ['12'],
    });
    expect(
      kafka.pushMessage({ templateId: 't', variables: {}, externalIds: ['12'], playerIds: ['sub-1'] }).playerIds,
    ).toEqual(['sub-1']);
  });
});

describe('Kafka publishing under a large fan-out', () => {
  function connectedKafka(failFirst = false) {
    const kafka = new KafkaNotifyService(kafkaConfig, smsBase, otp, { driver: 'kafka' } as PushConfig);
    const batches: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const producer = {
      send: jest.fn(async ({ messages }: { messages: unknown[] }) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        batches.push(messages.length);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        if (failFirst && batches.length === 1) throw new Error('broker down');
      }),
    };
    Object.assign(kafka, { producer, connected: true });
    const push = (id: number) =>
      kafka.sendPush({ templateId: 'school_push', variables: {}, externalIds: [String(id)], playerIds: [] });
    return { push, batches, producer, maxInFlight: () => maxInFlight };
  }

  it('keeps one send in flight and batches what waits, so the KafkaJS topic lock never piles up', async () => {
    const { push, batches, maxInFlight } = connectedKafka();
    const ids = Array.from({ length: 250 }, (_, i) => i + 1);
    await expect(Promise.all(ids.map(push))).resolves.toHaveLength(250);
    expect(maxInFlight()).toBe(1);
    expect(batches.reduce((sum, n) => sum + n, 0)).toBe(250);
    expect(Math.max(...batches)).toBeLessThanOrEqual(KAFKA_MAX_BATCH);
    expect(batches.length).toBeLessThan(10);
  });

  it('fails only the batch the broker refused, so those jobs retry and the rest go out', async () => {
    const { push } = connectedKafka(true);
    const results = await Promise.allSettled([1, 2, 3].map(push));
    expect(results[0].status).toBe('rejected');
    expect(results.slice(1).every((result) => result.status === 'fulfilled')).toBe(true);
  });
});
