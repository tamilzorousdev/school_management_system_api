import {
  appealOpen,
  autoScore,
  DEFAULT_STAFF_KRAS,
  DEFAULT_TEACHING_KRAS,
  finalDefault,
  GroupForMatching,
  kraPercent,
  kraSetErrors,
  overallPercent,
  placeStaff,
  ratingFor,
  stageAfterSelf,
  StaffFacts,
} from './appraisal.logic';
import { defaultRecommendation, finalValue, hodValue, selfValue } from './appraisals.service';
import { AppraisalScore } from './entities/appraisal.entity';

const noRules = { staff_types: [], departments: [], designations: [], roles: [] };

function group(id: number, overrides: Partial<GroupForMatching> = {}): GroupForMatching {
  return {
    id,
    rules: noRules,
    is_default: false,
    sort_order: id,
    include: new Set(),
    exclude: new Set(),
    ...overrides,
  };
}

const arun: StaffFacts = {
  staff_id: 41,
  staff_type: 'teaching',
  department: 'Science',
  designation: 'PG Assistant',
  roles: ['TEACHER', 'PARENT'],
};

function score(overrides: Partial<AppraisalScore>): AppraisalScore {
  return Object.assign(new AppraisalScore(), {
    id: 1,
    kra_id: 1,
    weightage_percent: '25',
    max_score: 5,
    scoring_mode: 'manual',
    auto_score: null,
    self_score: null,
    hod_score: null,
    final_score: null,
    ...overrides,
  });
}

describe('appraisal scoring', () => {
  it('turns weighted KRA scores into an overall percentage', () => {
    expect(
      overallPercent([
        { weightage_percent: 60, max_score: 5, score: 4 },
        { weightage_percent: 40, max_score: 10, score: 5 },
      ]),
    ).toBe(68);
    expect(overallPercent([{ weightage_percent: 100, max_score: 5, score: null }])).toBeNull();
    expect(kraPercent(4.5, 5)).toBe(90);
  });

  it('maps percentages to rating bands', () => {
    expect(ratingFor(92)).toBe('outstanding');
    expect(ratingFor(91.99)).toBe('exceeds_expectations');
    expect(ratingFor(76)).toBe('exceeds_expectations');
    expect(ratingFor(60)).toBe('meets_expectations');
    expect(ratingFor(40)).toBe('needs_improvement');
    expect(ratingFor(39.9)).toBe('unsatisfactory');
  });

  it('scores an auto KRA from the school data, capped at the maximum', () => {
    expect(autoScore(86, 100, 5)).toBe(4.3);
    expect(autoScore(4.6, 5, 5)).toBe(4.6);
    expect(autoScore(140, 100, 5)).toBe(5);
    expect(autoScore(null, 100, 5)).toBeNull();
    expect(autoScore(50, 0, 5)).toBeNull();
  });

  it('proposes the final score from HOD, then school data, then self', () => {
    expect(finalDefault(4, 3, 5, 'auto')).toBe(4);
    expect(finalDefault(null, 3, 4.5, 'auto')).toBe(4.5);
    expect(finalDefault(null, 3, 4.5, 'manual')).toBe(3);
    expect(finalDefault(null, null, null, 'manual')).toBeNull();
  });

  it('uses the school data for auto KRAs at each step unless a person scored it', () => {
    const auto = score({ scoring_mode: 'auto', auto_score: '4.20' });
    expect(selfValue(auto)).toBe(4.2);
    expect(hodValue(auto)).toBe(4.2);
    expect(hodValue(score({ scoring_mode: 'auto', auto_score: '4.20', hod_score: '3' }))).toBe(3);
    expect(hodValue(score({ self_score: '4' }))).toBeNull();
    expect(finalValue(score({ self_score: '4', hod_score: '3' }))).toBe(3);
    expect(finalValue(score({ hod_score: '3', final_score: '4.5' }))).toBe(4.5);
  });

  it('recommends a PIP for the two lowest ratings', () => {
    expect(defaultRecommendation('unsatisfactory')).toBe('pip');
    expect(defaultRecommendation('needs_improvement')).toBe('pip');
    expect(defaultRecommendation('meets_expectations')).toBe('increment');
  });
});

describe('KRA sets', () => {
  it('accepts the standard sets', () => {
    expect(kraSetErrors(DEFAULT_TEACHING_KRAS)).toEqual([]);
    expect(kraSetErrors(DEFAULT_STAFF_KRAS)).toEqual([]);
  });

  it('refuses weights that do not add up to 100, repeated codes and auto KRAs without a metric', () => {
    const base = DEFAULT_STAFF_KRAS.map((kra) => ({ ...kra }));
    expect(kraSetErrors([{ ...base[0]!, weightage_percent: 41 }, base[1]!, base[2]!])[0]?.message).toContain('101%');
    expect(kraSetErrors([base[0]!, { ...base[1]!, code: base[0]!.code }, base[2]!]).map((e) => e.field)).toContain(
      'kras.1.code',
    );
    expect(
      kraSetErrors([base[0]!, { ...base[1]!, auto_metric: null }, base[2]!]).map((error) => error.field),
    ).toContain('kras.1.auto_metric');
    expect(kraSetErrors([])[0]?.field).toBe('kras');
  });
});

describe('placing staff in groups', () => {
  it('matches every chosen kind of rule and ignores case', () => {
    const science = group(1, { rules: { ...noRules, staff_types: ['teaching'], departments: ['science'] } });
    const maths = group(2, { rules: { ...noRules, departments: ['Mathematics'] } });
    expect(placeStaff(arun, [maths, science]).group_id).toBe(1);
    expect(placeStaff({ ...arun, staff_type: 'non_teaching' }, [science, maths]).group_id).toBeNull();
  });

  it('prefers the lower sort order when two groups match, and lists both', () => {
    const teachers = group(5, { sort_order: 2, rules: { ...noRules, staff_types: ['teaching'] } });
    const science = group(6, { sort_order: 1, rules: { ...noRules, departments: ['Science'] } });
    const placement = placeStaff(arun, [teachers, science]);
    expect(placement.group_id).toBe(6);
    expect(placement.candidates.sort()).toEqual([5, 6]);
  });

  it('puts included people first and keeps excluded people out', () => {
    const teachers = group(1, { rules: { ...noRules, roles: ['TEACHER'] } });
    const office = group(2, { include: new Set([41]) });
    expect(placeStaff(arun, [teachers, office]).group_id).toBe(2);
    const blocked = group(1, { rules: { ...noRules, roles: ['TEACHER'] }, exclude: new Set([41]) });
    expect(placeStaff(arun, [blocked]).group_id).toBeNull();
  });

  it('sends everyone else to the default group, which has no rules of its own', () => {
    const maths = group(1, { rules: { ...noRules, departments: ['Mathematics'] } });
    const everyone = group(9, { is_default: true, sort_order: 99 });
    const placement = placeStaff(arun, [maths, everyone]);
    expect(placement.group_id).toBe(9);
    expect(placement.candidates).toEqual([]);
  });
});

describe('appraisal steps', () => {
  it('goes to the HOD when there is one, else straight to the Principal', () => {
    expect(stageAfterSelf(779)).toBe('hod_pending');
    expect(stageAfterSelf(null)).toBe('principal_pending');
  });

  it('allows an appeal only within the appeal window after publishing', () => {
    const published = new Date('2026-12-01T10:00:00Z');
    expect(appealOpen(published, 7, new Date('2026-12-08T09:59:00Z'))).toBe(true);
    expect(appealOpen(published, 7, new Date('2026-12-08T10:01:00Z'))).toBe(false);
    expect(appealOpen(null, 7, new Date())).toBe(false);
  });
});
