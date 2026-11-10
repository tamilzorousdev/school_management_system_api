import 'reflect-metadata';
import { AppException } from '@app/common';
import { bankAccountsFrom } from './bank-input';

const good = {
  account_holder: 'Priya Venkatesh',
  bank_name: 'Indian Bank',
  ifsc: 'idib000t012',
  account_no: '6123 4567 89',
};

const fieldsOf = (payload: unknown) => {
  try {
    bankAccountsFrom(payload);
    return [];
  } catch (error) {
    return (
      ((error as AppException).getResponse() as { errors?: { field: string }[] }).errors?.map((item) => item.field) ??
      []
    );
  }
};

describe('bank account input', () => {
  it('accepts one account, a list or { accounts } and cleans the values', () => {
    const [single] = bankAccountsFrom(good);
    expect(single.ifsc).toBe('IDIB000T012');
    expect(single.account_no).toBe('6123456789');
    expect(bankAccountsFrom([good, good])).toHaveLength(2);
    expect(bankAccountsFrom({ accounts: [good] })).toHaveLength(1);
  });

  it('refuses a wrong IFSC and a short account number', () => {
    expect(fieldsOf({ ...good, ifsc: 'BAD', account_no: '12' })).toEqual(['ifsc', 'account_no']);
    expect(fieldsOf({ accounts: [good, { ...good, ifsc: 'BAD' }] })).toEqual(['accounts.1.ifsc']);
  });

  it('refuses missing fields, unknown fields and an empty list', () => {
    expect(fieldsOf({ ifsc: 'IDIB000T012' })).toEqual(
      expect.arrayContaining(['account_holder', 'bank_name', 'account_no']),
    );
    expect(fieldsOf({ ...good, hacked: true })).toEqual(['hacked']);
    expect(fieldsOf({ accounts: [] })).toEqual(['accounts']);
    expect(fieldsOf(null)).toEqual(['accounts']);
  });

  it('allows only one primary account', () => {
    expect(
      fieldsOf([
        { ...good, is_primary: true },
        { ...good, is_primary: true },
      ]),
    ).toEqual(['accounts']);
  });
});
