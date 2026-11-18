import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AppException, AuthUser } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { addDays } from '../../shared/school-days';
import { AcademicYearsService } from '../setup/academic-years.service';
import { Section } from '../setup/entities/section.entity';
import { Subject } from '../setup/entities/subject.entity';
import { assertClassWithinLimit, cellsAsOf, weekStart } from './assignment-weeks';
import { AssignmentChangesQueryDto, AssignmentsQueryDto, SaveAssignmentsDto } from './dto/staff-input.dto';
import { AssignmentChangeDto, AssignmentMatrixDto, MatrixCellDto, TeacherClassDto } from './dto/staff-response.dto';
import { Staff } from './entities/staff.entity';
import { TeacherAssignmentChange } from './entities/teacher-assignment-change.entity';
import { TeacherAssignment } from './entities/teacher-assignment.entity';
import { assertAssignedWithinLimit, teacherLoads } from './teacher-load';

@Injectable()
export class AssignmentsService {
  constructor(
    @InjectRepository(TeacherAssignment) private readonly assignments: Repository<TeacherAssignment>,
    @InjectRepository(TeacherAssignmentChange) private readonly changes: Repository<TeacherAssignmentChange>,
    private readonly years: AcademicYearsService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async matrix(schoolId: number, query: AssignmentsQueryDto): Promise<AssignmentMatrixDto> {
    const year = await this.years.resolve(schoolId, query.academic_year_id);
    const thisWeek = weekStart(todayIn(this.app.timeZone));
    const week = query.week ? weekStart(query.week) : thisWeek;
    if (week > thisWeek) {
      throw AppException.validation([{ field: 'week', message: 'Pick this week or an earlier one' }]);
    }
    const sections: {
      id: number;
      class_id: number;
      class_name: string;
      name: string;
      class_teacher: string | null;
    }[] = await this.dataSource.query(
      `SELECT sec.id, sec.class_id, c.name AS class_name, sec.name, t.name AS class_teacher
       FROM sections sec JOIN classes c ON c.id = sec.class_id
       LEFT JOIN users t ON t.id = sec.class_teacher_user_id
       WHERE sec.school_id = $1 AND sec.academic_year_id = $2 AND sec.deleted_at IS NULL AND c.deleted_at IS NULL
         ${query.class_id ? 'AND sec.class_id = $3' : ''}
       ORDER BY c.grade_level, sec.name`,
      query.class_id ? [schoolId, year.id, query.class_id] : [schoolId, year.id],
    );
    const classIds = [...new Set(sections.map((section) => Number(section.class_id)))];
    const [classSubjects, existing, teachers, changes, [school]] = await Promise.all([
      classIds.length
        ? (this.dataSource.query(
            `SELECT cs.class_id, s.id, s.name, s.code FROM class_subjects cs JOIN subjects s ON s.id = cs.subject_id
             WHERE cs.academic_year_id = $1 AND cs.class_id = ANY($2) AND s.deleted_at IS NULL ORDER BY s.name`,
            [year.id, classIds],
          ) as Promise<{ class_id: number; id: number; name: string; code: string }[]>)
        : Promise.resolve([]),
      this.assignments.find({ where: { school_id: schoolId, academic_year_id: year.id } }),
      this.dataSource.query(
        `SELECT st.user_id, u.name, st.department, st.max_periods_per_week
         FROM staff st JOIN users u ON u.id = st.user_id
         WHERE st.school_id = $1 AND st.deleted_at IS NULL AND st.status <> 'resigned' AND st.staff_type = 'teaching'
         ORDER BY u.name`,
        [schoolId],
      ) as Promise<{ user_id: number; name: string; department: string | null; max_periods_per_week: number }[]>,
      this.changes.find({ where: { school_id: schoolId, academic_year_id: year.id } }),
      this.dataSource.query(`SELECT class_periods_per_week FROM schools WHERE id = $1`, [schoolId]) as Promise<
        { class_periods_per_week: number }[]
      >,
    ]);
    const cells = cellsAsOf(
      existing.map((item) => ({
        section_id: item.section_id,
        subject_id: item.subject_id,
        teacher_user_id: item.teacher_user_id,
        periods_per_week: item.periods_per_week,
      })),
      changes,
      week,
    );
    const states = [...cells.values()];
    const subjectIds = [...new Set(states.map((cell) => cell.subject_id))];
    const teacherIds = [
      ...new Set(states.map((cell) => cell.teacher_user_id).filter((id): id is number => id !== null)),
    ];
    const [subjects, people]: [{ id: number; name: string; code: string }[], { id: number; name: string }[]] =
      await Promise.all([
        subjectIds.length
          ? this.dataSource.query(`SELECT id, name, code FROM subjects WHERE id = ANY($1)`, [subjectIds])
          : Promise.resolve([]),
        teacherIds.length
          ? this.dataSource.query(`SELECT id, name FROM users WHERE id = ANY($1)`, [teacherIds])
          : Promise.resolve([]),
      ]);
    const loads = new Map<number, number>();
    for (const cell of states) {
      if (cell.teacher_user_id !== null) {
        loads.set(cell.teacher_user_id, (loads.get(cell.teacher_user_id) ?? 0) + (cell.periods_per_week ?? 0));
      }
    }

    let unassigned = 0;
    const rows = sections.map((section) => {
      const own = states.filter((item) => item.section_id === Number(section.id));
      const listed = classSubjects.filter((item) => Number(item.class_id) === Number(section.class_id));
      const extra = own
        .filter((item) => !listed.some((subject) => Number(subject.id) === item.subject_id))
        .map((item) => subjects.find((subject) => Number(subject.id) === item.subject_id))
        .filter((subject): subject is { id: number; name: string; code: string } => Boolean(subject))
        .map((subject) => ({ class_id: section.class_id, ...subject }));
      const rowCells: MatrixCellDto[] = [...listed, ...extra].map((subject) => {
        const assignment = own.find((item) => item.subject_id === Number(subject.id));
        if (!assignment) unassigned += 1;
        const current = existing.find(
          (item) => item.section_id === Number(section.id) && item.subject_id === Number(subject.id),
        );
        return {
          subject_id: Number(subject.id),
          subject_name: subject.name,
          subject_code: subject.code,
          assignment_id: assignment ? (current?.id ?? null) : null,
          teacher_user_id: assignment?.teacher_user_id ?? null,
          teacher_name: people.find((person) => Number(person.id) === assignment?.teacher_user_id)?.name ?? null,
          periods_per_week: assignment?.periods_per_week ?? null,
        };
      });
      return {
        section_id: Number(section.id),
        class_id: Number(section.class_id),
        class_name: section.class_name,
        section_name: section.name,
        class_teacher: section.class_teacher,
        cells: rowCells,
        periods_total: own.reduce((sum, item) => sum + (item.periods_per_week ?? 0), 0),
      };
    });
    return {
      academic_year: { id: year.id, name: year.name },
      teachers: teachers.map((teacher) => ({
        user_id: Number(teacher.user_id),
        name: teacher.name,
        department: teacher.department,
        load_periods: loads.get(Number(teacher.user_id)) ?? 0,
        max_periods_per_week: Number(teacher.max_periods_per_week),
      })),
      rows,
      unassigned,
      class_periods_per_week: Number(school?.class_periods_per_week ?? 30),
      week: {
        start: week,
        end: addDays(week, 6),
        is_current: week === thisWeek,
        read_only: week !== thisWeek,
        changes: changes.filter((change) => change.week_start === week).length,
      },
    };
  }

  async changesList(schoolId: number, query: AssignmentChangesQueryDto): Promise<AssignmentChangeDto[]> {
    const year = await this.years.resolve(schoolId, query.academic_year_id);
    const rows = await this.changes.find({
      where: {
        school_id: schoolId,
        academic_year_id: year.id,
        ...(query.week ? { week_start: weekStart(query.week) } : {}),
        ...(query.section_id ? { section_id: query.section_id } : {}),
      },
      order: { id: 'DESC' },
      take: 200,
    });
    if (!rows.length) return [];
    const userIds = [
      ...new Set(
        rows
          .flatMap((row) => [row.from_teacher_user_id, row.to_teacher_user_id, row.changed_by])
          .filter((id): id is number => id !== null),
      ),
    ];
    const [users, sections, subjects]: [
      { id: number; name: string }[],
      { id: number; name: string }[],
      { id: number; name: string }[],
    ] = await Promise.all([
      userIds.length ? this.dataSource.query(`SELECT id, name FROM users WHERE id = ANY($1)`, [userIds]) : [],
      this.dataSource.query(
        `SELECT sec.id, c.name || ' - ' || sec.name AS name FROM sections sec JOIN classes c ON c.id = sec.class_id WHERE sec.id = ANY($1)`,
        [[...new Set(rows.map((row) => row.section_id))]],
      ),
      this.dataSource.query(`SELECT id, name FROM subjects WHERE id = ANY($1)`, [
        [...new Set(rows.map((row) => row.subject_id))],
      ]),
    ]);
    const ref = (list: { id: number; name: string }[], id: number | null) => {
      const found = id === null ? undefined : list.find((item) => Number(item.id) === id);
      return found ? { id: Number(found.id), name: found.name } : null;
    };
    return rows.map((row) => {
      const section = ref(sections, row.section_id) ?? { id: row.section_id, name: '' };
      const subject = ref(subjects, row.subject_id) ?? { id: row.subject_id, name: '' };
      const from = ref(users, row.from_teacher_user_id);
      const to = ref(users, row.to_teacher_user_id);
      const who =
        from && to && from.id !== to.id
          ? `${from.name} → ${to.name}`
          : !from && to
            ? `${to.name} added`
            : from && !to
              ? `${from.name} removed`
              : (to?.name ?? '');
      const periods =
        row.from_periods !== row.to_periods && row.from_periods !== null && row.to_periods !== null
          ? ` (${row.from_periods} → ${row.to_periods} periods)`
          : row.to_periods !== null && !from
            ? ` (${row.to_periods} periods)`
            : '';
      return {
        id: row.id,
        week_start: row.week_start,
        section,
        subject,
        from_teacher: from,
        to_teacher: to,
        from_periods: row.from_periods,
        to_periods: row.to_periods,
        changed_by: ref(users, row.changed_by),
        at: row.created_at,
        summary: `${subject.name} ${section.name}: ${who}${periods}`,
      };
    });
  }

  async save(schoolId: number, dto: SaveAssignmentsDto, actor: AuthUser | null = null): Promise<AssignmentMatrixDto> {
    const year = await this.years.resolve(schoolId, dto.academic_year_id);
    const keys = dto.items.map((item) => `${item.section_id}:${item.subject_id}`);
    if (new Set(keys).size !== keys.length) {
      throw AppException.badRequest('The same section and subject appear twice', 'DUPLICATE_ASSIGNMENT');
    }
    const week = weekStart(todayIn(this.app.timeZone));
    await this.dataSource.transaction(async (manager) => {
      const sectionIds = [...new Set(dto.items.map((item) => item.section_id))];
      const subjectIds = [...new Set(dto.items.map((item) => item.subject_id))];
      const teacherIds = [
        ...new Set(dto.items.map((item) => item.teacher_user_id).filter((id): id is number => id !== null)),
      ];
      const [sections, subjects, teachers] = await Promise.all([
        manager.findBy(Section, { id: In(sectionIds), school_id: schoolId }),
        manager.findBy(Subject, { id: In(subjectIds), school_id: schoolId }),
        teacherIds.length
          ? manager.findBy(Staff, { user_id: In(teacherIds), school_id: schoolId })
          : Promise.resolve([] as Staff[]),
      ]);
      const missingSection = sectionIds.find((id) => !sections.some((section) => section.id === id));
      if (missingSection) throw AppException.notFound(`Section ${missingSection} not found`, 'SECTION_NOT_FOUND');
      const otherYear = sections.find((section) => section.academic_year_id !== year.id);
      if (otherYear)
        throw AppException.badRequest(`Section ${otherYear.name} is not in ${year.name}`, 'SECTION_NOT_IN_YEAR');
      const missingSubject = subjectIds.find((id) => !subjects.some((subject) => subject.id === id));
      if (missingSubject) throw AppException.notFound(`Subject ${missingSubject} not found`, 'SUBJECT_NOT_FOUND');
      for (const id of teacherIds) {
        const teacher = teachers.find((item) => item.user_id === id);
        if (!teacher || teacher.status === 'resigned' || teacher.staff_type !== 'teaching') {
          throw AppException.badRequest('Choose a teacher from the teaching staff', 'NOT_A_TEACHER');
        }
      }

      const before = await teacherLoads(manager, schoolId, year.id, teacherIds);
      const classBefore = await this.classTotals(manager, sectionIds);
      for (const item of dto.items) {
        const existing = await manager.findOneBy(TeacherAssignment, {
          section_id: item.section_id,
          subject_id: item.subject_id,
        });
        const fromTeacher = existing?.teacher_user_id ?? null;
        const fromPeriods = existing?.periods_per_week ?? null;
        if (item.teacher_user_id === null) {
          if (existing) {
            await manager.softDelete(TeacherAssignment, existing.id);
            await this.recordChange(
              manager,
              schoolId,
              year.id,
              item,
              fromTeacher,
              fromPeriods,
              null,
              null,
              week,
              actor,
            );
          }
          continue;
        }
        const periods = item.periods_per_week ?? existing?.periods_per_week ?? 5;
        await manager.save(
          manager.merge(TeacherAssignment, existing ?? manager.create(TeacherAssignment), {
            school_id: schoolId,
            academic_year_id: year.id,
            section_id: item.section_id,
            subject_id: item.subject_id,
            teacher_user_id: item.teacher_user_id,
            periods_per_week: periods,
          }),
        );
        if (fromTeacher !== item.teacher_user_id || fromPeriods !== periods) {
          await this.recordChange(
            manager,
            schoolId,
            year.id,
            item,
            fromTeacher,
            fromPeriods,
            item.teacher_user_id,
            periods,
            week,
            actor,
          );
        }
      }
      assertAssignedWithinLimit(before, await teacherLoads(manager, schoolId, year.id, teacherIds));
      const [school] = await manager.query(`SELECT class_periods_per_week FROM schools WHERE id = $1`, [schoolId]);
      assertClassWithinLimit(
        classBefore,
        await this.classTotals(manager, sectionIds),
        new Map(
          (
            await manager.query(
              `SELECT sec.id, c.name || ' - ' || sec.name AS name FROM sections sec JOIN classes c ON c.id = sec.class_id WHERE sec.id = ANY($1)`,
              [sectionIds],
            )
          ).map((row: { id: number; name: string }) => [Number(row.id), `Class ${row.name}`]),
        ),
        Number(school?.class_periods_per_week ?? 30),
      );
    });
    return this.matrix(schoolId, { academic_year_id: year.id });
  }

  private async classTotals(manager: EntityManager, sectionIds: number[]): Promise<Map<number, number>> {
    const rows: { section_id: number; total: string }[] = await manager.query(
      `SELECT section_id, COALESCE(SUM(periods_per_week), 0) AS total FROM teacher_assignments
       WHERE section_id = ANY($1) AND deleted_at IS NULL GROUP BY section_id`,
      [sectionIds],
    );
    return new Map(rows.map((row) => [Number(row.section_id), Number(row.total)]));
  }

  private async recordChange(
    manager: EntityManager,
    schoolId: number,
    yearId: number,
    item: { section_id: number; subject_id: number },
    fromTeacher: number | null,
    fromPeriods: number | null,
    toTeacher: number | null,
    toPeriods: number | null,
    week: string,
    actor: AuthUser | null,
  ): Promise<void> {
    await manager.insert(TeacherAssignmentChange, {
      school_id: schoolId,
      academic_year_id: yearId,
      section_id: item.section_id,
      subject_id: item.subject_id,
      from_teacher_user_id: fromTeacher,
      from_periods: fromPeriods,
      to_teacher_user_id: toTeacher,
      to_periods: toPeriods,
      week_start: week,
      changed_by: actor?.id ?? null,
    });
  }

  async teacherClasses(schoolId: number, userId: number): Promise<TeacherClassDto[]> {
    const year = await this.years.currentOrNull(schoolId);
    if (!year) return [];
    const rows: {
      section_id: number;
      class_name: string;
      section_name: string;
      room: string | null;
      is_class_teacher: boolean;
      subjects: { id: number; name: string }[] | null;
      student_count: string;
    }[] = await this.dataSource.query(
      `SELECT sec.id AS section_id, c.name AS class_name, sec.name AS section_name, sec.room,
              (sec.class_teacher_user_id = $2) AS is_class_teacher,
              (SELECT json_agg(json_build_object('id', s.id, 'name', s.name) ORDER BY s.name)
                 FROM teacher_assignments ta JOIN subjects s ON s.id = ta.subject_id
                 WHERE ta.section_id = sec.id AND ta.teacher_user_id = $2 AND ta.deleted_at IS NULL) AS subjects,
              (SELECT COUNT(*) FROM student_enrollments e JOIN students x ON x.id = e.student_id
                 WHERE e.section_id = sec.id AND x.deleted_at IS NULL AND x.status = 'active') AS student_count
       FROM sections sec JOIN classes c ON c.id = sec.class_id
       WHERE sec.school_id = $1 AND sec.academic_year_id = $3 AND sec.deleted_at IS NULL
         AND (sec.class_teacher_user_id = $2 OR EXISTS (
           SELECT 1 FROM teacher_assignments ta WHERE ta.section_id = sec.id AND ta.teacher_user_id = $2 AND ta.deleted_at IS NULL))
       ORDER BY (sec.class_teacher_user_id = $2) DESC, c.grade_level, sec.name`,
      [schoolId, userId, year.id],
    );
    return rows.map((row) => ({
      section_id: Number(row.section_id),
      class_name: row.class_name,
      section_name: row.section_name,
      is_class_teacher: Boolean(row.is_class_teacher),
      subjects: (row.subjects ?? []).map((subject) => ({ id: Number(subject.id), name: subject.name })),
      student_count: Number(row.student_count),
      room: row.room,
    }));
  }

  async assertTeachesSection(schoolId: number, userId: number, sectionId: number): Promise<void> {
    const classes = await this.teacherClasses(schoolId, userId);
    if (!classes.some((item) => item.section_id === sectionId)) {
      throw AppException.forbidden('You do not teach this section', 'NOT_YOUR_SECTION');
    }
  }

  async assertTeachesStudent(schoolId: number, userId: number, studentId: number): Promise<void> {
    const year = await this.years.currentOrNull(schoolId);
    const [row] = await this.dataSource.query(
      `SELECT e.section_id FROM student_enrollments e JOIN students s ON s.id = e.student_id
       WHERE e.student_id = $1 AND e.academic_year_id = $2 AND s.school_id = $3 AND s.deleted_at IS NULL`,
      [studentId, year?.id ?? 0, schoolId],
    );
    if (!row?.section_id) throw AppException.notFound('Student not found in your classes', 'STUDENT_NOT_FOUND');
    await this.assertTeachesSection(schoolId, userId, Number(row.section_id));
  }
}
