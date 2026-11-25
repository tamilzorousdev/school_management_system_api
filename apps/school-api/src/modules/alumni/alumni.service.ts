import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import { AppException, AuthUser, listQuery, Paginated } from '@app/common';
import { currentYearId } from '../../shared/academic-year';
import { FilesService } from '../files/files.service';
import { Alumni, OCCUPATION_STATUSES, OccupationStatus } from './entities/alumni.entity';
import {
  AlumniAcademicHistory,
  AlumniSubmission,
  AlumniTimeline,
  AlumniUpdateLink,
} from './entities/alumni-records.entity';
import { Actor, AlumniRecordsService } from './alumni-records.service';
import { diffFields, fullName, hashToken, isReachable, linkExpiry, PROFILE_FIELDS, pickFields } from './alumni.logic';
import { randomToken } from '../../shared/crypto';
import {
  AlumniDetailDto,
  AlumniInsightsDto,
  AlumniItemDto,
  AlumniQueryDto,
  AlumniStatusInputDto,
  assertBatchYear,
  BatchCountDto,
  PassOutPreviewDto,
  ReplaceHistoryDto,
  UpdateAlumniDto,
  UpdateLinkDto,
} from './dto/alumni.dto';

const EXPORT_LIMIT = 5000;

export function actorOf(user: AuthUser): Actor {
  return { id: user.id, name: user.name };
}

@Injectable()
export class AlumniService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Alumni) private readonly alumni: Repository<Alumni>,
    @InjectRepository(AlumniAcademicHistory) private readonly history: Repository<AlumniAcademicHistory>,
    @InjectRepository(AlumniTimeline) private readonly timeline: Repository<AlumniTimeline>,
    @InjectRepository(AlumniSubmission) private readonly submissions: Repository<AlumniSubmission>,
    private readonly records: AlumniRecordsService,
    private readonly files: FilesService,
  ) {}

  async list(schoolId: number, query: AlumniQueryDto): Promise<Paginated<AlumniItemDto>> {
    const page = await listQuery(this.filtered(schoolId, query), query, {
      searchable: [
        'a.first_name',
        'a.last_name',
        'a.alumni_no',
        'a.admission_no',
        'a.emis_number',
        'a.mobile',
        'a.email',
        'a.institution',
        'a.organization',
        'a.city',
      ],
      sortable: {
        name: 'a.first_name',
        batch_year: 'a.batch_year',
        left_on: 'a.left_on',
        final_percent: 'a.final_percent',
        alumni_no: 'a.alumni_no',
        created_at: 'a.created_at',
      },
      defaultSort: 'batch_year',
    });
    return { ...page, items: page.items.map((row) => this.item(row)) };
  }

  async exportRows(schoolId: number, query: AlumniQueryDto): Promise<AlumniDetailDto[]> {
    const rows = await this.filtered(schoolId, query)
      .orderBy('a.batch_year', 'DESC')
      .addOrderBy('a.first_name', 'ASC')
      .take(EXPORT_LIMIT)
      .getMany();
    return rows.map((row) => ({
      ...this.detailFields(row),
      academic_history: [],
      timeline: [],
      pending_submissions: 0,
    }));
  }

  async insights(schoolId: number): Promise<AlumniInsightsDto> {
    const [counts, occupations, batches, pending] = await Promise.all([
      this.dataSource.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE status = 'active')::int AS active,
                count(*) FILTER (WHERE contact_consent AND (mobile IS NOT NULL OR email IS NOT NULL))::int AS reachable
         FROM alumni WHERE school_id = $1 AND deleted_at IS NULL`,
        [schoolId],
      ) as Promise<{ total: number; active: number; reachable: number }[]>,
      this.dataSource.query(
        `SELECT occupation_status, count(*)::int AS count FROM alumni
         WHERE school_id = $1 AND deleted_at IS NULL GROUP BY occupation_status`,
        [schoolId],
      ) as Promise<{ occupation_status: OccupationStatus; count: number }[]>,
      this.batches(schoolId),
      this.submissions.count({ where: { school_id: schoolId, status: 'pending' } }),
    ]);
    const byOccupation = Object.fromEntries(OCCUPATION_STATUSES.map((key) => [key, 0])) as Record<
      OccupationStatus,
      number
    >;
    for (const row of occupations) byOccupation[row.occupation_status] = row.count;
    return {
      total: counts[0]?.total ?? 0,
      active: counts[0]?.active ?? 0,
      reachable: counts[0]?.reachable ?? 0,
      latest_batch: batches[0] ?? null,
      pending_submissions: pending,
      by_occupation: byOccupation,
      by_batch: batches.slice(0, 6),
    };
  }

  async batches(schoolId: number): Promise<BatchCountDto[]> {
    const rows = (await this.dataSource.query(
      `SELECT batch_year, count(*)::int AS count FROM alumni
       WHERE school_id = $1 AND deleted_at IS NULL GROUP BY batch_year ORDER BY batch_year DESC`,
      [schoolId],
    )) as { batch_year: number; count: number }[];
    return rows.map((row) => ({ batch_year: Number(row.batch_year), count: row.count }));
  }

  async passOutPreview(schoolId: number, yearId?: number): Promise<PassOutPreviewDto> {
    const manager = this.dataSource.manager;
    return this.records.preview(manager, schoolId, yearId ?? (await currentYearId(manager, schoolId)));
  }

  async get(schoolId: number, id: number): Promise<AlumniDetailDto> {
    const row = await this.find(schoolId, id);
    const [history, timeline, pending] = await Promise.all([
      this.history.find({ where: { alumni_id: id }, order: { source: 'DESC', sort_order: 'ASC', id: 'ASC' } }),
      this.timeline.find({ where: { alumni_id: id }, order: { created_at: 'DESC', id: 'DESC' }, take: 100 }),
      this.submissions.count({ where: { school_id: schoolId, alumni_id: id, status: 'pending' } }),
    ]);
    return {
      ...this.detailFields(row),
      pending_submissions: pending,
      academic_history: history.map((item) => ({
        id: item.id,
        academic_year_name: item.academic_year_name,
        class_name: item.class_name,
        section_name: item.section_name,
        roll_no: item.roll_no,
        result: item.result,
        percent: item.percent === null ? null : Number(item.percent),
        grade: item.grade,
        source: item.source,
      })),
      timeline: timeline.map((item) => ({
        id: item.id,
        action: item.action,
        actor_name: item.actor_name,
        changes: item.changes,
        note: item.note,
        created_at: item.created_at,
      })),
    };
  }

  async update(schoolId: number, id: number, dto: UpdateAlumniDto, user: AuthUser): Promise<AlumniDetailDto> {
    const row = await this.find(schoolId, id);
    this.checkBatch(dto.batch_year);
    if (dto.photo_file_id && dto.photo_file_id !== row.photo_file_id) {
      await this.files.assertAttachable(dto.photo_file_id, schoolId, 'photo_file_id');
    }
    const fields = pickFields(dto, [...PROFILE_FIELDS, 'first_name', 'batch_year']);
    await this.dataSource.transaction((manager) => this.applyChanges(manager, row, fields, actorOf(user), 'updated'));
    return this.get(schoolId, id);
  }

  async applyChanges(
    manager: EntityManager,
    row: Alumni,
    fields: Record<string, unknown>,
    actor: Actor,
    action: 'updated' | 'self_update_approved',
    note: string | null = null,
  ): Promise<void> {
    const changes = diffFields(row, fields);
    if (!Object.keys(changes).length) return;
    const patch = this.toColumns(Object.fromEntries(Object.keys(changes).map((key) => [key, fields[key]])));
    await manager.update(Alumni, row.id, { ...patch, profile_updated_at: new Date() });
    await this.records.log(manager, row.school_id, row.id, action, actor, changes, note);
  }

  async replaceHistory(schoolId: number, id: number, dto: ReplaceHistoryDto, user: AuthUser): Promise<AlumniDetailDto> {
    await this.find(schoolId, id);
    await this.dataSource.transaction(async (manager) => {
      const systemRows = await manager.count(AlumniAcademicHistory, { where: { alumni_id: id, source: 'system' } });
      await manager.delete(AlumniAcademicHistory, { alumni_id: id, source: 'manual' });
      await this.records.writeHistory(manager, schoolId, id, dto.rows, 'manual', systemRows);
      await this.records.log(
        manager,
        schoolId,
        id,
        'history_updated',
        actorOf(user),
        null,
        `${dto.rows.length} manual ${dto.rows.length === 1 ? 'year' : 'years'} saved`,
      );
    });
    return this.get(schoolId, id);
  }

  async setStatus(schoolId: number, id: number, dto: AlumniStatusInputDto, user: AuthUser): Promise<AlumniDetailDto> {
    const row = await this.find(schoolId, id);
    if (row.status !== dto.status) {
      await this.dataSource.transaction(async (manager) => {
        await manager.update(Alumni, id, { status: dto.status });
        await this.records.log(
          manager,
          schoolId,
          id,
          'status_changed',
          actorOf(user),
          { status: [row.status, dto.status] },
          dto.note ?? null,
        );
      });
    }
    return this.get(schoolId, id);
  }

  async remove(schoolId: number, id: number): Promise<void> {
    await this.find(schoolId, id);
    await this.dataSource.transaction(async (manager) => {
      await manager.softDelete(Alumni, id);
      await manager.update(AlumniUpdateLink, { alumni_id: id, used_at: IsNull() }, { used_at: new Date() });
      await manager.update(
        AlumniSubmission,
        { alumni_id: id, status: 'pending' },
        { status: 'rejected', reviewed_at: new Date(), review_note: 'Alumni record deleted' },
      );
    });
  }

  async issueLink(schoolId: number, id: number, user: AuthUser): Promise<UpdateLinkDto> {
    await this.find(schoolId, id);
    const token = randomToken(24);
    const expires = linkExpiry(new Date());
    await this.dataSource.transaction(async (manager) => {
      await manager
        .createQueryBuilder()
        .update(AlumniUpdateLink)
        .set({ used_at: () => 'now()' })
        .where('alumni_id = :id AND used_at IS NULL', { id })
        .execute();
      await manager.insert(AlumniUpdateLink, {
        school_id: schoolId,
        alumni_id: id,
        token_hash: hashToken(token),
        expires_at: expires,
        created_by: user.id,
      });
      await this.records.log(manager, schoolId, id, 'link_issued', actorOf(user), null, 'Self-update link issued');
    });
    return { path: `alumni-update/${token}`, expires_at: expires };
  }

  async find(schoolId: number, id: number): Promise<Alumni> {
    const row = await this.alumni.findOneBy({ id, school_id: schoolId });
    if (!row) throw AppException.notFound('Alumni record not found', 'ALUMNI_NOT_FOUND');
    return row;
  }

  item(row: Alumni): AlumniItemDto {
    return {
      id: row.id,
      alumni_no: row.alumni_no,
      student_id: row.student_id,
      source: row.source,
      status: row.status,
      first_name: row.first_name,
      last_name: row.last_name,
      full_name: fullName(row.first_name, row.last_name),
      gender: row.gender,
      photo_file_id: row.photo_file_id,
      photo_url: this.files.linkFor(row.photo_file_id),
      admission_no: row.admission_no,
      emis_number: row.emis_number,
      batch_year: Number(row.batch_year),
      left_on: row.left_on,
      exit_type: row.exit_type,
      final_class_name: row.final_class_name,
      final_section_name: row.final_section_name,
      final_percent: row.final_percent === null ? null : Number(row.final_percent),
      final_grade: row.final_grade,
      mobile: row.mobile,
      email: row.email,
      city: row.city,
      occupation_status: row.occupation_status,
      institution: row.institution,
      organization: row.organization,
      contact_consent: row.contact_consent,
      reachable: isReachable(row),
    };
  }

  private detailFields(row: Alumni): Omit<AlumniDetailDto, 'academic_history' | 'timeline' | 'pending_submissions'> {
    return {
      ...this.item(row),
      dob: row.dob,
      admission_date: row.admission_date,
      final_academic_year_id: row.final_academic_year_id,
      final_academic_year_name: row.final_academic_year_name,
      final_result: row.final_result,
      tc_no: row.tc_no,
      alt_mobile: row.alt_mobile,
      address_line: row.address_line,
      state: row.state,
      pincode: row.pincode,
      country: row.country,
      linkedin_url: row.linkedin_url,
      course: row.course,
      designation: row.designation,
      notes: row.notes,
      profile_updated_at: row.profile_updated_at,
      created_at: row.created_at,
    };
  }

  private filtered(schoolId: number, query: AlumniQueryDto): SelectQueryBuilder<Alumni> {
    const qb = this.alumni.createQueryBuilder('a').where('a.school_id = :schoolId', { schoolId });
    if (query.batch_year) qb.andWhere('a.batch_year = :batch', { batch: query.batch_year });
    if (query.source) qb.andWhere('a.source = :source', { source: query.source });
    if (query.exit_type) qb.andWhere('a.exit_type = :exitType', { exitType: query.exit_type });
    if (query.occupation_status) {
      qb.andWhere('a.occupation_status = :occupation', { occupation: query.occupation_status });
    }
    if (query.status) qb.andWhere('a.status = :status', { status: query.status });
    if (query.city) qb.andWhere('a.city ILIKE :city', { city: query.city });
    if (query.reachable === true) {
      qb.andWhere('a.contact_consent = true AND (a.mobile IS NOT NULL OR a.email IS NOT NULL)');
    }
    return qb;
  }

  private toColumns(fields: Record<string, unknown>): Partial<Alumni> {
    const out: Record<string, unknown> = { ...fields };
    if ('final_percent' in out) {
      out.final_percent = out.final_percent === null ? null : String(out.final_percent);
    }
    return out as Partial<Alumni>;
  }

  private checkBatch(year: number | undefined): void {
    const message = assertBatchYear(year);
    if (message) throw AppException.validation([{ field: 'batch_year', message }]);
  }
}
