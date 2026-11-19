import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AppException, AuthUser, listQuery, Paginated } from '@app/common';
import { VendorRefDto } from './dto/fleet-ops.dto';
import { UpdateVendorDto, VendorDto, VendorInputDto, VendorQueryDto } from './dto/fleet-maintenance.dto';
import { FleetVendor, VendorKind } from './entities/fleet-maintenance.entity';

@Injectable()
export class FleetVendorsService {
  constructor(
    @InjectRepository(FleetVendor) private readonly vendors: Repository<FleetVendor>,
    private readonly dataSource: DataSource,
  ) {}

  async list(schoolId: number, query: VendorQueryDto): Promise<Paginated<VendorDto>> {
    const qb = this.vendors.createQueryBuilder('g').where('g.school_id = :schoolId', { schoolId });
    if (query.kind) qb.andWhere('g.kind = :kind', { kind: query.kind });
    if (query.active !== undefined) qb.andWhere('g.is_active = :active', { active: query.active });
    const page = await listQuery(qb, query, {
      searchable: ['g.name', 'g.phone', 'g.gst_no', 'g.address'],
      sortable: { name: 'g.name', created_at: 'g.created_at' },
      defaultSort: 'name',
    });
    return { ...page, items: await this.present(page.items) };
  }

  async create(schoolId: number, dto: VendorInputDto, actor: AuthUser): Promise<VendorDto> {
    await this.assertNameFree(schoolId, dto.kind, dto.name);
    const saved = await this.vendors.save(
      this.vendors.create({
        school_id: schoolId,
        kind: dto.kind,
        name: dto.name,
        phone: dto.phone ?? null,
        gst_no: dto.gst_no ?? null,
        address: dto.address ?? null,
        is_active: dto.is_active ?? true,
        created_by: actor.id,
      }),
    );
    return (await this.present([saved]))[0]!;
  }

  async update(schoolId: number, id: number, dto: UpdateVendorDto): Promise<VendorDto> {
    const vendor = await this.find(schoolId, id);
    if (dto.name && dto.name.toLowerCase() !== vendor.name.toLowerCase()) {
      await this.assertNameFree(schoolId, vendor.kind, dto.name, vendor.id);
    }
    const changes: Partial<FleetVendor> = {};
    for (const key of ['name', 'phone', 'gst_no', 'address', 'is_active'] as const) {
      if (dto[key] !== undefined) Object.assign(changes, { [key]: dto[key] });
    }
    await this.vendors.save(this.vendors.merge(vendor, changes));
    return (await this.present([await this.find(schoolId, id)]))[0]!;
  }

  async remove(schoolId: number, id: number): Promise<void> {
    const vendor = await this.find(schoolId, id);
    await this.vendors.softDelete(vendor.id);
  }

  async assertUsable(
    schoolId: number,
    id: number | null | undefined,
    kinds: VendorKind[],
    field: string,
  ): Promise<FleetVendor | null> {
    if (!id) return null;
    const vendor = await this.vendors.findOneBy({ id, school_id: schoolId });
    if (!vendor || !kinds.includes(vendor.kind)) {
      throw AppException.validation([
        { field, message: `${field} must be a saved ${kinds.join(' or ').replace('_', ' ')}` },
      ]);
    }
    return vendor;
  }

  async refs(ids: (number | null)[]): Promise<Map<number, VendorRefDto>> {
    const wanted = [...new Set(ids.filter((id): id is number => typeof id === 'number'))];
    if (!wanted.length) return new Map();
    const rows = await this.vendors.find({ where: { id: In(wanted) }, withDeleted: true });
    return new Map(rows.map((row) => [row.id, { id: row.id, name: row.name, phone: row.phone }]));
  }

  private async assertNameFree(schoolId: number, kind: VendorKind, name: string, exceptId = 0): Promise<void> {
    const [taken] = await this.dataSource.query(
      `SELECT id FROM fleet_vendors WHERE school_id = $1 AND kind = $2 AND lower(name) = lower($3) AND id <> $4 AND deleted_at IS NULL`,
      [schoolId, kind, name, exceptId],
    );
    if (taken) throw AppException.conflict(`${name} is already saved`, 'VENDOR_EXISTS');
  }

  private async find(schoolId: number, id: number): Promise<FleetVendor> {
    const vendor = await this.vendors.findOneBy({ id, school_id: schoolId });
    if (!vendor) throw AppException.notFound('Garage or fuel station not found', 'VENDOR_NOT_FOUND');
    return vendor;
  }

  private async present(rows: FleetVendor[]): Promise<VendorDto[]> {
    if (!rows.length) return [];
    const totals: { id: number; total: number }[] = await this.dataSource.query(
      `SELECT id, SUM(amount)::float AS total FROM (
         SELECT vendor_id AS id, cost AS amount FROM maintenance_tickets WHERE vendor_id = ANY($1) AND deleted_at IS NULL AND status = 'done'
         UNION ALL SELECT station_id, amount FROM fuel_logs WHERE station_id = ANY($1) AND deleted_at IS NULL AND status = 'approved'
         UNION ALL SELECT vendor_id, amount FROM vehicle_expenses WHERE vendor_id = ANY($1) AND deleted_at IS NULL
       ) spend GROUP BY id`,
      [rows.map((row) => row.id)],
    );
    const byId = new Map(totals.map((row) => [Number(row.id), Math.round(Number(row.total ?? 0) * 100) / 100]));
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      phone: row.phone,
      gst_no: row.gst_no,
      address: row.address,
      is_active: row.is_active,
      total_spent: byId.get(row.id) ?? 0,
    }));
  }
}
