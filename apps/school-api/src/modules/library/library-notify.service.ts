import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { yearClause } from '../../shared/year-context';
import { NotificationsService } from '../notifications/notifications.service';

export interface MemberAudience {
  user_ids: number[];
  member_type: 'student' | 'staff';
  student_id: number | null;
  member_name: string;
  class_section: string | null;
  class_teacher_user_id: number | null;
}

@Injectable()
export class LibraryNotifyService {
  private readonly logger = new Logger('LibraryNotify');

  constructor(
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
  ) {}

  async audience(memberId: number): Promise<MemberAudience | null> {
    const [member]: {
      member_type: string;
      student_id: number | null;
      user_id: number | null;
      name: string;
      class_section: string | null;
      class_teacher_user_id: number | null;
    }[] = await this.dataSource.query(
      `SELECT m.member_type, m.student_id, m.user_id,
              CASE WHEN m.member_type = 'student' THEN s.first_name || COALESCE(' ' || s.last_name, '') ELSE u.name END AS name,
              NULLIF(CONCAT_WS(' - ', ce.class_name, ce.section_name), '') AS class_section, ce.class_teacher_user_id
       FROM library_members m
       LEFT JOIN students s ON s.id = m.student_id
       LEFT JOIN users u ON u.id = m.user_id
       LEFT JOIN LATERAL (
         SELECT c.name AS class_name, sec.name AS section_name, sec.class_teacher_user_id
         FROM student_enrollments e
         JOIN academic_years y ON y.id = e.academic_year_id AND ${yearClause('y')}
         JOIN classes c ON c.id = e.class_id LEFT JOIN sections sec ON sec.id = e.section_id
         WHERE e.student_id = m.student_id ORDER BY e.id DESC LIMIT 1
       ) ce ON true
       WHERE m.id = $1`,
      [memberId],
    );
    if (!member) return null;
    let userIds: number[] = [];
    if (member.member_type === 'student' && member.student_id) {
      const parents: { user_id: number }[] = await this.dataSource.query(
        `SELECT DISTINCT g.user_id FROM student_guardians sg
         JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL AND g.user_id IS NOT NULL
         WHERE sg.student_id = $1 AND sg.receives_alerts = true`,
        [member.student_id],
      );
      userIds = parents.map((row) => Number(row.user_id));
    } else if (member.user_id) {
      userIds = [Number(member.user_id)];
    }
    return {
      user_ids: userIds,
      member_type: member.member_type === 'staff' ? 'staff' : 'student',
      student_id: member.student_id ? Number(member.student_id) : null,
      member_name: member.name,
      class_section: member.class_section,
      class_teacher_user_id: member.class_teacher_user_id ? Number(member.class_teacher_user_id) : null,
    };
  }

  async tell(
    memberId: number,
    template: string,
    data: Record<string, string>,
    options: { classTeacher?: boolean } = {},
  ): Promise<number> {
    try {
      const audience = await this.audience(memberId);
      if (!audience) return 0;
      const shared: Record<string, string> = {
        member: audience.member_name,
        class: audience.class_section ?? '-',
        ...(audience.student_id ? { student_id: String(audience.student_id) } : {}),
        ...data,
      };
      let recipients = 0;
      if (audience.user_ids.length) {
        const result = await this.notifications.dispatch({
          template,
          audience: { user_ids: audience.user_ids },
          data: { ...shared, role: audience.member_type === 'student' ? 'parent' : 'staff' },
        });
        recipients += result.recipients;
      }
      const teacher = audience.class_teacher_user_id;
      if (options.classTeacher && teacher && !audience.user_ids.includes(teacher)) {
        const result = await this.notifications.dispatch({
          template,
          audience: { user_ids: [teacher] },
          data: { ...shared, role: 'staff' },
        });
        recipients += result.recipients;
      }
      return recipients;
    } catch (error) {
      this.logger.warn(`Library notice ${template} for member ${memberId} failed: ${(error as Error).message}`);
      return 0;
    }
  }

  async tellRoles(schoolId: number, roles: string[], template: string, data: Record<string, string>): Promise<number> {
    try {
      const result = await this.notifications.dispatch({ template, audience: { roles, school_id: schoolId }, data });
      return result.recipients;
    } catch (error) {
      this.logger.warn(`Library notice ${template} to ${roles.join(', ')} failed: ${(error as Error).message}`);
      return 0;
    }
  }
}
