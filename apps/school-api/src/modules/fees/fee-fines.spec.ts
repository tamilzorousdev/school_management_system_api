import { fineAction, fineDueDate, fineInstallment, resolveFine } from './fee-fines.logic';

const year = { name: '2026-27', start_date: '2026-06-01', end_date: '2027-04-30' };

describe('fineInstallment', () => {
  it('uses the serial and the title', () => {
    expect(fineInstallment('TZMS-FIN-2026-0004', 'Broke the lab microscope')).toBe('Fine 4 · Broke the lab microscope');
  });

  it('cuts long titles to the 40-character installment column', () => {
    const label = fineInstallment('TZMS-FIN-2026-0012', 'Damaged two benches and a window in the science block');
    expect(label.length).toBeLessThanOrEqual(40);
    expect(label.startsWith('Fine 12 · Damaged')).toBe(true);
    expect(label.endsWith('…')).toBe(true);
  });
});

describe('fineAction', () => {
  it('describes each stage for the behaviour note', () => {
    expect(fineAction('pending', 500)).toBe('Fine Rs. 500.00 asked, waiting for approval');
    expect(fineAction('approved', 500, 'TZMS-FEE-2026-0301')).toBe('Fine Rs. 500.00 charged (TZMS-FEE-2026-0301)');
    expect(fineAction('rejected', 500, 'Warning is enough')).toBe('Fine Rs. 500.00 not approved: Warning is enough');
    expect(fineAction('withdrawn', 500)).toBe('Fine Rs. 500.00 withdrawn');
  });

  it('stays within the 255-character action column', () => {
    expect(fineAction('rejected', 500, 'x'.repeat(300)).length).toBe(255);
  });
});

describe('resolveFine', () => {
  const type = { name: 'Property damage', default_amount: 500 };

  it('takes the type name and amount when left out', () => {
    expect(resolveFine(type, {})).toEqual({ title: 'Property damage', amount: 500 });
  });

  it('keeps an amount and title typed by the teacher', () => {
    expect(resolveFine(type, { title: 'Broke the lab microscope', amount: 1500 })).toEqual({
      title: 'Broke the lab microscope',
      amount: 1500,
    });
  });

  it('needs a title and amount without a type', () => {
    expect(() => resolveFine(null, { title: 'Phone in class' })).toThrow();
    expect(() => resolveFine(null, { amount: 200 })).toThrow();
    expect(resolveFine(null, { title: 'Phone in class', amount: 200 })).toEqual({
      title: 'Phone in class',
      amount: 200,
    });
  });
});

describe('fineDueDate', () => {
  it('defaults to a week from today', () => {
    expect(fineDueDate('2026-11-19', undefined, year)).toBe('2026-11-26');
  });

  it('never goes past the end of the year', () => {
    expect(fineDueDate('2027-04-28', undefined, year)).toBe('2027-04-30');
  });

  it('refuses a past date or one outside the year', () => {
    expect(() => fineDueDate('2026-11-19', '2026-11-18', year)).toThrow();
    expect(() => fineDueDate('2026-11-19', '2027-05-02', year)).toThrow();
    expect(fineDueDate('2026-11-19', '2026-12-01', year)).toBe('2026-12-01');
  });
});
