import { SchoolScopedEntity } from '@app/common';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { Community, Religion } from '../../../shared/identity';
import { User } from '../../users/entities/user.entity';
import { StaffBankAccount } from './staff-bank-account.entity';
import { StaffDocument } from './staff-document.entity';
import { StaffQualification } from './staff-qualification.entity';

export const STAFF_TYPES = ['teaching', 'non_teaching'] as const;
export type StaffType = (typeof STAFF_TYPES)[number];

export const STAFF_STATUSES = ['active', 'on_leave', 'resigned'] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

@Entity('staff')
@Index('UQ_staff_school_employee_no', ['school_id', 'employee_no'], { unique: true, where: 'deleted_at IS NULL' })
@Index('UQ_staff_user', ['user_id'], { unique: true, where: 'deleted_at IS NULL' })
export class Staff extends SchoolScopedEntity {
  @Column({ type: 'int' })
  user_id: number;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'varchar', length: 30 })
  employee_no: string;

  @Column({ type: 'varchar', length: 15, default: 'teaching' })
  staff_type: StaffType;

  @Column({ type: 'varchar', length: 80 })
  designation: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  department: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  gender: 'male' | 'female' | 'other' | null;

  @Column({ type: 'date', nullable: true })
  dob: string | null;

  @Column({ type: 'date' })
  joining_date: string;

  @Column({ type: 'smallint', default: 0 })
  prior_experience_years: number;

  @Column({ type: 'smallint', default: 30 })
  max_periods_per_week: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  emergency_contact_name: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  emergency_contact_mobile: string | null;

  @Column({ type: 'varchar', length: 10, default: 'active' })
  status: StaffStatus;

  @Column({ type: 'date', nullable: true })
  left_on: string | null;

  @Column({ type: 'varchar', length: 5, nullable: true })
  community: Community | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  caste: string | null;

  @Column({ type: 'varchar', length: 12, nullable: true })
  religion: Religion | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  nationality: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  mother_tongue: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  community_certificate_no: string | null;

  @Column({ type: 'text', nullable: true, select: false })
  aadhaar_enc: string | null;

  @Column({ type: 'varchar', length: 4, nullable: true })
  aadhaar_last4: string | null;

  @Column({ type: 'int', nullable: true })
  signature_file_id: number | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  bank_account_holder: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  bank_name: string | null;

  @Column({ type: 'varchar', length: 11, nullable: true })
  bank_ifsc: string | null;

  @Column({ type: 'text', nullable: true, select: false })
  bank_account_enc: string | null;

  @Column({ type: 'varchar', length: 4, nullable: true })
  bank_account_last4: string | null;

  @Column({ type: 'text', nullable: true, select: false })
  pan_enc: string | null;

  @Column({ type: 'varchar', length: 4, nullable: true })
  pan_last4: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  licence_no: string | null;

  @Column({ type: 'date', nullable: true })
  licence_expiry: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  licence_type: string | null;

  @Column({ type: 'date', nullable: true })
  licence_issued_on: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  badge_no: string | null;

  @Column({ type: 'date', nullable: true })
  badge_expiry: string | null;

  @Column({ type: 'date', nullable: true })
  medical_fitness_expiry: string | null;

  @Column({ type: 'date', nullable: true })
  police_verified_on: string | null;

  @Column({ type: 'date', nullable: true })
  police_verification_expiry: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  duty_approved_at: Date | null;

  @Column({ type: 'int', nullable: true })
  duty_approved_by: number | null;

  @Column({ type: 'date', nullable: true })
  duty_approved_until: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  last_reminded_at: Date | null;

  @Column({ type: 'int', nullable: true })
  last_reminded_by: number | null;

  @OneToMany(() => StaffQualification, (item) => item.staff)
  qualifications?: StaffQualification[];

  @OneToMany(() => StaffDocument, (item) => item.staff)
  documents?: StaffDocument[];

  @OneToMany(() => StaffBankAccount, (item) => item.staff)
  bank_accounts?: StaffBankAccount[];
}
