import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../apps/school-api/src/app.module';
import { setupApp } from '../apps/school-api/src/app.setup';

describe('App (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.MQTT_ENABLED = 'false';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health returns the success shape', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body).toEqual({
      status: 200,
      message: 'OK',
      data: { db: 'up', telematics: expect.stringMatching(/^(up|down)$/) },
    });
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('GET /api/health works without a version', async () => {
    await request(app.getHttpServer()).get('/api/health').expect(200);
  });

  it('unknown route returns the error shape', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nope').expect(404);
    expect(res.body).toEqual({ status: 404, error: 'NOT_FOUND', message: 'Cannot GET /api/v1/nope' });
  });

  it('protected route without a token returns TOKEN_MISSING', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/me').expect(401);
    expect(res.body).toEqual({ status: 401, error: 'TOKEN_MISSING', message: 'Sign in to continue' });
  });

  it('invalid body returns field errors', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/otp/request').send({ mobile: '123' }).expect(400);
    expect(res.body).toEqual({
      status: 400,
      error: 'VALIDATION_FAILED',
      message: 'mobile must be a valid 10-digit Indian mobile number',
      errors: [{ field: 'mobile', message: 'mobile must be a valid 10-digit Indian mobile number' }],
    });
  });
});
