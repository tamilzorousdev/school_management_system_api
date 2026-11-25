import { yearClause } from '../../shared/year-context';

export function studentJoins(studentAlias: string): string {
  return `LEFT JOIN academic_years ay ON ay.school_id = ${studentAlias}.school_id AND ay.deleted_at IS NULL AND ${yearClause('ay')}
       LEFT JOIN student_enrollments e ON e.student_id = ${studentAlias}.id AND e.academic_year_id = ay.id
       LEFT JOIN classes cls ON cls.id = e.class_id
       LEFT JOIN sections sec ON sec.id = e.section_id`;
}

export const STUDENT_COLUMNS = `s.id AS student_id, TRIM(CONCAT(s.first_name, ' ', s.last_name)) AS student_name,
         s.admission_no AS student_admission_no, s.gender AS student_gender, s.photo_file_id AS student_photo_file_id,
         cls.name AS class_name, sec.name AS section_name`;

export function studentFromRow(row: Record<string, unknown>) {
  return {
    id: row.student_id as number,
    name: row.student_name as string,
    admission_no: row.student_admission_no as string,
    gender: row.student_gender as string,
    class_name: (row.class_name as string | null) ?? null,
    section_name: (row.section_name as string | null) ?? null,
    photo_file_id: (row.student_photo_file_id as number | null) ?? null,
  };
}

export const escapeLike = (value: string) => value.replace(/[\\%_]/g, (match) => `\\${match}`);
