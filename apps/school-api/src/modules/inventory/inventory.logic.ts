import { AssetStatus } from './entities/asset.entity';
import { DepreciationMethod } from './entities/master.entity';
import { RequisitionStatus } from './entities/operations.entity';

export interface Refusal {
  code: string;
  message: string;
}

export const round2 = (value: number): number => Math.round(value * 100) / 100;

export function yearsBetween(from: string, to: string): number {
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
  return Math.max(0, days / 365.25);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

export interface DepreciationInput {
  cost: number | null;
  residual_value: number | null;
  purchase_date: string | null;
  rate: number | null;
  useful_life_years: number | null;
  method: DepreciationMethod;
}

export function annualRate(input: Pick<DepreciationInput, 'rate' | 'useful_life_years'>): number {
  if (input.rate && input.rate > 0) return input.rate / 100;
  if (input.useful_life_years && input.useful_life_years > 0) return 1 / input.useful_life_years;
  return 0;
}

export function bookValue(input: DepreciationInput, on: string): number | null {
  if (input.cost === null || input.cost === undefined) return null;
  const cost = Number(input.cost);
  const floor = Math.max(0, Number(input.residual_value ?? 0));
  const rate = annualRate(input);
  if (!input.purchase_date || rate <= 0) return round2(cost);
  const years = yearsBetween(input.purchase_date, on);
  const value =
    input.method === 'written_down' ? cost * Math.pow(1 - Math.min(rate, 1), years) : cost - cost * rate * years;
  return round2(Math.max(floor, Math.min(cost, value)));
}

export function depreciationForYear(input: DepreciationInput, from: string, to: string): number {
  const start = bookValue(input, from);
  const end = bookValue(input, to);
  if (start === null || end === null) return 0;
  return round2(Math.max(0, start - end));
}

export function allocationRefusal(status: AssetStatus): Refusal | null {
  if (status === 'allocated')
    return { code: 'ASSET_ALLOCATED', message: 'This asset is already allocated. Return or transfer it.' };
  if (status === 'in_maintenance') return { code: 'ASSET_IN_MAINTENANCE', message: 'This asset is under maintenance' };
  if (status === 'lost') return { code: 'ASSET_LOST', message: 'This asset is marked lost' };
  if (status === 'disposed') return { code: 'ASSET_DISPOSED', message: 'This asset has been disposed' };
  return null;
}

export function transferRefusal(status: AssetStatus): Refusal | null {
  if (status === 'lost') return { code: 'ASSET_LOST', message: 'This asset is marked lost' };
  if (status === 'disposed') return { code: 'ASSET_DISPOSED', message: 'This asset has been disposed' };
  return null;
}

export function maintenanceRefusal(status: AssetStatus): Refusal | null {
  if (status === 'lost') return { code: 'ASSET_LOST', message: 'This asset is marked lost' };
  if (status === 'disposed') return { code: 'ASSET_DISPOSED', message: 'This asset has been disposed' };
  return null;
}

export function disposalRefusal(status: AssetStatus): Refusal | null {
  if (status === 'disposed') return { code: 'ASSET_DISPOSED', message: 'This asset has already been disposed' };
  if (status === 'allocated') {
    return { code: 'ASSET_ALLOCATED', message: 'Get the asset back (return it) before disposing of it' };
  }
  return null;
}

export interface StockPosition {
  quantity: number;
  value: number;
}

export function averageRate(position: StockPosition): number {
  return position.quantity > 0 ? round2(position.value / position.quantity) : 0;
}

export function receive(position: StockPosition, quantity: number, rate: number): StockPosition {
  return { quantity: round2(position.quantity + quantity), value: round2(position.value + quantity * rate) };
}

export function withdraw(
  position: StockPosition,
  quantity: number,
): { position: StockPosition; rate: number; value: number } {
  const rate = averageRate(position);
  const remaining = round2(position.quantity - quantity);
  const value = remaining <= 0 ? position.value : round2(quantity * rate);
  return { position: { quantity: remaining, value: remaining <= 0 ? 0 : round2(position.value - value) }, rate, value };
}

export function stockRefusal(available: number, wanted: number, itemName: string): Refusal | null {
  if (wanted <= 0) return { code: 'INVALID_QUANTITY', message: `Enter a quantity for ${itemName}` };
  if (wanted > available) {
    return {
      code: 'NOT_ENOUGH_STOCK',
      message: `Only ${available} of ${itemName} in the store; ${wanted} asked`,
    };
  }
  return null;
}

export function requisitionStatusAfterIssue(lines: { approved: number; issued: number }[]): RequisitionStatus {
  const allDone = lines.every((line) => line.issued >= line.approved);
  const anyIssued = lines.some((line) => line.issued > 0);
  if (allDone) return 'issued';
  return anyIssued ? 'partly_issued' : 'approved';
}

export function nextDueDate(from: string, intervalDays: number): string {
  const date = new Date(`${from}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Math.max(1, intervalDays));
  return date.toISOString().slice(0, 10);
}

export function assetTag(schoolCode: string, value: number): string {
  return `${schoolCode}-AST-${String(value).padStart(6, '0')}`;
}

export function documentNumber(schoolCode: string, kind: string, year: string, value: number): string {
  return `${schoolCode}-${kind}-${year}-${String(value).padStart(4, '0')}`;
}

export function codeFrom(name: string, fallback = 'X'): string {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return fallback;
  if (words.length === 1) return words[0]!.slice(0, 6);
  return words
    .map((word) => word[0])
    .join('')
    .slice(0, 6);
}
