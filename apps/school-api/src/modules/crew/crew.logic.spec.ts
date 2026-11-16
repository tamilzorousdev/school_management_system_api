import { selfAlertThreshold } from '../transport/transport.logic';
import {
  CrewDates,
  crewChecks,
  CrewDocumentRef,
  dateProblems,
  dueChecks,
  dutyStatus,
  earliestExpiry,
  reminderText,
} from './crew.logic';

const TODAY = '2026-11-16';

const validDates: CrewDates = {
  licence_expiry: '2029-08-14',
  badge_expiry: '2027-08-14',
  medical_fitness_expiry: '2027-03-31',
  police_verification_expiry: '2028-04-09',
};

const doc = (id: number, type: string, status: CrewDocumentRef['status'], day = 1): CrewDocumentRef => ({
  id,
  type,
  status,
  created_at: new Date(`2026-11-0${day}T10:00:00Z`),
});

const allVerified = [
  doc(1, 'driving_licence', 'verified'),
  doc(2, 'psv_badge', 'verified'),
  doc(3, 'medical_fitness', 'verified'),
  doc(4, 'police_verification', 'verified'),
];

describe('crew checks', () => {
  it('asks drivers for four checks and attendants for two', () => {
    expect(crewChecks('driver', validDates, allVerified, TODAY).map((check) => check.kind)).toEqual([
      'licence',
      'badge',
      'medical',
      'police',
    ]);
    expect(crewChecks('attendant', validDates, allVerified, TODAY).map((check) => check.kind)).toEqual([
      'medical',
      'police',
    ]);
  });

  it('is clear when every document is verified and in date', () => {
    expect(crewChecks('driver', validDates, allVerified, TODAY).every((check) => check.clear)).toBe(true);
  });

  it('explains what is wrong with each check', () => {
    const checks = crewChecks(
      'driver',
      { ...validDates, badge_expiry: null, police_verification_expiry: '2026-11-01' },
      [
        doc(1, 'driving_licence', 'pending'),
        doc(3, 'medical_fitness', 'rejected'),
        doc(2, 'psv_badge', 'verified'),
        doc(4, 'police_verification', 'verified'),
      ],
      TODAY,
    );
    expect(checks.map((check) => check.problem)).toEqual([
      'Waiting for verification',
      'Add the expiry date',
      'Document rejected',
      'Expired',
    ]);
  });

  it('uses the newest document of each type', () => {
    const checks = crewChecks(
      'attendant',
      validDates,
      [
        doc(3, 'medical_fitness', 'verified', 1),
        doc(9, 'medical_fitness', 'pending', 5),
        doc(4, 'police_verification', 'verified'),
      ],
      TODAY,
    );
    expect(checks[0]).toMatchObject({ document_id: 9, document_status: 'pending', clear: false });
  });

  it('reports a missing document', () => {
    const checks = crewChecks('attendant', validDates, [], TODAY);
    expect(checks.map((check) => check.document_status)).toEqual(['missing', 'missing']);
  });
});

describe('duty status', () => {
  const clear = crewChecks('driver', validDates, allVerified, TODAY);
  const expired = crewChecks('driver', { ...validDates, licence_expiry: '2026-11-10' }, allVerified, TODAY);

  it('is pending until approved', () => {
    expect(dutyStatus(null, clear)).toBe('pending');
  });

  it('is approved while every check stays clear', () => {
    expect(dutyStatus(new Date(), clear)).toBe('approved');
  });

  it('blocks an approved driver when a date passes', () => {
    expect(dutyStatus(new Date(), expired)).toBe('blocked');
  });
});

describe('expiry helpers', () => {
  it('finds the earliest date', () => {
    expect(earliestExpiry(crewChecks('driver', validDates, allVerified, TODAY))).toBe('2027-03-31');
  });

  it('lists only expired and due-soon checks for a reminder', () => {
    const checks = crewChecks(
      'driver',
      { ...validDates, medical_fitness_expiry: '2026-11-23', police_verification_expiry: '2026-11-10' },
      allVerified,
      TODAY,
    );
    const due = dueChecks(checks);
    expect(due.map((check) => check.kind)).toEqual(['medical', 'police']);
    expect(reminderText(due)).toBe('Medical fitness ends on 23-11-2026, Police verification expired on 10-11-2026');
  });

  it('sends the driver reminders only at 7, 1 and 0 days', () => {
    expect(selfAlertThreshold(20)).toBeNull();
    expect(selfAlertThreshold(7)).toBe(7);
    expect(selfAlertThreshold(3)).toBe(7);
    expect(selfAlertThreshold(1)).toBe(1);
    expect(selfAlertThreshold(-2)).toBe(0);
  });
});

describe('date rules', () => {
  const base = { ...validDates, licence_issued_on: null, police_verified_on: null };

  it('accepts sensible dates', () => {
    expect(dateProblems({ ...base, licence_issued_on: '2015-08-15', police_verified_on: '2026-04-10' }, TODAY)).toEqual(
      [],
    );
  });

  it('refuses future issue dates and expiry before issue', () => {
    expect(
      dateProblems({ ...base, licence_issued_on: '2030-01-01', police_verified_on: '2028-05-01' }, TODAY).map(
        (problem) => problem.field,
      ),
    ).toEqual(['licence_issued_on', 'licence_expiry', 'police_verified_on', 'police_verification_expiry']);
  });
});
