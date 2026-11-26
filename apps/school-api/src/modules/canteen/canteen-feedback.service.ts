import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppException, AuthUser, listQuery, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { averageRating, canMoveFeedback, ratingDistribution } from './canteen-people.logic';
import {
  CountByDto,
  FeedbackDto,
  FeedbackInputDto,
  FeedbackInsightsDto,
  FeedbackQueryDto,
  FeedbackStatusDto,
} from './dto/canteen-people.dto';
import { CanteenFeedback, FEEDBACK_KINDS, FEEDBACK_STATUSES } from './entities/canteen-people.entity';

const SORTS: Record<string, string> = {
  created_at: 'f.created_at',
  rating: 'f.rating',
  status: 'f.status',
  category: 'f.category',
  resolved_at: 'f.resolved_at',
};

export const toFeedbackDto = (row: CanteenFeedback): FeedbackDto => ({
  id: row.id,
  kind: row.kind,
  category: row.category,
  rating: row.rating,
  subject: row.subject,
  message: row.message,
  diner_id: row.diner_id,
  order_id: row.order_id,
  status: row.status,
  resolution: row.resolution,
  resolved_at: row.resolved_at,
  resolved_by: row.resolved_by,
  created_at: row.created_at,
});

@Injectable()
export class CanteenFeedbackService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(CanteenFeedback) private readonly repo: Repository<CanteenFeedback>,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async create(schoolId: number, dto: FeedbackInputDto): Promise<FeedbackDto> {
    if (dto.kind === 'feedback' && !dto.rating) {
      throw AppException.badRequest('A rating from 1 to 5 is required for feedback', 'FEEDBACK_RATING_REQUIRED');
    }
    await this.checkReference(schoolId, 'canteen_diners', dto.diner_id, 'Diner not found', 'DINER_NOT_FOUND');
    await this.checkReference(schoolId, 'canteen_orders', dto.order_id, 'Order not found', 'ORDER_NOT_FOUND');
    const row = this.repo.create({
      school_id: schoolId,
      kind: dto.kind,
      category: dto.category,
      rating: dto.rating ?? null,
      subject: dto.subject,
      message: dto.message,
      diner_id: dto.diner_id ?? null,
      order_id: dto.order_id ?? null,
      status: 'open',
    });
    return toFeedbackDto(await this.repo.save(row));
  }

  async list(schoolId: number, query: FeedbackQueryDto): Promise<Paginated<FeedbackDto>> {
    const qb = this.repo.createQueryBuilder('f').where('f.school_id = :schoolId', { schoolId });
    if (query.kind) qb.andWhere('f.kind = :kind', { kind: query.kind });
    if (query.category) qb.andWhere('f.category = :category', { category: query.category });
    if (query.status) qb.andWhere('f.status = :status', { status: query.status });
    if (query.rating) qb.andWhere('f.rating = :rating', { rating: query.rating });
    const day = 'CAST(f.created_at AT TIME ZONE :zone AS date)';
    if (query.from) qb.andWhere(`${day} >= CAST(:from AS date)`, { from: query.from, zone: this.app.timeZone });
    if (query.to) qb.andWhere(`${day} <= CAST(:to AS date)`, { to: query.to, zone: this.app.timeZone });
    const page = await listQuery(qb, query, {
      searchable: ['f.subject', 'f.message'],
      sortable: SORTS,
      defaultSort: 'created_at',
    });
    return { ...page, items: page.items.map(toFeedbackDto) };
  }

  async get(schoolId: number, id: number): Promise<FeedbackDto> {
    return toFeedbackDto(await this.find(schoolId, id));
  }

  async changeStatus(schoolId: number, id: number, dto: FeedbackStatusDto, actor: AuthUser): Promise<FeedbackDto> {
    const row = await this.find(schoolId, id);
    if (!canMoveFeedback(row.status, dto.status)) {
      throw AppException.conflict(`A ${row.status} item cannot move to ${dto.status}`, 'FEEDBACK_STATUS_INVALID');
    }
    if (dto.status === 'resolved') {
      if (!dto.resolution) {
        throw AppException.badRequest('Describe the resolution', 'FEEDBACK_RESOLUTION_REQUIRED');
      }
      row.resolution = dto.resolution;
      row.resolved_at = new Date();
      row.resolved_by = actor.id;
    }
    if (dto.status === 'open') {
      row.resolved_at = null;
      row.resolved_by = null;
    }
    row.status = dto.status;
    return toFeedbackDto(await this.repo.save(row));
  }

  async insights(schoolId: number): Promise<FeedbackInsightsDto> {
    const grouped = async (column: 'status' | 'kind' | 'category'): Promise<CountByDto[]> => {
      const rows: { key: string; count: number }[] = await this.dataSource.query(
        `SELECT f.${column} AS key, COUNT(*)::int AS count
         FROM canteen_feedback f
         WHERE f.school_id = $1 AND f.deleted_at IS NULL
         GROUP BY f.${column}
         ORDER BY count DESC, key`,
        [schoolId],
      );
      return rows.map((row) => ({ key: row.key, count: Number(row.count) }));
    };
    const [byStatus, byKind, categories, ratingRows] = await Promise.all([
      grouped('status'),
      grouped('kind'),
      grouped('category'),
      this.dataSource.query(
        `SELECT f.rating FROM canteen_feedback f
         WHERE f.school_id = $1 AND f.deleted_at IS NULL AND f.rating IS NOT NULL`,
        [schoolId],
      ) as Promise<{ rating: number }[]>,
    ]);
    const ratings = ratingRows.map((row) => Number(row.rating));
    const fill = (keys: readonly string[], rows: CountByDto[]) =>
      keys.map((key) => ({ key, count: rows.find((row) => row.key === key)?.count ?? 0 }));
    return {
      total: byKind.reduce((sum, row) => sum + row.count, 0),
      by_status: fill(FEEDBACK_STATUSES, byStatus),
      by_kind: fill(FEEDBACK_KINDS, byKind),
      average_rating: averageRating(ratings),
      rating_distribution: ratingDistribution(ratings),
      top_categories: categories.slice(0, 5),
    };
  }

  private async find(schoolId: number, id: number): Promise<CanteenFeedback> {
    const row = await this.repo.findOneBy({ id, school_id: schoolId });
    if (!row) throw AppException.notFound('Feedback not found', 'FEEDBACK_NOT_FOUND');
    return row;
  }

  private async checkReference(
    schoolId: number,
    table: 'canteen_diners' | 'canteen_orders',
    id: number | undefined,
    message: string,
    code: string,
  ): Promise<void> {
    if (!id) return;
    const rows: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM ${table} t WHERE t.id = $1 AND t.school_id = $2 AND t.deleted_at IS NULL`,
      [id, schoolId],
    );
    if (rows.length === 0) throw AppException.notFound(message, code);
  }
}
