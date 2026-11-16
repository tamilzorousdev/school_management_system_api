import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export const SIGNATURE_SIDES = ['teacher', 'parent'] as const;
export type SignatureSide = (typeof SIGNATURE_SIDES)[number];

export const SIGNATURE_ACTIONS = ['added', 'changed', 'removed'] as const;
export type SignatureAction = (typeof SIGNATURE_ACTIONS)[number];

@Entity('signature_changes')
@Index('IDX_signature_changes_school', ['school_id'])
@Index('IDX_signature_changes_staff', ['staff_id'])
@Index('IDX_signature_changes_guardian', ['guardian_id'])
export class SignatureChange {
  @PrimaryGeneratedColumn({ primaryKeyConstraintName: 'PK_signature_changes' })
  id: number;

  @Column({ type: 'int' })
  school_id: number;

  @Column({ type: 'varchar', length: 8 })
  side: SignatureSide;

  @Column({ type: 'int', nullable: true })
  staff_id: number | null;

  @Column({ type: 'int', nullable: true })
  guardian_id: number | null;

  @Column({ type: 'int', nullable: true })
  owner_user_id: number | null;

  @Column({ type: 'varchar', length: 8 })
  action: SignatureAction;

  @Column({ type: 'int', nullable: true })
  old_file_id: number | null;

  @Column({ type: 'int', nullable: true })
  new_file_id: number | null;

  @Column({ type: 'int' })
  changed_by: number;

  @Column({ type: 'boolean', default: false })
  by_admin: boolean;

  @Column({ type: 'varchar', length: 120, nullable: true })
  note: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
