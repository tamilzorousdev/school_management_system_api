import { ExpiryDto } from '../transport/dto/transport.dto';

const MOST_URGENT = 10;

export function paperCounts(items: ExpiryDto[]) {
  const sorted = [...items].sort((a, b) => a.days_left - b.days_left);
  return {
    expired: items.filter((item) => item.days_left < 0).length,
    due_soon: items.filter((item) => item.days_left >= 0).length,
    items: sorted.slice(0, MOST_URGENT),
  };
}
