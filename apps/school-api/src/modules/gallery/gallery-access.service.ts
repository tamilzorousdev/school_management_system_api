import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppException, AuthUser } from '@app/common';
import { PERMISSIONS, ROLES } from '../access/access.catalog';
import { UploadTargetDto } from './dto/gallery.dto';
import { GallerySettings } from './entities/gallery.entity';
import { classKey, Viewer } from './gallery.logic';

const NOT_STAFF: string[] = [ROLES.PARENT, ROLES.DRIVER, ROLES.ATTENDANT];

interface SectionRow {
  section_id: number;
  class_id: number;
  academic_year_id: number;
}

export type ViewerApp = 'admin' | 'staff' | 'parent';

export interface AccessFilter {
  sql: string;
  params: Record<string, unknown>;
}

@Injectable()
export class GalleryAccessService {
  constructor(private readonly dataSource: DataSource) {}

  schoolOf(user: AuthUser): number {
    if (!user.school_id) throw AppException.forbidden('Your account is not linked to a school', 'NO_SCHOOL');
    return user.school_id;
  }

  async parentSchool(user: AuthUser, studentId?: number): Promise<number> {
    const [row] = await this.dataSource.query(
      `SELECT s.school_id FROM guardians g
       JOIN student_guardians sg ON sg.guardian_id = g.id
       JOIN students s ON s.id = sg.student_id AND s.deleted_at IS NULL AND s.status = 'active'
       WHERE g.user_id = $1 AND g.deleted_at IS NULL ${studentId !== undefined ? 'AND s.id = $2' : ''}
       ORDER BY (s.school_id = $${studentId !== undefined ? 3 : 2}) DESC LIMIT 1`,
      studentId !== undefined ? [user.id, studentId, user.school_id ?? 0] : [user.id, user.school_id ?? 0],
    );
    if (!row) throw AppException.notFound('This child is not linked to your mobile number', 'CHILD_NOT_FOUND');
    return Number(row.school_id);
  }

  isStaff(user: AuthUser): boolean {
    return user.roles.some((role) => !NOT_STAFF.includes(role));
  }

  async viewer(user: AuthUser, schoolId: number, app: ViewerApp, studentId?: number): Promise<Viewer> {
    const inParentApp = app === 'parent';
    const canManage = !inParentApp && user.permissions.includes(PERMISSIONS.GALLERY_MANAGE);
    const canView = canManage || (!inParentApp && user.permissions.includes(PERMISSIONS.GALLERY_VIEW));
    const isStaff = !inParentApp && this.isStaff(user);
    const isParent = app !== 'staff' && user.roles.includes(ROLES.PARENT);
    const [teaching, leading, children] = await Promise.all([
      isStaff ? this.teachingSections(schoolId, user.id) : Promise.resolve([]),
      isStaff ? this.classTeacherSections(schoolId, user.id) : Promise.resolve([]),
      isParent ? this.childSections(schoolId, user.id, studentId) : Promise.resolve([]),
    ]);
    if (studentId !== undefined && !children.length) {
      throw AppException.notFound('This child is not linked to your mobile number', 'CHILD_NOT_FOUND');
    }
    const keys = (rows: SectionRow[]) => [...new Set(rows.map((row) => classKey(row.academic_year_id, row.class_id)))];
    const ids = (rows: SectionRow[]) => [...new Set(rows.map((row) => Number(row.section_id)).filter(Boolean))];
    return {
      user_id: user.id,
      can_view_all: canView,
      can_manage_all: canManage,
      is_staff: isStaff,
      is_parent: isParent,
      teaching_sections: ids([...teaching, ...leading]),
      teaching_classes: keys([...teaching, ...leading]),
      class_teacher_sections: ids(leading),
      class_teacher_classes: keys(leading),
      child_sections: ids(children),
      child_classes: keys(children),
    };
  }

  albumFilter(viewer: Viewer, alias = 'a'): AccessFilter | null {
    if (viewer.can_view_all || viewer.can_manage_all) return null;
    const a = alias;
    const parts: string[] = [];
    const params: Record<string, unknown> = { viewerId: viewer.user_id };
    if (viewer.is_staff) {
      params.teachSections = viewer.teaching_sections;
      params.teachClasses = viewer.teaching_classes;
      params.leadSections = viewer.class_teacher_sections;
      params.leadClasses = viewer.class_teacher_classes;
      parts.push(
        `(${a}.scope = 'school' AND ${a}.status <> 'draft' AND ${a}.visibility <> 'parents')`,
        `(${a}.scope = 'section' AND ${a}.section_id = ANY(:teachSections::int[])
          AND (${a}.status <> 'draft' OR ${a}.created_by = :viewerId OR ${a}.section_id = ANY(:leadSections::int[])))`,
        `(${a}.scope = 'class' AND (${a}.academic_year_id || ':' || ${a}.class_id) = ANY(:teachClasses::text[])
          AND (${a}.status <> 'draft' OR ${a}.created_by = :viewerId
               OR (${a}.academic_year_id || ':' || ${a}.class_id) = ANY(:leadClasses::text[])))`,
      );
    }
    if (viewer.is_parent) {
      params.childSections = viewer.child_sections;
      params.childClasses = viewer.child_classes;
      parts.push(
        `(${a}.status = 'published' AND ${a}.visibility <> 'staff' AND (
           (${a}.scope = 'school' AND (${a}.visibility IN ('everyone', 'parents') OR (${a}.visibility = 'classes' AND (
              ${a}.section_ids && :childSections::int[]
              OR EXISTS (SELECT 1 FROM unnest(${a}.class_ids) cid WHERE (${a}.academic_year_id || ':' || cid) = ANY(:childClasses::text[]))))))
           OR (${a}.scope = 'section' AND ${a}.section_id = ANY(:childSections::int[]))
           OR (${a}.scope = 'class' AND (${a}.academic_year_id || ':' || ${a}.class_id) = ANY(:childClasses::text[]))))`,
      );
    }
    return { sql: parts.length ? `(${parts.join(' OR ')})` : 'false', params };
  }

  scopeFilter(settings: GallerySettings, viewer: Viewer, alias = 'a'): string | null {
    if (viewer.can_view_all || viewer.can_manage_all) return null;
    const off: string[] = [];
    if (!settings.app_gallery_enabled) off.push("'school'");
    if (!settings.class_gallery_enabled) off.push("'class'");
    if (!settings.section_gallery_enabled) off.push("'section'");
    return off.length ? `${alias}.scope NOT IN (${off.join(', ')})` : null;
  }

  canUploadByRole(user: AuthUser, settings: GallerySettings): boolean {
    if (user.permissions.includes(PERMISSIONS.GALLERY_MANAGE)) return true;
    return user.roles.some((role) => settings.upload_roles.includes(role));
  }

  async uploadTargets(schoolId: number, user: AuthUser): Promise<UploadTargetDto[]> {
    const rows: UploadTargetDto[] = await this.dataSource.query(
      `SELECT sec.id AS section_id, sec.name AS section_name, c.id AS class_id, c.name AS class_name,
              sec.academic_year_id, bool_or(sec.class_teacher_user_id = $2) AS is_class_teacher
       FROM sections sec
       JOIN academic_years y ON y.id = sec.academic_year_id AND y.is_current AND y.deleted_at IS NULL
       JOIN classes c ON c.id = sec.class_id
       LEFT JOIN teacher_assignments ta ON ta.section_id = sec.id AND ta.teacher_user_id = $2 AND ta.deleted_at IS NULL
       WHERE sec.school_id = $1 AND sec.deleted_at IS NULL
         AND (sec.class_teacher_user_id = $2 OR ta.id IS NOT NULL)
       GROUP BY sec.id, sec.name, c.id, c.name, c.grade_level, sec.academic_year_id
       ORDER BY c.grade_level, c.name, sec.name`,
      [schoolId, user.id],
    );
    return rows.map((row) => ({
      ...row,
      section_id: Number(row.section_id),
      class_id: Number(row.class_id),
      academic_year_id: Number(row.academic_year_id),
      is_class_teacher: Boolean(row.is_class_teacher),
    }));
  }

  private teachingSections(schoolId: number, userId: number): Promise<SectionRow[]> {
    return this.dataSource.query(
      `SELECT ta.section_id, sec.class_id, sec.academic_year_id
       FROM teacher_assignments ta JOIN sections sec ON sec.id = ta.section_id AND sec.deleted_at IS NULL
       WHERE ta.school_id = $1 AND ta.teacher_user_id = $2 AND ta.deleted_at IS NULL`,
      [schoolId, userId],
    );
  }

  private classTeacherSections(schoolId: number, userId: number): Promise<SectionRow[]> {
    return this.dataSource.query(
      `SELECT sec.id AS section_id, sec.class_id, sec.academic_year_id FROM sections sec
       WHERE sec.school_id = $1 AND sec.class_teacher_user_id = $2 AND sec.deleted_at IS NULL`,
      [schoolId, userId],
    );
  }

  private childSections(schoolId: number, userId: number, studentId?: number): Promise<SectionRow[]> {
    return this.dataSource.query(
      `SELECT e.section_id, e.class_id, e.academic_year_id
       FROM guardians g
       JOIN student_guardians sg ON sg.guardian_id = g.id
       JOIN students s ON s.id = sg.student_id AND s.deleted_at IS NULL AND s.status = 'active' AND s.school_id = $1
       JOIN student_enrollments e ON e.student_id = s.id
       WHERE g.user_id = $2 AND g.deleted_at IS NULL ${studentId !== undefined ? 'AND s.id = $3' : ''}`,
      studentId !== undefined ? [schoolId, userId, studentId] : [schoolId, userId],
    );
  }
}
