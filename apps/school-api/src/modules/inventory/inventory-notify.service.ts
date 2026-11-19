import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ROLES } from '../access/access.catalog';
import { NotificationsService } from '../notifications/notifications.service';

export const INVENTORY_OFFICE_ROLES = [ROLES.STORE_KEEPER, ROLES.ADMIN];
export const INVENTORY_APPROVER_ROLES = [ROLES.ADMIN, ROLES.PRINCIPAL, ROLES.AO];

@Injectable()
export class InventoryNotifyService {
  private readonly logger = new Logger('InventoryNotify');

  constructor(
    private readonly notifications: NotificationsService,
    private readonly dataSource: DataSource,
  ) {}

  private async busCrew(userIds: number[]): Promise<Set<number>> {
    const rows: { user_id: number }[] = await this.dataSource.query(
      `SELECT DISTINCT ur.user_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = ANY($1) AND r.code = ANY($2)
         AND NOT EXISTS (SELECT 1 FROM user_roles x JOIN roles y ON y.id = x.role_id
                         WHERE x.user_id = ur.user_id AND y.app = 'staff')`,
      [userIds, [ROLES.DRIVER, ROLES.ATTENDANT]],
    );
    return new Set(rows.map((row) => Number(row.user_id)));
  }

  async users(userIds: (number | null | undefined)[], template: string, data: Record<string, string>): Promise<number> {
    const ids = [...new Set(userIds.filter((id): id is number => Boolean(id)))];
    if (!ids.length) return 0;
    try {
      const crew = await this.busCrew(ids);
      let recipients = 0;
      for (const [role, group] of [
        ['staff', ids.filter((id) => !crew.has(id))],
        ['driver', ids.filter((id) => crew.has(id))],
      ] as const) {
        if (!group.length) continue;
        const result = await this.notifications.dispatch({
          template,
          audience: { user_ids: group },
          data: { role, ...data },
        });
        recipients += result.recipients;
      }
      return recipients;
    } catch (error) {
      this.logger.warn(`Inventory notice ${template} failed: ${(error as Error).message}`);
      return 0;
    }
  }

  async roles(schoolId: number, roles: string[], template: string, data: Record<string, string>): Promise<number> {
    try {
      const result = await this.notifications.dispatch({ template, audience: { roles, school_id: schoolId }, data });
      return result.recipients;
    } catch (error) {
      this.logger.warn(`Inventory notice ${template} to ${roles.join(', ')} failed: ${(error as Error).message}`);
      return 0;
    }
  }
}
