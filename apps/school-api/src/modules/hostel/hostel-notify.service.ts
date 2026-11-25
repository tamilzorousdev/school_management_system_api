import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ROLES } from '../access/access.catalog';
import { NotificationsService } from '../notifications/notifications.service';

export interface ResidentContext {
  student_id: number;
  student: string;
  hostel_id: number;
  hostel: string;
  room: string;
  bed: string;
  warden_phone: string;
}

@Injectable()
export class HostelNotifyService {
  private readonly logger = new Logger('HostelNotify');

  constructor(
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
  ) {}

  async resident(admissionId: number): Promise<ResidentContext | null> {
    const [row] = await this.dataSource.query(
      `SELECT a.student_id, a.hostel_id, h.name AS hostel,
         TRIM(CONCAT(s.first_name, ' ', s.last_name)) AS student,
         COALESCE(r.room_no, '-') AS room,
         COALESCE(CONCAT(r.room_no, ' / ', bd.bed_no), '-') AS bed,
         COALESCE(h.phone, wu.mobile, '-') AS warden_phone
       FROM hostel_admissions a
       JOIN hostels h ON h.id = a.hostel_id
       JOIN students s ON s.id = a.student_id
       LEFT JOIN users wu ON wu.id = h.warden_user_id
       LEFT JOIN hostel_allocations al ON al.admission_id = a.id AND al.to_date IS NULL
       LEFT JOIN hostel_rooms r ON r.id = al.room_id
       LEFT JOIN hostel_beds bd ON bd.id = al.bed_id
       WHERE a.id = $1`,
      [admissionId],
    );
    return row ?? null;
  }

  async tellParents(admissionId: number, template: string, data: Record<string, string | number | null> = {}) {
    try {
      const context = await this.resident(admissionId);
      if (!context) return 0;
      const rows: { user_id: number }[] = await this.dataSource.query(
        `SELECT DISTINCT g.user_id FROM student_guardians sg
         JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
         WHERE sg.student_id = $1 AND sg.receives_alerts = true AND g.user_id IS NOT NULL`,
        [context.student_id],
      );
      if (!rows.length) return 0;
      const result = await this.notifications.dispatch({
        template,
        audience: { user_ids: rows.map((row) => Number(row.user_id)) },
        data: { ...context, ...data, role: 'parent' },
      });
      return result.recipients;
    } catch (error) {
      this.logger.warn(
        `Hostel notice ${template} to parents of admission ${admissionId} failed: ${(error as Error).message}`,
      );
      return 0;
    }
  }

  async tellWardens(
    schoolId: number,
    admissionId: number,
    template: string,
    data: Record<string, string | number | null> = {},
  ) {
    try {
      const context = await this.resident(admissionId);
      if (!context) return 0;
      const rows: { user_id: number }[] = await this.dataSource.query(
        `SELECT warden_user_id AS user_id FROM hostels WHERE id = $1 AND warden_user_id IS NOT NULL
         UNION
         SELECT b.incharge_user_id FROM hostel_blocks b
         JOIN hostel_rooms r ON r.block_id = b.id
         JOIN hostel_allocations al ON al.room_id = r.id AND al.to_date IS NULL AND al.admission_id = $2
         WHERE b.incharge_user_id IS NOT NULL`,
        [context.hostel_id, admissionId],
      );
      const userIds = rows.map((row) => Number(row.user_id));
      const result = await this.notifications.dispatch({
        template,
        audience: userIds.length ? { user_ids: userIds } : { roles: [ROLES.WARDEN], school_id: schoolId },
        data: { ...context, ...data, role: 'staff' },
      });
      return result.recipients;
    } catch (error) {
      this.logger.warn(
        `Hostel notice ${template} to wardens for admission ${admissionId} failed: ${(error as Error).message}`,
      );
      return 0;
    }
  }
}
