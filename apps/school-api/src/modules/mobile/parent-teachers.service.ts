import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppException } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { weekday } from '../../shared/school-days';
import { teachersOfStudent } from '../../shared/student-contacts';
import { FilesService } from '../files/files.service';
import { DAY_NAMES } from '../timetable/dto/timetable.dto';
import { TimetableService } from '../timetable/timetable.service';
import {
  ChildPeriodDto,
  ChildTeacherDto,
  ChildTeacherProfileDto,
  ChildTeachersOverviewDto,
  ChildTimetableDto,
  PeriodTeacherDto,
} from './dto/parent-teachers.dto';
import { classLabel, experienceYears, periodStates, splitClassTeacher } from './parent-teachers.logic';

interface StaffRow {
  user_id: number;
  designation: string | null;
  department: string | null;
  joining_date: string | null;
  prior_experience_years: number | null;
  photo_file_id: number | null;
}

interface SlotRow {
  period_no: number;
  subject_id: number;
  subject_name: string;
  subject_code: string;
  teacher_user_id: number | null;
  teacher_name: string | null;
  teacher_photo: number | null;
  room: string | null;
}

interface CoverRow {
  period_no: number;
  kind: 'proxy' | 'combine';
  substitute_user_id: number | null;
  substitute_name: string | null;
  substitute_photo: number | null;
  combined_with: string | null;
}

@Injectable()
export class ParentTeachersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly files: FilesService,
    private readonly bells: TimetableService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async teachers(schoolId: number, studentId: number, viewerId: number): Promise<ChildTeacherDto[]> {
    const contacts = await teachersOfStudent(this.dataSource.manager, schoolId, studentId);
    if (!contacts.length) return [];
    const staff = await this.staffRows(contacts.map((contact) => contact.id));
    const photos = await this.files.presentMany([...staff.values()].map((row) => row.photo_file_id));
    const today = todayIn(this.app.timeZone);
    return contacts.map((contact) => {
      const row = staff.get(contact.id);
      return {
        ...contact,
        is_me: contact.id === viewerId,
        designation: row?.designation ?? null,
        department: row?.department ?? null,
        experience_years: experienceYears(row?.joining_date ?? null, Number(row?.prior_experience_years ?? 0), today),
        photo_url: row?.photo_file_id ? (photos.get(row.photo_file_id)?.url ?? null) : null,
      };
    });
  }

  async overview(schoolId: number, studentId: number, viewerId: number): Promise<ChildTeachersOverviewDto> {
    return splitClassTeacher(await this.teachers(schoolId, studentId, viewerId));
  }

  async teacherProfile(
    schoolId: number,
    studentId: number,
    teacherId: number,
    viewerId: number,
  ): Promise<ChildTeacherProfileDto> {
    const teacher = (await this.teachers(schoolId, studentId, viewerId)).find((item) => item.id === teacherId);
    if (!teacher) throw AppException.notFound('This teacher does not teach your child', 'TEACHER_NOT_FOUND');
    const [staff, qualifications, classes, load] = await Promise.all([
      this.staffRows([teacherId]),
      this.dataSource.query(
        `SELECT q.degree, q.specialization, q.institution, q.year_completed
         FROM staff_qualifications q JOIN staff st ON st.id = q.staff_id
         WHERE st.user_id = $1
         ORDER BY q.year_completed DESC NULLS LAST, q.id`,
        [teacherId],
      ) as Promise<
        { degree: string; specialization: string | null; institution: string | null; year_completed: number | null }[]
      >,
      this.dataSource.query(
        `WITH y AS (
           SELECT id FROM academic_years WHERE school_id = $2 AND is_current AND deleted_at IS NULL LIMIT 1
         )
         SELECT sec.id AS section_id, c.name AS class_name, sec.name AS section_name,
                array_remove(array_agg(DISTINCT sub.name), NULL) AS subjects,
                bool_or(sec.class_teacher_user_id = $1) AS is_class_teacher
         FROM sections sec
         JOIN y ON y.id = sec.academic_year_id
         JOIN classes c ON c.id = sec.class_id
         LEFT JOIN teacher_assignments ta
           ON ta.section_id = sec.id AND ta.teacher_user_id = $1 AND ta.deleted_at IS NULL
         LEFT JOIN subjects sub ON sub.id = ta.subject_id
         WHERE sec.school_id = $2 AND sec.deleted_at IS NULL
           AND (sec.class_teacher_user_id = $1 OR ta.id IS NOT NULL)
         GROUP BY sec.id, c.name, sec.name, c.grade_level
         ORDER BY c.grade_level, sec.name`,
        [teacherId, schoolId],
      ) as Promise<
        {
          section_id: number;
          class_name: string;
          section_name: string;
          subjects: string[] | null;
          is_class_teacher: boolean;
        }[]
      >,
      this.dataSource.query(
        `SELECT COUNT(*) AS count FROM timetable_slots t
         JOIN academic_years y ON y.id = t.academic_year_id AND y.is_current AND y.deleted_at IS NULL
         WHERE t.teacher_user_id = $1 AND t.school_id = $2`,
        [teacherId, schoolId],
      ) as Promise<{ count: string }[]>,
    ]);
    const joining = staff.get(teacherId)?.joining_date ?? null;
    return {
      ...teacher,
      joined_year: joining ? Number(joining.slice(0, 4)) : null,
      qualifications: qualifications.map((row) => ({
        degree: row.degree,
        specialization: row.specialization,
        institution: row.institution,
        year_completed: row.year_completed === null ? null : Number(row.year_completed),
      })),
      classes: classes.map((row) => ({
        section_id: Number(row.section_id),
        class_section: classLabel(row.class_name, row.section_name),
        subjects: row.subjects ?? [],
        is_class_teacher: Boolean(row.is_class_teacher),
      })),
      periods_per_week: Number(load[0]?.count ?? 0),
    };
  }

  async timetable(schoolId: number, studentId: number, date?: string): Promise<ChildTimetableDto> {
    const today = todayIn(this.app.timeZone);
    const on = date ?? today;
    const day = weekday(on);
    const [[section], [holidayRow], bell] = await Promise.all([
      this.dataSource.query(
        `SELECT sec.id, c.name AS class_name, sec.name AS section_name
         FROM student_enrollments e
         JOIN academic_years y ON y.id = e.academic_year_id AND y.is_current AND y.deleted_at IS NULL
         JOIN sections sec ON sec.id = e.section_id
         JOIN classes c ON c.id = sec.class_id
         WHERE e.student_id = $1 AND y.school_id = $2
         LIMIT 1`,
        [studentId, schoolId],
      ) as Promise<{ id: number; class_name: string; section_name: string }[]>,
      this.dataSource.query(
        `SELECT name FROM holidays WHERE school_id = $1 AND deleted_at IS NULL AND type <> 'event'
         AND date <= $2 AND COALESCE(end_date, date) >= $2 LIMIT 1`,
        [schoolId, on],
      ) as Promise<{ name: string }[]>,
      this.bells.periods(schoolId),
    ]);
    const holiday = holidayRow?.name ?? null;
    const working = day !== 0 && !holiday;
    const base = {
      date: on,
      day: day === 0 ? 'Sunday' : DAY_NAMES[day],
      class_section: section ? classLabel(section.class_name, section.section_name) : null,
      working_day: working,
      holiday,
    };
    if (!working || !section) return { ...base, periods: [] };
    const [slots, covers] = await Promise.all([
      this.dataSource.query(
        `SELECT t.period_no, t.subject_id, s.name AS subject_name, s.code AS subject_code,
                t.teacher_user_id, u.name AS teacher_name, u.photo_file_id AS teacher_photo, t.room
         FROM timetable_slots t
         JOIN subjects s ON s.id = t.subject_id
         LEFT JOIN users u ON u.id = t.teacher_user_id
         WHERE t.section_id = $1 AND t.day_of_week = $2`,
        [section.id, day],
      ) as Promise<SlotRow[]>,
      this.dataSource.query(
        `SELECT sb.period_no, sb.kind, sb.substitute_user_id, su.name AS substitute_name,
                su.photo_file_id AS substitute_photo,
                string_agg(DISTINCT tc.name || ' - ' || ts.name, ', ') AS combined_with
         FROM substitutions sb
         LEFT JOIN users su ON su.id = sb.substitute_user_id
         LEFT JOIN substitution_merges m ON m.substitution_id = sb.id
         LEFT JOIN sections ts ON ts.id = m.target_section_id
         LEFT JOIN classes tc ON tc.id = ts.class_id
         WHERE sb.section_id = $1 AND sb.date = $2
         GROUP BY sb.id, su.name, su.photo_file_id`,
        [section.id, on],
      ) as Promise<CoverRow[]>,
    ]);
    const photos = await this.files.presentMany([
      ...slots.map((row) => row.teacher_photo),
      ...covers.map((row) => row.substitute_photo),
    ]);
    const person = (id: number | null, name: string | null, photo: number | null): PeriodTeacherDto | null =>
      id ? { id: Number(id), name: name ?? '', photo_url: photo ? (photos.get(photo)?.url ?? null) : null } : null;
    const slotByPeriod = new Map(slots.map((row) => [Number(row.period_no), row]));
    const coverByPeriod = new Map(covers.map((row) => [Number(row.period_no), row]));
    const states = periodStates(bell, on === today, this.nowTime());
    const periods: ChildPeriodDto[] = bell.map((period, index) => {
      const slot = period.period_no ? slotByPeriod.get(period.period_no) : undefined;
      const cover = period.period_no ? coverByPeriod.get(period.period_no) : undefined;
      const usual = slot ? person(slot.teacher_user_id, slot.teacher_name, slot.teacher_photo) : null;
      const proxy =
        cover?.kind === 'proxy'
          ? person(cover.substitute_user_id, cover.substitute_name, cover.substitute_photo)
          : null;
      return {
        period_no: period.period_no,
        name: period.name,
        start_time: period.start_time,
        end_time: period.end_time,
        is_break: period.is_break,
        state: states[index],
        subject: slot ? { id: Number(slot.subject_id), name: slot.subject_name, code: slot.subject_code } : null,
        teacher: proxy ?? usual,
        usual_teacher: proxy ? usual : null,
        note:
          cover?.kind === 'combine'
            ? `Combined with ${cover.combined_with ?? 'another class'}`
            : proxy
              ? `${proxy.name} takes this class today`
              : null,
        room: slot?.room ?? null,
      };
    });
    return { ...base, periods };
  }

  private async staffRows(userIds: number[]): Promise<Map<number, StaffRow>> {
    const rows: StaffRow[] = await this.dataSource.query(
      `SELECT u.id AS user_id, st.designation, st.department,
              to_char(st.joining_date, 'YYYY-MM-DD') AS joining_date, st.prior_experience_years, u.photo_file_id
       FROM users u LEFT JOIN staff st ON st.user_id = u.id
       WHERE u.id = ANY($1)`,
      [userIds],
    );
    return new Map(rows.map((row) => [Number(row.user_id), row]));
  }

  private nowTime(): string {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: this.app.timeZone,
    }).format(new Date());
  }
}
