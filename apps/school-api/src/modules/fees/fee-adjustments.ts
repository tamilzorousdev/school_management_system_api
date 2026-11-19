import { EntityManager } from 'typeorm';
import { AppException } from '@app/common';
import { rupees } from '../payroll/payroll.calc';
import { SequencesService } from '../schools/sequences.service';
import { FeeHead } from './entities/fee-head.entity';
import { FeeInvoiceLine } from './entities/fee-invoice-line.entity';
import { FeeInvoice } from './entities/fee-invoice.entity';
import { PaymentMode } from './entities/fee-payment.entity';
import { FeeRefund } from './entities/fee-refund.entity';
import { FeeSettings } from './entities/fee-settings.entity';
import { recordFeeAudit } from './fee-audit';
import { assertYearTakesMoney, invoiceState } from './fee-ledger';
import { applyDiscount, feeNumber, invoiceStatus, lateFeeAmount, round2, sumAmounts } from './fees.logic';

const sequences = new SequencesService();

export async function lockedInvoice(manager: EntityManager, schoolId: number, invoiceId: number): Promise<FeeInvoice> {
  const invoice = await manager.findOne(FeeInvoice, {
    where: { id: invoiceId, school_id: schoolId },
    lock: { mode: 'pessimistic_write' },
  });
  if (!invoice) throw AppException.notFound('Invoice not found', 'INVOICE_NOT_FOUND');
  await assertYearTakesMoney(manager, invoice.academic_year_id);
  return invoice;
}

export async function changeDiscount(
  manager: EntityManager,
  invoice: FeeInvoice,
  discount: number,
  reason: string | null,
  actorId: number | null,
): Promise<void> {
  const next = applyDiscount(invoice, discount);
  const change = { ...next, discount, discount_reason: discount > 0 ? reason : null };
  await manager.update(FeeInvoice, invoice.id, change);
  await recordFeeAudit(manager, {
    school_id: invoice.school_id,
    entity: 'fee_invoice',
    entity_id: invoice.id,
    action: 'discounted',
    before: { ...invoiceState(invoice), discount_reason: invoice.discount_reason },
    after: change,
    reason,
    actor_id: actorId,
  });
}

export function assertReschedulable(
  invoice: FeeInvoice,
  dueDate: string,
  year: { name: string; start_date: string; end_date: string },
): void {
  if (invoice.status === 'cancelled') throw AppException.conflict('This invoice is cancelled', 'INVOICE_CANCELLED');
  if (invoice.balance <= 0) throw AppException.conflict('This invoice is already paid', 'INVOICE_PAID');
  if (dueDate === invoice.due_date) {
    throw AppException.badRequest('The invoice is already due on this date', 'NO_CHANGE');
  }
  if (dueDate < year.start_date || dueDate > year.end_date) {
    throw AppException.validation([
      { field: 'due_date', message: `Due date must be within the ${year.name} academic year` },
    ]);
  }
}

export async function rescheduleInvoice(
  manager: EntityManager,
  invoice: FeeInvoice,
  dueDate: string,
  reason: string,
  actorId: number | null,
): Promise<void> {
  const change = {
    due_date: dueDate,
    original_due_date: invoice.original_due_date ?? invoice.due_date,
    overdue_alerted_at: null,
  };
  await manager.update(FeeInvoice, invoice.id, change);
  await recordFeeAudit(manager, {
    school_id: invoice.school_id,
    entity: 'fee_invoice',
    entity_id: invoice.id,
    action: 'rescheduled',
    before: { due_date: invoice.due_date, original_due_date: invoice.original_due_date },
    after: { due_date: change.due_date, original_due_date: change.original_due_date },
    reason,
    actor_id: actorId,
  });
}

export function assertWriteOff(invoice: FeeInvoice): void {
  if (invoice.status === 'cancelled') throw AppException.conflict('This invoice is cancelled', 'INVOICE_CANCELLED');
  if (invoice.balance <= 0) throw AppException.conflict('This invoice is already paid', 'INVOICE_PAID');
}

export async function writeOffInvoice(
  manager: EntityManager,
  invoice: FeeInvoice,
  reason: string,
  actorId: number | null,
): Promise<void> {
  assertWriteOff(invoice);
  const discount = round2(invoice.discount + invoice.balance);
  const next = applyDiscount(invoice, discount);
  const change = { ...next, discount, discount_reason: `Written off: ${reason}`.slice(0, 200) };
  await manager.update(FeeInvoice, invoice.id, change);
  await recordFeeAudit(manager, {
    school_id: invoice.school_id,
    entity: 'fee_invoice',
    entity_id: invoice.id,
    action: 'written_off',
    before: invoiceState(invoice),
    after: change,
    reason,
    actor_id: actorId,
  });
}

export function assertCancellable(invoice: FeeInvoice): void {
  if (invoice.status === 'cancelled') {
    throw AppException.conflict('This invoice is already cancelled', 'INVOICE_CANCELLED');
  }
  if (invoice.paid > 0) {
    throw AppException.conflict(
      'A payment is recorded on this invoice, so it cannot be cancelled',
      'INVOICE_HAS_PAYMENTS',
    );
  }
}

export async function cancelInvoice(
  manager: EntityManager,
  invoice: FeeInvoice,
  reason: string,
  actorId: number | null,
): Promise<void> {
  assertCancellable(invoice);
  await manager.update(FeeInvoice, invoice.id, {
    status: 'cancelled',
    balance: 0,
    cancelled_at: new Date(),
    cancelled_by: actorId,
    cancel_reason: reason,
  });
  await recordFeeAudit(manager, {
    school_id: invoice.school_id,
    entity: 'fee_invoice',
    entity_id: invoice.id,
    action: 'cancelled',
    before: invoiceState(invoice),
    after: { status: 'cancelled', balance: 0 },
    reason,
    actor_id: actorId,
  });
}

export async function refundable(manager: EntityManager, invoice: FeeInvoice): Promise<number> {
  const lines = await manager
    .getRepository(FeeInvoiceLine)
    .createQueryBuilder('l')
    .innerJoin(FeeHead, 'h', 'h.id = l.fee_head_id AND h.is_refundable = true')
    .where('l.invoice_id = :id', { id: invoice.id })
    .getMany();
  const refundableCharge = sumAmounts(lines.map((line) => line.amount));
  return round2(Math.max(0, Math.min(refundableCharge, invoice.paid) - invoice.refunded));
}

export async function assertRefund(manager: EntityManager, invoice: FeeInvoice, amount: number): Promise<void> {
  if (invoice.status === 'cancelled') {
    throw AppException.conflict('This invoice is cancelled', 'INVOICE_CANCELLED');
  }
  const limit = await refundable(manager, invoice);
  if (limit <= 0) {
    throw AppException.conflict(
      'Nothing on this invoice can be refunded. Only paid amounts of refundable fee heads can be.',
      'NOTHING_TO_REFUND',
    );
  }
  if (round2(amount) > limit) {
    throw AppException.badRequest(`At most ${rupees(limit)} can be refunded on this invoice`, 'REFUND_TOO_HIGH');
  }
}

export interface RefundInput {
  amount: number;
  mode: PaymentMode;
  reference: string | null;
  paid_on: string;
  reason: string;
  request_id: number;
  requested_by: number | null;
}

export async function recordRefund(
  manager: EntityManager,
  invoice: FeeInvoice,
  input: RefundInput,
  approverId: number | null,
): Promise<FeeRefund> {
  await assertRefund(manager, invoice, input.amount);
  const [year] = await manager.query(`SELECT to_char(start_date, 'YYYY') AS year FROM academic_years WHERE id = $1`, [
    invoice.academic_year_id,
  ]);
  const [school] = await manager.query(`SELECT code FROM schools WHERE id = $1`, [invoice.school_id]);
  const startYear = year?.year ?? input.paid_on.slice(0, 4);
  const value = await sequences.next(manager, invoice.school_id, `fee_refund:${startYear}`);
  const refund = await manager.save(
    manager.create(FeeRefund, {
      school_id: invoice.school_id,
      refund_no: feeNumber(school?.code ?? 'SCH', 'RFD', startYear, value),
      invoice_id: invoice.id,
      student_id: invoice.student_id,
      request_id: input.request_id,
      amount: input.amount,
      mode: input.mode,
      reference: input.reference,
      paid_on: input.paid_on,
      reason: input.reason,
      approved_by: approverId,
      created_by: input.requested_by,
    }),
  );
  const refunded = round2(invoice.refunded + input.amount);
  await manager.update(FeeInvoice, invoice.id, { refunded });
  await recordFeeAudit(manager, {
    school_id: invoice.school_id,
    entity: 'fee_refund',
    entity_id: refund.id,
    action: 'refunded',
    before: { invoice_id: invoice.id, refunded: invoice.refunded },
    after: {
      invoice_id: invoice.id,
      refund_no: refund.refund_no,
      amount: refund.amount,
      mode: refund.mode,
      paid_on: refund.paid_on,
      refunded,
    },
    reason: input.reason,
    actor_id: approverId,
  });
  return refund;
}

export interface LateFeeOutcome {
  invoices: number;
  amount: number;
  charged: { student_id: number; installment: string; due_date: string; amount: number; balance: number }[];
}

export async function applyLateFees(
  manager: EntityManager,
  settings: FeeSettings,
  today: string,
  actorId: number | null,
): Promise<LateFeeOutcome> {
  if (settings.late_fee_type === 'none' || settings.late_fee_value <= 0) return { invoices: 0, amount: 0, charged: [] };
  const due: FeeInvoice[] = await manager
    .getRepository(FeeInvoice)
    .createQueryBuilder('i')
    .setLock('pessimistic_write', undefined, ['i'])
    .innerJoin('academic_years', 'y', 'y.id = i.academic_year_id AND y.status IN (:...open)', {
      open: ['active', 'closed'],
    })
    .where('i.school_id = :schoolId', { schoolId: settings.school_id })
    .andWhere(`i.status IN ('unpaid', 'partly_paid') AND i.balance > 0 AND i.late_fee_applied_at IS NULL`)
    .andWhere(`i.due_date + CAST(:grace AS int) < CAST(:today AS date)`, { grace: settings.grace_days, today })
    .getMany();
  let amount = 0;
  let count = 0;
  const charged: LateFeeOutcome['charged'] = [];
  for (const invoice of due) {
    const fee = lateFeeAmount(settings, invoice.balance);
    if (fee <= 0) continue;
    const [{ next }] = await manager.query(
      `SELECT coalesce(max(sort_order), 0) + 1 AS next FROM fee_invoice_lines WHERE invoice_id = $1`,
      [invoice.id],
    );
    await manager.save(
      manager.create(FeeInvoiceLine, {
        school_id: invoice.school_id,
        invoice_id: invoice.id,
        fee_head_id: null,
        head_name: 'Late fee',
        description:
          settings.late_fee_type === 'percent'
            ? `${Number(settings.late_fee_value)}% of ${rupees(invoice.balance)} unpaid after ${settings.grace_days} days`
            : `Unpaid ${settings.grace_days} days after the due date`,
        amount: fee,
        sort_order: Number(next),
        created_by: actorId,
      }),
    );
    const gross = round2(invoice.gross + fee);
    const total = round2(invoice.total + fee);
    const change = {
      gross,
      total,
      balance: round2(total - invoice.paid),
      status: invoiceStatus(total, invoice.paid),
      late_fee: fee,
      late_fee_applied_at: new Date(),
    };
    await manager.update(FeeInvoice, invoice.id, change);
    await recordFeeAudit(manager, {
      school_id: invoice.school_id,
      entity: 'fee_invoice',
      entity_id: invoice.id,
      action: 'late_fee',
      before: invoiceState(invoice),
      after: { ...change, late_fee_applied_at: undefined },
      reason: `Late fee after ${settings.grace_days} days of grace`,
      actor_id: actorId,
    });
    amount = round2(amount + fee);
    count += 1;
    charged.push({
      student_id: invoice.student_id,
      installment: invoice.installment,
      due_date: invoice.due_date,
      amount: fee,
      balance: change.balance,
    });
  }
  return { invoices: count, amount, charged };
}
