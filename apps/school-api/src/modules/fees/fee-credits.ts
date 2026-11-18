import { EntityManager } from 'typeorm';
import { AppException } from '@app/common';
import { SequencesService } from '../schools/sequences.service';
import { FeeCollection } from './entities/fee-collection.entity';
import { FeeCredit } from './entities/fee-credit.entity';
import { FeeInvoice } from './entities/fee-invoice.entity';
import { FeePayment, PaymentMode } from './entities/fee-payment.entity';
import { recordFeeAudit } from './fee-audit';
import { recordPayment } from './fee-ledger';
import { feeNumber, round2, sumAmounts } from './fees.logic';

const sequences = new SequencesService();

export interface CollectionInput {
  amount: number;
  mode: Exclude<PaymentMode, 'credit'>;
  reference: string | null;
  paid_on: string;
  notes: string | null;
  received_by: number | null;
  idempotency_key: string | null;
  prefer_invoice_id?: number;
}

export interface CollectionOutcome {
  collection: FeeCollection;
  payments: FeePayment[];
  replayed: boolean;
}

export async function creditBalance(manager: EntityManager, studentId: number): Promise<number> {
  const [{ balance }] = await manager.query(
    `SELECT coalesce(sum(amount), 0) AS balance FROM fee_credits WHERE student_id = $1 AND deleted_at IS NULL`,
    [studentId],
  );
  return round2(Number(balance));
}

async function lockStudent(manager: EntityManager, schoolId: number, studentId: number): Promise<void> {
  await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`fee_student:${schoolId}:${studentId}`]);
}

async function openInvoices(
  manager: EntityManager,
  schoolId: number,
  studentId: number,
  only?: number[],
  prefer?: number,
) {
  const qb = manager
    .getRepository(FeeInvoice)
    .createQueryBuilder('i')
    .innerJoin('academic_years', 'y', `y.id = i.academic_year_id AND y.status <> 'archived'`)
    .where('i.school_id = :schoolId AND i.student_id = :studentId', { schoolId, studentId })
    .andWhere(`i.status IN ('unpaid', 'partly_paid') AND i.balance > 0`)
    .orderBy('i.due_date', 'ASC')
    .addOrderBy('i.id', 'ASC');
  if (only?.length) qb.andWhere('i.id IN (:...only)', { only });
  const rows = await qb.getMany();
  return prefer ? [...rows.filter((row) => row.id === prefer), ...rows.filter((row) => row.id !== prefer)] : rows;
}

export async function collectForStudent(
  manager: EntityManager,
  schoolId: number,
  studentId: number,
  input: CollectionInput,
): Promise<CollectionOutcome> {
  await lockStudent(manager, schoolId, studentId);
  if (input.idempotency_key) {
    const earlier = await manager.findOneBy(FeeCollection, {
      school_id: schoolId,
      idempotency_key: input.idempotency_key,
    });
    if (earlier) {
      if (earlier.student_id !== studentId || round2(earlier.amount) !== round2(input.amount)) {
        throw AppException.conflict(
          'This Idempotency-Key was already used for a different payment',
          'IDEMPOTENCY_CONFLICT',
        );
      }
      const payments = await manager.find(FeePayment, { where: { collection_id: earlier.id }, order: { id: 'ASC' } });
      return { collection: earlier, payments, replayed: true };
    }
  }
  const collection = await manager.save(
    manager.create(FeeCollection, {
      school_id: schoolId,
      student_id: studentId,
      amount: input.amount,
      applied_amount: 0,
      advance_amount: 0,
      mode: input.mode,
      reference: input.reference,
      paid_on: input.paid_on,
      notes: input.notes,
      idempotency_key: input.idempotency_key,
      created_by: input.received_by,
    }),
  );
  let left = round2(input.amount);
  const payments: FeePayment[] = [];
  for (const invoice of await openInvoices(manager, schoolId, studentId, undefined, input.prefer_invoice_id)) {
    if (left <= 0) break;
    const part = round2(Math.min(left, invoice.balance));
    const { payment } = await recordPayment(manager, schoolId, invoice.id, {
      amount: part,
      mode: input.mode,
      reference: input.reference,
      paid_on: input.paid_on,
      notes: input.notes,
      received_by: input.received_by,
      collection_id: collection.id,
    });
    payments.push(payment);
    left = round2(left - part);
  }
  let advanceReceipt: string | null = null;
  if (left > 0) {
    const [year] = await manager.query(
      `SELECT to_char(start_date, 'YYYY') AS year FROM academic_years
       WHERE school_id = $1 AND is_current = true AND deleted_at IS NULL`,
      [schoolId],
    );
    const [school] = await manager.query(`SELECT code FROM schools WHERE id = $1`, [schoolId]);
    const startYear = year?.year ?? input.paid_on.slice(0, 4);
    const value = await sequences.next(manager, schoolId, `fee_receipt:${startYear}`);
    advanceReceipt = feeNumber(school?.code ?? 'SCH', 'RCP', startYear, value);
    await manager.save(
      manager.create(FeeCredit, {
        school_id: schoolId,
        student_id: studentId,
        kind: 'advance',
        amount: left,
        collection_id: collection.id,
        created_by: input.received_by,
      }),
    );
  }
  const applied = sumAmounts(payments.map((payment) => payment.amount));
  await manager.update(FeeCollection, collection.id, {
    applied_amount: applied,
    advance_amount: left,
    advance_receipt_no: advanceReceipt,
  });
  await recordFeeAudit(manager, {
    school_id: schoolId,
    entity: 'fee_payment',
    entity_id: null,
    action: 'paid',
    after: {
      collection_id: collection.id,
      student_id: studentId,
      amount: input.amount,
      mode: input.mode,
      applied: payments.map((payment) => ({ invoice_id: payment.invoice_id, amount: payment.amount })),
      advance: left,
      advance_receipt_no: advanceReceipt,
    },
    actor_id: input.received_by,
  });
  return {
    collection: Object.assign(collection, {
      applied_amount: applied,
      advance_amount: left,
      advance_receipt_no: advanceReceipt,
    }),
    payments,
    replayed: false,
  };
}

export async function applyCredit(
  manager: EntityManager,
  schoolId: number,
  studentId: number,
  actorId: number | null,
  paidOn: string,
  only?: number[],
): Promise<FeePayment[]> {
  await lockStudent(manager, schoolId, studentId);
  let credit = await creditBalance(manager, studentId);
  const payments: FeePayment[] = [];
  if (credit <= 0) return payments;
  for (const invoice of await openInvoices(manager, schoolId, studentId, only)) {
    if (credit <= 0) break;
    const part = round2(Math.min(credit, invoice.balance));
    const { payment } = await recordPayment(manager, schoolId, invoice.id, {
      amount: part,
      mode: 'credit',
      reference: null,
      paid_on: paidOn,
      notes: 'Paid from advance credit',
      received_by: actorId,
    });
    await manager.save(
      manager.create(FeeCredit, {
        school_id: schoolId,
        student_id: studentId,
        kind: 'applied',
        amount: -part,
        payment_id: payment.id,
        invoice_id: invoice.id,
        created_by: actorId,
      }),
    );
    payments.push(payment);
    credit = round2(credit - part);
  }
  return payments;
}
