import { MealSlot, MEAL_SLOTS } from './entities/canteen-menu.entity';

export const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

export const tokenLabel = (prefix: string, tokenNo: number): string => `${prefix}${String(tokenNo).padStart(3, '0')}`;

export const documentNo = (prefix: string, date: string, serial: number): string =>
  `${prefix}-${date.replace(/-/g, '')}-${String(serial).padStart(4, '0')}`;

export interface BillLine {
  unit_price: number;
  quantity: number;
}

export interface Bill {
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  total_amount: number;
}

export function billFor(lines: BillLine[], taxPercent: number, discount = 0): Bill {
  const subtotal = money(lines.reduce((sum, line) => sum + line.unit_price * line.quantity, 0));
  const discount_amount = money(Math.min(Math.max(discount, 0), subtotal));
  const tax_amount = money(((subtotal - discount_amount) * taxPercent) / 100);
  return { subtotal, tax_amount, discount_amount, total_amount: money(subtotal - discount_amount + tax_amount) };
}

export function walletRefusal(balance: number, amount: number, allowNegative: boolean): string | null {
  if (amount <= 0) return 'WALLET_AMOUNT_INVALID';
  if (!allowNegative && balance < amount) return 'WALLET_INSUFFICIENT';
  return null;
}

export function dailyLimitRefusal(spentToday: number, amount: number, limit: number | null): string | null {
  if (limit === null) return null;
  return money(spentToday + amount) > limit ? 'DAILY_LIMIT_EXCEEDED' : null;
}

export function slotAt(time: string): MealSlot {
  const hour = Number(time.slice(0, 2));
  if (hour < 10) return 'breakfast';
  if (hour < 15) return 'lunch';
  if (hour < 18) return 'snacks';
  return 'dinner';
}

export const isSlot = (value: string): value is MealSlot => (MEAL_SLOTS as readonly string[]).includes(value);

export function isWithinHours(time: string, opensAt: string, closesAt: string): boolean {
  return time >= opensAt && time <= closesAt;
}

export function minutesBefore(time: string, closesAt: string): number {
  const [h1, m1] = time.split(':').map(Number);
  const [h2, m2] = closesAt.split(':').map(Number);
  return (h2! - h1!) * 60 + (m2! - m1!);
}

const ORDER_FLOW: Record<string, string[]> = {
  placed: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['served', 'cancelled'],
  served: [],
  cancelled: [],
};

export const canMoveOrder = (from: string, to: string): boolean => ORDER_FLOW[from]?.includes(to) ?? false;

export function stockStatus(quantity: number, reorderLevel: number): 'out' | 'low' | 'ok' {
  if (quantity <= 0) return 'out';
  return quantity <= reorderLevel ? 'low' : 'ok';
}

export function receiveStatus(
  lines: { quantity: number; received_quantity: number }[],
): 'ordered' | 'partial' | 'received' {
  const received = lines.reduce((sum, line) => sum + line.received_quantity, 0);
  if (received <= 0) return 'ordered';
  return lines.every((line) => line.received_quantity >= line.quantity) ? 'received' : 'partial';
}

export function attendanceRate(present: number, halfDay: number, total: number): number {
  if (total <= 0) return 0;
  return money(((present + halfDay / 2) / total) * 100);
}
