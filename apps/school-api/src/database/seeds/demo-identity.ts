import { EntityManager, IsNull } from 'typeorm';
import { School } from '../../modules/schools/entities/school.entity';
import { FieldCipher } from '../../modules/security/field-cipher';
import { Staff } from '../../modules/staff/entities/staff.entity';
import { Student } from '../../modules/students/entities/student.entity';
import { Community, Religion } from '../../shared/identity';

type Profile = { community: Community; caste: string | null; religion: Religion };

const PROFILES: Profile[] = [
  { community: 'bc', caste: 'Nadar', religion: 'hindu' },
  { community: 'mbc', caste: 'Vanniyar', religion: 'hindu' },
  { community: 'bc', caste: 'Kongu Vellalar', religion: 'hindu' },
  { community: 'sc', caste: 'Adi Dravidar', religion: 'hindu' },
  { community: 'bc', caste: 'Nadar', religion: 'christian' },
  { community: 'mbc', caste: 'Ambalakarar', religion: 'hindu' },
  { community: 'bc', caste: 'Chettiar', religion: 'hindu' },
  { community: 'sca', caste: 'Arunthathiyar', religion: 'hindu' },
  { community: 'bcm', caste: 'Labbai', religion: 'muslim' },
  { community: 'sc', caste: 'Devendrakula Velalar', religion: 'hindu' },
  { community: 'bc', caste: 'Yadava', religion: 'hindu' },
  { community: 'dnc', caste: 'Piramalai Kallar', religion: 'hindu' },
  { community: 'oc', caste: null, religion: 'hindu' },
  { community: 'mbc', caste: 'Vanniyar', religion: 'hindu' },
  { community: 'st', caste: 'Irular', religion: 'hindu' },
  { community: 'bc', caste: 'Viswakarma', religion: 'hindu' },
];

const NOT_RECORDED_EVERY = 9;

function demoAadhaar(seed: number): string {
  return `9${String(seed * 7919 + 1000000001)
    .padStart(11, '0')
    .slice(-11)}`;
}

function identityFor(id: number, cipher: FieldCipher, certificatePrefix: string) {
  const profile = PROFILES[id % PROFILES.length];
  const aadhaar = demoAadhaar(id);
  return {
    community: profile.community,
    caste: profile.caste,
    religion: profile.religion,
    nationality: 'Indian',
    mother_tongue: profile.religion === 'muslim' && id % 2 === 0 ? 'Urdu' : 'Tamil',
    community_certificate_no:
      profile.community === 'oc' ? null : `${certificatePrefix}-${profile.community.toUpperCase()}-${1000 + id}`,
    aadhaar_enc: cipher.encrypt(aadhaar),
    aadhaar_last4: aadhaar.slice(-4),
  };
}

export async function seedDemoIdentity(manager: EntityManager, school: School): Promise<void> {
  const key = process.env.DATA_ENCRYPTION_KEY;
  if (!key) throw new Error('DATA_ENCRYPTION_KEY is missing in .env');
  const cipher = new FieldCipher(key);
  const blank = { school_id: school.id, community: IsNull(), caste: IsNull(), aadhaar_last4: IsNull() };

  const students = await manager.find(Student, { select: { id: true }, where: blank, order: { id: 'ASC' } });
  const filled = students.filter((student) => student.id % NOT_RECORDED_EVERY !== 0);
  for (const student of filled) {
    await manager.update(Student, student.id, identityFor(student.id, cipher, 'TN-STU'));
  }

  const staff = await manager.find(Staff, { select: { id: true }, where: blank, order: { id: 'ASC' } });
  for (const member of staff) {
    await manager.update(Staff, member.id, identityFor(member.id + 3, cipher, 'TN-STF'));
  }

  console.log(
    `  Community and identity: ${filled.length} students, ${staff.length} staff filled; ${students.length - filled.length} students left not recorded`,
  );
}
