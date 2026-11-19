import { Check, Column, Entity, Index } from 'typeorm';
import { SchoolScopedEntity } from '@app/common';

export const ACCOUNT_KINDS = ['expense', 'income'] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

@Entity('account_categories')
@Check('CHK_account_categories_kind', `"kind" IN ('expense', 'income')`)
@Index('UQ_account_categories_school_kind_name', ['school_id', 'kind', 'name'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
export class AccountCategory extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 10 })
  kind: AccountKind;

  @Column({ type: 'varchar', length: 60 })
  name: string;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'smallint', default: 0 })
  sort_order: number;
}
