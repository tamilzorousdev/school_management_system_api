import { EntityManager } from 'typeorm';
import { AppException } from '@app/common';
import { rupees } from '../payroll/payroll.calc';

export interface LibraryPending {
  books: number;
  fines: number;
}

export interface TransportPending {
  route_name: string;
  stop_name: string | null;
}

export async function feeBalance(manager: EntityManager, schoolId: number, studentId: number): Promise<number> {
  const [{ balance }]: { balance: string }[] = await manager.query(
    `SELECT coalesce(sum(balance), 0) AS balance FROM fee_invoices
     WHERE school_id = $1 AND student_id = $2 AND status <> 'cancelled' AND deleted_at IS NULL`,
    [schoolId, studentId],
  );
  return Number(balance);
}

export async function libraryPending(manager: EntityManager, studentId: number): Promise<LibraryPending> {
  const [pending]: { books: number; fines: string }[] = await manager.query(
    `SELECT
       (SELECT COUNT(*) FROM library_issues i JOIN library_members m ON m.id = i.member_id
          WHERE m.student_id = $1 AND i.status = 'issued' AND i.deleted_at IS NULL)::int AS books,
       (SELECT COALESCE(SUM(f.balance), 0) FROM library_fines f JOIN library_members m ON m.id = f.member_id
          WHERE m.student_id = $1 AND f.deleted_at IS NULL) AS fines`,
    [studentId],
  );
  return { books: Number(pending?.books ?? 0), fines: Number(pending?.fines ?? 0) };
}

export async function transportPending(
  manager: EntityManager,
  schoolId: number,
  studentId: number,
): Promise<TransportPending | null> {
  const [row]: TransportPending[] = await manager.query(
    `SELECT r.name AS route_name, s.name AS stop_name
       FROM student_transport t
       JOIN transport_routes r ON r.id = t.route_id
       LEFT JOIN route_stops s ON s.id = t.stop_id
      WHERE t.school_id = $1 AND t.student_id = $2 AND t.deleted_at IS NULL
      LIMIT 1`,
    [schoolId, studentId],
  );
  return row ?? null;
}

export function feeBlocker(balance: number): string | null {
  return balance > 0 ? `${rupees(balance)} of fees unpaid` : null;
}

export function libraryBlocker({ books, fines }: LibraryPending): string | null {
  const parts = [
    books ? `${books} library ${books === 1 ? 'book' : 'books'} not returned` : null,
    fines ? `Rs. ${fines.toFixed(2)} library fine unpaid` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' and ') : null;
}

export function transportBlocker(pending: TransportPending | null): string | null {
  if (!pending) return null;
  return pending.stop_name
    ? `On route ${pending.route_name}, stop ${pending.stop_name}`
    : `On route ${pending.route_name}`;
}

export async function assertLibraryClear(manager: EntityManager, studentId: number): Promise<void> {
  const blocker = libraryBlocker(await libraryPending(manager, studentId));
  if (blocker) throw AppException.conflict(`Clear the library first: ${blocker}`, 'LIBRARY_CLEARANCE_PENDING');
}
