import { BatchStatus, StockMovementKind } from './entities/canteen-supply.entity';
import { money } from './canteen.logic';

export const round3 = (value: number): number => Math.round((value + Number.EPSILON) * 1000) / 1000;

const POSITIVE_KINDS: StockMovementKind[] = ['purchase', 'return'];
const NEGATIVE_KINDS: StockMovementKind[] = ['issue', 'wastage'];

export function stockDelta(kind: StockMovementKind, quantity: number): number | null {
  if (!Number.isFinite(quantity) || quantity === 0) return null;
  if (kind === 'adjustment') return round3(quantity);
  if (quantity < 0) return null;
  if (POSITIVE_KINDS.includes(kind)) return round3(quantity);
  if (NEGATIVE_KINDS.includes(kind)) return round3(-quantity);
  return null;
}

export function stockRefusal(onHand: number, delta: number): 'STOCK_INSUFFICIENT' | null {
  return round3(onHand + delta) < 0 ? 'STOCK_INSUFFICIENT' : null;
}

export function daysUntil(date: string, today: string): number {
  const to = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  const from = Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
  return Math.round((to - from) / 86400000);
}

export type ExpiryState = 'none' | 'expired' | 'soon' | 'ok';

export function expiryState(expiry: string | null, today: string, withinDays: number): ExpiryState {
  if (!expiry) return 'none';
  const days = daysUntil(expiry, today);
  if (days < 0) return 'expired';
  return days <= withinDays ? 'soon' : 'ok';
}

export function addDays(date: string, days: number): string {
  const moved = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))));
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

export interface ReceiveLineState {
  quantity: number;
  received_quantity: number;
}

export function receiveRefusal(
  line: ReceiveLineState,
  incoming: number,
): 'RECEIVE_QUANTITY_INVALID' | 'RECEIVE_EXCEEDS_ORDERED' | null {
  if (!Number.isFinite(incoming) || incoming <= 0) return 'RECEIVE_QUANTITY_INVALID';
  return round3(line.received_quantity + incoming) > line.quantity ? 'RECEIVE_EXCEEDS_ORDERED' : null;
}

export const remainingToReceive = (line: ReceiveLineState): number =>
  Math.max(0, round3(line.quantity - line.received_quantity));

export const linesTotal = (lines: { quantity: number; unit_cost: number }[]): number =>
  money(lines.reduce((sum, line) => sum + line.quantity * line.unit_cost, 0));

const BATCH_FLOW: Record<BatchStatus, BatchStatus[]> = {
  planned: ['cooking', 'cancelled'],
  cooking: ['done', 'cancelled'],
  done: [],
  cancelled: [],
};

export const canMoveBatch = (from: BatchStatus, to: BatchStatus): boolean => BATCH_FLOW[from]?.includes(to) ?? false;

export interface BookingSpan {
  id?: number;
  table_id: number;
  booking_date: string;
  slot: string;
  status: string;
}

export function bookingConflicts(existing: BookingSpan[], candidate: BookingSpan): boolean {
  return existing.some(
    (booking) =>
      booking.id !== candidate.id &&
      booking.table_id === candidate.table_id &&
      booking.booking_date === candidate.booking_date &&
      booking.slot === candidate.slot &&
      (booking.status === 'reserved' || booking.status === 'seated'),
  );
}

export const partyFits = (partySize: number, seats: number): boolean => partySize >= 1 && partySize <= seats;

export interface WasteCostInput {
  quantity: number;
  given_cost?: number | null;
  stock_cost_per_unit?: number | null;
  recipe_cost_per_portion?: number | null;
}

export function wasteCost(input: WasteCostInput): number {
  if (input.given_cost !== undefined && input.given_cost !== null) return money(input.given_cost);
  if (input.stock_cost_per_unit) return money(input.stock_cost_per_unit * input.quantity);
  if (input.recipe_cost_per_portion) return money(input.recipe_cost_per_portion * input.quantity);
  return 0;
}

export function suggestedBatchQuantity(limit: number | null, sold: number, alreadyPlanned: number): number {
  if (limit === null) return Math.max(0, sold - alreadyPlanned);
  return Math.max(0, limit - alreadyPlanned);
}

export const canCancelPurchase = (status: string, receivedTotal: number): boolean =>
  (status === 'draft' || status === 'ordered') && receivedTotal <= 0;

export const isSameDay = (date: string, today: string): boolean => date === today;
