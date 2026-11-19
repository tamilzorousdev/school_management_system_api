import { IsNull } from 'typeorm';
import { School } from '../../modules/schools/entities/school.entity';
import { DEMO_SCHOOL } from './demo.data';
import { seedDemoDiary } from './demo-diary';
import { runSeed } from './seed-helpers';

if (process.env.NODE_ENV === 'production') {
  console.error('Demo data is for local and test databases only. It is refused when NODE_ENV=production.');
  process.exit(1);
}

runSeed('Diary & Homework Demo Seed', async (manager) => {
  const school = await manager.findOneBy(School, { code: DEMO_SCHOOL.code, deleted_at: IsNull() });
  if (!school) {
    console.error(`School ${DEMO_SCHOOL.code} not found. Please run "npm run seed:demo" first.`);
    return;
  }

  await seedDemoDiary(manager, school);
});
