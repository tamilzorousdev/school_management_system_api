import 'dotenv/config';
import { createHmac } from 'crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { DataSource } from 'typeorm';

const KEY_SECRET = 'e2e_key_secret_for_tests';
const WEBHOOK_SECRET = 'e2e_webhook_secret_for_tests';
Object.assign(process.env, {
  OTP_TEST: 'true',
  AUTH_PROVIDER: 'local',
  PUSH_DRIVER: 'off',
  SMS_DRIVER: 'log',
  DB_MIGRATE_ON_START: 'false',
  SEED_ON_START: 'false',
  RAZORPAY_KEY_ID: 'rzp_test_E2EKEY0001',
  RAZORPAY_KEY_SECRET: KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
});

const SCRATCH_DB = /test|e2e/i.test(process.env.DB_NAME ?? '');
const ADMIN = '9876543210';
const AO = '9000000002';
const PARENT = '9000000005';
const ACCOUNTANT = '9000000009';

const describeOnScratchDb = SCRATCH_DB ? describe : describe.skip;

describeOnScratchDb('Fees (e2e, needs a migrated scratch database with seed and seed:demo)', () => {
  jest.setTimeout(60000);
  let app: INestApplication;
  let db: DataSource;
  const tokens: Record<string, string> = {};
  let orderNo = 0;

  const api = () => request(app.getHttpServer());
  const as = (mobile: string) => ({ authorization: `Bearer ${tokens[mobile]}` });
  const one = async <T>(sql: string, params: unknown[] = []): Promise<T> => (await db.query(sql, params))[0] as T;

  async function login(mobile: string, client: 'admin' | 'mobile') {
    await api().post('/api/v1/auth/otp/request').send({ mobile });
    const res = await api()
      .post('/api/v1/auth/otp/verify')
      .send({ mobile, otp: '123456', client: { app: client } });
    if (!res.body.data?.access_token) throw new Error(`Sign-in failed for ${mobile}: ${JSON.stringify(res.body)}`);
    tokens[mobile] = res.body.data.access_token;
  }

  const approve = (requestId: number) =>
    api().post(`/api/v1/admin/fees/requests/${requestId}/approve`).set(as(AO)).send({});

  beforeAll(async () => {
    const [{ Test }, { AppModule }, { setupApp }, { RazorpayClient }, typeorm] = await Promise.all([
      import('@nestjs/testing'),
      import('../apps/school-api/src/app.module'),
      import('../apps/school-api/src/app.setup'),
      import('../apps/school-api/src/modules/fees/razorpay.client'),
      import('typeorm'),
    ]);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    setupApp(app);
    await app.init();
    db = app.get(typeorm.DataSource);
    jest.spyOn(app.get(RazorpayClient), 'createOrder').mockImplementation(async (amount, receipt) => {
      orderNo += 1;
      return {
        id: `order_E2E${String(orderNo).padStart(6, '0')}`,
        amount,
        currency: 'INR',
        receipt,
        status: 'created',
      } as never;
    });
    await db.query(`DELETE FROM otp_requests`);
    await login(ADMIN, 'admin');
    await login(AO, 'admin');
    await login(ACCOUNTANT, 'admin');
    await login(PARENT, 'mobile');
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('accountant', () => {
    it('cannot change fee plans or approve requests', async () => {
      const plan = await one<{ class_id: number }>(`SELECT class_id FROM fee_plans LIMIT 1`);
      await api().put(`/api/v1/admin/fees/plans/${plan.class_id}`).set(as(ACCOUNTANT)).send({ lines: [] }).expect(403);
      await api().post('/api/v1/admin/fees/requests/1/approve').set(as(ACCOUNTANT)).send({}).expect(403);
    });
  });

  describe('discount approval', () => {
    it('is a request until the AO approves, and nobody approves their own', async () => {
      const invoice = await one<{ id: number; discount: string }>(
        `SELECT id, discount FROM fee_invoices WHERE balance > 1000 AND status <> 'cancelled' AND discount = 0 ORDER BY id LIMIT 1`,
      );
      const asked = await api()
        .patch(`/api/v1/admin/fees/invoices/${invoice.id}/discount`)
        .set(as(ACCOUNTANT))
        .send({ discount: 500, reason: 'Sibling joined mid-year' })
        .expect(202);
      expect(asked.body.data).toMatchObject({ kind: 'discount', status: 'pending' });
      expect(
        Number(
          (await one<{ discount: string }>(`SELECT discount FROM fee_invoices WHERE id = $1`, [invoice.id])).discount,
        ),
      ).toBe(0);

      await approve(asked.body.data.id).expect(200);
      expect(
        Number(
          (await one<{ discount: string }>(`SELECT discount FROM fee_invoices WHERE id = $1`, [invoice.id])).discount,
        ),
      ).toBe(500);

      const own = await api()
        .patch(`/api/v1/admin/fees/invoices/${invoice.id}/discount`)
        .set(as(AO))
        .send({ discount: 600, reason: 'Checking self approval' })
        .expect(202);
      const refused = await approve(own.body.data.id);
      expect(refused.body.error).toBe('SELF_APPROVAL');
    });
  });

  describe('one payment across invoices', () => {
    let studentId: number;
    let collection: { collection_id: number; payments: { id: number; invoice_id: number }[] };
    let sent: { amount: number; mode: string; reference: string };

    beforeAll(async () => {
      const row = await one<{ student_id: number; due: string }>(
        `SELECT i.student_id, sum(i.balance) AS due FROM fee_invoices i
         JOIN students s ON s.id = i.student_id AND s.status = 'active'
         WHERE i.balance > 0 AND i.status <> 'cancelled' AND i.deleted_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM fee_credits c WHERE c.student_id = i.student_id)
           AND NOT EXISTS (SELECT 1 FROM fee_requests r WHERE r.invoice_id = i.id)
         GROUP BY i.student_id HAVING count(*) >= 2 ORDER BY i.student_id DESC LIMIT 1`,
      );
      studentId = row.student_id;
      sent = { amount: Number(row.due) + 750, mode: 'upi', reference: 'UPI-E2E-1' };
      const res = await api()
        .post(`/api/v1/admin/fees/students/${studentId}/payments`)
        .set(as(ACCOUNTANT))
        .set('Idempotency-Key', `e2e-collect-${studentId}`)
        .send(sent)
        .expect(201);
      collection = res.body.data;
      expect(res.body.data).toMatchObject({ advance_amount: 750, replayed: false });
      expect(res.body.data.payments.length).toBeGreaterThanOrEqual(2);
    });

    it('a retry with the same key returns the first result; a different payment with it is refused', async () => {
      const again = await api()
        .post(`/api/v1/admin/fees/students/${studentId}/payments`)
        .set(as(ACCOUNTANT))
        .set('Idempotency-Key', `e2e-collect-${studentId}`)
        .send(sent)
        .expect(201);
      expect(again.body.data).toMatchObject({ collection_id: collection.collection_id, replayed: true });
      const other = await api()
        .post(`/api/v1/admin/fees/students/${studentId}/payments`)
        .set(as(ACCOUNTANT))
        .set('Idempotency-Key', `e2e-collect-${studentId}`)
        .send({ ...sent, amount: 1 })
        .expect(409);
      expect(other.body.error).toBe('IDEMPOTENCY_CONFLICT');
    });

    it('lists the advance and serves its receipt', async () => {
      const summary = await api().get(`/api/v1/admin/students/${studentId}/fees`).set(as(ADMIN)).expect(200);
      expect(summary.body.data.credit_balance).toBe(750);
      expect(summary.body.data.advances).toEqual([
        expect.objectContaining({ collection_id: collection.collection_id, amount: 750 }),
      ]);
      const pdf = await api()
        .get(`/api/v1/admin/fees/collections/${collection.collection_id}/advance-receipt`)
        .set(as(ADMIN))
        .expect(200);
      expect(pdf.headers['content-type']).toContain('application/pdf');
    });

    it('a reversal waits for the AO, then puts the balance back', async () => {
      const [first] = collection.payments;
      const asked = await api()
        .post(`/api/v1/admin/fees/payments/${first.id}/reverse`)
        .set(as(ACCOUNTANT))
        .send({ reason: 'Wrong student' })
        .expect(202);
      expect((await one<{ status: string }>(`SELECT status FROM fee_payments WHERE id = $1`, [first.id])).status).toBe(
        'success',
      );
      await approve(asked.body.data.id).expect(200);
      expect((await one<{ status: string }>(`SELECT status FROM fee_payments WHERE id = $1`, [first.id])).status).toBe(
        'reversed',
      );
      expect(
        Number(
          (await one<{ balance: string }>(`SELECT balance FROM fee_invoices WHERE id = $1`, [first.invoice_id]))
            .balance,
        ),
      ).toBeGreaterThan(0);
    });
  });

  describe('online payment (Razorpay stubbed)', () => {
    let childId: number;
    let invoice: { id: number; balance: string };
    let order: { order_id: string; amount_paise: number };
    const paymentId = 'pay_E2E0001';

    beforeAll(async () => {
      childId = (
        await one<{ student_id: number }>(
          `SELECT sg.student_id FROM users u JOIN guardians g ON g.user_id = u.id
           JOIN student_guardians sg ON sg.guardian_id = g.id WHERE u.mobile LIKE $1 ORDER BY sg.student_id LIMIT 1`,
          [`%${PARENT}`],
        )
      ).student_id;
      invoice = await one(
        `SELECT id, balance FROM fee_invoices WHERE student_id = $1 AND balance > 0 AND status <> 'cancelled' ORDER BY due_date LIMIT 1`,
        [childId],
      );
      if (!invoice)
        throw new Error('The demo parent has nothing left to pay: run this suite on a freshly seeded database');
      const res = await api()
        .post(`/api/v1/mobile/parent/children/${childId}/fees/invoices/${invoice.id}/pay-online`)
        .set(as(PARENT))
        .send({})
        .expect(201);
      order = res.body.data;
      expect(order.amount_paise).toBe(Math.round(Number(invoice.balance) * 100));
    });

    it('refuses a wrong checkout signature', async () => {
      const res = await api()
        .post(`/api/v1/mobile/parent/children/${childId}/fees/online-payments/verify`)
        .set(as(PARENT))
        .send({ razorpay_order_id: order.order_id, razorpay_payment_id: paymentId, razorpay_signature: 'a'.repeat(64) })
        .expect(400);
      expect(res.body.error).toBe('INVALID_PAYMENT_SIGNATURE');
    });

    it('records a verified payment once, even when the webhook comes too', async () => {
      const signature = createHmac('sha256', KEY_SECRET).update(`${order.order_id}|${paymentId}`).digest('hex');
      const verified = await api()
        .post(`/api/v1/mobile/parent/children/${childId}/fees/online-payments/verify`)
        .set(as(PARENT))
        .send({ razorpay_order_id: order.order_id, razorpay_payment_id: paymentId, razorpay_signature: signature });
      expect([200, 201]).toContain(verified.status);

      const body = JSON.stringify({
        event: 'payment.captured',
        payload: { payment: { entity: { id: paymentId, order_id: order.order_id, amount: order.amount_paise } } },
      });
      await api()
        .post('/api/v1/integrations/razorpay/webhook')
        .set('content-type', 'application/json')
        .set('x-razorpay-signature', 'bad')
        .send(body)
        .expect(401);
      await api()
        .post('/api/v1/integrations/razorpay/webhook')
        .set('content-type', 'application/json')
        .set('x-razorpay-signature', createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex'))
        .send(body)
        .expect(200);

      const paid = await one<{ n: number }>(
        `SELECT count(*)::int AS n FROM fee_payments WHERE mode = 'online' AND reference = $1`,
        [paymentId],
      );
      expect(paid.n).toBe(1);
      const after = await one<{ balance: string; status: string }>(
        `SELECT balance, status FROM fee_invoices WHERE id = $1`,
        [invoice.id],
      );
      expect(after).toMatchObject({ balance: '0.00', status: 'paid' });
    });

    it('shows the parent no internal notes or waiting requests', async () => {
      const res = await api().get(`/api/v1/mobile/parent/children/${childId}/fees`).set(as(PARENT)).expect(200);
      for (const payment of res.body.data.payments) expect(payment.notes).toBeNull();
      for (const row of res.body.data.invoices) expect(row.pending_requests).toEqual([]);
      expect(res.body.data.payments.some((payment: { reference: string }) => payment.reference === paymentId)).toBe(
        true,
      );
    });

    it('shows the class teacher amounts and statuses only', async () => {
      const teacher = await one<{ mobile: string } | undefined>(
        `SELECT u.mobile FROM student_enrollments e JOIN sections sec ON sec.id = e.section_id
         JOIN users u ON u.id = sec.class_teacher_user_id
         WHERE e.student_id = $1 AND e.status = 'studying' ORDER BY e.id DESC LIMIT 1`,
        [childId],
      );
      if (!teacher) return;
      const mobile = teacher.mobile.slice(-10);
      await login(mobile, 'mobile');
      const res = await api().get(`/api/v1/mobile/teacher/students/${childId}/fees`).set(as(mobile)).expect(200);
      expect(res.body.data.paid).toBeGreaterThan(0);
      for (const payment of res.body.data.payments) {
        expect(payment).toMatchObject({ reference: null, notes: null, received_by: null });
      }
      for (const row of res.body.data.invoices) {
        expect(row).toMatchObject({ discount_reason: null, benefits: [], refunds: [], pending_requests: [] });
      }
    });
  });

  it('every invoice still agrees with its payments', async () => {
    const res = await api().get('/api/v1/admin/fees/reconciliation').set(as(ADMIN)).expect(200);
    expect(res.body.data.mismatches).toEqual([]);
  });
});
