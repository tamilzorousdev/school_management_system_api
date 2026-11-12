import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppException } from '@app/common';
import { AcademicYear } from '../setup/entities/academic-year.entity';
import { Section } from '../setup/entities/section.entity';
import { Subject } from '../setup/entities/subject.entity';
import { Staff } from '../staff/entities/staff.entity';
import { TeacherAssignment } from '../staff/entities/teacher-assignment.entity';
import {
  BellPeriodDto,
  BellScheduleDto,
  DAY_NAMES,
  SectionTimetableDto,
  SlotDto,
  SlotInputDto,
  TeacherTimetableDto,
  WorkloadDto,
} from './dto/timetable.dto';
import { BellPeriod } from './entities/bell-period.entity';
import { TimetableSlot } from './entities/timetable-slot.entity';
import { yearWhere } from '../../shared/year-context';

export const SCHOOL_DAYS = [1, 2, 3, 4, 5, 6];

export const DEFAULT_BELL: [string, string, string, boolean][] = [
  ['Period 1', '08:50', '09:35', false],
  ['Period 2', '09:35', '10:20', false],
  ['Break', '10:20', '10:35', true],
  ['Period 3', '10:35', '11:20', false],
  ['Period 4', '11:20', '12:05', false],
  ['Lunch', '12:05', '12:45', true],
  ['Period 5', '12:45', '13:30', false],
  ['Period 6', '13:30', '14:15', false],
  ['Period 7', '14:15', '15:00', false],
  ['Period 8', '15:00', '15:45', false],
];

export function validateBell(items: { name: string; start_time: string; end_time: string }[]): string | null {
  for (const [index, item] of items.entries()) {
    if (item.start_time >= item.end_time) return `${item.name} must end after it starts`;
    const next = items[index + 1];
    if (next && next.start_time < item.end_time) return `${next.name} starts before ${item.name} ends`;
  }
  return null;
}

interface SlotRow {
  id: number;
  day_of_week: number;
  period_no: number;
  section_id: number;
  class_name: string;
  section_name: string;
  subject_id: number;
  subject_name: string;
  subject_code: string;
  teacher_user_id: number | null;
  teacher_name: string | null;
  room: string | null;
}

const SLOT_SELECT = `SELECT t.id, t.day_of_week, t.period_no, t.section_id, c.name AS class_name, sec.name AS section_name,
  t.subject_id, s.name AS subject_name, s.code AS subject_code, t.teacher_user_id, u.name AS teacher_name, t.room
  FROM timetable_slots t
  JOIN sections sec ON sec.id = t.section_id JOIN classes c ON c.id = sec.class_id
  JOIN subjects s ON s.id = t.subject_id LEFT JOIN users u ON u.id = t.teacher_user_id`;

@Injectable()
export class TimetableService {
  constructor(
    @InjectRepository(BellPeriod) private readonly bells: Repository<BellPeriod>,
    @InjectRepository(TimetableSlot) private readonly slots: Repository<TimetableSlot>,
    private readonly dataSource: DataSource,
  ) {}

  async periods(schoolId: number): Promise<BellPeriodDto[]> {
    if (!(await this.bells.existsBy({ school_id: schoolId }))) {
      await this.saveBell(
        schoolId,
        DEFAULT_BELL.map(([name, start, end, isBreak]) => ({
          name,
          start_time: start,
          end_time: end,
          is_break: isBreak,
        })),
      );
    }
    const rows = await this.bells.find({ where: { school_id: schoolId }, order: { sort_order: 'ASC' } });
    return rows.map(({ id, period_no, name, start_time, end_time, is_break }) => ({
      id,
      period_no,
      name,
      start_time,
      end_time,
      is_break,
    }));
  }

  async setPeriods(schoolId: number, dto: BellScheduleDto): Promise<BellPeriodDto[]> {
    const error = validateBell(dto.items);
    if (error) throw AppException.badRequest(error, 'BELL_INVALID');
    const teaching = dto.items.filter((item) => !item.is_break).length;
    if (!teaching) throw AppException.badRequest('Add at least one teaching period', 'BELL_INVALID');
    const [used] = await this.dataSource.query(
      `SELECT MAX(period_no) AS max FROM timetable_slots WHERE school_id = $1`,
      [schoolId],
    );
    if (Number(used?.max ?? 0) > teaching) {
      throw AppException.conflict(
        `The timetable uses period ${used.max}. Clear those periods before removing them.`,
        'PERIOD_IN_USE',
      );
    }
    await this.saveBell(schoolId, dto.items);
    return this.periods(schoolId);
  }

  async sectionGrid(schoolId: number, sectionId: number): Promise<SectionTimetableDto> {
    const section = await this.section(schoolId, sectionId);
    const [periods, slots, plan] = await Promise.all([
      this.periods(schoolId),
      this.dataSource.query(`${SLOT_SELECT} WHERE t.section_id = $1 ORDER BY t.day_of_week, t.period_no`, [
        sectionId,
      ]) as Promise<SlotRow[]>,
      this.dataSource.query(
        `SELECT s.id, s.name, s.code, cs.periods_per_week AS required, ta.teacher_user_id, u.name AS teacher_name,
                (SELECT COUNT(*) FROM timetable_slots t WHERE t.section_id = $1 AND t.subject_id = s.id) AS scheduled
         FROM class_subjects cs JOIN subjects s ON s.id = cs.subject_id AND s.deleted_at IS NULL
         LEFT JOIN teacher_assignments ta ON ta.section_id = $1 AND ta.subject_id = s.id AND ta.deleted_at IS NULL
         LEFT JOIN users u ON u.id = ta.teacher_user_id
         WHERE cs.class_id = $2 AND cs.academic_year_id = $3
         ORDER BY s.name`,
        [sectionId, section.class_id, section.academic_year_id],
      ) as Promise<
        {
          id: number;
          name: string;
          code: string;
          required: number;
          teacher_user_id: number | null;
          teacher_name: string | null;
          scheduled: string;
        }[]
      >,
    ]);
    return {
      section: { id: section.id, name: `${section.class_name} - ${section.name}` },
      room: section.room,
      days: SCHOOL_DAYS,
      periods,
      slots: slots.map((row) => this.presentSlot(row)),
      plan: plan.map((row) => ({
        subject: { id: Number(row.id), name: row.name, code: row.code },
        required: Number(row.required ?? 0),
        scheduled: Number(row.scheduled),
        teacher: row.teacher_user_id ? { id: Number(row.teacher_user_id), name: row.teacher_name ?? '' } : null,
      })),
    };
  }

  async setSlot(schoolId: number, sectionId: number, dto: SlotInputDto): Promise<SectionTimetableDto> {
    const section = await this.section(schoolId, sectionId);
    const periods = await this.periods(schoolId);
    const teachingCount = periods.filter((period) => !period.is_break).length;
    if (dto.period_no > teachingCount) {
      throw AppException.validation([
        { field: 'period_no', message: `The bell schedule has ${teachingCount} periods` },
      ]);
    }
    const subject = await this.dataSource.getRepository(Subject).findOneBy({ id: dto.subject_id, school_id: schoolId });
    if (!subject) throw AppException.validation([{ field: 'subject_id', message: 'Choose a subject of this school' }]);

    let teacherId = dto.teacher_user_id;
    if (teacherId === undefined) {
      const assignment = await this.dataSource
        .getRepository(TeacherAssignment)
        .findOneBy({ section_id: sectionId, subject_id: dto.subject_id });
      teacherId = assignment?.teacher_user_id ?? null;
    }
    if (teacherId) {
      const staff = await this.dataSource.getRepository(Staff).findOneBy({ user_id: teacherId, school_id: schoolId });
      if (!staff || staff.status === 'resigned' || staff.staff_type !== 'teaching') {
        throw AppException.badRequest('Choose a teacher from the teaching staff', 'NOT_A_TEACHER');
      }
    }
    const room = dto.room === undefined ? section.room : dto.room;
    const where = { day: dto.day_of_week, period: dto.period_no, year: section.academic_year_id, section: sectionId };

    if (teacherId) {
      const [clash] = await this.dataSource.query(
        `SELECT c.name AS class_name, sec.name AS section_name, u.name AS teacher FROM timetable_slots t
         JOIN sections sec ON sec.id = t.section_id JOIN classes c ON c.id = sec.class_id JOIN users u ON u.id = t.teacher_user_id
         WHERE t.academic_year_id = $1 AND t.day_of_week = $2 AND t.period_no = $3 AND t.teacher_user_id = $4 AND t.section_id <> $5`,
        [where.year, where.day, where.period, teacherId, where.section],
      );
      if (clash) {
        throw AppException.conflict(
          `${clash.teacher} already teaches ${clash.class_name} - ${clash.section_name} in period ${dto.period_no} on ${DAY_NAMES[dto.day_of_week]}`,
          'TEACHER_CLASH',
        );
      }
    }
    if (room) {
      const [clash] = await this.dataSource.query(
        `SELECT c.name AS class_name, sec.name AS section_name FROM timetable_slots t
         JOIN sections sec ON sec.id = t.section_id JOIN classes c ON c.id = sec.class_id
         WHERE t.school_id = $1 AND t.academic_year_id = $2 AND t.day_of_week = $3 AND t.period_no = $4
           AND LOWER(t.room) = LOWER($5) AND t.section_id <> $6`,
        [schoolId, where.year, where.day, where.period, room, where.section],
      );
      if (clash) {
        throw AppException.conflict(
          `${room} is already used by ${clash.class_name} - ${clash.section_name} in period ${dto.period_no} on ${DAY_NAMES[dto.day_of_week]}`,
          'ROOM_CLASH',
        );
      }
    }

    const existing = await this.slots.findOneBy({
      section_id: sectionId,
      day_of_week: dto.day_of_week,
      period_no: dto.period_no,
    });
    await this.slots.save(
      this.slots.merge(existing ?? this.slots.create(), {
        school_id: schoolId,
        academic_year_id: section.academic_year_id,
        section_id: sectionId,
        day_of_week: dto.day_of_week,
        period_no: dto.period_no,
        subject_id: dto.subject_id,
        teacher_user_id: teacherId ?? null,
        room: room ?? null,
      }),
    );
    return this.sectionGrid(schoolId, sectionId);
  }

  async clearSlot(schoolId: number, sectionId: number, day: number, period: number): Promise<SectionTimetableDto> {
    await this.section(schoolId, sectionId);
    await this.slots.delete({ section_id: sectionId, day_of_week: day, period_no: period });
    return this.sectionGrid(schoolId, sectionId);
  }

  async teacherGrid(schoolId: number, userId: number): Promise<TeacherTimetableDto> {
    const [user] = await this.dataSource.query(`SELECT id, name FROM users WHERE id = $1 AND school_id = $2`, [
      userId,
      schoolId,
    ]);
    if (!user) throw AppException.notFound('Teacher not found', 'TEACHER_NOT_FOUND');
    const year = await this.dataSource.getRepository(AcademicYear).findOneBy(yearWhere(schoolId));
    const [periods, slots] = await Promise.all([
      this.periods(schoolId),
      this.dataSource.query(
        `${SLOT_SELECT} WHERE t.teacher_user_id = $1 AND t.academic_year_id = $2 ORDER BY t.day_of_week, t.period_no`,
        [userId, year?.id ?? 0],
      ) as Promise<SlotRow[]>,
    ]);
    return {
      teacher: { id: Number(user.id), name: user.name },
      periods,
      slots: slots.map((row) => this.presentSlot(row)),
      periods_per_week: slots.length,
    };
  }

  async workload(schoolId: number): Promise<WorkloadDto> {
    const year = await this.dataSource.getRepository(AcademicYear).findOneBy(yearWhere(schoolId));
    const periods = await this.periods(schoolId);
    const inWeek = periods.filter((period) => !period.is_break).length * SCHOOL_DAYS.length;
    const rows: {
      user_id: number;
      name: string;
      department: string | null;
      max_periods_per_week: number;
      assigned: string;
      by_day: number[] | null;
    }[] = await this.dataSource.query(
      `SELECT st.user_id, u.name, st.department, st.max_periods_per_week,
              COALESCE((SELECT SUM(ta.periods_per_week) FROM teacher_assignments ta
                WHERE ta.teacher_user_id = st.user_id AND ta.academic_year_id = $2 AND ta.deleted_at IS NULL), 0) AS assigned,
              (SELECT array_agg(t.day_of_week) FROM timetable_slots t
                WHERE t.teacher_user_id = st.user_id AND t.academic_year_id = $2) AS by_day
       FROM staff st JOIN users u ON u.id = st.user_id
       WHERE st.school_id = $1 AND st.deleted_at IS NULL AND st.status <> 'resigned' AND st.staff_type = 'teaching'
       ORDER BY u.name`,
      [schoolId, year?.id ?? 0],
    );
    const [unscheduled] = await this.dataSource.query(
      `SELECT COALESCE(SUM(GREATEST(cs.periods_per_week - (SELECT COUNT(*) FROM timetable_slots t
                WHERE t.section_id = sec.id AND t.subject_id = cs.subject_id), 0)), 0) AS count
       FROM sections sec JOIN class_subjects cs ON cs.class_id = sec.class_id AND cs.academic_year_id = sec.academic_year_id
       WHERE sec.school_id = $1 AND sec.academic_year_id = $2 AND sec.deleted_at IS NULL`,
      [schoolId, year?.id ?? 0],
    );
    const teachers = rows
      .map((row) => {
        const days = (row.by_day ?? []).map(Number);
        const byDay = SCHOOL_DAYS.map((day) => days.filter((value) => value === day).length);
        return {
          teacher: { id: Number(row.user_id), name: row.name },
          department: row.department,
          scheduled: days.length,
          assigned: Number(row.assigned),
          max_periods_per_week: Number(row.max_periods_per_week),
          by_day: byDay,
          free: Math.max(0, inWeek - days.length),
          overloaded: Math.max(days.length, Number(row.assigned)) > Number(row.max_periods_per_week),
        };
      })
      .sort((a, b) => b.scheduled - a.scheduled);
    return {
      periods_in_week: inWeek,
      average_scheduled: teachers.length
        ? Math.round((teachers.reduce((sum, row) => sum + row.scheduled, 0) / teachers.length) * 10) / 10
        : 0,
      overloaded: teachers.filter((row) => row.overloaded).length,
      unscheduled: Number(unscheduled?.count ?? 0),
      teachers,
    };
  }

  async today(schoolId: number, userId: number, day: number): Promise<SlotDto[]> {
    const grid = await this.teacherGrid(schoolId, userId);
    return grid.slots.filter((slot) => slot.day_of_week === day);
  }

  private async saveBell(
    schoolId: number,
    items: { name: string; start_time: string; end_time: string; is_break?: boolean }[],
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(BellPeriod, { school_id: schoolId });
      let number = 0;
      await manager.insert(
        BellPeriod,
        items.map((item, index) => ({
          school_id: schoolId,
          name: item.name,
          start_time: item.start_time,
          end_time: item.end_time,
          is_break: item.is_break ?? false,
          period_no: item.is_break ? null : (number += 1),
          sort_order: index + 1,
        })),
      );
    });
  }

  private async section(schoolId: number, sectionId: number): Promise<Section & { class_name: string }> {
    const section = await this.dataSource.getRepository(Section).findOne({
      where: { id: sectionId, school_id: schoolId },
      relations: { school_class: true },
    });
    if (!section) throw AppException.notFound('Section not found', 'SECTION_NOT_FOUND');
    return Object.assign(section, { class_name: section.school_class?.name ?? '' });
  }

  private presentSlot(row: SlotRow): SlotDto {
    return {
      id: Number(row.id),
      day_of_week: Number(row.day_of_week),
      period_no: Number(row.period_no),
      section: { id: Number(row.section_id), name: `${row.class_name} - ${row.section_name}` },
      subject: { id: Number(row.subject_id), name: row.subject_name, code: row.subject_code },
      teacher: row.teacher_user_id ? { id: Number(row.teacher_user_id), name: row.teacher_name ?? '' } : null,
      room: row.room,
    };
  }
}
