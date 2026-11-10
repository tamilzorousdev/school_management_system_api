export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const lastYear = Number(to.slice(0, 4));
  const lastMonth = Number(to.slice(5, 7));
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

export function clampRange(
  from: string,
  to: string,
  limitFrom: string,
  limitTo: string,
): { from: string; to: string } | null {
  const start = from > limitFrom ? from : limitFrom;
  const end = to < limitTo ? to : limitTo;
  return start <= end ? { from: start, to: end } : null;
}
