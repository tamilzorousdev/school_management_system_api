import { plainToInstance } from 'class-transformer';
import { validateSync, ValidationError } from 'class-validator';
import { AppException, FieldError } from '@app/common';
import { BankDetailsInputDto } from './dto/staff-input.dto';

const MAX_ACCOUNTS = 10;

function rawAccounts(payload: unknown): { items: unknown[]; prefix: (index: number) => string } {
  if (Array.isArray(payload)) return { items: payload, prefix: (index) => `${index}.` };
  if (payload && typeof payload === 'object' && 'accounts' in payload) {
    const accounts = (payload as { accounts: unknown }).accounts;
    if (!Array.isArray(accounts)) {
      throw AppException.validation([{ field: 'accounts', message: 'accounts must be a list of bank accounts' }]);
    }
    return { items: accounts, prefix: (index) => `accounts.${index}.` };
  }
  if (payload && typeof payload === 'object') return { items: [payload], prefix: () => '' };
  throw AppException.validation([{ field: 'accounts', message: 'Send at least one bank account' }]);
}

function flatten(errors: ValidationError[], prefix: string): FieldError[] {
  return errors.flatMap((error) => [
    ...Object.values(error.constraints ?? {}).map((message) => ({ field: `${prefix}${error.property}`, message })),
    ...flatten(error.children ?? [], `${prefix}${error.property}.`),
  ]);
}

export function bankAccountsFrom(payload: unknown): BankDetailsInputDto[] {
  const { items, prefix } = rawAccounts(payload);
  if (!items.length) {
    throw AppException.validation([{ field: 'accounts', message: 'Send at least one bank account' }]);
  }
  if (items.length > MAX_ACCOUNTS) {
    throw AppException.validation([{ field: 'accounts', message: `Up to ${MAX_ACCOUNTS} bank accounts` }]);
  }
  const errors: FieldError[] = [];
  const accounts = items.map((item, index) => {
    if (!item || typeof item !== 'object') {
      errors.push({ field: `${prefix(index)}account`, message: 'Each bank account must be an object' });
      return new BankDetailsInputDto();
    }
    const account = plainToInstance(BankDetailsInputDto, item);
    errors.push(...flatten(validateSync(account, { whitelist: true, forbidNonWhitelisted: true }), prefix(index)));
    return account;
  });
  if (errors.length) throw AppException.validation(errors);
  if (accounts.filter((account) => account.is_primary).length > 1) {
    throw AppException.validation([{ field: 'accounts', message: 'Only one account can be the primary account' }]);
  }
  return accounts;
}
