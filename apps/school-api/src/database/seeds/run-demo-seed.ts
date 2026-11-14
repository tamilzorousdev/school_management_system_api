import { IsNull } from 'typeorm';
import { School } from '../../modules/schools/entities/school.entity';
import { DEMO_PLATFORM_USERS, DEMO_SCHOOL, DEMO_SCHOOL_USERS } from './demo.data';
import { seedDemoAcademics } from './demo-academics';
import { seedDemoAchievements } from './demo-achievements';
import { seedDemoDay4 } from './demo-day4';
import { seedDemoDay5 } from './demo-day5';
import { seedDemoExams } from './demo-exams';
import { seedDemoFeedback } from './demo-feedback';
import { seedDemoFees } from './demo-fees';
import { seedDemoFinal } from './demo-final';
import { seedDemoSpecialClasses } from './demo-special-classes';
import { seedDemoSportsOnDuty } from './demo-sports-on-duty';
import { seedDemoStaff } from './demo-staff';
import { seedDemoTimetable } from './demo-timetable';
import { runSeed, seedCatalog, upsertUser } from './seed-helpers';

if (process.env.NODE_ENV === 'production') {
  console.error('Demo data is for local and test databases only. It is refused when NODE_ENV=production.');
  process.exit(1);
}

runSeed('Demo seed', async (manager) => {
  const roles = await seedCatalog(manager);

  for (const seed of DEMO_PLATFORM_USERS) {
    const result = await upsertUser(manager, roles, null, seed);
    console.log(`Platform  ${seed.mobile}  ${seed.name.padEnd(24)} ${seed.roles.join('+')}: ${result}`);
  }

  const existing = await manager.findOneBy(School, { code: DEMO_SCHOOL.code, deleted_at: IsNull() });
  const school = existing ?? (await manager.save(manager.create(School, DEMO_SCHOOL)));
  console.log(`School    ${school.code}  ${school.name} (#${school.id}): ${existing ? 'kept' : 'created'}`);

  for (const seed of DEMO_SCHOOL_USERS) {
    const result = await upsertUser(manager, roles, school.id, seed);
    console.log(`${school.code}      ${seed.mobile}  ${seed.name.padEnd(24)} ${seed.roles.join('+')}: ${result}`);
  }

  await seedDemoAcademics(manager, school);
  await seedDemoStaff(manager, school);
  await seedDemoDay4(manager, school);
  await seedDemoDay5(manager, school);
  await seedDemoFinal(manager, school);
  await seedDemoExams(manager, school);
  await seedDemoFees(manager, school);
  await seedDemoAchievements(manager, school);
  await seedDemoSportsOnDuty(manager, school);
  await seedDemoTimetable(manager, school);
  await seedDemoSpecialClasses(manager, school);
  await seedDemoFeedback(manager, school);
});
