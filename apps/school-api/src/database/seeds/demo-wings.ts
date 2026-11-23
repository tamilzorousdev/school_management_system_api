import { EntityManager, IsNull } from 'typeorm';
import { SchoolWing, UserWing } from '../../modules/office/entities/office.entity';
import { Staff } from '../../modules/staff/entities/staff.entity';
import { School } from '../../modules/schools/entities/school.entity';
import { User } from '../../modules/users/entities/user.entity';

const WINGS = [
  { name: 'Pre-primary', from_grade: -1, to_grade: 0, sort_order: 1 },
  { name: 'Primary', from_grade: 1, to_grade: 5, sort_order: 2 },
  { name: 'Secondary', from_grade: 6, to_grade: 10, sort_order: 3 },
  { name: 'Higher Secondary', from_grade: 11, to_grade: 12, sort_order: 4 },
];

const AO_WINGS: Record<string, string[]> = {
  '9000000013': ['Pre-primary', 'Primary'],
  '9000000014': ['Secondary', 'Higher Secondary'],
  '9000000021': ['Primary', 'Secondary', 'Higher Secondary'],
  '9000000022': ['Primary', 'Secondary'],
  '9000000023': ['Higher Secondary'],
  '9000000024': ['Secondary'],
};

export async function seedDemoWings(manager: EntityManager, school: School): Promise<void> {
  const existing = await manager.find(SchoolWing, { where: { school_id: school.id, deleted_at: IsNull() } });
  const wings = existing.length
    ? existing
    : await manager.save(
        WINGS.map((wing) =>
          manager.create(SchoolWing, { ...wing, school_id: school.id, class_ids: null, board: null }),
        ),
      );
  for (const [mobile, names] of Object.entries(AO_WINGS)) {
    const user = await manager.findOneBy(User, { mobile, school_id: school.id, deleted_at: IsNull() });
    if (!user) continue;
    if (!(await manager.exists(Staff, { where: { user_id: user.id } }))) {
      await manager.save(
        manager.create(Staff, {
          school_id: school.id,
          user_id: user.id,
          employee_no: `TZMS-AO-${mobile.slice(-2)}`,
          staff_type: 'non_teaching',
          designation: 'Administrative Officer',
          department: 'Office',
          joining_date: '2026-06-01',
        }),
      );
    }
    const linked = await manager.count(UserWing, { where: { user_id: user.id, deleted_at: IsNull() } });
    if (linked) continue;
    for (const wing of wings.filter((row) => names.includes(row.name))) {
      await manager.save(manager.create(UserWing, { school_id: school.id, user_id: user.id, wing_id: wing.id }));
    }
  }
  console.log(`Wings     ${wings.map((wing) => wing.name).join(', ')}: ${existing.length ? 'kept' : 'created'}`);
}
