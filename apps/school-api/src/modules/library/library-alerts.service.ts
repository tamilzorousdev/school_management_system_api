import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { ROLES } from '../access/access.catalog';
import { LIBRARY_TEMPLATES } from '../notifications/library-templates.catalog';
import { rupees } from '../payroll/payroll.calc';
import { schoolInfo } from './copy-events';
import { LibraryReminder } from './entities/library-issue.entity';
import { reminderKind } from './library.logic';
import { LibraryNotifyService } from './library-notify.service';
import { LibraryReadService, param, SqlFilter } from './library-read.service';
import { LibrarySettingsService } from './library-settings.service';
import { VisitsService } from './visits.service';

export interface ReminderRunResult {
  checked: number;
  sent: number;
  by_kind: Record<string, number>;
}

const TEMPLATE_FOR = (kind: string): string =>
  kind === 'due_soon'
    ? LIBRARY_TEMPLATES.LIBRARY_DUE_SOON
    : kind === 'due_today'
      ? LIBRARY_TEMPLATES.LIBRARY_DUE_TODAY
      : kind === 'overdue'
        ? LIBRARY_TEMPLATES.LIBRARY_OVERDUE
        : kind === 'long_overdue'
          ? LIBRARY_TEMPLATES.LIBRARY_OVERDUE_LONG
          : LIBRARY_TEMPLATES.LIBRARY_OVERDUE_ESCALATED;

@Injectable()
export class LibraryAlertsService {
  private readonly logger = new Logger('LibraryAlerts');
  private running = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly read: LibraryReadService,
    private readonly settings: LibrarySettingsService,
    private readonly notify: LibraryNotifyService,
    private readonly visits: VisitsService,
  ) {}

  @Cron('0 8 * * *', { name: 'library-reminders', timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' })
  async daily(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const schools: { school_id: number }[] = await this.dataSource.query(
        `SELECT DISTINCT school_id FROM library_issues WHERE status = 'issued' AND deleted_at IS NULL`,
      );
      for (const { school_id: schoolId } of schools) {
        const result = await this.runSchool(Number(schoolId));
        if (result.sent) this.logger.log(`School ${schoolId}: ${result.sent} library reminders`);
      }
    } catch (error) {
      this.logger.error(`Library reminder round failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async runSchool(schoolId: number): Promise<ReminderRunResult> {
    const rules = await this.settings.rules(schoolId);
    const today = this.read.today();
    const filter: SqlFilter = { where: [`i.status = 'issued'`], params: [] };
    filter.where.push(`i.due_date <= ${param(filter, today)}::date + ${Number(rules.due_soon_days)}`);
    const loans = await this.read.loans(schoolId, filter, 'i.due_date');
    const school = await schoolInfo(this.dataSource.manager, schoolId);
    const result: ReminderRunResult = { checked: loans.length, sent: 0, by_kind: {} };
    for (const loan of loans) {
      const kind = reminderKind(loan.due_date, today, rules);
      if (!kind) continue;
      const claimed = await this.dataSource
        .createQueryBuilder()
        .insert()
        .into(LibraryReminder)
        .values({ school_id: schoolId, issue_id: loan.id, kind })
        .orIgnore()
        .returning(['id'])
        .execute();
      const reminderId = (claimed.raw as { id: number }[])[0]?.id;
      if (!reminderId) continue;
      const data = {
        book: loan.book.title,
        accession_no: loan.copy.accession_no,
        due_date: loan.due_date,
        issued_on: new Intl.DateTimeFormat('en-CA', { timeZone: this.read.zone() }).format(loan.issued_at),
        days: `${loan.days_overdue} ${loan.days_overdue === 1 ? 'day' : 'days'}`,
        fine: rupees(loan.running_fine),
        school: school.name,
        member: loan.member.name,
        class: loan.member.detail ?? '-',
        issue_id: String(loan.id),
      };
      const recipients =
        kind === 'long_overdue'
          ? await this.notify.tellRoles(schoolId, [ROLES.LIBRARIAN, ROLES.ADMIN], TEMPLATE_FOR(kind), data)
          : await this.notify.tell(loan.member.id, TEMPLATE_FOR(kind), data, {
              classTeacher: kind.startsWith('escalated') && loan.member.member_type === 'student',
            });
      await this.dataSource.getRepository(LibraryReminder).update(reminderId, { recipients });
      result.sent += 1;
      result.by_kind[kind] = (result.by_kind[kind] ?? 0) + 1;
    }
    return result;
  }

  @Cron(CronExpression.EVERY_30_MINUTES, { name: 'library-close-visits' })
  async closeVisits(): Promise<void> {
    try {
      const schools: { school_id: number }[] = await this.dataSource.query(
        `SELECT DISTINCT school_id FROM library_visits WHERE kind = 'walk_in' AND out_at IS NULL AND deleted_at IS NULL`,
      );
      for (const { school_id: schoolId } of schools) {
        const settings = await this.settings.get(Number(schoolId));
        await this.visits.closeOpenVisits(Number(schoolId), settings.closing_time, this.read.today(), this.read.zone());
      }
    } catch (error) {
      this.logger.error(`Closing library visits failed: ${(error as Error).message}`);
    }
  }
}
