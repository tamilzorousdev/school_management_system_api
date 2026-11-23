import {
  AppraisalStage,
  AUTO_METRICS,
  AutoMetric,
  GroupRules,
  IncrementBands,
  KraCategory,
  Rating,
  ScoringMode,
} from './entities/appraisal.entity';

export const RATING_BANDS: [number, Rating][] = [
  [92, 'outstanding'],
  [76, 'exceeds_expectations'],
  [60, 'meets_expectations'],
  [40, 'needs_improvement'],
  [0, 'unsatisfactory'],
];

export const DEFAULT_INCREMENT_BANDS: IncrementBands = {
  outstanding: 12,
  exceeds_expectations: 10,
  meets_expectations: 7,
  needs_improvement: 3,
  unsatisfactory: 0,
};

export const RATING_LABELS: Record<Rating, string> = {
  outstanding: 'Outstanding',
  exceeds_expectations: 'Exceeds expectations',
  meets_expectations: 'Meets expectations',
  needs_improvement: 'Needs improvement',
  unsatisfactory: 'Unsatisfactory',
};

export const METRIC_DEFAULT_TARGETS: Record<AutoMetric, number> = {
  attendance_percent: 100,
  exam_pass_percent: 100,
  parent_rating: 5,
  parent_good_behaviour_percent: 100,
  homework_count: 60,
  driver_rating: 5,
};

export interface KraDraft {
  code: string;
  title: string;
  description?: string | null;
  category: KraCategory;
  weightage_percent: number;
  max_score: number;
  scoring_mode: ScoringMode;
  auto_metric?: AutoMetric | null;
  auto_target?: number | null;
}

export const DEFAULT_TEACHING_KRAS: KraDraft[] = [
  {
    code: 'curriculum_pedagogy',
    title: 'Curriculum delivery and teaching methods',
    description: 'Lesson plans covered, engaging methods, use of digital tools and practical work.',
    category: 'pedagogy',
    weightage_percent: 25,
    max_score: 5,
    scoring_mode: 'manual',
  },
  {
    code: 'student_outcomes',
    title: 'Student results',
    description: 'Pass percentage of the classes and subjects taught this year (published exams).',
    category: 'academics',
    weightage_percent: 25,
    max_score: 5,
    scoring_mode: 'auto',
    auto_metric: 'exam_pass_percent',
    auto_target: 100,
  },
  {
    code: 'classroom_management',
    title: 'Classroom culture and discipline',
    description: 'Classroom order, positive behaviour and an inclusive atmosphere.',
    category: 'administrative',
    weightage_percent: 20,
    max_score: 5,
    scoring_mode: 'manual',
  },
  {
    code: 'parent_collaboration',
    title: 'Parent communication and satisfaction',
    description: 'Average parent rating this year in the Parent app.',
    category: 'general',
    weightage_percent: 15,
    max_score: 5,
    scoring_mode: 'auto',
    auto_metric: 'parent_rating',
    auto_target: 5,
  },
  {
    code: 'professional_conduct',
    title: 'Punctuality and school initiatives',
    description: 'Attendance this year, events, mentoring and upskilling.',
    category: 'extracurricular',
    weightage_percent: 15,
    max_score: 5,
    scoring_mode: 'manual',
  },
];

export const DEFAULT_STAFF_KRAS: KraDraft[] = [
  {
    code: 'work_quality',
    title: 'Quality and accuracy of work',
    category: 'administrative',
    weightage_percent: 40,
    max_score: 5,
    scoring_mode: 'manual',
  },
  {
    code: 'attendance',
    title: 'Attendance and punctuality',
    description: 'Attendance this year from the staff check-in.',
    category: 'general',
    weightage_percent: 30,
    max_score: 5,
    scoring_mode: 'auto',
    auto_metric: 'attendance_percent',
    auto_target: 100,
  },
  {
    code: 'teamwork',
    title: 'Teamwork and conduct',
    category: 'general',
    weightage_percent: 30,
    max_score: 5,
    scoring_mode: 'manual',
  },
];

export const round2 = (value: number) => Math.round(value * 100) / 100;

export function ratingFor(percent: number): Rating {
  return RATING_BANDS.find(([floor]) => percent >= floor)![1];
}

export function autoScore(value: number | null, target: number, max: number): number | null {
  if (value === null || !Number.isFinite(value) || target <= 0) return null;
  return round2(Math.min(max, Math.max(0, (value / target) * max)));
}

export interface ScoredKra {
  weightage_percent: number;
  max_score: number;
  score: number | null;
}

export function overallPercent(kras: ScoredKra[]): number | null {
  if (!kras.length || kras.some((kra) => kra.score === null)) return null;
  const total = kras.reduce((sum, kra) => sum + (kra.score! / kra.max_score) * kra.weightage_percent, 0);
  return round2(total);
}

export function kraPercent(score: number | null, max: number): number | null {
  return score === null ? null : round2((score / max) * 100);
}

export interface FieldError {
  field: string;
  message: string;
}

export function kraSetErrors(kras: KraDraft[]): FieldError[] {
  const errors: FieldError[] = [];
  if (!kras.length) errors.push({ field: 'kras', message: 'Add at least one KRA' });
  const total = round2(kras.reduce((sum, kra) => sum + Number(kra.weightage_percent), 0));
  if (kras.length && total !== 100) {
    errors.push({ field: 'kras', message: `Weights must add up to 100% (now ${total}%)` });
  }
  const seen = new Set<string>();
  kras.forEach((kra, index) => {
    const code = kra.code.trim().toLowerCase();
    if (seen.has(code)) errors.push({ field: `kras.${index}.code`, message: 'This code is used twice' });
    seen.add(code);
    if (kra.scoring_mode === 'auto') {
      if (!kra.auto_metric || !AUTO_METRICS.includes(kra.auto_metric)) {
        errors.push({ field: `kras.${index}.auto_metric`, message: 'Choose what this KRA is scored from' });
      }
    } else if (kra.auto_metric) {
      errors.push({ field: `kras.${index}.auto_metric`, message: 'Only an auto KRA has a metric' });
    }
  });
  return errors;
}

export interface StaffFacts {
  staff_id: number;
  staff_type: string;
  department: string | null;
  designation: string;
  roles: string[];
}

export interface GroupForMatching {
  id: number;
  rules: GroupRules;
  is_default: boolean;
  sort_order: number;
  include: Set<number>;
  exclude: Set<number>;
}

const lower = (values: string[]) => values.map((value) => value.trim().toLowerCase()).filter(Boolean);

export function hasRules(rules: GroupRules): boolean {
  return Boolean(
    rules.staff_types.length || rules.departments.length || rules.designations.length || rules.roles.length,
  );
}

export function matchesRules(staff: StaffFacts, rules: GroupRules): boolean {
  if (!hasRules(rules)) return false;
  if (rules.staff_types.length && !rules.staff_types.includes(staff.staff_type as never)) return false;
  if (rules.departments.length && !lower(rules.departments).includes((staff.department ?? '').trim().toLowerCase())) {
    return false;
  }
  if (rules.designations.length && !lower(rules.designations).includes(staff.designation.trim().toLowerCase())) {
    return false;
  }
  if (rules.roles.length && !rules.roles.some((role) => staff.roles.includes(role))) return false;
  return true;
}

export interface Placement {
  group_id: number | null;
  candidates: number[];
}

export function placeStaff(staff: StaffFacts, groups: GroupForMatching[]): Placement {
  const ordered = [...groups].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  const open = ordered.filter((group) => !group.exclude.has(staff.staff_id));
  const included = open.filter((group) => group.include.has(staff.staff_id));
  const matched = open.filter((group) => !group.is_default && matchesRules(staff, group.rules));
  const candidates = [...new Set([...included, ...matched])];
  const chosen = included[0] ?? matched[0] ?? open.find((group) => group.is_default);
  return { group_id: chosen?.id ?? null, candidates: candidates.map((group) => group.id) };
}

export function stageAfterSelf(hodUserId: number | null): AppraisalStage {
  return hodUserId ? 'hod_pending' : 'principal_pending';
}

export const SELF_EDITABLE: AppraisalStage[] = ['self_pending'];
export const HOD_EDITABLE: AppraisalStage[] = ['hod_pending'];
export const FINAL_EDITABLE: AppraisalStage[] = ['self_pending', 'hod_pending', 'principal_pending', 'appealed'];

export function appealOpen(publishedAt: Date | null, appealDays: number, now: Date): boolean {
  if (!publishedAt) return false;
  return now.getTime() <= publishedAt.getTime() + appealDays * 86_400_000;
}

export function finalDefault(
  hod: number | null,
  self: number | null,
  auto: number | null,
  mode: ScoringMode,
): number | null {
  if (hod !== null) return hod;
  if (mode === 'auto' && auto !== null) return auto;
  return self;
}
