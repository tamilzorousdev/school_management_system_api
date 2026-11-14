import { EntityManager } from 'typeorm';
import { StudentFeedback, TeacherRating } from '../../modules/feedback/entities/feedback.entity';
import { ratingCycle } from '../../modules/feedback/feedback.logic';
import { School } from '../../modules/schools/entities/school.entity';
import { AcademicYear } from '../../modules/setup/entities/academic-year.entity';
import { Term } from '../../modules/setup/entities/term.entity';

const KEEP_FREE = ['9000000004', '9000000005'];
const RATING_MONTHS = 3;
const IST_OFFSET_MS = 330 * 60 * 1000;

const GOOD_REMARKS = [
  'Explains every lesson patiently and clears doubts.',
  'My child looks forward to this class.',
  'Very supportive and gives regular feedback.',
  'Homework is clear and well planned.',
  null,
  null,
];
const BAD_REMARKS = ['Speaks harshly to the children.', 'Classes often start late.', 'Homework is not corrected.'];
const STUDENT_REMARKS = [
  'Participates well in class discussions.',
  'Needs to practise maths every day.',
  'Very disciplined and helpful to classmates.',
  'Should read more at home.',
  null,
];

const today = () => new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);

const dayBefore = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

const pattern = (index: number) => {
  const stars = [5, 4, 5, 4, 3, 5, 4, 2, 5, 4, 1, 4][index % 12]!;
  return { stars, behaviour: stars <= 2 ? ('bad' as const) : ('good' as const) };
};

export async function seedDemoFeedback(manager: EntityManager, school: School): Promise<void> {
  const schoolId = school.id;
  if (await manager.exists(TeacherRating, { where: { school_id: schoolId } })) {
    console.log(`Feedback  ${school.code}  parent ratings and student feedback already set up: kept`);
    return;
  }
  const year = await manager.findOneBy(AcademicYear, { school_id: schoolId, is_current: true });
  if (!year) return;
  const now = today();
  const current = ratingCycle(year.start_date, year.end_date, now, RATING_MONTHS);
  if (!current) return;
  const previous =
    current.start > year.start_date
      ? ratingCycle(year.start_date, year.end_date, dayBefore(current.start), RATING_MONTHS)
      : null;
  await manager.update(School, schoolId, {
    teacher_rating_enabled: true,
    teacher_rating_months: RATING_MONTHS,
    student_feedback_enabled: true,
  });

  const pairs: {
    parent_user_id: number;
    student_id: number;
    section_id: number;
    teacher_user_id: number;
  }[] = await manager.query(
    `SELECT DISTINCT g.user_id AS parent_user_id, e.student_id, e.section_id, ta.teacher_user_id
     FROM student_guardians sg
     JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL AND g.user_id IS NOT NULL
     JOIN users pu ON pu.id = g.user_id AND pu.mobile <> ALL($3)
     JOIN students s ON s.id = sg.student_id AND s.deleted_at IS NULL AND s.status = 'active'
     JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = $2 AND e.section_id IS NOT NULL
     JOIN teacher_assignments ta ON ta.section_id = e.section_id AND ta.academic_year_id = $2 AND ta.deleted_at IS NULL
     WHERE s.school_id = $1
     ORDER BY g.user_id, e.student_id, ta.teacher_user_id`,
    [schoolId, year.id, KEEP_FREE],
  );
  const ratings: Partial<TeacherRating>[] = [];
  pairs.forEach((pair, index) => {
    if (index % 3 === 2) return;
    const cycle = previous && index % 4 === 0 ? previous : current;
    const { stars, behaviour } = pattern(index);
    const remarks = behaviour === 'bad' ? BAD_REMARKS : GOOD_REMARKS;
    ratings.push({
      school_id: schoolId,
      academic_year_id: year.id,
      teacher_user_id: Number(pair.teacher_user_id),
      parent_user_id: Number(pair.parent_user_id),
      student_id: Number(pair.student_id),
      section_id: Number(pair.section_id),
      stars,
      behaviour,
      remark: remarks[index % remarks.length] ?? null,
      cycle_start: cycle.start,
      cycle_end: cycle.end,
      created_by: Number(pair.parent_user_id),
    });
  });
  for (let start = 0; start < ratings.length; start += 200) {
    await manager.insert(TeacherRating, ratings.slice(start, start + 200));
  }

  const term = await manager
    .getRepository(Term)
    .createQueryBuilder('t')
    .where('t.school_id = :schoolId AND t.academic_year_id = :yearId', { schoolId, yearId: year.id })
    .andWhere(':today BETWEEN t.start_date AND t.end_date', { today: now })
    .getOne();
  const termId = term?.id ?? 0;
  const classes: { section_id: number; teacher_user_id: number; student_id: number }[] = await manager.query(
    `SELECT sec.id AS section_id, sec.class_teacher_user_id AS teacher_user_id, e.student_id
     FROM sections sec
     JOIN users t ON t.id = sec.class_teacher_user_id AND t.mobile <> ALL($3)
     JOIN student_enrollments e ON e.section_id = sec.id AND e.academic_year_id = $2
     JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL AND s.status = 'active'
     WHERE sec.school_id = $1 AND sec.academic_year_id = $2 AND sec.deleted_at IS NULL
     ORDER BY sec.id, e.roll_no NULLS LAST, s.id`,
    [schoolId, year.id, KEEP_FREE],
  );
  const feedback: Partial<StudentFeedback>[] = classes
    .filter((_, index) => index % 5 !== 4)
    .map((row, index) => ({
      school_id: schoolId,
      academic_year_id: year.id,
      term_id: termId,
      teacher_user_id: Number(row.teacher_user_id),
      student_id: Number(row.student_id),
      section_id: Number(row.section_id),
      studies: [4, 5, 3, 4, 2, 5][index % 6]!,
      behaviour: [5, 4, 5, 3, 4, 5][index % 6]!,
      sports: index % 3 === 0 ? null : [3, 4, 5][index % 3]!,
      remark: STUDENT_REMARKS[index % STUDENT_REMARKS.length] ?? null,
      created_by: Number(row.teacher_user_id),
    }));
  for (let start = 0; start < feedback.length; start += 200) {
    await manager.insert(StudentFeedback, feedback.slice(start, start + 200));
  }
  console.log(
    `Feedback  ${school.code}  ratings on (every ${RATING_MONTHS} months), ${ratings.length} parent ratings, ${feedback.length} student feedback for ${term?.name ?? year.name}: created`,
  );
}
