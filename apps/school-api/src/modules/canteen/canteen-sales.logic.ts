import { money } from './canteen.logic';
import { Diet, OrderStatus, PaymentStatus, WalletKind } from './entities/canteen-sales.entity';

export interface Refusal {
  code: string;
  message: string;
}

export const cardNoFor = (dinerId: number): string => `CN${String(dinerId).padStart(6, '0')}`;

export function cardRefusal(cardStatus: string, dinerStatus: string): Refusal | null {
  if (dinerStatus !== 'active') {
    return { code: 'DINER_NOT_ACTIVE', message: `This diner is ${dinerStatus}` };
  }
  if (cardStatus !== 'active') {
    return { code: 'CARD_NOT_ACTIVE', message: `This meal card is ${cardStatus}` };
  }
  return null;
}

export function parseList(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
}

export function slotAllowed(mealSlots: string | null, slot: string | null): boolean {
  const allowed = parseList(mealSlots);
  if (!slot || allowed.length === 0) return true;
  return allowed.includes(slot);
}

export function allergenWarnings(allergies: string | null, itemName: string, itemAllergens: string | null): string[] {
  const dinerAllergies = parseList(allergies);
  if (dinerAllergies.length === 0) return [];
  const itemList = parseList(itemAllergens);
  return dinerAllergies
    .filter((allergy) => itemList.some((allergen) => allergen.includes(allergy) || allergy.includes(allergen)))
    .map((allergy) => `${itemName} contains ${allergy}, which this diner is allergic to`);
}

export function dietWarning(diet: Diet, itemName: string, isVeg: boolean): string | null {
  if (diet === 'veg' && !isVeg) return `${itemName} is non-vegetarian but this diner is vegetarian`;
  return null;
}

export const unitPrice = (entryPrice: number | null, basePrice: number): number => entryPrice ?? basePrice;

export function remainingQuantity(limit: number | null, sold: number): number | null {
  if (limit === null) return null;
  return Math.max(0, limit - sold);
}

export const soldOut = (limit: number | null, sold: number, wanted: number): boolean =>
  limit !== null && sold + wanted > limit;

export interface RequestedLine {
  food_item_id?: number;
  meal_id?: number;
  quantity: number;
}

export function mergeLines(lines: RequestedLine[]): RequestedLine[] {
  const merged = new Map<string, RequestedLine>();
  for (const line of lines) {
    const key = line.food_item_id ? `f${line.food_item_id}` : `m${line.meal_id}`;
    const existing = merged.get(key);
    if (existing) existing.quantity += line.quantity;
    else merged.set(key, { ...line });
  }
  return [...merged.values()];
}

export function lineTotal(price: number, quantity: number): number {
  return money(price * quantity);
}

export const signedAmount = (kind: WalletKind, amount: number): number => {
  const magnitude = Math.abs(amount);
  return kind === 'purchase' ? -magnitude : kind === 'adjustment' ? amount : magnitude;
};

export const balanceAfter = (balance: number, signed: number): number => money(balance + signed);

export const isLowBalance = (balance: number, limit: number): boolean => balance <= limit;

export const nextNumber = (current: number | null | undefined): number => Number(current ?? 0) + 1;

export function adjustmentRefusal(amount: number, note: string | undefined): Refusal | null {
  if (!amount) return { code: 'WALLET_AMOUNT_INVALID', message: 'Adjustment amount cannot be zero' };
  if (!note || note.trim().length === 0) {
    return { code: 'WALLET_NOTE_REQUIRED', message: 'A note is required for an adjustment' };
  }
  return null;
}

export function cancelRefusal(reason: string | undefined): Refusal | null {
  if (!reason || reason.trim().length === 0) {
    return { code: 'CANCEL_REASON_REQUIRED', message: 'Give a reason to cancel the order' };
  }
  return null;
}

export function payRefusal(
  order: { status: string; payment_status: string; total_amount: number },
  amount: number | undefined,
): Refusal | null {
  if (order.status === 'cancelled') return { code: 'ORDER_CANCELLED', message: 'This order is cancelled' };
  if (order.payment_status !== 'unpaid') return { code: 'ORDER_ALREADY_PAID', message: 'This order is already paid' };
  if (amount !== undefined && money(amount) !== money(order.total_amount)) {
    return { code: 'PAYMENT_AMOUNT_MISMATCH', message: 'The amount must equal the order total' };
  }
  return null;
}

export function refundRefusal(order: { payment_status: string }, reason: string | undefined): Refusal | null {
  if (order.payment_status !== 'paid') return { code: 'ORDER_NOT_PAID', message: 'Only a paid order can be refunded' };
  return cancelRefusal(reason);
}

export type RefundRoute = 'wallet' | 'payment';

export function refundRoute(paidByWallet: boolean): RefundRoute {
  return paidByWallet ? 'wallet' : 'payment';
}

export function paymentStatusFor(total: number, paid: number): PaymentStatus {
  return paid >= total && total > 0 ? 'paid' : 'unpaid';
}

export interface TimeStamps {
  ready_at?: Date;
  served_at?: Date;
  cancelled_at?: Date;
}

export function stampsFor(status: OrderStatus, now: Date): TimeStamps {
  if (status === 'ready') return { ready_at: now };
  if (status === 'served') return { served_at: now };
  if (status === 'cancelled') return { cancelled_at: now };
  return {};
}

export function counterBoard<T extends { status: string; token_label: string }>(
  orders: T[],
): { preparing: string[]; ready: string[] } {
  return {
    preparing: orders
      .filter((order) => order.status === 'placed' || order.status === 'preparing')
      .map((o) => o.token_label),
    ready: orders.filter((order) => order.status === 'ready').map((order) => order.token_label),
  };
}

export function walletSpendToday(purchases: number, refunds: number): number {
  return money(Math.max(0, purchases - refunds));
}
