import { Injectable, Logger } from '@nestjs/common';
import { ROLES } from '../access/access.catalog';
import { NotificationsService } from '../notifications/notifications.service';

export const INVENTORY_OFFICE_ROLES = [ROLES.STORE_KEEPER, ROLES.ADMIN];
export const INVENTORY_APPROVER_ROLES = [ROLES.ADMIN, ROLES.PRINCIPAL, ROLES.AO];

@Injectable()
export class InventoryNotifyService {
  private readonly logger = new Logger('InventoryNotify');

  constructor(private readonly notifications: NotificationsService) {}

  async users(userIds: (number | null | undefined)[], template: string, data: Record<string, string>): Promise<number> {
    const ids = [...new Set(userIds.filter((id): id is number => Boolean(id)))];
    if (!ids.length) return 0;
    try {
      const result = await this.notifications.dispatch({
        template,
        audience: { user_ids: ids },
        data: { role: 'staff', ...data },
      });
      return result.recipients;
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
