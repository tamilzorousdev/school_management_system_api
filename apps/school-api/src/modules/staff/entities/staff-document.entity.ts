import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { VerifiableDocument } from '../../../shared/verification';
import { Staff } from './staff.entity';

export const STAFF_DOCUMENT_TYPES = [
  'id_proof',
  'address_proof',
  'degree_certificate',
  'experience_letter',
  'police_verification',
  'medical_fitness',
  'driving_licence',
  'psv_badge',
  'photo',
  'other',
] as const;
export type StaffDocumentType = (typeof STAFF_DOCUMENT_TYPES)[number];

export const CREW_DOCUMENT_TYPES: StaffDocumentType[] = [
  'driving_licence',
  'psv_badge',
  'medical_fitness',
  'police_verification',
];

@Entity('staff_documents')
export class StaffDocument extends VerifiableDocument {
  @Index()
  @Column({ type: 'int' })
  staff_id: number;

  @ManyToOne(() => Staff, (staff) => staff.documents, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'staff_id' })
  staff?: Staff;

  declare type: StaffDocumentType;
}
