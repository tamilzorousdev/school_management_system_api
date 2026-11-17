import { dutyMessage } from './driver-profile.service';

const check = (label: string, problem: string | null, date: string | null = null) => ({
  label,
  problem,
  expiry: { date },
});

describe('driver duty message', () => {
  it('says nothing when cleared for duty', () => {
    expect(dutyMessage({ duty_status: 'approved', allowed_today: null, checks: [] })).toBeNull();
  });

  it('names expired documents with the date', () => {
    expect(
      dutyMessage({
        duty_status: 'blocked',
        allowed_today: null,
        checks: [check('Medical fitness', 'Expired', '2026-11-10'), check('Driving licence', null)],
      }),
    ).toBe('Medical fitness expired on 10-11-2026. Renew it and give a copy to the transport office.');
  });

  it('asks for missing documents and covers approval and a day pass', () => {
    expect(
      dutyMessage({
        duty_status: 'pending',
        allowed_today: null,
        checks: [check('Police verification', 'Upload the document')],
      }),
    ).toBe('Police verification: Upload the document. Give the documents to the transport office.');
    expect(dutyMessage({ duty_status: 'pending', allowed_today: null, checks: [check('Medical fitness', null)] })).toBe(
      'Waiting for the transport office to approve you for duty.',
    );
    expect(dutyMessage({ duty_status: 'blocked', allowed_today: { reason: 'x' }, checks: [] })).toBe(
      'The office has allowed you on duty for today only.',
    );
  });
});
