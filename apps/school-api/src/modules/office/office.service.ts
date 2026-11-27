import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { AppException, AuthUser, paginate, Paginated } from '@app/common';
import { yearClause } from '../../shared/year-context';
import { IdentityColumns, identityOf } from '../../shared/identity';
import { inWings, wingClassIds } from '../../shared/wing-context';
import { PERMISSIONS } from '../access/access.catalog';
import { ExamsService } from '../exams/exams.service';
import { FilesService } from '../files/files.service';
import {
  AttendanceTodayDto,
  AoWingsInputDto,
  ClassCardDto,
  ClassExamDto,
  ClassSectionsDto,
  FlagDto,
  IdNameDto,
  OfficeMeDto,
  OfficeWingsDto,
  SectionCardDto,
  SectionStudentDto,
  SectionStudentsDto,
  SectionStudentsQueryDto,
  Student360Dto,
  StudentDocumentDto,
  TimelineItemDto,
  TimelineQueryDto,
  UpdateWingDto,
  WingCardDto,
  WingClassesDto,
  WingInputDto,
  WingSetupPageDto,
} from './dto/office.dto';
import { OfficeActivityLog, SchoolWing, UserWing } from './entities/office.entity';
import {
  ClassShape,
  classesOfWing,
  EMPTY_NOTES,
  hasNote,
  isWingLimitedRole,
  overlapError,
  percent,
  rangeLabel,
  spanActive,
  wingOfClass,
} from './office.logic';
import { WingRow, WingScopeService } from './wing-scope.service';
import { OfficeBusService } from './office-bus.service';

const PRESENT = `('present', 'late', 'od', 'half_day')`;
const ABSENT = `('absent', 'leave')`;
const LOW_ATTENDANCE = 75;
const EMPTY_SQL = EMPTY_NOTES.map((note) => `'${note}'`).join(', ');
const RUPEES = `'₹' || to_char(%s, 'FM99,99,99,990')`;
const money = (column: string) => RUPEES.replace('%s', column);

interface SectionStatRow {
  section_id: number;
  class_id: number;
  name: string;
  class_name: string;
  class_teacher_user_id: number | null;
  class_teacher_name: string | null;
  students: number;
  boys: number;
  girls: number;
  present: number;
  absent: number;
  marked: number;
  fee_due: number;
  defaulters: number;
  pending_passes: number;
}

interface ExamRow {
  student_id: number;
  section_id: number;
  class_id: number;
  exam_id: number;
  exam_name: string;
  pct: number | null;
  rnk: number;
  name: string;
}

const num = (value: unknown) => Number(value ?? 0);

@Injectable()
export class OfficeService {
  constructor(
    @InjectRepository(SchoolWing) private readonly wingRepo: Repository<SchoolWing>,
    @InjectRepository(UserWing) private readonly userWingRepo: Repository<UserWing>,
    @InjectRepository(OfficeActivityLog) private readonly logs: Repository<OfficeActivityLog>,
    private readonly scope: WingScopeService,
    private readonly busService: OfficeBusService,
    private readonly exams: ExamsService,
    private readonly files: FilesService,
    private readonly dataSource: DataSource,
  ) {}

  async me(user: AuthUser, schoolId: number): Promise<OfficeMeDto> {
    const limited = isWingLimitedRole(user.roles) ? await this.scope.activeWingIds(schoolId, user.id) : [];
    const wings = await this.scope.wings(schoolId);
    const isHead = isWingLimitedRole(user.roles) && !limited.length;
    return {
      is_limited: limited.length > 0,
      is_head_ao: isHead,
      can_monitor: !limited.length && user.permissions.includes(PERMISSIONS.OFFICE_MONITOR),
      wings: wings
        .filter((wing) => !limited.length || limited.includes(wing.id))
        .map((wing) => ({ id: wing.id, name: wing.name })),
      today: this.scope.today(),
    };
  }

  async wingCards(user: AuthUser, schoolId: number): Promise<OfficeWingsDto> {
    const [wings, classes, stats] = await Promise.all([
      this.visibleWings(user, schoolId),
      this.scope.classes(schoolId),
      this.sectionStats(schoolId, this.scopeClassIds()),
    ]);
    const aoLinks = await this.wingAos(schoolId);
    const cards: WingCardDto[] = wings.map((wing) => {
      const wingClasses = classesOfWing(wing, classes);
      const ids = new Set(wingClasses.map((row) => row.id));
      const rows = stats.filter((row) => ids.has(row.class_id));
      return {
        id: wing.id,
        name: wing.name,
        range_label: rangeLabel(
          wing,
          wingClasses.map((row) => row.name),
        ),
        board: (wing.board as WingCardDto['board']) ?? null,
        aos: aoLinks.get(wing.id) ?? [],
        class_count: wingClasses.length,
        ...this.rollUp(rows),
      };
    });
    const unlimited = wingClassIds() === null;
    const unassigned = unlimited
      ? classes.filter((row) => !wingOfClass(row, wings)).map((row) => ({ id: row.id, name: row.name }))
      : [];
    return { wings: cards, unassigned_classes: unassigned };
  }

  async wingClasses(user: AuthUser, schoolId: number, wingId: number): Promise<WingClassesDto> {
    const wing = (await this.visibleWings(user, schoolId)).find((row) => row.id === wingId);
    if (!wing) throw AppException.notFound('Wing not found', 'WING_NOT_FOUND');
    const classes = classesOfWing(wing, await this.scope.classes(schoolId)).filter((row) => inWings(row.id));
    const ids = classes.map((row) => row.id);
    const [stats, exams] = await Promise.all([this.sectionStats(schoolId, ids), this.examRows(schoolId, ids)]);
    return {
      wing: { id: wing.id, name: wing.name },
      classes: classes.map((schoolClass): ClassCardDto => {
        const rows = stats.filter((row) => row.class_id === schoolClass.id);
        const marks = exams.filter((row) => row.class_id === schoolClass.id && row.pct !== null);
        const rolled = this.rollUp(rows);
        return {
          id: schoolClass.id,
          name: schoolClass.name,
          grade_level: schoolClass.grade_level,
          section_count: rows.length,
          student_count: rolled.student_count,
          boys: rolled.boys,
          girls: rolled.girls,
          class_teachers: [
            ...new Set(rows.map((row) => row.class_teacher_name).filter((name): name is string => !!name)),
          ],
          attendance: rolled.attendance,
          fee_due: rolled.fee_due,
          pending_gate_passes: rolled.pending_gate_passes,
          last_exam_average: this.average(marks),
        };
      }),
    };
  }

  async classSections(schoolId: number, classId: number): Promise<ClassSectionsDto> {
    const classes = await this.scope.classes(schoolId);
    const schoolClass = classes.find((row) => row.id === classId);
    if (!schoolClass || !inWings(classId)) throw AppException.notFound('Class not found', 'CLASS_NOT_FOUND');
    const wing = wingOfClass(schoolClass, await this.scope.wings(schoolId));
    const [stats, exams] = await Promise.all([
      this.sectionStats(schoolId, [classId]),
      this.examRows(schoolId, [classId]),
    ]);
    return {
      class: { id: schoolClass.id, name: schoolClass.name },
      wing: wing ? { id: wing.id, name: wing.name } : null,
      sections: stats.map((row) => this.sectionCard(row, exams)),
    };
  }

  async sectionStudents(
    schoolId: number,
    sectionId: number,
    query: SectionStudentsQueryDto,
  ): Promise<SectionStudentsDto> {
    const [section] = await this.sectionStatsById(schoolId, sectionId);
    if (!section || !inWings(section.class_id)) throw AppException.notFound('Section not found', 'SECTION_NOT_FOUND');
    const exams = await this.examRows(schoolId, [section.class_id]);
    const today = this.scope.today();
    const rows: {
      id: number;
      name: string;
      admission_no: string;
      roll_no: number | null;
      gender: string | null;
      photo_file_id: number | null;
      today: string | null;
      days: number;
      present_days: number;
      fee_due: number;
      invoices: number;
      route: string | null;
      stop: string | null;
      pass_status: string | null;
      health_alert: boolean;
    }[] = await this.dataSource.query(
      `WITH yr AS (SELECT ay.id FROM academic_years ay WHERE ay.school_id = $1 AND ay.deleted_at IS NULL AND ${yearClause('ay')})
       SELECT s.id, trim(s.first_name || ' ' || COALESCE(s.last_name, '')) AS name, s.admission_no, e.roll_no, s.gender,
              s.photo_file_id,
              (SELECT d.status FROM student_attendance_days d WHERE d.student_id = s.id AND d.date = $3) AS today,
              (SELECT count(*) FROM student_attendance_days d WHERE d.student_id = s.id
                 AND d.date >= (SELECT start_date FROM academic_years WHERE id = (SELECT id FROM yr))) AS days,
              (SELECT count(*) FROM student_attendance_days d WHERE d.student_id = s.id AND d.status IN ${PRESENT}
                 AND d.date >= (SELECT start_date FROM academic_years WHERE id = (SELECT id FROM yr))) AS present_days,
              (SELECT COALESCE(sum(i.balance), 0) FROM fee_invoices i WHERE i.student_id = s.id AND i.deleted_at IS NULL
                 AND i.status <> 'cancelled' AND i.academic_year_id IN (SELECT id FROM yr)) AS fee_due,
              (SELECT count(*) FROM fee_invoices i WHERE i.student_id = s.id AND i.deleted_at IS NULL
                 AND i.status <> 'cancelled' AND i.academic_year_id IN (SELECT id FROM yr)) AS invoices,
              tr.route, tr.stop, tr.pass_status,
              EXISTS (SELECT 1 FROM student_health h WHERE h.student_id = s.id
                 AND (lower(trim(COALESCE(h.allergies, ''))) NOT IN (${EMPTY_SQL})
                   OR lower(trim(COALESCE(h.conditions, ''))) NOT IN (${EMPTY_SQL}))) AS health_alert
       FROM student_enrollments e
       JOIN yr ON yr.id = e.academic_year_id
       JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT trim(COALESCE(r.code, '') || ' · ' || r.name) AS route, rs.name AS stop, st.pass_status
         FROM student_transport st JOIN transport_routes r ON r.id = st.route_id
         LEFT JOIN route_stops rs ON rs.id = st.stop_id
         WHERE st.student_id = s.id AND st.deleted_at IS NULL ORDER BY st.id DESC LIMIT 1
       ) tr ON true
       WHERE e.section_id = $2 AND e.status = 'studying' AND s.school_id = $1`,
      [schoolId, sectionId, today],
    );
    const photos = await this.files.presentMany(
      rows.map((row) => (row.photo_file_id ? Number(row.photo_file_id) : null)),
    );
    const search = query.search?.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
    let items: SectionStudentDto[] = rows.map((row) => {
      const id = Number(row.id);
      const exam = exams.find((item) => item.student_id === id);
      const attendancePercent = percent(num(row.present_days), num(row.days));
      const feeDue = num(row.fee_due);
      const flags: string[] = [];
      if (feeDue > 0) flags.push('fee_due');
      if (attendancePercent !== null && attendancePercent < LOW_ATTENDANCE) flags.push('low_attendance');
      if (row.health_alert) flags.push('health_alert');
      if (row.pass_status === 'on_hold') flags.push('pass_on_hold');
      const photo = row.photo_file_id ? photos.get(Number(row.photo_file_id)) : null;
      return {
        id,
        name: row.name,
        admission_no: row.admission_no,
        roll_no: row.roll_no === null ? null : Number(row.roll_no),
        gender: row.gender,
        photo_url: photo?.thumbnail_url ?? photo?.url ?? null,
        today: row.today,
        attendance_percent: attendancePercent,
        fee_due: feeDue,
        fee_status: !num(row.invoices) ? 'none' : feeDue > 0 ? 'due' : 'paid',
        last_exam_percent: exam?.pct === null || exam?.pct === undefined ? null : Number(exam.pct),
        rank: exam && exam.pct !== null ? Number(exam.rnk) : null,
        transport: row.route ? { route: row.route, stop: row.stop, pass_status: row.pass_status } : null,
        flags,
      };
    });
    if (search.length) {
      items = items.filter((item) =>
        search.every((word) => `${item.name} ${item.admission_no} ${item.roll_no ?? ''}`.toLowerCase().includes(word)),
      );
    }
    if (query.filter === 'absent_today') items = items.filter((item) => ['absent', 'leave'].includes(item.today ?? ''));
    if (query.filter === 'fee_due') items = items.filter((item) => item.fee_due > 0);
    if (query.filter === 'low_attendance') items = items.filter((item) => item.flags.includes('low_attendance'));
    const sorters: Record<string, (item: SectionStudentDto) => number | string> = {
      name: (item) => item.name.toLowerCase(),
      roll_no: (item) => item.roll_no ?? 9999,
      attendance: (item) => item.attendance_percent ?? -1,
      fee_due: (item) => item.fee_due,
      last_exam: (item) => item.last_exam_percent ?? -1,
    };
    const sortKey = query.sort ?? 'roll_no';
    const sorter = sorters[sortKey];
    if (!sorter)
      throw AppException.badRequest(`sort must be one of ${Object.keys(sorters).join(', ')}`, 'INVALID_SORT');
    const direction = query.sort ? (query.order === 'asc' ? 1 : -1) : 1;
    items.sort((a, b) => (sorter(a) > sorter(b) ? direction : sorter(a) < sorter(b) ? -direction : 0));
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const paged = paginate([items.slice((page - 1) * limit, page * limit), items.length], page, limit);
    return { section: this.sectionCard(section, exams), ...paged };
  }

  async student(user: AuthUser, schoolId: number, studentId: number, pdfBase: string | null): Promise<Student360Dto> {
    const [row]: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT s.*, to_char(s.dob, 'YYYY-MM-DD') AS dob_text, to_char(s.admission_date, 'YYYY-MM-DD') AS admitted_text
       FROM students s WHERE s.id = $1 AND s.school_id = $2 AND s.deleted_at IS NULL`,
      [studentId, schoolId],
    );
    if (!row) throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');
    const [current]: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT ay.id AS year_id, ay.name AS academic_year, to_char(ay.start_date, 'YYYY-MM-DD') AS year_start,
              e.class_id, e.section_id, c.name AS class_name, sec.name AS section_name, e.roll_no,
              sec.class_teacher_user_id, u.name AS class_teacher_name
       FROM student_enrollments e
       JOIN academic_years ay ON ay.id = e.academic_year_id AND ay.deleted_at IS NULL AND ${yearClause('ay')}
       JOIN classes c ON c.id = e.class_id
       LEFT JOIN sections sec ON sec.id = e.section_id
       LEFT JOIN users u ON u.id = sec.class_teacher_user_id
       WHERE e.student_id = $1 AND ay.school_id = $2
       ORDER BY e.id DESC LIMIT 1`,
      [studentId, schoolId],
    );
    if (current && !inWings(Number(current.class_id))) {
      throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');
    }
    const yearId = current ? Number(current.year_id) : null;
    const [
      guardians,
      transport,
      attendance,
      fees,
      years,
      counts,
      health,
      results,
      wings,
      classes,
      achievements,
      sportsOd,
    ] = await Promise.all([
      this.dataSource.query(
        `SELECT g.id, g.name, sg.relation, g.mobile, sg.is_primary, sg.can_pickup FROM student_guardians sg
         JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
         WHERE sg.student_id = $1 ORDER BY sg.is_primary DESC, g.name`,
        [studentId],
      ) as Promise<Record<string, unknown>[]>,
      this.dataSource.query(
        `SELECT trim(COALESCE(r.code, '') || ' · ' || r.name) AS route, rs.name AS stop, st.pass_status
         FROM student_transport st JOIN transport_routes r ON r.id = st.route_id
         LEFT JOIN route_stops rs ON rs.id = st.stop_id
         WHERE st.student_id = $1 AND st.deleted_at IS NULL ORDER BY st.id DESC LIMIT 1`,
        [studentId],
      ) as Promise<Record<string, unknown>[]>,
      this.dataSource.query(
        `SELECT count(*) AS days,
                count(*) FILTER (WHERE status = 'present') AS present,
                count(*) FILTER (WHERE status = 'absent') AS absent,
                count(*) FILTER (WHERE status = 'late') AS late,
                count(*) FILTER (WHERE status = 'leave') AS leave,
                count(*) FILTER (WHERE status = 'half_day') AS half_day,
                count(*) FILTER (WHERE status IN ${PRESENT}) AS attended
         FROM student_attendance_days WHERE student_id = $1 AND date >= COALESCE($2::date, '1900-01-01')`,
        [studentId, current?.year_start ?? null],
      ) as Promise<Record<string, unknown>[]>,
      this.dataSource.query(
        `SELECT COALESCE(sum(total), 0) AS total, COALESCE(sum(paid), 0) AS paid, COALESCE(sum(balance), 0) AS balance,
                COALESCE(sum(balance) FILTER (WHERE due_date < CURRENT_DATE), 0) AS overdue, count(*) AS invoices
         FROM fee_invoices WHERE student_id = $1 AND deleted_at IS NULL AND status <> 'cancelled'
           AND ($2::int IS NULL OR academic_year_id = $2)`,
        [studentId, yearId],
      ) as Promise<Record<string, unknown>[]>,
      this.dataSource.query(
        `SELECT ay.name AS academic_year, c.name || COALESCE(' - ' || sec.name, '') AS class_section, e.roll_no, e.status
         FROM student_enrollments e JOIN academic_years ay ON ay.id = e.academic_year_id
         JOIN classes c ON c.id = e.class_id LEFT JOIN sections sec ON sec.id = e.section_id
         WHERE e.student_id = $1 ORDER BY ay.start_date DESC, e.id DESC`,
        [studentId],
      ) as Promise<Record<string, unknown>[]>,
      this.dataSource.query(
        `SELECT
           (SELECT count(*) FROM student_behaviour_notes WHERE student_id = $1 AND deleted_at IS NULL) AS behaviour_notes,
           (SELECT count(*) FROM student_achievements WHERE student_id = $1 AND deleted_at IS NULL) AS achievements,
           (SELECT count(*) FROM gate_passes WHERE student_id = $1 AND deleted_at IS NULL) AS gate_passes,
           (SELECT count(*) FROM student_documents WHERE student_id = $1 AND deleted_at IS NULL) AS documents,
           (SELECT count(*) FROM library_issues li JOIN library_members lm ON lm.id = li.member_id
              WHERE lm.student_id = $1 AND li.returned_at IS NULL AND li.deleted_at IS NULL) AS library_books_out,
           (SELECT count(*) FROM student_leave_requests WHERE student_id = $1 AND deleted_at IS NULL) AS leave_requests`,
        [studentId],
      ) as Promise<Record<string, unknown>[]>,
      this.dataSource.query(
        `SELECT allergies, conditions, medications, to_char(last_checkup_on, 'YYYY-MM-DD') AS last_checkup_on
         FROM student_health WHERE student_id = $1 LIMIT 1`,
        [studentId],
      ) as Promise<Record<string, unknown>[]>,
      this.exams.studentResults(schoolId, studentId).catch(() => []),
      this.scope.wings(schoolId),
      this.scope.classes(schoolId),
      this.dataSource.query(
        `SELECT id, title, category, level, position, to_char(achieved_on, 'YYYY-MM-DD') AS achieved_on
         FROM student_achievements WHERE student_id = $1 AND deleted_at IS NULL ORDER BY achieved_on DESC NULLS LAST, id DESC`,
        [studentId],
      ) as Promise<Record<string, unknown>[]>,
      this.sportsOd(schoolId, [studentId], null),
    ]);
    const photo = row.photo_file_id
      ? (await this.files.presentMany([Number(row.photo_file_id)])).get(Number(row.photo_file_id))
      : null;
    const att = attendance[0] ?? {};
    const fee = fees[0] ?? {};
    const healthRow = health[0] as unknown as Student360Dto['health'] | undefined;
    const transportRow = transport[0];
    const attendancePercent = percent(num(att.attended), num(att.days));
    const flags: FlagDto[] = [];
    if (num(fee.balance) > 0)
      flags.push({ code: 'fee_due', label: `Fee due ₹${num(fee.balance).toLocaleString('en-IN')}` });
    if (attendancePercent !== null && attendancePercent < LOW_ATTENDANCE)
      flags.push({ code: 'low_attendance', label: `Attendance ${attendancePercent}%` });
    const healthNotes = [healthRow?.allergies, healthRow?.conditions].filter(hasNote);
    if (healthNotes.length) flags.push({ code: 'health_alert', label: healthNotes.join(' · ') });
    if (transportRow?.pass_status === 'on_hold') flags.push({ code: 'pass_on_hold', label: 'Bus pass on hold' });
    const schoolClass = current ? classes.find((item: ClassShape) => item.id === Number(current.class_id)) : undefined;
    const wing = schoolClass ? wingOfClass(schoolClass, wings) : null;
    await this.logView(user, schoolId, studentId);
    return {
      student: {
        id: Number(row.id),
        name: `${row.first_name as string} ${(row.last_name as string | null) ?? ''}`.trim(),
        admission_no: row.admission_no as string,
        photo_url: photo?.thumbnail_url ?? photo?.url ?? null,
        dob: (row.dob_text as string | null) ?? null,
        gender: (row.gender as string | null) ?? null,
        blood_group: (row.blood_group as string | null) ?? null,
        admission_date: (row.admitted_text as string | null) ?? null,
        status: row.status as string,
        house: (row.house as string | null) ?? null,
        address:
          [row.address_line, row.city, row.pincode].filter((part) => part !== null && part !== '').join(', ') || null,
        ...identityOf(row as Partial<IdentityColumns>),
      },
      current: current
        ? {
            academic_year: current.academic_year as string,
            class_id: Number(current.class_id),
            section_id: Number(current.section_id),
            class_section: `${current.class_name as string}${current.section_name ? ` - ${current.section_name as string}` : ''}`,
            roll_no: current.roll_no === null ? null : Number(current.roll_no),
            class_teacher: current.class_teacher_user_id
              ? { id: Number(current.class_teacher_user_id), name: current.class_teacher_name as string }
              : null,
            wing: wing ? { id: wing.id, name: wing.name } : null,
          }
        : null,
      guardians: guardians.map((item) => ({
        id: Number(item.id),
        name: item.name as string,
        relation: (item.relation as string | null) ?? null,
        mobile: (item.mobile as string | null) ?? null,
        is_primary: Boolean(item.is_primary),
        can_pickup: Boolean(item.can_pickup),
      })),
      transport: transportRow
        ? {
            route: transportRow.route as string,
            stop: (transportRow.stop as string | null) ?? null,
            pass_status: (transportRow.pass_status as string | null) ?? null,
          }
        : null,
      flags,
      attendance: {
        days: num(att.days),
        present: num(att.present),
        absent: num(att.absent),
        late: num(att.late),
        leave: num(att.leave),
        half_day: num(att.half_day),
        percent: attendancePercent,
      },
      fees: {
        total: num(fee.total),
        paid: num(fee.paid),
        balance: num(fee.balance),
        overdue: num(fee.overdue),
        invoices: num(fee.invoices),
      },
      exams: results.map((result) => ({
        exam_id: result.exam.id,
        exam_name: result.exam.name,
        total: Number(result.total ?? 0),
        max_total: Number(result.max_total ?? 0),
        percent: result.percent ?? null,
        grade: result.grade ?? null,
        result: (result.result as string | null) ?? null,
        section_rank: result.section_rank ?? null,
        section_size: result.section_size,
        class_rank: result.class_rank ?? null,
        class_size: result.class_size,
      })),
      years: years.map((item) => ({
        academic_year: item.academic_year as string,
        class_section: item.class_section as string,
        roll_no: item.roll_no === null ? null : Number(item.roll_no),
        status: item.status as string,
      })),
      counts: {
        behaviour_notes: num(counts[0]?.behaviour_notes),
        achievements: num(counts[0]?.achievements),
        gate_passes: num(counts[0]?.gate_passes),
        documents: num(counts[0]?.documents),
        library_books_out: num(counts[0]?.library_books_out),
        leave_requests: num(counts[0]?.leave_requests),
      },
      health: healthRow ?? null,
      report_card_pdf_path: results.length && pdfBase ? pdfBase.replace('{id}', String(studentId)) : null,
      achievements: achievements.map((item) => ({
        id: Number(item.id),
        title: item.title as string,
        category: (item.category as string | null) ?? null,
        level: (item.level as string | null) ?? null,
        position: (item.position as string | null) ?? null,
        achieved_on: (item.achieved_on as string | null) ?? null,
      })),
      bus_today: await this.busService.studentToday(studentId),
      sports_od: sportsOd.map((line) => ({
        id: line.id,
        sport_name: line.sport_name,
        title: line.title,
        from_date: line.from_date,
        to_date: line.to_date,
        session: line.session,
        venue: line.venue,
      })),
    };
  }

  async timeline(schoolId: number, studentId: number, query: TimelineQueryDto): Promise<Paginated<TimelineItemDto>> {
    const [exists]: { id: number }[] = await this.dataSource.query(
      `SELECT id FROM students WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [studentId, schoolId],
    );
    if (!exists) throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');
    const page = query.page ?? 1;
    const limit = query.limit ?? 30;
    const union = `
      SELECT s.admission_date::timestamptz AS at, 'admission' AS type, 'Admitted to the school' AS title,
             'Admission no ' || s.admission_no AS detail, s.id AS ref_id
        FROM students s WHERE s.id = $1 AND s.admission_date IS NOT NULL
      UNION ALL
      SELECT COALESCE(ay.start_date::timestamptz, e.created_at), 'enrolment', 'Class ' || c.name || COALESCE(' - ' || sec.name, ''),
             ay.name || ' · ' || e.status || COALESCE(' · roll ' || e.roll_no, ''), e.id
        FROM student_enrollments e JOIN academic_years ay ON ay.id = e.academic_year_id
        JOIN classes c ON c.id = e.class_id LEFT JOIN sections sec ON sec.id = e.section_id WHERE e.student_id = $1
      UNION ALL
      SELECT d.date::timestamptz, 'attendance',
             CASE d.status WHEN 'absent' THEN 'Absent' WHEN 'leave' THEN 'On leave' WHEN 'half_day' THEN 'Half day'
                           WHEN 'late' THEN 'Came late' ELSE initcap(d.status) END,
             NULLIF(concat_ws(' · ', 'Morning ' || d.morning, 'Afternoon ' || d.afternoon), ''), NULL
        FROM student_attendance_days d WHERE d.student_id = $1 AND d.status IN ('absent', 'leave', 'half_day', 'late')
      UNION ALL
      SELECT l.created_at, 'leave', 'Leave asked: ' || to_char(l.from_date, 'DD Mon') ||
             CASE WHEN l.to_date <> l.from_date THEN ' to ' || to_char(l.to_date, 'DD Mon') ELSE '' END,
             initcap(l.status) || ' · ' || l.reason, l.id
        FROM student_leave_requests l WHERE l.student_id = $1 AND l.deleted_at IS NULL
      UNION ALL
      SELECT i.created_at, 'fee_invoice', 'Fee invoice ' || ${money('i.total')},
             i.invoice_no || ' · due ' || to_char(i.due_date, 'DD Mon YYYY') || ' · ' || replace(i.status, '_', ' '), i.id
        FROM fee_invoices i WHERE i.student_id = $1 AND i.deleted_at IS NULL
      UNION ALL
      SELECT COALESCE(p.paid_on::timestamptz, p.created_at), 'fee_payment', 'Fee paid ' || ${money('p.amount')},
             concat_ws(' · ', p.receipt_no, p.mode, CASE WHEN p.reversed_at IS NOT NULL THEN 'reversed' END), p.id
        FROM fee_payments p WHERE p.student_id = $1 AND p.deleted_at IS NULL
      UNION ALL
      SELECT COALESCE(x.published_at, x.end_date::timestamptz), 'exam', 'Results: ' || x.name, 'Published', x.id
        FROM exams x WHERE x.school_id = $2 AND x.status = 'published' AND x.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM exam_marks m WHERE m.exam_id = x.id AND m.student_id = $1)
      UNION ALL
      SELECT g.created_at, 'gate', 'Gate pass ' || g.pass_no || ' · ' || g.status,
             g.pickup_name || ' · ' || g.reason, g.id
        FROM gate_passes g WHERE g.student_id = $1 AND g.deleted_at IS NULL
      UNION ALL
      SELECT b.noted_on::timestamptz, 'behaviour', b.title, concat_ws(' · ', b.category, b.action_taken), b.id
        FROM student_behaviour_notes b WHERE b.student_id = $1 AND b.deleted_at IS NULL
      UNION ALL
      SELECT a.achieved_on::timestamptz, 'achievement', a.title, concat_ws(' · ', a.category, a.level, a.position), a.id
        FROM student_achievements a WHERE a.student_id = $1 AND a.deleted_at IS NULL
      UNION ALL
      SELECT t.created_at, 'transport', 'Bus: ' || replace(t.action, '_', ' '), r.name, t.id
        FROM student_transport_changes t LEFT JOIN transport_routes r ON r.id = t.to_route_id
        WHERE t.student_id = $1 AND t.deleted_at IS NULL
      UNION ALL
      SELECT doc.created_at, 'document', 'Document: ' || doc.title, doc.type || ' · ' || doc.status, doc.id
        FROM student_documents doc WHERE doc.student_id = $1 AND doc.deleted_at IS NULL
      UNION ALL
      SELECT li.issued_at, 'library', 'Book borrowed: ' || bk.title,
             CASE WHEN li.returned_at IS NULL THEN 'Due ' || to_char(li.due_date, 'DD Mon') ELSE 'Returned' END, li.id
        FROM library_issues li JOIN library_members lm ON lm.id = li.member_id JOIN books bk ON bk.id = li.book_id
        WHERE lm.student_id = $1 AND li.deleted_at IS NULL`;
    const where = query.type ? `WHERE t.at IS NOT NULL AND t.type = $3` : `WHERE t.at IS NOT NULL`;
    const params: unknown[] = [studentId, schoolId];
    if (query.type) params.push(query.type);
    const [{ total }]: { total: string }[] = await this.dataSource.query(
      `SELECT count(*) AS total FROM (${union}) t ${where}`,
      params,
    );
    const rows: {
      at: Date;
      type: TimelineItemDto['type'];
      title: string;
      detail: string | null;
      ref_id: number | null;
    }[] = await this.dataSource.query(
      `SELECT * FROM (${union}) t ${where} ORDER BY t.at DESC, t.type LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      params,
    );
    return paginate(
      [rows.map((row) => ({ ...row, ref_id: row.ref_id === null ? null : Number(row.ref_id) })), Number(total)],
      page,
      limit,
    );
  }

  async setupPage(schoolId: number): Promise<WingSetupPageDto> {
    const [wings, classes, aos] = await Promise.all([
      this.scope.wings(schoolId),
      this.scope.classes(schoolId),
      this.scope.aoUsers(schoolId),
    ]);
    const links: {
      user_id: number;
      wing_id: number;
      valid_from: string | null;
      valid_to: string | null;
      note: string | null;
    }[] = await this.dataSource.query(
      `SELECT uw.user_id, uw.wing_id, to_char(uw.valid_from, 'YYYY-MM-DD') AS valid_from,
                to_char(uw.valid_to, 'YYYY-MM-DD') AS valid_to, uw.note
         FROM user_wings uw JOIN school_wings w ON w.id = uw.wing_id AND w.deleted_at IS NULL
         WHERE uw.school_id = $1 AND uw.deleted_at IS NULL ORDER BY uw.valid_from NULLS FIRST, uw.id`,
      [schoolId],
    );
    const today = this.scope.today();
    const names = new Map(aos.map((ao) => [ao.id, ao.name]));
    return {
      wings: wings.map((wing) => {
        const wingClasses = classesOfWing(wing, classes);
        return {
          id: wing.id,
          name: wing.name,
          from_grade: wing.from_grade,
          to_grade: wing.to_grade,
          class_ids: wing.class_ids,
          board: (wing.board as WingCardDto['board']) ?? null,
          sort_order: wing.sort_order,
          range_label: rangeLabel(
            wing,
            wingClasses.map((row) => row.name),
          ),
          classes: wingClasses.map((row) => ({ id: row.id, name: row.name })),
          aos: links
            .filter((link) => Number(link.wing_id) === wing.id && names.has(Number(link.user_id)))
            .map((link) => ({
              id: Number(link.user_id),
              name: names.get(Number(link.user_id))!,
              valid_from: link.valid_from,
              valid_to: link.valid_to,
            })),
        };
      }),
      classes: classes.map((row) => ({ ...row, wing_id: wingOfClass(row, wings)?.id ?? null })),
      aos: aos.map((ao) => {
        const mine = links.filter((link) => Number(link.user_id) === ao.id);
        return {
          id: ao.id,
          name: ao.name,
          mobile: ao.mobile,
          wings: mine.map((link) => ({
            wing_id: Number(link.wing_id),
            name: wings.find((wing) => wing.id === Number(link.wing_id))?.name ?? '',
            valid_from: link.valid_from,
            valid_to: link.valid_to,
            active: spanActive(link, today),
            note: link.note,
          })),
          is_head: !mine.some((link) => spanActive(link, today)),
        };
      }),
    };
  }

  async createWing(schoolId: number, dto: WingInputDto): Promise<WingSetupPageDto> {
    await this.assertWing(schoolId, null, dto);
    await this.wingRepo.save(
      this.wingRepo.create({
        school_id: schoolId,
        name: dto.name.trim(),
        from_grade: dto.from_grade,
        to_grade: dto.to_grade,
        class_ids: dto.class_ids?.length ? dto.class_ids : null,
        board: dto.board ?? null,
        sort_order: dto.sort_order ?? 0,
      }),
    );
    return this.setupPage(schoolId);
  }

  async updateWing(schoolId: number, id: number, dto: UpdateWingDto): Promise<WingSetupPageDto> {
    const wing = await this.wingRepo.findOneBy({ id, school_id: schoolId, deleted_at: IsNull() });
    if (!wing) throw AppException.notFound('Wing not found', 'WING_NOT_FOUND');
    const next = {
      name: dto.name?.trim() ?? wing.name,
      from_grade: dto.from_grade ?? wing.from_grade,
      to_grade: dto.to_grade ?? wing.to_grade,
      class_ids: dto.class_ids !== undefined ? (dto.class_ids?.length ? dto.class_ids : null) : wing.class_ids,
      board: dto.board !== undefined ? (dto.board ?? null) : wing.board,
      sort_order: dto.sort_order ?? wing.sort_order,
    };
    await this.assertWing(schoolId, id, next);
    await this.wingRepo.update(id, next);
    return this.setupPage(schoolId);
  }

  async removeWing(schoolId: number, id: number): Promise<WingSetupPageDto> {
    const wing = await this.wingRepo.findOneBy({ id, school_id: schoolId, deleted_at: IsNull() });
    if (!wing) throw AppException.notFound('Wing not found', 'WING_NOT_FOUND');
    await this.dataSource.transaction(async (manager) => {
      await manager.softDelete(UserWing, { wing_id: id, school_id: schoolId });
      await manager.softDelete(SchoolWing, { id });
    });
    return this.setupPage(schoolId);
  }

  async setAoWings(actor: AuthUser, schoolId: number, userId: number, dto: AoWingsInputDto): Promise<WingSetupPageDto> {
    const aos = await this.scope.aoUsers(schoolId);
    if (!aos.some((ao) => ao.id === userId)) throw AppException.notFound('AO not found', 'AO_NOT_FOUND');
    const wingIds = dto.wings.map((item) => item.wing_id);
    const found = wingIds.length
      ? await this.wingRepo.findBy({ id: In(wingIds), school_id: schoolId, deleted_at: IsNull() })
      : [];
    const errors = dto.wings.flatMap((item, index) => {
      const list = [];
      if (!found.some((wing) => wing.id === item.wing_id))
        list.push({ field: `wings[${index}].wing_id`, message: 'Wing not found' });
      if (item.valid_from && item.valid_to && item.valid_to < item.valid_from)
        list.push({ field: `wings[${index}].valid_to`, message: 'valid_to must be on or after valid_from' });
      return list;
    });
    if (errors.length) throw AppException.validation(errors);
    await this.dataSource.transaction(async (manager) => {
      await manager.softDelete(UserWing, { user_id: userId, school_id: schoolId });
      for (const item of dto.wings) {
        await manager.save(
          manager.create(UserWing, {
            school_id: schoolId,
            user_id: userId,
            wing_id: item.wing_id,
            valid_from: item.valid_from ?? null,
            valid_to: item.valid_to ?? null,
            note: item.note ?? null,
          }),
        );
      }
    });
    await this.logs.save(
      this.logs.create({
        school_id: schoolId,
        user_id: actor.id,
        action: 'wings_changed',
        target_user_id: userId,
        note: found.map((wing) => wing.name).join(', ') || 'Head AO (whole school)',
      }),
    );
    return this.setupPage(schoolId);
  }

  async classExams(schoolId: number, classIds: number[] | null): Promise<ClassExamDto[]> {
    const classes = (await this.scope.classes(schoolId)).filter((row) => !classIds || classIds.includes(row.id));
    const rows = await this.examRows(
      schoolId,
      classes.map((row) => row.id),
    );
    return classes.flatMap((schoolClass) => {
      const marks = rows.filter((row) => row.class_id === schoolClass.id && row.pct !== null);
      const first = marks[0];
      if (!first) return [];
      const ranked = [...marks].sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
      return [
        {
          class_id: schoolClass.id,
          class_name: schoolClass.name,
          exam: { id: first.exam_id, name: first.exam_name },
          average: this.average(marks) ?? 0,
          toppers: ranked.slice(0, 3).map((row, index) => ({
            student_id: row.student_id,
            name: row.name,
            percent: row.pct!,
            rank: index + 1,
          })),
        },
      ];
    });
  }

  async documents(user: AuthUser, schoolId: number, studentId: number): Promise<StudentDocumentDto[]> {
    const [student]: { id: number }[] = await this.dataSource.query(
      `SELECT id FROM students WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [studentId, schoolId],
    );
    if (!student) throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');
    const rows: {
      id: number;
      type: string;
      title: string;
      status: string;
      remarks: string | null;
      created_at: Date;
      verified_at: Date | null;
      file_id: number | null;
    }[] = await this.dataSource.query(
      `SELECT id, type, title, status, remarks, created_at, verified_at, file_id FROM student_documents
       WHERE student_id = $1 AND school_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC, id DESC`,
      [studentId, schoolId],
    );
    const files = await this.files.presentMany(rows.map((row) => (row.file_id ? Number(row.file_id) : null)));
    await this.logs.save(
      this.logs.create({ school_id: schoolId, user_id: user.id, action: 'documents_viewed', student_id: studentId }),
    );
    return rows.map((row) => {
      const file = row.file_id ? files.get(Number(row.file_id)) : undefined;
      return {
        id: Number(row.id),
        type: row.type,
        title: row.title,
        status: row.status,
        remarks: row.remarks,
        created_at: row.created_at,
        verified_at: row.verified_at,
        mime_type: file?.mime_type ?? null,
        url: file?.url ?? null,
        thumbnail_url: file?.thumbnail_url ?? null,
      };
    });
  }

  async sportsOd(
    schoolId: number,
    studentIds: number[] | null,
    onDate: string | null,
    classIds: number[] | null = null,
  ) {
    const rows: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT o.id, o.student_id, trim(s.first_name || ' ' || COALESCE(s.last_name, '')) AS name,
              c.name || COALESCE(' - ' || sec.name, '') AS class_section,
              o.sport_name, o.title, to_char(o.from_date, 'YYYY-MM-DD') AS from_date,
              to_char(o.to_date, 'YYYY-MM-DD') AS to_date, o.session, o.venue
       FROM sports_on_duty o
       JOIN students s ON s.id = o.student_id AND s.deleted_at IS NULL
       LEFT JOIN academic_years ay ON ay.school_id = o.school_id AND ay.deleted_at IS NULL AND ${yearClause('ay')}
       LEFT JOIN student_enrollments e ON e.student_id = o.student_id AND e.academic_year_id = ay.id
       LEFT JOIN classes c ON c.id = e.class_id LEFT JOIN sections sec ON sec.id = e.section_id
       WHERE o.school_id = $1 AND o.deleted_at IS NULL
         AND ($2::int[] IS NULL OR o.student_id = ANY($2))
         AND ($3::date IS NULL OR (o.from_date <= $3::date AND o.to_date >= $3::date))
         AND ($4::int[] IS NULL OR e.class_id = ANY($4))
       ORDER BY o.from_date DESC, o.id DESC`,
      [schoolId, studentIds, onDate, classIds],
    );
    return rows.map((row) => ({
      id: Number(row.id),
      student_id: Number(row.student_id),
      name: row.name as string,
      class_section: (row.class_section as string | null) ?? null,
      sport_name: row.sport_name as string,
      title: row.title as string,
      from_date: row.from_date as string,
      to_date: row.to_date as string,
      session: (row.session as string | null) ?? null,
      venue: (row.venue as string | null) ?? null,
    }));
  }

  scopeClassIds(): number[] | null {
    return wingClassIds();
  }

  async sectionStats(schoolId: number, classIds: number[] | null): Promise<SectionStatRow[]> {
    return this.statsQuery(schoolId, classIds, null);
  }

  attendanceOf(rows: SectionStatRow[]): AttendanceTodayDto {
    const present = rows.reduce((sum, row) => sum + row.present, 0);
    const absent = rows.reduce((sum, row) => sum + row.absent, 0);
    return {
      sections_marked: rows.filter((row) => row.marked > 0).length,
      sections_total: rows.filter((row) => row.students > 0).length,
      present,
      absent,
      percent: percent(present, present + absent),
    };
  }

  private async sectionStatsById(schoolId: number, sectionId: number): Promise<SectionStatRow[]> {
    return this.statsQuery(schoolId, null, sectionId);
  }

  private async statsQuery(
    schoolId: number,
    classIds: number[] | null,
    sectionId: number | null,
  ): Promise<SectionStatRow[]> {
    if (classIds && !classIds.length) return [];
    const rows: SectionStatRow[] = await this.dataSource.query(
      `WITH yr AS (SELECT ay.id FROM academic_years ay WHERE ay.school_id = $1 AND ay.deleted_at IS NULL AND ${yearClause('ay')}),
       en AS (
         SELECT e.student_id, e.section_id, e.class_id, s.gender FROM student_enrollments e
         JOIN yr ON yr.id = e.academic_year_id
         JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
         WHERE e.status = 'studying'
       ),
       att AS (
         SELECT en.section_id,
                count(*) FILTER (WHERE d.status IN ${PRESENT}) AS present,
                count(*) FILTER (WHERE d.status IN ${ABSENT}) AS absent,
                count(*) AS marked
         FROM student_attendance_days d JOIN en ON en.student_id = d.student_id
         WHERE d.date = $2 GROUP BY en.section_id
       ),
       fee AS (
         SELECT en.section_id, COALESCE(sum(i.balance), 0) AS due, count(DISTINCT i.student_id) FILTER (WHERE i.balance > 0) AS defaulters
         FROM fee_invoices i JOIN en ON en.student_id = i.student_id
         WHERE i.deleted_at IS NULL AND i.status <> 'cancelled' AND i.academic_year_id IN (SELECT id FROM yr)
         GROUP BY en.section_id
       ),
       gp AS (
         SELECT en.section_id, count(*) AS pending FROM gate_passes p JOIN en ON en.student_id = p.student_id
         WHERE p.status = 'pending' AND p.deleted_at IS NULL GROUP BY en.section_id
       ),
       cnt AS (
         SELECT section_id, count(*) AS students,
                count(*) FILTER (WHERE gender = 'male') AS boys, count(*) FILTER (WHERE gender = 'female') AS girls
         FROM en GROUP BY section_id
       )
       SELECT sec.id AS section_id, sec.class_id, sec.name, c.name AS class_name, sec.class_teacher_user_id,
              u.name AS class_teacher_name,
              COALESCE(cnt.students, 0) AS students, COALESCE(cnt.boys, 0) AS boys, COALESCE(cnt.girls, 0) AS girls,
              COALESCE(att.present, 0) AS present, COALESCE(att.absent, 0) AS absent, COALESCE(att.marked, 0) AS marked,
              COALESCE(fee.due, 0) AS fee_due, COALESCE(fee.defaulters, 0) AS defaulters, COALESCE(gp.pending, 0) AS pending_passes
       FROM sections sec
       JOIN yr ON yr.id = sec.academic_year_id
       JOIN classes c ON c.id = sec.class_id AND c.deleted_at IS NULL
       LEFT JOIN users u ON u.id = sec.class_teacher_user_id
       LEFT JOIN cnt ON cnt.section_id = sec.id
       LEFT JOIN att ON att.section_id = sec.id
       LEFT JOIN fee ON fee.section_id = sec.id
       LEFT JOIN gp ON gp.section_id = sec.id
       WHERE sec.school_id = $1 AND sec.deleted_at IS NULL
         AND ($3::int[] IS NULL OR sec.class_id = ANY($3))
         AND ($4::int IS NULL OR sec.id = $4)
       ORDER BY c.grade_level, c.name, sec.name`,
      [schoolId, this.scope.today(), classIds, sectionId],
    );
    return rows.map((row) => ({
      ...row,
      section_id: Number(row.section_id),
      class_id: Number(row.class_id),
      class_teacher_user_id: row.class_teacher_user_id === null ? null : Number(row.class_teacher_user_id),
      students: num(row.students),
      boys: num(row.boys),
      girls: num(row.girls),
      present: num(row.present),
      absent: num(row.absent),
      marked: num(row.marked),
      fee_due: num(row.fee_due),
      defaulters: num(row.defaulters),
      pending_passes: num(row.pending_passes),
    }));
  }

  private async examRows(schoolId: number, classIds: number[]): Promise<ExamRow[]> {
    if (!classIds.length) return [];
    const rows: ExamRow[] = await this.dataSource.query(
      `WITH yr AS (SELECT ay.id FROM academic_years ay WHERE ay.school_id = $1 AND ay.deleted_at IS NULL AND ${yearClause('ay')}),
       ex AS (
         SELECT DISTINCT ON (es.class_id) es.class_id, x.id AS exam_id, x.name AS exam_name
         FROM exams x JOIN exam_subjects es ON es.exam_id = x.id
         WHERE x.school_id = $1 AND x.status = 'published' AND x.deleted_at IS NULL
           AND x.academic_year_id IN (SELECT id FROM yr) AND es.class_id = ANY($2)
         ORDER BY es.class_id, x.start_date DESC, x.id DESC
       ),
       sc AS (
         SELECT e.student_id, e.section_id, e.class_id, ex.exam_id, ex.exam_name,
                trim(s.first_name || ' ' || COALESCE(s.last_name, '')) AS name,
                sum(CASE WHEN m.is_absent THEN 0 ELSE COALESCE(m.marks, 0) END) AS got, sum(es.max_marks) AS mx,
                count(m.id) AS papers
         FROM ex
         JOIN exam_subjects es ON es.exam_id = ex.exam_id AND es.class_id = ex.class_id
         JOIN student_enrollments e ON e.class_id = ex.class_id AND e.status = 'studying'
           AND e.academic_year_id IN (SELECT id FROM yr)
         JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
         LEFT JOIN exam_marks m ON m.exam_id = ex.exam_id AND m.student_id = e.student_id AND m.subject_id = es.subject_id
         GROUP BY e.student_id, e.section_id, e.class_id, ex.exam_id, ex.exam_name, s.first_name, s.last_name
       )
       SELECT student_id, section_id, class_id, exam_id, exam_name, name,
              CASE WHEN papers > 0 AND mx > 0 THEN round(got * 100.0 / mx, 1) END AS pct,
              RANK() OVER (PARTITION BY section_id ORDER BY CASE WHEN papers > 0 AND mx > 0 THEN got * 1.0 / mx END DESC NULLS LAST) AS rnk
       FROM sc`,
      [schoolId, classIds],
    );
    return rows.map((row) => ({
      ...row,
      student_id: Number(row.student_id),
      section_id: Number(row.section_id),
      class_id: Number(row.class_id),
      exam_id: Number(row.exam_id),
      pct: row.pct === null ? null : Number(row.pct),
      rnk: Number(row.rnk),
    }));
  }

  private sectionCard(row: SectionStatRow, exams: ExamRow[]): SectionCardDto {
    const marks = exams.filter((item) => item.section_id === row.section_id && item.pct !== null);
    const first = marks[0];
    return {
      id: row.section_id,
      name: row.name,
      class_section: `${row.class_name} - ${row.name}`,
      class_teacher: row.class_teacher_user_id
        ? { id: row.class_teacher_user_id, name: row.class_teacher_name ?? '' }
        : null,
      student_count: row.students,
      boys: row.boys,
      girls: row.girls,
      attendance: this.attendanceOf([row]),
      fee_defaulters: row.defaulters,
      fee_due: row.fee_due,
      pending_gate_passes: row.pending_passes,
      last_exam: first ? { id: first.exam_id, name: first.exam_name } : null,
      last_exam_average: this.average(marks),
      toppers: [...marks]
        .sort((a, b) => a.rnk - b.rnk)
        .slice(0, 3)
        .map((item) => ({ student_id: item.student_id, name: item.name, percent: item.pct!, rank: item.rnk })),
    };
  }

  private rollUp(rows: SectionStatRow[]) {
    return {
      section_count: rows.length,
      student_count: rows.reduce((sum, row) => sum + row.students, 0),
      boys: rows.reduce((sum, row) => sum + row.boys, 0),
      girls: rows.reduce((sum, row) => sum + row.girls, 0),
      attendance: this.attendanceOf(rows),
      fee_due: rows.reduce((sum, row) => sum + row.fee_due, 0),
      pending_gate_passes: rows.reduce((sum, row) => sum + row.pending_passes, 0),
    };
  }

  private average(rows: ExamRow[]): number | null {
    if (!rows.length) return null;
    return Math.round((rows.reduce((sum, row) => sum + (row.pct ?? 0), 0) / rows.length) * 10) / 10;
  }

  private async visibleWings(user: AuthUser, schoolId: number): Promise<WingRow[]> {
    const wings = await this.scope.wings(schoolId);
    if (wingClassIds() === null) return wings;
    const mine = await this.scope.activeWingIds(schoolId, user.id);
    return wings.filter((wing) => mine.includes(wing.id));
  }

  private async wingAos(schoolId: number): Promise<Map<number, IdNameDto[]>> {
    const aos = await this.scope.aoUsers(schoolId);
    const links = await this.scope.userWings(
      schoolId,
      aos.map((ao) => ao.id),
    );
    const result = new Map<number, IdNameDto[]>();
    for (const link of links) {
      const ao = aos.find((row) => row.id === link.user_id);
      if (!ao) continue;
      result.set(link.wing_id, [...(result.get(link.wing_id) ?? []), { id: ao.id, name: ao.name }]);
    }
    return result;
  }

  private async assertWing(
    schoolId: number,
    id: number | null,
    input: { name: string; from_grade: number; to_grade: number; class_ids?: number[] | null },
  ): Promise<void> {
    const errors = [];
    if (input.to_grade < input.from_grade)
      errors.push({ field: 'to_grade', message: 'to_grade must be the same as or after from_grade' });
    const [wings, classes] = await Promise.all([this.scope.wings(schoolId), this.scope.classes(schoolId)]);
    const unknown = (input.class_ids ?? []).filter((classId) => !classes.some((row) => row.id === classId));
    if (unknown.length) errors.push({ field: 'class_ids', message: `Unknown class id: ${unknown.join(', ')}` });
    if (wings.some((wing) => wing.id !== id && wing.name.toLowerCase() === input.name.trim().toLowerCase()))
      errors.push({ field: 'name', message: 'Another wing already has this name' });
    if (errors.length) throw AppException.validation(errors);
    const next = [
      ...wings.filter((wing) => wing.id !== id),
      {
        id: id ?? 0,
        name: input.name.trim(),
        from_grade: input.from_grade,
        to_grade: input.to_grade,
        class_ids: input.class_ids?.length ? input.class_ids : null,
      },
    ];
    const overlap = overlapError(next, classes);
    if (overlap) throw AppException.conflict(overlap, 'WING_OVERLAP');
  }

  private async logView(user: AuthUser, schoolId: number, studentId: number): Promise<void> {
    const [recent] = await this.dataSource.query(
      `SELECT 1 FROM office_activity_logs WHERE user_id = $1 AND student_id = $2 AND action = 'student_viewed'
         AND created_at > now() - interval '1 hour' LIMIT 1`,
      [user.id, studentId],
    );
    if (recent) return;
    await this.logs.save(
      this.logs.create({ school_id: schoolId, user_id: user.id, action: 'student_viewed', student_id: studentId }),
    );
  }
}
