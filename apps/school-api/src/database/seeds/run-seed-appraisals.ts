import { IsNull } from 'typeorm';
import { School } from '../../modules/schools/entities/school.entity';
import { DEMO_SCHOOL } from './demo.data';
import { seedDemoAppraisals } from './demo-appraisals';
import { runSeed } from './seed-helpers';

if (process.env.NODE_ENV === 'production') {
  console.error('Demo data is for local and test databases only. It is refused when NODE_ENV=production.');
  process.exit(1);
}

runSeed('Demo Appraisals Seed', async (manager) => {
  const school = await manager.findOneBy(School, { code: DEMO_SCHOOL.code, deleted_at: IsNull() });
  if (!school) {
    console.error('Demo school not found');
    return;
  }
  await seedDemoAppraisals(manager, school);
  console.log(`Staff appraisals seeded for school ${school.code} (#${school.id})`);
});
