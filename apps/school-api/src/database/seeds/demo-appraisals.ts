import { EntityManager } from 'typeorm';
import {
  DEFAULT_INCREMENT_BANDS,
  DEFAULT_STAFF_KRAS,
  DEFAULT_TEACHING_KRAS,
  KraDraft,
  METRIC_DEFAULT_TARGETS,
} from '../../modules/appraisals/appraisal.logic';
import {
  AppraisalCycle,
  AppraisalGroup,
  AppraisalKra,
  GroupRules,
} from '../../modules/appraisals/entities/appraisal.entity';
import { School } from '../../modules/schools/entities/school.entity';
import { AcademicYear } from '../../modules/setup/entities/academic-year.entity';

const DAY = 86_400_000;

const GROUPS: { name: string; description: string; rules: GroupRules; is_default: boolean; kras: KraDraft[] }[] = [
  {
    name: 'Teaching staff',
    description: 'Every teacher and HOD',
    rules: { staff_types: ['teaching'], departments: [], designations: [], roles: [] },
    is_default: false,
    kras: DEFAULT_TEACHING_KRAS,
  },
  {
    name: 'Office & support',
    description: 'Everyone else: office, library, transport and support staff',
    rules: { staff_types: [], departments: [], designations: [], roles: [] },
    is_default: true,
    kras: DEFAULT_STAFF_KRAS,
  },
];

export async function seedDemoAppraisals(manager: EntityManager, school: School): Promise<void> {
  const year = await manager.findOne(AcademicYear, { where: { school_id: school.id, is_current: true } });
  if (!year) return;
  if (await manager.count(AppraisalGroup, { where: { school_id: school.id, academic_year_id: year.id } })) return;

  const groupIds: number[] = [];
  for (const [index, definition] of GROUPS.entries()) {
    const group = await manager.save(
      manager.create(AppraisalGroup, {
        school_id: school.id,
        academic_year_id: year.id,
        name: definition.name,
        description: definition.description,
        rules: definition.rules,
        is_default: definition.is_default,
        sort_order: index + 1,
        is_active: true,
      }),
    );
    groupIds.push(group.id);
    await manager.insert(
      AppraisalKra,
      definition.kras.map((kra, position) => ({
        school_id: school.id,
        group_id: group.id,
        code: kra.code,
        title: kra.title,
        description: kra.description ?? null,
        category: kra.category,
        weightage_percent: String(kra.weightage_percent),
        max_score: kra.max_score,
        scoring_mode: kra.scoring_mode,
        auto_metric: kra.auto_metric ?? null,
        auto_target:
          kra.scoring_mode === 'auto' ? String(kra.auto_target ?? METRIC_DEFAULT_TARGETS[kra.auto_metric!]) : null,
        sort_order: position + 1,
      })),
    );
  }

  const now = Date.now();
  await manager.save(
    manager.create(AppraisalCycle, {
      school_id: school.id,
      academic_year_id: year.id,
      title: `Annual review ${year.name}`,
      description: 'Self-appraisal in the app, then the HOD, then the Principal',
      group_ids: groupIds,
      self_opens_at: null,
      self_due_at: new Date(now + 7 * DAY),
      hod_due_at: new Date(now + 14 * DAY),
      final_due_at: new Date(now + 21 * DAY),
      appeal_days: 7,
      increment_bands: DEFAULT_INCREMENT_BANDS,
      status: 'draft',
    }),
  );
}
