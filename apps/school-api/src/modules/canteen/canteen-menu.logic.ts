import { money } from './canteen.logic';
import { MEAL_SLOTS, MealSlot } from './entities/canteen-menu.entity';

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const TOKEN_PREFIX = /^[A-Z]{1,4}$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export interface SettingsFields {
  opens_at: string;
  closes_at: string;
  tax_percent: number;
  token_prefix: string;
}

export interface FieldRefusal {
  field: string;
  message: string;
}

export function settingsRefusal(current: SettingsFields, change: Partial<SettingsFields>): FieldRefusal | null {
  const next = { ...current, ...Object.fromEntries(Object.entries(change).filter(([, v]) => v !== undefined)) };
  if (!CLOCK.test(next.opens_at)) return { field: 'opens_at', message: 'opens_at must be a time in HH:mm format' };
  if (!CLOCK.test(next.closes_at)) return { field: 'closes_at', message: 'closes_at must be a time in HH:mm format' };
  if (next.opens_at >= next.closes_at) return { field: 'closes_at', message: 'closes_at must be after opens_at' };
  if (next.tax_percent < 0 || next.tax_percent > 50) {
    return { field: 'tax_percent', message: 'tax_percent must be between 0 and 50' };
  }
  if (!TOKEN_PREFIX.test(next.token_prefix)) {
    return { field: 'token_prefix', message: 'token_prefix must be 1 to 4 uppercase letters' };
  }
  return null;
}

export const effectivePrice = (entryPrice: number | null, basePrice: number): number => money(entryPrice ?? basePrice);

export const remainingQuantity = (limit: number | null, sold: number): number | null =>
  limit === null ? null : Math.max(0, limit - sold);

export interface EntryTarget {
  food_item_id?: number | null;
  meal_id?: number | null;
}

export function entryRefusal(entry: EntryTarget): string | null {
  const hasItem = entry.food_item_id !== undefined && entry.food_item_id !== null;
  const hasMeal = entry.meal_id !== undefined && entry.meal_id !== null;
  if (hasItem && hasMeal) return 'Choose either a food item or a meal, not both';
  if (!hasItem && !hasMeal) return 'Choose a food item or a meal';
  return null;
}

export const entryKey = (entry: EntryTarget): string =>
  entry.food_item_id ? `item:${entry.food_item_id}` : `meal:${entry.meal_id}`;

export function duplicateKey(entries: EntryTarget[]): string | null {
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = entryKey(entry);
    if (seen.has(key)) return key;
    seen.add(key);
  }
  return null;
}

export const isPastDate = (date: string, today: string): boolean => date < today;

export const isDateOnly = (value: string): boolean => DATE.test(value);

export interface ReplacePlan {
  update: { id: number; index: number }[];
  create: number[];
  remove: number[];
}

export function planReplace(existing: { id: number; key: string }[], incomingKeys: string[]): ReplacePlan {
  const byKey = new Map(existing.map((row) => [row.key, row.id]));
  const update: ReplacePlan['update'] = [];
  const create: number[] = [];
  incomingKeys.forEach((key, index) => {
    const id = byKey.get(key);
    if (id === undefined) create.push(index);
    else update.push({ id, index });
  });
  const kept = new Set(update.map((row) => row.id));
  return { update, create, remove: existing.filter((row) => !kept.has(row.id)).map((row) => row.id) };
}

export interface CopySource {
  slot: MealSlot;
  food_item_id: number | null;
  meal_id: number | null;
  price: number | null;
  quantity_limit: number | null;
  active: boolean;
}

export function copyDrafts(source: CopySource[], slot?: MealSlot): CopySource[] {
  return source.filter((entry) => !slot || entry.slot === slot).map((entry) => ({ ...entry }));
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const moved = new Date(Date.UTC(year!, month! - 1, day! + days));
  return moved.toISOString().slice(0, 10);
}

export const weekDates = (from: string): string[] => Array.from({ length: 7 }, (_, index) => addDays(from, index));

export function mealPricing(components: { price: number; quantity: number }[], mealPrice: number) {
  const item_total = money(components.reduce((sum, part) => sum + part.price * part.quantity, 0));
  return { item_total, saving: money(item_total - mealPrice) };
}

export const slotRank = (slot: string): number => MEAL_SLOTS.indexOf(slot as MealSlot);

export function groupBySlot<T extends { slot: MealSlot }>(entries: T[]): { slot: MealSlot; entries: T[] }[] {
  return MEAL_SLOTS.map((slot) => ({ slot, entries: entries.filter((entry) => entry.slot === slot) })).filter(
    (group) => group.entries.length > 0,
  );
}
