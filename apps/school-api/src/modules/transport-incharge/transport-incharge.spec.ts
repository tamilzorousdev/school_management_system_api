import { CREW_ROLES, nextStatus } from '../staff-leave/staff-leave.service';
import { ExpiryDto } from '../transport/dto/transport.dto';
import { paperCounts } from './transport-incharge.logic';

const paper = (days_left: number): ExpiryDto =>
  ({
    kind: 'insurance',
    label: 'Insurance',
    subject: 'Bus 1',
    ref_id: 1,
    vehicle_id: 1,
    staff_id: null,
    date: '2026-12-01',
    days_left,
  }) as ExpiryDto;

describe('transport in-charge papers', () => {
  it('counts expired and due soon, most urgent first', () => {
    const result = paperCounts([paper(12), paper(-3), paper(0), paper(-10)]);
    expect(result.expired).toBe(2);
    expect(result.due_soon).toBe(2);
    expect(result.items.map((item) => item.days_left)).toEqual([-10, -3, 0, 12]);
  });
});

describe('crew leave', () => {
  it('treats drivers and attendants as bus crew', () => {
    expect(CREW_ROLES).toEqual(['DRIVER', 'ATTENDANT']);
  });

  it('a final approver approves a waiting request in one step', () => {
    expect(nextStatus('pending_hod', 'approved', true)).toBe('approved');
    expect(nextStatus('pending_hod', 'approved', false)).toBe('pending_principal');
    expect(nextStatus('pending_hod', 'rejected', true)).toBe('rejected');
  });
});
