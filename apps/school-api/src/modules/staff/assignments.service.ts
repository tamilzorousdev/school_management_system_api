import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AppException } from '@app/common';
import { AcademicYearsService } from '../setup/academic-years.service';
import { Section } from '../setup/entities/section.entity';
import { Subject } from '../setup/entities/subject.entity';
import { AssignmentsQueryDto, SaveAssignmentsDto } from './dto/staff-input.dto';
import { AssignmentMatrixDto, MatrixCellDto, TeacherClassDto } from './dto/staff-response.dto';
import { Staff } from './entities/staff.entity';
import { TeacherAssignment } from './entities/teacher-assignment.entity';
import { assertAssignedWithinLimit, teacherLoads } from './teacher-load';

@Injectable()
export class AssignmentsService {
  constructor(
    @InjectRepository(TeacherAssignment) private readonly assignments: Repository<TeacherAssignment>,
    private readonly years: AcademicYearsService,
    private readonly dataSource: DataSource,
  ) {}

  async matrix(schoolId: number, query: AssignmentsQueryDto): Promise<AssignmentMatrixDto> {
    const year = await this.years.resolve(schoolId, query.academic_year_id);
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
    const [classSubjects, existing, teachers] = await Promise.all([
      classIds.length
        ? (this.dataSource.query(
            `SELECT cs.class_id, s.id, s.name, s.code FROM class_subjects cs JOIN subjects s ON s.id = cs.subject_id
             WHERE cs.academic_year_id = $1 AND cs.class_id = ANY($2) AND s.deleted_at IS NULL ORDER BY s.name`,
            [year.id, classIds],
          ) as Promise<{ class_id: number; id: number; name: string; code: string }[]>)
        : Promise.resolve([]),
      this.assignments.find({
        where: { school_id: schoolId, academic_year_id: year.id },
        relations: { subject: true, teacher: true },
      }),
      this.dataSource.query(
        `SELECT st.user_id, u.name, st.department, st.max_periods_per_week,
                COALESCE((SELECT SUM(ta.periods_per_week) FROM teacher_assignments ta
                  WHERE ta.teacher_user_id = st.user_id AND ta.academic_year_id = $2 AND ta.deleted_at IS NULL), 0) AS load
         FROM staff st JOIN users u ON u.id = st.user_id
         WHERE st.school_id = $1 AND st.deleted_at IS NULL AND st.status <> 'resigned' AND st.staff_type = 'teaching'
         ORDER BY u.name`,
        [schoolId, year.id],
      ) as Promise<
        { user_id: number; name: string; department: string | null; max_periods_per_week: number; load: string }[]
      >,
    ]);

    let unassigned = 0;
    const rows = sections.map((section) => {
      const own = existing.filter((item) => item.section_id === Number(section.id));
      const subjects = classSubjects.filter((item) => Number(item.class_id) === Number(section.class_id));
      const extra = own
        .filter((item) => item.subject && !subjects.some((subject) => Number(subject.id) === item.subject_id))
        .map((item) => ({
          class_id: section.class_id,
          id: item.subject_id,
          name: item.subject!.name,
          code: item.subject!.code,
        }));
      const cells: MatrixCellDto[] = [...subjects, ...extra].map((subject) => {
        const assignment = own.find((item) => item.subject_id === Number(subject.id));
        if (!assignment) unassigned += 1;
        return {
          subject_id: Number(subject.id),
          subject_name: subject.name,
          subject_code: subject.code,
          assignment_id: assignment?.id ?? null,
          teacher_user_id: assignment?.teacher_user_id ?? null,
          teacher_name: assignment?.teacher?.name ?? null,
          periods_per_week: assignment?.periods_per_week ?? null,
        };
      });
      return {
        section_id: Number(section.id),
        class_id: Number(section.class_id),
        class_name: section.class_name,
        section_name: section.name,
        class_teacher: section.class_teacher,
        cells,
      };
    });
    return {
      academic_year: { id: year.id, name: year.name },
      teachers: teachers.map((teacher) => ({
        user_id: Number(teacher.user_id),
        name: teacher.name,
        department: teacher.department,
        load_periods: Number(teacher.load),
        max_periods_per_week: Number(teacher.max_periods_per_week),
      })),
      rows,
      unassigned,
    };
  }

  async save(schoolId: number, dto: SaveAssignmentsDto): Promise<AssignmentMatrixDto> {
    const year = await this.years.resolve(schoolId, dto.academic_year_id);
    const keys = dto.items.map((item) => `${item.section_id}:${item.subject_id}`);
    if (new Set(keys).size !== keys.length) {
      throw AppException.badRequest('The same section and subject appear twice', 'DUPLICATE_ASSIGNMENT');
    }
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
      for (const item of dto.items) {
        const existing = await manager.findOneBy(TeacherAssignment, {
          section_id: item.section_id,
          subject_id: item.subject_id,
        });
        if (item.teacher_user_id === null) {
          if (existing) await manager.softDelete(TeacherAssignment, existing.id);
          continue;
        }
        await manager.save(
          manager.merge(TeacherAssignment, existing ?? manager.create(TeacherAssignment), {
            school_id: schoolId,
            academic_year_id: year.id,
            section_id: item.section_id,
            subject_id: item.subject_id,
            teacher_user_id: item.teacher_user_id,
            periods_per_week: item.periods_per_week ?? existing?.periods_per_week ?? 5,
          }),
        );
      }
      assertAssignedWithinLimit(before, await teacherLoads(manager, schoolId, year.id, teacherIds));
    });
    return this.matrix(schoolId, { academic_year_id: year.id });
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
