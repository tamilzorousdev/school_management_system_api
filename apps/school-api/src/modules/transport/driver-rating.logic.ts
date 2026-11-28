import { RATING_TAGS, RatingTag } from './entities/driver-rating.entity';

export const LOW_RATING = 2;

export const RATING_TAG_INFO: Record<RatingTag, { label: string; positive: boolean }> = {
  safe_driving: { label: 'Safe driving', positive: true },
  on_time: { label: 'On time', positive: true },
  polite: { label: 'Polite', positive: true },
  clean_bus: { label: 'Clean bus', positive: true },
  careful_with_children: { label: 'Careful with children', positive: true },
  rash_driving: { label: 'Rash driving', positive: false },
  late: { label: 'Often late', positive: false },
  rude: { label: 'Rude', positive: false },
  uses_phone: { label: 'Uses phone while driving', positive: false },
};

export const ratingTags = () => RATING_TAGS.map((code) => ({ code, ...RATING_TAG_INFO[code] }));

export function ratingMonth(date: string): string {
  return date.slice(0, 7);
}

export function lowRatingProblem(
  rating: number,
  tags: RatingTag[],
  comment: string | null,
  lowMax: number = LOW_RATING,
): string | null {
  if (rating > lowMax) return null;
  if (comment?.trim() || tags.some((tag) => !RATING_TAG_INFO[tag].positive)) return null;
  return 'Tell us what went wrong: pick a reason or write a few words';
}

export function ratingStats(ratings: number[]) {
  const distribution = [1, 2, 3, 4, 5].map((star) => ratings.filter((rating) => rating === star).length);
  const average = ratings.length
    ? Math.round((ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length) * 10) / 10
    : null;
  return { average, count: ratings.length, distribution };
}

export function topTags(tagLists: RatingTag[][], limit = 3) {
  const counts = new Map<RatingTag, number>();
  tagLists.flat().forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || RATING_TAGS.indexOf(a[0]) - RATING_TAGS.indexOf(b[0]))
    .slice(0, limit)
    .map(([code, count]) => ({
      code,
      label: RATING_TAG_INFO[code].label,
      positive: RATING_TAG_INFO[code].positive,
      count,
    }));
}

export interface RatedDriverRow {
  driver: { name: string };
  vehicle: { name: string; registration_no: string } | null;
  needs_attention: boolean;
}

export function filterRatedDrivers<T extends RatedDriverRow>(
  rows: T[],
  search: string | undefined,
  needsAttention: boolean | undefined,
): T[] {
  const words = (search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    if (needsAttention && !row.needs_attention) return false;
    const text = [row.driver.name, row.vehicle?.name, row.vehicle?.registration_no].join(' ').toLowerCase();
    return words.every((word) => text.includes(word));
  });
}
