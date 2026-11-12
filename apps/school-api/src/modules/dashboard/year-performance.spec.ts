import { visibleSections } from './dashboard.logic';
import { byYear, groupByYear, share, topLevel, yearPerformance } from './year-performance.logic';

const years = [
  { id: 2, name: '2026-27', start_date: '2026-06-01', end_date: '2027-04-30', is_current: true },
  { id: 1, name: '2025-26', start_date: '2025-06-01', end_date: '2026-04-30', is_current: false },
];

const everything = visibleSections([
  'students.view',
  'staff.view',
  'attendance.view',
  'fleet.view',
  'fees.view',
  'exams.view',
]);

const figures = {
  students: byYear([{ year_id: 1, enrolled: 2, promoted: 2, left_school: 0 }]),
  attendance: byYear([{ year_id: 1, percent: '91.25', days_marked: 180, below_75: 1 }]),
  staff: byYear([{ year_id: 1, percent: '95.0' }]),
  studies: byYear([
    {
      year_id: 1,
      exams: 3,
      students: 2,
      average_percent: '72.40',
      pass_percent: '90.0',
      fail_percent: '10.0',
      absent_percent: '2.50',
    },
  ]),
  activities: byYear([{ year_id: 1, total: 4, sports: 3, podium: 2, students: 2, points: 40, top_rank: 4 }]),
  fees: byYear([{ year_id: 1, billed: '10000.00', collected: '7500.00' }]),
  feeHeads: groupByYear([
    { year_id: 1, name: 'Sports', is_transport: false, billed: '2000.00', collected: '1000.40' },
    { year_id: 1, name: 'Tuition', is_transport: false, billed: '6000.00', collected: '5000.00' },
    { year_id: 1, name: 'Transport', is_transport: true, billed: '2000.00', collected: '1499.60' },
  ]),
};

describe('year performance', () => {
  it('builds one row per year with studies, attendance, sports and fees', () => {
    const [current, past] = yearPerformance(years, figures, everything);
    expect(past.academic_year.name).toBe('2025-26');
    expect(past.students).toEqual({ enrolled: 2, promoted: 2, left: 0 });
    expect(past.attendance).toEqual({ percent: 91.3, days_marked: 180, below_75: 1, staff_percent: 95 });
    expect(past.studies).toEqual({
      exams: 3,
      students: 2,
      average_percent: 72.4,
      pass_percent: 90,
      fail_percent: 10,
      absent_percent: 2.5,
    });
    expect(past.activities).toMatchObject({ total: 4, sports: 3, podium: 2, top_level: 'district' });
    expect(past.fees).toMatchObject({ billed: 10000, collected: 7500, collection_percent: 75 });
    expect(past.fees?.heads.map((head) => head.name)).toEqual(['Tuition', 'Sports', 'Transport']);
    expect(past.fees?.heads[2]).toEqual({
      name: 'Transport',
      is_transport: true,
      billed: 2000,
      collected: 1500,
      collection_percent: 75,
    });
    expect(current.fees?.heads).toEqual([]);
    expect(current.studies).toEqual({
      exams: 0,
      students: 0,
      average_percent: null,
      pass_percent: null,
      fail_percent: null,
      absent_percent: null,
    });
    expect(current.fees?.collection_percent).toBeNull();
  });

  it('hides what the caller may not see', () => {
    const [row] = yearPerformance(years, { ...figures, fees: null }, visibleSections(['exams.view']));
    expect(row.studies).not.toBeNull();
    expect(row.students).toBeNull();
    expect(row.activities).toBeNull();
    expect(row.attendance).toBeNull();
    expect(row.fees).toBeNull();
  });

  it('names the highest level and works out shares', () => {
    expect(topLevel(null)).toBeNull();
    expect(topLevel(1)).toBe('class');
    expect(topLevel(7)).toBe('international');
    expect(share(1, 0)).toBeNull();
    expect(share(1, 3)).toBe(33.3);
  });
});
