import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { ROLES } from '../access/access.catalog';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import { NotificationsService } from '../notifications/notifications.service';
import { AttendanceMode, AttendanceSlot, halfOf, ordinal, slotPeriods } from './attendance-sessions';
import { AttendanceService } from './attendance.service';
import { addToTime, GraceWindow, inReminderTime, listNames, windowClosed } from './attendance-window';

export const MISSED_ALERT_WINDOW_MINUTES = 60;

type AlertKind = 'reminder' | 'missed';

@Injectable()
export class AttendanceAlertsService {
  private readonly logger = new Logger('AttendanceAlerts');

  constructor(
    private readonly attendance: AttendanceService,
    private readonly notifications: NotificationsService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'attendance-alerts' })
  async tick(): Promise<void> {
    const schools: { id: number }[] = await this.dataSource.query(`SELECT id FROM schools WHERE is_active = true`);
    for (const school of schools) {
      await this.checkSchool(Number(school.id)).catch((error: Error) =>
        this.logger.warn(`school ${school.id}: ${error.message}`),
      );
    }
  }

  async checkSchool(schoolId: number, now = this.nowTime()): Promise<void> {
    const today = todayIn(this.app.timeZone);
    if (!(await this.attendance.isSchoolDay(schoolId, today))) return;
    const { mode, teaching } = await this.attendance.modeOf(schoolId);
    for (const period of slotPeriods(mode, teaching)) {
      const slot = { session: halfOf(period), period };
      const window = await this.attendance.window(this.dataSource.manager, schoolId, period);
      if (inReminderTime(window, now)) await this.remind(schoolId, today, slot, mode, window);
      else if (this.justClosed(window, today, now)) await this.reportMissed(schoolId, today, slot, mode, window);
    }
  }

  private justClosed(window: GraceWindow, today: string, now: string): boolean {
    return (
      Boolean(window.closes_at) &&
      windowClosed(window, today, today, now) &&
      now <= addToTime(window.closes_at!, MISSED_ALERT_WINDOW_MINUTES)
    );
  }

  private async remind(
    schoolId: number,
    date: string,
    slot: AttendanceSlot,
    mode: AttendanceMode,
    window: GraceWindow,
  ): Promise<void> {
    const sections = await this.attendance.unmarkedSections(schoolId, date, slot.period);
    const claimed = await this.claim(
      schoolId,
      sections.map((section) => section.section_id),
      date,
      slot.period,
      'reminder',
    );
    for (const section of sections.filter((item) => claimed.has(item.section_id))) {
      const proxies: { substitute_user_id: number }[] = await this.dataSource.query(
        `SELECT DISTINCT substitute_user_id FROM substitutions
         WHERE school_id = $1 AND section_id = $2 AND date = $3 AND period_no = $4 AND substitute_user_id IS NOT NULL`,
        [schoolId, section.section_id, date, slot.period],
      );
      const periodTeachers: { teacher_user_id: number }[] =
        mode === 'period'
          ? await this.dataSource.query(
              `SELECT DISTINCT teacher_user_id FROM timetable_slots
               WHERE section_id = $1 AND day_of_week = EXTRACT(ISODOW FROM $2::date) AND period_no = $3
                 AND teacher_user_id IS NOT NULL`,
              [section.section_id, date, slot.period],
            )
          : [];
      const userIds = [
        ...new Set(
          [
            ...(mode === 'period' && periodTeachers.length ? [] : [section.class_teacher_user_id]),
            ...periodTeachers.map((row) => Number(row.teacher_user_id)),
            ...proxies.map((row) => Number(row.substitute_user_id)),
          ].filter((id): id is number => id !== null),
        ),
      ];
      if (!userIds.length) continue;
      await this.send(
        TEMPLATES.ATTENDANCE_REMINDER,
        { user_ids: userIds },
        {
          section: section.name,
          session: slot.session,
          period: ordinal(slot.period),
          closes_at: window.closes_at ?? '',
          section_id: String(section.section_id),
          on_date: date,
        },
      );
    }
  }

  private async reportMissed(
    schoolId: number,
    date: string,
    slot: AttendanceSlot,
    mode: AttendanceMode,
    window: GraceWindow,
  ): Promise<void> {
    const sections = await this.attendance.unmarkedSections(schoolId, date, slot.period);
    const claimed = await this.claim(
      schoolId,
      sections.map((section) => section.section_id),
      date,
      slot.period,
      'missed',
    );
    const missed = sections.filter((section) => claimed.has(section.section_id));
    if (!missed.length) return;
    await this.send(
      TEMPLATES.ATTENDANCE_MISSED,
      { roles: [ROLES.AO, ROLES.ADMIN], school_id: schoolId },
      {
        count: missed.length === 1 ? '1 section' : `${missed.length} sections`,
        session: mode === 'period' ? `${ordinal(slot.period)} period` : slot.session,
        sections: listNames(missed.map((section) => section.name)),
        grace: String(window.grace_minutes),
        on_date: date,
      },
    );
  }

  private async claim(
    schoolId: number,
    sectionIds: number[],
    date: string,
    period: number,
    kind: AlertKind,
  ): Promise<Set<number>> {
    if (!sectionIds.length) return new Set();
    const rows: { section_id: number }[] = await this.dataSource.query(
      `INSERT INTO attendance_alerts (school_id, section_id, date, period, kind)
       SELECT $1, unnest($2::int[]), $3, $4, $5
       ON CONFLICT ("section_id", "date", "period", "kind") DO NOTHING
       RETURNING section_id`,
      [schoolId, sectionIds, date, period, kind],
    );
    return new Set(rows.map((row) => Number(row.section_id)));
  }

  private async send(
    template: string,
    audience: { user_ids: number[] } | { roles: string[]; school_id: number },
    data: Record<string, string>,
  ): Promise<void> {
    await this.notifications
      .dispatch({ template, audience, data })
      .catch((error: Error) => this.logger.warn(`${template} not sent: ${error.message}`));
  }

  private nowTime(): string {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: this.app.timeZone,
    }).format(new Date());
  }
}
