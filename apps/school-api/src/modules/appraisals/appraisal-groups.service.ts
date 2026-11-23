import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { AppException } from '@app/common';
import { currentYearId } from '../../shared/academic-year';
import { yearClause } from '../../shared/year-context';
import {
  DEFAULT_STAFF_KRAS,
  DEFAULT_TEACHING_KRAS,
  GroupForMatching,
  KraDraft,
  kraSetErrors,
  METRIC_DEFAULT_TARGETS,
  placeStaff,
  round2,
  StaffFacts,
} from './appraisal.logic';
import {
  AppraisalGroupDto,
  AppraisalGroupInputDto,
  CopyYearDto,
  CopyYearResultDto,
  GroupMemberDto,
  GroupMembersDto,
  GroupMembersInputDto,
  GroupRulesDto,
  KraDto,
  KraInputDto,
  UpdateAppraisalGroupDto,
} from './dto/appraisal.dto';
import { AppraisalGroup, AppraisalGroupMember, AppraisalKra, GroupRules } from './entities/appraisal.entity';

export interface StaffRow extends StaffFacts {
  user_id: number;
  name: string;
  employee_no: string;
}

export interface PlacedStaff extends StaffRow {
  group_id: number;
  reason: 'rules' | 'included' | 'default';
  candidates: number[];
}

const rulesOf = (input?: GroupRulesDto): GroupRules => ({
  staff_types: input?.staff_types ?? [],
  departments: input?.departments ?? [],
  designations: input?.designations ?? [],
  roles: input?.roles ?? [],
});

@Injectable()
export class AppraisalGroupsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(AppraisalGroup) private readonly groups: Repository<AppraisalGroup>,
    @InjectRepository(AppraisalGroupMember) private readonly members: Repository<AppraisalGroupMember>,
    @InjectRepository(AppraisalKra) private readonly kras: Repository<AppraisalKra>,
  ) {}

  async list(schoolId: number): Promise<AppraisalGroupDto[]> {
    const rows: AppraisalGroup[] = await this.groups
      .createQueryBuilder('g')
      .where('g.school_id = :schoolId', { schoolId })
      .andWhere(
        `g.academic_year_id = (SELECT y.id FROM academic_years y WHERE y.school_id = :schoolId AND ${yearClause('y')} AND y.deleted_at IS NULL LIMIT 1)`,
      )
      .orderBy('g.is_default', 'ASC')
      .addOrderBy('g.sort_order', 'ASC')
      .addOrderBy('g.id', 'ASC')
      .getMany();
    return this.present(schoolId, rows);
  }

  async get(schoolId: number, id: number): Promise<AppraisalGroupDto> {
    return (await this.present(schoolId, [await this.find(schoolId, id)]))[0]!;
  }

  async create(schoolId: number, dto: AppraisalGroupInputDto): Promise<AppraisalGroupDto> {
    const yearId = await currentYearId(this.dataSource.manager, schoolId);
    await this.assertNameFree(schoolId, yearId, dto.name);
    const saved = await this.dataSource.transaction(async (manager) => {
      if (dto.is_default) await this.clearDefault(manager, schoolId, yearId);
      const group = await manager.save(
        manager.create(AppraisalGroup, {
          school_id: schoolId,
          academic_year_id: yearId,
          name: dto.name,
          description: dto.description ?? null,
          rules: rulesOf(dto.rules),
          is_default: dto.is_default ?? false,
          sort_order: dto.sort_order ?? 0,
          is_active: true,
        }),
      );
      const starter = dto.starter_kras ?? 'none';
      if (starter !== 'none') {
        await this.writeKras(manager, group, starter === 'teaching' ? DEFAULT_TEACHING_KRAS : DEFAULT_STAFF_KRAS);
      }
      return group;
    });
    return this.get(schoolId, saved.id);
  }

  async update(schoolId: number, id: number, dto: UpdateAppraisalGroupDto): Promise<AppraisalGroupDto> {
    const group = await this.find(schoolId, id);
    if (dto.name !== undefined && dto.name.toLowerCase() !== group.name.toLowerCase()) {
      await this.assertNameFree(schoolId, group.academic_year_id, dto.name);
      group.name = dto.name;
    }
    if (dto.description !== undefined) group.description = dto.description;
    if (dto.rules !== undefined) group.rules = rulesOf(dto.rules);
    if (dto.sort_order !== undefined) group.sort_order = dto.sort_order;
    if (dto.is_active !== undefined) group.is_active = dto.is_active;
    await this.dataSource.transaction(async (manager) => {
      if (dto.is_default) await this.clearDefault(manager, schoolId, group.academic_year_id);
      if (dto.is_default !== undefined) group.is_default = dto.is_default;
      await manager.save(group);
    });
    return this.get(schoolId, id);
  }

  async remove(schoolId: number, id: number): Promise<void> {
    const group = await this.find(schoolId, id);
    const [busy] = await this.dataSource.query(
      `SELECT 1 FROM appraisal_cycles WHERE school_id = $1 AND $2 = ANY(group_ids)
         AND status IN ('draft', 'scheduled', 'open') AND deleted_at IS NULL LIMIT 1`,
      [schoolId, id],
    );
    if (busy) throw AppException.conflict('A cycle that is not closed uses this group', 'GROUP_IN_USE');
    await this.dataSource.transaction(async (manager) => {
      await manager.softDelete(AppraisalKra, { group_id: group.id });
      await manager.softDelete(AppraisalGroupMember, { group_id: group.id });
      await manager.softDelete(AppraisalGroup, { id: group.id });
    });
  }

  async membersOf(schoolId: number, id: number): Promise<GroupMembersDto> {
    const group = await this.find(schoolId, id);
    const placed = await this.place(this.dataSource.manager, schoolId, group.academic_year_id);
    const names = new Map(
      (await this.groups.findBy({ school_id: schoolId, academic_year_id: group.academic_year_id })).map((row) => [
        row.id,
        row.name,
      ]),
    );
    const rows = await this.members.findBy({ group_id: group.id });
    const present = (staff: PlacedStaff): GroupMemberDto => ({
      staff_id: staff.staff_id,
      user_id: staff.user_id,
      name: staff.name,
      employee_no: staff.employee_no,
      designation: staff.designation,
      department: staff.department,
      staff_type: staff.staff_type,
      reason: staff.reason,
      also_matches: staff.candidates
        .filter((candidate) => candidate !== staff.group_id)
        .map((candidate) => ({ id: candidate, name: names.get(candidate) ?? '' })),
    });
    const all = [...placed.values()];
    return {
      group_id: group.id,
      members: all.filter((staff) => staff.group_id === group.id).map(present),
      elsewhere: all.filter((staff) => staff.group_id !== group.id && staff.candidates.includes(group.id)).map(present),
      include_staff_ids: rows.filter((row) => row.mode === 'include').map((row) => row.staff_id),
      exclude_staff_ids: rows.filter((row) => row.mode === 'exclude').map((row) => row.staff_id),
    };
  }

  async setMembers(schoolId: number, id: number, dto: GroupMembersInputDto): Promise<GroupMembersDto> {
    const group = await this.find(schoolId, id);
    const both = dto.include_staff_ids.filter((staffId) => dto.exclude_staff_ids.includes(staffId));
    if (both.length) {
      throw AppException.validation([
        { field: 'exclude_staff_ids', message: 'A person cannot be included and excluded' },
      ]);
    }
    const ids = [...dto.include_staff_ids, ...dto.exclude_staff_ids];
    if (ids.length) {
      const [row] = await this.dataSource.query(
        `SELECT COUNT(*) AS total FROM staff WHERE id = ANY($1) AND school_id = $2 AND deleted_at IS NULL`,
        [ids, schoolId],
      );
      if (Number(row.total) !== new Set(ids).size) {
        throw AppException.validation([{ field: 'include_staff_ids', message: 'Some staff are not in this school' }]);
      }
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(AppraisalGroupMember, { group_id: group.id });
      const rows = [
        ...dto.include_staff_ids.map((staffId) => ({ staffId, mode: 'include' as const })),
        ...dto.exclude_staff_ids.map((staffId) => ({ staffId, mode: 'exclude' as const })),
      ];
      if (rows.length) {
        await manager.insert(
          AppraisalGroupMember,
          rows.map((row) => ({ school_id: schoolId, group_id: group.id, staff_id: row.staffId, mode: row.mode })),
        );
      }
    });
    return this.membersOf(schoolId, id);
  }

  async setKras(schoolId: number, id: number, inputs: KraInputDto[]): Promise<AppraisalGroupDto> {
    const group = await this.find(schoolId, id);
    const drafts: KraDraft[] = inputs.map((input) => ({
      code: input.code.toLowerCase(),
      title: input.title,
      description: input.description ?? null,
      category: input.category ?? 'general',
      weightage_percent: input.weightage_percent,
      max_score: input.max_score ?? 5,
      scoring_mode: input.scoring_mode ?? 'manual',
      auto_metric: input.auto_metric ?? null,
      auto_target: input.auto_target ?? null,
    }));
    const errors = kraSetErrors(drafts);
    if (errors.length) throw AppException.validation(errors);
    await this.dataSource.transaction((manager) => this.writeKras(manager, group, drafts));
    return this.get(schoolId, id);
  }

  async copyYear(schoolId: number, dto: CopyYearDto): Promise<CopyYearResultDto> {
    if (dto.from_academic_year_id === dto.to_academic_year_id) {
      throw AppException.validation([{ field: 'to_academic_year_id', message: 'Choose a different year' }]);
    }
    const years: { id: number; status: string }[] = await this.dataSource.query(
      `SELECT id, status FROM academic_years WHERE school_id = $1 AND id = ANY($2) AND deleted_at IS NULL`,
      [schoolId, [dto.from_academic_year_id, dto.to_academic_year_id]],
    );
    const target = years.find((year) => Number(year.id) === dto.to_academic_year_id);
    if (years.length !== 2 || !target) {
      throw AppException.notFound('Academic year not found', 'ACADEMIC_YEAR_NOT_FOUND');
    }
    if (target.status === 'closed' || target.status === 'archived') {
      throw AppException.conflict('The target year is closed', 'YEAR_NOT_WRITABLE');
    }
    const source = await this.groups.findBy({ school_id: schoolId, academic_year_id: dto.from_academic_year_id });
    const existing = new Set(
      (await this.groups.findBy({ school_id: schoolId, academic_year_id: dto.to_academic_year_id })).map((group) =>
        group.name.toLowerCase(),
      ),
    );
    let copied = 0;
    await this.dataSource.transaction(async (manager) => {
      for (const group of source) {
        if (existing.has(group.name.toLowerCase())) continue;
        const copy = await manager.save(
          manager.create(AppraisalGroup, {
            school_id: schoolId,
            academic_year_id: dto.to_academic_year_id,
            name: group.name,
            description: group.description,
            rules: group.rules,
            is_default: group.is_default,
            sort_order: group.sort_order,
            is_active: group.is_active,
          }),
        );
        const [members, kras] = await Promise.all([
          manager.findBy(AppraisalGroupMember, { group_id: group.id }),
          manager.findBy(AppraisalKra, { group_id: group.id }),
        ]);
        if (members.length) {
          await manager.insert(
            AppraisalGroupMember,
            members.map((member) => ({
              school_id: schoolId,
              group_id: copy.id,
              staff_id: member.staff_id,
              mode: member.mode,
            })),
          );
        }
        if (kras.length) {
          await manager.insert(
            AppraisalKra,
            kras.map((kra) => ({
              school_id: schoolId,
              group_id: copy.id,
              code: kra.code,
              title: kra.title,
              description: kra.description,
              category: kra.category,
              weightage_percent: kra.weightage_percent,
              max_score: kra.max_score,
              scoring_mode: kra.scoring_mode,
              auto_metric: kra.auto_metric,
              auto_target: kra.auto_target,
              sort_order: kra.sort_order,
            })),
          );
        }
        copied += 1;
      }
    });
    return { copied, skipped: source.length - copied };
  }

  async place(manager: EntityManager, schoolId: number, yearId: number): Promise<Map<number, PlacedStaff>> {
    const [groups, memberRows, staff] = await Promise.all([
      manager.findBy(AppraisalGroup, { school_id: schoolId, academic_year_id: yearId, is_active: true }),
      manager.query(
        `SELECT m.group_id, m.staff_id, m.mode FROM appraisal_group_members m
         JOIN appraisal_groups g ON g.id = m.group_id AND g.deleted_at IS NULL
         WHERE m.school_id = $1 AND g.academic_year_id = $2 AND m.deleted_at IS NULL`,
        [schoolId, yearId],
      ) as Promise<{ group_id: number; staff_id: number; mode: string }[]>,
      this.staffRows(manager, schoolId),
    ]);
    const matching: GroupForMatching[] = groups.map((group) => {
      const rows = memberRows.filter((row) => Number(row.group_id) === group.id);
      return {
        id: group.id,
        rules: group.rules,
        is_default: group.is_default,
        sort_order: group.sort_order,
        include: new Set(rows.filter((row) => row.mode === 'include').map((row) => Number(row.staff_id))),
        exclude: new Set(rows.filter((row) => row.mode === 'exclude').map((row) => Number(row.staff_id))),
      };
    });
    const placed = new Map<number, PlacedStaff>();
    for (const person of staff) {
      const placement = placeStaff(person, matching);
      if (placement.group_id === null) continue;
      const group = matching.find((row) => row.id === placement.group_id)!;
      placed.set(person.staff_id, {
        ...person,
        group_id: placement.group_id,
        candidates: placement.candidates,
        reason: group.include.has(person.staff_id) ? 'included' : group.is_default ? 'default' : 'rules',
      });
    }
    return placed;
  }

  async kraSetProblems(manager: EntityManager, groupIds: number[]): Promise<string[]> {
    const groups = await manager.findBy(AppraisalGroup, { id: In(groupIds) });
    const kras = await manager.findBy(AppraisalKra, { group_id: In(groupIds) });
    return groups
      .filter((group) => {
        const rows = kras.filter((kra) => kra.group_id === group.id);
        return !rows.length || round2(rows.reduce((sum, kra) => sum + Number(kra.weightage_percent), 0)) !== 100;
      })
      .map((group) => group.name);
  }

  private async staffRows(manager: EntityManager, schoolId: number): Promise<StaffRow[]> {
    const rows: {
      staff_id: number;
      user_id: number;
      name: string;
      employee_no: string;
      designation: string;
      department: string | null;
      staff_type: string;
      roles: string[] | null;
    }[] = await manager.query(
      `SELECT st.id AS staff_id, st.user_id, u.name, st.employee_no, st.designation, st.department, st.staff_type,
              ARRAY_AGG(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL) AS roles
       FROM staff st
       JOIN users u ON u.id = st.user_id AND u.deleted_at IS NULL AND u.status = 'active'
       LEFT JOIN user_roles ur ON ur.user_id = st.user_id
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE st.school_id = $1 AND st.deleted_at IS NULL AND st.status <> 'resigned'
       GROUP BY st.id, u.name
       ORDER BY u.name`,
      [schoolId],
    );
    return rows.map((row) => ({
      staff_id: Number(row.staff_id),
      user_id: Number(row.user_id),
      name: row.name,
      employee_no: row.employee_no,
      designation: row.designation,
      department: row.department,
      staff_type: row.staff_type,
      roles: row.roles ?? [],
    }));
  }

  private async writeKras(manager: EntityManager, group: AppraisalGroup, drafts: KraDraft[]): Promise<void> {
    const current = await manager.findBy(AppraisalKra, { group_id: group.id });
    const kept = new Set(drafts.map((draft) => draft.code));
    const gone = current.filter((kra) => !kept.has(kra.code)).map((kra) => kra.id);
    if (gone.length) await manager.softDelete(AppraisalKra, { id: In(gone) });
    for (const [index, draft] of drafts.entries()) {
      const target =
        draft.scoring_mode === 'auto' ? (draft.auto_target ?? METRIC_DEFAULT_TARGETS[draft.auto_metric!]) : null;
      const values = {
        title: draft.title,
        description: draft.description ?? null,
        category: draft.category,
        weightage_percent: String(draft.weightage_percent),
        max_score: draft.max_score,
        scoring_mode: draft.scoring_mode,
        auto_metric: draft.scoring_mode === 'auto' ? (draft.auto_metric ?? null) : null,
        auto_target: target === null ? null : String(target),
        sort_order: index + 1,
      };
      const existing = current.find((kra) => kra.code === draft.code);
      if (existing) await manager.update(AppraisalKra, { id: existing.id }, values);
      else
        await manager.insert(AppraisalKra, {
          ...values,
          school_id: group.school_id,
          group_id: group.id,
          code: draft.code,
        });
    }
  }

  private async clearDefault(manager: EntityManager, schoolId: number, yearId: number): Promise<void> {
    await manager.update(
      AppraisalGroup,
      { school_id: schoolId, academic_year_id: yearId, is_default: true, deleted_at: IsNull() },
      { is_default: false },
    );
  }

  private async assertNameFree(schoolId: number, yearId: number, name: string): Promise<void> {
    const [row] = await this.dataSource.query(
      `SELECT 1 FROM appraisal_groups WHERE school_id = $1 AND academic_year_id = $2 AND LOWER(name) = LOWER($3)
         AND deleted_at IS NULL LIMIT 1`,
      [schoolId, yearId, name],
    );
    if (row) throw AppException.conflict('A group with this name already exists this year', 'GROUP_NAME_TAKEN');
  }

  private async find(schoolId: number, id: number): Promise<AppraisalGroup> {
    const group = await this.groups.findOneBy({ id, school_id: schoolId, deleted_at: IsNull() });
    if (!group) throw AppException.notFound('Appraisal group not found', 'GROUP_NOT_FOUND');
    return group;
  }

  private async present(schoolId: number, rows: AppraisalGroup[]): Promise<AppraisalGroupDto[]> {
    if (!rows.length) return [];
    const kras = await this.kras.find({
      where: { group_id: In(rows.map((row) => row.id)), deleted_at: IsNull() },
      order: { sort_order: 'ASC', id: 'ASC' },
    });
    const counts = new Map<number, number>();
    for (const yearId of new Set(rows.map((row) => row.academic_year_id))) {
      for (const staff of (await this.place(this.dataSource.manager, schoolId, yearId)).values()) {
        counts.set(staff.group_id, (counts.get(staff.group_id) ?? 0) + 1);
      }
    }
    return rows.map((row) => {
      const own = kras.filter((kra) => kra.group_id === row.id).map(presentKra);
      return {
        id: row.id,
        academic_year_id: row.academic_year_id,
        name: row.name,
        description: row.description,
        rules: row.rules,
        is_default: row.is_default,
        sort_order: row.sort_order,
        is_active: row.is_active,
        member_count: counts.get(row.id) ?? 0,
        weight_total: round2(own.reduce((sum, kra) => sum + kra.weightage_percent, 0)),
        kras: own,
      };
    });
  }
}

export function presentKra(kra: AppraisalKra): KraDto {
  return {
    id: kra.id,
    code: kra.code,
    title: kra.title,
    description: kra.description,
    category: kra.category,
    weightage_percent: Number(kra.weightage_percent),
    max_score: kra.max_score,
    scoring_mode: kra.scoring_mode,
    auto_metric: kra.auto_metric,
    auto_target: kra.auto_target === null ? null : Number(kra.auto_target),
    sort_order: kra.sort_order,
  };
}
