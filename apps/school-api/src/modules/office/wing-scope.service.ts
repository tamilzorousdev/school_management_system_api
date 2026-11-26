import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthUser } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import {
  AO_ROLE,
  ClassShape,
  classesOfWing,
  isWingLimitedRole,
  spanActive,
  wingOfClass,
  WingShape,
} from './office.logic';

export interface WingRow extends WingShape {
  board: string | null;
  sort_order: number;
}

interface UserWingRow {
  user_id: number;
  wing_id: number;
  valid_from: string | null;
  valid_to: string | null;
}

@Injectable()
export class WingScopeService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  today(): string {
    return todayIn(this.config.timeZone);
  }

  async wings(schoolId: number): Promise<WingRow[]> {
    const rows: WingRow[] = await this.dataSource.query(
      `SELECT id, name, from_grade, to_grade, class_ids, board, sort_order FROM school_wings
       WHERE school_id = $1 AND deleted_at IS NULL ORDER BY sort_order, from_grade, id`,
      [schoolId],
    );
    return rows.map((row) => ({
      ...row,
      id: Number(row.id),
      from_grade: Number(row.from_grade),
      to_grade: Number(row.to_grade),
      sort_order: Number(row.sort_order),
      class_ids: row.class_ids?.map(Number) ?? null,
    }));
  }

  async classes(schoolId: number): Promise<ClassShape[]> {
    const rows: ClassShape[] = await this.dataSource.query(
      `SELECT id, name, grade_level FROM classes WHERE school_id = $1 AND deleted_at IS NULL ORDER BY grade_level, name`,
      [schoolId],
    );
    return rows.map((row) => ({ id: Number(row.id), name: row.name, grade_level: Number(row.grade_level) }));
  }

  async activeWingIds(schoolId: number, userId: number): Promise<number[]> {
    const rows = await this.userWings(schoolId, [userId]);
    return rows.map((row) => row.wing_id);
  }

  async classIdsFor(user: AuthUser, schoolId: number): Promise<number[] | null> {
    if (!isWingLimitedRole(user.roles)) return null;
    const wingIds = await this.activeWingIds(schoolId, user.id);
    if (!wingIds.length) return null;
    const [wings, classes] = await Promise.all([this.wings(schoolId), this.classes(schoolId)]);
    const ids = new Set<number>();
    for (const wing of wings.filter((row) => wingIds.includes(row.id))) {
      classesOfWing(wing, classes).forEach((schoolClass) => ids.add(schoolClass.id));
    }
    return [...ids];
  }

  async studentClassId(schoolId: number, studentId: number): Promise<number | null> {
    const [row]: { class_id: number }[] = await this.dataSource.query(
      `SELECT e.class_id FROM student_enrollments e
       JOIN academic_years ay ON ay.id = e.academic_year_id AND ay.is_current = true AND ay.deleted_at IS NULL
       JOIN students s ON s.id = e.student_id AND s.school_id = $1
       WHERE e.student_id = $2
       ORDER BY e.id DESC LIMIT 1`,
      [schoolId, studentId],
    );
    return row ? Number(row.class_id) : null;
  }

  async aoUsers(schoolId: number): Promise<{ id: number; name: string; mobile: string; last_login_at: Date | null }[]> {
    const rows: { id: number; name: string; mobile: string; last_login_at: Date | null }[] =
      await this.dataSource.query(
        `SELECT DISTINCT u.id, u.name, u.mobile, u.last_login_at FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id AND r.code = $2
       WHERE u.school_id = $1 AND u.deleted_at IS NULL AND u.status = 'active'
       ORDER BY u.name`,
        [schoolId, AO_ROLE],
      );
    return rows.map((row) => ({ ...row, id: Number(row.id) }));
  }

  async userWings(schoolId: number, userIds: number[]): Promise<UserWingRow[]> {
    if (!userIds.length) return [];
    const rows: UserWingRow[] = await this.dataSource.query(
      `SELECT uw.user_id, uw.wing_id, to_char(uw.valid_from, 'YYYY-MM-DD') AS valid_from,
              to_char(uw.valid_to, 'YYYY-MM-DD') AS valid_to
       FROM user_wings uw JOIN school_wings w ON w.id = uw.wing_id AND w.deleted_at IS NULL
       WHERE uw.school_id = $1 AND uw.user_id = ANY($2) AND uw.deleted_at IS NULL`,
      [schoolId, userIds],
    );
    const today = this.today();
    return rows
      .map((row) => ({ ...row, user_id: Number(row.user_id), wing_id: Number(row.wing_id) }))
      .filter((row) => spanActive(row, today));
  }

  async aoUsersForClass(schoolId: number, classId: number | null): Promise<number[]> {
    const aos = await this.aoUsers(schoolId);
    const links = await this.userWings(
      schoolId,
      aos.map((ao) => ao.id),
    );
    if (!classId) return aos.filter((ao) => !links.some((link) => link.user_id === ao.id)).map((ao) => ao.id);
    const [wings, classes] = await Promise.all([this.wings(schoolId), this.classes(schoolId)]);
    const schoolClass = classes.find((row) => row.id === classId);
    const holding = new Set(
      wings.filter((wing) => schoolClass && classesOfWing(wing, [schoolClass]).length).map((wing) => wing.id),
    );
    return aos
      .filter((ao) => {
        const mine = links.filter((link) => link.user_id === ao.id);
        return !mine.length || mine.some((link) => holding.has(link.wing_id));
      })
      .map((ao) => ao.id);
  }

  async headAoUsers(schoolId: number): Promise<number[]> {
    return this.aoUsersForClass(schoolId, null);
  }

  async wingNameOfClass(schoolId: number, classId: number | null): Promise<string | null> {
    if (!classId) return null;
    const [wings, classes] = await Promise.all([this.wings(schoolId), this.classes(schoolId)]);
    const schoolClass = classes.find((row) => row.id === classId);
    return schoolClass ? (wingOfClass(schoolClass, wings)?.name ?? null) : null;
  }
}
