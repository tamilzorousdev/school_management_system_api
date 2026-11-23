import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { DataSource } from 'typeorm';

Object.assign(process.env, {
  OTP_TEST: 'true',
  AUTH_PROVIDER: 'local',
  PUSH_DRIVER: 'off',
  SMS_DRIVER: 'log',
  DB_MIGRATE_ON_START: 'false',
  SEED_ON_START: 'false',
});

const SCRATCH_DB = /test|e2e/i.test(process.env.DB_NAME ?? '');
const ADMIN = '9876543210';
const AO = '9000000002';

const describeOnScratchDb = SCRATCH_DB ? describe : describe.skip;

describeOnScratchDb('Alumni (e2e, needs a migrated scratch database with seed and seed:demo)', () => {
  jest.setTimeout(180000);
  let app: INestApplication;
  let db: DataSource;
  let schoolCode: string;
  let alumniId: number;
  const tokens: Record<string, string> = {};
  const stamp = Date.now().toString().slice(-5);

  const api = () => request(app.getHttpServer());
  const as = (mobile: string) => ({ authorization: `Bearer ${tokens[mobile]}` });
  const today = () => new Date().toISOString().slice(0, 10);

  async function login(mobile: string) {
    await api().post('/api/v1/auth/otp/request').send({ mobile });
    const res = await api()
      .post('/api/v1/auth/otp/verify')
      .send({ mobile, otp: '123456', client: { app: 'admin' } });
    if (!res.body.data?.access_token) throw new Error(`Sign-in failed for ${mobile}: ${JSON.stringify(res.body)}`);
    tokens[mobile] = res.body.data.access_token;
  }

  beforeAll(async () => {
    const [{ Test }, { AppModule }, { setupApp }, typeorm] = await Promise.all([
      import('@nestjs/testing'),
      import('../apps/school-api/src/app.module'),
      import('../apps/school-api/src/app.setup'),
      import('typeorm'),
    ]);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    db = app.get(typeorm.DataSource);
    await login(ADMIN);
    await login(AO);
    const [school] = await db.query(
      `SELECT s.code FROM schools s JOIN users u ON u.school_id = s.id WHERE u.mobile = $1`,
      [ADMIN],
    );
    schoolCode = school.code;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('adds a student to alumni as soon as their TC is issued', async () => {
    const candidates: { id: number }[] = await db.query(
      `SELECT s.id FROM students s JOIN student_enrollments e ON e.student_id = s.id
       WHERE s.status = 'active' AND s.deleted_at IS NULL AND s.admission_date <= current_date
       ORDER BY s.id DESC LIMIT 10`,
    );
    let studentId = 0;
    let tcNo = '';
    for (const candidate of candidates) {
      const res = await api().post(`/api/v1/admin/students/${candidate.id}/exit`).set(as(ADMIN)).send({
        exit_type: 'transferred',
        leaving_date: today(),
        reason: 'Family moved to another city',
        acknowledge_dues: true,
      });
      if (res.status === 201) {
        studentId = candidate.id;
        tcNo = res.body.data.tc_no;
        break;
      }
    }
    expect(studentId).toBeGreaterThan(0);

    const student = await api().get(`/api/v1/admin/students/${studentId}`).set(as(ADMIN)).expect(200);
    expect(student.body.data.alumni_id).toEqual(expect.any(Number));
    alumniId = student.body.data.alumni_id;

    const alumni = await api().get(`/api/v1/admin/alumni/${alumniId}`).set(as(ADMIN)).expect(200);
    expect(alumni.body.data).toMatchObject({
      student_id: studentId,
      source: 'converted',
      exit_type: 'transferred',
      tc_no: tcNo,
      left_on: today(),
    });
    expect(alumni.body.data.alumni_no).toMatch(new RegExp(`^${schoolCode}-AL-\\d{4}-\\d{4}$`));
    expect(alumni.body.data.academic_history.length).toBeGreaterThan(0);

    const updated = await api()
      .patch(`/api/v1/admin/alumni/${alumniId}`)
      .set(as(ADMIN))
      .send({ city: `City${stamp}`, occupation_status: 'employed' })
      .expect(200);
    expect(updated.body.data.timeline[0]).toMatchObject({ action: 'updated' });
    expect(updated.body.data.timeline[0].changes.city[1]).toBe(`City${stamp}`);
  });

  it('lets an alumnus update their own details through a one-time link, after approval', async () => {
    const link = await api().post(`/api/v1/admin/alumni/${alumniId}/update-link`).set(as(ADMIN)).expect(201);
    const token = String(link.body.data.path).replace('alumni-update/', '');

    await api().get(`/api/v1/public/alumni/update/${token}`).expect(200);
    await api().post(`/api/v1/public/alumni/update/${token}`).send({ notes: 'not allowed' }).expect(400);
    const sent = await api()
      .post(`/api/v1/public/alumni/update/${token}`)
      .send({ city: `Erode${stamp}`, designation: 'Teacher' })
      .expect(201);
    await api().get(`/api/v1/public/alumni/update/${token}`).expect(404);

    const before = await api().get(`/api/v1/admin/alumni/${alumniId}`).set(as(ADMIN)).expect(200);
    expect(before.body.data.city).toBe(`City${stamp}`);
    expect(before.body.data.pending_submissions).toBe(1);

    await api()
      .post(`/api/v1/admin/alumni/submissions/${sent.body.data.id}/approve`)
      .set(as(ADMIN))
      .send({})
      .expect(200);
    const after = await api().get(`/api/v1/admin/alumni/${alumniId}`).set(as(ADMIN)).expect(200);
    expect(after.body.data).toMatchObject({ city: `Erode${stamp}`, designation: 'Teacher', pending_submissions: 0 });
    await api()
      .post(`/api/v1/admin/alumni/submissions/${sent.body.data.id}/approve`)
      .set(as(ADMIN))
      .send({})
      .expect(409);
  });

  it('turns an approved self-registration into an alumni record', async () => {
    const mobile = `98402${stamp}`;
    const sent = await api()
      .post(`/api/v1/public/alumni/schools/${schoolCode}/register`)
      .send({ first_name: `Self${stamp}`, batch_year: 2016, mobile, organization: 'Zoho' })
      .expect(201);
    await api()
      .post(`/api/v1/public/alumni/schools/${schoolCode}/register`)
      .send({ first_name: 'Future', batch_year: new Date().getFullYear() + 1, mobile })
      .expect(400);

    const approved = await api()
      .post(`/api/v1/admin/alumni/submissions/${sent.body.data.id}/approve`)
      .set(as(ADMIN))
      .send({})
      .expect(200);
    const alumni = await api().get(`/api/v1/admin/alumni/${approved.body.data.alumni_id}`).set(as(ADMIN)).expect(200);
    expect(alumni.body.data).toMatchObject({ source: 'self', batch_year: 2016, organization: 'Zoho', mobile });
  });

  it('keeps the alumni status out of the student edit form', async () => {
    const [student] = await db.query(`SELECT id FROM students WHERE status = 'active' AND deleted_at IS NULL LIMIT 1`);
    const res = await api()
      .patch(`/api/v1/admin/students/${student.id}`)
      .set(as(ADMIN))
      .send({ status: 'alumni' })
      .expect(400);
    expect(res.body.error).toBe('ALUMNI_STATUS_MANAGED');
  });

  it('previews the pass-out and exports the register', async () => {
    const preview = await api().get('/api/v1/admin/alumni/pass-out-preview').set(as(ADMIN)).expect(200);
    expect(preview.body.data).toHaveProperty('will_convert');
    const file = await api().get('/api/v1/admin/alumni/export').set(as(ADMIN)).expect(200);
    expect(file.headers['content-type']).toContain('spreadsheetml');
  });

  it('lets the AO look but not change', async () => {
    await api().get('/api/v1/admin/alumni').set(as(AO)).expect(200);
    await api().post(`/api/v1/admin/alumni/${alumniId}/update-link`).set(as(AO)).expect(403);
  });
});
