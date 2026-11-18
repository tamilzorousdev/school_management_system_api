import { EntityManager, IsNull } from 'typeorm';
import { ROLES } from '../../modules/access/access.catalog';
import { Role } from '../../modules/access/entities/role.entity';
import { SequencesService } from '../../modules/schools/sequences.service';
import { School } from '../../modules/schools/entities/school.entity';
import { AcademicYear } from '../../modules/setup/entities/academic-year.entity';
import { ClassSubject } from '../../modules/setup/entities/class-subject.entity';
import { Holiday, HolidayType } from '../../modules/setup/entities/holiday.entity';
import { SchoolClass } from '../../modules/setup/entities/school-class.entity';
import { Section } from '../../modules/setup/entities/section.entity';
import { Subject, SubjectType } from '../../modules/setup/entities/subject.entity';
import { Term } from '../../modules/setup/entities/term.entity';
import { Admission } from '../../modules/students/entities/admission.entity';
import { Guardian } from '../../modules/students/entities/guardian.entity';
import { StudentEnrollment } from '../../modules/students/entities/student-enrollment.entity';
import { Relation, StudentGuardian } from '../../modules/students/entities/student-guardian.entity';
import { Gender, Student } from '../../modules/students/entities/student.entity';
import { UserRole } from '../../modules/users/entities/user-role.entity';
import { Language, User } from '../../modules/users/entities/user.entity';

interface DemoParent {
  name: string;
  mobile: string;
  relation: Relation;
  occupation: string;
  qualification: string;
  language?: Language;
}

interface DemoChild {
  first_name: string;
  last_name: string;
  gender: Gender;
  dob: string;
  admitted: string;
  class: string;
  section: string;
  house: string;
  last_year?: [string, string];
}

interface DemoFamily {
  parents: DemoParent[];
  children: DemoChild[];
}

const SUBJECTS: [string, string, SubjectType][] = [
  ['ENG', 'English', 'language'],
  ['TAM', 'Tamil', 'language'],
  ['HIN', 'Hindi', 'language'],
  ['MATH', 'Mathematics', 'theory'],
  ['SCI', 'Science', 'theory'],
  ['SOC', 'Social Science', 'theory'],
  ['EVS', 'Environmental Studies', 'theory'],
  ['CS', 'Computer Science', 'practical'],
  ['PE', 'Physical Education', 'activity'],
  ['ART', 'Art and Craft', 'activity'],
];

const MIDDLE_SCHOOL_SUBJECTS: [string, number, boolean][] = [
  ['ENG', 6, false],
  ['TAM', 5, false],
  ['MATH', 7, false],
  ['SCI', 6, false],
  ['SOC', 5, false],
  ['CS', 2, false],
  ['PE', 2, false],
  ['HIN', 3, true],
];

const HOLIDAYS: [string, string | null, string, HolidayType][] = [
  ['2026-08-15', null, 'Independence Day', 'holiday'],
  ['2026-10-02', null, 'Gandhi Jayanti', 'holiday'],
  ['2026-11-08', null, 'Deepavali', 'holiday'],
  ['2026-12-24', '2027-01-01', 'Christmas holidays', 'holiday'],
  ['2027-01-14', '2027-01-16', 'Pongal', 'holiday'],
  ['2027-01-26', null, 'Republic Day', 'holiday'],
  ['2027-02-20', null, 'Annual Day', 'event'],
  ['2027-04-14', null, 'Tamil New Year', 'holiday'],
];

const FAMILIES: DemoFamily[] = [
  {
    parents: [
      {
        name: 'Lakshmi Narayanan',
        mobile: '9000000005',
        relation: 'mother',
        occupation: 'Teacher',
        qualification: 'M.A., B.Ed.',
        language: 'ta',
      },
      {
        name: 'Ramesh Narayanan',
        mobile: '9000000015',
        relation: 'father',
        occupation: 'Software engineer',
        qualification: 'B.E.',
      },
    ],
    children: [
      {
        first_name: 'Kavin',
        last_name: 'Narayanan',
        gender: 'male',
        dob: '2015-04-12',
        admitted: '2021-06-03',
        class: '6',
        section: 'A',
        house: 'Red',
        last_year: ['5', 'A'],
      },
      {
        first_name: 'Nila',
        last_name: 'Narayanan',
        gender: 'female',
        dob: '2018-07-21',
        admitted: '2023-06-05',
        class: '3',
        section: 'A',
        house: 'Blue',
      },
    ],
  },
  {
    parents: [
      {
        name: 'Arun Prakash',
        mobile: '9000000006',
        relation: 'father',
        occupation: 'Teacher',
        qualification: 'M.Sc., B.Ed.',
      },
      {
        name: 'Deepa Arun',
        mobile: '9000000016',
        relation: 'mother',
        occupation: 'Nurse',
        qualification: 'B.Sc. Nursing',
      },
    ],
    children: [
      {
        first_name: 'Harini',
        last_name: 'Arun',
        gender: 'female',
        dob: '2014-09-03',
        admitted: '2020-06-08',
        class: '7',
        section: 'A',
        house: 'Green',
        last_year: ['6', 'A'],
      },
    ],
  },
  {
    parents: [
      {
        name: 'Murugan K',
        mobile: '9000000017',
        relation: 'father',
        occupation: 'Business',
        qualification: 'B.Com.',
        language: 'ta',
      },
      {
        name: 'Selvi Murugan',
        mobile: '9000000018',
        relation: 'mother',
        occupation: 'Homemaker',
        qualification: 'HSC',
        language: 'ta',
      },
    ],
    children: [
      {
        first_name: 'Surya',
        last_name: 'Murugan',
        gender: 'male',
        dob: '2013-01-19',
        admitted: '2019-06-10',
        class: '8',
        section: 'A',
        house: 'Yellow',
      },
      {
        first_name: 'Yazhini',
        last_name: 'Murugan',
        gender: 'female',
        dob: '2015-11-02',
        admitted: '2021-06-03',
        class: '6',
        section: 'B',
        house: 'Yellow',
      },
    ],
  },
];

const SINGLE_CHILDREN: [string, Gender, string, string, string, string][] = [
  ['Aadhavan', 'male', 'Senthil', '6', 'A', 'Red'],
  ['Bharath', 'male', 'Kumar', '6', 'A', 'Blue'],
  ['Dharshini', 'female', 'Ravi', '6', 'A', 'Green'],
  ['Ezhil', 'male', 'Mani', '6', 'A', 'Yellow'],
  ['Gowtham', 'male', 'Raja', '6', 'A', 'Red'],
  ['Ishwarya', 'female', 'Suresh', '6', 'A', 'Blue'],
  ['Janani', 'female', 'Bala', '6', 'A', 'Green'],
  ['Karthikeyan', 'male', 'Vel', '6', 'A', 'Yellow'],
  ['Logesh', 'male', 'Anand', '6', 'B', 'Red'],
  ['Madhumitha', 'female', 'Prabhu', '6', 'B', 'Blue'],
  ['Naveen', 'male', 'Shankar', '6', 'B', 'Green'],
  ['Oviya', 'female', 'Ganesh', '6', 'B', 'Yellow'],
  ['Pranav', 'male', 'Sekar', '7', 'A', 'Red'],
  ['Rithika', 'female', 'Mohan', '7', 'A', 'Blue'],
  ['Sanjay', 'male', 'Kannan', '7', 'A', 'Green'],
  ['Tharun', 'male', 'Babu', '7', 'A', 'Yellow'],
  ['Varsha', 'female', 'Rajan', '7', 'A', 'Red'],
  ['Yogesh', 'male', 'Durai', '7', 'B', 'Blue'],
  ['Abinaya', 'female', 'Siva', '7', 'B', 'Green'],
  ['Bala', 'male', 'Murthy', '8', 'A', 'Red'],
  ['Divya', 'female', 'Natarajan', '8', 'A', 'Blue'],
  ['Harish', 'male', 'Pandian', '8', 'B', 'Green'],
  ['Keerthana', 'female', 'Saravanan', '8', 'B', 'Yellow'],
  ['Mithran', 'male', 'Arjun', '1', 'A', 'Red'],
  ['Nandhini', 'female', 'Vasu', 'UKG', 'A', 'Blue'],
];

const APPLICATIONS: [string, string, Gender, string, string, string, Admission['status'], string | null][] = [
  ['Inba', 'Selvam', 'female', '2020-03-11', '1', '9000000101', 'applied', null],
  ['Mathi', 'Raja', 'male', '2015-08-25', '6', '9000000102', 'applied', null],
  ['Thamizh', 'Arasu', 'male', '2014-05-30', '7', '9000000103', 'approved', 'Entrance interview cleared'],
  ['Vennila', 'Kumar', 'female', '2012-12-14', '9', '9000000104', 'rejected', 'No seats left in class 9 this year'],
];

const CLASS_TEACHERS: Record<string, string> = { '6-A': '9000000004', '7-A': '9000000006', '6-B': '9000000001' };

function classOrder(name: string): number {
  if (name === 'LKG') return -1;
  if (name === 'UKG') return 0;
  return Number(name);
}

async function ensureParentUser(
  manager: EntityManager,
  schoolId: number,
  parent: DemoParent,
  parentRole: Role,
): Promise<number> {
  let user = await manager.findOneBy(User, { mobile: parent.mobile, deleted_at: IsNull() });
  if (!user) {
    user = await manager.save(
      manager.create(User, {
        school_id: schoolId,
        name: parent.name,
        mobile: parent.mobile,
        status: 'active',
        language: parent.language ?? 'en',
      }),
    );
  }
  await manager
    .createQueryBuilder()
    .insert()
    .into(UserRole)
    .values({ user_id: user.id, role_id: parentRole.id })
    .orIgnore()
    .execute();
  return user.id;
}

export async function seedDemoAcademics(manager: EntityManager, school: School): Promise<void> {
  if (await manager.exists(AcademicYear, { where: { school_id: school.id, name: '2026-27' } })) {
    console.log(`Academics ${school.code}  2026-27 already set up: kept`);
    return;
  }
  const sequences = new SequencesService();
  const schoolId = school.id;

  const lastYear = await manager.save(
    manager.create(AcademicYear, {
      school_id: schoolId,
      name: '2025-26',
      start_date: '2025-06-02',
      end_date: '2026-04-30',
      is_current: false,
      status: 'closed',
    }),
  );
  const year = await manager.save(
    manager.create(AcademicYear, {
      school_id: schoolId,
      name: '2026-27',
      start_date: '2026-06-01',
      end_date: '2027-04-30',
      is_current: true,
      status: 'active',
    }),
  );
  await manager.save(
    [
      ['Term 1', '2026-06-01', '2026-09-30'],
      ['Term 2', '2026-10-01', '2026-12-31'],
      ['Term 3', '2027-01-01', '2027-04-30'],
    ].map(([name, start, end], index) =>
      manager.create(Term, {
        school_id: schoolId,
        academic_year_id: year.id,
        name,
        start_date: start,
        end_date: end,
        sort_order: index + 1,
      }),
    ),
  );

  const classNames = ['LKG', 'UKG', ...Array.from({ length: 12 }, (_, index) => String(index + 1))];
  const classes = new Map<string, SchoolClass>();
  for (const name of classNames) {
    const existing = await manager.findOneBy(SchoolClass, { school_id: schoolId, name });
    classes.set(
      name,
      existing ??
        (await manager.save(manager.create(SchoolClass, { school_id: schoolId, name, grade_level: classOrder(name) }))),
    );
  }

  const teacherIds = new Map<string, number>();
  for (const [key, mobile] of Object.entries(CLASS_TEACHERS)) {
    const user = await manager.findOneBy(User, { mobile, deleted_at: IsNull() });
    if (user) teacherIds.set(key, user.id);
  }
  const sections = new Map<string, Section>();
  for (const name of classNames) {
    const letters = ['6', '7', '8'].includes(name) ? ['A', 'B'] : ['A'];
    for (const letter of letters) {
      const key = `${name}-${letter}`;
      sections.set(
        key,
        await manager.save(
          manager.create(Section, {
            school_id: schoolId,
            class_id: classes.get(name)!.id,
            academic_year_id: year.id,
            name: letter,
            room: `Block ${classOrder(name) <= 5 ? 'A' : 'B'} · ${Math.max(1, classOrder(name) + 2)}0${letter === 'A' ? 1 : 2}`,
            capacity: 40,
            class_teacher_user_id: teacherIds.get(key) ?? null,
          }),
        ),
      );
    }
  }
  const lastYearSections = new Map<string, Section>();
  for (const key of ['5-A', '6-A']) {
    const [name, letter] = key.split('-');
    lastYearSections.set(
      key,
      await manager.save(
        manager.create(Section, {
          school_id: schoolId,
          class_id: classes.get(name)!.id,
          academic_year_id: lastYear.id,
          name: letter,
          capacity: 40,
        }),
      ),
    );
  }

  const subjects = new Map<string, Subject>();
  for (const [code, name, type] of SUBJECTS) {
    subjects.set(code, await manager.save(manager.create(Subject, { school_id: schoolId, code, name, type })));
  }
  for (const className of ['6', '7', '8']) {
    await manager.insert(
      ClassSubject,
      MIDDLE_SCHOOL_SUBJECTS.map(([code, periods, optional]) => ({
        school_id: schoolId,
        class_id: classes.get(className)!.id,
        subject_id: subjects.get(code)!.id,
        academic_year_id: year.id,
        periods_per_week: periods,
        is_optional: optional,
      })),
    );
  }
  await manager.save(
    HOLIDAYS.map(([date, endDate, name, type]) =>
      manager.create(Holiday, { school_id: schoolId, date, end_date: endDate, name, type }),
    ),
  );

  const parentRole = await manager.findOneByOrFail(Role, { code: ROLES.PARENT });
  const families: DemoFamily[] = [
    ...FAMILIES,
    ...SINGLE_CHILDREN.map(([first, gender, surname, className, section, house], index): DemoFamily => {
      const mobile = `90000002${String(index + 10).padStart(2, '0')}`;
      const father = index % 3 !== 2;
      return {
        parents: [
          {
            name: father ? `${surname}` : `${surname} ${['Priya', 'Revathi', 'Kala', 'Meena'][index % 4]}`,
            mobile,
            relation: father ? 'father' : 'mother',
            occupation: ['Engineer', 'Farmer', 'Doctor', 'Shop owner', 'Accountant', 'Driver'][index % 6],
            qualification: ['B.E.', 'SSLC', 'MBBS', 'HSC', 'B.Com.', 'Diploma'][index % 6],
            language: index % 4 === 1 ? 'ta' : 'en',
          },
        ],
        children: [
          {
            first_name: first,
            last_name: surname,
            gender,
            dob: `${2026 - (classOrder(className) + 6)}-${String((index % 12) + 1).padStart(2, '0')}-${String((index % 27) + 1).padStart(2, '0')}`,
            admitted: index % 5 === 0 ? '2026-11-02' : `${2026 - (index % 4)}-06-0${(index % 5) + 1}`,
            class: className,
            section,
            house,
          },
        ],
      };
    }),
  ];

  let studentCount = 0;
  for (const family of families) {
    const guardians: { guardian: Guardian; parent: DemoParent }[] = [];
    for (const parent of family.parents) {
      const userId = await ensureParentUser(manager, schoolId, parent, parentRole);
      const guardian = await manager.save(
        manager.create(Guardian, {
          school_id: schoolId,
          name: parent.name,
          mobile: parent.mobile,
          occupation: parent.occupation,
          qualification: parent.qualification,
          city: 'Chennai',
          user_id: userId,
        }),
      );
      guardians.push({ guardian, parent });
    }
    for (const child of family.children) {
      const admittedYear = child.admitted.slice(0, 4);
      const number = await sequences.next(manager, schoolId, `admission:${admittedYear}`);
      const student = await manager.save(
        manager.create(Student, {
          school_id: schoolId,
          admission_no: SequencesService.format(school.code, admittedYear, number),
          first_name: child.first_name,
          last_name: child.last_name,
          dob: child.dob,
          gender: child.gender,
          house: child.house,
          admission_date: child.admitted,
          status: 'active',
          city: 'Chennai',
          address_line: `${(studentCount % 40) + 1}, ${['Gandhi Street', 'Nehru Nagar', 'Anna Salai', 'Kamarajar Road'][studentCount % 4]}`,
          pincode: '6000' + String(40 + (studentCount % 9)),
        }),
      );
      studentCount += 1;
      const section = sections.get(`${child.class}-${child.section}`)!;
      await manager.insert(StudentEnrollment, {
        school_id: schoolId,
        student_id: student.id,
        academic_year_id: year.id,
        class_id: section.class_id,
        section_id: section.id,
        status: 'studying',
      });
      if (child.last_year) {
        const previous = lastYearSections.get(child.last_year.join('-'))!;
        await manager.insert(StudentEnrollment, {
          school_id: schoolId,
          student_id: student.id,
          academic_year_id: lastYear.id,
          class_id: previous.class_id,
          section_id: previous.id,
          roll_no: 7,
          status: 'promoted',
        });
      }
      for (const [index, { guardian, parent }] of guardians.entries()) {
        await manager.insert(StudentGuardian, {
          school_id: schoolId,
          student_id: student.id,
          guardian_id: guardian.id,
          relation: parent.relation,
          is_primary: index === 0,
          can_pickup: true,
          receives_alerts: true,
        });
      }
    }
  }

  for (const section of sections.values()) {
    const rows: { id: number }[] = await manager.query(
      `SELECT e.id FROM student_enrollments e JOIN students s ON s.id = e.student_id
       WHERE e.section_id = $1 ORDER BY s.first_name, s.last_name`,
      [section.id],
    );
    for (const [index, row] of rows.entries())
      await manager.update(StudentEnrollment, Number(row.id), { roll_no: index + 1 });
  }

  for (const [first, last, gender, dob, className, mobile, status, note] of APPLICATIONS) {
    const number = await sequences.next(manager, schoolId, 'application:2026');
    await manager.save(
      manager.create(Admission, {
        school_id: schoolId,
        application_no: SequencesService.format('APP', 2026, number),
        academic_year_id: year.id,
        class_id: classes.get(className)!.id,
        first_name: first,
        last_name: last,
        dob,
        gender,
        guardian_name: `${last} ${gender === 'male' ? 'Kumar' : 'Devi'}`,
        guardian_mobile: mobile,
        guardian_relation: 'father',
        status,
        decision_note: note,
        decided_at: status === 'applied' ? null : new Date(),
      }),
    );
  }

  console.log(
    `Academics ${school.code}  2026-27 (current) + 2025-26, ${classNames.length} classes, ${sections.size} sections, ${SUBJECTS.length} subjects, ${HOLIDAYS.length} holidays, ${studentCount} students, ${APPLICATIONS.length} applications: created`,
  );
}
