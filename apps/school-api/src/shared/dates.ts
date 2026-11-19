import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches, ValidateIf } from 'class-validator';

const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function IsDateOnly(example = '2026-06-01', optional = false) {
  const property = optional
    ? ApiPropertyOptional({ example, format: 'date' })
    : ApiProperty({ example, format: 'date' });
  return applyDecorators(
    property,
    ...(optional ? [IsOptional()] : []),
    Matches(DATE_PATTERN, { message: '$property must be a date in YYYY-MM-DD format' }),
  );
}

export function IsNullableDate(example = '2026-06-01') {
  return applyDecorators(
    ApiPropertyOptional({ example, format: 'date', nullable: true, type: String }),
    IsOptional(),
    ValidateIf((_object, value) => value !== null),
    Matches(DATE_PATTERN, { message: '$property must be a date in YYYY-MM-DD format' }),
  );
}

export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function monthStartIn(timeZone: string, now = new Date()): string {
  return `${todayIn(timeZone, now).slice(0, 8)}01`;
}

export function yearsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  let years = ty - fy;
  if (tm < fm || (tm === fm && td < fd)) years -= 1;
  return Math.max(0, years);
}
