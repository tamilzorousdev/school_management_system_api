import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import QRCode from 'qrcode';
import { DataSource, In, MoreThan, Not, Repository } from 'typeorm';
import { AppException } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { FilesService } from '../files/files.service';
import { School } from '../schools/entities/school.entity';
import { SequencesService } from '../schools/sequences.service';
import { QrTokens } from '../security/qr-tokens';
import { AcademicYear } from '../setup/entities/academic-year.entity';
import { SchoolClass } from '../setup/entities/school-class.entity';
import { Section } from '../setup/entities/section.entity';
import { StudentEnrollment } from '../students/entities/student-enrollment.entity';
import { Student } from '../students/entities/student.entity';
import {
  DigitalIdDto,
  IdCardQueryDto,
  PromotionDto,
  PromotionPreviewDto,
  PromotionResultDto,
  QrStudentDto,
  StudentExitDto,
  TransferCertificateDto,
} from './dto/lifecycle.dto';
import { TransferCertificate } from './entities/transfer-certificate.entity';
import { IdCardData, idCardPdf, idCardSheetPdf } from './pdf/id-card.pdf';
import { UploadedIdCardDesign, uploadedIdCardPdf, uploadedIdCardSheetPdf } from './pdf/id-card-uploaded.pdf';
import { parseIdCardLayout } from '../../shared/id-card-layout';
import { tcPdf } from './pdf/tc.pdf';

interface CardRow {
  id: number;
  first_name: string;
  last_name: string | null;
  admission_no: string;
  dob: string;
  blood_group: string | null;
  photo_file_id: number | null;
  card_version: number;
  status: string;
  class_name: string | null;
  section_name: string | null;
  roll_no: number | null;
  guardian_name: string | null;
  guardian_mobile: string | null;
  father_name?: string | null;
  mother_name?: string | null;
  address_line?: string | null;
  city?: string | null;
  pincode?: string | null;
}

const MAX_SHEET_CARDS = 400;

export function fullName(row: { first_name: string; last_name: string | null }): string {
  return [row.first_name, row.last_name].filter(Boolean).join(' ');
}

export function classSection(className: string | null, sectionName: string | null): string | null {
  return className ? [className, sectionName].filter(Boolean).join(' - ') : null;
}

@Injectable()
export class StudentLifecycleService {
  constructor(
    @InjectRepository(Student) private readonly students: Repository<Student>,
    @InjectRepository(TransferCertificate) private readonly certificates: Repository<TransferCertificate>,
    @InjectRepository(AcademicYear) private readonly years: Repository<AcademicYear>,
    private readonly files: FilesService,
    private readonly sequences: SequencesService,
    private readonly qr: QrTokens,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async idCard(schoolId: number, studentId: number, requestedDesign?: string): Promise<{ name: string; pdf: Buffer }> {
    const [card] = await this.cards(schoolId, { studentIds: [studentId] });
    if (!card) throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');
    const school = await this.dataSource.getRepository(School).findOneBy({ id: schoolId });
    const design = requestedDesign || school?.id_card_design || 'design2';
    const uploaded = design === 'custom' && school ? await this.uploadedDesign(school) : null;
    if (uploaded) return { name: card.admission_no, pdf: await uploadedIdCardPdf(uploaded, card) };
    return { name: card.admission_no, pdf: await idCardPdf(card, design === 'custom' ? 'design2' : design) };
  }

  async idCardSheet(schoolId: number, query: IdCardQueryDto): Promise<{ name: string; pdf: Buffer }> {
    if (!query.class_id && !query.section_id) {
      throw AppException.validation([{ field: 'section_id', message: 'Choose a class or a section to print' }]);
    }
    const cards = await this.cards(schoolId, { classId: query.class_id, sectionId: query.section_id });
    if (!cards.length) throw AppException.notFound('No active students in this class', 'NO_STUDENTS');
    if (cards.length > MAX_SHEET_CARDS) {
      throw AppException.badRequest(
        `Print up to ${MAX_SHEET_CARDS} cards at a time. Choose a section.`,
        'TOO_MANY_CARDS',
      );
    }
    const school = await this.dataSource.getRepository(School).findOneBy({ id: schoolId });
    const design = query.design || school?.id_card_design || 'design2';
    const uploaded = design === 'custom' && school ? await this.uploadedDesign(school) : null;
    const label = cards[0].class_section ?? 'class';
    const name = `id-cards-${label.replace(/\s+/g, '')}`;
    if (uploaded) return { name, pdf: await uploadedIdCardSheetPdf(uploaded, cards, `ID cards ${label}`) };
    return { name, pdf: await idCardSheetPdf(cards, `ID cards ${label}`, design === 'custom' ? 'design2' : design) };
  }

  async digitalId(schoolId: number, studentId: number): Promise<DigitalIdDto> {
    const [row] = await this.cardRows(schoolId, { studentIds: [studentId] });
    if (!row) throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');
    const [school, year, photos] = await Promise.all([
      this.dataSource.getRepository(School).findOneByOrFail({ id: schoolId }),
      this.years.findOneBy({ school_id: schoolId, is_current: true }),
      this.files.presentMany([row.photo_file_id]),
    ]);
    return {
      student_id: row.id,
      qr_token: this.qr.student(row.id, row.card_version),
      full_name: fullName(row),
      admission_no: row.admission_no,
      class_section: classSection(row.class_name, row.section_name),
      roll_no: row.roll_no,
      dob: row.dob,
      blood_group: row.blood_group,
      photo_url: row.photo_file_id ? (photos.get(row.photo_file_id)?.url ?? null) : null,
      academic_year: year?.name ?? null,
      valid_till: year?.end_date ?? null,
      school: { id: school.id, name: school.name },
      school_phone: school.phone,
    };
  }

  async reissueCard(schoolId: number, studentId: number): Promise<DigitalIdDto> {
    const student = await this.students.findOneBy({ id: studentId, school_id: schoolId });
    if (!student) throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');
    await this.students.increment({ id: studentId }, 'card_version', 1);
    return this.digitalId(schoolId, studentId);
  }

  async verifyQr(schoolId: number, token: string): Promise<QrStudentDto> {
    const parsed = this.qr.readStudent(token);
    if (!parsed) throw AppException.badRequest('This QR code is not a school ID card', 'QR_INVALID');
    const [row] = await this.cardRows(schoolId, { studentIds: [parsed.student_id] });
    if (!row) throw AppException.notFound('This card belongs to another school', 'QR_OTHER_SCHOOL');
    if (row.card_version !== parsed.version) {
      throw AppException.conflict('This card was replaced. Use the latest ID card.', 'QR_REPLACED');
    }
    const photos = await this.files.presentMany([row.photo_file_id]);
    return {
      student_id: row.id,
      full_name: fullName(row),
      admission_no: row.admission_no,
      class_section: classSection(row.class_name, row.section_name),
      photo_url: row.photo_file_id ? (photos.get(row.photo_file_id)?.url ?? null) : null,
      status: row.status,
    };
  }

  async exit(schoolId: number, studentId: number, dto: StudentExitDto): Promise<TransferCertificateDto> {
    const saved = await this.dataSource.transaction(async (manager) => {
      const student = await manager.findOneBy(Student, { id: studentId, school_id: schoolId });
      if (!student) throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');
      if (student.status !== 'active') {
        throw AppException.conflict(`This student is already ${student.status}`, 'STUDENT_NOT_ACTIVE');
      }
      if (dto.leaving_date < student.admission_date) {
        throw AppException.validation([
          { field: 'leaving_date', message: 'Leaving date cannot be before the admission date' },
        ]);
      }
      const year = await manager.findOneBy(AcademicYear, { school_id: schoolId, is_current: true });
      const enrollment = year
        ? await manager.findOne(StudentEnrollment, {
            where: { student_id: studentId, academic_year_id: year.id },
            relations: { school_class: true, section: true },
          })
        : null;
      const issuedOn = todayIn(this.app.timeZone);
      const school = await manager.findOneByOrFail(School, { id: schoolId });
      const startYear = (year?.start_date ?? issuedOn).slice(0, 4);
      let tcNo = '';
      for (let attempt = 0; attempt < 50 && !tcNo; attempt += 1) {
        const candidate = SequencesService.format(
          `${school.code}-TC`,
          startYear,
          await this.sequences.next(manager, schoolId, `tc:${startYear}`),
        );
        if (!(await manager.exists(TransferCertificate, { where: { school_id: schoolId, tc_no: candidate } })))
          tcNo = candidate;
      }
      await manager.update(Student, studentId, { status: dto.exit_type, left_on: dto.leaving_date });
      if (enrollment) await manager.update(StudentEnrollment, enrollment.id, { status: 'left', roll_no: null });
      return manager.save(
        manager.create(TransferCertificate, {
          school_id: schoolId,
          student_id: studentId,
          tc_no: tcNo,
          exit_type: dto.exit_type,
          leaving_date: dto.leaving_date,
          issued_on: issuedOn,
          reason: dto.reason,
          conduct: dto.conduct ?? 'Good',
          promotion_eligible: dto.promotion_eligible ?? true,
          remarks: dto.remarks ?? null,
          academic_year_name: year?.name ?? null,
          class_name: enrollment?.school_class?.name ?? null,
          section_name: enrollment?.section?.name ?? null,
        }),
      );
    });
    return this.presentCertificate(saved);
  }

  async certificate(schoolId: number, studentId: number): Promise<TransferCertificateDto> {
    return this.presentCertificate(await this.findCertificate(schoolId, studentId));
  }

  async certificatePdf(schoolId: number, studentId: number): Promise<{ name: string; pdf: Buffer }> {
    const tc = await this.findCertificate(schoolId, studentId);
    const student = await this.students.findOneByOrFail({ id: studentId });
    const school = await this.dataSource.getRepository(School).findOneByOrFail({ id: schoolId });
    const [guardian] = await this.dataSource.query(
      `SELECT g.name FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
       WHERE sg.student_id = $1 ORDER BY sg.is_primary DESC, sg.id LIMIT 1`,
      [studentId],
    );
    const pdf = await tcPdf({
      school_name: school.name,
      school_address: [school.address, school.city, school.state, school.pincode].filter(Boolean).join(', ') || null,
      school_phone: school.phone,
      school_email: school.email,
      school_board: school.board,
      school_logo: await this.files.readImage(school.logo_file_id),
      tc_no: tc.tc_no,
      issued_on: tc.issued_on,
      student_name: fullName(student),
      admission_no: student.admission_no,
      gender: student.gender,
      dob: student.dob,
      identification_marks: student.identification_marks,
      guardian_name: guardian?.name ?? null,
      admission_date: student.admission_date,
      class_name: tc.class_name,
      section_name: tc.section_name,
      academic_year: tc.academic_year_name,
      promotion_eligible: tc.promotion_eligible,
      leaving_date: tc.leaving_date,
      reason: tc.reason,
      conduct: tc.conduct,
      remarks: tc.remarks,
    });
    return { name: tc.tc_no.replace(/\//g, '-'), pdf };
  }

  async promotionPreview(schoolId: number, classId: number): Promise<PromotionPreviewDto> {
    const { current, next } = await this.promotionYears(schoolId);
    const classes = await this.dataSource.getRepository(SchoolClass).find({
      where: { school_id: schoolId },
      order: { grade_level: 'ASC' },
    });
    const fromClass = classes.find((item) => item.id === classId);
    if (!fromClass) throw AppException.notFound('Class not found', 'CLASS_NOT_FOUND');
    const suggested = classes.find((item) => item.grade_level > fromClass.grade_level) ?? null;
    const [rows, sections] = await Promise.all([
      this.dataSource.query(
        `SELECT s.id, s.first_name, s.last_name, s.admission_no, sec.name AS section_name, e.roll_no,
                EXISTS (SELECT 1 FROM student_enrollments n WHERE n.student_id = s.id AND n.academic_year_id = $3) AS already_moved
         FROM student_enrollments e
         JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL AND s.status = 'active'
         LEFT JOIN sections sec ON sec.id = e.section_id
         WHERE e.school_id = $1 AND e.academic_year_id = $2 AND e.class_id = $4
         ORDER BY sec.name NULLS LAST, e.roll_no NULLS LAST, s.first_name`,
        [schoolId, current.id, next.id, classId],
      ) as Promise<
        (Pick<CardRow, 'id' | 'first_name' | 'last_name' | 'admission_no' | 'section_name' | 'roll_no'> & {
          already_moved: boolean;
        })[]
      >,
      suggested
        ? this.dataSource.getRepository(Section).find({
            where: { school_id: schoolId, class_id: suggested.id, academic_year_id: next.id },
            order: { name: 'ASC' },
          })
        : Promise.resolve([] as Section[]),
    ]);
    return {
      from_year: { id: current.id, name: current.name },
      to_year: { id: next.id, name: next.name },
      from_class: { id: fromClass.id, name: fromClass.name },
      suggested_class: suggested ? { id: suggested.id, name: suggested.name } : null,
      to_sections: sections.map((section) => ({ id: section.id, name: section.name })),
      students: rows.map((row) => ({
        student_id: Number(row.id),
        full_name: fullName(row),
        admission_no: row.admission_no,
        section_name: row.section_name,
        roll_no: row.roll_no,
        already_moved: Boolean(row.already_moved),
      })),
    };
  }

  async promote(schoolId: number, dto: PromotionDto): Promise<PromotionResultDto> {
    const { current, next } = await this.promotionYears(schoolId);
    const detained = new Set(dto.detained_ids ?? []);
    return this.dataSource.transaction(async (manager) => {
      const classes = await manager.findBy(SchoolClass, {
        school_id: schoolId,
        id: In([dto.from_class_id, dto.to_class_id]),
      });
      if (classes.length !== new Set([dto.from_class_id, dto.to_class_id]).size) {
        throw AppException.notFound('Class not found', 'CLASS_NOT_FOUND');
      }
      const section = dto.to_section_id
        ? await manager.findOneBy(Section, { id: dto.to_section_id, school_id: schoolId })
        : null;
      if (dto.to_section_id && !section) throw AppException.notFound('Section not found', 'SECTION_NOT_FOUND');
      if (section && (section.class_id !== dto.to_class_id || section.academic_year_id !== next.id)) {
        throw AppException.badRequest(`Choose a section of the next class in ${next.name}`, 'SECTION_NOT_IN_CLASS');
      }

      const enrollments = await manager.find(StudentEnrollment, {
        where: {
          school_id: schoolId,
          academic_year_id: current.id,
          class_id: dto.from_class_id,
          status: Not('left'),
          ...(dto.student_ids?.length ? { student_id: In(dto.student_ids) } : {}),
        },
        relations: { student: true },
      });
      const eligible = enrollments.filter(
        (item) => item.student && !item.student.deleted_at && item.student.status === 'active',
      );
      const moved = new Set(
        (
          await manager.findBy(StudentEnrollment, {
            academic_year_id: next.id,
            student_id: In(eligible.map((item) => item.student_id).concat(0)),
          })
        ).map((item) => item.student_id),
      );
      const toPromote = eligible.filter((item) => !moved.has(item.student_id) && !detained.has(item.student_id));
      if (section) {
        const filled = await manager.countBy(StudentEnrollment, { section_id: section.id });
        if (filled + toPromote.length > section.capacity) {
          throw AppException.conflict(
            `Section ${section.name} has room for ${Math.max(0, section.capacity - filled)} more students`,
            'SECTION_FULL',
          );
        }
      }

      let promoted = 0;
      let held = 0;
      for (const enrollment of eligible) {
        if (moved.has(enrollment.student_id)) continue;
        const repeat = detained.has(enrollment.student_id);
        await manager.update(StudentEnrollment, enrollment.id, { status: repeat ? 'detained' : 'promoted' });
        await manager.insert(StudentEnrollment, {
          school_id: schoolId,
          student_id: enrollment.student_id,
          academic_year_id: next.id,
          class_id: repeat ? dto.from_class_id : dto.to_class_id,
          section_id: repeat ? null : (section?.id ?? null),
          roll_no: null,
          status: 'studying',
        });
        if (repeat) held += 1;
        else promoted += 1;
      }
      return { promoted, detained: held, skipped: moved.size };
    });
  }

  private async promotionYears(schoolId: number): Promise<{ current: AcademicYear; next: AcademicYear }> {
    const current = await this.years.findOneBy({ school_id: schoolId, is_current: true });
    if (!current)
      throw AppException.badRequest('Set the current academic year in School setup first', 'NO_CURRENT_YEAR');
    const next = await this.years.findOne({
      where: { school_id: schoolId, start_date: MoreThan(current.start_date) },
      order: { start_date: 'ASC' },
    });
    if (!next) {
      throw AppException.badRequest('Add next academic year in School setup before promoting', 'NO_NEXT_YEAR');
    }
    return { current, next };
  }

  private async findCertificate(schoolId: number, studentId: number): Promise<TransferCertificate> {
    const tc = await this.certificates.findOne({
      where: { school_id: schoolId, student_id: studentId },
      order: { created_at: 'DESC' },
    });
    if (!tc) throw AppException.notFound('No transfer certificate for this student yet', 'TC_NOT_FOUND');
    return tc;
  }

  private presentCertificate(tc: TransferCertificate): TransferCertificateDto {
    return {
      id: tc.id,
      tc_no: tc.tc_no,
      exit_type: tc.exit_type,
      leaving_date: tc.leaving_date,
      issued_on: tc.issued_on,
      reason: tc.reason,
      conduct: tc.conduct,
      class_name: tc.class_name,
      section_name: tc.section_name,
      academic_year_name: tc.academic_year_name,
      promotion_eligible: tc.promotion_eligible,
      remarks: tc.remarks,
    };
  }

  private async cardRows(
    schoolId: number,
    filter: { studentIds?: number[]; classId?: number; sectionId?: number },
  ): Promise<CardRow[]> {
    const conditions = ['s.school_id = $1', 's.deleted_at IS NULL'];
    const params: unknown[] = [schoolId];
    if (filter.studentIds) {
      params.push(filter.studentIds);
      conditions.push(`s.id = ANY($${params.length})`);
    } else {
      conditions.push(`s.status = 'active'`);
    }
    if (filter.classId) {
      params.push(filter.classId);
      conditions.push(`e.class_id = $${params.length}`);
    }
    if (filter.sectionId) {
      params.push(filter.sectionId);
      conditions.push(`e.section_id = $${params.length}`);
    }
    const rows: CardRow[] = await this.dataSource.query(
      `SELECT s.id, s.first_name, s.last_name, s.admission_no, to_char(s.dob, 'YYYY-MM-DD') AS dob, s.blood_group,
              s.photo_file_id, s.card_version, s.status, c.name AS class_name, sec.name AS section_name, e.roll_no,
              g.name AS guardian_name, g.mobile AS guardian_mobile,
              f.name AS father_name, m.name AS mother_name,
              s.address_line, s.city, s.pincode
       FROM students s
       LEFT JOIN academic_years y ON y.school_id = s.school_id AND y.is_current = true AND y.deleted_at IS NULL
       LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = y.id
       LEFT JOIN classes c ON c.id = e.class_id
       LEFT JOIN sections sec ON sec.id = e.section_id
       LEFT JOIN LATERAL (
         SELECT gg.name, gg.mobile FROM student_guardians sg JOIN guardians gg ON gg.id = sg.guardian_id AND gg.deleted_at IS NULL
         WHERE sg.student_id = s.id ORDER BY sg.is_primary DESC, sg.id LIMIT 1
       ) g ON true
       LEFT JOIN LATERAL (
         SELECT gg.name FROM student_guardians sg JOIN guardians gg ON gg.id = sg.guardian_id AND gg.deleted_at IS NULL
         WHERE sg.student_id = s.id AND sg.relation = 'father' ORDER BY sg.id LIMIT 1
       ) f ON true
       LEFT JOIN LATERAL (
         SELECT gg.name FROM student_guardians sg JOIN guardians gg ON gg.id = sg.guardian_id AND gg.deleted_at IS NULL
         WHERE sg.student_id = s.id AND sg.relation = 'mother' ORDER BY sg.id LIMIT 1
       ) m ON true
       WHERE ${conditions.join(' AND ')}
       ORDER BY sec.name NULLS LAST, e.roll_no NULLS LAST, s.first_name`,
      params,
    );
    return rows.map((row) => ({ ...row, id: Number(row.id), card_version: Number(row.card_version) }));
  }

  private async uploadedDesign(school: School): Promise<UploadedIdCardDesign | null> {
    const [front, back] = await Promise.all([
      this.files.readImage(school.id_card_front_file_id, { background: '#FFFFFF' }),
      this.files.readImage(school.id_card_back_file_id, { background: '#FFFFFF' }),
    ]);
    return front ? { front, back, layout: parseIdCardLayout(school.id_card_layout) ?? { front: [], back: [] } } : null;
  }

  private async cards(
    schoolId: number,
    filter: { studentIds?: number[]; classId?: number; sectionId?: number },
  ): Promise<(IdCardData & { admission_no: string })[]> {
    const rows = await this.cardRows(schoolId, filter);
    if (!rows.length) return [];
    const [school, year] = await Promise.all([
      this.dataSource.getRepository(School).findOneByOrFail({ id: schoolId }),
      this.years.findOneBy({ school_id: schoolId, is_current: true }),
    ]);
    const logo = await this.files.readImage(school.logo_file_id);
    const cards: (IdCardData & { admission_no: string })[] = [];
    for (const row of rows) {
      cards.push({
        school_name: school.name,
        school_code: school.code,
        school_city: school.city,
        school_phone: school.phone,
        school_address: [school.address, school.city, school.state, school.pincode].filter(Boolean).join(', ') || null,
        school_email: school.email,
        school_logo: logo,
        academic_year: year?.name ?? null,
        name: fullName(row),
        admission_no: row.admission_no,
        class_section: classSection(row.class_name, row.section_name),
        roll_no: row.roll_no,
        dob: row.dob,
        blood_group: row.blood_group,
        guardian_name: row.guardian_name,
        guardian_mobile: row.guardian_mobile,
        father_name: row.father_name ?? null,
        mother_name: row.mother_name ?? null,
        address: [row.address_line, row.city, row.pincode].filter(Boolean).join(', ') || null,
        photo: await this.files.readImage(row.photo_file_id),
        qr: await QRCode.toBuffer(this.qr.student(row.id, row.card_version), {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 320,
          color: { dark: '#E65100', light: '#ffffff' },
        }),
      });
    }
    return cards;
  }
}
