import { EntityManager } from 'typeorm';
import { SportsOnDuty } from '../../modules/achievements/entities/sports-on-duty.entity';
import { School } from '../../modules/schools/entities/school.entity';
import { AcademicYear } from '../../modules/setup/entities/academic-year.entity';

interface OnDutySeed {
  sport_name: string;
  title: string;
  from: number;
  to: number;
  session: 'morning' | 'afternoon' | null;
  venue: string | null;
  notes: string | null;
  students: number;
  includes_demo_child: boolean;
}

const MARKER = 'Zonal football meet';

const EVENTS: OnDutySeed[] = [
  {
    sport_name: 'Football',
    title: MARKER,
    from: -1,
    to: 1,
    session: null,
    venue: 'Nehru Stadium, Coimbatore',
    notes: 'Under-14 boys team with the PE teacher.',
    students: 4,
    includes_demo_child: false,
  },
  {
    sport_name: 'Chess',
    title: 'District chess championship',
    from: 0,
    to: 0,
    session: 'morning',
    venue: 'District Sports Office hall',
    notes: 'Back to class after lunch.',
    students: 2,
    includes_demo_child: false,
  },
  {
    sport_name: 'Athletics',
    title: 'Inter-school athletics trials',
    from: 0,
    to: 0,
    session: 'afternoon',
    venue: 'School ground',
    notes: null,
    students: 3,
    includes_demo_child: false,
  },
  {
    sport_name: 'Kabaddi',
    title: 'Inter-school kabaddi tournament',
    from: -21,
    to: -19,
    session: null,
    venue: 'Government Higher Secondary School, Pollachi',
    notes: 'Team reached the semi-final.',
    students: 5,
    includes_demo_child: true,
  },
  {
    sport_name: 'Volleyball',
    title: 'Zonal volleyball selection',
    from: 6,
    to: 7,
    session: null,
    venue: 'PSG Sports Complex',
    notes: 'Selected players travel by school bus.',
    students: 3,
    includes_demo_child: false,
  },
];

const IST_OFFSET_MS = 330 * 60 * 1000;

const dayFromToday = (offset: number) =>
  new Date(Date.now() + IST_OFFSET_MS + offset * 86_400_000).toISOString().slice(0, 10);

export async function seedDemoSportsOnDuty(manager: EntityManager, school: School): Promise<void> {
  const schoolId = school.id;
  if (await manager.exists(SportsOnDuty, { where: { school_id: schoolId, title: MARKER } })) {
    console.log(`Sports OD ${school.code}  on-duty students already set up: kept`);
    return;
  }
  const year = await manager.findOneBy(AcademicYear, { school_id: schoolId, is_current: true });
  if (!year) return;
  const students: { id: number }[] = await manager.query(
    `SELECT s.id FROM student_enrollments e
     JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL AND s.status = 'active'
     WHERE e.school_id = $1 AND e.academic_year_id = $2 AND e.section_id IS NOT NULL
     ORDER BY e.class_id DESC, e.section_id, e.roll_no NULLS LAST, s.id`,
    [schoolId, year.id],
  );
  if (!students.length) return;
  const [admin] = await manager.query(
    `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
     WHERE u.school_id = $1 AND r.code IN ('ADMIN', 'AO') AND u.deleted_at IS NULL ORDER BY r.code LIMIT 1`,
    [schoolId],
  );
  const [demoChild] = await manager.query(
    `SELECT sg.student_id AS id FROM student_guardians sg
     JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
     WHERE g.school_id = $1 AND g.mobile = '9000000005' ORDER BY sg.student_id LIMIT 1`,
    [schoolId],
  );
  const used = new Set<number>(demoChild ? [Number(demoChild.id)] : []);
  let next = 0;
  const pickStudents = (event: OnDutySeed) => {
    const ids = event.includes_demo_child && demoChild ? [Number(demoChild.id)] : [];
    while (ids.length < event.students && used.size < students.length) {
      const id = Number(students[(next * 11) % students.length]!.id);
      next += 1;
      if (used.has(id)) continue;
      used.add(id);
      ids.push(id);
    }
    return ids;
  };
  const rows = EVENTS.flatMap((event) =>
    pickStudents(event).map((studentId) =>
      manager.create(SportsOnDuty, {
        school_id: schoolId,
        student_id: studentId,
        sport_name: event.sport_name,
        title: event.title,
        from_date: dayFromToday(event.from),
        to_date: dayFromToday(event.to),
        session: event.session,
        venue: event.venue,
        notes: event.notes,
        created_by: admin ? Number(admin.id) : null,
      }),
    ),
  );
  await manager.save(rows);
  console.log(
    `Sports OD ${school.code}  ${rows.length} on-duty entries: today (full day, morning, afternoon), past and upcoming: created`,
  );
}
