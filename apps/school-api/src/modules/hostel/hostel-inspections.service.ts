import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppException, AuthUser, Paginated, paginate } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { PERMISSIONS } from '../access/access.catalog';
import { CaseInputDto, TicketInputDto } from './dto/hostel-conduct.dto';
import {
  ChecklistDto,
  InspectionDetailDto,
  InspectionDto,
  InspectionDueDto,
  InspectionDueQueryDto,
  InspectionInputDto,
  InspectionItemDto,
  InspectionQueryDto,
} from './dto/hostel-rooms.dto';
import { HostelInspection, HostelInspectionItem, HostelRoomAsset } from './entities/hostel-rooms.entity';
import { HostelRoom } from './entities/hostel.entity';
import { escapeLike } from './hostel-sql';
import { HostelAuditService } from './hostel-audit.service';
import { HostelDisciplineService } from './hostel-discipline.service';
import { HostelTicketsService } from './hostel-tickets.service';
import { DEFAULT_CHECKLIST, inspectionResult, inspectionScore, issueSummary } from './hostel-rooms.logic';

const INSPECTION_SORTS: Record<string, string> = {
  inspected_at: 'i.inspected_at',
  score: 'i.score',
};
const DUE_SORTS: Record<string, string> = {
  last_inspected_at: 'last.at ASC NULLS FIRST, r.room_no ASC',
  room_no: 'r.room_no ASC',
};
const DEFAULT_DUE_DAYS = 30;

@Injectable()
export class HostelInspectionsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tickets: HostelTicketsService,
    private readonly discipline: HostelDisciplineService,
    private readonly audit: HostelAuditService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  checklist(): ChecklistDto {
    return { items: [...DEFAULT_CHECKLIST] };
  }

  async list(schoolId: number, query: InspectionQueryDto): Promise<Paginated<InspectionDto>> {
    const params: unknown[] = [schoolId];
    const where = ['i.school_id = $1', 'i.deleted_at IS NULL'];
    if (query.hostel_id) where.push(`i.hostel_id = $${params.push(query.hostel_id)}`);
    if (query.room_id) where.push(`i.room_id = $${params.push(query.room_id)}`);
    if (query.result) where.push(`i.result = $${params.push(query.result)}`);
    if (query.from || query.to) {
      const zone = `$${params.push(this.app.timeZone)}`;
      if (query.from)
        where.push(`i.inspected_at >= ($${params.push(query.from)}::date::timestamp AT TIME ZONE ${zone})`);
      if (query.to)
        where.push(`i.inspected_at < (($${params.push(query.to)}::date + 1)::timestamp AT TIME ZONE ${zone})`);
    }
    for (const word of (query.search ?? '').split(/\s+/).filter(Boolean)) {
      const slot = `$${params.push(`%${escapeLike(word)}%`)}`;
      where.push(`(r.room_no ILIKE ${slot} OR iu.name ILIKE ${slot} OR i.notes ILIKE ${slot})`);
    }
    const sort = INSPECTION_SORTS[query.sort ?? 'inspected_at'];
    if (!sort)
      throw AppException.badRequest(`sort must be one of ${Object.keys(INSPECTION_SORTS).join(', ')}`, 'INVALID_SORT');
    const order = query.order === 'asc' ? 'ASC' : 'DESC';
    const from = `${this.inspectionFrom()} WHERE ${where.join(' AND ')}`;
    const [{ total }] = await this.dataSource.query(`SELECT COUNT(*)::int AS total ${from}`, params);
    const rows: InspectionDto[] = await this.dataSource.query(
      `SELECT ${this.inspectionColumns()} ${from} ORDER BY ${sort} ${order}, i.id ${order}
       LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      params,
    );
    return paginate([rows, total], query.page, query.limit);
  }

  async get(schoolId: number, id: number): Promise<InspectionDetailDto> {
    const [row] = await this.dataSource.query(
      `SELECT ${this.inspectionColumns()} ${this.inspectionFrom()}
       WHERE i.school_id = $1 AND i.id = $2 AND i.deleted_at IS NULL`,
      [schoolId, id],
    );
    if (!row) throw AppException.notFound('Room inspection not found', 'HOSTEL_INSPECTION_NOT_FOUND');
    const items: InspectionItemDto[] = await this.dataSource.query(
      `SELECT id, item, result, note FROM hostel_inspection_items WHERE inspection_id = $1 ORDER BY id`,
      [id],
    );
    return { ...row, items };
  }

  async due(schoolId: number, query: InspectionDueQueryDto): Promise<Paginated<InspectionDueDto>> {
    const params: unknown[] = [schoolId, query.days ?? DEFAULT_DUE_DAYS];
    const where = [
      'r.school_id = $1',
      'r.deleted_at IS NULL',
      `r.status = 'active'`,
      'h.deleted_at IS NULL',
      `h.status = 'active'`,
      '(last.at IS NULL OR last.at < now() - make_interval(days => $2::int))',
    ];
    if (query.hostel_id) where.push(`r.hostel_id = $${params.push(query.hostel_id)}`);
    for (const word of (query.search ?? '').split(/\s+/).filter(Boolean)) {
      const slot = `$${params.push(`%${escapeLike(word)}%`)}`;
      where.push(`(r.room_no ILIKE ${slot} OR b.name ILIKE ${slot})`);
    }
    const sort = DUE_SORTS[query.sort ?? 'last_inspected_at'];
    if (!sort)
      throw AppException.badRequest(`sort must be one of ${Object.keys(DUE_SORTS).join(', ')}`, 'INVALID_SORT');
    const from = `FROM hostel_rooms r
       JOIN hostels h ON h.id = r.hostel_id
       LEFT JOIN hostel_blocks b ON b.id = r.block_id
       LEFT JOIN hostel_floors f ON f.id = r.floor_id
       LEFT JOIN LATERAL (
         SELECT MAX(x.inspected_at) AS at FROM hostel_inspections x WHERE x.room_id = r.id AND x.deleted_at IS NULL
       ) last ON true
       WHERE ${where.join(' AND ')}`;
    const [{ total }] = await this.dataSource.query(`SELECT COUNT(*)::int AS total ${from}`, params);
    const rowParams = [...params, this.app.timeZone];
    const zone = `$${rowParams.length}`;
    const rows: InspectionDueDto[] = await this.dataSource.query(
      `SELECT r.id AS room_id, r.room_no, r.hostel_id, h.name AS hostel_name, b.name AS block_name,
         f.name AS floor_name, last.at AS last_inspected_at,
         ((now() AT TIME ZONE ${zone})::date - (last.at AT TIME ZONE ${zone})::date)::int AS days_since
       ${from} ORDER BY ${sort}, r.id ASC
       LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      rowParams,
    );
    return paginate([rows, total], query.page, query.limit);
  }

  async create(schoolId: number, dto: InspectionInputDto, actor: AuthUser): Promise<InspectionDetailDto> {
    const room = await this.dataSource.manager.findOneBy(HostelRoom, { school_id: schoolId, id: dto.room_id });
    if (!room) throw AppException.notFound('Room not found', 'HOSTEL_ROOM_NOT_FOUND');
    const inspectedAt = dto.inspected_at ? new Date(dto.inspected_at) : new Date();
    if (inspectedAt.getTime() > Date.now() + 60000) {
      throw AppException.validation([{ field: 'inspected_at', message: 'Cannot be in the future' }]);
    }
    if (dto.raise_case && !actor.permissions.includes(PERMISSIONS.HOSTEL_DISCIPLINE)) {
      throw AppException.forbidden('You cannot record hostel discipline cases', 'FORBIDDEN');
    }
    const assetChanges = dto.update_assets ?? [];
    await this.ensureRoomAssets(
      schoolId,
      room.id,
      assetChanges.map((change) => change.asset_id),
    );
    const caseId = dto.raise_case
      ? (
          await this.discipline.create(
            schoolId,
            Object.assign(new CaseInputDto(), {
              ...dto.raise_case,
              incident_at: inspectedAt.toISOString(),
              location: `Room ${room.room_no}`,
            }),
            actor,
          )
        ).id
      : null;
    const ticketId = dto.raise_ticket
      ? (
          await this.tickets.createTicket(
            schoolId,
            Object.assign(new TicketInputDto(), {
              hostel_id: room.hostel_id,
              room_id: room.id,
              category: dto.raise_ticket.category,
              priority: dto.raise_ticket.priority,
              title: dto.raise_ticket.title,
              description: dto.raise_ticket.description ?? issueSummary(dto.items),
              blocks_room: dto.raise_ticket.blocks_room,
            }),
            actor,
          )
        ).id
      : null;
    const score = inspectionScore(dto.items);
    const result = inspectionResult(dto.items);
    const id = await this.dataSource.transaction(async (manager) => {
      const saved = await manager.save(
        manager.create(HostelInspection, {
          school_id: schoolId,
          hostel_id: room.hostel_id,
          room_id: room.id,
          inspected_at: inspectedAt,
          inspector_user_id: actor.id,
          score,
          cleanliness: dto.cleanliness ?? null,
          result,
          notes: dto.notes ?? null,
          maintenance_ticket_id: ticketId,
          discipline_case_id: caseId,
          created_by: actor.id,
        }),
      );
      await manager.save(
        dto.items.map((item) =>
          manager.create(HostelInspectionItem, {
            school_id: schoolId,
            inspection_id: saved.id,
            item: item.item,
            result: item.result,
            note: item.note ?? null,
          }),
        ),
      );
      for (const change of assetChanges) {
        await manager.update(
          HostelRoomAsset,
          { id: change.asset_id, school_id: schoolId, room_id: room.id },
          { condition: change.condition, last_checked_at: inspectedAt },
        );
      }
      await this.audit.record(manager, schoolId, actor, {
        entity: 'inspection',
        entity_id: saved.id,
        action: 'create',
        changes: {
          room_id: room.id,
          score,
          result,
          assets_updated: assetChanges.length,
          maintenance_ticket_id: ticketId,
          discipline_case_id: caseId,
        },
      });
      return saved.id;
    });
    return this.get(schoolId, id);
  }

  private async ensureRoomAssets(schoolId: number, roomId: number, assetIds: number[]): Promise<void> {
    if (!assetIds.length) return;
    if (new Set(assetIds).size !== assetIds.length) {
      throw AppException.validation([{ field: 'update_assets', message: 'An asset is listed twice' }]);
    }
    const [{ count }] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count FROM hostel_room_assets
       WHERE school_id = $1 AND room_id = $2 AND deleted_at IS NULL AND id = ANY($3)`,
      [schoolId, roomId, assetIds],
    );
    if (count !== assetIds.length) {
      throw AppException.validation([{ field: 'update_assets', message: 'Some assets are not in this room' }]);
    }
  }

  private inspectionColumns(): string {
    return `i.id, i.hostel_id, h.name AS hostel_name, i.room_id, r.room_no, b.name AS block_name, i.inspected_at,
         iu.name AS inspector_name, i.score, i.cleanliness, i.result,
         (SELECT COUNT(*) FROM hostel_inspection_items x WHERE x.inspection_id = i.id AND x.result = 'issue')::int AS issues,
         i.notes, i.maintenance_ticket_id, t.ticket_no, i.discipline_case_id, c.case_no, i.created_at`;
  }

  private inspectionFrom(): string {
    return `FROM hostel_inspections i
       JOIN hostels h ON h.id = i.hostel_id
       JOIN hostel_rooms r ON r.id = i.room_id
       LEFT JOIN hostel_blocks b ON b.id = r.block_id
       LEFT JOIN users iu ON iu.id = i.inspector_user_id
       LEFT JOIN hostel_maintenance_tickets t ON t.id = i.maintenance_ticket_id
       LEFT JOIN hostel_discipline_cases c ON c.id = i.discipline_case_id`;
  }
}
