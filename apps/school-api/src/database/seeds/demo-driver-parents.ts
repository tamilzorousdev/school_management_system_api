import { EntityManager, IsNull } from 'typeorm';
import { ROLES } from '../../modules/access/access.catalog';
import { Role } from '../../modules/access/entities/role.entity';
import { SportsOnDuty } from '../../modules/achievements/entities/sports-on-duty.entity';
import {
  AchievementLevel,
  AchievementResult,
  achievementPoints,
  StudentAchievement,
} from '../../modules/achievements/entities/student-achievement.entity';
import { ExamMark } from '../../modules/exams/entities/exam-mark.entity';
import { School } from '../../modules/schools/entities/school.entity';
import { SequencesService } from '../../modules/schools/sequences.service';
import { AcademicYear } from '../../modules/setup/entities/academic-year.entity';
import { Guardian } from '../../modules/students/entities/guardian.entity';
import { StudentEnrollment } from '../../modules/students/entities/student-enrollment.entity';
import { StudentGuardian } from '../../modules/students/entities/student-guardian.entity';
import { Student } from '../../modules/students/entities/student.entity';
import { UserRole } from '../../modules/users/entities/user-role.entity';
import { User } from '../../modules/users/entities/user.entity';
import { todayIn } from '../../shared/dates';
import { addDays } from '../../shared/school-days';
import { freeNumbers } from './demo-final.plan';

interface ChildSeed {
  first_name: string;
  last_name: string;
  gender: 'male' | 'female';
  dob: string;
  grade: number;
  ability: number;
  award: { title: string; level: AchievementLevel; result: AchievementResult; position: string | null; prize: string };
  od: { sport: string; title: string; from: number; to: number; venue: string };
}

interface DriverParentSeed {
  mobile: string;
  occupation: string;
  address: string;
  children: ChildSeed[];
}

const DRIVER_PARENTS: DriverParentSeed[] = [
  {
    mobile: '9000000007',
    occupation: 'School bus driver',
    address: '9, Nehru Nagar',
    children: [
      {
        first_name: 'Karthik',
        last_name: 'Ganesan',
        gender: 'male',
        dob: '2017-04-12',
        grade: 3,
        ability: 78,
        award: {
          title: 'Inter-house kabaddi',
          level: 'school',
          result: 'winner',
          position: '1st',
          prize: 'Gold medal',
        },
        od: {
          sport: 'Kabaddi',
          title: 'Zonal kabaddi trials',
          from: 0,
          to: 1,
          venue: 'Corporation ground, Anna Nagar',
        },
      },
      {
        first_name: 'Divya',
        last_name: 'Ganesan',
        gender: 'female',
        dob: '2014-08-23',
        grade: 6,
        ability: 86,
        award: {
          title: 'District athletics – 200 m',
          level: 'district',
          result: 'runner_up',
          position: '2nd',
          prize: 'Silver medal',
        },
        od: { sport: 'Athletics', title: 'District athletics meet', from: -1, to: 0, venue: 'Nehru Stadium, Chennai' },
      },
      {
        first_name: 'Arjun',
        last_name: 'Ganesan',
        gender: 'male',
        dob: '2012-03-30',
        grade: 8,
        ability: 64,
        award: {
          title: 'Zonal football tournament',
          level: 'zone',
          result: 'participated',
          position: null,
          prize: 'Participation certificate',
        },
        od: { sport: 'Football', title: 'Zonal football league', from: 3, to: 4, venue: 'Jawaharlal Nehru Stadium' },
      },
    ],
  },
  {
    mobile: '9000000701',
    occupation: 'School bus driver',
    address: '26, Kamarajar Road',
    children: [
      {
        first_name: 'Meena',
        last_name: 'Muthu',
        gender: 'female',
        dob: '2019-11-05',
        grade: 1,
        ability: 81,
        award: {
          title: 'School chess championship',
          level: 'school',
          result: 'winner',
          position: '1st',
          prize: 'Trophy',
        },
        od: { sport: 'Chess', title: 'Inter-school chess open', from: 0, to: 0, venue: 'District Sports Office hall' },
      },
      {
        first_name: 'Surya',
        last_name: 'Muthu',
        gender: 'male',
        dob: '2013-06-17',
        grade: 7,
        ability: 58,
        award: {
          title: 'Inter-school cricket',
          level: 'zone',
          result: 'third_place',
          position: '3rd',
          prize: 'Bronze medal',
        },
        od: { sport: 'Cricket', title: 'Under-14 cricket camp', from: 2, to: 4, venue: 'MAC Stadium practice nets' },
      },
    ],
  },
];

const spread = (seed: number) => Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1;

export async function seedDriverParents(manager: EntityManager, school: School): Promise<void> {
  const year = await manager.findOneBy(AcademicYear, { school_id: school.id, is_current: true });
  if (!year) return;
  const parentRole = await manager.findOneByOrFail(Role, { code: ROLES.PARENT });
  const today = todayIn(process.env.APP_TIMEZONE ?? 'Asia/Kolkata');
  const sequences = new SequencesService();
  let children = 0;
  let parents = 0;
  for (const plan of DRIVER_PARENTS) {
    const user = await manager.findOneBy(User, { school_id: school.id, mobile: plan.mobile });
    if (!user) continue;
    await manager
      .createQueryBuilder()
      .insert()
      .into(UserRole)
      .values({ user_id: user.id, role_id: parentRole.id })
      .orIgnore()
      .execute();
    let guardian = await manager.findOneBy(Guardian, {
      school_id: school.id,
      mobile: plan.mobile,
      deleted_at: IsNull(),
    });
    if (!guardian) {
      guardian = await manager.save(
        manager.create(Guardian, {
          school_id: school.id,
          name: user.name,
          mobile: plan.mobile,
          email: user.email,
          occupation: plan.occupation,
          address_line: plan.address,
          city: 'Chennai',
          user_id: user.id,
        }),
      );
      parents += 1;
    }
    for (const child of plan.children) {
      const exists = await manager.findOneBy(Student, {
        school_id: school.id,
        first_name: child.first_name,
        last_name: child.last_name,
        deleted_at: IsNull(),
      });
      if (exists) continue;
      const section: { id: number; class_id: number } | undefined = (
        await manager.query(
          `SELECT sec.id, sec.class_id FROM sections sec JOIN classes c ON c.id = sec.class_id
           WHERE sec.school_id = $1 AND sec.academic_year_id = $2 AND sec.deleted_at IS NULL AND c.grade_level = $3
             AND (SELECT COUNT(*) FROM student_enrollments e WHERE e.section_id = sec.id) < sec.capacity
           ORDER BY sec.name LIMIT 1`,
          [school.id, year.id, child.grade],
        )
      )[0];
      if (!section) continue;
      const admittedYear = year.start_date.slice(0, 4);
      const student = await manager.save(
        manager.create(Student, {
          school_id: school.id,
          admission_no: await admissionNo(manager, school, admittedYear, sequences),
          first_name: child.first_name,
          last_name: child.last_name,
          dob: child.dob,
          gender: child.gender,
          admission_date: `${admittedYear}-06-03`,
          status: 'active',
          city: 'Chennai',
          address_line: plan.address,
          pincode: '600040',
        }),
      );
      const rolls: { roll_no: number | null }[] = await manager.query(
        `SELECT roll_no FROM student_enrollments WHERE section_id = $1`,
        [section.id],
      );
      await manager.insert(StudentEnrollment, {
        school_id: school.id,
        student_id: student.id,
        academic_year_id: year.id,
        class_id: section.class_id,
        section_id: section.id,
        roll_no: freeNumbers(
          rolls.map((row) => (row.roll_no === null ? null : Number(row.roll_no))),
          1,
        )[0]!,
        status: 'studying',
      });
      await manager.insert(StudentGuardian, {
        school_id: school.id,
        student_id: student.id,
        guardian_id: guardian.id,
        relation: 'father',
        is_primary: true,
        can_pickup: true,
        receives_alerts: true,
      });
      await addMarks(manager, school.id, year.id, section.class_id, student.id, child.ability);
      await manager.save(
        manager.create(StudentAchievement, {
          school_id: school.id,
          student_id: student.id,
          title: child.award.title,
          category: 'sports',
          level: child.award.level,
          position: child.award.position,
          result: child.award.result,
          event_scope: child.award.level === 'school' ? 'sports_day' : 'inter_school',
          venue_type: 'outdoor',
          participation: 'individual',
          team_name: null,
          prize_received: child.award.prize,
          school_reward: null,
          points: achievementPoints(child.award.level, child.award.result),
          achieved_on: addDays(today, -20),
          description: `${child.first_name} represented the school in ${child.award.title.toLowerCase()}.`,
          visible_to_parent: true,
          created_by: null,
        }),
      );
      await manager.save(
        manager.create(SportsOnDuty, {
          school_id: school.id,
          student_id: student.id,
          sport_name: child.od.sport,
          title: child.od.title,
          from_date: addDays(today, child.od.from),
          to_date: addDays(today, child.od.to),
          session: null,
          venue: child.od.venue,
          notes: 'Accompanied by the PE teacher.',
          created_by: null,
        }),
      );
      children += 1;
    }
  }
  console.log(
    `Driver parents ${school.code}  ${children ? `${children} children for ${DRIVER_PARENTS.length} drivers (marks, sports awards, OD)` : 'already set up: kept'}${parents ? `, ${parents} parent profiles` : ''}`,
  );
}

async function addMarks(
  manager: EntityManager,
  schoolId: number,
  yearId: number,
  classId: number,
  studentId: number,
  ability: number,
): Promise<void> {
  const papers: { exam_id: number; subject_id: number; max_marks: number }[] = await manager.query(
    `SELECT es.exam_id, es.subject_id, es.max_marks FROM exam_subjects es
     JOIN exams x ON x.id = es.exam_id AND x.status = 'published' AND x.academic_year_id = $2
     WHERE es.class_id = $1 ORDER BY es.exam_id, es.id`,
    [classId, yearId],
  );
  if (!papers.length) return;
  await manager.insert(
    ExamMark,
    papers.map((paper, index) => {
      const percent = Math.max(30, Math.min(98, ability + Math.round((spread(studentId * 7 + index) - 0.5) * 16)));
      return {
        school_id: schoolId,
        exam_id: Number(paper.exam_id),
        student_id: studentId,
        subject_id: Number(paper.subject_id),
        marks: Math.round((percent / 100) * Number(paper.max_marks)),
        is_absent: false,
        entered_by: null,
      };
    }),
  );
}

async function admissionNo(
  manager: EntityManager,
  school: School,
  admittedYear: string,
  sequences: SequencesService,
): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const value = await sequences.next(manager, school.id, `admission:${admittedYear}`);
    const candidate = SequencesService.format(school.code, admittedYear, value);
    if (!(await manager.exists(Student, { where: { school_id: school.id, admission_no: candidate } })))
      return candidate;
  }
  throw new Error('Could not generate an admission number');
}
