import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppException } from '@app/common';
import { yearWhere } from '../../shared/year-context';
import { ROLES } from '../access/access.catalog';
import { AcademicYear } from '../setup/entities/academic-year.entity';
import { CandidateRow, mergeRecipients, MergedRecipient } from './emergency.logic';
import { EmergencyAudience, STAFF_GROUPS, StaffGroup } from './entities/emergency.entity';

export interface AudienceInput {
  audience: EmergencyAudience;
  class_ids?: number[] | null;
  section_ids?: number[] | null;
  student_ids?: number[] | null;
  include_teachers?: boolean;
  staff_groups?: StaffGroup[] | null;
}

export interface LabelledAudience extends AudienceInput {
  id: number;
}

const CREW = `EXISTS (SELECT 1 FROM user_roles gur JOIN roles gr ON gr.id = gur.role_id
    WHERE gur.user_id = st.user_id AND gr.code IN ('${ROLES.DRIVER}', '${ROLES.ATTENDANT}'))`;

const STAFF_GROUP_SQL: Record<StaffGroup, string> = {
  teachers: `st.staff_type = 'teaching'`,
  drivers: CREW,
  office: `(st.staff_type <> 'teaching' AND NOT ${CREW})`,
};

const GROUP_NAMES: Record<StaffGroup, string> = {
  teachers: 'teachers',
  drivers: 'drivers & attendants',
  office: 'office',
};

export function narrowStaffGroups(groups: StaffGroup[] | null | undefined): StaffGroup[] | null {
  const chosen = STAFF_GROUPS.filter((group) => groups?.includes(group));
  return chosen.length && chosen.length < STAFF_GROUPS.length ? chosen : null;
}

@Injectable()
export class AudienceService {
  constructor(private readonly dataSource: DataSource) {}

  async resolve(schoolId: number, input: AudienceInput): Promise<MergedRecipient[]> {
    const year = await this.dataSource.getRepository(AcademicYear).findOneBy(yearWhere(schoolId));
    if (!year) throw AppException.badRequest('Set the current academic year first', 'NO_CURRENT_YEAR');
    await this.assertInSchool(schoolId, year.id, input);
    const rows: CandidateRow[] = [];
    if (input.audience !== 'staff') rows.push(...(await this.parentRows(schoolId, year.id, input)));
    if (input.audience === 'everyone' || input.audience === 'staff') {
      rows.push(...(await this.staffRows(schoolId, null, narrowStaffGroups(input.staff_groups))));
    } else if (input.include_teachers && input.audience !== 'parents') {
      rows.push(...(await this.staffRows(schoolId, await this.teacherIds(year.id, input), null)));
    }
    return mergeRecipients(rows);
  }

  async labels(rows: LabelledAudience[]): Promise<Map<number, string>> {
    const classIds = [...new Set(rows.flatMap((row) => row.class_ids ?? []))];
    const sectionIds = [...new Set(rows.flatMap((row) => row.section_ids ?? []))];
    const [classes, sections] = await Promise.all([
      classIds.length
        ? (this.dataSource.query(`SELECT id, name FROM classes WHERE id = ANY($1)`, [classIds]) as Promise<
            { id: number; name: string }[]
          >)
        : Promise.resolve([]),
      sectionIds.length
        ? (this.dataSource.query(
            `SELECT sec.id, c.name || ' - ' || sec.name AS name FROM sections sec JOIN classes c ON c.id = sec.class_id WHERE sec.id = ANY($1)`,
            [sectionIds],
          ) as Promise<{ id: number; name: string }[]>)
        : Promise.resolve([]),
    ]);
    const names = (ids: number[] | null | undefined, list: { id: number; name: string }[], prefix = '') =>
      (ids ?? []).map((id) => `${prefix}${list.find((item) => Number(item.id) === id)?.name ?? id}`).join(', ');
    const teachers = (row: LabelledAudience) => (row.include_teachers ? ' and their teachers' : '');
    const groups = (row: LabelledAudience) =>
      (narrowStaffGroups(row.staff_groups) ?? []).map((group) => GROUP_NAMES[group]);
    return new Map(
      rows.map((row) => {
        const chosen = groups(row);
        const label =
          row.audience === 'everyone'
            ? chosen.length
              ? `All parents and staff: ${chosen.join(', ')}`
              : 'All parents and staff'
            : row.audience === 'parents'
              ? 'All parents'
              : row.audience === 'staff'
                ? chosen.length
                  ? `Staff: ${chosen.join(', ')}`
                  : 'All staff'
                : row.audience === 'classes'
                  ? `Parents of ${names(row.class_ids, classes, 'Class ')}${teachers(row)}`
                  : row.audience === 'sections'
                    ? `Parents of ${names(row.section_ids, sections)}${teachers(row)}`
                    : `Parents of ${row.student_ids?.length ?? 0} ${row.student_ids?.length === 1 ? 'student' : 'students'}${teachers(row)}`;
        return [row.id, label];
      }),
    );
  }

  private parentRows(schoolId: number, yearId: number, input: AudienceInput): Promise<CandidateRow[]> {
    const filters: Record<string, [string, number[] | null | undefined]> = {
      classes: ['AND e.class_id = ANY($3)', input.class_ids],
      sections: ['AND e.section_id = ANY($3)', input.section_ids],
      students: ['AND s.id = ANY($3)', input.student_ids],
    };
    const [filter, ids] = filters[input.audience] ?? ['', undefined];
    return this.dataSource.query(
      `SELECT 'parent' AS kind, CASE WHEN u.id IS NOT NULL THEN g.user_id END AS user_id, g.id AS guardian_id,
              g.name, COALESCE(u.mobile, g.mobile) AS mobile, u.language,
              s.id AS student_id, concat_ws(' ', s.first_name, s.last_name) AS student_name,
              c.name || ' - ' || sec.name AS section
       FROM student_enrollments e
       JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL AND s.status = 'active'
       JOIN student_guardians sg ON sg.student_id = s.id
       JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
       LEFT JOIN users u ON u.id = g.user_id AND u.deleted_at IS NULL AND u.status = 'active'
       LEFT JOIN sections sec ON sec.id = e.section_id
       LEFT JOIN classes c ON c.id = e.class_id
       WHERE s.school_id = $1 AND e.academic_year_id = $2 ${filter}`,
      ids ? [schoolId, yearId, ids] : [schoolId, yearId],
    );
  }

  private staffRows(schoolId: number, userIds: number[] | null, groups: StaffGroup[] | null): Promise<CandidateRow[]> {
    if (userIds && !userIds.length) return Promise.resolve([]);
    const groupFilter = groups ? `AND (${groups.map((group) => STAFF_GROUP_SQL[group]).join(' OR ')})` : '';
    return this.dataSource.query(
      `SELECT 'staff' AS kind, u.id AS user_id, NULL::int AS guardian_id, u.name, u.mobile, u.language
       FROM staff st JOIN users u ON u.id = st.user_id AND u.deleted_at IS NULL AND u.status = 'active'
       WHERE st.school_id = $1 AND st.deleted_at IS NULL AND st.status <> 'resigned'
         ${userIds ? 'AND st.user_id = ANY($2)' : ''} ${groupFilter}`,
      userIds ? [schoolId, userIds] : [schoolId],
    );
  }

  private async teacherIds(yearId: number, input: AudienceInput): Promise<number[]> {
    const sectionQueries: Record<string, [string, number[] | null | undefined]> = {
      classes: [
        `SELECT id FROM sections WHERE class_id = ANY($1) AND academic_year_id = $2 AND deleted_at IS NULL`,
        input.class_ids,
      ],
      sections: [`SELECT id FROM sections WHERE id = ANY($1) AND academic_year_id = $2`, input.section_ids],
      students: [
        `SELECT DISTINCT section_id AS id FROM student_enrollments
         WHERE student_id = ANY($1) AND academic_year_id = $2 AND section_id IS NOT NULL`,
        input.student_ids,
      ],
    };
    const entry = sectionQueries[input.audience];
    if (!entry) return [];
    const sections: { id: number }[] = await this.dataSource.query(entry[0], [entry[1] ?? [], yearId]);
    const sectionIds = sections.map((row) => Number(row.id));
    if (!sectionIds.length) return [];
    const teachers: { user_id: number }[] = await this.dataSource.query(
      `SELECT class_teacher_user_id AS user_id FROM sections WHERE id = ANY($1) AND class_teacher_user_id IS NOT NULL
       UNION
       SELECT teacher_user_id FROM teacher_assignments WHERE section_id = ANY($1) AND academic_year_id = $2 AND deleted_at IS NULL`,
      [sectionIds, yearId],
    );
    return teachers.map((row) => Number(row.user_id));
  }

  private async assertInSchool(schoolId: number, yearId: number, input: AudienceInput): Promise<void> {
    const checks: [number[] | null | undefined, string, unknown[], string][] = [
      [
        input.audience === 'classes' ? input.class_ids : undefined,
        `SELECT COUNT(*) AS total FROM classes WHERE id = ANY($1) AND school_id = $2 AND deleted_at IS NULL`,
        [],
        'classes',
      ],
      [
        input.audience === 'sections' ? input.section_ids : undefined,
        `SELECT COUNT(*) AS total FROM sections WHERE id = ANY($1) AND school_id = $2 AND academic_year_id = $3 AND deleted_at IS NULL`,
        [yearId],
        'sections',
      ],
      [
        input.audience === 'students' ? input.student_ids : undefined,
        `SELECT COUNT(*) AS total FROM students WHERE id = ANY($1) AND school_id = $2 AND deleted_at IS NULL`,
        [],
        'students',
      ],
    ];
    for (const [ids, sql, extra, label] of checks) {
      if (!ids?.length) continue;
      const [row] = await this.dataSource.query(sql, [ids, schoolId, ...extra]);
      if (Number(row?.total ?? 0) !== ids.length) {
        throw AppException.badRequest(`Some of the chosen ${label} are not in this school`, 'AUDIENCE_INVALID');
      }
    }
  }
}
