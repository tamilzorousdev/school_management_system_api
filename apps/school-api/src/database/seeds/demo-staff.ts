import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import PDFDocument from 'pdfkit';
import { EntityManager, In, IsNull } from 'typeorm';
import { FileRecord } from '../../modules/files/entities/file-record.entity';
import { StaffDocument, StaffDocumentType } from '../../modules/staff/entities/staff-document.entity';
import { renderPdf } from '../../modules/student-lifecycle/pdf/pdf-kit';
import { VerificationStatus } from '../../shared/verification';
import { ROLES } from '../../modules/access/access.catalog';
import { Role } from '../../modules/access/entities/role.entity';
import { School } from '../../modules/schools/entities/school.entity';
import { FieldCipher, lastDigits } from '../../modules/security/field-cipher';
import { AcademicYear } from '../../modules/setup/entities/academic-year.entity';
import { SchoolClass } from '../../modules/setup/entities/school-class.entity';
import { Section } from '../../modules/setup/entities/section.entity';
import { Subject } from '../../modules/setup/entities/subject.entity';
import { StaffQualification } from '../../modules/staff/entities/staff-qualification.entity';
import { Staff, StaffType } from '../../modules/staff/entities/staff.entity';
import { TeacherAssignment } from '../../modules/staff/entities/teacher-assignment.entity';
import { BehaviourNote, BehaviourCategory } from '../../modules/student-records/entities/behaviour-note.entity';
import { StudentHealth } from '../../modules/student-records/entities/student-health.entity';
import { Vaccination } from '../../modules/student-records/entities/vaccination.entity';
import { Student } from '../../modules/students/entities/student.entity';
import { UserRole } from '../../modules/users/entities/user-role.entity';
import { User } from '../../modules/users/entities/user.entity';

interface DemoStaff {
  mobile: string;
  name?: string;
  roles?: string[];
  type: StaffType;
  designation: string;
  department: string | null;
  gender: 'male' | 'female';
  joined: string;
  prior: number;
  degrees: [string, string | null, number][];
  bank?: [string, string, string];
}

const STAFF: DemoStaff[] = [
  {
    mobile: '9000000001',
    type: 'teaching',
    designation: 'Principal',
    department: 'Administration',
    gender: 'female',
    joined: '2012-06-04',
    prior: 8,
    degrees: [
      ['M.Sc.', 'Mathematics', 1998],
      ['M.Ed.', null, 2001],
    ],
    bank: ['Indian Bank', 'IDIB000A045', '6012345671'],
  },
  {
    mobile: '9000000002',
    type: 'non_teaching',
    designation: 'Administrative Officer',
    department: 'Office',
    gender: 'male',
    joined: '2016-04-11',
    prior: 3,
    degrees: [['M.B.A.', 'Administration', 2010]],
    bank: ['State Bank of India', 'SBIN0001234', '30123456782'],
  },
  {
    mobile: '9000000003',
    type: 'non_teaching',
    designation: 'Transport In-charge',
    department: 'Transport',
    gender: 'male',
    joined: '2018-06-01',
    prior: 5,
    degrees: [['Diploma', 'Automobile Engineering', 2008]],
  },
  {
    mobile: '9000000004',
    type: 'teaching',
    designation: 'PG Assistant',
    department: 'Mathematics',
    gender: 'female',
    joined: '2015-06-01',
    prior: 2,
    degrees: [
      ['M.Sc.', 'Mathematics', 2011],
      ['B.Ed.', null, 2012],
    ],
    bank: ['Indian Overseas Bank', 'IOBA0000321', '032101000012345'],
  },
  {
    mobile: '9000000006',
    type: 'teaching',
    designation: 'BT Assistant',
    department: 'Science',
    gender: 'male',
    joined: '2019-06-03',
    prior: 1,
    degrees: [
      ['M.Sc.', 'Physics', 2016],
      ['B.Ed.', null, 2017],
    ],
    bank: ['Canara Bank', 'CNRB0001023', '1023101005678'],
  },
  {
    mobile: '9000000007',
    type: 'non_teaching',
    designation: 'Bus Driver',
    department: 'Transport',
    gender: 'male',
    joined: '2020-01-06',
    prior: 10,
    degrees: [['HSC', null, 2004]],
    bank: ['Indian Bank', 'IDIB000A045', '6012345699'],
  },
  {
    mobile: '9000000008',
    type: 'non_teaching',
    designation: 'Bus Attendant',
    department: 'Transport',
    gender: 'female',
    joined: '2021-06-07',
    prior: 0,
    degrees: [['SSLC', null, 2009]],
  },
  {
    mobile: '9000000401',
    name: 'Kalaiselvi Rajan',
    roles: [ROLES.TEACHER],
    type: 'teaching',
    designation: 'BT Assistant',
    department: 'Tamil',
    gender: 'female',
    joined: '2017-06-05',
    prior: 4,
    degrees: [
      ['M.A.', 'Tamil', 2012],
      ['B.Ed.', null, 2013],
    ],
    bank: ['Indian Bank', 'IDIB000A045', '6012345702'],
  },
  {
    mobile: '9000000402',
    name: 'Joseph Antony',
    roles: [ROLES.TEACHER],
    type: 'teaching',
    designation: 'PG Assistant',
    department: 'English',
    gender: 'male',
    joined: '2014-06-02',
    prior: 6,
    degrees: [
      ['M.A.', 'English Literature', 2007],
      ['B.Ed.', null, 2008],
    ],
    bank: ['HDFC Bank', 'HDFC0000123', '50100234567890'],
  },
  {
    mobile: '9000000403',
    name: 'Fathima Begum',
    roles: [ROLES.TEACHER],
    type: 'teaching',
    designation: 'BT Assistant',
    department: 'Social Science',
    gender: 'female',
    joined: '2021-06-07',
    prior: 2,
    degrees: [
      ['M.A.', 'History', 2017],
      ['B.Ed.', null, 2018],
    ],
  },
  {
    mobile: '9000000404',
    name: 'Senthil Kumar',
    roles: [ROLES.TEACHER],
    type: 'teaching',
    designation: 'Physical Education Teacher',
    department: 'Sports',
    gender: 'male',
    joined: '2018-06-04',
    prior: 3,
    degrees: [['M.P.Ed.', 'Physical Education', 2014]],
    bank: ['Karur Vysya Bank', 'KVBL0001101', '1101155000012345'],
  },
  {
    mobile: '9000000405',
    name: 'Divya Bharathi',
    roles: [ROLES.TEACHER],
    type: 'teaching',
    designation: 'Computer Instructor',
    department: 'Computer Science',
    gender: 'female',
    joined: '2023-06-05',
    prior: 1,
    degrees: [['M.C.A.', 'Computer Applications', 2021]],
    bank: ['ICICI Bank', 'ICIC0001234', '123401567890'],
  },
  {
    mobile: '9000000406',
    name: 'Ramesh Sharma',
    roles: [ROLES.TEACHER],
    type: 'teaching',
    designation: 'BT Assistant',
    department: 'Hindi',
    gender: 'male',
    joined: '2022-06-06',
    prior: 5,
    degrees: [
      ['M.A.', 'Hindi', 2014],
      ['B.Ed.', null, 2015],
    ],
    bank: ['Bank of Baroda', 'BARB0CHENNA', '29870100012345'],
  },
];

const ASSIGNMENTS: Record<string, Record<string, string>> = {
  '6-A': {
    MATH: '9000000004',
    SCI: '9000000006',
    ENG: '9000000402',
    TAM: '9000000401',
    SOC: '9000000403',
    CS: '9000000405',
    PE: '9000000404',
    HIN: '9000000406',
  },
  '6-B': {
    MATH: '9000000004',
    SCI: '9000000006',
    ENG: '9000000402',
    TAM: '9000000401',
    SOC: '9000000403',
    PE: '9000000404',
  },
  '7-A': {
    MATH: '9000000004',
    SCI: '9000000006',
    ENG: '9000000402',
    TAM: '9000000401',
    SOC: '9000000403',
    CS: '9000000405',
    PE: '9000000404',
  },
  '7-B': { MATH: '9000000001', SCI: '9000000006', ENG: '9000000402', TAM: '9000000401', PE: '9000000404' },
  '8-A': {
    MATH: '9000000004',
    ENG: '9000000402',
    TAM: '9000000401',
    CS: '9000000405',
    PE: '9000000404',
    HIN: '9000000406',
  },
  '8-B': { ENG: '9000000402', TAM: '9000000401', PE: '9000000404' },
};

const DOCUMENTS: Record<string, [StaffDocumentType, VerificationStatus, string | null][]> = {
  '9000000001': [
    ['id_proof', 'verified', null],
    ['degree_certificate', 'verified', null],
    ['experience_letter', 'verified', null],
  ],
  '9000000002': [
    ['id_proof', 'verified', null],
    ['degree_certificate', 'verified', null],
  ],
  '9000000003': [
    ['id_proof', 'verified', null],
    ['police_verification', 'verified', null],
  ],
  '9000000004': [
    ['id_proof', 'verified', null],
    ['degree_certificate', 'verified', null],
    ['experience_letter', 'verified', null],
  ],
  '9000000006': [
    ['id_proof', 'verified', null],
    ['degree_certificate', 'verified', null],
  ],
  '9000000007': [
    ['id_proof', 'verified', null],
    ['police_verification', 'verified', null],
    ['medical_fitness', 'verified', null],
    ['driving_licence', 'verified', null],
    ['psv_badge', 'verified', null],
  ],
  '9000000008': [
    ['id_proof', 'verified', null],
    ['police_verification', 'verified', null],
    ['medical_fitness', 'verified', null],
  ],
  '9000000401': [
    ['id_proof', 'verified', null],
    ['degree_certificate', 'verified', null],
  ],
  '9000000402': [
    ['id_proof', 'verified', null],
    ['degree_certificate', 'verified', null],
  ],
  '9000000403': [
    ['id_proof', 'verified', null],
    ['experience_letter', 'pending', null],
  ],
  '9000000404': [
    ['id_proof', 'verified', null],
    ['degree_certificate', 'verified', null],
  ],
  '9000000405': [
    ['id_proof', 'verified', null],
    ['police_verification', 'pending', null],
  ],
  '9000000406': [
    ['id_proof', 'rejected', 'The copy is not readable. Upload a clear scan.'],
    ['degree_certificate', 'verified', null],
  ],
};

const DOCUMENT_NAMES: Record<StaffDocumentType, string> = {
  id_proof: 'Aadhaar card',
  address_proof: 'Address proof',
  degree_certificate: 'Degree certificate',
  experience_letter: 'Experience letter',
  police_verification: 'Police verification',
  medical_fitness: 'Medical fitness certificate',
  driving_licence: 'Driving licence',
  psv_badge: 'PSV badge',
  photo: 'Photo',
  other: 'Document',
};

async function sampleFile(manager: EntityManager, schoolId: number, title: string, owner: string): Promise<number> {
  const doc = new PDFDocument({ size: 'A5', margin: 40 });
  doc.fontSize(18).text(title).moveDown().fontSize(11).fillColor('#555555').text(`Sample document for ${owner}`);
  doc.text('Created by the demo seed for local testing.');
  const content = await renderPdf(doc);
  const key = `seed/${randomUUID()}.pdf`;
  const path = join(resolve(process.env.STORAGE_LOCAL_DIR ?? 'uploads'), key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  const record = await manager.save(
    manager.create(FileRecord, {
      school_id: schoolId,
      storage_key: key,
      original_name: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`,
      mime_type: 'application/pdf',
      size_bytes: content.length,
      purpose: 'staff_document',
      scan_status: 'not_scanned',
    }),
  );
  return record.id;
}

const PERIODS: Record<string, number> = { ENG: 6, TAM: 5, MATH: 7, SCI: 6, SOC: 5, CS: 2, PE: 2, HIN: 3 };

const NOTES: [string, BehaviourCategory, string, string | null, boolean][] = [
  ['Kavin', 'appreciation', 'Won the inter-school maths quiz', 'Represented the school at the zonal round.', true],
  ['Kavin', 'concern', 'Homework not submitted three days in a row', 'Spoke to the parent on the phone.', true],
  ['Nila', 'appreciation', 'Helped organise the science exhibition', null, true],
  ['Gowtham', 'incident', 'Pushed a classmate during lunch', 'Counselled. Parent informed.', false],
];

const HEALTH: [string, number, number, string | null, string | null][] = [
  ['Kavin', 138.5, 31.2, 'Peanuts', null],
  ['Nila', 129.0, 26.4, null, 'Mild asthma'],
  ['Aadhavan', 142.0, 35.8, 'Dust', null],
];

export async function seedDemoStaff(manager: EntityManager, school: School): Promise<void> {
  const schoolId = school.id;
  if (await manager.exists(Staff, { where: { school_id: schoolId } })) {
    console.log(`Staff     ${school.code}  staff already set up: kept`);
    return;
  }
  const key = process.env.DATA_ENCRYPTION_KEY;
  if (!key) throw new Error('DATA_ENCRYPTION_KEY is missing in .env');
  const cipher = new FieldCipher(key);
  const year = await manager.findOneByOrFail(AcademicYear, { school_id: schoolId, is_current: true });

  if (!(await manager.exists(AcademicYear, { where: { school_id: schoolId, name: '2027-28' } }))) {
    const next = await manager.save(
      manager.create(AcademicYear, {
        school_id: schoolId,
        name: '2027-28',
        start_date: '2027-06-01',
        end_date: '2028-04-30',
        is_current: false,
      }),
    );
    const seven = await manager.findOneByOrFail(SchoolClass, { school_id: schoolId, name: '7' });
    await manager.save(
      ['A', 'B'].map((name) =>
        manager.create(Section, {
          school_id: schoolId,
          class_id: seven.id,
          academic_year_id: next.id,
          name,
          capacity: 40,
        }),
      ),
    );
  }

  const teacherRole = await manager.findOneByOrFail(Role, { code: ROLES.TEACHER });
  const userIds = new Map<string, number>();
  for (const [index, item] of STAFF.entries()) {
    let user = await manager.findOneBy(User, { mobile: item.mobile, deleted_at: IsNull() });
    if (!user) {
      user = await manager.save(
        manager.create(User, {
          school_id: schoolId,
          name: item.name!,
          mobile: item.mobile,
          status: 'active',
          language: 'en',
        }),
      );
      await manager
        .createQueryBuilder()
        .insert()
        .into(UserRole)
        .values({ user_id: user.id, role_id: teacherRole.id })
        .orIgnore()
        .execute();
    }
    userIds.set(item.mobile, user.id);
    const staff = await manager.save(
      manager.create(Staff, {
        school_id: schoolId,
        user_id: user.id,
        employee_no: `${school.code}-EMP-${String(index + 1).padStart(4, '0')}`,
        staff_type: item.type,
        designation: item.designation,
        department: item.department,
        gender: item.gender,
        dob: `${1975 + (index % 18)}-${String((index % 12) + 1).padStart(2, '0')}-${String((index % 27) + 1).padStart(2, '0')}`,
        joining_date: item.joined,
        prior_experience_years: item.prior,
        max_periods_per_week: item.type === 'teaching' ? (item.designation === 'Principal' ? 8 : 30) : 0,
        address: `${index + 4}, ${['Gandhi Street', 'Nehru Nagar', 'Anna Salai', 'Kamarajar Road'][index % 4]}, Chennai`,
        emergency_contact_name: 'Family contact',
        emergency_contact_mobile: `98400${String(10000 + index * 37).slice(0, 5)}`,
        status: 'active',
        ...(item.bank
          ? {
              bank_account_holder: user.name,
              bank_name: item.bank[0],
              bank_ifsc: item.bank[1],
              bank_account_enc: cipher.encrypt(item.bank[2]),
              bank_account_last4: lastDigits(item.bank[2]),
            }
          : {}),
      }),
    );
    await manager.insert(
      StaffQualification,
      item.degrees.map(([degree, specialization, completed]) => ({
        staff_id: staff.id,
        degree,
        specialization,
        institution: ['Madras University', 'Anna University', 'Annamalai University', 'Bharathiar University'][
          index % 4
        ],
        year_completed: completed,
      })),
    );
    for (const [type, status, remarks] of DOCUMENTS[item.mobile] ?? []) {
      await manager.insert(StaffDocument, {
        school_id: schoolId,
        staff_id: staff.id,
        type,
        title: DOCUMENT_NAMES[type],
        file_id: await sampleFile(manager, schoolId, DOCUMENT_NAMES[type], user.name),
        status,
        remarks,
        verified_at: status === 'pending' ? null : new Date(),
      });
    }
  }
  await manager.update(
    Staff,
    { school_id: schoolId, user_id: userIds.get('9000000404') },
    { max_periods_per_week: 14 },
  );

  const sections = await manager.find(Section, {
    where: { school_id: schoolId, academic_year_id: year.id },
    relations: { school_class: true },
  });
  const subjects = await manager.findBy(Subject, { school_id: schoolId, code: In(Object.keys(PERIODS)) });
  let assigned = 0;
  for (const [key, plan] of Object.entries(ASSIGNMENTS)) {
    const section = sections.find((item) => `${item.school_class?.name}-${item.name}` === key);
    if (!section) continue;
    for (const [code, mobile] of Object.entries(plan)) {
      const subject = subjects.find((item) => item.code === code);
      const teacher = userIds.get(mobile);
      if (!subject || !teacher) continue;
      await manager.insert(TeacherAssignment, {
        school_id: schoolId,
        academic_year_id: year.id,
        section_id: section.id,
        subject_id: subject.id,
        teacher_user_id: teacher,
        periods_per_week: PERIODS[code],
      });
      assigned += 1;
    }
  }
  const classTeachers: Record<string, string> = { '7-B': '9000000402', '8-A': '9000000401', '8-B': '9000000403' };
  for (const [key, mobile] of Object.entries(classTeachers)) {
    const section = sections.find((item) => `${item.school_class?.name}-${item.name}` === key);
    if (section) await manager.update(Section, section.id, { class_teacher_user_id: userIds.get(mobile) });
  }

  const students = await manager.findBy(Student, { school_id: schoolId });
  const byName = (name: string) => students.find((student) => student.first_name === name);
  for (const [name, height, weight, allergies, conditions] of HEALTH) {
    const student = byName(name);
    if (!student) continue;
    await manager.insert(StudentHealth, {
      school_id: schoolId,
      student_id: student.id,
      height_cm: String(height),
      weight_kg: String(weight),
      allergies,
      conditions,
      vision: '6/6',
      last_checkup_on: '2026-07-15',
    });
    await manager.insert(Vaccination, [
      { school_id: schoolId, student_id: student.id, vaccine: 'MMR', dose: 'Dose 2', given_on: '2020-04-10' },
      {
        school_id: schoolId,
        student_id: student.id,
        vaccine: 'Tdap',
        dose: 'Booster',
        given_on: null,
        due_on: '2026-10-01',
      },
    ]);
  }
  const author = userIds.get('9000000004');
  for (const [name, category, title, details, visible] of NOTES) {
    const student = byName(name);
    if (!student) continue;
    await manager.insert(BehaviourNote, {
      school_id: schoolId,
      student_id: student.id,
      noted_on: '2026-10-2' + String(NOTES.findIndex((note) => note[2] === title) + 1),
      category,
      title,
      details,
      visible_to_parent: visible,
      created_by: author ?? null,
    });
  }

  console.log(
    `Staff     ${school.code}  ${STAFF.length} staff, ${assigned} teacher assignments, 2027-28 for promotion, health and behaviour samples: created`,
  );
}
