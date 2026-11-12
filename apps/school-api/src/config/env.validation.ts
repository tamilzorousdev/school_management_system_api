import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsTimeZone,
  IsUrl,
  Matches,
  Max,
  Min,
  MinLength,
  ValidateIf,
  validateSync,
} from 'class-validator';

const toBoolean = ({ value }: { value: unknown }) => value === true || value === 'true';

const otpSms = (env: EnvironmentVariables) => env.OTP_MODE === 'sms';
const centralAuth = (env: EnvironmentVariables) => env.AUTH_PROVIDER === 'central';
const usesPing = (env: EnvironmentVariables) =>
  env.SMS_DRIVER === 'ping4sms' || (otpSms(env) && env.OTP_SMS_DRIVER === 'ping4sms');
const usesKafka = (env: EnvironmentVariables) =>
  env.SMS_DRIVER === 'kafka' ||
  env.PUSH_DRIVER === 'kafka' ||
  env.CALL_PUSH_DRIVER === 'kafka' ||
  (otpSms(env) && env.OTP_SMS_DRIVER === 'kafka');
const usesOneSignal = (env: EnvironmentVariables) =>
  env.PUSH_DRIVER === 'onesignal' || env.CALL_PUSH_DRIVER === 'onesignal';

export class EnvironmentVariables {
  @IsIn(['development', 'production', 'test'])
  NODE_ENV: string = 'development';

  @IsString()
  @IsNotEmpty()
  HOST: string = '::';

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsTimeZone()
  APP_TIMEZONE: string = 'Asia/Kolkata';

  @IsOptional()
  @IsString()
  CORS_ORIGINS?: string;

  @ValidateIf((env: EnvironmentVariables) => Boolean(env.PUBLIC_BASE_URL))
  @IsUrl(
    { require_tld: false, require_protocol: true },
    { message: 'PUBLIC_BASE_URL must be a full URL such as http://192.168.1.71:3000' },
  )
  PUBLIC_BASE_URL?: string;

  @IsString()
  @IsNotEmpty()
  DB_HOST: string;

  @IsInt()
  DB_PORT: number = 5432;

  @IsString()
  @IsNotEmpty()
  DB_USER: string;

  @IsString()
  DB_PASSWORD: string;

  @IsString()
  @IsNotEmpty()
  DB_NAME: string;

  @Transform(toBoolean)
  @IsBoolean()
  DB_SSL: boolean = false;

  @IsInt()
  @Min(1)
  DB_POOL_SIZE: number = 10;

  @Transform(toBoolean)
  @IsBoolean()
  DB_MIGRATE_ON_START: boolean = false;

  @Transform(toBoolean)
  @IsBoolean()
  SEED_ON_START: boolean = false;

  @IsUrl(
    { require_tld: false, require_protocol: true },
    { message: 'TELEMATICS_API_URL must be like http://localhost:3001/api/v1' },
  )
  TELEMATICS_API_URL: string;

  @IsString()
  @MinLength(32, { message: 'TELEMATICS_API_KEY must be one of the keys in the Telematics service API_KEYS' })
  TELEMATICS_API_KEY: string;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1000)
  @Max(30000)
  TELEMATICS_TIMEOUT_MS: number = 5000;

  @IsOptional()
  @ValidateIf((env: EnvironmentVariables) => Boolean(env.AGORA_APP_ID))
  @Matches(/^[0-9a-f]{32}$/i, {
    message:
      'AGORA_APP_ID must be the 32-character App ID from the Agora console, or left empty to switch video calls off',
  })
  AGORA_APP_ID?: string;

  @ValidateIf((env: EnvironmentVariables) => Boolean(env.AGORA_APP_ID))
  @Matches(/^[0-9a-f]{32}$/i, {
    message: 'AGORA_APP_CERTIFICATE must be the 32-character primary certificate of the Agora project',
  })
  AGORA_APP_CERTIFICATE?: string;

  @IsInt()
  @Min(300)
  @Max(3600)
  AGORA_TOKEN_TTL_SECONDS: number = 900;

  @IsOptional()
  @ValidateIf((env: EnvironmentVariables) => Boolean(env.AGORA_CUSTOMER_ID || env.AGORA_CUSTOMER_SECRET))
  @IsString()
  @MinLength(8, {
    message:
      'AGORA_CUSTOMER_ID and AGORA_CUSTOMER_SECRET come together from Agora console → RESTful API, or both empty',
  })
  AGORA_CUSTOMER_ID?: string;

  @IsOptional()
  @ValidateIf((env: EnvironmentVariables) => Boolean(env.AGORA_CUSTOMER_ID || env.AGORA_CUSTOMER_SECRET))
  @IsString()
  @MinLength(8, {
    message:
      'AGORA_CUSTOMER_ID and AGORA_CUSTOMER_SECRET come together from Agora console → RESTful API, or both empty',
  })
  AGORA_CUSTOMER_SECRET?: string;

  @IsUrl(
    { require_tld: false, require_protocol: true },
    { message: 'AGORA_REST_URL must be like https://api.sd-rtn.com' },
  )
  AGORA_REST_URL: string = 'https://api.sd-rtn.com';

  @IsOptional()
  @ValidateIf((env: EnvironmentVariables) => Boolean(env.AGORA_WEBHOOK_SECRET))
  @MinLength(16, { message: 'AGORA_WEBHOOK_SECRET is the secret Agora shows when you enable Notifications' })
  AGORA_WEBHOOK_SECRET?: string;

  @IsOptional()
  @MinLength(32, {
    message: 'TELEMATICS_WEBHOOK_SECRET must match TRIP_WEBHOOK_SECRET in the Telematics service (32+ characters)',
  })
  TELEMATICS_WEBHOOK_SECRET?: string;

  @IsString()
  @MinLength(32, { message: 'JWT_ACCESS_SECRET must be at least 32 characters' })
  JWT_ACCESS_SECRET: string;

  @IsInt()
  @Min(60)
  @Max(86400)
  JWT_ACCESS_TTL_SECONDS: number = 3600;

  @IsInt()
  @Min(1)
  @Max(365)
  REFRESH_TTL_DAYS: number = 30;

  @IsIn(['test', 'sms'])
  OTP_MODE: string = 'test';

  @IsIn(['true', 'false'], { message: 'OTP_TEST must be true or false' })
  OTP_TEST: string = 'false';

  @IsIn(['local', 'central'], { message: 'AUTH_PROVIDER must be local or central' })
  AUTH_PROVIDER: string = 'local';

  @ValidateIf(centralAuth)
  @IsUrl(
    { require_tld: false, require_protocol: true },
    { message: 'CENTRAL_AUTH_URL must be the Auth Service base URL, like http://host:3002/api/auth' },
  )
  CENTRAL_AUTH_URL: string;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1000)
  @Max(60000)
  CENTRAL_AUTH_TIMEOUT_MS: number = 8000;

  @ValidateIf(centralAuth)
  @Matches(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, { message: 'AUTH_EMAIL_DOMAIN must be a domain like school.tamilzorous.com' })
  AUTH_EMAIL_DOMAIN: string;

  @IsOptional()
  @Matches(/^[A-Za-z0-9_-]{2,40}$/, {
    message: 'CENTRAL_AUTH_TENANT_ID must be the tenant id onboarded on the Auth Service, like TZSMS',
  })
  CENTRAL_AUTH_TENANT_ID?: string;

  @Matches(/^\d{6}$/, { message: 'OTP_TEST_CODE must be 6 digits' })
  OTP_TEST_CODE: string = '123456';

  @IsInt()
  @Min(60)
  @Max(1800)
  OTP_TTL_SECONDS: number = 600;

  @IsInt()
  @Min(1)
  @Max(10)
  OTP_MAX_ATTEMPTS: number = 5;

  @IsInt()
  @Min(10)
  @Max(300)
  OTP_RESEND_SECONDS: number = 30;

  @IsInt()
  @Min(1)
  @Max(20)
  OTP_MAX_PER_WINDOW: number = 5;

  @IsInt()
  @Min(1)
  @Max(1440)
  OTP_WINDOW_MINUTES: number = 15;

  @IsIn(['log', 'ping4sms', 'kafka'])
  SMS_DRIVER: string = 'log';

  @IsIn(['ping4sms', 'kafka'])
  OTP_SMS_DRIVER: string = 'kafka';

  @ValidateIf(usesPing)
  @IsString()
  @IsNotEmpty()
  PING_API_KEY: string;

  @ValidateIf(usesPing)
  @IsString()
  @IsNotEmpty()
  PING_ROUTE: string;

  @ValidateIf(usesPing)
  @IsString()
  @IsNotEmpty()
  PING_SENDER: string;

  @ValidateIf(usesPing)
  @IsString()
  @IsNotEmpty()
  PING_OTP_TEMPLATE_ID: string;

  @ValidateIf(usesKafka)
  @IsString()
  @IsNotEmpty({ message: 'NOTIFY_KAFKA_BROKER is required when SMS goes through Kafka (host:port, comma-separated)' })
  NOTIFY_KAFKA_BROKER: string;

  @ValidateIf(usesKafka)
  @IsString()
  @IsNotEmpty()
  NOTIFY_KAFKA_USER: string;

  @ValidateIf(usesKafka)
  @IsString()
  @IsNotEmpty()
  NOTIFY_KAFKA_PASSWORD: string;

  @ValidateIf(usesKafka)
  @IsString()
  @IsNotEmpty({ message: 'NOTIFY_TENANT_ID is required when SMS goes through Kafka' })
  NOTIFY_TENANT_ID: string;

  @Transform(toBoolean)
  @IsBoolean()
  NOTIFY_KAFKA_SSL: boolean = false;

  @IsString()
  @Matches(/^[\w.-]+$/, { message: 'NOTIFY_KAFKA_TOPIC must be a valid topic name' })
  NOTIFY_KAFKA_TOPIC: string = 'notifications';

  @IsString()
  @Matches(/^[\w-]+$/, { message: 'NOTIFY_KAFKA_CLIENT_ID must be letters, digits, _ or -' })
  NOTIFY_KAFKA_CLIENT_ID: string = 'school-api';

  @IsString()
  @Matches(/^[a-z0-9_]*$/, { message: 'NOTIFY_TEMPLATE_PREFIX must be lowercase letters, digits or _' })
  NOTIFY_TEMPLATE_PREFIX: string = 'school_';

  @Transform(toBoolean)
  @IsBoolean()
  NOTIFY_KAFKA_LOG: boolean = false;

  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  PING_API_URL?: string;

  @IsIn(['off', 'fcm', 'onesignal', 'kafka'], { message: 'PUSH_DRIVER must be off, fcm, onesignal or kafka' })
  PUSH_DRIVER: string = 'off';

  @ValidateIf((env: EnvironmentVariables) => Boolean(env.CALL_PUSH_DRIVER))
  @IsIn(['off', 'fcm', 'onesignal', 'kafka'], { message: 'CALL_PUSH_DRIVER must be off, fcm, onesignal or kafka' })
  CALL_PUSH_DRIVER?: string;

  @ValidateIf((env: EnvironmentVariables) => env.PUSH_DRIVER === 'fcm' || env.CALL_PUSH_DRIVER === 'fcm')
  @IsString()
  @IsNotEmpty()
  FIREBASE_CREDENTIALS_FILE: string;

  @ValidateIf(usesOneSignal)
  @IsOptional()
  @IsString()
  ONESIGNAL_APP_ID?: string;

  @ValidateIf(usesOneSignal)
  @IsOptional()
  @IsString()
  ONESIGNAL_REST_API_KEY?: string;

  @IsIn(['local'], { message: 'STORAGE_DRIVER supports local in this phase; s3 comes with the infrastructure phase' })
  STORAGE_DRIVER: string = 'local';

  @IsString()
  @IsNotEmpty()
  STORAGE_LOCAL_DIR: string = 'uploads';

  @IsInt()
  @Min(1)
  @Max(50)
  FILE_MAX_MB: number = 10;

  @IsInt()
  @Min(60)
  @Max(604800)
  FILE_URL_TTL_SECONDS: number = 3600;

  @IsString()
  @MinLength(32, { message: 'FILE_SIGNING_SECRET must be at least 32 characters' })
  FILE_SIGNING_SECRET: string;

  @IsOptional()
  @ValidateIf((env: EnvironmentVariables) => Boolean(env.BIOMETRIC_WEBHOOK_KEY))
  @IsString()
  @MinLength(32, {
    message: 'BIOMETRIC_WEBHOOK_KEY must be at least 32 characters, or left empty to switch the webhook off',
  })
  BIOMETRIC_WEBHOOK_KEY?: string;

  @IsString()
  @MinLength(32, { message: 'QR_SIGNING_SECRET must be at least 32 characters' })
  QR_SIGNING_SECRET: string;

  @IsString()
  @Matches(/^[A-Za-z0-9+/]{43}=$/, {
    message: 'DATA_ENCRYPTION_KEY must be 32 random bytes in base64 (openssl rand -base64 32)',
  })
  DATA_ENCRYPTION_KEY: string;

  @IsIn(['off'], { message: 'VIRUS_SCAN supports off in this phase; clamav comes with the infrastructure phase' })
  VIRUS_SCAN: string = 'off';

  @IsIn(['memory'], {
    message: 'QUEUE_DRIVER supports memory in this phase; redis comes with the infrastructure phase',
  })
  QUEUE_DRIVER: string = 'memory';

  @IsInt()
  @Min(0)
  @Max(10)
  QUEUE_MAX_RETRIES: number = 3;
}

export function validate(config: Record<string, unknown>): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, config, { enableImplicitConversion: true });
  if (env.NODE_ENV === 'production' && env.OTP_MODE === 'test') {
    throw new Error('Invalid env OTP_MODE: test mode is not allowed in production');
  }
  if (env.NODE_ENV === 'production' && String(env.OTP_TEST) === 'true') {
    throw new Error('Invalid env OTP_TEST: the fixed test OTP is not allowed in production');
  }
  const [error] = validateSync(env);
  if (error) {
    const reason = Object.values(error.constraints ?? {})[0] ?? 'is invalid';
    throw new Error(`Invalid env ${error.property}: ${reason}`);
  }
  return env;
}
