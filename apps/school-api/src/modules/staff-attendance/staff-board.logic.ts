import { BoardStatus } from './dto/staff-attendance.dto';

export interface BoardRowLike {
  user_id: number;
  name: string;
  designation: string;
  department: string | null;
  status: BoardStatus;
}

export interface BoardFilter {
  search?: string;
  status?: BoardStatus;
}

export const DEFAULT_BOARD_LIMIT = 20;

const STATUS_GROUP: Partial<Record<BoardStatus, BoardStatus[]>> = {
  not_checked_in: ['not_checked_in', 'absent'],
  present: ['present', 'half_day'],
};

export function filterBoard<T extends BoardRowLike>(rows: T[], filter: BoardFilter): T[] {
  const words = (filter.search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const statuses = filter.status ? (STATUS_GROUP[filter.status] ?? [filter.status]) : null;
  return rows.filter((row) => {
    if (statuses && !statuses.includes(row.status)) return false;
    const text = [row.name, row.designation, row.department ?? ''].join(' ').toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

export function pageOf<T>(rows: T[], page = 1, limit = DEFAULT_BOARD_LIMIT) {
  const totalPages = Math.max(1, Math.ceil(rows.length / limit));
  const current = Math.min(page, totalPages);
  return {
    items: rows.slice((current - 1) * limit, current * limit),
    page: current,
    limit,
    total_pages: totalPages,
    has_next: current < totalPages,
  };
}
