import { Diet } from './entities/hostel-admission.entity';
import { LaundryStatus, Meal, MEALS } from './entities/hostel-care.entity';
import { addDays } from './hostel.logic';

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export const MEAL_BACK_DAYS = 1;
export const SKIP_MAX_DAYS = 30;
export const FEEDBACK_BACK_DAYS = 7;
export const DOSE_BACK_DAYS = 2;

export type MenuSource = 'override' | 'hostel_week' | 'school_week' | 'none';

export interface MenuRow {
  hostel_id: number | null;
  day_of_week: number;
  meal: Meal;
  items: string;
  non_veg_items: string | null;
}

export interface OverrideRow {
  id: number;
  hostel_id: number | null;
  meal: Meal;
  items: string;
  non_veg_items: string | null;
  note: string | null;
}

export interface ResolvedMeal {
  meal: Meal;
  items: string | null;
  non_veg_items: string | null;
  source: MenuSource;
  note: string | null;
}

export function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function pickMenuRow<T extends { hostel_id: number | null }>(rows: T[]): T | null {
  return rows.find((row) => row.hostel_id !== null) ?? rows.find((row) => row.hostel_id === null) ?? null;
}

export function weekGrid(rows: MenuRow[]) {
  return DAY_NAMES.map((dayName, day) => ({
    day_of_week: day,
    day_name: dayName,
    meals: MEALS.map((meal) => {
      const row = pickMenuRow(rows.filter((item) => item.day_of_week === day && item.meal === meal));
      return {
        meal,
        items: row?.items ?? null,
        non_veg_items: row?.non_veg_items ?? null,
        source: row ? (row.hostel_id === null ? 'school_week' : 'hostel_week') : 'none',
      } as Omit<ResolvedMeal, 'note'>;
    }),
  }));
}

export function resolveDay(date: string, menus: MenuRow[], overrides: OverrideRow[]): ResolvedMeal[] {
  const day = dayOfWeek(date);
  return MEALS.map((meal) => {
    const override = pickMenuRow(overrides.filter((row) => row.meal === meal));
    if (override) {
      return {
        meal,
        items: override.items,
        non_veg_items: override.non_veg_items,
        source: 'override',
        note: override.note,
      };
    }
    const row = pickMenuRow(menus.filter((item) => item.day_of_week === day && item.meal === meal));
    if (!row) return { meal, items: null, non_veg_items: null, source: 'none', note: null };
    return {
      meal,
      items: row.items,
      non_veg_items: row.non_veg_items,
      source: row.hostel_id === null ? 'school_week' : 'hostel_week',
      note: null,
    };
  });
}

export function duplicateSlots(entries: { day_of_week: number; meal: Meal }[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const entry of entries) {
    const key = `${DAY_NAMES[entry.day_of_week] ?? entry.day_of_week} ${entry.meal}`;
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return [...duplicates];
}

export interface SkipWindow {
  from_date: string;
  to_date: string;
  meals: Meal[];
  status: string;
}

export function skipCovers(skip: SkipWindow, date: string, meal: Meal): boolean {
  return skip.status === 'active' && skip.from_date <= date && skip.to_date >= date && skip.meals.includes(meal);
}

export function skipsOverlap(a: SkipWindow, b: SkipWindow): boolean {
  if (a.status !== 'active' || b.status !== 'active') return false;
  if (a.from_date > b.to_date || b.from_date > a.to_date) return false;
  return a.meals.some((meal) => b.meals.includes(meal));
}

export function skipErrors(fromDate: string, toDate: string, today: string): { field: string; message: string }[] {
  const errors: { field: string; message: string }[] = [];
  if (fromDate < today) errors.push({ field: 'from_date', message: 'Cannot be before today' });
  if (toDate < fromDate) errors.push({ field: 'to_date', message: 'Must be on or after from_date' });
  else if (toDate > addDays(fromDate, SKIP_MAX_DAYS)) {
    errors.push({ field: 'to_date', message: `A meal skip can cover at most ${SKIP_MAX_DAYS} days after from_date` });
  }
  return errors;
}

export function withinBackDays(date: string, today: string, backDays: number): boolean {
  return date <= today && date >= addDays(today, -backDays);
}

export interface MealResident {
  diet: Diet;
  status: 'ate' | 'skipped' | null;
  skip_id: number | null;
  on_leave: boolean;
}

export function headcount(residents: MealResident[]) {
  const byDiet: Record<Diet, number> = { veg: 0, non_veg: 0, eggetarian: 0 };
  let onLeave = 0;
  let skipping = 0;
  let ate = 0;
  let skipped = 0;
  for (const resident of residents) {
    if (resident.status === 'ate') ate += 1;
    if (resident.status === 'skipped') skipped += 1;
    if (resident.on_leave) onLeave += 1;
    else if (resident.skip_id) skipping += 1;
    else byDiet[resident.diet] = (byDiet[resident.diet] ?? 0) + 1;
  }
  const expected = residents.length - onLeave - skipping;
  return {
    residents: residents.length,
    on_leave: onLeave,
    skipping,
    expected,
    by_diet: byDiet,
    ate,
    skipped,
    unmarked: residents.length - ate - skipped,
  };
}

export function averageRating(total: number, count: number): number | null {
  if (!count) return null;
  return Math.round((total / count) * 10) / 10;
}

export function uniqueTimes(times: string[]): string[] {
  return [...new Set(times)].sort();
}

export function medicationRunsOn(
  medication: { from_date: string; to_date: string | null; active: boolean },
  date: string,
): boolean {
  return (
    medication.active && medication.from_date <= date && (medication.to_date === null || medication.to_date >= date)
  );
}

export function doseOverdue(
  status: string,
  doseDate: string,
  doseTime: string,
  today: string,
  nowTime: string,
): boolean {
  if (status !== 'pending') return false;
  return doseDate < today || (doseDate === today && doseTime < nowTime);
}

export function timeIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    now,
  );
}

export type LaundryAction = 'items' | 'sent' | 'returned' | 'close';

const LAUNDRY_MOVES: Record<LaundryAction, { from: LaundryStatus[]; to: LaundryStatus }> = {
  items: { from: ['collected'], to: 'collected' },
  sent: { from: ['collected'], to: 'sent' },
  returned: { from: ['collected', 'sent'], to: 'returned' },
  close: { from: ['returned'], to: 'closed' },
};

export function laundryMove(current: LaundryStatus, action: LaundryAction): LaundryStatus | null {
  const move = LAUNDRY_MOVES[action];
  return move.from.includes(current) ? move.to : null;
}

export function missingItems(given: number, returned: number | null): number {
  if (returned === null) return 0;
  return Math.max(0, given - returned);
}

export function duplicateIds(ids: number[]): number[] {
  const seen = new Set<number>();
  const duplicates = new Set<number>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates];
}

const HEALTH_LABELS: Record<string, string> = {
  illness: 'Not feeling well',
  injury: 'Injury',
  checkup: 'Health check-up',
  sick_bay: 'Resting in the sick bay',
  other: 'Health note',
};

export function healthMessage(log: {
  kind: string;
  symptoms: string;
  temperature: number | null;
  action_taken: string | null;
  hospital_visit: boolean;
  in_sick_bay: boolean;
}): { what: string; action: string } {
  const what = [`${HEALTH_LABELS[log.kind] ?? 'Health note'} - ${log.symptoms}`];
  if (log.temperature !== null) what.push(`temperature ${log.temperature}`);
  const action: string[] = [];
  if (log.action_taken) action.push(log.action_taken.replace(/[.\s]+$/, '') + '.');
  if (log.hospital_visit) action.push('Taken to the doctor.');
  if (log.in_sick_bay && log.kind !== 'sick_bay') action.push('Resting in the sick bay.');
  return { what: what.join(', ').slice(0, 300), action: action.join(' ').slice(0, 300) };
}

export function appendNote(current: string | null, note: string | null | undefined, max = 500): string | null {
  if (!note) return current;
  return [current, note].filter(Boolean).join(' · ').slice(0, max);
}
