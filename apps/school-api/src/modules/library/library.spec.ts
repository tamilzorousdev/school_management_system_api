import { parseBookRow } from './book-import';
import {
  accessionNumber,
  bookLimit,
  cardNumber,
  chargeableDays,
  DEFAULT_RULES,
  dueDateFor,
  fineAmounts,
  fineStatus,
  issueRefusal,
  IssueCheck,
  loanState,
  lostFine,
  normalizeIsbn,
  overdueFine,
  reminderKind,
  renewRefusal,
} from './library.logic';

const okCheck: IssueCheck = {
  member_status: 'active',
  person_active: true,
  open_loans: 0,
  limit: 2,
  unpaid_fines: 0,
  block_above: 50,
  copy_status: 'available',
  is_reference: false,
  holds_same_title: false,
  basket_size: 1,
};

describe('library due dates and fines', () => {
  it('moves a due date off a Sunday and a holiday', () => {
    expect(dueDateFor('2026-11-01', 14, true, new Set())).toBe('2026-11-16');
    expect(dueDateFor('2026-11-01', 7, true, new Set())).toBe('2026-11-09');
    expect(dueDateFor('2026-11-01', 7, true, new Set(['2026-11-09']))).toBe('2026-11-10');
    expect(dueDateFor('2026-11-01', 7, false, new Set())).toBe('2026-11-08');
  });

  it('counts late days after the grace days, skipping Sundays and holidays', () => {
    expect(chargeableDays('2026-11-10', '2026-11-10', 0, true, new Set())).toBe(0);
    expect(chargeableDays('2026-11-10', '2026-11-13', 0, true, new Set())).toBe(3);
    expect(chargeableDays('2026-11-10', '2026-11-13', 3, true, new Set())).toBe(0);
    expect(chargeableDays('2026-11-10', '2026-11-16', 0, true, new Set())).toBe(5);
    expect(chargeableDays('2026-11-10', '2026-11-16', 0, false, new Set())).toBe(6);
    expect(chargeableDays('2026-11-10', '2026-11-16', 2, true, new Set(['2026-11-14']))).toBe(2);
  });

  it('caps the overdue fine and prices a lost book', () => {
    expect(overdueFine(6, 1, 100)).toBe(6);
    expect(overdueFine(300, 1, 100)).toBe(100);
    expect(overdueFine(300, 2, null)).toBe(600);
    expect(lostFine(250, 50)).toBe(300);
    expect(lostFine(null, 50)).toBe(50);
  });

  it('works out the fine status and balance', () => {
    expect(fineStatus(10, 0, 0)).toBe('unpaid');
    expect(fineStatus(10, 0, 4)).toBe('partly_paid');
    expect(fineStatus(10, 0, 10)).toBe('paid');
    expect(fineStatus(10, 10, 0)).toBe('waived');
    expect(fineStatus(10, 4, 6)).toBe('paid');
    expect(fineAmounts(10, 3, 2)).toEqual({ amount: 10, waived: 3, paid: 2, balance: 5, status: 'partly_paid' });
  });
});

describe('library loan rules', () => {
  it('names the loan state from the due date', () => {
    expect(loanState({ status: 'issued', due_date: '2026-11-30' }, '2026-11-18', 2)).toBe('on_loan');
    expect(loanState({ status: 'issued', due_date: '2026-11-20' }, '2026-11-18', 2)).toBe('due_soon');
    expect(loanState({ status: 'issued', due_date: '2026-11-18' }, '2026-11-18', 2)).toBe('due_today');
    expect(loanState({ status: 'issued', due_date: '2026-11-17' }, '2026-11-18', 2)).toBe('overdue');
    expect(loanState({ status: 'returned', due_date: '2026-11-17' }, '2026-11-18', 2)).toBe('returned');
  });

  it('refuses issues for the right reason', () => {
    expect(issueRefusal(okCheck)).toBeNull();
    expect(issueRefusal({ ...okCheck, member_status: 'suspended' })?.code).toBe('MEMBER_NOT_ACTIVE');
    expect(issueRefusal({ ...okCheck, copy_status: 'issued' })?.code).toBe('COPY_NOT_AVAILABLE');
    expect(issueRefusal({ ...okCheck, is_reference: true })?.code).toBe('REFERENCE_ONLY');
    expect(issueRefusal({ ...okCheck, holds_same_title: true })?.code).toBe('SAME_TITLE_HELD');
    expect(issueRefusal({ ...okCheck, open_loans: 1, basket_size: 2 })?.code).toBe('BOOK_LIMIT_REACHED');
    expect(issueRefusal({ ...okCheck, unpaid_fines: 60 })?.code).toBe('FINE_PENDING');
    expect(issueRefusal({ ...okCheck, unpaid_fines: 60, block_above: 0 })).toBeNull();
  });

  it('allows a renewal only while the loan is in time and under the limit', () => {
    const rules = { max_renewals: 1, grace_days: 0 };
    expect(renewRefusal({ status: 'issued', due_date: '2026-11-20', renew_count: 0 }, '2026-11-18', rules)).toBeNull();
    expect(renewRefusal({ status: 'issued', due_date: '2026-11-20', renew_count: 1 }, '2026-11-18', rules)?.code).toBe(
      'RENEW_LIMIT_REACHED',
    );
    expect(renewRefusal({ status: 'issued', due_date: '2026-11-10', renew_count: 0 }, '2026-11-18', rules)?.code).toBe(
      'LOAN_OVERDUE',
    );
    expect(
      renewRefusal({ status: 'returned', due_date: '2026-11-20', renew_count: 0 }, '2026-11-18', rules)?.code,
    ).toBe('LOAN_CLOSED');
  });

  it('uses member overrides for limits', () => {
    expect(bookLimit(DEFAULT_RULES, 'student', null)).toBe(2);
    expect(bookLimit(DEFAULT_RULES, 'staff', null)).toBe(5);
    expect(bookLimit(DEFAULT_RULES, 'student', 0)).toBe(0);
    expect(bookLimit(DEFAULT_RULES, 'student', 4)).toBe(4);
  });

  it('walks the reminder ladder', () => {
    const rules = { due_soon_days: 2, escalate_after_days: 7, long_overdue_days: 30 };
    expect(reminderKind('2026-11-25', '2026-11-18', rules)).toBeNull();
    expect(reminderKind('2026-11-20', '2026-11-18', rules)).toBe('due_soon');
    expect(reminderKind('2026-11-18', '2026-11-18', rules)).toBe('due_today');
    expect(reminderKind('2026-11-15', '2026-11-18', rules)).toBe('overdue');
    expect(reminderKind('2026-11-11', '2026-11-18', rules)).toBe('escalated');
    expect(reminderKind('2026-11-04', '2026-11-18', rules)).toBe('escalated_w1');
    expect(reminderKind('2026-10-18', '2026-11-18', rules)).toBe('long_overdue');
  });
});

describe('library codes and import rows', () => {
  it('reads ISBN-10 and ISBN-13 barcodes', () => {
    expect(normalizeIsbn('978-81-7371-146-6')).toBe('9788173711466');
    expect(normalizeIsbn('8173711461')).toBe('9788173711466');
    expect(normalizeIsbn('9788173711467')).toBeNull();
    expect(normalizeIsbn('8901234567893')).toBeNull();
    expect(normalizeIsbn('hello')).toBeNull();
  });

  it('formats accession and card numbers', () => {
    expect(accessionNumber('TZMS', 42)).toBe('TZMS-000042');
    expect(cardNumber('TZMS', 'student', 7)).toBe('TZMS-LS-00007');
    expect(cardNumber('TZMS', 'staff', 7)).toBe('TZMS-LT-00007');
  });

  it('checks an import row', () => {
    const good = parseBookRow(2, {
      title: 'Wings of Fire',
      isbn: '9788173711466',
      copies: '2',
      barcodes: 'BC001|BC002',
    });
    expect(good.error).toBeNull();
    expect(good.parsed).toMatchObject({
      isbn: '9788173711466',
      copies: 2,
      barcodes: ['BC001', 'BC002'],
      language: 'English',
    });
    expect(parseBookRow(3, { title: '', isbn: '123' }).error).toContain('Title is required');
    expect(parseBookRow(4, { title: 'X', copies: '1', barcodes: 'BC001|BC002' }).error).toContain('More barcodes');
    expect(parseBookRow(5, { title: 'X', source: 'gift' }).error).toContain('Source');
    expect(parseBookRow(6, { title: 'X', acquired_on: '10-06-2026' }).parsed?.acquired_on).toBe('2026-06-10');
  });
});
