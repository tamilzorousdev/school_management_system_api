import { EntityManager, In, IsNull } from 'typeorm';
import { AppException } from '@app/common';
import { SequencesService } from '../schools/sequences.service';
import { FeeHead } from './entities/fee-head.entity';
import { FeeInvoice } from './entities/fee-invoice.entity';
import { FeeInvoiceLine } from './entities/fee-invoice-line.entity';
import { FeePayment, PaymentMode } from './entities/fee-payment.entity';
import { FeePlan } from './entities/fee-plan.entity';
import { TransportFeeAdjustment } from './entities/transport-fee-adjustment.entity';
import { applyPayment, feeNumber, previousDueDate, sumAmounts, transportCharge } from './fees.logic';
import { RiderFee, ridersWithFee, transportDescription } from './transport-fee-sync.service';

export interface FeeYear {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
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
  total_amount: number;
}

export interface PaymentInput {
  amount: number;
  mode: PaymentMode;
  reference?: string | null;
  paid_on: string;
  notes?: string | null;
  received_by: number | null;
}

const sequences = new SequencesService();

async function schoolCode(manager: EntityManager, schoolId: number): Promise<string> {
  const [row] = await manager.query(`SELECT code FROM schools WHERE id = $1`, [schoolId]);
  return row?.code ?? 'SCH';
}

const startYear = (year: FeeYear) => year.start_date.slice(0, 4);

export async function generateInvoices(manager: EntityManager, input: GenerateInput): Promise<GenerateOutcome> {
  const { school_id: schoolId, year, installment } = input;
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
  const riders = new Map<number, RiderFee>();
  const adjustments = new Map<number, TransportFeeAdjustment[]>();
  if (transportHead && pending.length) {
    const found = await ridersWithFee(
      manager,
      schoolId,
      pending.map((student) => student.id),
      latestDue,
    );
    for (const rider of found.values()) {
      if (rider.monthly_fee > 0) riders.set(rider.student_id, rider);
    }
    const open = await manager.find(TransportFeeAdjustment, {
      where: {
        school_id: schoolId,
        student_id: In(pending.map((student) => student.id)),
        applied_invoice_id: IsNull(),
      },
      order: { id: 'ASC' },
    });
    for (const row of open) adjustments.set(row.student_id, [...(adjustments.get(row.student_id) ?? []), row]);
  }

  const code = await schoolCode(manager, schoolId);
  const created: FeeInvoice[] = [];
  let withTransport = 0;
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
        description: transportDescription(rider.stop, rider.monthly_fee, charge.months),
        amount: charge.amount,
        kind: 'transport',
        route_id: rider.route_id,
        stop_id: rider.stop_id,
        drop_stop_id: rider.drop_stop_id,
        monthly_rate: rider.monthly_fee,
        months: charge.months,
      });
      withTransport += 1;
    }
    const owed = transportHead ? (adjustments.get(student.id) ?? []) : [];
    for (const adjustment of owed) {
      lines.push({
        fee_head_id: transportHead!.id,
        head_name: transportHead!.name,
        description: adjustment.reason,
        amount: Number(adjustment.amount),
        kind: 'transport_adjustment',
      });
    }
    const gross = sumAmounts(lines.map((line) => line.amount ?? 0));
    if (gross <= 0) continue;
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
        discount: 0,
        total: gross,
        paid: 0,
        balance: gross,
        status: 'unpaid',
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
    if (owed.length) {
      await manager.update(
        TransportFeeAdjustment,
        { id: In(owed.map((adjustment) => adjustment.id)) },
        { applied_invoice_id: invoice.id },
      );
    }
    created.push(invoice);
  }
  return {
    classes: classIds.length,
    created,
    already_invoiced: students.length - pending.length,
    with_transport: withTransport,
    total_amount: sumAmounts(created.map((invoice) => invoice.total)),
  };
}

export async function recordPayment(
  manager: EntityManager,
  schoolId: number,
  invoiceId: number,
  input: PaymentInput,
): Promise<FeePayment> {
  const invoice = await manager.findOne(FeeInvoice, {
    where: { id: invoiceId, school_id: schoolId },
    lock: { mode: 'pessimistic_write' },
  });
  if (!invoice) throw AppException.notFound('Invoice not found', 'INVOICE_NOT_FOUND');
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
      created_by: input.received_by,
    }),
  );
  await manager.update(FeeInvoice, invoice.id, next);
  return payment;
}
