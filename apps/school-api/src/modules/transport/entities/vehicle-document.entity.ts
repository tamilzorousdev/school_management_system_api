import { Column, Entity, Index } from 'typeorm';
import { VerifiableDocument } from '../../../shared/verification';
import { VEHICLE_EXPIRY_KINDS, VehicleExpiryKind } from './expiry-alert.entity';

export const VEHICLE_DOCUMENT_TYPES = [...VEHICLE_EXPIRY_KINDS, 'other'] as const;
export type VehicleDocumentType = (typeof VEHICLE_DOCUMENT_TYPES)[number];

export const VEHICLE_EXPIRY_FIELDS: Record<VehicleExpiryKind, string> = {
  insurance: 'insurance_expiry',
  fitness: 'fitness_expiry',
  permit: 'permit_expiry',
  puc: 'puc_expiry',
  rc: 'rc_expiry',
  road_tax: 'road_tax_expiry',
  speed_governor: 'speed_governor_expiry',
  fire_extinguisher: 'fire_extinguisher_expiry',
  first_aid: 'first_aid_expiry',
};

@Entity('vehicle_documents')
@Index('IDX_vehicle_documents_vehicle', ['vehicle_id'])
export class VehicleDocument extends VerifiableDocument {
  @Column({ type: 'int' })
  vehicle_id: number;

  declare type: VehicleDocumentType;

  @Column({ type: 'varchar', length: 40, nullable: true })
  number: string | null;

  @Column({ type: 'date', nullable: true })
  expiry_date: string | null;
}
