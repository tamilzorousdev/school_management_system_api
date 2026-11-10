import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppException, AuthUser, listQuery, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { addDays, holidaySet, workingDays } from '../../shared/school-days';
import { FilesService } from '../files/files.service';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import { NotificationsService } from '../notifications/notifications.service';
import { LeaveDecisionDto, StudentLeaveDto, StudentLeaveInputDto, StudentLeaveQueryDto } from './dto/attendance.dto';
import { StudentLeave } from './entities/student-leave.entity';

const MAX_LEAVE_DAYS = 30;
const BACKDATE_DAYS = 7;

@Injectable()
export class StudentLeaveService {
  private readonly logger = new Logger('StudentLeave');

  constructor(
    @InjectRepository(StudentLeave) private readonly leaves: Repository<StudentLeave>,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async apply(
    schoolId: number,
    studentId: number,
    dto: StudentLeaveInputDto,
    actor: AuthUser,
  ): Promise<StudentLeaveDto> {
    const today = todayIn(this.app.timeZone);
    if (dto.to_date < dto.from_date) {
      throw AppException.validation([{ field: 'to_date', message: 'The last day must be on or after the first day' }]);
    }
    if (dto.from_date < addDays(today, -BACKDATE_DAYS)) {
      throw AppException.validation([
        { field: 'from_date', message: `Leave can start at most ${BACKDATE_DAYS} days ago` },
      ]);
    }
    if (addDays(dto.from_date, MAX_LEAVE_DAYS) < dto.to_date) {
      throw AppException.validation([
        { field: 'to_date', message: `One request can cover up to ${MAX_LEAVE_DAYS} days` },
      ]);
    }
    if (dto.file_id) await this.files.assertAttachable(dto.file_id, schoolId);
    const overlap = await this.dataSource.query(
      `SELECT 1 FROM student_leave_requests WHERE student_id = $1 AND deleted_at IS NULL
       AND status IN ('pending', 'approved') AND from_date <= $3 AND to_date >= $2 LIMIT 1`,
      [studentId, dto.from_date, dto.to_date],
    );
    if (overlap.length) {
      throw AppException.conflict('There is already a leave request for some of these days', 'LEAVE_OVERLAP');
    }
    const saved = await this.leaves.save(
      this.leaves.create({
        school_id: schoolId,
        student_id: studentId,
        from_date: dto.from_date,
        to_date: dto.to_date,
        reason: dto.reason,
        file_id: dto.file_id ?? null,
        status: 'pending',
        created_by: actor.id,
      }),
    );
    await this.notifyClassTeacher(saved);
    return (await this.present(schoolId, [saved]))[0];
  }

  private async notifyClassTeacher(leave: StudentLeave): Promise<void> {
    const [row] = await this.dataSource.query(
      `SELECT sec.class_teacher_user_id AS teacher_id, c.name || ' - ' || sec.name AS class_name,
              trim(s.first_name || ' ' || COALESCE(s.last_name, '')) AS student
       FROM student_enrollments e
       JOIN academic_years y ON y.id = e.academic_year_id AND y.is_current
       JOIN sections sec ON sec.id = e.section_id
       JOIN classes c ON c.id = sec.class_id
       JOIN students s ON s.id = e.student_id
       WHERE e.student_id = $1 LIMIT 1`,
      [leave.student_id],
    );
    if (!row?.teacher_id) return;
    await this.notifications
      .dispatch({
        template: TEMPLATES.STUDENT_LEAVE_REQUEST,
        audience: { user_ids: [Number(row.teacher_id)] },
        data: {
          student: row.student,
          class: row.class_name,
          from: leave.from_date,
          to: leave.to_date,
          reason: leave.reason,
          student_id: String(leave.student_id),
          leave_id: String(leave.id),
        },
      })
      .catch((error: Error) =>
        this.logger.warn(`Leave request ${leave.id} not sent to the class teacher: ${error.message}`),
      );
  }

  async list(
    schoolId: number,
    query: StudentLeaveQueryDto,
    sectionIds?: number[],
  ): Promise<Paginated<StudentLeaveDto>> {
    const qb = this.leaves
      .createQueryBuilder('l')
      .innerJoin('students', 's', 's.id = l.student_id')
      .where('l.school_id = :schoolId', { schoolId });
    if (query.status) qb.andWhere('l.status = :status', { status: query.status });
    if (query.section_id || sectionIds) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM student_enrollments e JOIN academic_years y ON y.id = e.academic_year_id AND y.is_current
                 WHERE e.student_id = l.student_id AND e.section_id = ANY(:sections))`,
        { sections: query.section_id ? [query.section_id] : sectionIds },
      );
    }
    const page = await listQuery(qb, query.sort ? query : { ...query, sort: 'from_date', order: 'desc' }, {
      searchable: ['s.first_name', 's.last_name', 's.admission_no', 'l.reason'],
      sortable: { from_date: 'l.from_date', created_at: 'l.created_at', status: 'l.status' },
      defaultSort: 'from_date',
    });
    return { ...page, items: await this.present(schoolId, page.items) };
  }

  async forStudent(schoolId: number, studentId: number): Promise<StudentLeaveDto[]> {
    const rows = await this.leaves.find({
      where: { school_id: schoolId, student_id: studentId },
      order: { from_date: 'DESC' },
      take: 50,
    });
    return this.present(schoolId, rows);
  }

  async cancel(schoolId: number, studentId: number, id: number): Promise<StudentLeaveDto> {
    const leave = await this.leaves.findOneBy({ id, school_id: schoolId, student_id: studentId });
    if (!leave) throw AppException.notFound('Leave request not found', 'LEAVE_NOT_FOUND');
    if (leave.status !== 'pending') {
      throw AppException.conflict(
        `Only a waiting request can be cancelled. This one is ${leave.status}.`,
        'LEAVE_NOT_PENDING',
      );
    }
    leave.status = 'cancelled';
    return (await this.present(schoolId, [await this.leaves.save(leave)]))[0];
  }

  async decide(
    schoolId: number,
    id: number,
    dto: LeaveDecisionDto,
    actor: AuthUser,
    sectionIds?: number[],
  ): Promise<StudentLeaveDto> {
    const leave = await this.leaves.findOneBy({ id, school_id: schoolId });
    if (!leave) throw AppException.notFound('Leave request not found', 'LEAVE_NOT_FOUND');
    if (sectionIds) {
      const [row] = await this.dataSource.query(
        `SELECT 1 FROM student_enrollments e JOIN academic_years y ON y.id = e.academic_year_id AND y.is_current
         WHERE e.student_id = $1 AND e.section_id = ANY($2)`,
        [leave.student_id, sectionIds],
      );
      if (!row) throw AppException.forbidden('Only the class teacher can decide this request', 'NOT_CLASS_TEACHER');
    }
    if (leave.status !== 'pending') {
      throw AppException.conflict(`This request is already ${leave.status}`, 'LEAVE_NOT_PENDING');
    }
    Object.assign(leave, {
      status: dto.status,
      decision_note: dto.note ?? null,
      decided_by: actor.id,
      decided_at: new Date(),
    });
    const saved = await this.leaves.save(leave);
    await this.notifyParents(saved);
    return (await this.present(schoolId, [saved]))[0];
  }

  private async notifyParents(leave: StudentLeave): Promise<void> {
    const rows: { name: string; user_ids: number[] }[] = await this.dataSource.query(
      `SELECT concat_ws(' ', s.first_name, s.last_name) AS name,
              array_remove(array_agg(DISTINCT g.user_id), NULL) AS user_ids
       FROM students s
       LEFT JOIN student_guardians sg ON sg.student_id = s.id
       LEFT JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
       WHERE s.id = $1 GROUP BY s.id`,
      [leave.student_id],
    );
    const users = [
      ...new Set([...(rows[0]?.user_ids ?? []).map(Number), ...(leave.created_by ? [leave.created_by] : [])]),
    ];
    if (!users.length) return;
    await this.notifications
      .dispatch({
        template: 'LEAVE_STATUS',
        audience: { user_ids: users },
        data: {
          student: rows[0]?.name ?? '',
          from: leave.from_date,
          to: leave.to_date,
          status: leave.status,
          student_id: String(leave.student_id),
          leave_id: String(leave.id),
        },
      })
      .catch((error: Error) => this.logger.warn(`Leave status for ${leave.id} not sent: ${error.message}`));
  }

  private async present(schoolId: number, rows: StudentLeave[]): Promise<StudentLeaveDto[]> {
    if (!rows.length) return [];
    const studentIds = [...new Set(rows.map((row) => row.student_id))];
    const userIds = [
      ...new Set(rows.flatMap((row) => [row.created_by, row.decided_by]).filter((id): id is number => Boolean(id))),
    ];
    const [students, users, from, to] = await Promise.all([
      this.dataSource.query(
        `SELECT s.id, concat_ws(' ', s.first_name, s.last_name) AS name, c.name AS class_name, sec.name AS section_name
         FROM students s
         LEFT JOIN academic_years y ON y.school_id = s.school_id AND y.is_current AND y.deleted_at IS NULL
         LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = y.id
         LEFT JOIN classes c ON c.id = e.class_id LEFT JOIN sections sec ON sec.id = e.section_id
         WHERE s.id = ANY($1)`,
        [studentIds],
      ) as Promise<{ id: number; name: string; class_name: string | null; section_name: string | null }[]>,
      userIds.length
        ? (this.dataSource.query(`SELECT id, name FROM users WHERE id = ANY($1)`, [userIds]) as Promise<
            { id: number; name: string }[]
          >)
        : Promise.resolve([]),
      Promise.resolve(rows.reduce((min, row) => (row.from_date < min ? row.from_date : min), rows[0].from_date)),
      Promise.resolve(rows.reduce((max, row) => (row.to_date > max ? row.to_date : max), rows[0].to_date)),
    ]);
    const holidays = await holidaySet(this.dataSource.manager, schoolId, from, to);
    const studentMap = new Map(students.map((row) => [Number(row.id), row]));
    const userMap = new Map(users.map((row) => [Number(row.id), { id: Number(row.id), name: row.name }]));
    return rows.map((row) => {
      const student = studentMap.get(row.student_id);
      return {
        id: row.id,
        student: { id: row.student_id, name: student?.name ?? '' },
        class_section: student?.class_name
          ? [student.class_name, student.section_name].filter(Boolean).join(' - ')
          : null,
        from_date: row.from_date,
        to_date: row.to_date,
        days: workingDays(row.from_date, row.to_date, holidays).length,
        reason: row.reason,
        file_id: row.file_id,
        status: row.status,
        requested_by: row.created_by ? (userMap.get(row.created_by) ?? null) : null,
        decided_by: row.decided_by ? (userMap.get(row.decided_by) ?? null) : null,
        decided_at: row.decided_at,
        decision_note: row.decision_note,
        created_at: row.created_at,
      };
    });
  }
}
