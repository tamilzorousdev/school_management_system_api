import { EntityManager } from 'typeorm';
import {
  SpecialAttendanceStatus,
  SpecialClass,
  SpecialClassAttendance,
  SpecialClassStudent,
  SpecialKind,
} from '../../modules/performance/entities/special-class.entity';
import { School } from '../../modules/schools/entities/school.entity';
import { AcademicYear } from '../../modules/setup/entities/academic-year.entity';

interface SectionRow {
  id: number;
  class_id: number;
  name: string;
  grade_level: number;
  class_teacher_user_id: number | null;
  students: number;
}

interface PlanRow {
  kind: SpecialKind;
  days: number[];
  start_time: string;
  end_time: string;
  subjects: string[];
  title: (subject: string) => string;
  notes: string;
}

const SPECIAL_PLAN: PlanRow = {
  kind: 'special',
  days: [1, 3, 5],
  start_time: '07:50',
  end_time: '08:40',
  subjects: ['Mathematics', 'Science', 'English'],
  title: (subject) => `Revision class – ${subject}`,
  notes: 'Whole class revision before the first period.',
};

const EXTRA_PLAN: PlanRow = {
  kind: 'extra',
  days: [2, 4],
  start_time: '16:00',
  end_time: '16:50',
  subjects: ['Mathematics', 'English', 'Science'],
  title: (subject) => `Extra coaching – ${subject}`,
  notes: 'For students below the class average in the last exam.',
};

const MARKER_PREFIXES = ['Revision class – ', 'Extra coaching – '];
const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 86_400_000;

const istDate = (offsetDays: number) =>
  new Date(Date.now() + IST_OFFSET_MS + offsetDays * DAY_MS).toISOString().slice(0, 10);

const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

const attendanceStatus = (index: number): SpecialAttendanceStatus =>
  index % 9 === 4 ? 'absent' : index % 11 === 7 ? 'late' : 'present';

export async function seedDemoSpecialClasses(manager: EntityManager, school: School): Promise<void> {
  const schoolId = school.id;
  const [existing]: { count: string }[] = await manager.query(
    `SELECT COUNT(*) AS count FROM special_classes WHERE school_id = $1 AND (title LIKE $2 OR title LIKE $3)`,
    [schoolId, `${MARKER_PREFIXES[0]}%`, `${MARKER_PREFIXES[1]}%`],
  );
  if (Number(existing?.count ?? 0) > 0) {
    console.log(`Special   ${school.code}  revision and extra coaching classes already set up: kept`);
    return;
  }
  const year = await manager.findOneBy(AcademicYear, { school_id: schoolId, is_current: true });
  if (!year) return;
  const sections: SectionRow[] = await manager.query(
    `SELECT sec.id, sec.class_id, c.name || ' - ' || sec.name AS name, c.grade_level, sec.class_teacher_user_id,
            (SELECT COUNT(*) FROM student_enrollments e JOIN students s ON s.id = e.student_id
              WHERE e.section_id = sec.id AND s.deleted_at IS NULL AND s.status = 'active')::int AS students
     FROM sections sec JOIN classes c ON c.id = sec.class_id
     WHERE sec.school_id = $1 AND sec.academic_year_id = $2 AND sec.deleted_at IS NULL
     ORDER BY c.grade_level DESC, sec.name`,
    [schoolId, year.id],
  );
  const withStudents = sections.filter((section) => Number(section.students) >= 4);
  if (!withStudents.length) return;
  const [admin] = await manager.query(
    `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
     WHERE u.school_id = $1 AND r.code IN ('ADMIN', 'AO') AND u.deleted_at IS NULL ORDER BY r.code LIMIT 1`,
    [schoolId],
  );
  const busy = new Set<string>();
  const startDate = istDate(-21);
  const endDate = istDate(45);
  const today = istDate(0);

  const teacherFor = async (section: SectionRow, plan: PlanRow) => {
    const options: { teacher_user_id: number; subject_id: number; subject: string }[] = await manager.query(
      `SELECT ta.teacher_user_id, ta.subject_id, sub.name AS subject FROM teacher_assignments ta
       JOIN subjects sub ON sub.id = ta.subject_id
       WHERE ta.section_id = $1 AND ta.academic_year_id = $2 AND ta.deleted_at IS NULL`,
      [section.id, year.id],
    );
    const ranked = [
      ...plan.subjects.flatMap((name) => options.filter((option) => option.subject === name)),
      ...options.filter((option) => !plan.subjects.includes(option.subject)),
    ];
    const free = ranked.find((option) =>
      plan.days.every((day) => !busy.has(`${option.teacher_user_id}:${day}:${plan.start_time}`)),
    );
    if (free)
      return { teacher: Number(free.teacher_user_id), subject_id: Number(free.subject_id), subject: free.subject };
    const fallback = section.class_teacher_user_id ? Number(section.class_teacher_user_id) : null;
    if (fallback && plan.days.every((day) => !busy.has(`${fallback}:${day}:${plan.start_time}`))) {
      return { teacher: fallback, subject_id: null, subject: 'All subjects' };
    }
    return null;
  };

  const belowAverage = async (sectionId: number): Promise<number[]> => {
    const rows: { student_id: number; percent: number | null }[] = await manager.query(
      `SELECT e.student_id,
              AVG(m.marks * 100.0 / NULLIF(es.max_marks, 0)) FILTER (WHERE NOT m.is_absent) AS percent
       FROM student_enrollments e
       JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL AND s.status = 'active'
       LEFT JOIN exam_marks m ON m.student_id = e.student_id
       LEFT JOIN exam_subjects es ON es.exam_id = m.exam_id AND es.subject_id = m.subject_id AND es.class_id = e.class_id
       WHERE e.section_id = $1
       GROUP BY e.student_id, e.roll_no
       ORDER BY percent ASC NULLS LAST, e.roll_no NULLS LAST, e.student_id`,
      [sectionId],
    );
    return rows.slice(0, Math.min(5, Math.max(2, Math.floor(rows.length / 3)))).map((row) => Number(row.student_id));
  };

  const sectionStudents = async (sectionId: number): Promise<number[]> =>
    (
      await manager.query(
        `SELECT e.student_id FROM student_enrollments e
         JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL AND s.status = 'active'
         WHERE e.section_id = $1 ORDER BY e.roll_no NULLS LAST, e.student_id`,
        [sectionId],
      )
    ).map((row: { student_id: number }) => Number(row.student_id));

  const pastDates = (days: number[]) => {
    const dates: string[] = [];
    for (let offset = -21; offset < 0; offset += 1) {
      const date = istDate(offset);
      if (date >= startDate && date < today && days.includes(weekdayOf(date))) dates.push(date);
    }
    return dates;
  };

  let specials = 0;
  let extras = 0;
  let marks = 0;
  const create = async (section: SectionRow, plan: PlanRow) => {
    const choice = await teacherFor(section, plan);
    if (!choice) return false;
    for (const day of plan.days) busy.add(`${choice.teacher}:${day}:${plan.start_time}`);
    const saved = await manager.save(
      manager.create(SpecialClass, {
        school_id: schoolId,
        academic_year_id: year.id,
        section_id: Number(section.id),
        subject_id: choice.subject_id,
        teacher_user_id: choice.teacher,
        kind: plan.kind,
        timing: 'extra_time',
        day_of_week: null,
        period_no: null,
        days: plan.days,
        start_time: plan.start_time,
        end_time: plan.end_time,
        start_date: startDate,
        end_date: endDate,
        day_part: 'custom',
        title: plan.title(choice.subject),
        notes: plan.notes,
        created_by: admin ? Number(admin.id) : null,
      }),
    );
    const students =
      plan.kind === 'extra' ? await belowAverage(Number(section.id)) : await sectionStudents(Number(section.id));
    if (plan.kind === 'extra') {
      await manager.insert(
        SpecialClassStudent,
        students.map((studentId) => ({ special_class_id: saved.id, student_id: studentId, school_id: schoolId })),
      );
    }
    const rows = pastDates(plan.days).flatMap((date, dateIndex) =>
      students.map((studentId, index) => ({
        school_id: schoolId,
        special_class_id: saved.id,
        date,
        student_id: studentId,
        status: attendanceStatus(index + dateIndex),
        marked_by: choice.teacher,
        alert_sent: false,
      })),
    );
    if (rows.length) await manager.insert(SpecialClassAttendance, rows);
    marks += rows.length;
    return true;
  };

  for (const section of withStudents.slice(0, 3)) {
    if (await create(section, SPECIAL_PLAN)) specials += 1;
  }
  for (const section of withStudents.slice(0, 4)) {
    if (await create(section, EXTRA_PLAN)) extras += 1;
  }
  const allowed = [...new Set(withStudents.slice(0, 3).map((section) => Number(section.class_id)))];
  await manager.query(
    `UPDATE schools SET special_class_class_ids =
       (SELECT ARRAY(SELECT DISTINCT unnest(COALESCE(special_class_class_ids, '{}'::int[]) || $2::int[])))
     WHERE id = $1 AND special_class_class_ids IS NOT NULL`,
    [schoolId, allowed],
  );
  console.log(
    `Special   ${school.code}  ${specials} whole-class revision classes (Mon, Wed, Fri 07:50) and ${extras} extra coaching classes for below-average students (Tue, Thu 16:00), ${marks} attendance marks: created`,
  );
}
