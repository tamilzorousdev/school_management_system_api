import { AppException } from '@app/common';

export const ID_CARD_LAYOUT_KEYS = [
  'photo',
  'qr',
  'student_name',
  'admission_no',
  'class_section',
  'roll_no',
  'dob',
  'blood_group',
  'guardian_name',
  'guardian_mobile',
  'address',
  'academic_year',
] as const;
export type IdCardLayoutKey = (typeof ID_CARD_LAYOUT_KEYS)[number];

export interface IdCardLayoutItem {
  key: IdCardLayoutKey;
  x: number;
  y: number;
  w: number;
  h: number;
  font_size: number;
  color: string;
  bold: boolean;
  align: 'left' | 'center' | 'right';
}

export interface IdCardLayout {
  front: IdCardLayoutItem[];
  back: IdCardLayoutItem[];
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const FIELD = 'id_card_layout';

function fraction(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(Math.min(1, Math.max(0, parsed)) * 10000) / 10000 : 0;
}

function item(raw: unknown): IdCardLayoutItem {
  if (typeof raw !== 'object' || raw === null) {
    throw AppException.validation([{ field: FIELD, message: 'A detail position is not valid' }]);
  }
  const value = raw as Record<string, unknown>;
  if (!ID_CARD_LAYOUT_KEYS.includes(value.key as IdCardLayoutKey)) {
    throw AppException.validation([{ field: FIELD, message: `Unknown detail ${String(value.key)}` }]);
  }
  if (value.color !== undefined && !(typeof value.color === 'string' && HEX.test(value.color))) {
    throw AppException.validation([{ field: FIELD, message: 'Text colour must look like #1A2B3C' }]);
  }
  const fontSize = Number(value.font_size);
  return {
    key: value.key as IdCardLayoutKey,
    x: fraction(value.x),
    y: fraction(value.y),
    w: Math.max(0.01, fraction(value.w)),
    h: Math.max(0.01, fraction(value.h)),
    font_size: Number.isFinite(fontSize) ? Math.min(30, Math.max(3, fontSize)) : 8,
    color: typeof value.color === 'string' ? value.color.toUpperCase() : '#111827',
    bold: value.bold === true,
    align: value.align === 'center' || value.align === 'right' ? value.align : 'left',
  };
}

function side(raw: unknown): IdCardLayoutItem[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw))
    throw AppException.validation([{ field: FIELD, message: 'Detail positions must be a list' }]);
  const seen = new Set<string>();
  return raw.map(item).filter((entry) => !seen.has(entry.key) && seen.add(entry.key));
}

export function normalizeIdCardLayout(raw: unknown): IdCardLayout {
  if (typeof raw !== 'object' || raw === null) {
    throw AppException.validation([{ field: FIELD, message: 'Detail positions are not valid' }]);
  }
  const value = raw as Record<string, unknown>;
  return { front: side(value.front), back: side(value.back) };
}

export function parseIdCardLayout(raw: unknown): IdCardLayout | null {
  if (!raw) return null;
  try {
    return normalizeIdCardLayout(raw);
  } catch {
    return null;
  }
}
