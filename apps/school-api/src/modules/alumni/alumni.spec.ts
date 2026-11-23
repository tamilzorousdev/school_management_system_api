import {
  alumniNumber,
  allowedFields,
  batchYearOf,
  diffFields,
  finalGradeLevel,
  hashToken,
  isReachable,
  linkExpiry,
  linkUsable,
  MAX_PENDING_PER_MOBILE,
  MAX_PUBLIC_PER_HOUR,
  pickFields,
  SELF_UPDATE_FIELDS,
  submissionBlock,
} from './alumni.logic';
import { assertBatchYear } from './dto/alumni.dto';

describe('alumni numbers and batches', () => {
  it('takes the batch from the leaving date', () => {
    expect(batchYearOf('2026-03-31')).toBe(2026);
  });

  it('builds a padded alumni number per school and batch', () => {
    expect(alumniNumber('TZS', 2026, 7)).toBe('TZS-AL-2026-0007');
    expect(alumniNumber('TZS', 2019, 12345)).toBe('TZS-AL-2019-12345');
  });

  it('refuses a batch in the future', () => {
    expect(assertBatchYear(new Date().getFullYear() + 1)).toMatch(/cannot be after/);
    expect(assertBatchYear(2019)).toBeNull();
    expect(assertBatchYear(undefined)).toBeNull();
  });
});

describe('final class', () => {
  it('is the class with the highest grade level', () => {
    expect(finalGradeLevel([{ grade_level: 10 }, { grade_level: 12 }, { grade_level: 11 }])).toBe(12);
  });

  it('is missing when no class has a grade level', () => {
    expect(finalGradeLevel([])).toBeNull();
    expect(finalGradeLevel([{ grade_level: null }])).toBeNull();
  });
});

describe('change history', () => {
  const row = { city: 'Madurai', mobile: '9876543210', final_percent: '86.40', notes: null, contact_consent: false };

  it('records only fields that really changed', () => {
    expect(diffFields(row, { city: 'Chennai', mobile: '9876543210' })).toEqual({ city: ['Madurai', 'Chennai'] });
  });

  it('treats numeric strings and numbers as equal', () => {
    expect(diffFields(row, { final_percent: 86.4 })).toEqual({});
    expect(diffFields(row, { final_percent: 90 })).toEqual({ final_percent: ['86.40', 90] });
  });

  it('treats empty text and null as the same, but notices a value being cleared', () => {
    expect(diffFields(row, { notes: '' })).toEqual({});
    expect(diffFields(row, { city: null })).toEqual({ city: ['Madurai', null] });
  });

  it('notices booleans flipping', () => {
    expect(diffFields(row, { contact_consent: true })).toEqual({ contact_consent: [false, true] });
  });

  it('ignores fields that were not sent', () => {
    expect(diffFields(row, { city: undefined })).toEqual({});
  });
});

describe('self-service', () => {
  it('lets an update touch only contact and career details', () => {
    const picked = pickFields(
      { city: 'Chennai', notes: 'internal', batch_year: 2001, final_percent: 99, first_name: 'X' },
      allowedFields('update'),
    );
    expect(picked).toEqual({ city: 'Chennai' });
  });

  it('lets a registration carry identity details but never staff notes or results', () => {
    const picked = pickFields(
      { first_name: 'Priya', batch_year: 2019, notes: 'internal', final_percent: 99, mobile: '9876543210' },
      allowedFields('registration'),
    );
    expect(picked).toEqual({ first_name: 'Priya', batch_year: 2019, mobile: '9876543210' });
  });

  it('keeps the update fields free of anything staff own', () => {
    for (const field of ['notes', 'final_percent', 'batch_year', 'status', 'student_id']) {
      expect(SELF_UPDATE_FIELDS as readonly string[]).not.toContain(field);
    }
  });

  it('stores links as a hash and expires them after 14 days', () => {
    expect(hashToken('abc')).toHaveLength(64);
    expect(hashToken('abc')).not.toBe('abc');
    const now = new Date('2026-11-23T10:00:00Z');
    const expires = linkExpiry(now);
    expect(expires.toISOString()).toBe('2026-12-07T10:00:00.000Z');
    expect(linkUsable({ expires_at: expires, used_at: null }, now)).toBe(true);
    expect(linkUsable({ expires_at: expires, used_at: now }, now)).toBe(false);
    expect(linkUsable({ expires_at: expires, used_at: null }, new Date('2026-12-08T00:00:00Z'))).toBe(false);
  });

  it('limits floods per school and repeat submissions per mobile', () => {
    expect(submissionBlock(0, 0)).toBeNull();
    expect(submissionBlock(MAX_PENDING_PER_MOBILE, 0)).toBe('SUBMISSION_PENDING');
    expect(submissionBlock(0, MAX_PUBLIC_PER_HOUR)).toBe('TOO_MANY_SUBMISSIONS');
  });

  it('counts an alumnus as reachable only with consent and a way to reach them', () => {
    expect(isReachable({ mobile: '9876543210', email: null, contact_consent: true })).toBe(true);
    expect(isReachable({ mobile: '9876543210', email: null, contact_consent: false })).toBe(false);
    expect(isReachable({ mobile: null, email: null, contact_consent: true })).toBe(false);
  });
});
