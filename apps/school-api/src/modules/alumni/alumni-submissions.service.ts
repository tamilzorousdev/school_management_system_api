import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, MoreThan, Repository } from 'typeorm';
import { AppException, AuthUser, listQuery, Paginated } from '@app/common';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import { ROLES } from '../access/access.catalog';
import { Alumni } from './entities/alumni.entity';
import { AlumniSubmission, AlumniUpdateLink } from './entities/alumni-records.entity';
import { AlumniRecordsService } from './alumni-records.service';
import { actorOf, AlumniService } from './alumni.service';
import {
  diffFields,
  fullName,
  hashToken,
  linkUsable,
  pickFields,
  SELF_REGISTER_FIELDS,
  SELF_UPDATE_FIELDS,
  submissionBlock,
} from './alumni.logic';
import {
  ApproveSubmissionDto,
  assertBatchYear,
  MatchDto,
  PublicProfileDto,
  PublicRegisterDto,
  PublicSchoolDto,
  PublicUpdateDto,
  RejectSubmissionDto,
  SubmissionDto,
  SubmissionQueryDto,
  SubmissionReceivedDto,
} from './dto/alumni.dto';

interface SchoolRow {
  id: number;
  code: string;
  name: string;
  logo_file_id: number | null;
}

@Injectable()
export class AlumniSubmissionsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(AlumniSubmission) private readonly submissions: Repository<AlumniSubmission>,
    @InjectRepository(AlumniUpdateLink) private readonly links: Repository<AlumniUpdateLink>,
    @InjectRepository(Alumni) private readonly alumni: Repository<Alumni>,
    private readonly records: AlumniRecordsService,
    private readonly service: AlumniService,
    private readonly files: FilesService,
    private readonly notify: NotificationsService,
  ) {}

  async list(schoolId: number, query: SubmissionQueryDto): Promise<Paginated<SubmissionDto>> {
    const qb = this.submissions.createQueryBuilder('s').where('s.school_id = :schoolId', { schoolId });
    if (query.status) qb.andWhere('s.status = :status', { status: query.status });
    if (query.type) qb.andWhere('s.type = :type', { type: query.type });
    const page = await listQuery(qb, query, {
      searchable: ['s.name', 's.mobile'],
      sortable: { created_at: 's.created_at', name: 's.name' },
      defaultSort: 'created_at',
    });
    return { ...page, items: await this.present(schoolId, page.items) };
  }

  async approve(schoolId: number, id: number, dto: ApproveSubmissionDto, user: AuthUser): Promise<SubmissionDto> {
    const actor = actorOf(user);
    await this.dataSource.transaction(async (manager) => {
      const submission = await manager.findOne(AlumniSubmission, {
        where: { id, school_id: schoolId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!submission) throw AppException.notFound('Submission not found', 'SUBMISSION_NOT_FOUND');
      if (submission.status !== 'pending') {
        throw AppException.conflict(`This submission is already ${submission.status}`, 'SUBMISSION_CLOSED');
      }
      const updates = pickFields(submission.payload, SELF_UPDATE_FIELDS);
      let alumniId: number;
      if (submission.type === 'update' || dto.alumni_id) {
        const targetId = submission.type === 'update' ? submission.alumni_id : dto.alumni_id;
        const target = targetId ? await manager.findOneBy(Alumni, { id: targetId, school_id: schoolId }) : null;
        if (!target) throw AppException.notFound('Alumni record not found', 'ALUMNI_NOT_FOUND');
        await this.service.applyChanges(
          manager,
          target,
          updates,
          actor,
          'self_update_approved',
          submission.type === 'registration' ? 'Merged a self-registration' : null,
        );
        alumniId = target.id;
      } else {
        const fields = pickFields(submission.payload, SELF_REGISTER_FIELDS);
        alumniId = await this.records.create(
          manager,
          schoolId,
          {
            ...fields,
            first_name: String(fields.first_name),
            batch_year: Number(fields.batch_year),
            source: 'self',
          },
          [],
          'self_registered',
          actor,
          'Registered through the alumni form',
        );
      }
      await manager.update(AlumniSubmission, id, {
        status: 'approved',
        alumni_id: alumniId,
        reviewed_by: user.id,
        reviewed_at: new Date(),
      });
    });
    return this.one(schoolId, id);
  }

  async reject(schoolId: number, id: number, dto: RejectSubmissionDto, user: AuthUser): Promise<SubmissionDto> {
    const submission = await this.submissions.findOneBy({ id, school_id: schoolId });
    if (!submission) throw AppException.notFound('Submission not found', 'SUBMISSION_NOT_FOUND');
    if (submission.status !== 'pending') {
      throw AppException.conflict(`This submission is already ${submission.status}`, 'SUBMISSION_CLOSED');
    }
    await this.submissions.update(id, {
      status: 'rejected',
      reviewed_by: user.id,
      reviewed_at: new Date(),
      review_note: dto.note,
    });
    return this.one(schoolId, id);
  }

  async school(code: string): Promise<PublicSchoolDto> {
    const school = await this.schoolByCode(code);
    return this.publicSchool(school);
  }

  async register(code: string, dto: PublicRegisterDto, ip: string | null): Promise<SubmissionReceivedDto> {
    if (dto.website) return { id: 0 };
    const school = await this.schoolByCode(code);
    const batchError = assertBatchYear(dto.batch_year);
    if (batchError) throw AppException.validation([{ field: 'batch_year', message: batchError }]);
    if (!dto.mobile && !dto.email) {
      throw AppException.validation([{ field: 'mobile', message: 'Give a mobile number or an email address' }]);
    }
    await this.guard(school.id, dto.mobile ?? null);
    const payload = pickFields(dto, SELF_REGISTER_FIELDS);
    const saved = await this.submissions.save(
      this.submissions.create({
        school_id: school.id,
        type: 'registration',
        alumni_id: null,
        payload,
        name: fullName(dto.first_name, dto.last_name ?? null),
        mobile: dto.mobile ?? null,
        client_ip: ip,
      }),
    );
    this.announce(school.id, saved);
    return { id: saved.id };
  }

  async profile(token: string): Promise<PublicProfileDto> {
    const { link, alumni } = await this.byToken(token);
    const school = await this.schoolById(alumni.school_id);
    return {
      ...(pickFields(alumni, SELF_UPDATE_FIELDS) as Partial<PublicProfileDto>),
      school: this.publicSchool(school),
      full_name: fullName(alumni.first_name, alumni.last_name),
      batch_year: Number(alumni.batch_year),
      expires_at: link.expires_at,
    };
  }

  async submitUpdate(token: string, dto: PublicUpdateDto, ip: string | null): Promise<SubmissionReceivedDto> {
    if (dto.website) return { id: 0 };
    const { link, alumni } = await this.byToken(token);
    const payload = pickFields(dto, SELF_UPDATE_FIELDS);
    if (!Object.keys(diffFields(alumni, payload)).length) {
      throw AppException.badRequest('Nothing has changed. Edit at least one detail.', 'NO_CHANGES');
    }
    await this.guard(alumni.school_id, null);
    const saved = await this.dataSource.transaction(async (manager) => {
      await manager.update(AlumniUpdateLink, link.id, { used_at: new Date() });
      return manager.save(
        manager.create(AlumniSubmission, {
          school_id: alumni.school_id,
          type: 'update',
          alumni_id: alumni.id,
          payload,
          name: fullName(alumni.first_name, alumni.last_name),
          mobile: (payload.mobile as string | null | undefined) ?? alumni.mobile,
          client_ip: ip,
        }),
      );
    });
    this.announce(alumni.school_id, saved);
    return { id: saved.id };
  }

  private async one(schoolId: number, id: number): Promise<SubmissionDto> {
    const row = await this.submissions.findOneByOrFail({ id, school_id: schoolId });
    return (await this.present(schoolId, [row]))[0];
  }

  private async present(schoolId: number, rows: AlumniSubmission[]): Promise<SubmissionDto[]> {
    if (!rows.length) return [];
    const alumniIds = [...new Set(rows.map((row) => row.alumni_id).filter((id): id is number => id !== null))];
    const reviewerIds = [...new Set(rows.map((row) => row.reviewed_by).filter((id): id is number => id !== null))];
    const [targets, reviewers] = await Promise.all([
      alumniIds.length ? this.alumni.findBy({ id: In(alumniIds), school_id: schoolId }) : Promise.resolve([]),
      reviewerIds.length
        ? (this.dataSource.query(`SELECT id, name FROM users WHERE id = ANY($1)`, [reviewerIds]) as Promise<
            { id: number; name: string }[]
          >)
        : Promise.resolve([]),
    ]);
    const byId = new Map(targets.map((row) => [row.id, row]));
    const names = new Map(reviewers.map((row) => [Number(row.id), row.name]));
    return Promise.all(
      rows.map(async (row) => {
        const target = row.alumni_id ? byId.get(row.alumni_id) : undefined;
        return {
          id: row.id,
          type: row.type,
          status: row.status,
          alumni_id: row.alumni_id,
          alumni_no: target?.alumni_no ?? null,
          name: row.name,
          mobile: row.mobile,
          payload: row.payload,
          changes:
            row.type === 'update' && target && row.status === 'pending'
              ? diffFields(target, pickFields(row.payload, SELF_UPDATE_FIELDS))
              : null,
          possible_matches:
            row.type === 'registration' && row.status === 'pending' ? await this.matches(schoolId, row) : [],
          reviewed_by_name: row.reviewed_by ? (names.get(row.reviewed_by) ?? null) : null,
          reviewed_at: row.reviewed_at,
          review_note: row.review_note,
          created_at: row.created_at,
        };
      }),
    );
  }

  private async matches(schoolId: number, row: AlumniSubmission): Promise<MatchDto[]> {
    const firstName = String(row.payload.first_name ?? '').trim();
    const batch = Number(row.payload.batch_year);
    const found = await this.alumni
      .createQueryBuilder('a')
      .where('a.school_id = :schoolId', { schoolId })
      .andWhere(
        '((a.mobile IS NOT NULL AND a.mobile = :mobile) OR (lower(a.first_name) = lower(:firstName) AND a.batch_year = :batch))',
        {
          mobile: row.mobile ?? '',
          firstName,
          batch: Number.isFinite(batch) ? batch : 0,
        },
      )
      .orderBy('a.batch_year', 'DESC')
      .take(5)
      .getMany();
    return found.map((item) => ({
      id: item.id,
      alumni_no: item.alumni_no,
      full_name: fullName(item.first_name, item.last_name),
      batch_year: Number(item.batch_year),
      mobile: item.mobile,
    }));
  }

  private async guard(schoolId: number, mobile: string | null): Promise<void> {
    const [pending, lastHour] = await Promise.all([
      mobile
        ? this.submissions.count({ where: { school_id: schoolId, mobile, status: 'pending' } })
        : Promise.resolve(0),
      this.submissions.count({
        where: { school_id: schoolId, created_at: MoreThan(new Date(Date.now() - 60 * 60 * 1000)) },
      }),
    ]);
    const block = submissionBlock(pending, lastHour);
    if (block === 'TOO_MANY_SUBMISSIONS') {
      throw AppException.tooManyRequests('Too many submissions right now. Try again in an hour.', block);
    }
    if (block === 'SUBMISSION_PENDING') {
      throw AppException.conflict(
        'You already have details waiting for the school to review. Please wait for them first.',
        block,
      );
    }
  }

  private async byToken(token: string): Promise<{ link: AlumniUpdateLink; alumni: Alumni }> {
    const link = await this.links.findOneBy({ token_hash: hashToken(token) });
    if (!link || !linkUsable(link, new Date())) {
      throw AppException.notFound(
        'This link has expired or was already used. Ask the school for a new one.',
        'LINK_INVALID',
      );
    }
    const alumni = await this.alumni.findOneBy({ id: link.alumni_id, school_id: link.school_id });
    if (!alumni) {
      throw AppException.notFound(
        'This link has expired or was already used. Ask the school for a new one.',
        'LINK_INVALID',
      );
    }
    return { link, alumni };
  }

  private async schoolByCode(code: string): Promise<SchoolRow> {
    const [row] = (await this.dataSource.query(
      `SELECT id, code, name, logo_file_id FROM schools WHERE upper(code) = upper($1) AND deleted_at IS NULL`,
      [code],
    )) as SchoolRow[];
    if (!row) throw AppException.notFound('School not found', 'SCHOOL_NOT_FOUND');
    return { ...row, id: Number(row.id) };
  }

  private async schoolById(id: number): Promise<SchoolRow> {
    const [row] = (await this.dataSource.query(`SELECT id, code, name, logo_file_id FROM schools WHERE id = $1`, [
      id,
    ])) as SchoolRow[];
    return row;
  }

  private publicSchool(school: SchoolRow): PublicSchoolDto {
    return { code: school.code, name: school.name, logo_url: this.files.linkFor(school.logo_file_id) };
  }

  private announce(schoolId: number, submission: AlumniSubmission): void {
    void this.notify
      .dispatch({
        template: TEMPLATES.ALUMNI_SUBMISSION,
        audience: { roles: [ROLES.ADMIN, ROLES.PRINCIPAL], school_id: schoolId },
        data: {
          name: submission.name,
          kind: submission.type === 'registration' ? 'registered as an alumnus' : 'updated their alumni details',
          id: String(submission.id),
        },
      })
      .catch(() => {});
  }
}
