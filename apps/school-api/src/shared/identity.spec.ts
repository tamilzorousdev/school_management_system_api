import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { IdentityInputDto, identityColumns, identityOf, withoutIdentity } from './identity';

const encrypt = (plain: string) => `enc:${plain}`;
const parse = (body: Record<string, unknown>) => {
  const dto = plainToInstance(IdentityInputDto, body);
  return { dto, errors: validateSync(dto).map((error) => error.property) };
};

describe('identity input', () => {
  it('accepts the Tamil Nadu communities and religions in any case', () => {
    const { dto, errors } = parse({ community: 'MBC', religion: 'Hindu', caste: ' Vanniyar ' });
    expect(errors).toEqual([]);
    expect(dto).toMatchObject({ community: 'mbc', religion: 'hindu', caste: 'Vanniyar' });
  });

  it('refuses an unknown community or religion', () => {
    expect(parse({ community: 'obc', religion: 'none' }).errors.sort()).toEqual(['community', 'religion']);
  });

  it('accepts a 12-digit Aadhaar written with spaces and refuses a bad one', () => {
    expect(parse({ aadhaar_no: '2345 6789 0123' })).toMatchObject({ dto: { aadhaar_no: '234567890123' }, errors: [] });
    expect(parse({ aadhaar_no: '123456789012' }).errors).toEqual(['aadhaar_no']);
    expect(parse({ aadhaar_no: '23456789012' }).errors).toEqual(['aadhaar_no']);
  });

  it('turns blank text into null so a field can be cleared', () => {
    expect(parse({ caste: '  ', aadhaar_no: '' }).dto).toMatchObject({ caste: null, aadhaar_no: null });
  });
});

describe('identity columns', () => {
  it('encrypts the Aadhaar and keeps only the last 4 in clear', () => {
    expect(identityColumns({ aadhaar_no: '234567890123' }, encrypt)).toEqual({
      aadhaar_enc: 'enc:234567890123',
      aadhaar_last4: '0123',
    });
  });

  it('clears the Aadhaar on null and leaves it alone when not sent', () => {
    expect(identityColumns({ aadhaar_no: null }, encrypt)).toEqual({ aadhaar_enc: null, aadhaar_last4: null });
    expect(identityColumns({ caste: 'Nadar' }, encrypt)).toEqual({ caste: 'Nadar' });
  });

  it('drops the identity keys from a payload', () => {
    expect(withoutIdentity({ first_name: 'Arun', community: 'bc', aadhaar_no: '234567890123' })).toEqual({
      first_name: 'Arun',
    });
  });

  it('shows the masked Aadhaar and nulls for empty fields', () => {
    expect(identityOf({ community: 'sc', aadhaar_last4: '0123' })).toEqual({
      community: 'sc',
      caste: null,
      religion: null,
      nationality: null,
      mother_tongue: null,
      community_certificate_no: null,
      aadhaar_masked: 'XXXX0123',
    });
  });
});
