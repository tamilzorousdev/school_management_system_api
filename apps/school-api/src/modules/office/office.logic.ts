export const UNLIMITED_ROLES = ['SUPER_ADMIN', 'ADMIN', 'PRINCIPAL'];
export const AO_ROLE = 'AO';

export interface WingShape {
  id: number;
  name: string;
  from_grade: number;
  to_grade: number;
  class_ids: number[] | null;
}

export interface ClassShape {
  id: number;
  name: string;
  grade_level: number;
}

export interface WingSpan {
  valid_from: string | null;
  valid_to: string | null;
}

export function isWingLimitedRole(roles: string[]): boolean {
  return roles.includes(AO_ROLE) && !roles.some((role) => UNLIMITED_ROLES.includes(role));
}

export function classInWing(schoolClass: ClassShape, wing: WingShape): boolean {
  if (wing.class_ids?.length) return wing.class_ids.includes(schoolClass.id);
  return schoolClass.grade_level >= wing.from_grade && schoolClass.grade_level <= wing.to_grade;
}

export function classesOfWing(wing: WingShape, classes: ClassShape[]): ClassShape[] {
  return classes.filter((schoolClass) => classInWing(schoolClass, wing));
}

export function wingOfClass(schoolClass: ClassShape, wings: WingShape[]): WingShape | null {
  return wings.find((wing) => classInWing(schoolClass, wing)) ?? null;
}

export function overlapError(wings: WingShape[], classes: ClassShape[]): string | null {
  const owner = new Map<number, string>();
  for (const wing of wings) {
    for (const schoolClass of classesOfWing(wing, classes)) {
      const taken = owner.get(schoolClass.id);
      if (taken) return `Class ${schoolClass.name} is already in ${taken}; a class can be in one wing only`;
      owner.set(schoolClass.id, wing.name);
    }
  }
  return null;
}

export function spanActive(span: WingSpan, today: string): boolean {
  return (!span.valid_from || span.valid_from <= today) && (!span.valid_to || span.valid_to >= today);
}

export function gradeName(grade: number): string {
  if (grade === -1) return 'LKG';
  if (grade === 0) return 'UKG';
  if (grade < -1) return 'Pre-KG';
  return String(grade);
}

export function rangeLabel(
  wing: Pick<WingShape, 'from_grade' | 'to_grade' | 'class_ids'>,
  classNames?: string[],
): string {
  if (wing.class_ids?.length && classNames) return classNames.join(', ');
  const from = gradeName(wing.from_grade);
  const to = gradeName(wing.to_grade);
  const prefix = wing.from_grade >= 1 ? 'Classes ' : '';
  return from === to ? (wing.from_grade >= 1 ? `Class ${from}` : from) : `${prefix}${from} – ${to}`;
}

export function percent(part: number, total: number): number | null {
  if (!total) return null;
  return Math.round((part / total) * 1000) / 10;
}

export function hoursSince(from: Date | string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(from).getTime()) / 3600000));
}

export const EMPTY_NOTES = ['', 'none', 'nil', 'na', 'n/a', '-', 'no', 'nothing'];

export function hasNote(text: string | null | undefined): boolean {
  return !EMPTY_NOTES.includes((text ?? '').trim().toLowerCase());
}

export const OVERDUE_HOURS = 24;

export function isOverdue(from: Date | string, now: Date, hours = OVERDUE_HOURS): boolean {
  return now.getTime() - new Date(from).getTime() >= hours * 3600000;
}

export function inactiveFor(lastActive: Date | string | null, now: Date, days = 2): boolean {
  if (!lastActive) return true;
  return now.getTime() - new Date(lastActive).getTime() >= days * 86400000;
}
