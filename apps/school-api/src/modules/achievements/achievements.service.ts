import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { AppException, AuthUser, listQuery, Paginated } from '@app/common';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  AchievementDto,
  AchievementFilterDto,
  AchievementInputDto,
  AchievementInsightsDto,
  AchievementListQueryDto,
  AchievementStudentDto,
  LeaderboardDto,
  LeaderboardQueryDto,
  LeaderboardRowDto,
  SchoolAchievementDto,
  UpdateAchievementDto,
} from './dto/achievement.dto';
import {
  ACHIEVEMENT_LEVELS,
  achievementPoints,
  AchievementLevel,
  StudentAchievement,
} from './entities/student-achievement.entity';
import { yearClause } from '../../shared/year-context';

export const LEVEL_LABELS: Record<string, string> = {
  class: 'Class',
  school: 'School',
  zone: 'Zone',
  district: 'District',
  state: 'State',
  national: 'National',
  international: 'International',
};

const RESULT_LABELS: Record<string, string> = {
  winner: 'Winner',
  runner_up: 'Runner-up',
  third_place: 'Third place',
  participated: 'Took part',
};

const HIGH_LEVELS: AchievementLevel[] = ['district', 'state', 'national', 'international'];
const PODIUM = ['winner', 'runner_up', 'third_place'];

export function sportsDetailsError(row: Pick<StudentAchievement, 'category' | 'venue_type'>): string | null {
  return row.category === 'sports' && !row.venue_type ? 'Choose indoor or outdoor for a sports achievement' : null;
}

export function rankRows<T extends { points: number }>(rows: T[]): (T & { rank: number })[] {
  let rank = 0;
  return rows.map((row, index) => {
    if (index === 0 || row.points !== rows[index - 1]!.points) rank = index + 1;
    return { ...row, rank };
  });
}

interface Range {
  from: string;
  to: string;
}

@Injectable()
export class AchievementsService {
  private readonly logger = new Logger('Achievements');

  constructor(
    @InjectRepository(StudentAchievement) private readonly achievements: Repository<StudentAchievement>,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
    private readonly dataSource: DataSource,
  ) {}

  async list(schoolId: number, studentId: number, options: { parent?: boolean } = {}): Promise<AchievementDto[]> {
    await this.student(schoolId, studentId);
    const rows = await this.achievements.find({
      where: { school_id: schoolId, student_id: studentId, ...(options.parent ? { visible_to_parent: true } : {}) },
      order: { achieved_on: 'DESC', id: 'DESC' },
    });
    return this.present(rows);
  }

  async create(
    schoolId: number,
    studentId: number,
    dto: AchievementInputDto,
    actor: AuthUser,
  ): Promise<AchievementDto> {
    const student = await this.student(schoolId, studentId);
    if (dto.file_id) await this.files.assertAttachable(dto.file_id, schoolId);
    const row = this.achievements.create({
      school_id: schoolId,
      student_id: studentId,
      title: dto.title,
      category: dto.category,
      level: dto.level ?? 'school',
      result: dto.result ?? 'participated',
      event_scope: dto.event_scope ?? 'in_school',
      venue_type: dto.venue_type ?? null,
      participation: dto.participation ?? 'individual',
      team_name: dto.participation === 'team' ? (dto.team_name ?? null) : null,
      position: dto.position ?? null,
      prize_received: dto.prize_received ?? null,
      school_reward: dto.school_reward ?? null,
      achieved_on: dto.achieved_on,
      description: dto.description ?? null,
      file_id: dto.file_id ?? null,
      visible_to_parent: dto.visible_to_parent ?? true,
      created_by: actor.id,
    });
    this.assertSportsDetails(row);
    row.points = achievementPoints(row.level, row.result);
    const saved = await this.achievements.save(row);
    if (saved.visible_to_parent) await this.notifyParents(saved, student.name);
    return (await this.present([saved]))[0]!;
  }

  async update(schoolId: number, studentId: number, id: number, dto: UpdateAchievementDto): Promise<AchievementDto> {
    const row = await this.find(schoolId, studentId, id);
    if (dto.file_id && dto.file_id !== row.file_id) await this.files.assertAttachable(dto.file_id, schoolId);
    const merged = this.achievements.merge(row, dto);
    if (merged.participation !== 'team') merged.team_name = null;
    this.assertSportsDetails(merged);
    merged.points = achievementPoints(merged.level, merged.result);
    await this.achievements.save(merged);
    return (await this.present([merged]))[0]!;
  }

  async remove(schoolId: number, studentId: number, id: number): Promise<void> {
    const row = await this.find(schoolId, studentId, id);
    await this.achievements.softDelete(row.id);
  }

  async count(schoolId: number, studentId: number): Promise<number> {
    return this.achievements.countBy({ school_id: schoolId, student_id: studentId });
  }

  async listSchool(schoolId: number, query: AchievementListQueryDto): Promise<Paginated<SchoolAchievementDto>> {
    const qb = this.achievements.createQueryBuilder('a');
    await this.applyFilters(qb, schoolId, query);
    if (query.level) qb.andWhere('a.level = :level', { level: query.level });
    if (query.result === 'podium') qb.andWhere('a.result IN (:...podium)', { podium: PODIUM });
    else if (query.result) qb.andWhere('a.result = :result', { result: query.result });
    if (query.event_scope) qb.andWhere('a.event_scope = :scope', { scope: query.event_scope });
    if (query.venue_type) qb.andWhere('a.venue_type = :venue', { venue: query.venue_type });
    if (query.participation) qb.andWhere('a.participation = :participation', { participation: query.participation });
    if (query.district_or_above) qb.andWhere('a.level IN (:...high)', { high: HIGH_LEVELS });
    if (query.outside_school) qb.andWhere(`a.event_scope IN ('inter_school', 'out_of_school')`);
    const page = await listQuery(qb, query, {
      searchable: ['a.title', 's.first_name', 's.last_name', 's.admission_no', 'a.team_name'],
      sortable: { achieved_on: 'a.achieved_on', points: 'a.points', title: 'a.title', created_at: 'a.created_at' },
      defaultSort: 'achieved_on',
    });
    const [presented, students] = await Promise.all([
      this.present(page.items),
      this.studentRefs(page.items.map((row) => row.student_id)),
    ]);
    return {
      ...page,
      items: presented.map((item, index) => ({ ...item, student: students.get(page.items[index]!.student_id)! })),
    };
  }

  async insights(schoolId: number, filter: AchievementFilterDto): Promise<AchievementInsightsDto> {
    const qb = this.achievements.createQueryBuilder('a');
    await this.applyFilters(qb, schoolId, filter);
    const row = await qb
      .select('COUNT(*)', 'total')
      .addSelect(`COUNT(*) FILTER (WHERE a.category = 'sports')`, 'sports')
      .addSelect(`COUNT(*) FILTER (WHERE a.result = 'winner')`, 'wins')
      .addSelect(`COUNT(*) FILTER (WHERE a.event_scope IN ('inter_school', 'out_of_school'))`, 'outside_events')
      .addSelect(
        `COUNT(*) FILTER (WHERE a.level IN ('district', 'state', 'national', 'international'))`,
        'district_or_above',
      )
      .addSelect('COUNT(DISTINCT a.student_id)', 'students')
      .getRawOne<Record<keyof AchievementInsightsDto, string>>();
    return {
      total: Number(row?.total ?? 0),
      sports: Number(row?.sports ?? 0),
      wins: Number(row?.wins ?? 0),
      outside_events: Number(row?.outside_events ?? 0),
      district_or_above: Number(row?.district_or_above ?? 0),
      students: Number(row?.students ?? 0),
    };
  }

  async leaderboard(schoolId: number, query: LeaderboardQueryDto): Promise<LeaderboardDto> {
    const qb = this.achievements.createQueryBuilder('a');
    const range = await this.applyFilters(qb, schoolId, query);
    const rows = await qb
      .select('a.student_id', 'student_id')
      .addSelect('SUM(a.points)', 'points')
      .addSelect('COUNT(*)', 'achievements')
      .addSelect(`COUNT(*) FILTER (WHERE a.result = 'winner')`, 'wins')
      .addSelect(`COUNT(*) FILTER (WHERE a.result IN ('winner', 'runner_up', 'third_place'))`, 'podiums')
      .addSelect(`COUNT(*) FILTER (WHERE a.event_scope IN ('inter_school', 'out_of_school'))`, 'outside_events')
      .addSelect(
        `MAX(array_position(ARRAY[${ACHIEVEMENT_LEVELS.map((level) => `'${level}'`).join(', ')}]::varchar[], a.level))`,
        'best_level',
      )
      .addSelect(`MIN(concat_ws(' ', s.first_name, s.last_name))`, 'name')
      .groupBy('a.student_id')
      .orderBy('SUM(a.points)', 'DESC')
      .addOrderBy(`COUNT(*) FILTER (WHERE a.result = 'winner')`, 'DESC')
      .addOrderBy(`MIN(concat_ws(' ', s.first_name, s.last_name))`, 'ASC')
      .limit(query.limit ?? 10)
      .getRawMany<Record<string, string>>();
    const students = await this.studentRefs(rows.map((row) => Number(row.student_id)));
    const ranked = rankRows(
      rows.map((row) => ({
        student: students.get(Number(row.student_id))!,
        points: Number(row.points),
        achievements: Number(row.achievements),
        wins: Number(row.wins),
        podiums: Number(row.podiums),
        outside_events: Number(row.outside_events),
        best_level: ACHIEVEMENT_LEVELS[Number(row.best_level) - 1] ?? 'class',
      })),
    );
    return { ...range, rows: ranked as LeaderboardRowDto[] };
  }

  private assertSportsDetails(row: StudentAchievement): void {
    const message = sportsDetailsError(row);
    if (message) throw AppException.validation([{ field: 'venue_type', message }]);
  }

  private async applyFilters(
    qb: SelectQueryBuilder<StudentAchievement>,
    schoolId: number,
    filter: AchievementFilterDto,
  ): Promise<Range> {
    const range = await this.range(schoolId, filter);
    qb.innerJoin('students', 's', 's.id = a.student_id AND s.deleted_at IS NULL')
      .where('a.school_id = :schoolId', { schoolId })
      .andWhere('a.achieved_on BETWEEN :from AND :to', range);
    if (filter.category === 'non_academic') qb.andWhere(`a.category <> 'academic'`);
    else if (filter.category) qb.andWhere('a.category = :category', { category: filter.category });
    if (filter.class_id || filter.section_id) {
      qb.andWhere(
        new Brackets((where) => {
          where.where(
            `EXISTS (SELECT 1 FROM student_enrollments e
               JOIN academic_years y ON y.id = e.academic_year_id AND ${yearClause('y')}
               JOIN sections sec ON sec.id = e.section_id
               WHERE e.student_id = a.student_id
               AND (CAST(:sectionId AS int) IS NULL OR sec.id = :sectionId)
               AND (CAST(:classId AS int) IS NULL OR sec.class_id = :classId))`,
            { sectionId: filter.section_id ?? null, classId: filter.class_id ?? null },
          );
        }),
      );
    }
    return range;
  }

  private async range(schoolId: number, filter: AchievementFilterDto): Promise<Range> {
    if (filter.from && filter.to) {
      if (filter.from > filter.to) {
        throw AppException.validation([{ field: 'to', message: 'to must be on or after from' }]);
      }
      return { from: filter.from, to: filter.to };
    }
    const [year] = await this.dataSource.query(
      `SELECT to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date
       FROM academic_years y WHERE y.school_id = $1 AND ${yearClause('y')} LIMIT 1`,
      [schoolId],
    );
    return {
      from: filter.from ?? year?.start_date ?? '2000-01-01',
      to: filter.to ?? year?.end_date ?? '2100-12-31',
    };
  }

  private async studentRefs(ids: number[]): Promise<Map<number, AchievementStudentDto>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows: {
      id: number;
      name: string;
      admission_no: string;
      photo_file_id: number | null;
      section: string | null;
    }[] = await this.dataSource.query(
      `SELECT s.id, concat_ws(' ', s.first_name, s.last_name) AS name, s.admission_no, s.photo_file_id,
              (SELECT c.name || ' - ' || sec.name FROM student_enrollments e
                 JOIN academic_years y ON y.id = e.academic_year_id AND ${yearClause('y')}
                 JOIN sections sec ON sec.id = e.section_id JOIN classes c ON c.id = sec.class_id
                 WHERE e.student_id = s.id LIMIT 1) AS section
       FROM students s WHERE s.id = ANY($1)`,
      [unique],
    );
    return new Map(
      rows.map((row) => [
        Number(row.id),
        {
          id: Number(row.id),
          name: row.name,
          admission_no: row.admission_no,
          section: row.section,
          photo_file_id: row.photo_file_id ? Number(row.photo_file_id) : null,
        },
      ]),
    );
  }

  private async notifyParents(row: StudentAchievement, studentName: string): Promise<void> {
    const parents: { user_id: number }[] = await this.dataSource.query(
      `SELECT DISTINCT g.user_id FROM student_guardians sg
       JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL AND g.user_id IS NOT NULL
       WHERE sg.student_id = $1 AND sg.receives_alerts = true`,
      [row.student_id],
    );
    if (!parents.length) return;
    const outcome = row.position ?? (row.result === 'participated' ? null : RESULT_LABELS[row.result]);
    await this.notifications
      .dispatch({
        template: 'ACHIEVEMENT_ADDED',
        audience: { user_ids: parents.map((parent) => Number(parent.user_id)) },
        data: {
          student: studentName,
          title: row.title,
          level: LEVEL_LABELS[row.level] ?? row.level,
          position: outcome ? ` (${outcome})` : '',
          student_id: String(row.student_id),
          achievement_id: String(row.id),
        },
      })
      .catch((error: Error) => this.logger.warn(`Achievement ${row.id} alert not sent: ${error.message}`));
  }

  private async student(schoolId: number, studentId: number): Promise<{ id: number; name: string }> {
    const [row] = await this.dataSource.query(
      `SELECT id, concat_ws(' ', first_name, last_name) AS name FROM students
       WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [studentId, schoolId],
    );
    if (!row) throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');
    return { id: Number(row.id), name: row.name };
  }

  private async find(schoolId: number, studentId: number, id: number): Promise<StudentAchievement> {
    const row = await this.achievements.findOneBy({ id, school_id: schoolId, student_id: studentId });
    if (!row) throw AppException.notFound('Achievement not found', 'ACHIEVEMENT_NOT_FOUND');
    return row;
  }

  private async present(rows: StudentAchievement[]): Promise<AchievementDto[]> {
    if (!rows.length) return [];
    const [files, people] = await Promise.all([
      this.files.presentMany(rows.map((row) => row.file_id)),
      this.dataSource.query(`SELECT id, name FROM users WHERE id = ANY($1)`, [
        [...new Set(rows.map((row) => row.created_by).filter(Boolean))],
      ]) as Promise<{ id: number; name: string }[]>,
    ]);
    return rows.map((row) => {
      const person = people.find((item) => Number(item.id) === row.created_by);
      return {
        id: row.id,
        title: row.title,
        category: row.category,
        level: row.level,
        result: row.result,
        event_scope: row.event_scope,
        venue_type: row.venue_type,
        participation: row.participation,
        team_name: row.team_name,
        position: row.position,
        prize_received: row.prize_received,
        school_reward: row.school_reward,
        points: row.points,
        achieved_on: row.achieved_on,
        description: row.description,
        file: row.file_id ? (files.get(row.file_id) ?? null) : null,
        visible_to_parent: row.visible_to_parent,
        added_by: person ? { id: Number(person.id), name: person.name } : null,
        created_at: row.created_at,
      };
    });
  }
}
