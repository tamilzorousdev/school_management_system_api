import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import { NotificationsService } from '../notifications/notifications.service';
import { KafkaNotifyService } from '../sms/kafka-notify.service';
import { GallerySettings } from './entities/gallery.entity';
import { GalleryMediaService } from './gallery-media.service';
import { GallerySettingsService } from './gallery-settings.service';
import { storageLevel } from './gallery.logic';

export function readableSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

@Injectable()
export class GalleryAlertsService {
  private readonly logger = new Logger('GalleryAlerts');

  constructor(
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
    private readonly kafka: KafkaNotifyService,
    private readonly settings: GallerySettingsService,
    private readonly media: GalleryMediaService,
  ) {}

  async notifyAdmins(
    settings: GallerySettings,
    template: string,
    data: Record<string, string | number>,
  ): Promise<void> {
    if (!settings.notify_roles.length) return;
    if (settings.notify_in_app) {
      await this.notifications
        .dispatch({ template, audience: { roles: settings.notify_roles, school_id: settings.school_id }, data })
        .catch((error: Error) =>
          this.logger.warn(`School ${settings.school_id}: ${template} not sent: ${error.message}`),
        );
    }
    if (settings.notify_email && this.kafka.enabled) await this.email(settings, template, data);
  }

  async checkStorage(schoolId: number): Promise<void> {
    const settings = await this.settings.forSchool(schoolId);
    const used = await this.media.usedBytes(schoolId);
    const level = storageLevel(used, settings.storage_quota_mb, settings.storage_warning_percent);
    const stored = settings.storage_alert_level ?? 'ok';
    if (level === stored) return;
    await this.dataSource.query(`UPDATE gallery_settings SET storage_alert_level = $1 WHERE id = $2`, [
      level === 'ok' ? null : level,
      settings.id,
    ]);
    if (level === 'ok' || (level === 'warning' && stored === 'full')) return;
    const quota = settings.storage_quota_mb * 1024 * 1024;
    await this.notifyAdmins(
      settings,
      level === 'full' ? TEMPLATES.GALLERY_STORAGE_FULL : TEMPLATES.GALLERY_STORAGE_WARNING,
      {
        percent: Math.min(100, Math.round((used / quota) * 100)),
        used: readableSize(used),
        quota: readableSize(quota),
      },
    );
  }

  checkStorageQuietly(schoolId: number): void {
    void this.checkStorage(schoolId).catch((error: Error) =>
      this.logger.warn(`School ${schoolId}: storage check failed: ${error.message}`),
    );
  }

  private async email(settings: GallerySettings, template: string, data: Record<string, string | number>) {
    const rows: { email: string; name: string }[] = await this.dataSource.query(
      `SELECT DISTINCT u.email, u.name FROM users u
       JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
       WHERE u.school_id = $1 AND u.status = 'active' AND u.deleted_at IS NULL AND u.email IS NOT NULL
         AND r.code = ANY($2::text[])`,
      [settings.school_id, settings.notify_roles],
    );
    const variables = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value)]));
    for (const row of rows) {
      await this.kafka
        .send({
          channel: 'email',
          to: row.email,
          templateId: this.kafka.templateId(template),
          variables: { ...variables, name: row.name },
        })
        .catch((error: Error) => this.logger.warn(`Gallery email ${template} to user not sent: ${error.message}`));
    }
  }
}
