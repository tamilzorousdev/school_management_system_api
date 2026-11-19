import 'dotenv/config';
import 'reflect-metadata';

if (process.env.NODE_ENV === 'production') {
  console.error('Demo fee data is for local and test databases only. It is refused when NODE_ENV=production.');
  process.exit(1);
}

Object.assign(process.env, {
  PUSH_DRIVER: 'off',
  CALL_PUSH_DRIVER: 'off',
  SMS_DRIVER: 'log',
  DB_MIGRATE_ON_START: 'false',
  SEED_ON_START: 'false',
});

async function run(): Promise<void> {
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../../app.module');
  const { seedDemoFeeFlows } = await import('./demo-fee-flows');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    await seedDemoFeeFlows(app);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  } finally {
    await app.close();
  }
}

run()
  .then(() => {
    console.log('Demo fee flows complete');
    process.exit(0);
  })
  .catch((error: Error) => {
    console.error(`Demo fee flows failed: ${error.message}`);
    process.exit(1);
  });
