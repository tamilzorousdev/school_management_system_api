import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { AppException, AuthUser, paginate, Paginated } from '@app/common';
import { PeopleAssetsDto } from './dto/operations.dto';
import {
  CategoryDto,
  CategoryInputDto,
  CategoryQueryDto,
  CategoryUpdateDto,
  DepartmentDto,
  DepartmentInputDto,
  DepartmentSyncResultDto,
  DepartmentUpdateDto,
  InventorySettingsDto,
  InventorySettingsInputDto,
  LocationDto,
  LocationInputDto,
  LocationQueryDto,
  LocationUpdateDto,
  StoreDto,
  StoreInputDto,
  StoreUpdateDto,
  VendorDto,
  VendorInputDto,
  VendorUpdateDto,
} from './dto/master.dto';
import {
  Department,
  InventoryCategory,
  InventoryLocation,
  InventorySettings,
  InventoryStore,
  InventoryVendor,
} from './entities/master.entity';
import { codeFrom } from './inventory.logic';
import {
  addSearch,
  InventoryReadService,
  num,
  numOrNull,
  orderBy,
  param,
  ref,
  Row,
  SqlFilter,
  str,
} from './inventory-read.service';

const LOCATION_SORTS: Record<string, string> = {
  name: 'l.name',
  code: 'l.code',
  building: 'l.building',
  created_at: 'l.created_at',
};

const defined = <T extends object>(dto: T) =>
  Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined)) as Partial<T>;

@Injectable()
export class InventoryMastersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly read: InventoryReadService,
    @InjectRepository(InventorySettings) private readonly settingsRepo: Repository<InventorySettings>,
    @InjectRepository(InventoryCategory) private readonly categoriesRepo: Repository<InventoryCategory>,
    @InjectRepository(InventoryLocation) private readonly locationsRepo: Repository<InventoryLocation>,
    @InjectRepository(Department) private readonly departmentsRepo: Repository<Department>,
    @InjectRepository(InventoryVendor) private readonly vendorsRepo: Repository<InventoryVendor>,
    @InjectRepository(InventoryStore) private readonly storesRepo: Repository<InventoryStore>,
  ) {}

  settings(schoolId: number): Promise<InventorySettingsDto> {
    return this.read.settings(schoolId);
  }

  async updateSettings(
    schoolId: number,
    dto: InventorySettingsInputDto,
    actor: AuthUser,
  ): Promise<InventorySettingsDto> {
    const row =
      (await this.settingsRepo.findOneBy({ school_id: schoolId })) ?? this.settingsRepo.create({ school_id: schoolId });
    Object.assign(row, defined(dto), { updated_by: actor.id });
    await this.settingsRepo.save(row);
    return this.settings(schoolId);
  }

  async categories(schoolId: number, query: CategoryQueryDto): Promise<CategoryDto[]> {
    const rows: Row[] = await this.dataSource.query(
      `SELECT c.*, p.name AS parent_name,
              CASE WHEN c.kind = 'asset'
                THEN (SELECT COUNT(*) FROM assets a WHERE a.category_id = c.id AND a.deleted_at IS NULL)
                ELSE (SELECT COUNT(*) FROM stock_items i WHERE i.category_id = c.id AND i.deleted_at IS NULL) END::int AS item_count
       FROM inventory_categories c LEFT JOIN inventory_categories p ON p.id = c.parent_id
       WHERE c.school_id = $1 AND c.deleted_at IS NULL ${query.kind ? 'AND c.kind = $2' : ''}
       ORDER BY c.kind, COALESCE(p.name, c.name), c.parent_id NULLS FIRST, c.name`,
      query.kind ? [schoolId, query.kind] : [schoolId],
    );
    return rows.map((row) => ({
      id: num(row.id),
      name: String(row.name),
      code: String(row.code),
      kind: row.kind as CategoryDto['kind'],
      parent: ref(row.parent_id, row.parent_name),
      depreciation_rate: numOrNull(row.depreciation_rate),
      useful_life_years: numOrNull(row.useful_life_years),
      maintenance_interval_days: numOrNull(row.maintenance_interval_days),
      description: str(row.description),
      item_count: num(row.item_count),
    }));
  }

  private async category(schoolId: number, id: number): Promise<InventoryCategory> {
    const row = await this.categoriesRepo.findOneBy({ id, school_id: schoolId });
    if (!row) throw AppException.notFound('Category not found', 'CATEGORY_NOT_FOUND');
    return row;
  }

  private async checkCategory(schoolId: number, dto: Partial<CategoryInputDto>, exceptId?: number, kind?: string) {
    if (dto.code !== undefined) {
      const clash = await this.categoriesRepo.findOneBy({ school_id: schoolId, code: dto.code, deleted_at: IsNull() });
      if (clash && clash.id !== exceptId)
        throw AppException.conflict(`Code ${dto.code} is already used`, 'CATEGORY_EXISTS');
    }
    if (dto.parent_id) {
      const parent = await this.category(schoolId, dto.parent_id);
      if (parent.id === exceptId)
        throw AppException.validation([{ field: 'parent_id', message: 'A category cannot be its own parent' }]);
      if (parent.parent_id) {
        throw AppException.validation([{ field: 'parent_id', message: 'Choose a main category as the parent' }]);
      }
      if (parent.kind !== (dto.kind ?? kind)) {
        throw AppException.validation([
          { field: 'parent_id', message: 'The parent must be the same kind (asset or stock)' },
        ]);
      }
    }
  }

  async createCategory(schoolId: number, dto: CategoryInputDto): Promise<CategoryDto> {
    await this.checkCategory(schoolId, dto);
    const saved = await this.categoriesRepo.save(this.categoriesRepo.create({ ...dto, school_id: schoolId }));
    return (await this.categories(schoolId, {})).find((row) => row.id === saved.id)!;
  }

  async updateCategory(schoolId: number, id: number, dto: CategoryUpdateDto): Promise<CategoryDto> {
    const current = await this.category(schoolId, id);
    await this.checkCategory(schoolId, dto, id, current.kind);
    if (dto.kind && dto.kind !== current.kind) {
      const [used] = await this.dataSource.query(
        `SELECT (SELECT COUNT(*) FROM assets WHERE category_id = $1 AND deleted_at IS NULL)
              + (SELECT COUNT(*) FROM stock_items WHERE category_id = $1 AND deleted_at IS NULL) AS count`,
        [id],
      );
      if (Number(used.count))
        throw AppException.conflict('This category has items; its kind cannot change', 'CATEGORY_IN_USE');
    }
    const fields = defined(dto);
    if (Object.keys(fields).length) await this.categoriesRepo.update(id, fields);
    return (await this.categories(schoolId, {})).find((row) => row.id === id)!;
  }

  async deleteCategory(schoolId: number, id: number): Promise<void> {
    await this.category(schoolId, id);
    const [used] = await this.dataSource.query(
      `SELECT (SELECT COUNT(*) FROM assets WHERE category_id = $1 AND deleted_at IS NULL)
            + (SELECT COUNT(*) FROM stock_items WHERE category_id = $1 AND deleted_at IS NULL)
            + (SELECT COUNT(*) FROM inventory_categories WHERE parent_id = $1 AND deleted_at IS NULL) AS count`,
      [id],
    );
    if (Number(used.count)) throw AppException.conflict('Move its items and sub-categories first', 'CATEGORY_IN_USE');
    await this.categoriesRepo.softDelete(id);
  }

  private locationSql(filter: SqlFilter, tail: string) {
    return `
      SELECT l.*, sec.id AS sec_id, c.name || ' - ' || sec.name AS sec_name,
             (SELECT COUNT(*) FROM assets a WHERE a.location_id = l.id AND a.deleted_at IS NULL AND a.status <> 'disposed')::int AS asset_count
      FROM inventory_locations l
      LEFT JOIN sections sec ON sec.id = l.section_id
      LEFT JOIN classes c ON c.id = sec.class_id
      WHERE l.deleted_at IS NULL ${filter.where.length ? `AND ${filter.where.join(' AND ')}` : ''} ${tail}`;
  }

  private presentLocation(row: Row): LocationDto {
    return {
      id: num(row.id),
      name: String(row.name),
      code: String(row.code),
      kind: row.kind as LocationDto['kind'],
      building: str(row.building),
      floor: str(row.floor),
      section: ref(row.sec_id, row.sec_name),
      is_active: Boolean(row.is_active),
      asset_count: num(row.asset_count),
    };
  }

  async locations(schoolId: number, query: LocationQueryDto): Promise<Paginated<LocationDto>> {
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`l.school_id = ${param(filter, schoolId)}`);
    if (query.kind) filter.where.push(`l.kind = ${param(filter, query.kind)}`);
    if (query.building) filter.where.push(`l.building = ${param(filter, query.building)}`);
    if (query.is_active !== undefined) filter.where.push(`l.is_active = ${param(filter, query.is_active)}`);
    addSearch(filter, query.search, ['l.name', 'l.code', 'l.building']);
    const order = orderBy(LOCATION_SORTS, query.sort, 'name', query.sort ? query.order : 'asc', 'l.id');
    const [{ total }]: { total: string }[] = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM (${this.locationSql(filter, '')}) counted`,
      filter.params,
    );
    const rows: Row[] = await this.dataSource.query(
      this.locationSql(filter, `ORDER BY ${order} LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`),
      filter.params,
    );
    return paginate([rows.map((row) => this.presentLocation(row)), Number(total)], query.page, query.limit);
  }

  private async location(schoolId: number, id: number): Promise<LocationDto> {
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`l.school_id = ${param(filter, schoolId)}`, `l.id = ${param(filter, id)}`);
    const [row]: Row[] = await this.dataSource.query(this.locationSql(filter, ''), filter.params);
    if (!row) throw AppException.notFound('Location not found', 'LOCATION_NOT_FOUND');
    return this.presentLocation(row);
  }

  private async checkLocation(schoolId: number, dto: Partial<LocationInputDto>, exceptId?: number) {
    if (dto.code !== undefined) {
      const clash = await this.locationsRepo.findOneBy({ school_id: schoolId, code: dto.code, deleted_at: IsNull() });
      if (clash && clash.id !== exceptId)
        throw AppException.conflict(`Code ${dto.code} is already used`, 'LOCATION_EXISTS');
    }
    if (dto.section_id) {
      const [section] = await this.dataSource.query(`SELECT id FROM sections WHERE id = $1 AND school_id = $2`, [
        dto.section_id,
        schoolId,
      ]);
      if (!section) throw AppException.validation([{ field: 'section_id', message: 'Section not found' }]);
    }
  }

  async createLocation(schoolId: number, dto: LocationInputDto): Promise<LocationDto> {
    await this.checkLocation(schoolId, dto);
    const saved = await this.locationsRepo.save(this.locationsRepo.create({ ...dto, school_id: schoolId }));
    return this.location(schoolId, saved.id);
  }

  async updateLocation(schoolId: number, id: number, dto: LocationUpdateDto): Promise<LocationDto> {
    await this.location(schoolId, id);
    await this.checkLocation(schoolId, dto, id);
    const fields = defined(dto);
    if (Object.keys(fields).length) await this.locationsRepo.update(id, fields);
    return this.location(schoolId, id);
  }

  async deleteLocation(schoolId: number, id: number): Promise<void> {
    const location = await this.location(schoolId, id);
    const [used] = await this.dataSource.query(
      `SELECT (SELECT COUNT(*) FROM assets WHERE location_id = $1 AND deleted_at IS NULL AND status <> 'disposed')
            + (SELECT COUNT(*) FROM asset_allocations WHERE location_id = $1 AND status = 'active' AND deleted_at IS NULL)
            + (SELECT COUNT(*) FROM inventory_stores WHERE location_id = $1 AND deleted_at IS NULL) AS count`,
      [id],
    );
    if (Number(used.count) || location.asset_count) {
      throw AppException.conflict('Move the assets and stores out of this location first', 'LOCATION_IN_USE');
    }
    await this.locationsRepo.softDelete(id);
  }

  async syncRooms(schoolId: number): Promise<DepartmentSyncResultDto> {
    const rooms: { room: string }[] = await this.dataSource.query(
      `SELECT DISTINCT room FROM timetable_slots WHERE school_id = $1 AND room IS NOT NULL AND trim(room) <> ''`,
      [schoolId],
    );
    let created = 0;
    for (const { room } of rooms) {
      const code = room.toUpperCase().slice(0, 30);
      if (await this.locationsRepo.existsBy({ school_id: schoolId, code, deleted_at: IsNull() })) continue;
      const [building, name] = room.includes('·') ? room.split('·').map((part) => part.trim()) : [null, room.trim()];
      await this.locationsRepo.save(
        this.locationsRepo.create({
          school_id: schoolId,
          code,
          name: (name || room).slice(0, 80),
          building: building ? building.slice(0, 40) : null,
          kind: 'classroom',
        }),
      );
      created += 1;
    }
    return { created, existing: rooms.length - created };
  }

  async departments(schoolId: number): Promise<DepartmentDto[]> {
    const rows: Row[] = await this.dataSource.query(
      `SELECT d.*, u.name AS head_name, hst.designation AS head_detail,
              (SELECT COUNT(*) FROM staff st WHERE st.school_id = d.school_id AND st.deleted_at IS NULL
                 AND st.status <> 'resigned' AND lower(trim(st.department)) = lower(d.name))::int AS staff_count,
              (SELECT COUNT(*) FROM assets a WHERE a.department_id = d.id AND a.deleted_at IS NULL AND a.status <> 'disposed')::int AS asset_count
       FROM departments d
       LEFT JOIN users u ON u.id = d.head_user_id
       LEFT JOIN staff hst ON hst.user_id = d.head_user_id AND hst.school_id = d.school_id AND hst.deleted_at IS NULL
       WHERE d.school_id = $1 AND d.deleted_at IS NULL ORDER BY d.name`,
      [schoolId],
    );
    return rows.map((row) => ({
      id: num(row.id),
      name: String(row.name),
      code: String(row.code),
      head: row.head_user_id
        ? { id: num(row.head_user_id), name: String(row.head_name ?? ''), detail: str(row.head_detail) }
        : null,
      description: str(row.description),
      is_active: Boolean(row.is_active),
      staff_count: num(row.staff_count),
      asset_count: num(row.asset_count),
    }));
  }

  private async department(schoolId: number, id: number): Promise<Department> {
    const row = await this.departmentsRepo.findOneBy({ id, school_id: schoolId });
    if (!row) throw AppException.notFound('Department not found', 'DEPARTMENT_NOT_FOUND');
    return row;
  }

  private async checkDepartment(schoolId: number, dto: Partial<DepartmentInputDto>, exceptId?: number) {
    if (dto.name !== undefined) {
      const [clash]: { id: number }[] = await this.dataSource.query(
        `SELECT id FROM departments WHERE school_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL`,
        [schoolId, dto.name],
      );
      if (clash && Number(clash.id) !== exceptId)
        throw AppException.conflict(`${dto.name} already exists`, 'DEPARTMENT_EXISTS');
    }
    if (dto.head_user_id) {
      const [staff] = await this.dataSource.query(
        `SELECT id FROM staff WHERE user_id = $1 AND school_id = $2 AND deleted_at IS NULL`,
        [dto.head_user_id, schoolId],
      );
      if (!staff) throw AppException.validation([{ field: 'head_user_id', message: 'Choose a staff member' }]);
    }
  }

  async createDepartment(schoolId: number, dto: DepartmentInputDto): Promise<DepartmentDto> {
    await this.checkDepartment(schoolId, dto);
    const saved = await this.departmentsRepo.save(
      this.departmentsRepo.create({
        ...dto,
        code: dto.code ?? (await this.freeDepartmentCode(schoolId, dto.name)),
        school_id: schoolId,
      }),
    );
    return (await this.departments(schoolId)).find((row) => row.id === saved.id)!;
  }

  private async freeDepartmentCode(schoolId: number, name: string): Promise<string> {
    const base = codeFrom(name, 'DEPT');
    for (let index = 0; index < 50; index += 1) {
      const code = index ? `${base}${index}` : base;
      if (!(await this.departmentsRepo.existsBy({ school_id: schoolId, code, deleted_at: IsNull() }))) return code;
    }
    return `${base}${Date.now() % 1000}`;
  }

  async updateDepartment(schoolId: number, id: number, dto: DepartmentUpdateDto): Promise<DepartmentDto> {
    await this.department(schoolId, id);
    await this.checkDepartment(schoolId, dto, id);
    const fields = defined(dto);
    if (Object.keys(fields).length) await this.departmentsRepo.update(id, fields);
    return (await this.departments(schoolId)).find((row) => row.id === id)!;
  }

  async deleteDepartment(schoolId: number, id: number): Promise<void> {
    await this.department(schoolId, id);
    const [used] = await this.dataSource.query(
      `SELECT (SELECT COUNT(*) FROM assets WHERE department_id = $1 AND deleted_at IS NULL AND status <> 'disposed')
            + (SELECT COUNT(*) FROM asset_allocations WHERE department_id = $1 AND status = 'active' AND deleted_at IS NULL) AS count`,
      [id],
    );
    if (Number(used.count)) throw AppException.conflict('This department still holds assets', 'DEPARTMENT_IN_USE');
    await this.departmentsRepo.softDelete(id);
  }

  async syncDepartments(schoolId: number): Promise<DepartmentSyncResultDto> {
    const names: { name: string }[] = await this.dataSource.query(
      `SELECT DISTINCT initcap(trim(department)) AS name FROM staff
       WHERE school_id = $1 AND deleted_at IS NULL AND department IS NOT NULL AND trim(department) <> ''`,
      [schoolId],
    );
    let created = 0;
    for (const { name } of names) {
      const [exists] = await this.dataSource.query(
        `SELECT 1 FROM departments WHERE school_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL`,
        [schoolId, name],
      );
      if (exists) continue;
      await this.departmentsRepo.save(
        this.departmentsRepo.create({
          school_id: schoolId,
          name: name.slice(0, 60),
          code: await this.freeDepartmentCode(schoolId, name),
        }),
      );
      created += 1;
    }
    return { created, existing: names.length - created };
  }

  async departmentAssets(schoolId: number, id: number): Promise<PeopleAssetsDto> {
    await this.department(schoolId, id);
    const current: SqlFilter = { where: [`al.status = 'active'`], params: [] };
    current.where.push(`al.department_id = ${param(current, id)}`);
    const history: SqlFilter = { where: [`al.status = 'returned'`], params: [] };
    history.where.push(`al.department_id = ${param(history, id)}`);
    return {
      current: await this.read.allocations(schoolId, current),
      history: await this.read.allocations(schoolId, history, 'al.returned_on DESC, al.id DESC', 50),
    };
  }

  async vendors(schoolId: number): Promise<VendorDto[]> {
    const rows: Row[] = await this.dataSource.query(
      `SELECT v.*,
              (SELECT COUNT(*) FROM assets a WHERE a.vendor_id = v.id AND a.deleted_at IS NULL)::int AS asset_count,
              (SELECT COUNT(*) FROM stock_receipts r WHERE r.vendor_id = v.id AND r.deleted_at IS NULL)::int AS receipt_count
       FROM inventory_vendors v WHERE v.school_id = $1 AND v.deleted_at IS NULL ORDER BY v.name`,
      [schoolId],
    );
    return rows.map((row) => ({
      id: num(row.id),
      name: String(row.name),
      contact_person: str(row.contact_person),
      phone: str(row.phone),
      email: str(row.email),
      gstin: str(row.gstin),
      address: str(row.address),
      supplies: str(row.supplies),
      is_active: Boolean(row.is_active),
      asset_count: num(row.asset_count),
      receipt_count: num(row.receipt_count),
    }));
  }

  async createVendor(schoolId: number, dto: VendorInputDto): Promise<VendorDto> {
    const saved = await this.vendorsRepo.save(this.vendorsRepo.create({ ...dto, school_id: schoolId }));
    return (await this.vendors(schoolId)).find((row) => row.id === saved.id)!;
  }

  async updateVendor(schoolId: number, id: number, dto: VendorUpdateDto): Promise<VendorDto> {
    if (!(await this.vendorsRepo.existsBy({ id, school_id: schoolId }))) {
      throw AppException.notFound('Vendor not found', 'VENDOR_NOT_FOUND');
    }
    const fields = defined(dto);
    if (Object.keys(fields).length) await this.vendorsRepo.update(id, fields);
    return (await this.vendors(schoolId)).find((row) => row.id === id)!;
  }

  async removeVendor(schoolId: number, id: number): Promise<void> {
    if (!(await this.vendorsRepo.existsBy({ id, school_id: schoolId }))) {
      throw AppException.notFound('Vendor not found', 'VENDOR_NOT_FOUND');
    }
    const [used] = await this.dataSource.query(
      `SELECT (SELECT COUNT(*) FROM assets WHERE (vendor_id = $1 OR amc_vendor_id = $1) AND deleted_at IS NULL)
            + (SELECT COUNT(*) FROM stock_receipts WHERE vendor_id = $1 AND deleted_at IS NULL)
            + (SELECT COUNT(*) FROM asset_maintenance_tickets WHERE vendor_id = $1 AND deleted_at IS NULL)
            + (SELECT COUNT(*) FROM asset_maintenance_schedules WHERE vendor_id = $1 AND deleted_at IS NULL) AS count`,
      [id],
    );
    if (Number(used.count)) {
      throw AppException.conflict(
        'This vendor is used by assets, receipts or maintenance; mark it inactive instead',
        'VENDOR_IN_USE',
      );
    }
    await this.vendorsRepo.softDelete({ id, school_id: schoolId });
  }

  async stores(schoolId: number): Promise<StoreDto[]> {
    const rows: Row[] = await this.dataSource.query(
      `SELECT s.*, l.name AS location_name, u.name AS keeper_name, kst.designation AS keeper_detail,
              (SELECT COUNT(*) FROM stock_balances b WHERE b.store_id = s.id AND b.quantity > 0)::int AS item_count,
              (SELECT COALESCE(SUM(b.value), 0) FROM stock_balances b WHERE b.store_id = s.id) AS stock_value
       FROM inventory_stores s
       LEFT JOIN inventory_locations l ON l.id = s.location_id
       LEFT JOIN users u ON u.id = s.keeper_user_id
       LEFT JOIN staff kst ON kst.user_id = s.keeper_user_id AND kst.school_id = s.school_id AND kst.deleted_at IS NULL
       WHERE s.school_id = $1 AND s.deleted_at IS NULL ORDER BY s.name`,
      [schoolId],
    );
    return rows.map((row) => ({
      id: num(row.id),
      name: String(row.name),
      code: String(row.code),
      location: ref(row.location_id, row.location_name),
      keeper: row.keeper_user_id
        ? { id: num(row.keeper_user_id), name: String(row.keeper_name ?? ''), detail: str(row.keeper_detail) }
        : null,
      is_active: Boolean(row.is_active),
      item_count: num(row.item_count),
      stock_value: num(row.stock_value),
    }));
  }

  private async checkStore(schoolId: number, dto: Partial<StoreInputDto>, exceptId?: number) {
    if (dto.code !== undefined) {
      const clash = await this.storesRepo.findOneBy({ school_id: schoolId, code: dto.code, deleted_at: IsNull() });
      if (clash && clash.id !== exceptId)
        throw AppException.conflict(`Code ${dto.code} is already used`, 'STORE_EXISTS');
    }
    if (dto.location_id && !(await this.locationsRepo.existsBy({ id: dto.location_id, school_id: schoolId }))) {
      throw AppException.validation([{ field: 'location_id', message: 'Location not found' }]);
    }
    if (dto.keeper_user_id) {
      const [staff] = await this.dataSource.query(
        `SELECT id FROM staff WHERE user_id = $1 AND school_id = $2 AND deleted_at IS NULL`,
        [dto.keeper_user_id, schoolId],
      );
      if (!staff) throw AppException.validation([{ field: 'keeper_user_id', message: 'Choose a staff member' }]);
    }
  }

  async createStore(schoolId: number, dto: StoreInputDto): Promise<StoreDto> {
    await this.checkStore(schoolId, dto);
    const saved = await this.storesRepo.save(this.storesRepo.create({ ...dto, school_id: schoolId }));
    return (await this.stores(schoolId)).find((row) => row.id === saved.id)!;
  }

  async updateStore(schoolId: number, id: number, dto: StoreUpdateDto): Promise<StoreDto> {
    if (!(await this.storesRepo.existsBy({ id, school_id: schoolId }))) {
      throw AppException.notFound('Store not found', 'STORE_NOT_FOUND');
    }
    await this.checkStore(schoolId, dto, id);
    const fields = defined(dto);
    if (Object.keys(fields).length) await this.storesRepo.update(id, fields);
    return (await this.stores(schoolId)).find((row) => row.id === id)!;
  }

  async removeStore(schoolId: number, id: number): Promise<void> {
    if (!(await this.storesRepo.existsBy({ id, school_id: schoolId }))) {
      throw AppException.notFound('Store not found', 'STORE_NOT_FOUND');
    }
    const [used] = await this.dataSource.query(
      `SELECT (SELECT COUNT(*) FROM stock_movements WHERE store_id = $1)
            + (SELECT COUNT(*) FROM assets WHERE store_id = $1 AND deleted_at IS NULL)
            + (SELECT COUNT(*) FROM requisitions WHERE store_id = $1)
            + (SELECT COUNT(*) FROM inventory_audits WHERE store_id = $1) AS count`,
      [id],
    );
    if (Number(used.count)) {
      throw AppException.conflict('This store has stock or assets; mark it inactive instead', 'STORE_IN_USE');
    }
    await this.storesRepo.softDelete({ id, school_id: schoolId });
  }
}
