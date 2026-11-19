import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager, In, Not } from 'typeorm';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import { NotificationsService } from '../notifications/notifications.service';
import { rupees } from '../payroll/payroll.calc';
import { RIDER_FEE_SQL } from '../transport/transport.logic';
import { FeeHead } from './entities/fee-head.entity';
import { FeeInvoiceLine } from './entities/fee-invoice-line.entity';
import { FeeInvoice } from './entities/fee-invoice.entity';
import { FeePlan } from './entities/fee-plan.entity';
import { TransportFeeAdjustment } from './entities/transport-fee-adjustment.entity';
import { invoiceAmounts, monthsBetween, previousDueDate, round2, transportAdjustment } from './fees.logic';

export interface RiderFee {
  student_id: number;
  route_id: number;
  stop_id: number;
  drop_stop_id: number | null;
  monthly_fee: number;
  stop: string;
}

export async function ridersWithFee(
  manager: EntityManager,
  schoolId: number,
  studentIds: number[],
  startsBy?: string,
): Promise<Map<number, RiderFee>> {
  if (!studentIds.length) return new Map();
  const rows: {
    student_id: number;
    route_id: number;
    stop_id: number;
    drop_stop_id: number | null;
    monthly_fee: string;
    stop: string;
  }[] = await manager.query(
    `SELECT st.student_id, st.route_id, st.stop_id, ds.id AS drop_stop_id,
            CASE WHEN ds.id IS NOT NULL AND ds.id <> rs.id THEN rs.name || ' / ' || ds.name ELSE rs.name END AS stop,
            ${RIDER_FEE_SQL('rs', 'ds', 'r')} AS monthly_fee
     FROM student_transport st
     JOIN transport_routes r ON r.id = st.route_id
     JOIN route_stops rs ON rs.id = st.stop_id AND rs.deleted_at IS NULL
     LEFT JOIN route_stops ds ON ds.id = st.drop_stop_id AND ds.deleted_at IS NULL
     WHERE st.school_id = $1 AND st.deleted_at IS NULL AND st.student_id = ANY($2)
       ${startsBy ? 'AND st.start_date <= $3' : ''}`,
    startsBy ? [schoolId, studentIds, startsBy] : [schoolId, studentIds],
  );
  return new Map(
    rows.map((row) => [
      Number(row.student_id),
      {
        student_id: Number(row.student_id),
        route_id: Number(row.route_id),
        stop_id: Number(row.stop_id),
        drop_stop_id: row.drop_stop_id === null ? null : Number(row.drop_stop_id),
        monthly_fee: Number(row.monthly_fee),
        stop: row.stop,
      },
    ]),
  );
}

export const transportDescription = (stop: string, monthlyFee: number, months: number) =>
  `${stop} · ${rupees(monthlyFee)} × ${months} ${months === 1 ? 'month' : 'months'}`.slice(0, 160);

interface Repriced {
  student_id: number;
  monthly_fee: number;
}

@Injectable()
export class TransportFeeSyncService {
  private readonly logger = new Logger('TransportFees');

  constructor(
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async sync(schoolId: number, studentIds: number[]): Promise<void> {
    const ids = [...new Set(studentIds)];
    if (!ids.length) return;
    try {
      const repriced = await this.dataSource.transaction((manager) => this.apply(manager, schoolId, ids));
      await this.tellParents(schoolId, repriced);
    } catch (error) {
      this.logger.warn(`Transport fee sync for ${ids.join(', ')} failed: ${(error as Error).message}`);
    }
  }

  private async apply(manager: EntityManager, schoolId: number, studentIds: number[]): Promise<Repriced[]> {
    const head = await manager.findOne(FeeHead, {
      where: { school_id: schoolId, is_transport: true, is_active: true },
    });
    if (!head) return [];
    const [year]: { id: number; start_date: string }[] = await manager.query(
      `SELECT id, to_char(start_date, 'YYYY-MM-DD') AS start_date FROM academic_years
       WHERE school_id = $1 AND is_current = true AND deleted_at IS NULL LIMIT 1`,
      [schoolId],
    );
    if (!year) return [];
    const today = todayIn(this.app.timeZone);
    const riders = await ridersWithFee(manager, schoolId, studentIds);
    const invoices = await manager.find(FeeInvoice, {
      where: {
        school_id: schoolId,
        academic_year_id: year.id,
        student_id: In(studentIds),
        status: Not('cancelled'),
        kind: 'fee',
      },
      order: { due_date: 'ASC', id: 'ASC' },
    });
    if (!invoices.length) return [];
    const lines = await manager.find(FeeInvoiceLine, { where: { invoice_id: In(invoices.map((row) => row.id)) } });
    const plans = await manager.find(FeePlan, {
      where: { school_id: schoolId, academic_year_id: year.id, class_id: In(invoices.map((row) => row.class_id)) },
    });
    const adjustments = await manager.find(TransportFeeAdjustment, {
      where: { school_id: schoolId, invoice_id: In(invoices.map((row) => row.id)) },
    });
    const repriced: Repriced[] = [];

    for (const invoice of invoices) {
      if (invoice.due_date < today) continue;
      const rider = riders.get(invoice.student_id) ?? null;
      const own = lines.filter((line) => line.invoice_id === invoice.id);
      const transport = own.find((line) => line.kind === 'transport') ?? null;
      const planDates = plans.filter((plan) => plan.class_id === invoice.class_id).map((plan) => plan.due_date);
      const previous = previousDueDate([...new Set(planDates)], invoice.due_date, year.start_date);
      const months = transport?.months ?? monthsBetween(previous, invoice.due_date);
      const target = rider && rider.monthly_fee > 0 ? round2(rider.monthly_fee * months) : 0;

      if (Number(invoice.paid) > 0) {
        const adjusted = adjustments
          .filter((row) => row.invoice_id === invoice.id)
          .reduce((sum, row) => sum + Number(row.amount), 0);
        const difference = transportAdjustment(target, Number(transport?.amount ?? 0), adjusted);
        if (Math.abs(difference) < 0.01) continue;
        await manager.save(
          manager.create(TransportFeeAdjustment, {
            school_id: schoolId,
            student_id: invoice.student_id,
            invoice_id: invoice.id,
            amount: difference,
            reason: (rider
              ? `Bus fee changed to ${rupees(rider.monthly_fee)} a month (${invoice.installment})`
              : `Bus stopped (${invoice.installment})`
            ).slice(0, 160),
            applied_invoice_id: null,
          }),
        );
        continue;
      }

      let changed = false;
      if (target > 0 && rider) {
        const fields = {
          amount: target,
          route_id: rider.route_id,
          stop_id: rider.stop_id,
          drop_stop_id: rider.drop_stop_id,
          monthly_rate: rider.monthly_fee,
          months,
          description: transportDescription(rider.stop, rider.monthly_fee, months),
        };
        if (!transport) {
          await manager.save(
            manager.create(FeeInvoiceLine, {
              ...fields,
              school_id: schoolId,
              invoice_id: invoice.id,
              fee_head_id: head.id,
              head_name: head.name,
              kind: 'transport',
              sort_order: own.length,
            }),
          );
          own.push({ amount: target } as FeeInvoiceLine);
          changed = true;
        } else if (
          Number(transport.amount) !== target ||
          transport.stop_id !== rider.stop_id ||
          transport.drop_stop_id !== rider.drop_stop_id ||
          transport.route_id !== rider.route_id
        ) {
          await manager.update(FeeInvoiceLine, transport.id, fields);
          transport.amount = target;
          changed = true;
        }
      } else if (transport) {
        await manager.softDelete(FeeInvoiceLine, transport.id);
        own.splice(own.indexOf(transport), 1);
        changed = true;
      }
      if (!changed) continue;

      const next = invoiceAmounts(
        own.map((line) => Number(line.amount)),
        Number(invoice.benefit),
        Number(invoice.discount),
        Number(invoice.paid),
      );
      if (next.gross <= 0) {
        await manager.update(FeeInvoice, invoice.id, {
          gross: 0,
          benefit: 0,
          discount: 0,
          total: 0,
          balance: 0,
          status: 'cancelled',
          cancelled_at: new Date(),
          cancel_reason: 'Nothing left to pay after the bus was stopped',
        });
      } else {
        await manager.update(FeeInvoice, invoice.id, next);
      }
      repriced.push({ student_id: invoice.student_id, monthly_fee: rider?.monthly_fee ?? 0 });
    }
    return repriced;
  }

  private async tellParents(schoolId: number, repriced: Repriced[]): Promise<void> {
    const latest = new Map(repriced.map((item) => [item.student_id, item]));
    for (const item of latest.values()) {
      const [student]: { first_name: string; last_name: string | null }[] = await this.dataSource.query(
        `SELECT first_name, last_name FROM students WHERE id = $1`,
        [item.student_id],
      );
      const parents: { user_id: number }[] = await this.dataSource.query(
        `SELECT DISTINCT g.user_id FROM student_guardians sg
         JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL AND g.user_id IS NOT NULL
         WHERE sg.student_id = $1`,
        [item.student_id],
      );
      if (!student || !parents.length) continue;
      await this.notifications
        .dispatch({
          template: TEMPLATES.TRANSPORT_FEE_UPDATED,
          audience: { user_ids: parents.map((row) => Number(row.user_id)), school_id: schoolId },
          data: {
            student: [student.first_name, student.last_name].filter(Boolean).join(' '),
            amount: item.monthly_fee > 0 ? `${rupees(item.monthly_fee)} a month` : 'removed',
            student_id: String(item.student_id),
          },
        })
        .catch((error: Error) => this.logger.warn(`Fee update notice failed: ${error.message}`));
    }
  }
}
