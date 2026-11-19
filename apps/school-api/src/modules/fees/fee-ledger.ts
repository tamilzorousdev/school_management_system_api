import { EntityManager } from 'typeorm';
import { AppException } from '@app/common';
import { rupees } from '../payroll/payroll.calc';
import { SequencesService } from '../schools/sequences.service';
import { FeeCredit } from './entities/fee-credit.entity';
import { FeeHead } from './entities/fee-head.entity';
import { FeeInvoiceBenefit } from './entities/fee-invoice-benefit.entity';
import { FeeInvoice } from './entities/fee-invoice.entity';
import { FeeInvoiceLine } from './entities/fee-invoice-line.entity';
import { FeePayment, PaymentMode } from './entities/fee-payment.entity';
import { FeePlan } from './entities/fee-plan.entity';
import { recordFeeAudit } from './fee-audit';
import {
  allocateBenefits,
  applyPayment,
  BenefitRule,
  feeNumber,
  invoiceStatus,
  PlanShare,
  previousDueDate,
  replayedPayment,
  reverseAmounts,
  sumAmounts,
  transportCharge,
} from './fees.logic';

export interface FeeYear {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  status?: string;
}

export async function assertYearTakesMoney(manager: EntityManager, yearId: number): Promise<void> {
  const [year] = await manager.query(`SELECT name, status FROM academic_years WHERE id = $1`, [yearId]);
  if (year?.status === 'archived') {
    throw AppException.conflict(
      `${year.name} is archived. Restore it in School setup before changing its fees.`,
      'YEAR_ARCHIVED',
    );
  }
}

export interface GenerateInput {
  school_id: number;
  year: FeeYear;
  installment: string;
  class_id?: number;
  due_date?: string;
  created_by: number | null;
}

export interface GenerateOutcome {
  classes: number;
  created: FeeInvoice[];
  already_invoiced: number;
  with_transport: number;
  with_benefits: number;
  benefit_amount: number;
  total_amount: number;
}

export interface PaymentInput {
  amount: number;
  mode: PaymentMode;
  reference?: string | null;
  paid_on: string;
  notes?: string | null;
  received_by: number | null;
  idempotency_key?: string | null;
  collection_id?: number | null;
}

export interface RecordedPayment {
  payment: FeePayment;
  replayed: boolean;
}

export interface ReversalInput {
  reason: string;
  reversed_by: number | null;
}

const sequences = new SequencesService();

async function schoolCode(manager: EntityManager, schoolId: number): Promise<string> {
  const [row] = await manager.query(`SELECT code FROM schools WHERE id = $1`, [schoolId]);
  return row?.code ?? 'SCH';
}

const startYear = (year: FeeYear) => year.start_date.slice(0, 4);

export async function generateInvoices(manager: EntityManager, input: GenerateInput): Promise<GenerateOutcome> {
  const { school_id: schoolId, year, installment } = input;
  await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
    `fee_generate:${schoolId}:${year.id}:${installment.toLowerCase()}`,
  ]);
  const planQuery = manager
    .getRepository(FeePlan)
    .createQueryBuilder('p')
    .where('p.school_id = :schoolId AND p.academic_year_id = :yearId', { schoolId, yearId: year.id });
  if (input.class_id) planQuery.andWhere('p.class_id = :classId', { classId: input.class_id });
  const plans = await planQuery.getMany();
  const classIds = [...new Set(plans.filter((plan) => plan.installment === installment).map((plan) => plan.class_id))];
  if (!classIds.length) {
    throw AppException.badRequest(
      `No fee plan has the installment “${installment}”${input.class_id ? ' for this class' : ''}`,
      'NO_PLAN_FOR_INSTALLMENT',
    );
  }
  const heads = new Map(
    (await manager.getRepository(FeeHead).findBy({ school_id: schoolId })).map((head) => [head.id, head]),
  );
  const transportHead = [...heads.values()].find((head) => head.is_transport && head.is_active) ?? null;

  const students: { id: number; class_id: number; section_id: number | null }[] = (
    await manager.query(
      `SELECT s.id, e.class_id, e.section_id FROM student_enrollments e
       JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL AND s.status = 'active'
       WHERE e.school_id = $1 AND e.academic_year_id = $2 AND e.class_id = ANY($3) AND e.status = 'studying'
       ORDER BY e.class_id, e.section_id, e.roll_no NULLS LAST, s.first_name`,
      [schoolId, year.id, classIds],
    )
  ).map((row: { id: number; class_id: number; section_id: number | null }) => ({
    id: Number(row.id),
    class_id: Number(row.class_id),
    section_id: row.section_id === null ? null : Number(row.section_id),
  }));
  const ids = students.map((student) => student.id);
  const invoiced = new Set<number>(
    ids.length
      ? (
          await manager.query(
            `SELECT student_id FROM fee_invoices WHERE academic_year_id = $1 AND installment = $2
             AND status <> 'cancelled' AND deleted_at IS NULL AND student_id = ANY($3)`,
            [year.id, installment, ids],
          )
        ).map((row: { student_id: number }) => Number(row.student_id))
      : [],
  );

  const dueByClass = new Map<number, string>();
  const previousByClass = new Map<number, string>();
  for (const classId of classIds) {
    const own = plans.filter((plan) => plan.class_id === classId);
    const due =
      input.due_date ??
      own
        .filter((plan) => plan.installment === installment)
        .map((plan) => plan.due_date)
        .sort()
        .pop()!;
    dueByClass.set(classId, due);
    previousByClass.set(classId, previousDueDate([...new Set(own.map((plan) => plan.due_date))], due, year.start_date));
  }

  const pending = students.filter((student) => !invoiced.has(student.id));
  const latestDue = [...dueByClass.values()].sort().pop()!;
  const riders = new Map<number, { stop: string; monthly_fee: number }>();
  if (transportHead && pending.length) {
    const rows: { student_id: number; stop: string; monthly_fee: string; start_date: string }[] = await manager.query(
      `SELECT st.student_id,
              CASE WHEN ds.id IS NOT NULL AND ds.id <> rs.id THEN rs.name || ' / ' || ds.name ELSE rs.name END AS stop,
              GREATEST(rs.monthly_fee, COALESCE(ds.monthly_fee, 0)) AS monthly_fee,
              to_char(st.start_date, 'YYYY-MM-DD') AS start_date
       FROM student_transport st JOIN route_stops rs ON rs.id = st.stop_id AND rs.deleted_at IS NULL
       LEFT JOIN route_stops ds ON ds.id = st.drop_stop_id AND ds.deleted_at IS NULL
       WHERE st.school_id = $1 AND st.deleted_at IS NULL AND st.student_id = ANY($2) AND st.start_date <= $3`,
      [schoolId, pending.map((student) => student.id), latestDue],
    );
    for (const row of rows) {
      if (Number(row.monthly_fee) > 0) {
        riders.set(Number(row.student_id), { stop: row.stop, monthly_fee: Number(row.monthly_fee) });
      }
    }
  }

  const rulesByStudent = await benefitRules(manager, schoolId, year.id, pending);
  const code = await schoolCode(manager, schoolId);
  const created: FeeInvoice[] = [];
  let withTransport = 0;
  let withBenefits = 0;
  let benefitAmount = 0;
  for (const student of pending) {
    const due = dueByClass.get(student.class_id)!;
    const lines: Partial<FeeInvoiceLine>[] = plans
      .filter((plan) => plan.class_id === student.class_id && plan.installment === installment && plan.amount > 0)
      .map((plan) => ({
        fee_head_id: plan.fee_head_id,
        head_name: heads.get(plan.fee_head_id)?.name ?? 'Fee',
        description: null,
        amount: plan.amount,
      }));
    const rider = riders.get(student.id);
    if (rider && transportHead) {
      const charge = transportCharge(rider.monthly_fee, due, previousByClass.get(student.class_id)!);
      lines.push({
        fee_head_id: transportHead.id,
        head_name: transportHead.name,
        description: `${rider.stop} · ${rupees(rider.monthly_fee)} × ${charge.months} ${charge.months === 1 ? 'month' : 'months'}`,
        amount: charge.amount,
      });
      withTransport += 1;
    }
    const gross = sumAmounts(lines.map((line) => line.amount ?? 0));
    if (gross <= 0) continue;
    const allocations = allocateBenefits(
      lines.map((line) => ({
        fee_head_id: line.fee_head_id ?? null,
        amount: line.amount ?? 0,
        is_transport: Boolean(transportHead && line.fee_head_id === transportHead.id),
      })),
      rulesByStudent.get(student.id) ?? [],
      planShares(plans.filter((plan) => plan.class_id === student.class_id)),
      installment,
    );
    const benefit = Math.min(gross, sumAmounts(allocations.map((allocation) => allocation.amount)));
    const total = sumAmounts([gross, -benefit]);
    const value = await sequences.next(manager, schoolId, `fee_invoice:${startYear(year)}`);
    const invoice = await manager.save(
      manager.create(FeeInvoice, {
        school_id: schoolId,
        academic_year_id: year.id,
        student_id: student.id,
        class_id: student.class_id,
        section_id: student.section_id,
        invoice_no: feeNumber(code, 'FEE', startYear(year), value),
        installment,
        due_date: due,
        gross,
        benefit,
        discount: 0,
        total,
        paid: 0,
        balance: total,
        status: invoiceStatus(total, 0),
        created_by: input.created_by,
      }),
    );
    await manager.save(
      lines.map((line, index) =>
        manager.create(FeeInvoiceLine, {
          ...line,
          school_id: schoolId,
          invoice_id: invoice.id,
          sort_order: index,
          created_by: input.created_by,
        }),
      ),
    );
    if (allocations.length) {
      await manager.save(
        allocations.map((allocation) =>
          manager.create(FeeInvoiceBenefit, {
            ...allocation,
            school_id: schoolId,
            invoice_id: invoice.id,
            created_by: input.created_by,
          }),
        ),
      );
      withBenefits += 1;
      benefitAmount = sumAmounts([benefitAmount, benefit]);
    }
    created.push(invoice);
  }
  const outcome = {
    classes: classIds.length,
    created,
    already_invoiced: students.length - pending.length,
    with_transport: withTransport,
    with_benefits: withBenefits,
    benefit_amount: benefitAmount,
    total_amount: sumAmounts(created.map((invoice) => invoice.total)),
  };
  if (created.length) {
    await recordFeeAudit(manager, {
      school_id: schoolId,
      entity: 'invoice_run',
      entity_id: null,
      action: 'generated',
      after: {
        academic_year_id: year.id,
        installment,
        class_id: input.class_id ?? null,
        due_date: input.due_date ?? null,
        created: created.length,
        invoice_ids: created.map((invoice) => invoice.id),
        benefit_amount: outcome.benefit_amount,
        total_amount: outcome.total_amount,
      },
      actor_id: input.created_by,
    });
  }
  return outcome;
}

export interface OneOffInvoiceInput {
  school_id: number;
  year: FeeYear;
  student_id: number;
  installment: string;
  due_date: string;
  kind: FeeInvoice['kind'];
  lines: { head_name: string; description: string | null; amount: number }[];
  created_by: number | null;
}

export async function createOneOffInvoice(manager: EntityManager, input: OneOffInvoiceInput): Promise<FeeInvoice> {
  const [enrolment] = await manager.query(
    `SELECT class_id, section_id FROM student_enrollments
     WHERE school_id = $1 AND academic_year_id = $2 AND student_id = $3 ORDER BY id DESC LIMIT 1`,
    [input.school_id, input.year.id, input.student_id],
  );
  if (!enrolment) {
    throw AppException.conflict('The student is not enrolled in this academic year', 'STUDENT_NOT_ENROLLED');
  }
  const gross = sumAmounts(input.lines.map((line) => line.amount));
  const value = await sequences.next(manager, input.school_id, `fee_invoice:${startYear(input.year)}`);
  const invoice = await manager.save(
    manager.create(FeeInvoice, {
      school_id: input.school_id,
      academic_year_id: input.year.id,
      student_id: input.student_id,
      class_id: Number(enrolment.class_id),
      section_id: enrolment.section_id === null ? null : Number(enrolment.section_id),
      invoice_no: feeNumber(await schoolCode(manager, input.school_id), 'FEE', startYear(input.year), value),
      installment: input.installment,
      due_date: input.due_date,
      gross,
      benefit: 0,
      discount: 0,
      total: gross,
      paid: 0,
      balance: gross,
      status: invoiceStatus(gross, 0),
      kind: input.kind,
      created_by: input.created_by,
    }),
  );
  await manager.save(
    input.lines.map((line, index) =>
      manager.create(FeeInvoiceLine, {
        ...line,
        fee_head_id: null,
        school_id: input.school_id,
        invoice_id: invoice.id,
        sort_order: index,
        created_by: input.created_by,
      }),
    ),
  );
  return invoice;
}

export async function nextFineNumber(manager: EntityManager, schoolId: number, year: FeeYear): Promise<string> {
  const value = await sequences.next(manager, schoolId, `fee_fine:${startYear(year)}`);
  return feeNumber(await schoolCode(manager, schoolId), 'FIN', startYear(year), value);
}

export async function recordPayment(
  manager: EntityManager,
  schoolId: number,
  invoiceId: number,
  input: PaymentInput,
): Promise<RecordedPayment> {
  const invoice = await manager.findOne(FeeInvoice, {
    where: { id: invoiceId, school_id: schoolId },
    lock: { mode: 'pessimistic_write' },
  });
  if (!invoice) throw AppException.notFound('Invoice not found', 'INVOICE_NOT_FOUND');
  await assertYearTakesMoney(manager, invoice.academic_year_id);
  if (input.idempotency_key) {
    const earlier = await manager.findOneBy(FeePayment, {
      school_id: schoolId,
      idempotency_key: input.idempotency_key,
    });
    const replay = replayedPayment(earlier, invoice.id, input.amount);
    if (replay) return { payment: replay, replayed: true };
  }
  const next = applyPayment(invoice, input.amount);
  const [year] = await manager.query(`SELECT to_char(start_date, 'YYYY') AS year FROM academic_years WHERE id = $1`, [
    invoice.academic_year_id,
  ]);
  const value = await sequences.next(manager, schoolId, `fee_receipt:${year?.year ?? input.paid_on.slice(0, 4)}`);
  const payment = await manager.save(
    manager.create(FeePayment, {
      school_id: schoolId,
      invoice_id: invoice.id,
      student_id: invoice.student_id,
      amount: input.amount,
      mode: input.mode,
      reference: input.reference || null,
      paid_on: input.paid_on,
      notes: input.notes || null,
      received_by: input.received_by,
      receipt_no: feeNumber(await schoolCode(manager, schoolId), 'RCP', year?.year ?? input.paid_on.slice(0, 4), value),
      status: 'success',
      idempotency_key: input.idempotency_key || null,
      collection_id: input.collection_id ?? null,
      created_by: input.received_by,
    }),
  );
  await manager.update(FeeInvoice, invoice.id, next);
  await recordFeeAudit(manager, {
    school_id: schoolId,
    entity: 'fee_payment',
    entity_id: payment.id,
    action: 'paid',
    before: { invoice: invoiceState(invoice) },
    after: {
      invoice_id: invoice.id,
      receipt_no: payment.receipt_no,
      amount: payment.amount,
      mode: payment.mode,
      reference: payment.reference,
      paid_on: payment.paid_on,
      invoice: next,
    },
    actor_id: input.received_by,
  });
  return { payment, replayed: false };
}

export async function reversePayment(
  manager: EntityManager,
  schoolId: number,
  paymentId: number,
  input: ReversalInput,
): Promise<FeePayment> {
  const found = await manager.findOneBy(FeePayment, { id: paymentId, school_id: schoolId });
  if (!found) throw AppException.notFound('Payment not found', 'PAYMENT_NOT_FOUND');
  const invoice = await manager.findOne(FeeInvoice, {
    where: { id: found.invoice_id, school_id: schoolId },
    lock: { mode: 'pessimistic_write' },
  });
  if (!invoice) throw AppException.notFound('Invoice not found', 'INVOICE_NOT_FOUND');
  await assertYearTakesMoney(manager, invoice.academic_year_id);
  const payment = await manager.findOneOrFail(FeePayment, {
    where: { id: paymentId },
    lock: { mode: 'pessimistic_write' },
  });
  if (payment.status === 'reversed') {
    throw AppException.conflict('This payment is already reversed', 'PAYMENT_ALREADY_REVERSED');
  }
  const next = reverseAmounts(invoice, payment.amount);
  const reversedAt = new Date();
  await manager.update(FeePayment, payment.id, {
    status: 'reversed',
    reversed_at: reversedAt,
    reversed_by: input.reversed_by,
    reversal_reason: input.reason,
  });
  await manager.update(FeeInvoice, invoice.id, next);
  if (payment.mode === 'credit') {
    await manager.save(
      manager.create(FeeCredit, {
        school_id: schoolId,
        student_id: payment.student_id,
        kind: 'returned',
        amount: payment.amount,
        payment_id: payment.id,
        invoice_id: invoice.id,
        created_by: input.reversed_by,
      }),
    );
  }
  await recordFeeAudit(manager, {
    school_id: schoolId,
    entity: 'fee_payment',
    entity_id: payment.id,
    action: 'reversed',
    before: { status: payment.status, amount: payment.amount, invoice: invoiceState(invoice) },
    after: { status: 'reversed', invoice: next },
    reason: input.reason,
    actor_id: input.reversed_by,
  });
  return Object.assign(payment, {
    status: 'reversed' as const,
    reversed_at: reversedAt,
    reversed_by: input.reversed_by,
    reversal_reason: input.reason,
  });
}

function planShares(plans: FeePlan[]): PlanShare[] {
  const parts = new Map<string, PlanShare>();
  for (const plan of plans) {
    const part = parts.get(plan.installment) ?? { installment: plan.installment, due_date: plan.due_date, lines: [] };
    part.lines.push({ fee_head_id: plan.fee_head_id, amount: plan.amount });
    parts.set(plan.installment, part);
  }
  return [...parts.values()];
}

async function benefitRules(
  manager: EntityManager,
  schoolId: number,
  yearId: number,
  students: { id: number; class_id: number }[],
): Promise<Map<number, BenefitRule[]>> {
  const result = new Map<number, BenefitRule[]>();
  if (!students.length) return result;
  const classOf = new Map(students.map((student) => [student.id, student.class_id]));
  const rows: {
    award_id: number;
    student_id: number;
    benefit_id: number;
    kind: BenefitRule['kind'];
    name: string;
    calc_type: BenefitRule['calc_type'];
    value: string;
    fee_head_ids: number[];
    class_ids: number[];
  }[] = await manager.query(
    `SELECT a.id AS award_id, a.student_id, b.id AS benefit_id, b.kind, b.name, b.calc_type, b.value,
            b.fee_head_ids, b.class_ids
     FROM student_fee_benefits a
     JOIN fee_benefits b ON b.id = a.benefit_id AND b.deleted_at IS NULL AND b.is_active = true
     WHERE a.school_id = $1 AND a.academic_year_id = $2 AND a.status = 'active' AND a.deleted_at IS NULL
       AND a.student_id = ANY($3)`,
    [schoolId, yearId, students.map((student) => student.id)],
  );
  for (const row of rows) {
    const studentId = Number(row.student_id);
    const classIds = (row.class_ids ?? []).map(Number);
    if (classIds.length && !classIds.includes(classOf.get(studentId)!)) continue;
    const list = result.get(studentId) ?? [];
    list.push({
      award_id: Number(row.award_id),
      benefit_id: Number(row.benefit_id),
      kind: row.kind,
      name: row.name,
      calc_type: row.calc_type,
      value: Number(row.value),
      fee_head_ids: (row.fee_head_ids ?? []).map(Number),
    });
    result.set(studentId, list);
  }
  return result;
}

export function invoiceState(invoice: FeeInvoice): Record<string, unknown> {
  return {
    gross: invoice.gross,
    benefit: invoice.benefit,
    discount: invoice.discount,
    total: invoice.total,
    paid: invoice.paid,
    balance: invoice.balance,
    status: invoice.status,
  };
}
