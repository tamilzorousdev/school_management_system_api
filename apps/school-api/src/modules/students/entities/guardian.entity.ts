import { SchoolScopedEntity } from '@app/common';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { StudentGuardian } from './student-guardian.entity';

@Entity('guardians')
@Index('UQ_guardians_school_mobile', ['school_id', 'mobile'], { unique: true, where: 'deleted_at IS NULL' })
export class Guardian extends SchoolScopedEntity {
  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 10 })
  mobile: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  alt_mobile: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  occupation: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  qualification: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address_line: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  city: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  pincode: string | null;

  @Column({ type: 'int', nullable: true })
  photo_file_id: number | null;

  @Column({ type: 'int', nullable: true })
  signature_file_id: number | null;

  @Index()
  @Column({ type: 'int', nullable: true })
  user_id: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user?: User | null;

  @OneToMany(() => StudentGuardian, (link) => link.guardian)
  student_links?: StudentGuardian[];
}
