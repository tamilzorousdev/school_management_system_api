import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PassRequestDto } from './dto/gate.dto';
import {
  blockedMatch,
  codeLocked,
  collectorError,
  isLateFor,
  newCode,
  passVerdict,
  readGateQr,
  serialNo,
  signGateQr,
  visitVerdict,
} from './gate.logic';

const approved = {
  status: 'approved' as const,
  pass_date: '2026-11-19',
  from_time: '11:00',
  until_time: '13:00',
  needs_consent: false,
  consent_status: null,
  consent_verified_at: null,
};

describe('gate QR', () => {
  it('reads back what it signed', () => {
    const token = signGateQr('secret', 'p', 42, 1);
    expect(token.startsWith('TZG1.p.42.1.')).toBe(true);
    expect(readGateQr('secret', token)).toEqual({ kind: 'p', id: 42, version: 1 });
  });

  it('refuses edited, foreign and wrong-key codes', () => {
    const token = signGateQr('secret', 'v', 7, 1);
    expect(readGateQr('secret', token.replace('.7.', '.8.'))).toBeNull();
    expect(readGateQr('other', token)).toBeNull();
    expect(readGateQr('secret', 'TZS1.7.1.abc')).toBeNull();
    expect(readGateQr('secret', 'hello')).toBeNull();
  });
});

describe('passVerdict', () => {
  it('is ok inside the window, with grace either side', () => {
    expect(passVerdict(approved, '2026-11-19', '11:40', 30, false)).toBe('ok');
    expect(passVerdict(approved, '2026-11-19', '10:35', 30, false)).toBe('ok');
    expect(passVerdict(approved, '2026-11-19', '13:25', 30, false)).toBe('ok');
  });

  it('refuses outside the window or on another day', () => {
    expect(passVerdict(approved, '2026-11-19', '10:20', 30, false)).toBe('too_early');
    expect(passVerdict(approved, '2026-11-19', '13:40', 30, false)).toBe('expired');
    expect(passVerdict(approved, '2026-11-20', '11:00', 30, false)).toBe('expired');
    expect(passVerdict(approved, '2026-11-18', '11:00', 30, false)).toBe('not_today');
  });

  it('refuses used, cancelled, rejected and pending passes', () => {
    expect(passVerdict({ ...approved, status: 'released' }, '2026-11-19', '11:40', 30, false)).toBe('used');
    expect(passVerdict({ ...approved, status: 'cancelled' }, '2026-11-19', '11:40', 30, false)).toBe('cancelled');
    expect(passVerdict({ ...approved, status: 'rejected' }, '2026-11-19', '11:40', 30, false)).toBe('rejected');
    expect(passVerdict({ ...approved, status: 'pending' }, '2026-11-19', '11:40', 30, false)).toBe('not_approved');
  });

  it('needs the parent code for someone not registered, and a present student', () => {
    const other = { ...approved, needs_consent: true, consent_status: 'approved' as const };
    expect(passVerdict(other, '2026-11-19', '11:40', 30, false)).toBe('consent_needed');
    expect(passVerdict({ ...other, consent_verified_at: new Date() }, '2026-11-19', '11:40', 30, false)).toBe('ok');
    expect(passVerdict(approved, '2026-11-19', '11:40', 30, true)).toBe('student_absent');
  });
});

describe('visitVerdict', () => {
  it('lets expected or allowed visitors in and inside ones out', () => {
    expect(visitVerdict({ status: 'expected', visit_date: '2026-11-19' }, '2026-11-19')).toBe('ok_in');
    expect(visitVerdict({ status: 'allowed', visit_date: '2026-11-19' }, '2026-11-19')).toBe('ok_in');
    expect(visitVerdict({ status: 'inside', visit_date: '2026-11-18' }, '2026-11-19')).toBe('ok_out');
    expect(visitVerdict({ status: 'waiting', visit_date: '2026-11-19' }, '2026-11-19')).toBe('waiting');
    expect(visitVerdict({ status: 'expected', visit_date: '2026-11-20' }, '2026-11-19')).toBe('not_today');
    expect(visitVerdict({ status: 'left', visit_date: '2026-11-19' }, '2026-11-19')).toBe('left');
  });

  it('knows when a visitor stays too long', () => {
    expect(isLateFor({ status: 'inside', expected_until: '12:00' }, '12:10', '18:00')).toBe(true);
    expect(isLateFor({ status: 'inside', expected_until: null }, '12:10', '18:00')).toBe(false);
    expect(isLateFor({ status: 'left', expected_until: '12:00' }, '12:10', '18:00')).toBe(false);
  });
});

describe('helpers', () => {
  it('matches the blocked list by mobile or name', () => {
    const blocks = [{ name: 'Ravi  Kumar', mobile: '+91 98765 43210' }];
    expect(blockedMatch({ name: 'Someone', mobile: '9876543210' }, blocks)).not.toBeNull();
    expect(blockedMatch({ name: 'ravi kumar', mobile: '9000000000' }, blocks)).not.toBeNull();
    expect(blockedMatch({ name: 'Ravi', mobile: '9000000000' }, blocks)).toBeNull();
  });

  it('makes 4-digit codes that are free today', () => {
    const taken = new Set(['0001', '0002']);
    const code = newCode(taken);
    expect(code).toMatch(/^\d{4}$/);
    expect(taken.has(code)).toBe(false);
  });

  it('numbers passes and locks after 5 wrong codes in 10 minutes', () => {
    expect(serialNo('GP', 2026, 7)).toBe('GP-2026-0007');
    const now = Date.now();
    expect(codeLocked([now, now, now, now], now)).toBe(false);
    expect(codeLocked([now, now, now, now, now], now)).toBe(true);
    expect(codeLocked([0, 0, 0, 0, 0], now)).toBe(false);
  });
});

describe('collector rule', () => {
  const base = { pass_date: '2026-11-19', from_time: '11:00', reason: 'Meet the principal' };
  const errorsOf = (body: object) =>
    validateSync(plainToInstance(PassRequestDto, body), { whitelist: true, forbidNonWhitelisted: true }).map(
      (error) => error.property,
    );

  it('needs a collector only for a pickup pass', () => {
    expect(collectorError('pickup', false)).not.toBeNull();
    expect(collectorError('pickup', true)).toBeNull();
    expect(collectorError('visit', false)).toBeNull();
    expect(collectorError('visit', true)).toBeNull();
  });

  it('accepts a visit pass without a collector', () => {
    expect(errorsOf({ ...base, pass_type: 'visit' })).toEqual([]);
    expect(errorsOf({ ...base, pass_type: 'visit', pickup: null })).toEqual([]);
  });

  it('still checks a collector sent with a visit pass', () => {
    expect(errorsOf({ ...base, pass_type: 'visit', pickup: { kind: 'guardian' } })).toEqual(['pickup']);
    expect(errorsOf({ ...base, pass_type: 'visit', pickup: { kind: 'guardian', guardian_id: 3 } })).toEqual([]);
  });

  it('refuses a pickup pass without a collector, with or without pass_type', () => {
    expect(errorsOf({ ...base, pass_type: 'pickup' })).toEqual(['pickup']);
    expect(errorsOf(base)).toEqual(['pickup']);
    expect(errorsOf({ ...base, pickup: { kind: 'authorised', authorised_id: 2 } })).toEqual([]);
  });

  it('refuses an unknown pass_type', () => {
    expect(errorsOf({ ...base, pass_type: 'party', pickup: { kind: 'guardian', guardian_id: 3 } })).toEqual([
      'pass_type',
    ]);
  });
});
