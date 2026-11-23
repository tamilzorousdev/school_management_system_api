import { EntityManager } from 'typeorm';
import { AlumniRecordsService } from '../../modules/alumni/alumni-records.service';
import { Alumni, OccupationStatus } from '../../modules/alumni/entities/alumni.entity';
import { AlumniSubmission } from '../../modules/alumni/entities/alumni-records.entity';
import { School } from '../../modules/schools/entities/school.entity';
import { SequencesService } from '../../modules/schools/sequences.service';

interface AlumnusSeed {
  first_name: string;
  last_name: string;
  gender: 'male' | 'female';
  batch: number;
  percent: number;
  grade: string;
  mobile: string;
  email: string | null;
  city: string;
  consent: boolean;
  occupation: OccupationStatus;
  institution: string | null;
  course: string | null;
  organization: string | null;
  designation: string | null;
}

const MARKER = 'TZ demo alumnus';

const ALUMNI: AlumnusSeed[] = [
  {
    first_name: 'Harini',
    last_name: 'Subramanian',
    gender: 'female',
    batch: 2025,
    percent: 92.4,
    grade: 'A1',
    mobile: '9840100001',
    email: 'harini.s@example.com',
    city: 'Chennai',
    consent: true,
    occupation: 'higher_studies',
    institution: 'IIT Madras',
    course: 'B.Tech Civil Engineering',
    organization: null,
    designation: null,
  },
  {
    first_name: 'Vignesh',
    last_name: 'Murugan',
    gender: 'male',
    batch: 2025,
    percent: 84.1,
    grade: 'A2',
    mobile: '9840100002',
    email: null,
    city: 'Coimbatore',
    consent: true,
    occupation: 'higher_studies',
    institution: 'PSG College of Technology',
    course: 'B.E. Mechanical',
    organization: null,
    designation: null,
  },
  {
    first_name: 'Nandhini',
    last_name: 'Rajan',
    gender: 'female',
    batch: 2025,
    percent: 78.6,
    grade: 'B1',
    mobile: '9840100003',
    email: 'nandhini.r@example.com',
    city: 'Madurai',
    consent: false,
    occupation: 'higher_studies',
    institution: 'Madurai Medical College',
    course: 'MBBS',
    organization: null,
    designation: null,
  },
  {
    first_name: 'Karthik',
    last_name: 'Selvam',
    gender: 'male',
    batch: 2024,
    percent: 88.9,
    grade: 'A2',
    mobile: '9840100004',
    email: 'karthik.selvam@example.com',
    city: 'Bengaluru',
    consent: true,
    occupation: 'higher_studies',
    institution: 'Christ University',
    course: 'B.Com',
    organization: null,
    designation: null,
  },
  {
    first_name: 'Divya',
    last_name: 'Prakash',
    gender: 'female',
    batch: 2024,
    percent: 95.2,
    grade: 'A1',
    mobile: '9840100005',
    email: 'divya.p@example.com',
    city: 'Chennai',
    consent: true,
    occupation: 'higher_studies',
    institution: 'Loyola College',
    course: 'B.Sc Mathematics',
    organization: null,
    designation: null,
  },
  {
    first_name: 'Arjun',
    last_name: 'Krishnan',
    gender: 'male',
    batch: 2024,
    percent: 69.3,
    grade: 'B2',
    mobile: '9840100006',
    email: null,
    city: 'Tiruchirappalli',
    consent: true,
    occupation: 'employed',
    institution: null,
    course: null,
    organization: 'Ashok Leyland',
    designation: 'Apprentice',
  },
  {
    first_name: 'Meena',
    last_name: 'Sundaram',
    gender: 'female',
    batch: 2023,
    percent: 81.7,
    grade: 'A2',
    mobile: '9840100007',
    email: 'meena.s@example.com',
    city: 'Chennai',
    consent: true,
    occupation: 'employed',
    institution: null,
    course: null,
    organization: 'Tamilzorous',
    designation: 'Support Associate',
  },
  {
    first_name: 'Sanjay',
    last_name: 'Raghavan',
    gender: 'male',
    batch: 2023,
    percent: 74.0,
    grade: 'B1',
    mobile: '9840100008',
    email: 'sanjay.r@example.com',
    city: 'Salem',
    consent: false,
    occupation: 'self_employed',
    institution: null,
    course: null,
    organization: 'Raghavan Textiles',
    designation: 'Partner',
  },
  {
    first_name: 'Priya',
    last_name: 'Natarajan',
    gender: 'female',
    batch: 2023,
    percent: 90.5,
    grade: 'A1',
    mobile: '9840100009',
    email: 'priya.n@example.com',
    city: 'Hyderabad',
    consent: true,
    occupation: 'higher_studies',
    institution: 'University of Hyderabad',
    course: 'M.Sc Physics',
    organization: null,
    designation: null,
  },
  {
    first_name: 'Rahul',
    last_name: 'Venkatesh',
    gender: 'male',
    batch: 2022,
    percent: 66.8,
    grade: 'B2',
    mobile: '9840100010',
    email: null,
    city: 'Chennai',
    consent: true,
    occupation: 'seeking',
    institution: null,
    course: null,
    organization: null,
    designation: null,
  },
];

export async function seedDemoAlumni(manager: EntityManager, school: School): Promise<void> {
  const schoolId = school.id;
  if (await manager.exists(Alumni, { where: { school_id: schoolId, notes: MARKER } })) {
    console.log(`Alumni    ${school.code}  past batches and pending submissions already set up: kept`);
    return;
  }
  const records = new AlumniRecordsService(new SequencesService());
  const actor = { id: null, name: 'Demo seed' };

  for (const person of ALUMNI) {
    await records.create(
      manager,
      schoolId,
      {
        first_name: person.first_name,
        last_name: person.last_name,
        gender: person.gender,
        batch_year: person.batch,
        left_on: `${person.batch}-04-30`,
        exit_type: 'graduated',
        source: 'registered',
        final_class_name: '12',
        final_academic_year_name: `${person.batch - 1}-${String(person.batch).slice(2)}`,
        final_percent: String(person.percent),
        final_grade: person.grade,
        final_result: 'pass',
        mobile: person.mobile,
        email: person.email,
        city: person.city,
        state: 'Tamil Nadu',
        country: 'India',
        contact_consent: person.consent,
        occupation_status: person.occupation,
        institution: person.institution,
        course: person.course,
        organization: person.organization,
        designation: person.designation,
        notes: MARKER,
      },
      [
        {
          academic_year_name: `${person.batch - 2}-${String(person.batch - 1).slice(2)}`,
          class_name: '11',
          section_name: 'A',
          result: 'promoted',
          percent: Math.max(0, Math.round((person.percent - 3.5) * 10) / 10),
        },
        {
          academic_year_name: `${person.batch - 1}-${String(person.batch).slice(2)}`,
          class_name: '12',
          section_name: 'A',
          result: 'completed',
          percent: person.percent,
          grade: person.grade,
        },
      ],
      'created',
      actor,
      'Added by the demo seed',
      'manual',
    );
  }

  const [updatable] = await manager.find(Alumni, {
    where: { school_id: schoolId, mobile: '9840100004' },
    take: 1,
  });
  await manager.save(AlumniSubmission, [
    manager.create(AlumniSubmission, {
      school_id: schoolId,
      type: 'registration',
      alumni_id: null,
      payload: {
        first_name: 'Lakshmi',
        last_name: 'Iyer',
        batch_year: 2019,
        final_class_name: '12',
        mobile: '9840100020',
        email: 'lakshmi.iyer@example.com',
        city: 'Pune',
        contact_consent: true,
        occupation_status: 'employed',
        organization: 'Infosys',
        designation: 'Senior Engineer',
      },
      name: 'Lakshmi Iyer',
      mobile: '9840100020',
    }),
    ...(updatable
      ? [
          manager.create(AlumniSubmission, {
            school_id: schoolId,
            type: 'update',
            alumni_id: updatable.id,
            payload: {
              city: 'Mumbai',
              occupation_status: 'employed',
              organization: 'HDFC Bank',
              designation: 'Analyst',
            },
            name: 'Karthik Selvam',
            mobile: updatable.mobile,
          }),
        ]
      : []),
  ]);
  console.log(`Alumni    ${school.code}  ${ALUMNI.length} alumni across four batches and two pending submissions`);
}
