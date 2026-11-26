import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppException, listQuery, Paginated } from '@app/common';
import {
  CanteenStaffDto,
  CanteenStaffInputDto,
  CanteenStaffInsightsDto,
  CanteenStaffQueryDto,
  CanteenStaffUpdateDto,
} from './dto/canteen-people.dto';
import { CanteenStaff } from './entities/canteen-people.entity';

const SORTS: Record<string, string> = {
  created_at: 's.created_at',
  name: 's.name',
  role: 's.role',
  joined_on: 's.joined_on',
  daily_wage: 's.daily_wage',
};

const defined = <T extends object>(dto: T) =>
  Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined)) as Partial<T>;

export const toStaffDto = (row: CanteenStaff): CanteenStaffDto => ({
  id: row.id,
  name: row.name,
  mobile: row.mobile,
  role: row.role,
  staff_id: row.staff_id,
  joined_on: row.joined_on,
  daily_wage: row.daily_wage,
  status: row.status,
  address: row.address,
  created_at: row.created_at,
});

@Injectable()
export class CanteenStaffService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(CanteenStaff) private readonly repo: Repository<CanteenStaff>,
  ) {}

  async list(schoolId: number, query: CanteenStaffQueryDto): Promise<Paginated<CanteenStaffDto>> {
    const qb = this.repo.createQueryBuilder('s').where('s.school_id = :schoolId', { schoolId });
    if (query.role) qb.andWhere('s.role = :role', { role: query.role });
    if (query.status) qb.andWhere('s.status = :status', { status: query.status });
    const page = await listQuery(qb, query, {
      searchable: ['s.name', 's.mobile'],
      sortable: SORTS,
      defaultSort: 'created_at',
    });
    return { ...page, items: page.items.map(toStaffDto) };
  }

  async insights(schoolId: number): Promise<CanteenStaffInsightsDto> {
    const rows: { role: string; status: string; count: number }[] = await this.dataSource.query(
      `SELECT s.role, s.status, COUNT(*)::int AS count
       FROM canteen_staff s
       WHERE s.school_id = $1 AND s.deleted_at IS NULL
       GROUP BY s.role, s.status`,
      [schoolId],
    );
    const sum = (filter: (row: (typeof rows)[number]) => boolean) =>
      rows.filter(filter).reduce((total, row) => total + Number(row.count), 0);
    const roles = [...new Set(rows.map((row) => row.role))].sort();
    return {
      total: sum(() => true),
      active: sum((row) => row.status === 'active'),
      inactive: sum((row) => row.status !== 'active'),
      by_role: roles.map((role) => ({ key: role, count: sum((row) => row.role === role) })),
    };
  }

  async get(schoolId: number, id: number): Promise<CanteenStaffDto> {
    return toStaffDto(await this.find(schoolId, id));
  }

  async create(schoolId: number, dto: CanteenStaffInputDto): Promise<CanteenStaffDto> {
    await this.checkLink(schoolId, dto.staff_id);
    const row = this.repo.create({
      school_id: schoolId,
      name: dto.name,
      mobile: dto.mobile ?? null,
      role: dto.role,
      staff_id: dto.staff_id ?? null,
      joined_on: dto.joined_on ?? null,
      daily_wage: dto.daily_wage ?? null,
      status: dto.status ?? 'active',
      address: dto.address ?? null,
    });
    return toStaffDto(await this.repo.save(row));
  }

  async update(schoolId: number, id: number, dto: CanteenStaffUpdateDto): Promise<CanteenStaffDto> {
    const row = await this.find(schoolId, id);
    await this.checkLink(schoolId, dto.staff_id, id);
    Object.assign(row, defined(dto));
    return toStaffDto(await this.repo.save(row));
  }

  async remove(schoolId: number, id: number): Promise<void> {
    const row = await this.find(schoolId, id);
    await this.repo.softDelete({ id: row.id, school_id: schoolId });
  }

  private async find(schoolId: number, id: number): Promise<CanteenStaff> {
    const row = await this.repo.findOneBy({ id, school_id: schoolId });
    if (!row) throw AppException.notFound('Canteen staff not found', 'CANTEEN_STAFF_NOT_FOUND');
    return row;
  }

  private async checkLink(schoolId: number, staffId: number | null | undefined, exceptId = 0): Promise<void> {
    if (!staffId) return;
    const rows: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM staff st WHERE st.id = $1 AND st.school_id = $2 AND st.deleted_at IS NULL`,
      [staffId, schoolId],
    );
    if (rows.length === 0) throw AppException.notFound('Staff member not found', 'STAFF_NOT_FOUND');
    const taken: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM canteen_staff s WHERE s.school_id = $1 AND s.staff_id = $2 AND s.id <> $3 AND s.deleted_at IS NULL`,
      [schoolId, staffId, exceptId],
    );
    if (taken.length > 0) throw AppException.conflict('That staff member is already linked', 'STAFF_ALREADY_LINKED');
  }
}
