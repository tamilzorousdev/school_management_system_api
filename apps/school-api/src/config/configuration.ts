import { ConfigType, registerAs } from '@nestjs/config';

const list = (value?: string) =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export const appConfig = registerAs('app', () => {
  const port = Number(process.env.PORT ?? 3000);
  return {
    env: process.env.NODE_ENV ?? 'development',
    host: process.env.HOST ?? '::',
    port,
    timeZone: process.env.APP_TIMEZONE ?? 'Asia/Kolkata',
    corsOrigins: list(process.env.CORS_ORIGINS),
    publicUrl: (process.env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  };
});

export const dbConfig = registerAs('db', () => ({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true',
  poolSize: Number(process.env.DB_POOL_SIZE ?? 10),
  migrateOnStart: process.env.DB_MIGRATE_ON_START === 'true',
  seedOnStart: process.env.SEED_ON_START === 'true',
}));

export const authConfig = registerAs('auth', () => ({
  accessSecret: process.env.JWT_ACCESS_SECRET ?? '',
  accessTtlSeconds: Number(process.env.JWT_ACCESS_TTL_SECONDS ?? 3600),
  refreshTtlDays: Number(process.env.REFRESH_TTL_DAYS ?? 30),
}));

export const centralAuthConfig = registerAs('centralAuth', () => ({
  provider: (process.env.AUTH_PROVIDER ?? 'local') as 'local' | 'central',
  otpTest: process.env.OTP_TEST === 'true',
  url: (process.env.CENTRAL_AUTH_URL ?? '').replace(/\/+$/, ''),
  timeoutMs: Number(process.env.CENTRAL_AUTH_TIMEOUT_MS ?? 8000),
  emailDomain: process.env.AUTH_EMAIL_DOMAIN ?? '',
  tenantId: process.env.CENTRAL_AUTH_TENANT_ID ?? '',
}));

export type CentralAuthConfig = ConfigType<typeof centralAuthConfig>;

export const otpConfig = registerAs('otp', () => ({
  mode: (process.env.OTP_TEST === 'true' ? 'test' : (process.env.OTP_MODE ?? 'test')) as 'test' | 'sms',
  testCode: process.env.OTP_TEST_CODE ?? '123456',
  ttlSeconds: Number(process.env.OTP_TTL_SECONDS ?? 600),
  maxAttempts: Number(process.env.OTP_MAX_ATTEMPTS ?? 5),
  resendSeconds: Number(process.env.OTP_RESEND_SECONDS ?? 30),
  maxPerWindow: Number(process.env.OTP_MAX_PER_WINDOW ?? 5),
  windowMinutes: Number(process.env.OTP_WINDOW_MINUTES ?? 15),
}));

export const smsConfig = registerAs('sms', () => ({
  driver: (process.env.SMS_DRIVER ?? 'log') as 'log' | 'ping4sms' | 'kafka',
  otpDriver: (process.env.OTP_SMS_DRIVER ?? 'kafka') as 'ping4sms' | 'kafka',
  pingUrl: process.env.PING_API_URL ?? 'http://site.ping4sms.com/api/smsapi',
  pingApiKey: process.env.PING_API_KEY ?? '',
  pingRoute: process.env.PING_ROUTE ?? '',
  pingSender: process.env.PING_SENDER ?? '',
  pingOtpTemplateId: process.env.PING_OTP_TEMPLATE_ID ?? '',
}));

export const kafkaNotifyConfig = registerAs('kafkaNotify', () => ({
  brokers: list(process.env.NOTIFY_KAFKA_BROKER),
  username: process.env.NOTIFY_KAFKA_USER ?? '',
  password: process.env.NOTIFY_KAFKA_PASSWORD ?? '',
  ssl: process.env.NOTIFY_KAFKA_SSL === 'true',
  topic: process.env.NOTIFY_KAFKA_TOPIC || 'notifications',
  clientId: process.env.NOTIFY_KAFKA_CLIENT_ID || 'school-api',
  tenantId: process.env.NOTIFY_TENANT_ID ?? '',
  templatePrefix: process.env.NOTIFY_TEMPLATE_PREFIX ?? 'school_',
  logEnabled: process.env.NOTIFY_KAFKA_LOG === 'true',
}));

export type PushDriver = 'off' | 'fcm' | 'onesignal' | 'kafka';

export const pushConfig = registerAs('push', () => ({
  driver: (process.env.PUSH_DRIVER ?? 'off') as PushDriver,
  callDriver: (process.env.CALL_PUSH_DRIVER || process.env.PUSH_DRIVER || 'off') as PushDriver,
  credentialsFile: process.env.FIREBASE_CREDENTIALS_FILE ?? '',
  oneSignalAppId: process.env.ONESIGNAL_APP_ID ?? '',
  oneSignalApiKey: process.env.ONESIGNAL_REST_API_KEY ?? '',
}));

export const storageConfig = registerAs('storage', () => ({
  driver: (process.env.STORAGE_DRIVER ?? 'local') as 'local',
  localDir: process.env.STORAGE_LOCAL_DIR ?? 'uploads',
  maxFileMb: Number(process.env.FILE_MAX_MB ?? 10),
  urlTtlSeconds: Number(process.env.FILE_URL_TTL_SECONDS ?? 3600),
  signingSecret: process.env.FILE_SIGNING_SECRET ?? '',
  virusScan: (process.env.VIRUS_SCAN ?? 'off') as 'off',
}));

export const telematicsConfig = registerAs('telematics', () => ({
  url: (process.env.TELEMATICS_API_URL ?? '').replace(/\/$/, ''),
  apiKey: process.env.TELEMATICS_API_KEY ?? '',
  timeoutMs: Number(process.env.TELEMATICS_TIMEOUT_MS ?? 5000),
  webhookSecret: process.env.TELEMATICS_WEBHOOK_SECRET ?? '',
}));

export const videoConfig = registerAs('video', () => ({
  agoraAppId: process.env.AGORA_APP_ID ?? '',
  agoraAppCertificate: process.env.AGORA_APP_CERTIFICATE ?? '',
  tokenTtlSeconds: Number(process.env.AGORA_TOKEN_TTL_SECONDS ?? 900),
  customerId: process.env.AGORA_CUSTOMER_ID ?? '',
  customerSecret: process.env.AGORA_CUSTOMER_SECRET ?? '',
  restUrl: (process.env.AGORA_REST_URL || 'https://api.sd-rtn.com').replace(/\/+$/, ''),
  webhookSecret: process.env.AGORA_WEBHOOK_SECRET ?? '',
  timeoutMs: 8000,
}));

export const securityConfig = registerAs('security', () => ({
  biometricWebhookKey: process.env.BIOMETRIC_WEBHOOK_KEY ?? '',
  qrSigningSecret: process.env.QR_SIGNING_SECRET ?? '',
  dataEncryptionKey: process.env.DATA_ENCRYPTION_KEY ?? '',
}));

export const queueConfig = registerAs('queue', () => ({
  driver: (process.env.QUEUE_DRIVER ?? 'memory') as 'memory',
  maxRetries: Number(process.env.QUEUE_MAX_RETRIES ?? 3),
}));

export type AppConfig = ConfigType<typeof appConfig>;
export type DbConfig = ConfigType<typeof dbConfig>;
export type AuthConfig = ConfigType<typeof authConfig>;
export type OtpConfig = ConfigType<typeof otpConfig>;
export type SmsConfig = ConfigType<typeof smsConfig>;
export type KafkaNotifyConfig = ConfigType<typeof kafkaNotifyConfig>;
export type PushConfig = ConfigType<typeof pushConfig>;
export type StorageConfig = ConfigType<typeof storageConfig>;
export type QueueConfig = ConfigType<typeof queueConfig>;
export type SecurityConfig = ConfigType<typeof securityConfig>;
export type TelematicsConfig = ConfigType<typeof telematicsConfig>;
export type VideoConfig = ConfigType<typeof videoConfig>;

export const ALL_CONFIGS = [
  appConfig,
  dbConfig,
  authConfig,
  centralAuthConfig,
  otpConfig,
  smsConfig,
  kafkaNotifyConfig,
  pushConfig,
  storageConfig,
  securityConfig,
  telematicsConfig,
  videoConfig,
  queueConfig,
];
