import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AppException, AuthUser } from '@app/common';
import { VerifyDocumentDto } from '../../shared/verification';
import { FilesService } from '../files/files.service';
import { VehicleDocumentDto, VehicleDocumentInputDto } from './dto/transport.dto';
import { VehicleExpiryKind } from './entities/expiry-alert.entity';
import { VEHICLE_EXPIRY_FIELDS, VehicleDocument } from './entities/vehicle-document.entity';
import { Vehicle } from './entities/vehicle.entity';
import { EXPIRY_LABELS } from './transport.logic';

const OTHER_TITLE = 'Other document';

@Injectable()
export class VehicleDocumentsService {
  constructor(
    @InjectRepository(VehicleDocument) private readonly documents: Repository<VehicleDocument>,
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    private readonly files: FilesService,
    private readonly dataSource: DataSource,
  ) {}

  async list(schoolId: number, vehicleId: number): Promise<VehicleDocumentDto[]> {
    await this.vehicle(schoolId, vehicleId);
    const rows = await this.documents.find({
      where: { school_id: schoolId, vehicle_id: vehicleId },
      order: { created_at: 'DESC', id: 'DESC' },
    });
    return this.present(rows);
  }

  async add(schoolId: number, vehicleId: number, dto: VehicleDocumentInputDto): Promise<VehicleDocumentDto> {
    const vehicle = await this.vehicle(schoolId, vehicleId);
    await this.files.assertAttachable(dto.file_id, schoolId);
    const kind = dto.type === 'other' ? null : (dto.type as VehicleExpiryKind);
    if (kind && !dto.expiry_date) {
      throw AppException.validation([{ field: 'expiry_date', message: 'Give the date this document is valid till' }]);
    }
    const saved = await this.dataSource.transaction(async (manager) => {
      const document = await manager.save(
        manager.create(VehicleDocument, {
          school_id: schoolId,
          vehicle_id: vehicle.id,
          type: dto.type,
          title: dto.title ?? (kind ? EXPIRY_LABELS[kind] : OTHER_TITLE),
          number: dto.number ?? null,
          expiry_date: dto.expiry_date ?? null,
          file_id: dto.file_id,
          status: 'pending',
        }),
      );
      if (kind) await manager.update(Vehicle, vehicle.id, { [VEHICLE_EXPIRY_FIELDS[kind]]: dto.expiry_date });
      return document;
    });
    return (await this.present([saved]))[0]!;
  }

  async verify(
    schoolId: number,
    vehicleId: number,
    documentId: number,
    dto: VerifyDocumentDto,
    actor: AuthUser,
  ): Promise<VehicleDocumentDto> {
    const document = await this.document(schoolId, vehicleId, documentId);
    Object.assign(document, {
      status: dto.status,
      remarks: dto.remarks ?? null,
      verified_by: actor.id,
      verified_at: new Date(),
    });
    return (await this.present([await this.documents.save(document)]))[0]!;
  }

  async remove(schoolId: number, vehicleId: number, documentId: number): Promise<{ id: number }> {
    await this.document(schoolId, vehicleId, documentId);
    await this.documents.softDelete(documentId);
    return { id: documentId };
  }

  private async present(rows: VehicleDocument[]): Promise<VehicleDocumentDto[]> {
    if (!rows.length) return [];
    const verifierIds = [...new Set(rows.map((row) => row.verified_by).filter((id): id is number => !!id))];
    const [files, people, newest] = await Promise.all([
      this.files.presentMany(rows.map((row) => row.file_id)),
      verifierIds.length
        ? this.dataSource.query(`SELECT u.id, u.name FROM users u WHERE u.id = ANY($1)`, [verifierIds])
        : Promise.resolve([] as { id: number; name: string }[]),
      this.newestIds(rows),
    ]);
    return rows.map((row) => {
      const verifier = (people as { id: number; name: string }[]).find((item) => Number(item.id) === row.verified_by);
      return {
        id: row.id,
        type: row.type,
        title: row.title,
        number: row.number,
        expiry_date: row.expiry_date,
        status: row.status,
        remarks: row.remarks,
        verified_by: verifier ? { id: Number(verifier.id), name: verifier.name } : null,
        verified_at: row.verified_at,
        file: files.get(row.file_id) ?? null,
        current: newest.has(row.id),
        created_at: row.created_at,
      };
    });
  }

  private async newestIds(rows: VehicleDocument[]): Promise<Set<number>> {
    const vehicleIds = [...new Set(rows.map((row) => row.vehicle_id))];
    const latest: { id: number }[] = await this.documents
      .createQueryBuilder('d')
      .select('DISTINCT ON (d.vehicle_id, d.type) d.id', 'id')
      .where({ vehicle_id: In(vehicleIds) })
      .orderBy('d.vehicle_id')
      .addOrderBy('d.type')
      .addOrderBy('d.created_at', 'DESC')
      .addOrderBy('d.id', 'DESC')
      .getRawMany();
    return new Set(latest.map((row) => Number(row.id)));
  }

  private async vehicle(schoolId: number, id: number): Promise<Vehicle> {
    const vehicle = await this.vehicles.findOneBy({ id, school_id: schoolId });
    if (!vehicle) throw AppException.notFound('Bus not found', 'VEHICLE_NOT_FOUND');
    return vehicle;
  }

  private async document(schoolId: number, vehicleId: number, id: number): Promise<VehicleDocument> {
    const document = await this.documents.findOneBy({ id, vehicle_id: vehicleId, school_id: schoolId });
    if (!document) throw AppException.notFound('Document not found', 'DOCUMENT_NOT_FOUND');
    return document;
  }
}
