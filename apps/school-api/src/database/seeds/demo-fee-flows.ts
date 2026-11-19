import { createHmac } from 'crypto';
import { INestApplicationContext } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthUser } from '@app/common';
import { FeeInvoiceLine } from '../../modules/fees/entities/fee-invoice-line.entity';
import { FeeInvoice } from '../../modules/fees/entities/fee-invoice.entity';
import { recordFeeAudit } from '../../modules/fees/fee-audit';
import { FeeBenefitsService } from '../../modules/fees/fee-benefits.service';
import { FeeFinesService } from '../../modules/fees/fee-fines.service';
import { recordPayment } from '../../modules/fees/fee-ledger';
import { FeeRequestsService } from '../../modules/fees/fee-requests.service';
import { FeeSettingsService } from '../../modules/fees/fee-settings.service';
import { feeNumber, round2 } from '../../modules/fees/fees.logic';
import { FeesService } from '../../modules/fees/fees.service';
import { OnlinePaymentsService } from '../../modules/fees/online-payments.service';
import { RazorpayClient } from '../../modules/fees/razorpay.client';
import { SequencesService } from '../../modules/schools/sequences.service';
import { todayIn } from '../../shared/dates';
import { addDays } from '../../shared/school-days';

const MARKER = 'Sibling concession';
const SCHOOL_CODE = 'TZMS';
const USERS = {
  admin: '9876543210',
  principal: '9000000001',
  ao: '9000000002',
  teacher: '9000000004',
  parent: '9000000005',
  teacherParent: '9000000006',
  accountant: '9000000009',
};

interface InvoiceRow {
  id: number;
  student_id: number;
  invoice_no: string;
  installment: string;
  name: string;
  balance: number;
  paid: number;
  due_date: string;
}

interface ClassRow {
  id: number;
  name: string;
  grade_level: number;
}

interface Children {
  kavin: number;
  nila: number;
  harini: number;
}

interface Context {
  db: DataSource;
  fees: FeesService;
  requests: FeeRequestsService;
  benefits: FeeBenefitsService;
  settings: FeeSettingsService;
  online: OnlinePaymentsService;
  fines: FeeFinesService;
  razorpay: RazorpayClient;
  schoolId: number;
  yearId: number;
  yearEnd: string;
  today: string;
  actors: Record<keyof typeof USERS, AuthUser>;
  children: Children;
  heads: Record<string, number>;
  used: Set<number>;
  rows: string[][];
}

function shiftMonth(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1 + months, Math.min(day!, 28))).toISOString().slice(0, 10);
}

function note(ctx: Context, flow: string, who: string, where: string, detail: string): void {
  ctx.rows.push([flow, who, where, detail]);
}

async function actorFor(db: DataSource, mobile: string): Promise<AuthUser> {
  const [row] = await db.query(
    `SELECT u.id, u.school_id, u.name, u.mobile, array_agg(r.code) AS roles
     FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
     WHERE u.mobile = $1 AND u.deleted_at IS NULL GROUP BY u.id`,
    [mobile],
  );
  if (!row) throw new Error(`Demo user ${mobile} is missing. Run npm run seed:demo first.`);
  return {
    id: Number(row.id),
    session_id: 0,
    school_id: row.school_id === null ? null : Number(row.school_id),
    name: row.name,
    mobile: row.mobile,
    roles: row.roles,
    permissions: [],
  };
}

async function childrenOf(db: DataSource, mobile: string, yearId: number): Promise<number[]> {
  const rows: { id: number }[] = await db.query(
    `SELECT s.id FROM guardians g
     JOIN users u ON u.id = g.user_id AND u.mobile = $1
     JOIN student_guardians sg ON sg.guardian_id = g.id
     JOIN students s ON s.id = sg.student_id AND s.deleted_at IS NULL
     JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = $2
     JOIN classes c ON c.id = e.class_id
     ORDER BY c.grade_level DESC, s.id`,
    [mobile, yearId],
  );
  return rows.map((row) => Number(row.id));
}

async function invoiceRows(ctx: Context, where: string, params: unknown[]): Promise<InvoiceRow[]> {
  const rows: Record<string, string>[] = await ctx.db.query(
    `SELECT i.id, i.student_id, i.invoice_no, i.installment, i.balance, i.paid,
            to_char(i.due_date, 'YYYY-MM-DD') AS due_date, concat_ws(' ', s.first_name, s.last_name) AS name
     FROM fee_invoices i JOIN students s ON s.id = i.student_id
     WHERE i.school_id = $1 AND i.academic_year_id = $2 AND i.deleted_at IS NULL AND ${where}
     ORDER BY i.due_date, i.id`,
    [ctx.schoolId, ctx.yearId, ...params],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    student_id: Number(row.student_id),
    invoice_no: row.invoice_no!,
    installment: row.installment!,
    name: row.name!,
    balance: Number(row.balance),
    paid: Number(row.paid),
    due_date: row.due_date!,
  }));
}

async function pick(ctx: Context, flow: string, where: string, params: unknown[] = []): Promise<InvoiceRow> {
  const [row] = await invoiceRows(ctx, `NOT (i.student_id = ANY($3)) AND ${where}`, [[...ctx.used], ...params]);
  if (!row) throw new Error(`No demo invoice left for “${flow}”. Run it on a fresh npm run seed:demo database.`);
  ctx.used.add(row.student_id);
  return row;
}

const unpaid = (installment: string) => `i.installment = '${installment}' AND i.status = 'unpaid'`;

async function openInvoices(ctx: Context, studentId: number): Promise<InvoiceRow[]> {
  return invoiceRows(ctx, `i.student_id = $3 AND i.status IN ('unpaid', 'partly_paid')`, [studentId]);
}

async function seedSettings(ctx: Context): Promise<void> {
  await ctx.settings.update(
    ctx.schoolId,
    { grace_days: 7, late_fee_type: 'flat', late_fee_value: 250 },
    ctx.actors.admin,
  );
  note(ctx, 'Late fee settings', 'School Admin', 'Fees › Settings', '7 grace days, flat ₹250 after that');
}

async function seedHeads(ctx: Context, seniorClassIds: number[]): Promise<void> {
  const heads = [
    { name: 'Exam fee', code: 'EXAM', frequency: 'per_term' as const, fee_group: 'Academic' },
    {
      name: 'Caution deposit',
      code: 'CAUTION',
      frequency: 'one_time' as const,
      is_refundable: true,
      description: 'Returned when the student leaves',
    },
    {
      name: 'Computer lab',
      code: 'LAB',
      frequency: 'per_term' as const,
      is_mandatory: false,
      applicable_class_ids: seniorClassIds,
    },
    { name: 'Admission fee', code: 'ADMISSION', frequency: 'one_time' as const, fee_group: 'Admission' },
    { name: 'Old uniform fee', code: 'UNIFORM', frequency: 'yearly' as const, is_active: false },
  ];
  for (const head of heads) {
    const saved = await ctx.fees.createHead(ctx.schoolId, head, ctx.actors.admin);
    ctx.heads[head.code] = saved.id;
  }
  note(
    ctx,
    'Fee heads',
    'School Admin',
    'Fees › Fee heads',
    'Exam, Caution deposit (refundable), Lab (classes 6+), Admission, Uniform (off)',
  );
}

async function seedBenefits(ctx: Context, gradeOneClassId: number): Promise<void> {
  const admin = ctx.actors.admin;
  const tuition = [ctx.heads.TUITION!];
  const create = (input: Parameters<FeeBenefitsService['create']>[1]) =>
    ctx.benefits.create(ctx.schoolId, { academic_year_id: ctx.yearId, ...input }, admin);
  const sibling = await create({
    kind: 'concession',
    name: MARKER,
    type: 'sibling',
    calc_type: 'percent',
    value: 10,
    fee_head_ids: tuition,
  });
  const staff = await create({
    kind: 'concession',
    name: 'Staff child concession',
    type: 'staff_child',
    calc_type: 'percent',
    value: 50,
    fee_head_ids: tuition,
  });
  const sports = await create({
    kind: 'concession',
    name: 'Sports quota',
    type: 'sports',
    calc_type: 'fixed',
    value: 3000,
  });
  await create({
    kind: 'concession',
    name: 'Financial aid',
    type: 'financial',
    calc_type: 'percent',
    value: 25,
    is_active: false,
  });
  const merit = await create({
    kind: 'scholarship',
    name: 'Merit scholarship',
    type: 'trust',
    calc_type: 'fixed',
    value: 4000,
    description: 'Ramanathan Trust, top 3 in the class',
  });
  const rte = await create({
    kind: 'scholarship',
    name: 'RTE scholarship',
    type: 'government',
    calc_type: 'percent',
    value: 100,
    fee_head_ids: tuition,
    class_ids: [gradeOneClassId],
  });

  const { nila, harini } = ctx.children;
  const award = (benefitId: number, studentIds: number[], reason: string) =>
    ctx.benefits.award(ctx.schoolId, { benefit_id: benefitId, student_ids: studentIds, reason }, admin);
  await award(sibling.id, [nila], 'Elder brother Kavin studies in class 6');
  await award(staff.id, [harini], 'Father Arun Prakash teaches here');
  const [meritPick] = await invoiceRows(
    ctx,
    `i.class_id = (SELECT class_id FROM student_enrollments WHERE student_id = $3 AND academic_year_id = $4) AND i.student_id <> $3 AND i.installment = 'Term 1'`,
    [harini, ctx.yearId],
  );
  await award(merit.id, [harini, ...(meritPick ? [meritPick.student_id] : [])], 'Class topper in the annual exam');
  const [rtePick] = await invoiceRows(ctx, `i.class_id = $3 AND i.installment = 'Term 1'`, [gradeOneClassId]);
  if (rtePick) await award(rte.id, [rtePick.student_id], 'RTE 25% quota admission');
  const sportsPick = await pick(ctx, 'Sports quota award', `i.installment = 'Term 1'`);
  const sportsAward = await award(sports.id, [sportsPick.student_id], 'District football team');
  await ctx.benefits.revoke(ctx.schoolId, sportsAward.items[0]!.id, { reason: 'Left the district team' }, admin);

  note(ctx, 'Concession', 'Nila (parent 9000000005)', MARKER, '10% of tuition on new invoices');
  note(
    ctx,
    'Concession + scholarship stack',
    'Harini (parent 9000000006)',
    'Staff child 50% + Merit ₹4,000/yr',
    'Both apply to Term 3',
  );
  if (meritPick) note(ctx, 'Scholarship', meritPick.name, 'Merit scholarship', 'Fixed ₹4,000 spread over installments');
  if (rtePick)
    note(ctx, 'Class-only scholarship', rtePick.name, 'RTE scholarship (class 1 only)', '100% tuition on Term 3');
  note(ctx, 'Award withdrawn', sportsPick.name, 'Sports quota', 'Awarded, then revoked');
  note(ctx, 'Switched-off benefit', '-', 'Financial aid', 'Inactive, cannot be awarded');
}

async function seedPreviousDues(ctx: Context): Promise<void> {
  const [year] = await ctx.db.query(
    `SELECT id, name, to_char(start_date, 'YYYY') AS start FROM academic_years
     WHERE school_id = $1 AND deleted_at IS NULL AND start_date < (SELECT start_date FROM academic_years WHERE id = $2)
     ORDER BY start_date DESC LIMIT 1`,
    [ctx.schoolId, ctx.yearId],
  );
  if (!year) return;
  const plan = [
    { student: ctx.children.kavin, paid: 9000, label: 'Kavin (parent 9000000005)' },
    { student: ctx.children.harini, paid: 13400, label: 'Harini (parent 9000000006)' },
  ];
  const sequences = new SequencesService();
  for (const item of plan) {
    const [enrolment] = await ctx.db.query(
      `SELECT class_id, section_id FROM student_enrollments WHERE student_id = $1 AND academic_year_id = $2`,
      [item.student, year.id],
    );
    if (!enrolment) continue;
    const invoiceNo = await ctx.db.transaction(async (manager) => {
      const value = await sequences.next(manager, ctx.schoolId, `fee_invoice:${year.start}`);
      const lines = [
        { fee_head_id: ctx.heads.TUITION!, head_name: 'Tuition fee', amount: 11500 },
        { fee_head_id: ctx.heads.BOOKS!, head_name: 'Books and stationery', amount: 1900 },
      ];
      const gross = 13400;
      const invoice = await manager.save(
        manager.create(FeeInvoice, {
          school_id: ctx.schoolId,
          academic_year_id: Number(year.id),
          student_id: item.student,
          class_id: Number(enrolment.class_id),
          section_id: enrolment.section_id === null ? null : Number(enrolment.section_id),
          invoice_no: feeNumber(SCHOOL_CODE, 'FEE', year.start, value),
          installment: 'Term 2',
          due_date: `${Number(year.start) + 1}-01-10`,
          gross,
          benefit: 0,
          discount: 0,
          total: gross,
          paid: 0,
          balance: gross,
          status: 'unpaid',
          created_by: ctx.actors.admin.id,
        }),
      );
      await manager.save(
        lines.map((line, index) =>
          manager.create(FeeInvoiceLine, {
            ...line,
            school_id: ctx.schoolId,
            invoice_id: invoice.id,
            sort_order: index,
          }),
        ),
      );
      await recordFeeAudit(manager, {
        school_id: ctx.schoolId,
        entity: 'invoice_run',
        entity_id: null,
        action: 'generated',
        after: { academic_year_id: Number(year.id), installment: 'Term 2', invoice_ids: [invoice.id] },
        reason: 'Demo data: last year’s invoice',
        actor_id: ctx.actors.admin.id,
      });
      await recordPayment(manager, ctx.schoolId, invoice.id, {
        amount: item.paid,
        mode: 'cash',
        paid_on: `${Number(year.start) + 1}-01-08`,
        received_by: ctx.actors.accountant.id,
      });
      return invoice.invoice_no;
    });
    note(
      ctx,
      item.paid < 13400 ? 'Previous year dues' : 'Previous year paid',
      item.label,
      `${invoiceNo} (${year.name})`,
      item.paid < 13400 ? `₹${13400 - item.paid} still due, shown as previous dues` : 'Fully paid, no previous dues',
    );
  }
}

async function seedCollections(ctx: Context): Promise<{ chequePaymentId: number; cardPaymentId: number }> {
  const accountant = ctx.actors.accountant;
  const daysAgo = (days: number) => addDays(ctx.today, -days);

  const both = await pick(
    ctx,
    'Collect two installments',
    `i.installment = 'Term 1' AND i.status = 'unpaid' AND EXISTS (SELECT 1 FROM fee_invoices t WHERE t.student_id = i.student_id AND t.installment = 'Term 2' AND t.status = 'unpaid')`,
  );
  const owed = round2((await openInvoices(ctx, both.student_id)).reduce((sum, row) => sum + row.balance, 0));
  await ctx.fees.collect(
    ctx.schoolId,
    both.student_id,
    { amount: owed, mode: 'upi', reference: 'UPI604512378812', paid_on: daysAgo(6) },
    'seed-collect-two-terms',
    accountant,
  );
  note(
    ctx,
    'One payment, two installments',
    both.name,
    'Collect fee (Accountant)',
    `₹${owed} UPI paid Term 1 then Term 2`,
  );

  const advance = await pick(
    ctx,
    'Advance payment',
    `i.installment = 'Term 2' AND i.status IN ('unpaid', 'partly_paid') AND i.class_id IN (SELECT id FROM classes WHERE grade_level IN (1, 3, 6, 7))`,
  );
  await ctx.fees.collect(
    ctx.schoolId,
    advance.student_id,
    {
      amount: round2(advance.balance + 3000),
      mode: 'bank_transfer',
      reference: 'NEFT N318260045521',
      paid_on: daysAgo(4),
      notes: 'Parent paid ahead for Term 3',
    },
    'seed-collect-advance',
    accountant,
  );
  note(
    ctx,
    'Advance payment',
    advance.name,
    `${advance.invoice_no} + ₹3,000 credit`,
    'Credit used automatically on Term 3',
  );

  await ctx.fees.collect(
    ctx.schoolId,
    ctx.children.nila,
    { amount: 6000, mode: 'cash', paid_on: daysAgo(3), notes: 'Advance for Term 3' },
    'seed-collect-nila-advance',
    accountant,
  );
  note(ctx, 'Advance with nothing due', 'Nila (parent 9000000005)', 'Advance receipt', '₹6,000 credit, used on Term 3');

  const cheque = await ctx.fees.collect(
    ctx.schoolId,
    ctx.children.harini,
    { amount: 5000, mode: 'cheque', reference: 'CHQ 004512 / Indian Bank', paid_on: daysAgo(10) },
    'seed-collect-harini-cheque',
    accountant,
  );

  const card = await pick(ctx, 'Card payment', `i.installment = 'Term 2' AND i.status = 'unpaid'`);
  const cardPayment = await ctx.fees.pay(
    ctx.schoolId,
    card.id,
    { amount: 4000, mode: 'card', reference: 'POS 778812', paid_on: daysAgo(2) },
    accountant,
    'seed-pay-card-partial',
  );
  note(ctx, 'Part payment by card', card.name, card.invoice_no, '₹4,000 of the balance');

  return { chequePaymentId: cheque.payments[0]!.id, cardPaymentId: cardPayment.id };
}

async function seedRequests(ctx: Context, payments: { chequePaymentId: number; cardPaymentId: number }): Promise<void> {
  const { accountant, principal, admin, ao } = ctx.actors;
  const school = ctx.schoolId;
  const r = ctx.requests;

  const approvedDiscount = await pick(ctx, 'Discount approved', unpaid('Term 2'));
  const discount = await r.requestDiscount(
    school,
    approvedDiscount.id,
    { discount: 1500, reason: 'Father was in hospital for a month' },
    accountant,
  );
  await r.approve(school, discount.id, { comment: 'Approved once, for this term' }, principal);
  note(ctx, 'Discount approved (Principal)', approvedDiscount.name, approvedDiscount.invoice_no, '₹1,500 off');

  const rejectedDiscount = await pick(ctx, 'Discount rejected', unpaid('Term 2'));
  const rejected = await r.requestDiscount(
    school,
    rejectedDiscount.id,
    { discount: 5000, reason: 'Parent asked at the PTA meeting' },
    accountant,
  );
  await r.reject(school, rejected.id, { comment: 'Apply for the Financial aid scheme instead' }, admin);
  note(ctx, 'Discount rejected (Admin)', rejectedDiscount.name, rejectedDiscount.invoice_no, '₹5,000 asked');

  const withdrawnDiscount = await pick(ctx, 'Discount withdrawn', unpaid('Term 2'));
  const withdrawn = await r.requestDiscount(
    school,
    withdrawnDiscount.id,
    { discount: 800, reason: 'Late bus pass' },
    accountant,
  );
  await r.withdraw(school, withdrawn.id, accountant);
  note(
    ctx,
    'Discount withdrawn (Accountant)',
    withdrawnDiscount.name,
    withdrawnDiscount.invoice_no,
    'Asked by mistake',
  );

  const kavinOpen = await openInvoices(ctx, ctx.children.kavin);
  const kavinLast = kavinOpen[kavinOpen.length - 1];
  if (kavinLast) {
    await r.requestDiscount(
      school,
      kavinLast.id,
      { discount: 1000, reason: 'Bus route started a month late' },
      accountant,
    );
    note(
      ctx,
      'Discount waiting for approval',
      'Kavin (parent 9000000005)',
      kavinLast.invoice_no,
      '₹1,000, approve as AO, Principal or Admin',
    );
  }

  const cancelled = await pick(ctx, 'Cancel approved', unpaid('Term 2'));
  const cancel = await r.requestCancel(school, cancelled.id, { reason: 'Invoice raised twice by mistake' }, accountant);
  await r.approve(school, cancel.id, {}, ao);
  note(ctx, 'Cancel approved (AO)', cancelled.name, cancelled.invoice_no, 'Invoice cancelled');

  const cancelPending = await pick(ctx, 'Cancel pending', unpaid('Term 2'));
  await r.requestCancel(school, cancelPending.id, { reason: 'Student moving to another branch' }, accountant);
  note(ctx, 'Cancel waiting for approval', cancelPending.name, cancelPending.invoice_no, '-');

  const reversal = await r.requestReversal(
    school,
    payments.chequePaymentId,
    { reason: 'Cheque 004512 bounced' },
    accountant,
  );
  await r.approve(school, reversal.id, { comment: 'Bank return memo seen' }, ao);
  note(ctx, 'Payment reversed (AO)', 'Harini (parent 9000000006)', 'Cheque ₹5,000', 'Shows struck out in the app');

  await r.requestReversal(
    school,
    payments.cardPaymentId,
    { reason: 'Card charge-back raised by the bank' },
    accountant,
  );
  note(ctx, 'Reversal waiting for approval', '-', 'Card ₹4,000', '-');

  const moved = await pick(ctx, 'Reschedule approved', unpaid('Term 2'));
  const reschedule = await r.requestReschedule(
    school,
    moved.id,
    { due_date: addDays(moved.due_date, 21), reason: 'Salary delayed, parent wrote in' },
    accountant,
  );
  await r.approve(school, reschedule.id, {}, admin);
  note(
    ctx,
    'Due date moved (Admin)',
    moved.name,
    moved.invoice_no,
    `${moved.due_date} → ${addDays(moved.due_date, 21)}`,
  );

  const harini = (await openInvoices(ctx, ctx.children.harini)).pop();
  if (harini) {
    await r.requestReschedule(
      school,
      harini.id,
      { due_date: addDays(harini.due_date, 15), reason: 'Family function this month' },
      accountant,
    );
    note(ctx, 'Reschedule waiting for approval', 'Harini (parent 9000000006)', harini.invoice_no, '+15 days');
  }

  const writtenOff = await pick(ctx, 'Write-off approved', unpaid('Term 1'));
  const writeOff = await r.requestWriteOff(
    school,
    writtenOff.id,
    { reason: 'Family moved abroad, TC issued, dues not recoverable' },
    accountant,
  );
  await r.approve(school, writeOff.id, {}, ao);
  note(ctx, 'Write-off approved (AO)', writtenOff.name, writtenOff.invoice_no, 'Balance becomes 0');

  const writeOffPending = await pick(ctx, 'Write-off pending', `i.installment = 'Term 1' AND i.status = 'partly_paid'`);
  await r.requestWriteOff(
    school,
    writeOffPending.id,
    { reason: 'Parent passed away; balance to be waived' },
    accountant,
  );
  note(ctx, 'Write-off waiting for approval', writeOffPending.name, writeOffPending.invoice_no, '-');
}

async function seedPlans(ctx: Context, classes: ClassRow[], dueDate: string): Promise<void> {
  const { admin, principal, ao } = ctx.actors;
  const flows: [number, 'principal' | 'ao' | 'pending' | 'rejected' | 'draft'][] = [
    [0, 'principal'],
    [1, 'principal'],
    [3, 'principal'],
    [6, 'ao'],
    [7, 'ao'],
    [2, 'pending'],
    [4, 'rejected'],
    [5, 'draft'],
  ];
  for (const [grade, flow] of flows) {
    const schoolClass = classes.find((row) => row.grade_level === grade);
    if (!schoolClass) continue;
    const plan = await ctx.fees.getPlan(ctx.schoolId, schoolClass.id);
    if (plan.draft) {
      note(ctx, 'Plan skipped', `Class ${schoolClass.name}`, 'Plan', 'Already has a draft or pending change');
      continue;
    }
    const tuition = plan.lines.find((line) => line.fee_head_id === ctx.heads.TUITION)?.amount ?? 9000;
    const lines = [
      ...plan.lines.map((line) => ({
        fee_head_id: line.fee_head_id,
        installment: line.installment,
        amount: line.amount,
        due_date: line.due_date,
      })),
      { fee_head_id: ctx.heads.TUITION!, installment: 'Term 3', amount: tuition, due_date: dueDate },
      { fee_head_id: ctx.heads.EXAM!, installment: 'Term 3', amount: grade === 4 ? 1500 : 1200, due_date: dueDate },
      { fee_head_id: ctx.heads.CAUTION!, installment: 'Term 3', amount: 2000, due_date: dueDate },
      ...(grade >= 6 ? [{ fee_head_id: ctx.heads.LAB!, installment: 'Term 3', amount: 1500, due_date: dueDate }] : []),
    ];
    await ctx.fees.setPlan(ctx.schoolId, schoolClass.id, { lines }, admin);
    if (flow === 'draft') {
      note(ctx, 'Plan draft (not sent)', `Class ${schoolClass.name}`, 'Fees › Plans', 'Term 3 added, not submitted');
      continue;
    }
    await ctx.fees.submitPlan(
      ctx.schoolId,
      schoolClass.id,
      { note: 'Adds Term 3: tuition, exam fee and caution deposit' },
      admin,
    );
    if (flow === 'principal' || flow === 'ao') {
      await ctx.fees.approvePlan(
        ctx.schoolId,
        schoolClass.id,
        { comment: 'Matches the fee committee minutes' },
        flow === 'ao' ? ao : principal,
      );
      note(
        ctx,
        `Plan approved (${flow === 'ao' ? 'AO' : 'Principal'})`,
        `Class ${schoolClass.name}`,
        'Fees › Plans',
        'Version 2 published with Term 3',
      );
    } else if (flow === 'rejected') {
      await ctx.fees.rejectPlan(
        ctx.schoolId,
        schoolClass.id,
        { comment: 'Exam fee should be ₹1,200 like other classes' },
        ao,
      );
      note(ctx, 'Plan sent back (AO)', `Class ${schoolClass.name}`, 'Fees › Plans', 'Back to draft with a comment');
    } else {
      note(
        ctx,
        'Plan waiting for approval',
        `Class ${schoolClass.name}`,
        'Fees › Plans',
        'Approve as AO, Principal or Admin',
      );
    }
  }
}

async function seedTermThree(ctx: Context): Promise<void> {
  const result = await ctx.fees.generate(ctx.schoolId, { installment: 'Term 3' }, ctx.actors.admin);
  note(
    ctx,
    'Generate Term 3',
    `${result.created} invoices`,
    `${result.with_transport} with bus fee, ${result.with_benefits} with benefits`,
    'Advance credit applied on generation',
  );

  const accountant = ctx.actors.accountant;
  const refunded = await pick(ctx, 'Refund approved', `i.installment = 'Term 3' AND i.status = 'unpaid'`);
  await ctx.fees.pay(
    ctx.schoolId,
    refunded.id,
    { amount: refunded.balance, mode: 'upi', reference: 'UPI604599120044', paid_on: addDays(ctx.today, -1) },
    accountant,
    'seed-pay-term3-refund',
  );
  const refund = await ctx.requests.requestRefund(
    ctx.schoolId,
    refunded.id,
    {
      amount: 2000,
      mode: 'bank_transfer',
      reference: 'NEFT N318260078810',
      reason: 'Leaving after this term, caution deposit returned',
    },
    accountant,
  );
  await ctx.requests.approve(ctx.schoolId, refund.id, {}, ctx.actors.principal);
  note(ctx, 'Refund approved (Principal)', refunded.name, refunded.invoice_no, '₹2,000 caution deposit returned');

  const refundPending = await pick(ctx, 'Refund pending', `i.installment = 'Term 3' AND i.status = 'unpaid'`);
  await ctx.fees.pay(
    ctx.schoolId,
    refundPending.id,
    { amount: refundPending.balance, mode: 'cash', paid_on: ctx.today },
    accountant,
    'seed-pay-term3-refund-pending',
  );
  await ctx.requests.requestRefund(
    ctx.schoolId,
    refundPending.id,
    { amount: 1000, mode: 'cash', reason: 'Half of the deposit: lab breakage deducted' },
    accountant,
  );
  note(ctx, 'Refund waiting for approval', refundPending.name, refundPending.invoice_no, '₹1,000');
}

async function seedOnline(ctx: Context): Promise<void> {
  let order = 0;
  ctx.razorpay.createOrder = async (amountPaise: number) => {
    order += 1;
    return {
      id: `order_SEED${Date.now().toString(36).toUpperCase()}${order}`,
      amount: amountPaise,
      currency: 'INR',
      status: 'created',
    };
  };
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!keySecret || !webhookSecret) {
    note(ctx, 'Online payments skipped', '-', '-', 'RAZORPAY_* keys are not set');
    return;
  }
  const parent = ctx.actors.parent;
  const kavin = ctx.children.kavin;
  const sign = (body: string) => createHmac('sha256', webhookSecret).update(body).digest('hex');
  const webhook = (event: string, entity: Record<string, unknown>) => {
    const body = JSON.stringify({ event, payload: { payment: { entity } } });
    return ctx.online.webhook(Buffer.from(body), sign(body));
  };

  const [first, second] = await openInvoices(ctx, kavin);
  if (!first) return;
  const paid = await ctx.online.start(parent.id, kavin, first.id, { amount: Math.min(2000, first.balance) });
  const paymentId = `pay_SEED${Date.now().toString(36).toUpperCase()}A`;
  await ctx.online.verify(parent.id, kavin, {
    razorpay_order_id: paid.order_id,
    razorpay_payment_id: paymentId,
    razorpay_signature: createHmac('sha256', keySecret).update(`${paid.order_id}|${paymentId}`).digest('hex'),
  });
  note(
    ctx,
    'Online paid (app checkout)',
    'Kavin (parent 9000000005)',
    first.invoice_no,
    `₹${Math.min(2000, first.balance)}, receipt mode Online (Razorpay)`,
  );

  const failed = await ctx.online.start(parent.id, kavin, first.id, {});
  await webhook('payment.failed', {
    id: `pay_SEED${Date.now().toString(36).toUpperCase()}F`,
    order_id: failed.order_id,
    amount: failed.amount_paise,
    error_description: 'Payment declined by the bank',
  });
  note(ctx, 'Online failed (webhook)', 'Kavin (parent 9000000005)', first.invoice_no, 'Declined by the bank');

  const target = second ?? first;
  const captured = await ctx.online.start(parent.id, kavin, target.id, { amount: 1000 });
  await webhook('payment.captured', {
    id: `pay_SEED${Date.now().toString(36).toUpperCase()}W`,
    order_id: captured.order_id,
    amount: captured.amount_paise,
  });
  note(
    ctx,
    'Online paid (webhook only)',
    'Kavin (parent 9000000005)',
    target.invoice_no,
    '₹1,000, app closed before verify',
  );

  const harini = (await openInvoices(ctx, ctx.children.harini))[0];
  if (harini) {
    await ctx.online.start(ctx.actors.teacherParent.id, ctx.children.harini, harini.id, {
      amount: Math.min(1500, harini.balance),
    });
    note(ctx, 'Online abandoned', 'Harini (parent 9000000006)', harini.invoice_no, 'Order created, never paid');
  }
}

async function seedFines(ctx: Context): Promise<void> {
  const { admin, principal, accountant, teacher } = ctx.actors;
  const school = ctx.schoolId;
  const type = (name: string, amount: number, description?: string) =>
    ctx.fines.createType(school, { name, default_amount: amount, description }, admin);
  const damage = await type('Property damage', 500, 'Broken furniture, lab equipment or windows');
  const phone = await type('Mobile phone in class', 200);
  const uniform = await type('Uniform not worn', 100);
  note(ctx, 'Fine types', 'School Admin', 'Fees › Fines', 'Property damage ₹500, Mobile phone ₹200, Uniform ₹100');

  const kavin = ctx.children.kavin;
  const charged = await ctx.fines.raise(
    school,
    {
      student_id: kavin,
      fine_type_id: damage.id,
      title: 'Broke the lab microscope',
      amount: 1500,
      details: 'Dropped it while playing during the lab period',
    },
    teacher,
  );
  const approved = await ctx.fines.approve(school, charged.id, { comment: 'Seen the lab register' }, principal);
  note(
    ctx,
    'Fine approved (Principal)',
    'Kavin (parent 9000000005)',
    approved.invoice?.invoice_no ?? '-',
    '₹1,500 raised by teacher 9000000004',
  );

  await ctx.fines.raise(
    school,
    { student_id: kavin, fine_type_id: phone.id, details: 'Used a phone during the maths period' },
    teacher,
  );
  note(
    ctx,
    'Fine waiting for approval',
    'Kavin (parent 9000000005)',
    'Mobile phone in class',
    '₹200, approve as AO, Principal or Admin',
  );

  const other = await pick(ctx, 'Fine rejected', `i.installment = 'Term 2'`);
  const rejected = await ctx.fines.raise(
    school,
    { student_id: other.student_id, fine_type_id: uniform.id },
    accountant,
  );
  await ctx.fines.reject(school, rejected.id, { comment: 'First time; a warning is enough' }, admin);
  note(ctx, 'Fine rejected (Admin)', other.name, 'Uniform not worn', 'Raised by the accountant');

  const withdrawn = await ctx.fines.raise(school, { student_id: other.student_id, fine_type_id: phone.id }, accountant);
  await ctx.fines.withdraw(school, withdrawn.id, accountant);
  note(ctx, 'Fine withdrawn (Accountant)', other.name, 'Mobile phone in class', 'Raised on the wrong student');
}

function printSummary(rows: string[][]): void {
  const header = ['Flow', 'Who', 'Where', 'Result'];
  const widths = header.map((title, index) => Math.max(title.length, ...rows.map((row) => row[index]!.length)));
  const line = (row: string[]) => row.map((cell, index) => cell.padEnd(widths[index]!)).join(' | ');
  console.log(line(header));
  console.log(widths.map((width) => '-'.repeat(width)).join('-+-'));
  rows.forEach((row) => console.log(line(row)));
}

export async function seedDemoFeeFlows(app: INestApplicationContext): Promise<void> {
  const db = app.get(DataSource);
  const [school] = await db.query(`SELECT id FROM schools WHERE code = $1 AND deleted_at IS NULL`, [SCHOOL_CODE]);
  if (!school) throw new Error('The demo school is missing. Run npm run seed:demo first.');
  const schoolId = Number(school.id);
  const [year] = await db.query(
    `SELECT id, to_char(end_date, 'YYYY-MM-DD') AS end_date FROM academic_years WHERE school_id = $1 AND is_current = true AND deleted_at IS NULL`,
    [schoolId],
  );
  if (!year) throw new Error('The demo school has no current academic year.');
  const [marker] = await db.query(
    `SELECT id FROM fee_benefits WHERE school_id = $1 AND academic_year_id = $2 AND name = $3 AND deleted_at IS NULL`,
    [schoolId, year.id, MARKER],
  );
  if (marker) {
    console.log('Fee flows  already seeded for this year: kept');
    return;
  }
  const heads: { id: number; code: string }[] = await db.query(
    `SELECT id, code FROM fee_heads WHERE school_id = $1 AND deleted_at IS NULL`,
    [schoolId],
  );
  if (!heads.some((head) => head.code === 'TUITION'))
    throw new Error('Demo fee heads are missing. Run npm run seed:demo first.');

  const actors = {} as Record<keyof typeof USERS, AuthUser>;
  for (const [key, mobile] of Object.entries(USERS) as [keyof typeof USERS, string][])
    actors[key] = await actorFor(db, mobile);
  const yearId = Number(year.id);
  const [kavin, nila] = await childrenOf(db, USERS.parent, yearId);
  const [harini] = await childrenOf(db, USERS.teacherParent, yearId);
  if (!kavin || !nila || !harini)
    throw new Error('The demo parents’ children are missing. Run npm run seed:demo first.');

  const ctx: Context = {
    db,
    fees: app.get(FeesService),
    requests: app.get(FeeRequestsService),
    benefits: app.get(FeeBenefitsService),
    settings: app.get(FeeSettingsService),
    online: app.get(OnlinePaymentsService),
    fines: app.get(FeeFinesService),
    razorpay: app.get(RazorpayClient),
    schoolId,
    yearId,
    yearEnd: year.end_date,
    today: todayIn(process.env.APP_TIMEZONE || 'Asia/Kolkata'),
    actors,
    children: { kavin, nila, harini },
    heads: Object.fromEntries(heads.map((head) => [head.code, Number(head.id)])),
    used: new Set([kavin, nila, harini]),
    rows: [],
  };
  const classes: ClassRow[] = (
    await db.query(`SELECT id, name, grade_level FROM classes WHERE school_id = $1 AND deleted_at IS NULL`, [schoolId])
  ).map((row: Record<string, string>) => ({
    id: Number(row.id),
    name: row.name,
    grade_level: Number(row.grade_level),
  }));
  const termThreeDue = [shiftMonth(ctx.today, 2), ctx.yearEnd].sort()[0]!;

  await seedSettings(ctx);
  await seedHeads(
    ctx,
    classes.filter((row) => row.grade_level >= 6).map((row) => row.id),
  );
  await seedBenefits(ctx, classes.find((row) => row.grade_level === 1)!.id);
  await seedPreviousDues(ctx);
  const payments = await seedCollections(ctx);
  await seedRequests(ctx, payments);
  await seedPlans(ctx, classes, termThreeDue);
  await seedTermThree(ctx);
  await seedOnline(ctx);
  await seedFines(ctx);
  const late = await ctx.settings.runLateFees(schoolId, actors.admin.id);
  note(ctx, 'Late fee run', `${late.invoices} invoices`, `₹${late.amount}`, 'Overdue past 7 grace days');
  const reminded = await ctx.fees.sendOverdueReminders(schoolId);
  note(
    ctx,
    'Overdue reminders',
    `${reminded} students`,
    'Parent app notifications',
    'In-app only, push is off for the seed',
  );
  printSummary(ctx.rows);
}
