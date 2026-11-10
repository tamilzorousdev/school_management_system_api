import { BoardStatus } from './dto/staff-attendance.dto';
import { filterBoard, pageOf } from './staff-board.logic';

const row = (
  user_id: number,
  name: string,
  status: BoardStatus,
  designation = 'Teacher',
  department: string | null = null,
) => ({
  user_id,
  name,
  designation,
  department,
  status,
});

const rows = [
  row(1, 'Anitha Ramasamy', 'present', 'Secondary Grade Teacher', 'Primary'),
  row(2, 'Arun Prakash', 'not_checked_in', 'BT Assistant', 'Science'),
  row(3, 'Bhuvaneswari Kumar', 'absent', 'BT Assistant', 'Social Science'),
  row(4, 'Divya Bharathi', 'on_leave', 'Computer Instructor'),
  row(5, 'Ezhil Arasu', 'half_day'),
  row(6, 'Farook Ali', 'late'),
];

describe('staff board filter', () => {
  it('matches every search word in name, designation or department', () => {
    expect(filterBoard(rows, { search: 'bt science' }).map((item) => item.user_id)).toEqual([2, 3]);
    expect(filterBoard(rows, { search: 'ANITHA' }).map((item) => item.user_id)).toEqual([1]);
  });

  it('groups statuses the same way as the cards', () => {
    expect(filterBoard(rows, { status: 'not_checked_in' }).map((item) => item.user_id)).toEqual([2, 3]);
    expect(filterBoard(rows, { status: 'present' }).map((item) => item.user_id)).toEqual([1, 5]);
    expect(filterBoard(rows, { status: 'late' }).map((item) => item.user_id)).toEqual([6]);
  });

  it('returns everyone with no filter', () => {
    expect(filterBoard(rows, {})).toHaveLength(6);
  });
});

describe('staff board pages', () => {
  const many = Array.from({ length: 45 }, (_, index) => index + 1);

  it('cuts a page and says if there is a next one', () => {
    expect(pageOf(many, 1, 20)).toMatchObject({ page: 1, limit: 20, total_pages: 3, has_next: true });
    expect(pageOf(many, 3, 20).items).toEqual([41, 42, 43, 44, 45]);
    expect(pageOf(many, 3, 20).has_next).toBe(false);
  });

  it('falls back to the last page when the page is past the end', () => {
    expect(pageOf(many, 9, 20)).toMatchObject({ page: 3, has_next: false });
  });

  it('has one empty page for no rows', () => {
    expect(pageOf([], 1, 20)).toEqual({ items: [], page: 1, limit: 20, total_pages: 1, has_next: false });
  });
});
