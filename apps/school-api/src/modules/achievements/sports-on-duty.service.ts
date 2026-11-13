import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppException, AuthUser } from '@app/common';
import { SportsOnDuty } from './entities/sports-on-duty.entity';
import {
  CreateSportsOnDutyDto,
  SportsOnDutyDto,
  SportsOnDutyQueryDto,
  UpdateSportsOnDutyDto,
} from './dto/sports-on-duty.dto';

@Injectable()
export class SportsOnDutyService {
  constructor(private readonly dataSource: DataSource) {}

  async list(schoolId: number, query: SportsOnDutyQueryDto): Promise<SportsOnDutyDto[]> {
    const params: (string | number)[] = [schoolId];
    let sql = `
      SELECT od.id, od.sport_name, od.title, to_char(od.from_date, 'YYYY-MM-DD') AS from_date,
             to_char(od.to_date, 'YYYY-MM-DD') AS to_date, od.session, od.venue, od.notes, od.created_at,
             s.id AS student_id, concat_ws(' ', s.first_name, s.last_name) AS student_name, s.admission_no,
             sec.name AS section_name, c.name AS class_name
      FROM sports_on_duty od
      JOIN students s ON s.id = od.student_id
      LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.status = 'studying'
      LEFT JOIN sections sec ON sec.id = e.section_id
      LEFT JOIN classes c ON c.id = sec.class_id
      WHERE od.school_id = $1 AND od.deleted_at IS NULL
    `;

    if (query.date) {
      params.push(query.date);
      sql += ` AND $${params.length} BETWEEN od.from_date AND od.to_date`;
    }
    if (query.student_id) {
      params.push(query.student_id);
      sql += ` AND od.student_id = $${params.length}`;
    }
    if (query.section_id) {
      params.push(query.section_id);
      sql += ` AND sec.id = $${params.length}`;
    } else if (query.class_id) {
      params.push(query.class_id);
      sql += ` AND c.id = $${params.length}`;
    }
    if (query.search) {
      params.push(`%${query.search.trim()}%`);
      sql += ` AND (od.title ILIKE $${params.length} OR od.sport_name ILIKE $${params.length} OR s.first_name ILIKE $${params.length} OR s.last_name ILIKE $${params.length} OR s.admission_no ILIKE $${params.length})`;
    }

    sql += ` ORDER BY od.from_date DESC, od.id DESC`;

    const rows = await this.dataSource.query(sql, params);
    return rows.map((r: Record<string, unknown>) => ({
      id: Number(r.id),
      student: {
        id: Number(r.student_id),
        name: String(r.student_name ?? ''),
        admission_no: String(r.admission_no ?? ''),
        section_name: r.class_name && r.section_name ? `${r.class_name} - ${r.section_name}` : null,
      },
      sport_name: String(r.sport_name),
      title: String(r.title),
      from_date: String(r.from_date),
      to_date: String(r.to_date),
      session: r.session ? String(r.session) : null,
      venue: r.venue ? String(r.venue) : null,
      notes: r.notes ? String(r.notes) : null,
      created_at: new Date(String(r.created_at)),
    }));
  }

  async create(schoolId: number, dto: CreateSportsOnDutyDto, actor: AuthUser): Promise<SportsOnDutyDto[]> {
    if (dto.to_date < dto.from_date) {
      throw AppException.badRequest('End date cannot be before start date', 'INVALID_DATE_RANGE');
    }

    const students = await this.dataSource.query(
      `SELECT id FROM students WHERE school_id = $1 AND id = ANY($2) AND deleted_at IS NULL`,
      [schoolId, dto.student_ids],
    );
    const validIds = new Set(students.map((s: { id: number }) => Number(s.id)));
    const targetIds = dto.student_ids.filter((id) => validIds.has(id));

    if (!targetIds.length) {
      throw AppException.badRequest('No valid students found', 'STUDENTS_NOT_FOUND');
    }

    const repo = this.dataSource.getRepository(SportsOnDuty);
    const created: SportsOnDuty[] = [];

    for (const studentId of targetIds) {
      const entity = repo.create({
        school_id: schoolId,
        student_id: studentId,
        sport_name: dto.sport_name.trim(),
        title: dto.title.trim(),
        from_date: dto.from_date,
        to_date: dto.to_date,
        session: dto.session ?? null,
        venue: dto.venue ? dto.venue.trim() : null,
        notes: dto.notes ? dto.notes.trim() : null,
        created_by: actor.id,
      });
      created.push(await repo.save(entity));
    }

    return this.list(schoolId, { search: dto.title.trim() });
  }

  async update(schoolId: number, id: number, dto: UpdateSportsOnDutyDto): Promise<SportsOnDutyDto> {
    const repo = this.dataSource.getRepository(SportsOnDuty);
    const existing = await repo.findOne({ where: { id, school_id: schoolId } });
    if (!existing) {
      throw AppException.notFound('Sports OD record not found', 'OD_NOT_FOUND');
    }

    const fromDate = dto.from_date ?? existing.from_date;
    const toDate = dto.to_date ?? existing.to_date;
    if (toDate < fromDate) {
      throw AppException.badRequest('End date cannot be before start date', 'INVALID_DATE_RANGE');
    }

    if (dto.sport_name !== undefined) existing.sport_name = dto.sport_name.trim();
    if (dto.title !== undefined) existing.title = dto.title.trim();
    if (dto.from_date !== undefined) existing.from_date = dto.from_date;
    if (dto.to_date !== undefined) existing.to_date = dto.to_date;
    if (dto.session !== undefined) existing.session = dto.session ?? null;
    if (dto.venue !== undefined) existing.venue = dto.venue ? dto.venue.trim() : null;
    if (dto.notes !== undefined) existing.notes = dto.notes ? dto.notes.trim() : null;

    await repo.save(existing);
    const items = await this.list(schoolId, { student_id: existing.student_id });
    const match = items.find((item) => item.id === id);
    if (!match) throw AppException.notFound('Sports OD record not found', 'OD_NOT_FOUND');
    return match;
  }

  async remove(schoolId: number, id: number): Promise<void> {
    const repo = this.dataSource.getRepository(SportsOnDuty);
    const existing = await repo.findOne({ where: { id, school_id: schoolId } });
    if (!existing) {
      throw AppException.notFound('Sports OD record not found', 'OD_NOT_FOUND');
    }
    await repo.softRemove(existing);
  }
}
