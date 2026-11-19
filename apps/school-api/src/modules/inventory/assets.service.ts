import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { AppException, AuthUser, paginate, Paginated } from '@app/common';
import { INVENTORY_TEMPLATES } from '../notifications/inventory-templates.catalog';
import { SequencesService } from '../schools/sequences.service';
import { UploadedFileInput } from '../files/files.service';
import {
  AllocateDto,
  AllocationDto,
  AllocationQueryDto,
  AssetCreateDto,
  AssetCreateResultDto,
  AssetDto,
  AssetEventDto,
  AssetImportReportDto,
  AssetImportRowDto,
  AssetInputDto,
  AssetInsightsDto,
  AssetLabelsQueryDto,
  AssetQueryDto,
  AssetUpdateDto,
  AssignTargetDto,
  DecisionDto,
  DisposalDto,
  DisposalInputDto,
  DisposalQueryDto,
  MarkLostDto,
  RejectDto,
  ReturnAssetsDto,
  TransferDto,
  TransferInputDto,
  TransferQueryDto,
} from './dto/asset.dto';
import { MyAssetDto, MyReturnedAssetDto, PeopleAssetsDto } from './dto/operations.dto';
import {
  Asset,
  AssetAllocation,
  AssetCondition,
  AssetDisposal,
  AssetEventKind,
  AssetTransfer,
  AssetTransferItem,
  AssigneeType,
} from './entities/asset.entity';
import {
  Department,
  InventoryCategory,
  InventoryLocation,
  InventoryStore,
  InventoryVendor,
} from './entities/master.entity';
import { AssetMaintenanceSchedule, AssetMaintenanceTicket } from './entities/operations.entity';
import {
  allocationRefusal,
  assetTag,
  bookValue,
  codeFrom,
  disposalRefusal,
  documentNumber,
  nextDueDate,
  transferRefusal,
} from './inventory.logic';
import { assetLabelsPdf, assetTemplate, ParsedAssetRow, parseAssetRow, readAssetSheet } from './inventory-files';
import { INVENTORY_APPROVER_ROLES, InventoryNotifyService } from './inventory-notify.service';
import {
  addSearch,
  ASSIGNEE_COLUMNS,
  ASSIGNEE_JOINS,
  InventoryReadService,
  num,
  orderBy,
  param,
  Row,
  SqlFilter,
  str,
} from './inventory-read.service';

const ASSET_SORTS: Record<string, string> = {
  asset_tag: 'a.asset_tag',
  name: 'a.name',
  purchase_date: 'a.purchase_date',
  cost: 'a.cost',
  created_at: 'a.created_at',
};
const ALLOCATION_SORTS: Record<string, string> = {
  allocated_on: 'al.allocated_on',
  expected_return_on: 'al.expected_return_on',
  returned_on: 'al.returned_on',
};

interface Target {
  type: AssigneeType;
  user_id: number | null;
  department_id: number | null;
  location_id: number | null;
  label: string;
}

const defined = <T extends object>(dto: T) =>
  Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined)) as Partial<T>;

@Injectable()
export class AssetsService {
  private readonly sequences = new SequencesService();

  constructor(
    private readonly dataSource: DataSource,
    private readonly read: InventoryReadService,
    private readonly notify: InventoryNotifyService,
  ) {}

  async list(schoolId: number, query: AssetQueryDto): Promise<Paginated<AssetDto>> {
    const filter = await this.read.assetFilter(schoolId, query);
    const order = orderBy(ASSET_SORTS, query.sort, 'created_at', query.order, 'a.id DESC');
    return this.read.assetPage(schoolId, filter, order, query.page, query.limit);
  }

  async insights(schoolId: number): Promise<AssetInsightsDto> {
    const context = await this.read.context(schoolId);
    const [row]: Row[] = await this.dataSource.query(
      `SELECT COUNT(*) FILTER (WHERE a.status <> 'disposed')::int AS total,
              COALESCE(SUM(a.cost) FILTER (WHERE a.status <> 'disposed'), 0) AS total_cost,
              COUNT(*) FILTER (WHERE a.status = 'in_store')::int AS in_store,
              COUNT(*) FILTER (WHERE a.status = 'allocated')::int AS allocated,
              COUNT(*) FILTER (WHERE a.status = 'in_maintenance')::int AS in_maintenance,
              COUNT(*) FILTER (WHERE a.status = 'lost')::int AS lost,
              COUNT(*) FILTER (WHERE a.status = 'disposed')::int AS disposed,
              COUNT(*) FILTER (WHERE a.status <> 'disposed' AND
                GREATEST(COALESCE(a.warranty_until, '0001-01-01'::date), COALESCE(a.amc_until, '0001-01-01'::date))
                BETWEEN $2::date AND $2::date + $3::int)::int AS warranty_expiring,
              (SELECT COUNT(*) FROM asset_allocations al WHERE al.school_id = $1 AND al.status = 'active'
                 AND al.deleted_at IS NULL AND al.expected_return_on < $2::date)::int AS overdue_returns,
              (SELECT COUNT(*) FROM asset_allocations al WHERE al.school_id = $1 AND al.status = 'active'
                 AND al.deleted_at IS NULL AND al.assignee_type = 'staff' AND al.acknowledged_at IS NULL)::int AS unacknowledged
       FROM assets a WHERE a.school_id = $1 AND a.deleted_at IS NULL`,
      [schoolId, context.today, context.settings.warranty_alert_days],
    );
    const active = await this.read.assets(schoolId, { where: [`a.status <> 'disposed'`], params: [] }, 'a.id');
    return {
      total: num(row?.total),
      total_cost: num(row?.total_cost),
      book_value: Math.round(active.reduce((sum, asset) => sum + (asset.book_value ?? 0), 0) * 100) / 100,
      in_store: num(row?.in_store),
      allocated: num(row?.allocated),
      in_maintenance: num(row?.in_maintenance),
      lost: num(row?.lost),
      disposed: num(row?.disposed),
      warranty_expiring: num(row?.warranty_expiring),
      overdue_returns: num(row?.overdue_returns),
      unacknowledged: num(row?.unacknowledged),
    };
  }

  async get(schoolId: number, id: number, manager?: EntityManager): Promise<AssetDto> {
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`a.id = ${param(filter, id)}`);
    const [asset] = await this.read.assets(schoolId, filter, 'a.id', manager);
    if (!asset) throw AppException.notFound('Asset not found', 'ASSET_NOT_FOUND');
    return asset;
  }

  async lookup(schoolId: number, code: string): Promise<AssetDto> {
    const filter: SqlFilter = { where: [], params: [] };
    const key = param(filter, code.trim());
    filter.where.push(`(upper(a.asset_tag) = upper(${key}) OR upper(a.serial_no) = upper(${key}))`);
    const [asset] = await this.read.assets(schoolId, filter, 'a.id');
    if (!asset) throw AppException.notFound(`No asset has the tag or serial number ${code}`, 'ASSET_NOT_FOUND');
    return asset;
  }

  private async checkRefs(manager: EntityManager, schoolId: number, dto: Partial<AssetInputDto>) {
    if (dto.category_id !== undefined) {
      const category = await manager.findOneBy(InventoryCategory, { id: dto.category_id, school_id: schoolId });
      if (!category) throw AppException.validation([{ field: 'category_id', message: 'Category not found' }]);
      if (category.kind !== 'asset') {
        throw AppException.validation([{ field: 'category_id', message: 'Choose an asset category, not a stock one' }]);
      }
    }
    const checks: [keyof AssetInputDto, new () => object, string][] = [
      ['vendor_id', InventoryVendor, 'Vendor not found'],
      ['amc_vendor_id', InventoryVendor, 'Vendor not found'],
      ['location_id', InventoryLocation, 'Location not found'],
      ['store_id', InventoryStore, 'Store not found'],
    ];
    for (const [field, entity, message] of checks) {
      const value = dto[field] as number | null | undefined;
      if (value && !(await manager.existsBy(entity, { id: value, school_id: schoolId } as never))) {
        throw AppException.validation([{ field, message }]);
      }
    }
    if (dto.purchase_date && dto.warranty_until && dto.warranty_until < dto.purchase_date) {
      throw AppException.validation([
        { field: 'warranty_until', message: 'Warranty must end after the purchase date' },
      ]);
    }
  }

  private async nextTag(manager: EntityManager, schoolId: number, code: string, taken: Set<string>): Promise<string> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const tag = assetTag(code, await this.sequences.next(manager, schoolId, 'inventory_asset'));
      if (taken.has(tag)) continue;
      if (!(await manager.existsBy(Asset, { school_id: schoolId, asset_tag: tag, deleted_at: IsNull() }))) return tag;
    }
    throw AppException.conflict('Could not find a free asset tag', 'TAG_EXHAUSTED');
  }

  async createInTx(
    manager: EntityManager,
    schoolId: number,
    dto: AssetCreateDto,
    actorId: number | null,
  ): Promise<number[]> {
    await this.checkRefs(manager, schoolId, dto);
    const serials = dto.serial_nos ?? [];
    const quantity = Math.max(dto.quantity ?? 1, serials.length, 1);
    if (quantity > 1 && dto.serial_no) {
      throw AppException.validation([
        { field: 'serial_no', message: 'For several assets send serial_nos, one per asset' },
      ]);
    }
    const school = await this.read.schoolInfo(manager, schoolId);
    const category = await manager.findOneByOrFail(InventoryCategory, { id: dto.category_id });
    const taken = new Set<string>();
    const ids: number[] = [];
    const schedule = dto.schedule_maintenance;
    const fields: Partial<AssetCreateDto> = { ...dto };
    delete fields.quantity;
    delete fields.serial_nos;
    delete fields.schedule_maintenance;
    for (let index = 0; index < quantity; index += 1) {
      const tag = await this.nextTag(manager, schoolId, school.code, taken);
      taken.add(tag);
      const asset = await manager.save(
        manager.create(Asset, {
          ...fields,
          school_id: schoolId,
          asset_tag: tag,
          serial_no: serials[index] ?? (quantity === 1 ? (dto.serial_no ?? null) : null),
          funding_source: dto.funding_source ?? 'school',
          condition: dto.condition ?? 'new',
          status: 'in_store',
          created_by: actorId,
        }),
      );
      ids.push(asset.id);
      if (schedule && category.maintenance_interval_days) {
        await manager.save(
          manager.create(AssetMaintenanceSchedule, {
            school_id: schoolId,
            asset_id: asset.id,
            title: `${category.name} service`,
            interval_days: category.maintenance_interval_days,
            next_due_on: nextDueDate(dto.purchase_date ?? this.read.today(), category.maintenance_interval_days),
            vendor_id: dto.amc_vendor_id ?? dto.vendor_id ?? null,
            created_by: actorId,
          }),
        );
      }
    }
    await this.read.logEvents(
      manager,
      ids.map((id) => ({
        school_id: schoolId,
        asset_id: id,
        kind: 'registered' as const,
        note:
          [dto.invoice_no ? `Invoice ${dto.invoice_no}` : null, dto.funding_source ?? null]
            .filter(Boolean)
            .join(' · ') || null,
        actor_id: actorId,
      })),
    );
    return ids;
  }

  async create(schoolId: number, dto: AssetCreateDto, actor: AuthUser): Promise<AssetCreateResultDto> {
    const ids = await this.dataSource.transaction((manager) => this.createInTx(manager, schoolId, dto, actor.id));
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`a.id = ANY(${param(filter, ids)})`);
    return { assets: await this.read.assets(schoolId, filter, 'a.asset_tag') };
  }

  async update(schoolId: number, id: number, dto: AssetUpdateDto, actor: AuthUser): Promise<AssetDto> {
    await this.dataSource.transaction(async (manager) => {
      const asset = await manager.findOneBy(Asset, { id, school_id: schoolId });
      if (!asset) throw AppException.notFound('Asset not found', 'ASSET_NOT_FOUND');
      if (asset.status === 'disposed') throw AppException.conflict('This asset has been disposed', 'ASSET_DISPOSED');
      const purchaseDate = dto.purchase_date === undefined ? asset.purchase_date : dto.purchase_date;
      await this.checkRefs(manager, schoolId, { ...dto, purchase_date: purchaseDate ?? undefined });
      const fields = defined(dto);
      if (!Object.keys(fields).length) return;
      await manager.update(Asset, id, fields);
      const events: { kind: AssetEventKind; note: string }[] = [];
      if (dto.condition && dto.condition !== asset.condition) {
        events.push({ kind: 'condition_changed', note: `Condition ${asset.condition} → ${dto.condition}` });
      }
      const changed = Object.keys(fields).filter((key) => key !== 'condition');
      if (changed.length) events.push({ kind: 'edited', note: `Changed ${changed.join(', ')}` });
      await this.read.logEvents(
        manager,
        events.map((event) => ({ ...event, school_id: schoolId, asset_id: id, actor_id: actor.id })),
      );
    });
    return this.get(schoolId, id);
  }

  async remove(schoolId: number, id: number): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const asset = await manager.findOneBy(Asset, { id, school_id: schoolId });
      if (!asset) throw AppException.notFound('Asset not found', 'ASSET_NOT_FOUND');
      const [used] = await manager.query(
        `SELECT (SELECT COUNT(*) FROM asset_allocations WHERE asset_id = $1)
              + (SELECT COUNT(*) FROM asset_maintenance_tickets WHERE asset_id = $1)
              + (SELECT COUNT(*) FROM asset_transfer_items WHERE asset_id = $1)
              + (SELECT COUNT(*) FROM asset_disposals WHERE asset_id = $1) AS count`,
        [id],
      );
      if (asset.status !== 'in_store' || Number(used.count)) {
        throw AppException.conflict('This asset has history; dispose of it instead of deleting', 'ASSET_HAS_HISTORY');
      }
      await manager.update(AssetMaintenanceSchedule, { asset_id: id }, { is_active: false });
      await manager.softDelete(AssetMaintenanceSchedule, { asset_id: id });
      await manager.softDelete(Asset, id);
    });
  }

  async history(schoolId: number, id: number): Promise<AssetEventDto[]> {
    await this.get(schoolId, id);
    const rows: Row[] = await this.dataSource.query(
      `SELECT e.id, e.kind, e.note, e.ref_type, e.ref_id, e.created_at, u.name AS actor
       FROM asset_events e LEFT JOIN users u ON u.id = e.actor_id
       WHERE e.asset_id = $1 AND e.school_id = $2 ORDER BY e.created_at DESC, e.id DESC LIMIT 500`,
      [id, schoolId],
    );
    return rows.map((row) => ({
      id: num(row.id),
      kind: row.kind as AssetEventKind,
      note: str(row.note),
      ref_type: str(row.ref_type),
      ref_id: row.ref_id === null ? null : num(row.ref_id),
      actor: str(row.actor),
      created_at: row.created_at as Date,
    }));
  }

  private async lockAsset(manager: EntityManager, schoolId: number, id: number): Promise<Asset> {
    const asset = await manager.findOne(Asset, {
      where: { id, school_id: schoolId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!asset) throw AppException.notFound(`Asset ${id} not found`, 'ASSET_NOT_FOUND');
    return asset;
  }

  private async closeAllocation(
    manager: EntityManager,
    assetId: number,
    actorId: number | null,
    remarks: string,
    condition?: string,
  ) {
    const active = await manager.findOneBy(AssetAllocation, {
      asset_id: assetId,
      status: 'active',
      deleted_at: IsNull(),
    });
    if (!active) return null;
    await manager.update(AssetAllocation, active.id, {
      status: 'returned',
      returned_on: this.read.today(),
      return_condition: (condition as AssetAllocation['return_condition']) ?? null,
      returned_by: actorId,
      remarks: [active.remarks, remarks].filter(Boolean).join(' · ').slice(0, 255),
    });
    return active;
  }

  async markLost(schoolId: number, id: number, dto: MarkLostDto, actor: AuthUser): Promise<AssetDto> {
    await this.dataSource.transaction(async (manager) => {
      const asset = await this.lockAsset(manager, schoolId, id);
      if (asset.status === 'lost') throw AppException.conflict('This asset is already marked lost', 'ASSET_LOST');
      if (asset.status === 'disposed') throw AppException.conflict('This asset has been disposed', 'ASSET_DISPOSED');
      await this.refuseOpenTransfer(manager, [id]);
      await this.closeAllocation(manager, id, actor.id, 'Marked lost');
      await manager.update(Asset, id, { status: 'lost', custodian_user_id: null });
      await this.read.logEvents(manager, [
        { school_id: schoolId, asset_id: id, kind: 'marked_lost', note: dto.note, actor_id: actor.id },
      ]);
    });
    return this.get(schoolId, id);
  }

  async markFound(schoolId: number, id: number, actor: AuthUser): Promise<AssetDto> {
    await this.dataSource.transaction(async (manager) => {
      const asset = await this.lockAsset(manager, schoolId, id);
      if (asset.status !== 'lost') throw AppException.conflict('This asset is not marked lost', 'ASSET_NOT_LOST');
      await manager.update(Asset, id, { status: 'in_store', department_id: null });
      await this.read.logEvents(manager, [
        { school_id: schoolId, asset_id: id, kind: 'found', note: 'Back in store', actor_id: actor.id },
      ]);
    });
    return this.get(schoolId, id);
  }

  private async resolveTarget(manager: EntityManager, schoolId: number, dto: AssignTargetDto): Promise<Target> {
    if (dto.assignee_type === 'staff') {
      if (!dto.user_id) throw AppException.validation([{ field: 'user_id', message: 'Choose the staff member' }]);
      const [staff]: { name: string; status: string; department: string | null }[] = await manager.query(
        `SELECT u.name, st.status, st.department FROM staff st JOIN users u ON u.id = st.user_id
         WHERE st.user_id = $1 AND st.school_id = $2 AND st.deleted_at IS NULL`,
        [dto.user_id, schoolId],
      );
      if (!staff) throw AppException.validation([{ field: 'user_id', message: 'Staff member not found' }]);
      if (staff.status === 'resigned') throw AppException.conflict('This staff member has left', 'STAFF_LEFT');
      const [department]: { id: number }[] = staff.department
        ? await manager.query(
            `SELECT id FROM departments WHERE school_id = $1 AND lower(name) = lower(trim($2)) AND deleted_at IS NULL`,
            [schoolId, staff.department],
          )
        : [];
      return {
        type: 'staff',
        user_id: dto.user_id,
        department_id: department ? Number(department.id) : null,
        location_id: dto.location_id ?? null,
        label: staff.name,
      };
    }
    if (dto.assignee_type === 'department') {
      if (!dto.department_id)
        throw AppException.validation([{ field: 'department_id', message: 'Choose the department' }]);
      const department = await manager.findOneBy(Department, { id: dto.department_id, school_id: schoolId });
      if (!department) throw AppException.validation([{ field: 'department_id', message: 'Department not found' }]);
      return {
        type: 'department',
        user_id: department.head_user_id,
        department_id: department.id,
        location_id: dto.location_id ?? null,
        label: department.name,
      };
    }
    if (!dto.location_id) throw AppException.validation([{ field: 'location_id', message: 'Choose the location' }]);
    const location = await manager.findOneBy(InventoryLocation, { id: dto.location_id, school_id: schoolId });
    if (!location) throw AppException.validation([{ field: 'location_id', message: 'Location not found' }]);
    return { type: 'location', user_id: null, department_id: null, location_id: location.id, label: location.name };
  }

  private async assign(
    manager: EntityManager,
    schoolId: number,
    asset: Asset,
    target: Target,
    actorId: number | null,
    extra: { allocated_on: string; expected_return_on: string | null; remarks: string | null },
  ): Promise<AssetAllocation> {
    if (
      target.location_id &&
      !(await manager.existsBy(InventoryLocation, { id: target.location_id, school_id: schoolId }))
    ) {
      throw AppException.validation([{ field: 'location_id', message: 'Location not found' }]);
    }
    const allocation = await manager.save(
      manager.create(AssetAllocation, {
        school_id: schoolId,
        asset_id: asset.id,
        assignee_type: target.type,
        user_id: target.type === 'staff' ? target.user_id : null,
        department_id: target.type === 'department' ? target.department_id : null,
        location_id: target.type === 'location' ? target.location_id : null,
        allocated_on: extra.allocated_on,
        expected_return_on: extra.expected_return_on,
        status: 'active',
        allocated_by: actorId,
        remarks: extra.remarks,
        created_by: actorId,
      }),
    );
    await manager.update(Asset, asset.id, {
      status: 'allocated',
      custodian_user_id: target.user_id,
      department_id: target.department_id,
      location_id: target.location_id ?? asset.location_id,
    });
    return allocation;
  }

  private async refuseOpenTransfer(manager: EntityManager, assetIds: number[]): Promise<void> {
    const inTransfer = await this.openTransferOf(manager, assetIds);
    if (inTransfer) {
      throw AppException.conflict(
        'This asset has an open transfer; approve, reject or cancel it first',
        'ASSET_IN_TRANSFER',
      );
    }
  }

  private async openTransferOf(manager: EntityManager, assetIds: number[]): Promise<number | null> {
    const [row]: { asset_id: number }[] = await manager.query(
      `SELECT i.asset_id FROM asset_transfer_items i JOIN asset_transfers t ON t.id = i.transfer_id
       WHERE i.asset_id = ANY($1) AND t.status IN ('requested', 'approved') LIMIT 1`,
      [assetIds],
    );
    return row ? Number(row.asset_id) : null;
  }

  async allocate(schoolId: number, dto: AllocateDto, actor: AuthUser): Promise<AllocationDto[]> {
    const today = this.read.today();
    const allocatedOn = dto.allocated_on ?? today;
    if (allocatedOn > today)
      throw AppException.validation([{ field: 'allocated_on', message: 'The date cannot be in the future' }]);
    if (dto.expected_return_on && dto.expected_return_on < allocatedOn) {
      throw AppException.validation([
        { field: 'expected_return_on', message: 'Pick a date after the allocation date' },
      ]);
    }
    const { ids, target, tags } = await this.dataSource.transaction(async (manager) => {
      const target = await this.resolveTarget(manager, schoolId, dto);
      const inTransfer = await this.openTransferOf(manager, dto.asset_ids);
      if (inTransfer) throw AppException.conflict(`Asset ${inTransfer} has an open transfer`, 'ASSET_IN_TRANSFER');
      const ids: number[] = [];
      const tags: string[] = [];
      for (const assetId of dto.asset_ids) {
        const asset = await this.lockAsset(manager, schoolId, assetId);
        const refusal = allocationRefusal(asset.status);
        if (refusal)
          throw AppException.conflict(`${asset.asset_tag} (${asset.name}): ${refusal.message}`, refusal.code);
        const allocation = await this.assign(manager, schoolId, asset, target, actor.id, {
          allocated_on: allocatedOn,
          expected_return_on: dto.expected_return_on ?? null,
          remarks: dto.remarks ?? null,
        });
        ids.push(allocation.id);
        tags.push(`${asset.name} (${asset.asset_tag})`);
        await this.read.logEvents(manager, [
          {
            school_id: schoolId,
            asset_id: asset.id,
            kind: 'allocated',
            note: `To ${target.label}${dto.expected_return_on ? `, back by ${dto.expected_return_on}` : ''}`,
            ref_type: 'allocation',
            ref_id: allocation.id,
            actor_id: actor.id,
          },
        ]);
      }
      return { ids, target, tags };
    });
    if (target.type === 'staff') await this.tellAssigned(target.user_id, tags);
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`al.id = ANY(${param(filter, ids)})`);
    return this.read.allocations(schoolId, filter, 'al.id');
  }

  private async tellAssigned(userId: number | null, tags: string[]) {
    if (!userId || !tags.length) return;
    await this.notify.users([userId], INVENTORY_TEMPLATES.INVENTORY_ASSET_ASSIGNED, {
      assets: tags.length > 3 ? `${tags.slice(0, 3).join(', ')} and ${tags.length - 3} more` : tags.join(', '),
      verb: tags.length === 1 ? 'is' : 'are',
      them: tags.length === 1 ? 'it' : 'them',
      count: String(tags.length),
    });
  }

  async returnAssets(schoolId: number, dto: ReturnAssetsDto, actor: AuthUser): Promise<AllocationDto[]> {
    const ids = await this.dataSource.transaction(async (manager) => {
      let store: InventoryStore | null = null;
      if (dto.store_id) {
        store = await manager.findOneBy(InventoryStore, { id: dto.store_id, school_id: schoolId });
        if (!store) throw AppException.validation([{ field: 'store_id', message: 'Store not found' }]);
      }
      const closed: number[] = [];
      for (const assetId of dto.asset_ids) {
        const asset = await this.lockAsset(manager, schoolId, assetId);
        const active = await this.closeAllocation(
          manager,
          asset.id,
          actor.id,
          dto.remarks ?? 'Returned',
          dto.condition,
        );
        if (!active) throw AppException.conflict(`${asset.asset_tag} is not allocated`, 'NOT_ALLOCATED');
        closed.push(active.id);
        const condition = dto.condition ?? asset.condition;
        await manager.update(Asset, asset.id, {
          status: dto.send_to_maintenance ? 'in_maintenance' : 'in_store',
          condition,
          custodian_user_id: null,
          department_id: null,
          store_id: store?.id ?? asset.store_id,
          location_id: store?.location_id ?? asset.location_id,
        });
        const events: Parameters<InventoryReadService['logEvents']>[1] = [
          {
            school_id: schoolId,
            asset_id: asset.id,
            kind: 'returned',
            note: [`Condition ${condition}`, dto.remarks].filter(Boolean).join(' · '),
            ref_type: 'allocation',
            ref_id: active.id,
            actor_id: actor.id,
          },
        ];
        if (dto.send_to_maintenance) {
          const year = this.read.today().slice(0, 4);
          const school = await this.read.schoolInfo(manager, schoolId);
          const ticket = await manager.save(
            manager.create(AssetMaintenanceTicket, {
              school_id: schoolId,
              ticket_no: documentNumber(
                school.code,
                'MNT',
                year,
                await this.sequences.next(manager, schoolId, `inventory_ticket:${year}`),
              ),
              asset_id: asset.id,
              kind: 'breakdown',
              title: `Check after return${dto.remarks ? `: ${dto.remarks}` : ''}`.slice(0, 120),
              priority: condition === 'damaged' ? 'high' : 'medium',
              status: 'open',
              reported_by: actor.id,
              under_warranty: Boolean(
                (asset.warranty_until && asset.warranty_until >= this.read.today()) ||
                (asset.amc_until && asset.amc_until >= this.read.today()),
              ),
              opened_at: new Date(),
              created_by: actor.id,
            }),
          );
          events.push({
            school_id: schoolId,
            asset_id: asset.id,
            kind: 'maintenance_opened',
            note: ticket.ticket_no,
            ref_type: 'ticket',
            ref_id: ticket.id,
            actor_id: actor.id,
          });
        }
        await this.read.logEvents(manager, events);
      }
      return closed;
    });
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`al.id = ANY(${param(filter, ids)})`);
    return this.read.allocations(schoolId, filter, 'al.id');
  }

  async allocations(schoolId: number, query: AllocationQueryDto): Promise<Paginated<AllocationDto>> {
    const filter: SqlFilter = { where: [], params: [] };
    const today = this.read.today();
    if (query.status) filter.where.push(`al.status = ${param(filter, query.status)}`);
    if (query.assignee_type) filter.where.push(`al.assignee_type = ${param(filter, query.assignee_type)}`);
    if (query.user_id) filter.where.push(`al.user_id = ${param(filter, query.user_id)}`);
    if (query.department_id) filter.where.push(`al.department_id = ${param(filter, query.department_id)}`);
    if (query.location_id) filter.where.push(`al.location_id = ${param(filter, query.location_id)}`);
    if (query.asset_id) filter.where.push(`al.asset_id = ${param(filter, query.asset_id)}`);
    if (query.overdue) {
      filter.where.push(`al.status = 'active' AND al.expected_return_on < ${param(filter, today)}::date`);
    }
    if (query.unacknowledged) {
      filter.where.push(`al.status = 'active' AND al.assignee_type = 'staff' AND al.acknowledged_at IS NULL`);
    }
    addSearch(filter, query.search, ['a.asset_tag', 'a.name', 'alu.name', 'ald.name', 'alloc.name']);
    const order = orderBy(ALLOCATION_SORTS, query.sort, 'allocated_on', query.order, 'al.id DESC');
    return this.read.allocationPage(schoolId, filter, order, query.page, query.limit);
  }

  async acknowledge(schoolId: number, id: number, actor: AuthUser, self: boolean): Promise<AllocationDto> {
    const allocation = await this.dataSource.getRepository(AssetAllocation).findOneBy({ id, deleted_at: IsNull() });
    if (!allocation || (!self && allocation.school_id !== schoolId) || (self && allocation.user_id !== actor.id)) {
      throw AppException.notFound('Allocation not found', 'ALLOCATION_NOT_FOUND');
    }
    if (allocation.status !== 'active')
      throw AppException.conflict('This asset was already returned', 'ALLOCATION_CLOSED');
    if (allocation.acknowledged_at) throw AppException.conflict('Already marked as received', 'ALREADY_ACKNOWLEDGED');
    await this.dataSource.transaction(async (manager) => {
      await manager.update(AssetAllocation, id, { acknowledged_at: new Date() });
      await this.read.logEvents(manager, [
        {
          school_id: allocation.school_id,
          asset_id: allocation.asset_id,
          kind: 'acknowledged',
          note: self ? 'Confirmed by the staff member' : 'Marked received by the office',
          ref_type: 'allocation',
          ref_id: id,
          actor_id: actor.id,
        },
      ]);
    });
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`al.id = ${param(filter, id)}`);
    const [row] = await this.read.allocations(allocation.school_id, filter);
    return row!;
  }

  private transferSql(filter: SqlFilter, tail: string) {
    return `
      SELECT t.*, ru.name AS requested_by_name, du.name AS decided_by_name, ${ASSIGNEE_COLUMNS('t2', 'to')},
             (SELECT json_agg(json_build_object('asset_id', a.id, 'asset_tag', a.asset_tag, 'name', a.name, 'from', i.from_label) ORDER BY a.asset_tag)
                FROM asset_transfer_items i JOIN assets a ON a.id = i.asset_id WHERE i.transfer_id = t.id) AS items
      FROM asset_transfers t
      CROSS JOIN LATERAL (SELECT t.school_id, t.to_type AS assignee_type, t.to_user_id AS user_id,
                                 t.to_department_id AS department_id, t.to_location_id AS location_id) t2
      ${ASSIGNEE_JOINS('t2', 'to')}
      LEFT JOIN users ru ON ru.id = t.requested_by
      LEFT JOIN users du ON du.id = t.decided_by
      WHERE t.deleted_at IS NULL ${filter.where.length ? `AND ${filter.where.join(' AND ')}` : ''} ${tail}`;
  }

  private presentTransfer(row: Row): TransferDto {
    return {
      id: num(row.id),
      transfer_no: String(row.transfer_no),
      to: this.read.assignee(row, 'to'),
      items: ((row.items as TransferDto['items'] | null) ?? []).map((item) => ({
        ...item,
        asset_id: num(item.asset_id),
      })),
      reason: String(row.reason),
      status: row.status as TransferDto['status'],
      requested_by: str(row.requested_by_name),
      decided_by: str(row.decided_by_name),
      decided_at: (row.decided_at as Date | null) ?? null,
      decision_note: str(row.decision_note),
      completed_at: (row.completed_at as Date | null) ?? null,
      created_at: row.created_at as Date,
    };
  }

  async transfers(schoolId: number, query: TransferQueryDto): Promise<Paginated<TransferDto>> {
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`t.school_id = ${param(filter, schoolId)}`);
    if (query.status) filter.where.push(`t.status = ${param(filter, query.status)}`);
    if (query.asset_id) {
      filter.where.push(
        `EXISTS (SELECT 1 FROM asset_transfer_items i WHERE i.transfer_id = t.id AND i.asset_id = ${param(filter, query.asset_id)})`,
      );
    }
    addSearch(filter, query.search, [
      't.transfer_no',
      't.reason',
      `(SELECT string_agg(a.asset_tag || ' ' || a.name, ' ') FROM asset_transfer_items i JOIN assets a ON a.id = i.asset_id WHERE i.transfer_id = t.id)`,
    ]);
    const [{ total }]: { total: string }[] = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM (${this.transferSql(filter, '')}) counted`,
      filter.params,
    );
    const rows: Row[] = await this.dataSource.query(
      this.transferSql(
        filter,
        `ORDER BY t.created_at ${query.order === 'asc' ? 'ASC' : 'DESC'}, t.id DESC LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      ),
      filter.params,
    );
    return paginate([rows.map((row) => this.presentTransfer(row)), Number(total)], query.page, query.limit);
  }

  async transfer(schoolId: number, id: number, manager?: EntityManager): Promise<TransferDto> {
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`t.school_id = ${param(filter, schoolId)}`, `t.id = ${param(filter, id)}`);
    const [row]: Row[] = await (manager ?? this.dataSource.manager).query(this.transferSql(filter, ''), filter.params);
    if (!row) throw AppException.notFound('Transfer not found', 'TRANSFER_NOT_FOUND');
    return this.presentTransfer(row);
  }

  private async currentLabel(manager: EntityManager, assetId: number): Promise<string> {
    const [row]: Row[] = await manager.query(
      `SELECT ${ASSIGNEE_COLUMNS('al', 'al')} FROM asset_allocations al ${ASSIGNEE_JOINS('al', 'al')}
       WHERE al.asset_id = $1 AND al.status = 'active' AND al.deleted_at IS NULL`,
      [assetId],
    );
    if (!row) return 'Store';
    const assignee = this.read.assignee(row, 'al');
    return assignee.name;
  }

  async createTransfer(schoolId: number, dto: TransferInputDto, actor: AuthUser): Promise<TransferDto> {
    const settings = await this.read.settings(schoolId);
    const transferId = await this.dataSource.transaction(async (manager) => {
      const target = await this.resolveTarget(manager, schoolId, dto);
      const inTransfer = await this.openTransferOf(manager, dto.asset_ids);
      if (inTransfer)
        throw AppException.conflict(`Asset ${inTransfer} already has an open transfer`, 'ASSET_IN_TRANSFER');
      const assets: Asset[] = [];
      for (const assetId of dto.asset_ids) {
        const asset = await this.lockAsset(manager, schoolId, assetId);
        const refusal = transferRefusal(asset.status);
        if (refusal)
          throw AppException.conflict(`${asset.asset_tag} (${asset.name}): ${refusal.message}`, refusal.code);
        if (asset.status === 'in_maintenance') {
          throw AppException.conflict(`${asset.asset_tag} is under maintenance`, 'ASSET_IN_MAINTENANCE');
        }
        assets.push(asset);
      }
      const school = await this.read.schoolInfo(manager, schoolId);
      const year = this.read.today().slice(0, 4);
      const transfer = await manager.save(
        manager.create(AssetTransfer, {
          school_id: schoolId,
          transfer_no: documentNumber(
            school.code,
            'TRF',
            year,
            await this.sequences.next(manager, schoolId, `inventory_transfer:${year}`),
          ),
          to_type: target.type,
          to_user_id: target.type === 'staff' ? target.user_id : null,
          to_department_id: target.type === 'department' ? target.department_id : null,
          to_location_id: target.location_id,
          reason: dto.reason,
          status: 'requested',
          requested_by: actor.id,
          created_by: actor.id,
        }),
      );
      for (const asset of assets) {
        await manager.insert(AssetTransferItem, {
          school_id: schoolId,
          transfer_id: transfer.id,
          asset_id: asset.id,
          from_label: (await this.currentLabel(manager, asset.id)).slice(0, 120),
        });
      }
      await this.read.logEvents(
        manager,
        assets.map((asset) => ({
          school_id: schoolId,
          asset_id: asset.id,
          kind: 'transfer_requested' as const,
          note: `${transfer.transfer_no} to ${target.label}: ${dto.reason}`,
          ref_type: 'transfer',
          ref_id: transfer.id,
          actor_id: actor.id,
        })),
      );
      if (!settings.approve_transfers) await this.completeTransfer(manager, schoolId, transfer.id, actor.id, null);
      return transfer.id;
    });
    const result = await this.transfer(schoolId, transferId);
    if (settings.approve_transfers) {
      await this.notify.roles(schoolId, INVENTORY_APPROVER_ROLES, INVENTORY_TEMPLATES.INVENTORY_APPROVAL_NEEDED, {
        kind: 'Asset transfer',
        number: result.transfer_no,
        summary: `${result.items.length} ${result.items.length === 1 ? 'asset' : 'assets'} to ${result.to.name}`,
        by: actor.name,
        transfer_id: String(result.id),
      });
    } else if (result.to.type === 'staff') {
      await this.tellAssigned(
        result.to.id,
        result.items.map((item) => `${item.name} (${item.asset_tag})`),
      );
    }
    return result;
  }

  private async completeTransfer(
    manager: EntityManager,
    schoolId: number,
    transferId: number,
    actorId: number,
    note: string | null,
  ): Promise<void> {
    const transfer = await manager.findOneOrFail(AssetTransfer, {
      where: { id: transferId },
      lock: { mode: 'pessimistic_write' },
    });
    const items = await manager.findBy(AssetTransferItem, { transfer_id: transferId });
    const target: Target = {
      type: transfer.to_type,
      user_id: transfer.to_user_id,
      department_id: transfer.to_department_id,
      location_id: transfer.to_location_id,
      label: '',
    };
    const resolved = await this.resolveTarget(manager, schoolId, {
      assignee_type: transfer.to_type,
      user_id: transfer.to_user_id ?? undefined,
      department_id: transfer.to_department_id ?? undefined,
      location_id: transfer.to_location_id ?? undefined,
    });
    Object.assign(target, resolved);
    for (const item of items) {
      const asset = await this.lockAsset(manager, schoolId, item.asset_id);
      const refusal = transferRefusal(asset.status);
      if (refusal) throw AppException.conflict(`${asset.asset_tag}: ${refusal.message}`, refusal.code);
      await this.closeAllocation(manager, asset.id, actorId, `Transferred ${transfer.transfer_no}`);
      const allocation = await this.assign(manager, schoolId, asset, target, actorId, {
        allocated_on: this.read.today(),
        expected_return_on: null,
        remarks: `${transfer.transfer_no}: ${transfer.reason}`.slice(0, 255),
      });
      await this.read.logEvents(manager, [
        {
          school_id: schoolId,
          asset_id: asset.id,
          kind: 'transferred',
          note: `${transfer.transfer_no}: ${item.from_label ?? 'Store'} → ${target.label}`,
          ref_type: 'allocation',
          ref_id: allocation.id,
          actor_id: actorId,
        },
      ]);
    }
    const now = new Date();
    await manager.update(AssetTransfer, transferId, {
      status: 'completed',
      completed_at: now,
      completed_by: actorId,
      ...(transfer.status === 'requested' ? { decided_by: actorId, decided_at: now, decision_note: note } : {}),
    });
  }

  private async requestedTransfer(manager: EntityManager, schoolId: number, id: number): Promise<AssetTransfer> {
    const transfer = await manager.findOne(AssetTransfer, {
      where: { id, school_id: schoolId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!transfer) throw AppException.notFound('Transfer not found', 'TRANSFER_NOT_FOUND');
    if (transfer.status !== 'requested')
      throw AppException.conflict(`This transfer is ${transfer.status}`, 'TRANSFER_CLOSED');
    return transfer;
  }

  async approveTransfer(schoolId: number, id: number, dto: DecisionDto, actor: AuthUser): Promise<TransferDto> {
    const requestedBy = await this.dataSource.transaction(async (manager) => {
      const transfer = await this.requestedTransfer(manager, schoolId, id);
      await this.completeTransfer(manager, schoolId, id, actor.id, dto.note ?? null);
      return transfer.requested_by;
    });
    const result = await this.transfer(schoolId, id);
    if (result.to.type === 'staff') {
      await this.tellAssigned(
        result.to.id,
        result.items.map((item) => `${item.name} (${item.asset_tag})`),
      );
    }
    await this.tellRequester(
      requestedBy,
      actor.id,
      'Asset transfer',
      result.transfer_no,
      `${result.items.length} to ${result.to.name}`,
      'approved',
      dto.note,
    );
    return result;
  }

  async rejectTransfer(schoolId: number, id: number, dto: RejectDto, actor: AuthUser): Promise<TransferDto> {
    const requestedBy = await this.dataSource.transaction(async (manager) => {
      const transfer = await this.requestedTransfer(manager, schoolId, id);
      await manager.update(AssetTransfer, id, {
        status: 'rejected',
        decided_by: actor.id,
        decided_at: new Date(),
        decision_note: dto.note,
      });
      return transfer.requested_by;
    });
    const result = await this.transfer(schoolId, id);
    await this.tellRequester(
      requestedBy,
      actor.id,
      'Asset transfer',
      result.transfer_no,
      `${result.items.length} to ${result.to.name}`,
      'rejected',
      dto.note,
    );
    return result;
  }

  async cancelTransfer(schoolId: number, id: number, actor: AuthUser): Promise<TransferDto> {
    await this.dataSource.transaction(async (manager) => {
      await this.requestedTransfer(manager, schoolId, id);
      await manager.update(AssetTransfer, id, { status: 'cancelled', decided_by: actor.id, decided_at: new Date() });
    });
    return this.transfer(schoolId, id);
  }

  async tellRequester(
    requestedBy: number | null,
    actorId: number,
    kind: string,
    number: string,
    summary: string,
    status: string,
    note?: string | null,
  ) {
    if (!requestedBy || requestedBy === actorId) return;
    await this.notify.users([requestedBy], INVENTORY_TEMPLATES.INVENTORY_REQUEST_UPDATE, {
      kind,
      number,
      summary,
      status,
      note: note ? ` Note: ${note}` : '',
    });
  }

  private disposalSql(filter: SqlFilter, tail: string) {
    return `
      SELECT d.*, a.asset_tag, a.name AS asset_name, ru.name AS requested_by_name, du.name AS decided_by_name
      FROM asset_disposals d JOIN assets a ON a.id = d.asset_id
      LEFT JOIN users ru ON ru.id = d.requested_by LEFT JOIN users du ON du.id = d.decided_by
      WHERE d.deleted_at IS NULL ${filter.where.length ? `AND ${filter.where.join(' AND ')}` : ''} ${tail}`;
  }

  private presentDisposal(row: Row): DisposalDto {
    return {
      id: num(row.id),
      disposal_no: String(row.disposal_no),
      asset: { id: num(row.asset_id), name: `${row.asset_tag} · ${row.asset_name}` },
      asset_tag: String(row.asset_tag),
      method: row.method as DisposalDto['method'],
      reason: String(row.reason),
      value_realised: row.value_realised === null ? null : num(row.value_realised),
      book_value: row.book_value === null ? null : num(row.book_value),
      status: row.status as DisposalDto['status'],
      requested_by: str(row.requested_by_name),
      decided_by: str(row.decided_by_name),
      decided_at: (row.decided_at as Date | null) ?? null,
      decision_note: str(row.decision_note),
      created_at: row.created_at as Date,
    };
  }

  async disposals(schoolId: number, query: DisposalQueryDto): Promise<Paginated<DisposalDto>> {
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`d.school_id = ${param(filter, schoolId)}`);
    if (query.status) filter.where.push(`d.status = ${param(filter, query.status)}`);
    if (query.method) filter.where.push(`d.method = ${param(filter, query.method)}`);
    addSearch(filter, query.search, ['d.disposal_no', 'a.asset_tag', 'a.name', 'd.reason']);
    const [{ total }]: { total: string }[] = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM (${this.disposalSql(filter, '')}) counted`,
      filter.params,
    );
    const rows: Row[] = await this.dataSource.query(
      this.disposalSql(
        filter,
        `ORDER BY d.created_at ${query.order === 'asc' ? 'ASC' : 'DESC'}, d.id DESC LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      ),
      filter.params,
    );
    return paginate([rows.map((row) => this.presentDisposal(row)), Number(total)], query.page, query.limit);
  }

  private async disposal(schoolId: number, id: number): Promise<DisposalDto> {
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`d.school_id = ${param(filter, schoolId)}`, `d.id = ${param(filter, id)}`);
    const [row]: Row[] = await this.dataSource.query(this.disposalSql(filter, ''), filter.params);
    if (!row) throw AppException.notFound('Disposal not found', 'DISPOSAL_NOT_FOUND');
    return this.presentDisposal(row);
  }

  private async applyDisposal(
    manager: EntityManager,
    schoolId: number,
    disposal: AssetDisposal,
    actorId: number,
    note: string | null,
  ) {
    const asset = await this.lockAsset(manager, schoolId, disposal.asset_id);
    const refusal = disposalRefusal(asset.status);
    if (refusal) throw AppException.conflict(refusal.message, refusal.code);
    await manager.update(Asset, asset.id, { status: 'disposed', disposed_at: new Date(), custodian_user_id: null });
    await manager.update(AssetMaintenanceSchedule, { asset_id: asset.id }, { is_active: false });
    await manager
      .createQueryBuilder()
      .update(AssetMaintenanceTicket)
      .set({ status: 'cancelled', resolution: 'Asset disposed', resolved_at: new Date() })
      .where(`asset_id = :id AND status IN ('open', 'in_progress')`, { id: asset.id })
      .execute();
    const now = new Date();
    await manager.update(AssetDisposal, disposal.id, {
      status: 'approved',
      decided_by: actorId,
      decided_at: now,
      decision_note: note,
    });
    await this.read.logEvents(manager, [
      {
        school_id: schoolId,
        asset_id: asset.id,
        kind: 'disposed',
        note: `${disposal.disposal_no}: ${disposal.method} · ${disposal.reason}`,
        ref_type: 'disposal',
        ref_id: disposal.id,
        actor_id: actorId,
      },
    ]);
  }

  async createDisposal(schoolId: number, dto: DisposalInputDto, actor: AuthUser): Promise<DisposalDto> {
    const settings = await this.read.settings(schoolId);
    const id = await this.dataSource.transaction(async (manager) => {
      const asset = await this.lockAsset(manager, schoolId, dto.asset_id);
      const refusal = disposalRefusal(asset.status);
      if (refusal) throw AppException.conflict(refusal.message, refusal.code);
      await this.refuseOpenTransfer(manager, [asset.id]);
      if (await manager.existsBy(AssetDisposal, { asset_id: asset.id, status: 'requested', deleted_at: IsNull() })) {
        throw AppException.conflict('This asset already has a disposal request', 'DISPOSAL_OPEN');
      }
      const [category]: { depreciation_rate: string | null; useful_life_years: number | null }[] = await manager.query(
        `SELECT depreciation_rate, useful_life_years FROM inventory_categories WHERE id = $1`,
        [asset.category_id],
      );
      const school = await this.read.schoolInfo(manager, schoolId);
      const year = this.read.today().slice(0, 4);
      const disposal = await manager.save(
        manager.create(AssetDisposal, {
          school_id: schoolId,
          disposal_no: documentNumber(
            school.code,
            'DSP',
            year,
            await this.sequences.next(manager, schoolId, `inventory_disposal:${year}`),
          ),
          asset_id: asset.id,
          method: dto.method,
          reason: dto.reason,
          value_realised: dto.value_realised ?? null,
          book_value: bookValue(
            {
              cost: asset.cost === null ? null : Number(asset.cost),
              residual_value: asset.residual_value === null ? null : Number(asset.residual_value),
              purchase_date: asset.purchase_date,
              rate:
                category?.depreciation_rate === null || category?.depreciation_rate === undefined
                  ? null
                  : Number(category.depreciation_rate),
              useful_life_years: category?.useful_life_years ?? null,
              method: settings.depreciation_method,
            },
            this.read.today(),
          ),
          status: 'requested',
          requested_by: actor.id,
          created_by: actor.id,
        }),
      );
      await this.read.logEvents(manager, [
        {
          school_id: schoolId,
          asset_id: asset.id,
          kind: 'disposal_requested',
          note: `${disposal.disposal_no}: ${dto.method} · ${dto.reason}`,
          ref_type: 'disposal',
          ref_id: disposal.id,
          actor_id: actor.id,
        },
      ]);
      if (!settings.approve_disposals) await this.applyDisposal(manager, schoolId, disposal, actor.id, null);
      return disposal.id;
    });
    const result = await this.disposal(schoolId, id);
    if (settings.approve_disposals) {
      await this.notify.roles(schoolId, INVENTORY_APPROVER_ROLES, INVENTORY_TEMPLATES.INVENTORY_APPROVAL_NEEDED, {
        kind: 'Asset disposal',
        number: result.disposal_no,
        summary: `${result.asset.name} (${result.method})`,
        by: actor.name,
        disposal_id: String(result.id),
      });
    }
    return result;
  }

  private async requestedDisposal(manager: EntityManager, schoolId: number, id: number): Promise<AssetDisposal> {
    const disposal = await manager.findOne(AssetDisposal, {
      where: { id, school_id: schoolId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!disposal) throw AppException.notFound('Disposal not found', 'DISPOSAL_NOT_FOUND');
    if (disposal.status !== 'requested')
      throw AppException.conflict(`This disposal is ${disposal.status}`, 'DISPOSAL_CLOSED');
    return disposal;
  }

  async approveDisposal(schoolId: number, id: number, dto: DecisionDto, actor: AuthUser): Promise<DisposalDto> {
    const requestedBy = await this.dataSource.transaction(async (manager) => {
      const disposal = await this.requestedDisposal(manager, schoolId, id);
      await this.applyDisposal(manager, schoolId, disposal, actor.id, dto.note ?? null);
      return disposal.requested_by;
    });
    const result = await this.disposal(schoolId, id);
    await this.tellRequester(
      requestedBy,
      actor.id,
      'Asset disposal',
      result.disposal_no,
      result.asset.name,
      'approved',
      dto.note,
    );
    return result;
  }

  async rejectDisposal(schoolId: number, id: number, dto: RejectDto, actor: AuthUser): Promise<DisposalDto> {
    const requestedBy = await this.dataSource.transaction(async (manager) => {
      const disposal = await this.requestedDisposal(manager, schoolId, id);
      await manager.update(AssetDisposal, id, {
        status: 'rejected',
        decided_by: actor.id,
        decided_at: new Date(),
        decision_note: dto.note,
      });
      return disposal.requested_by;
    });
    const result = await this.disposal(schoolId, id);
    await this.tellRequester(
      requestedBy,
      actor.id,
      'Asset disposal',
      result.disposal_no,
      result.asset.name,
      'rejected',
      dto.note,
    );
    return result;
  }

  async staffAssets(schoolId: number, staffId: number): Promise<PeopleAssetsDto> {
    const [staff]: { user_id: number }[] = await this.dataSource.query(
      `SELECT user_id FROM staff WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [staffId, schoolId],
    );
    if (!staff) throw AppException.notFound('Staff member not found', 'STAFF_NOT_FOUND');
    const current: SqlFilter = { where: [`al.status = 'active'`], params: [] };
    current.where.push(`al.user_id = ${param(current, Number(staff.user_id))}`);
    const history: SqlFilter = { where: [`al.status = 'returned'`], params: [] };
    history.where.push(`al.user_id = ${param(history, Number(staff.user_id))}`);
    return {
      current: await this.read.allocations(schoolId, current),
      history: await this.read.allocations(schoolId, history, 'al.returned_on DESC, al.id DESC', 50),
    };
  }

  async myAssets(user: AuthUser): Promise<MyAssetDto[]> {
    if (!user.school_id) return [];
    const allocations: {
      id: number;
      asset_id: number;
      allocated_on: string;
      expected_return_on: string | null;
      acknowledged_at: Date | null;
      remarks: string | null;
    }[] = await this.dataSource.query(
      `SELECT id, asset_id, allocated_on::text AS allocated_on, expected_return_on::text AS expected_return_on, acknowledged_at, remarks
         FROM asset_allocations WHERE user_id = $1 AND school_id = $2 AND status = 'active' AND deleted_at IS NULL
         ORDER BY allocated_on DESC`,
      [user.id, user.school_id],
    );
    if (!allocations.length) return [];
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(
      `a.id = ANY(${param(
        filter,
        allocations.map((row) => Number(row.asset_id)),
      )})`,
    );
    const assets = await this.read.assets(user.school_id, filter);
    const today = this.read.today();
    return allocations.map((row) => ({
      allocation_id: Number(row.id),
      asset: assets.find((asset) => asset.id === Number(row.asset_id))!,
      allocated_on: row.allocated_on,
      expected_return_on: row.expected_return_on,
      acknowledged_at: row.acknowledged_at,
      overdue: Boolean(row.expected_return_on && row.expected_return_on < today),
      days_overdue:
        row.expected_return_on && row.expected_return_on < today
          ? Math.round(
              (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${row.expected_return_on}T00:00:00Z`)) / 86400000,
            )
          : 0,
      remarks: row.remarks ?? null,
    }));
  }

  async myAssetHistory(user: AuthUser): Promise<MyReturnedAssetDto[]> {
    if (!user.school_id) return [];
    const allocations: {
      id: number;
      asset_id: number;
      allocated_on: string;
      returned_on: string | null;
      return_condition: AssetCondition | null;
      acknowledged_at: Date | null;
    }[] = await this.dataSource.query(
      `SELECT id, asset_id, allocated_on::text AS allocated_on, returned_on::text AS returned_on, return_condition, acknowledged_at
         FROM asset_allocations WHERE user_id = $1 AND school_id = $2 AND status = 'returned' AND deleted_at IS NULL
         ORDER BY returned_on DESC NULLS LAST, id DESC LIMIT 50`,
      [user.id, user.school_id],
    );
    if (!allocations.length) return [];
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`a.id = ANY(${param(filter, [...new Set(allocations.map((row) => Number(row.asset_id)))])})`);
    const assets = await this.read.assets(user.school_id, filter);
    return allocations
      .filter((row) => assets.some((asset) => asset.id === Number(row.asset_id)))
      .map((row) => ({
        allocation_id: Number(row.id),
        asset: assets.find((asset) => asset.id === Number(row.asset_id))!,
        allocated_on: row.allocated_on,
        returned_on: row.returned_on,
        return_condition: row.return_condition,
        acknowledged_at: row.acknowledged_at,
      }));
  }

  async labels(schoolId: number, query: AssetLabelsQueryDto): Promise<{ name: string; pdf: Buffer }> {
    const filter: SqlFilter = { where: [`a.status <> 'disposed'`], params: [] };
    const before = filter.where.length;
    if (query.asset_ids?.length) filter.where.push(`a.id = ANY(${param(filter, query.asset_ids)})`);
    if (query.location_id) filter.where.push(`a.location_id = ${param(filter, query.location_id)}`);
    if (query.category_id) filter.where.push(`a.category_id = ${param(filter, query.category_id)}`);
    if (query.added_from) filter.where.push(`a.created_at >= ${param(filter, query.added_from)}::date`);
    if (filter.where.length === before) {
      throw AppException.validation([
        { field: 'asset_ids', message: 'Choose assets, a location, a category or a date' },
      ]);
    }
    const assets = await this.read.assets(schoolId, filter, 'a.asset_tag');
    if (!assets.length) throw AppException.notFound('No assets to print', 'NO_ASSETS');
    if (assets.length > 960)
      throw AppException.badRequest('Print at most 960 labels (40 sheets) at a time', 'TOO_MANY_LABELS');
    const school = await this.read.schoolInfo(this.dataSource.manager, schoolId);
    const pdf = await assetLabelsPdf(
      school.name,
      assets.map((asset) => ({ tag: asset.asset_tag, name: asset.name, location: asset.location?.name ?? null })),
    );
    return { name: `asset-tags-${assets.length}`, pdf };
  }

  async importTemplate(schoolId: number): Promise<{ name: string; buffer: Buffer }> {
    const categories: { name: string }[] = await this.dataSource.query(
      `SELECT name FROM inventory_categories WHERE school_id = $1 AND kind = 'asset' AND deleted_at IS NULL ORDER BY name`,
      [schoolId],
    );
    const locations: { name: string }[] = await this.dataSource.query(
      `SELECT name FROM inventory_locations WHERE school_id = $1 AND deleted_at IS NULL ORDER BY name`,
      [schoolId],
    );
    return {
      name: 'asset-import-template.xlsx',
      buffer: await assetTemplate(
        categories.map((row) => row.name),
        locations.map((row) => row.name),
      ),
    };
  }

  async importAssets(
    schoolId: number,
    file: UploadedFileInput | undefined,
    mode: 'validate' | 'import',
    actor: AuthUser,
  ): Promise<AssetImportReportDto> {
    if (!file?.buffer?.length) throw AppException.badRequest('Choose the filled Excel or CSV file', 'FILE_MISSING');
    if (!/\.(xlsx|csv)$/i.test(file.originalname))
      throw AppException.badRequest('Upload the .xlsx template or a .csv file', 'FILE_TYPE');
    let sheet: Awaited<ReturnType<typeof readAssetSheet>>;
    try {
      sheet = await readAssetSheet(file.buffer, file.originalname);
    } catch {
      throw AppException.badRequest('This file could not be read. Use the template.', 'FILE_UNREADABLE');
    }
    if (!sheet.length) throw AppException.badRequest('The file has no asset rows', 'FILE_EMPTY');
    if (sheet.length > 2000) throw AppException.badRequest('Import at most 2000 rows at a time', 'TOO_MANY_ROWS');
    const categories = await this.dataSource.getRepository(InventoryCategory).findBy({ school_id: schoolId });
    const planned = sheet.map(({ row, values }) => {
      const { parsed, error } = parseAssetRow(row, values);
      let message = error;
      if (parsed) {
        const category = categories.find(
          (item) =>
            item.name.toLowerCase() === parsed.category.toLowerCase() ||
            item.code.toLowerCase() === parsed.category.toLowerCase(),
        );
        if (category && category.kind !== 'asset') message = `${parsed.category} is a stock category`;
      }
      const report: AssetImportRowDto = {
        row,
        status: message ? 'error' : 'ok',
        name: values.name || null,
        quantity: parsed?.quantity ?? 0,
        message,
        asset_tags: [],
        asset_ids: [],
      };
      return { report, parsed: message ? null : parsed };
    });
    let created = 0;
    let masters = 0;
    if (mode === 'import') {
      for (const item of planned) {
        if (!item.parsed) continue;
        try {
          await this.dataSource.transaction(async (manager) => {
            const ids = await this.importRow(manager, schoolId, item.parsed!, actor.id, () => (masters += 1));
            const tags: { asset_tag: string }[] = await manager.query(
              `SELECT asset_tag FROM assets WHERE id = ANY($1) ORDER BY id`,
              [ids],
            );
            item.report.asset_tags = tags.map((tag) => tag.asset_tag);
            item.report.asset_ids = ids;
            created += ids.length;
          });
        } catch (error) {
          item.report.status = 'error';
          item.report.message = (error as Error).message;
        }
      }
    }
    const rows = planned.map((item) => item.report);
    return {
      mode,
      total_rows: rows.length,
      ok_rows: rows.filter((row) => row.status === 'ok').length,
      error_rows: rows.filter((row) => row.status === 'error').length,
      assets_created: created,
      masters_created: masters,
      rows,
    };
  }

  private async importRow(
    manager: EntityManager,
    schoolId: number,
    row: ParsedAssetRow,
    actorId: number,
    createdMaster: () => void,
  ): Promise<number[]> {
    const findByName = async <T extends { id: number }>(table: string, name: string): Promise<T | undefined> => {
      const [found]: T[] = await manager.query(
        `SELECT id FROM ${table} WHERE school_id = $1 AND deleted_at IS NULL AND (lower(name) = lower($2) ${
          table === 'inventory_vendors' ? '' : 'OR lower(code) = lower($2)'
        }) LIMIT 1`,
        [schoolId, name],
      );
      return found;
    };
    let category = await findByName<{ id: number }>('inventory_categories', row.category);
    if (!category) {
      const saved = await manager.save(
        manager.create(InventoryCategory, {
          school_id: schoolId,
          name: row.category.slice(0, 60),
          code: await this.freeCode(manager, 'inventory_categories', schoolId, row.category, 20),
          kind: 'asset',
        }),
      );
      category = { id: saved.id };
      createdMaster();
    }
    let locationId: number | null = null;
    if (row.location) {
      let location = await findByName<{ id: number }>('inventory_locations', row.location);
      if (!location) {
        const saved = await manager.save(
          manager.create(InventoryLocation, {
            school_id: schoolId,
            name: row.location.slice(0, 80),
            code: await this.freeCode(manager, 'inventory_locations', schoolId, row.location, 30),
            kind: 'other',
          }),
        );
        location = { id: saved.id };
        createdMaster();
      }
      locationId = Number(location.id);
    }
    let vendorId: number | null = null;
    if (row.vendor) {
      let vendor = await findByName<{ id: number }>('inventory_vendors', row.vendor);
      if (!vendor) {
        const saved = await manager.save(
          manager.create(InventoryVendor, { school_id: schoolId, name: row.vendor.slice(0, 120) }),
        );
        vendor = { id: saved.id };
        createdMaster();
      }
      vendorId = Number(vendor.id);
    }
    return this.createInTx(
      manager,
      schoolId,
      {
        name: row.name,
        category_id: Number(category.id),
        quantity: row.quantity,
        serial_nos: row.serial_nos.length ? row.serial_nos : undefined,
        make: row.make,
        model: row.model,
        location_id: locationId,
        vendor_id: vendorId,
        invoice_no: row.invoice_no,
        purchase_date: row.purchase_date ?? undefined,
        cost: row.cost,
        warranty_until: row.warranty_until ?? undefined,
        condition: row.condition,
        funding_source: row.funding_source,
        notes: row.notes,
      } as AssetCreateDto,
      actorId,
    );
  }

  private async freeCode(
    manager: EntityManager,
    table: string,
    schoolId: number,
    name: string,
    max: number,
  ): Promise<string> {
    const base = codeFrom(name).slice(0, max - 2);
    for (let index = 0; index < 100; index += 1) {
      const code = index ? `${base}${index}` : base;
      const [clash] = await manager.query(
        `SELECT 1 FROM ${table} WHERE school_id = $1 AND code = $2 AND deleted_at IS NULL`,
        [schoolId, code],
      );
      if (!clash) return code;
    }
    return `${base}${Date.now() % 100}`;
  }

  async openAllocationsOf(schoolId: number, userId: number): Promise<number> {
    const [row]: { count: string }[] = await this.dataSource.query(
      `SELECT COUNT(*) AS count FROM asset_allocations WHERE school_id = $1 AND user_id = $2 AND status = 'active' AND deleted_at IS NULL`,
      [schoolId, userId],
    );
    return Number(row?.count ?? 0);
  }

  async assetsByIds(schoolId: number, ids: number[]): Promise<AssetDto[]> {
    if (!ids.length) return [];
    const filter: SqlFilter = { where: [], params: [] };
    filter.where.push(`a.id = ANY(${param(filter, ids)})`);
    return this.read.assets(schoolId, filter);
  }

  async soonDue(schoolId: number): Promise<AllocationDto[]> {
    const filter: SqlFilter = { where: [`al.status = 'active'`], params: [] };
    filter.where.push(`al.expected_return_on < ${param(filter, this.read.today())}::date`);
    return this.read.allocations(schoolId, filter, 'al.expected_return_on', 8);
  }
}
