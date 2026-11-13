import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Not, Repository } from 'typeorm';
import { AppException, listQuery, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { monthStartIn, todayIn, yearsBetween } from '../../shared/dates';
import { School } from '../schools/entities/school.entity';
import { SequencesService } from '../schools/sequences.service';
import { AcademicYear } from '../setup/entities/academic-year.entity';
import { SchoolClass } from '../setup/entities/school-class.entity';
import { Section } from '../setup/entities/section.entity';
import {
  CreateStudentDto,
  EmergencyContactsDto,
  EnrollmentInputDto,
  GuardianInputDto,
  RollNumbersDto,
  StudentQueryDto,
  UpdateGuardianLinkDto,
  UpdateStudentDto,
} from './dto/student-input.dto';
import { StudentDetailDto, StudentInsightsDto, StudentListItemDto } from './dto/student-response.dto';
import { EmergencyContact } from './entities/emergency-contact.entity';
import { StudentEnrollment } from './entities/student-enrollment.entity';
import { StudentGuardian } from './entities/student-guardian.entity';
import { Guardian } from './entities/guardian.entity';
import { Student } from './entities/student.entity';
import { FilesService } from '../files/files.service';
import { GuardiansService, Invite } from './guardians.service';
import { viewingYearId, yearClause, yearWhere } from '../../shared/year-context';

type ListedStudent = Student & {
  current?: StudentEnrollment | null;
  current_class?: SchoolClass | null;
  current_section?: Section | null;
};

@Injectable()
export class StudentsService {
  constructor(
    @InjectRepository(Student) private readonly students: Repository<Student>,
    @InjectRepository(AcademicYear) private readonly years: Repository<AcademicYear>,
    private readonly guardians: GuardiansService,
    private readonly sequences: SequencesService,
    private readonly files: FilesService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async create(schoolId: number, dto: CreateStudentDto): Promise<StudentDetailDto> {
    const { student, invites } = await this.dataSource.transaction((manager) =>
      this.createInTx(manager, schoolId, dto),
    );
    await this.guardians.sendInvites(invites);
    return this.get(schoolId, student.id);
  }

  async createInTx(
    manager: EntityManager,
    schoolId: number,
    dto: CreateStudentDto,
  ): Promise<{ student: Student; invites: (Invite | null)[] }> {
    const year = await this.currentYear(manager, schoolId);
    await this.assertClass(manager, schoolId, dto.class_id);
    await this.assertPlacement(
      manager,
      schoolId,
      year.id,
      dto.class_id,
      dto.section_id ?? null,
      dto.roll_no ?? null,
      null,
    );
    const mobiles = dto.guardians.map((guardian) => guardian.mobile);
    if (new Set(mobiles).size !== mobiles.length) {
      throw AppException.badRequest('Two guardians have the same mobile number', 'DUPLICATE_GUARDIAN_MOBILE');
    }
    const fathers = dto.guardians.filter((g) => g.relation === 'father');
    if (fathers.length > 1) {
      throw AppException.badRequest('A student can only have one Father', 'DUPLICATE_FATHER');
    }
    const mothers = dto.guardians.filter((g) => g.relation === 'mother');
    if (mothers.length > 1) {
      throw AppException.badRequest('A student can only have one Mother', 'DUPLICATE_MOTHER');
    }
    const extraContacts = dto.guardians.filter((g) => g.relation !== 'father' && g.relation !== 'mother');
    if (extraContacts.length > 3) {
      throw AppException.badRequest(
        'You can add up to 3 extra emergency contacts or caregivers',
        'TOO_MANY_EXTRA_CONTACTS',
      );
    }
    for (const g of dto.guardians) {
      const existing = await manager.findOneBy(Guardian, { school_id: schoolId, mobile: g.mobile });
      if (existing && existing.name.trim().toLowerCase() !== g.name.trim().toLowerCase()) {
        throw AppException.badRequest(
          `This mobile number (${g.mobile}) is already registered to ${existing.name}. Please verify the name or select the existing parent.`,
          'GUARDIAN_MOBILE_NAME_MISMATCH',
        );
      }
    }

    const admissionNo = dto.admission_no ?? (await this.nextAdmissionNo(manager, schoolId, year));
    if (await manager.exists(Student, { where: { school_id: schoolId, admission_no: admissionNo } })) {
      throw AppException.conflict(`Admission number ${admissionNo} is already used`, 'ADMISSION_NO_TAKEN');
    }

    const student = await manager.save(
      manager.create(Student, {
        school_id: schoolId,
        admission_no: admissionNo,
        emis_number: dto.emis_number ?? null,
        first_name: dto.first_name,
        last_name: dto.last_name ?? null,
        dob: dto.dob,
        gender: dto.gender,
        blood_group: dto.blood_group ?? null,
        house: dto.house ?? null,
        photo_file_id: dto.photo_file_id ?? null,
        admission_date: dto.admission_date ?? todayIn(this.app.timeZone),
        status: 'active',
        address_line: dto.address_line ?? null,
        city: dto.city ?? null,
        pincode: dto.pincode ?? null,
        previous_school: dto.previous_school ?? null,
        identification_marks: dto.identification_marks ?? null,
        is_specially_abled: dto.is_specially_abled ?? false,
        disability_category: dto.disability_category ?? null,
        disability_percentage: dto.disability_percentage ?? null,
        is_adopted: dto.is_adopted ?? false,
      }),
    );
    await manager.insert(StudentEnrollment, {
      school_id: schoolId,
      student_id: student.id,
      academic_year_id: year.id,
      class_id: dto.class_id,
      section_id: dto.section_id ?? null,
      roll_no: dto.roll_no ?? null,
      status: 'studying',
    });

    const primaryIndex = Math.max(
      0,
      dto.guardians.findIndex((guardian) => guardian.is_primary),
    );
    const invites: (Invite | null)[] = [];
    for (const [index, guardian] of dto.guardians.entries()) {
      const result = await this.guardians.upsertForStudent(manager, schoolId, student.id, {
        ...guardian,
        is_primary: index === primaryIndex,
      });
      invites.push(result.invite);
    }
    if (dto.emergency_contacts?.length) {
      await manager.insert(
        EmergencyContact,
        dto.emergency_contacts.map((contact) => ({ ...contact, student_id: student.id })),
      );
    }
    return { student, invites };
  }

  async list(schoolId: number, query: StudentQueryDto): Promise<Paginated<StudentListItemDto>> {
    const year = await this.years.findOneBy(yearWhere(schoolId));
    const qb = this.students
      .createQueryBuilder('s')
      .leftJoinAndMapOne('s.current', StudentEnrollment, 'e', 'e.student_id = s.id AND e.academic_year_id = :yearId', {
        yearId: year?.id ?? 0,
      })
      .leftJoinAndMapOne('s.current_class', SchoolClass, 'c', 'c.id = e.class_id')
      .leftJoinAndMapOne('s.current_section', Section, 'sec', 'sec.id = e.section_id')
      .leftJoinAndSelect('s.guardian_links', 'gl')
      .leftJoinAndSelect('gl.guardian', 'g')
      .where('s.school_id = :schoolId', { schoolId });
    if (viewingYearId()) qb.andWhere('e.id IS NOT NULL');

    if (query.status) qb.andWhere('s.status = :status', { status: query.status });
    if (query.gender) qb.andWhere('s.gender = :gender', { gender: query.gender });
    if (query.house) qb.andWhere('LOWER(s.house) = LOWER(:house)', { house: query.house });
    if (query.class_id) qb.andWhere('e.class_id = :classId', { classId: query.class_id });
    if (query.section_id) qb.andWhere('e.section_id = :sectionId', { sectionId: query.section_id });
    if (query.no_section !== undefined)
      qb.andWhere(query.no_section ? 'e.section_id IS NULL' : 'e.section_id IS NOT NULL');
    if (query.new_this_month)
      qb.andWhere('s.admission_date >= :monthStart', { monthStart: monthStartIn(this.app.timeZone) });
    if (query.has_siblings !== undefined) {
      qb.andWhere(`${query.has_siblings ? '' : 'NOT '}EXISTS (${SIBLING_EXISTS})`);
    }

    const ordered = query.sort ? query : { ...query, sort: 'name', order: 'asc' as const };
    const page = await listQuery(qb, ordered, {
      searchable: ['s.first_name', 's.last_name', 's.admission_no', 's.emis_number', 'g.name', 'g.mobile'],
      sortable: {
        name: 's.first_name',
        admission_no: 's.admission_no',
        emis_number: 's.emis_number',
        admission_date: 's.admission_date',
        created_at: 's.created_at',
        roll_no: 'e.roll_no',
        class: 'c.grade_level',
      },
      defaultSort: 'name',
    });
    const siblings = await this.siblingCounts(page.items.map((student) => student.id));
    const today = todayIn(this.app.timeZone);
    return {
      ...page,
      items: page.items.map((student) =>
        this.toListItem(student as ListedStudent, siblings.get(student.id) ?? 0, today),
      ),
    };
  }

  async insights(schoolId: number): Promise<StudentInsightsDto> {
    const year = await this.years.findOneBy(yearWhere(schoolId));
    const [row] = await this.dataSource.query(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE s.admission_date >= $3) AS new_this_month,
              COUNT(*) FILTER (WHERE e.section_id IS NULL) AS without_section,
              COUNT(*) FILTER (WHERE EXISTS (${SIBLING_EXISTS})) AS with_siblings,
              COUNT(*) FILTER (WHERE s.gender = 'male') AS boys,
              COUNT(*) FILTER (WHERE s.gender = 'female') AS girls
       FROM students s
       LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = $2
       WHERE s.school_id = $1 AND s.deleted_at IS NULL
         AND ${viewingYearId() ? 'e.id IS NOT NULL' : "s.status = 'active'"}`,
      [schoolId, year?.id ?? 0, monthStartIn(this.app.timeZone)],
    );
    return {
      total: Number(row.total),
      new_this_month: Number(row.new_this_month),
      without_section: Number(row.without_section),
      with_siblings: Number(row.with_siblings),
      boys: Number(row.boys),
      girls: Number(row.girls),
    };
  }

  async get(schoolId: number, id: number): Promise<StudentDetailDto> {
    const student = await this.students.findOne({
      where: { id, school_id: schoolId },
      relations: {
        guardian_links: { guardian: { user: true } },
        emergency_contacts: true,
        enrollments: { academic_year: true, school_class: true, section: true },
      },
    });
    if (!student) throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');

    const enrollments = (student.enrollments ?? []).sort((a, b) =>
      (b.academic_year?.start_date ?? '').localeCompare(a.academic_year?.start_date ?? ''),
    );
    const viewing = viewingYearId();
    const current =
      enrollments.find((enrollment) =>
        viewing ? enrollment.academic_year_id === viewing : enrollment.academic_year?.is_current,
      ) ?? null;
    const listed: ListedStudent = Object.assign(student, {
      current,
      current_class: current?.school_class ?? null,
      current_section: current?.section ?? null,
    });
    const siblings: {
      id: number;
      first_name: string;
      last_name: string | null;
      class_name: string | null;
      section_name: string | null;
    }[] = await this.dataSource.query(
      `SELECT DISTINCT ON (x.id) x.id, x.first_name, x.last_name, c.name AS class_name, sec.name AS section_name
         FROM student_guardians a
         JOIN student_guardians b ON b.guardian_id = a.guardian_id AND b.student_id <> a.student_id
         JOIN students x ON x.id = b.student_id AND x.deleted_at IS NULL
         LEFT JOIN academic_years y ON y.school_id = x.school_id AND ${yearClause('y')} AND y.deleted_at IS NULL
         LEFT JOIN student_enrollments e ON e.student_id = x.id AND e.academic_year_id = y.id
         LEFT JOIN classes c ON c.id = e.class_id
         LEFT JOIN sections sec ON sec.id = e.section_id
         WHERE a.student_id = $1
         ORDER BY x.id`,
      [id],
    );
    const links = (student.guardian_links ?? []).filter((link) => link.guardian && !link.guardian.deleted_at);

    return {
      ...this.toListItem(listed, siblings.length, todayIn(this.app.timeZone)),
      blood_group: student.blood_group,
      address_line: student.address_line,
      city: student.city,
      pincode: student.pincode,
      previous_school: student.previous_school,
      identification_marks: student.identification_marks,
      is_specially_abled: Boolean(student.is_specially_abled),
      disability_category: student.disability_category ?? null,
      disability_percentage: student.disability_percentage ? Number(student.disability_percentage) : null,
      is_adopted: Boolean(student.is_adopted),
      guardian_details: links
        .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
        .map((link) => ({
          id: link.guardian!.id,
          name: link.guardian!.name,
          mobile: link.guardian!.mobile,
          relation: link.relation,
          is_primary: link.is_primary,
          email: link.guardian!.email,
          occupation: link.guardian!.occupation,
          qualification: link.guardian!.qualification,
          can_pickup: link.can_pickup,
          receives_alerts: link.receives_alerts,
          on_app: Boolean(link.guardian!.user?.last_login_at),
        })),
      siblings: siblings.map((sibling) => ({
        id: Number(sibling.id),
        full_name: [sibling.first_name, sibling.last_name].filter(Boolean).join(' '),
        class_section: sibling.class_name
          ? [sibling.class_name, sibling.section_name].filter(Boolean).join(' - ')
          : null,
      })),
      history: enrollments.map((enrollment) => ({
        academic_year: enrollment.academic_year?.name ?? '',
        class_name: enrollment.school_class?.name ?? '',
        section_name: enrollment.section?.name ?? null,
        roll_no: enrollment.roll_no,
        status: enrollment.status,
        is_current: Boolean(enrollment.academic_year?.is_current),
      })),
      emergency_contacts: (student.emergency_contacts ?? []).map(({ id: contactId, name, relation, mobile }) => ({
        id: contactId,
        name,
        relation,
        mobile,
      })),
    };
  }

  async update(schoolId: number, id: number, dto: UpdateStudentDto): Promise<StudentDetailDto> {
    await this.find(schoolId, id);
    if (Object.keys(dto).length) await this.students.update(id, dto);
    return this.get(schoolId, id);
  }

  async setEnrollment(schoolId: number, id: number, dto: EnrollmentInputDto): Promise<StudentDetailDto> {
    await this.find(schoolId, id);
    await this.dataSource.transaction(async (manager) => {
      const year = await this.currentYear(manager, schoolId);
      await this.assertClass(manager, schoolId, dto.class_id);
      const sectionId = dto.section_id ?? null;
      const rollNo = dto.roll_no ?? null;
      await this.assertPlacement(manager, schoolId, year.id, dto.class_id, sectionId, rollNo, id);
      const existing = await manager.findOneBy(StudentEnrollment, { student_id: id, academic_year_id: year.id });
      await manager.save(
        manager.merge(StudentEnrollment, existing ?? manager.create(StudentEnrollment), {
          school_id: schoolId,
          student_id: id,
          academic_year_id: year.id,
          class_id: dto.class_id,
          section_id: sectionId,
          roll_no: rollNo,
          status: 'studying',
        }),
      );
    });
    return this.get(schoolId, id);
  }

  async addGuardian(schoolId: number, id: number, dto: GuardianInputDto): Promise<StudentDetailDto> {
    await this.find(schoolId, id);
    const invite = await this.dataSource.transaction(
      async (manager) => (await this.guardians.upsertForStudent(manager, schoolId, id, dto)).invite,
    );
    await this.guardians.sendInvites([invite]);
    return this.get(schoolId, id);
  }

  async updateGuardianLink(
    schoolId: number,
    id: number,
    guardianId: number,
    dto: UpdateGuardianLinkDto,
  ): Promise<StudentDetailDto> {
    await this.find(schoolId, id);
    const invite = await this.dataSource.transaction(async (manager) => {
      const link = await manager.findOne(StudentGuardian, {
        where: { student_id: id, guardian_id: guardianId },
        relations: { guardian: true },
      });
      if (!link) throw AppException.notFound('This guardian is not linked to the student', 'GUARDIAN_NOT_LINKED');
      if (dto.is_primary) {
        await manager.update(StudentGuardian, { student_id: id, guardian_id: Not(guardianId) }, { is_primary: false });
      }
      await manager.update(StudentGuardian, link.id, dto);
      if (dto.is_primary === false) {
        const other = await manager.findOne(StudentGuardian, {
          where: { student_id: id, guardian_id: Not(guardianId) },
          order: { created_at: 'ASC' },
        });
        if (!other) throw AppException.badRequest('The only guardian must stay the main contact', 'PRIMARY_REQUIRED');
        await manager.update(StudentGuardian, other.id, { is_primary: true });
      }
      return dto.receives_alerts ? this.guardians.ensureLogin(manager, link.guardian!) : null;
    });
    await this.guardians.sendInvites([invite]);
    return this.get(schoolId, id);
  }

  async removeGuardian(schoolId: number, id: number, guardianId: number): Promise<StudentDetailDto> {
    await this.find(schoolId, id);
    await this.dataSource.transaction(async (manager) => {
      const links = await manager.find(StudentGuardian, { where: { student_id: id } });
      const link = links.find((item) => item.guardian_id === guardianId);
      if (!link) throw AppException.notFound('This guardian is not linked to the student', 'GUARDIAN_NOT_LINKED');
      if (links.length === 1)
        throw AppException.badRequest('A student needs at least one parent or guardian', 'LAST_GUARDIAN');
      await manager.delete(StudentGuardian, link.id);
      await this.guardians.ensureOnePrimary(manager, id);
    });
    return this.get(schoolId, id);
  }

  async setEmergencyContacts(schoolId: number, id: number, dto: EmergencyContactsDto): Promise<StudentDetailDto> {
    await this.find(schoolId, id);
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(EmergencyContact, { student_id: id });
      if (dto.items.length)
        await manager.insert(
          EmergencyContact,
          dto.items.map((item) => ({ ...item, student_id: id })),
        );
    });
    return this.get(schoolId, id);
  }

  async assignRollNumbers(
    schoolId: number,
    sectionId: number,
    dto: RollNumbersDto,
  ): Promise<{ section_id: number; assigned: number }> {
    const section = await this.dataSource.getRepository(Section).findOneBy({ id: sectionId, school_id: schoolId });
    if (!section) throw AppException.notFound('Section not found', 'SECTION_NOT_FOUND');
    const order = {
      name: 's.first_name ASC, s.last_name ASC NULLS FIRST, s.id ASC',
      admission_no: 's.admission_no ASC',
      gender_name: 's.gender DESC, s.first_name ASC, s.last_name ASC NULLS FIRST, s.id ASC',
    }[dto.order ?? 'name'];
    const assigned = await this.dataSource.transaction(async (manager) => {
      const rows: { id: number }[] = await manager.query(
        `SELECT e.id FROM student_enrollments e JOIN students s ON s.id = e.student_id
         WHERE e.section_id = $1 AND s.deleted_at IS NULL AND s.status = 'active'
         ORDER BY ${order}`,
        [sectionId],
      );
      await manager.update(StudentEnrollment, { section_id: sectionId }, { roll_no: null });
      for (const [index, row] of rows.entries()) {
        await manager.update(StudentEnrollment, Number(row.id), { roll_no: index + 1 });
      }
      return rows.length;
    });
    return { section_id: sectionId, assigned };
  }

  async remove(schoolId: number, id: number): Promise<{ id: number }> {
    await this.find(schoolId, id);
    await this.students.softDelete(id);
    return { id };
  }

  private async find(schoolId: number, id: number): Promise<Student> {
    const student = await this.students.findOneBy({ id, school_id: schoolId });
    if (!student) throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');
    return student;
  }

  private async currentYear(manager: EntityManager, schoolId: number): Promise<AcademicYear> {
    const year = await manager.findOneBy(AcademicYear, yearWhere(schoolId));
    if (!year) throw AppException.badRequest('Set the current academic year in School setup first', 'NO_CURRENT_YEAR');
    return year;
  }

  private async assertClass(manager: EntityManager, schoolId: number, classId: number): Promise<void> {
    if (!(await manager.exists(SchoolClass, { where: { id: classId, school_id: schoolId } }))) {
      throw AppException.notFound('Class not found', 'CLASS_NOT_FOUND');
    }
  }

  private async assertPlacement(
    manager: EntityManager,
    schoolId: number,
    yearId: number,
    classId: number,
    sectionId: number | null,
    rollNo: number | null,
    studentId: number | null,
  ): Promise<void> {
    if (rollNo && !sectionId)
      throw AppException.badRequest('Choose a section before giving a roll number', 'ROLL_NEEDS_SECTION');
    if (!sectionId) return;
    const section = await manager.findOneBy(Section, { id: sectionId, school_id: schoolId });
    if (!section) throw AppException.notFound('Section not found', 'SECTION_NOT_FOUND');
    if (section.class_id !== classId)
      throw AppException.badRequest('This section belongs to another class', 'SECTION_NOT_IN_CLASS');
    if (section.academic_year_id !== yearId) {
      throw AppException.badRequest('This section is not in the current academic year', 'SECTION_NOT_CURRENT');
    }
    const others = { section_id: sectionId, ...(studentId ? { student_id: Not(studentId) } : {}) };
    const filled = await manager.countBy(StudentEnrollment, others);
    if (filled >= section.capacity) {
      throw AppException.conflict(`Section ${section.name} is full (${section.capacity} students)`, 'SECTION_FULL');
    }
    if (rollNo && (await manager.exists(StudentEnrollment, { where: { ...others, roll_no: rollNo } }))) {
      throw AppException.conflict(`Roll number ${rollNo} is already used in this section`, 'ROLL_TAKEN');
    }
  }

  private async nextAdmissionNo(manager: EntityManager, schoolId: number, year: AcademicYear): Promise<string> {
    const school = await manager.findOneByOrFail(School, { id: schoolId });
    const startYear = year.start_date.slice(0, 4);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const value = await this.sequences.next(manager, schoolId, `admission:${startYear}`);
      const candidate = SequencesService.format(school.code, startYear, value);
      if (
        !(await manager.exists(Student, {
          where: { school_id: schoolId, admission_no: candidate, deleted_at: IsNull() },
        }))
      ) {
        return candidate;
      }
    }
    throw AppException.conflict(
      'Could not generate an admission number. Enter one manually.',
      'ADMISSION_NO_EXHAUSTED',
    );
  }

  private async siblingCounts(ids: number[]): Promise<Map<number, number>> {
    if (!ids.length) return new Map();
    const rows: { student_id: number; count: string }[] = await this.dataSource.query(
      `SELECT a.student_id, COUNT(DISTINCT b.student_id) AS count
       FROM student_guardians a
       JOIN student_guardians b ON b.guardian_id = a.guardian_id AND b.student_id <> a.student_id
       JOIN students x ON x.id = b.student_id AND x.deleted_at IS NULL
       WHERE a.student_id = ANY($1)
       GROUP BY a.student_id`,
      [ids],
    );
    return new Map(rows.map((row) => [Number(row.student_id), Number(row.count)]));
  }

  private toListItem(student: ListedStudent, siblingCount: number, today: string): StudentListItemDto {
    const links = (student.guardian_links ?? []).filter((link) => link.guardian && !link.guardian.deleted_at);
    return {
      id: student.id,
      admission_no: student.admission_no,
      emis_number: student.emis_number ?? null,
      first_name: student.first_name,
      last_name: student.last_name,
      full_name: [student.first_name, student.last_name].filter(Boolean).join(' '),
      gender: student.gender,
      dob: student.dob,
      age: yearsBetween(student.dob, today),
      status: student.status,
      house: student.house,
      admission_date: student.admission_date,
      years_in_school: yearsBetween(student.admission_date, today),
      class: student.current_class ? { id: student.current_class.id, name: student.current_class.name } : null,
      section: student.current_section ? { id: student.current_section.id, name: student.current_section.name } : null,
      roll_no: student.current?.roll_no ?? null,
      photo_file_id: student.photo_file_id,
      photo_url: this.files.linkFor(student.photo_file_id),
      guardians: links
        .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
        .map((link) => ({
          id: link.guardian!.id,
          name: link.guardian!.name,
          mobile: link.guardian!.mobile,
          relation: link.relation,
          is_primary: link.is_primary,
        })),
      sibling_count: siblingCount,
    };
  }
}

const SIBLING_EXISTS = `SELECT 1 FROM student_guardians sa
  JOIN student_guardians sb ON sb.guardian_id = sa.guardian_id AND sb.student_id <> sa.student_id
  JOIN students sx ON sx.id = sb.student_id AND sx.deleted_at IS NULL
  WHERE sa.student_id = s.id`;
