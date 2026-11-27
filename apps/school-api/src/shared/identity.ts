import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

export const COMMUNITIES = ['oc', 'bc', 'bcm', 'mbc', 'dnc', 'sc', 'sca', 'st'] as const;
export type Community = (typeof COMMUNITIES)[number];

export const COMMUNITY_LABELS: Record<Community, string> = {
  oc: 'OC',
  bc: 'BC',
  bcm: 'BCM',
  mbc: 'MBC',
  dnc: 'DNC',
  sc: 'SC',
  sca: 'SCA',
  st: 'ST',
};

export const RELIGIONS = ['hindu', 'muslim', 'christian', 'sikh', 'jain', 'buddhist', 'other'] as const;
export type Religion = (typeof RELIGIONS)[number];

export const RELIGION_LABELS: Record<Religion, string> = {
  hindu: 'Hindu',
  muslim: 'Muslim',
  christian: 'Christian',
  sikh: 'Sikh',
  jain: 'Jain',
  buddhist: 'Buddhist',
  other: 'Other',
};

export const AADHAAR_PATTERN = /^[2-9]\d{11}$/;

const textOrNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const lowerOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() || null : value;
const digitsOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/[\s-]/g, '') || null : value;
const notNull = (_object: unknown, value: unknown) => value !== null;

export class IdentityInputDto {
  @ApiPropertyOptional({ enum: COMMUNITIES, nullable: true, example: 'bc' })
  @IsOptional()
  @Transform(lowerOrNull)
  @ValidateIf(notNull)
  @IsIn(COMMUNITIES)
  community?: Community | null;

  @ApiPropertyOptional({ example: 'Vanniyar', nullable: true, type: String })
  @IsOptional()
  @Transform(textOrNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(80)
  caste?: string | null;

  @ApiPropertyOptional({ enum: RELIGIONS, nullable: true, example: 'hindu' })
  @IsOptional()
  @Transform(lowerOrNull)
  @ValidateIf(notNull)
  @IsIn(RELIGIONS)
  religion?: Religion | null;

  @ApiPropertyOptional({ example: 'Indian', nullable: true, type: String })
  @IsOptional()
  @Transform(textOrNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(40)
  nationality?: string | null;

  @ApiPropertyOptional({ example: 'Tamil', nullable: true, type: String })
  @IsOptional()
  @Transform(textOrNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(40)
  mother_tongue?: string | null;

  @ApiPropertyOptional({ example: 'TN-BC-2019-004512', nullable: true, type: String })
  @IsOptional()
  @Transform(textOrNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(40)
  community_certificate_no?: string | null;

  @ApiPropertyOptional({
    example: '234567890123',
    nullable: true,
    type: String,
    description: '12 digits, spaces allowed. Stored encrypted; responses show only the last 4. null clears it.',
  })
  @IsOptional()
  @Transform(digitsOrNull)
  @ValidateIf(notNull)
  @Matches(AADHAAR_PATTERN, { message: 'aadhaar_no must be a valid 12-digit Aadhaar number' })
  aadhaar_no?: string | null;
}

export class IdentityDto {
  @ApiProperty({ enum: COMMUNITIES, nullable: true, example: 'bc' })
  community: Community | null;

  @ApiProperty({ example: 'Vanniyar', nullable: true, type: String })
  caste: string | null;

  @ApiProperty({ enum: RELIGIONS, nullable: true, example: 'hindu' })
  religion: Religion | null;

  @ApiProperty({ example: 'Indian', nullable: true, type: String })
  nationality: string | null;

  @ApiProperty({ example: 'Tamil', nullable: true, type: String })
  mother_tongue: string | null;

  @ApiProperty({ example: 'TN-BC-2019-004512', nullable: true, type: String })
  community_certificate_no: string | null;

  @ApiProperty({ example: 'XXXX0123', nullable: true, type: String })
  aadhaar_masked: string | null;
}

export class AadhaarDto {
  @ApiProperty({ example: '234567890123', nullable: true, type: String })
  aadhaar_no: string | null;
}

export interface IdentityColumns {
  community: Community | null;
  caste: string | null;
  religion: Religion | null;
  nationality: string | null;
  mother_tongue: string | null;
  community_certificate_no: string | null;
  aadhaar_enc: string | null;
  aadhaar_last4: string | null;
}

const PLAIN_KEYS = [
  'community',
  'caste',
  'religion',
  'nationality',
  'mother_tongue',
  'community_certificate_no',
] as const;
export const IDENTITY_INPUT_KEYS: readonly string[] = [...PLAIN_KEYS, 'aadhaar_no'];

export function identityColumns(dto: IdentityInputDto, encrypt: (plain: string) => string): Partial<IdentityColumns> {
  const columns: Partial<IdentityColumns> = {};
  for (const key of PLAIN_KEYS) {
    if (dto[key] !== undefined) Object.assign(columns, { [key]: dto[key] });
  }
  if (dto.aadhaar_no !== undefined) {
    columns.aadhaar_enc = dto.aadhaar_no ? encrypt(dto.aadhaar_no) : null;
    columns.aadhaar_last4 = dto.aadhaar_no ? dto.aadhaar_no.slice(-4) : null;
  }
  return columns;
}

export function withoutIdentity<T extends object>(dto: T): Partial<T> {
  return Object.fromEntries(Object.entries(dto).filter(([key]) => !IDENTITY_INPUT_KEYS.includes(key))) as Partial<T>;
}

export function identityOf(row: Partial<IdentityColumns>): IdentityDto {
  return {
    community: row.community ?? null,
    caste: row.caste ?? null,
    religion: row.religion ?? null,
    nationality: row.nationality ?? null,
    mother_tongue: row.mother_tongue ?? null,
    community_certificate_no: row.community_certificate_no ?? null,
    aadhaar_masked: row.aadhaar_last4 ? `XXXX${row.aadhaar_last4}` : null,
  };
}
