import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AppException, AuthUser } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { VerifyDocumentDto } from '../../shared/verification';
import { FilesService } from '../files/files.service';
import { Student } from '../students/entities/student.entity';
import { User } from '../users/entities/user.entity';
import {
  BehaviourInputDto,
  BehaviourNoteDto,
  HealthDto,
  HealthInputDto,
  PersonNameDto,
  RecordCountsDto,
  StudentDocumentDto,
  StudentDocumentInputDto,
  UpdateBehaviourDto,
  UpdateStudentDocumentDto,
  UpdateVaccinationDto,
  VaccinationDto,
  VaccinationInputDto,
} from './dto/records.dto';
import { BehaviourNote } from './entities/behaviour-note.entity';
import { StudentDocument, StudentDocumentType } from './entities/student-document.entity';
import { StudentHealth } from './entities/student-health.entity';
import { Vaccination } from './entities/vaccination.entity';

export const DOCUMENT_TITLES: Record<StudentDocumentType, string> = {
  birth_certificate: 'Birth certificate',
  aadhaar: 'Aadhaar card',
  transfer_certificate: 'Transfer certificate',
  previous_marksheet: 'Previous mark sheet',
  community_certificate: 'Community certificate',
  medical_certificate: 'Medical certificate',
  photo: 'Photo',
  other: 'Document',
};

export function bmi(heightCm: number | null, weightKg: number | null): number | null {
  if (!heightCm || !weightKg) return null;
  const metres = heightCm / 100;
  return Math.round((weightKg / (metres * metres)) * 10) / 10;
}

export function isOverdue(vaccination: Pick<Vaccination, 'given_on' | 'due_on'>, today: string): boolean {
  return !vaccination.given_on && Boolean(vaccination.due_on) && vaccination.due_on! <= today;
}

interface Audience {
  parent?: boolean;
}

@Injectable()
export class StudentRecordsService {
  constructor(
    @InjectRepository(Student) private readonly students: Repository<Student>,
    @InjectRepository(StudentDocument) private readonly documents: Repository<StudentDocument>,
    @InjectRepository(StudentHealth) private readonly health: Repository<StudentHealth>,
    @InjectRepository(Vaccination) private readonly vaccinations: Repository<Vaccination>,
    @InjectRepository(BehaviourNote) private readonly notes: Repository<BehaviourNote>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly files: FilesService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async counts(schoolId: number, studentId: number): Promise<RecordCountsDto> {
    await this.assertStudent(schoolId, studentId);
    const today = todayIn(this.app.timeZone);
    const [documents, pending, notes, concerns, vaccinations] = await Promise.all([
      this.documents.countBy({ student_id: studentId }),
      this.documents.countBy({ student_id: studentId, status: 'pending' }),
      this.notes.countBy({ student_id: studentId }),
      this.notes.countBy({ student_id: studentId, category: In(['concern', 'incident', 'disciplinary']) }),
      this.vaccinations.findBy({ student_id: studentId }),
    ]);
    return {
      documents,
      documents_pending: pending,
      behaviour_notes: notes,
      concerns,
      vaccinations_overdue: vaccinations.filter((item) => isOverdue(item, today)).length,
    };
  }

  async listDocuments(schoolId: number, studentId: number, audience: Audience = {}): Promise<StudentDocumentDto[]> {
    await this.assertStudent(schoolId, studentId);
    const rows = await this.documents.find({
      where: { student_id: studentId, ...(audience.parent ? { visible_to_parent: true } : {}) },
      order: { created_at: 'DESC' },
    });
    return this.presentDocuments(rows);
  }

  async addDocument(schoolId: number, studentId: number, dto: StudentDocumentInputDto): Promise<StudentDocumentDto> {
    await this.assertStudent(schoolId, studentId);
    await this.files.assertAttachable(dto.file_id, schoolId);
    const saved = await this.documents.save(
      this.documents.create({
        school_id: schoolId,
        student_id: studentId,
        type: dto.type,
        title: dto.title ?? DOCUMENT_TITLES[dto.type],
        file_id: dto.file_id,
        visible_to_parent: dto.visible_to_parent ?? true,
        status: 'pending',
      }),
    );
    return (await this.presentDocuments([saved]))[0];
  }

  async updateDocument(
    schoolId: number,
    studentId: number,
    documentId: number,
    dto: UpdateStudentDocumentDto,
  ): Promise<StudentDocumentDto> {
    const document = await this.findDocument(schoolId, studentId, documentId);
    if (dto.file_id && dto.file_id !== document.file_id) {
      await this.files.assertAttachable(dto.file_id, schoolId);
      Object.assign(document, { status: 'pending', remarks: null, verified_by: null, verified_at: null });
    }
    Object.assign(document, dto);
    return (await this.presentDocuments([await this.documents.save(document)]))[0];
  }

  async verifyDocument(
    schoolId: number,
    studentId: number,
    documentId: number,
    dto: VerifyDocumentDto,
    actor: AuthUser,
  ): Promise<StudentDocumentDto> {
    const document = await this.findDocument(schoolId, studentId, documentId);
    Object.assign(document, {
      status: dto.status,
      remarks: dto.remarks ?? null,
      verified_by: actor.id,
      verified_at: new Date(),
    });
    return (await this.presentDocuments([await this.documents.save(document)]))[0];
  }

  async removeDocument(schoolId: number, studentId: number, documentId: number): Promise<{ id: number }> {
    await this.findDocument(schoolId, studentId, documentId);
    await this.documents.softDelete(documentId);
    return { id: documentId };
  }

  async getHealth(schoolId: number, studentId: number): Promise<HealthDto> {
    const student = await this.assertStudent(schoolId, studentId);
    const [record, vaccinations] = await Promise.all([
      this.health.findOneBy({ student_id: studentId }),
      this.vaccinations.find({ where: { student_id: studentId }, order: { given_on: 'DESC', created_at: 'DESC' } }),
    ]);
    const height = record?.height_cm ? Number(record.height_cm) : null;
    const weight = record?.weight_kg ? Number(record.weight_kg) : null;
    const today = todayIn(this.app.timeZone);
    return {
      blood_group: student.blood_group,
      height_cm: height,
      weight_kg: weight,
      bmi: bmi(height, weight),
      allergies: record?.allergies ?? null,
      conditions: record?.conditions ?? null,
      medications: record?.medications ?? null,
      vision: record?.vision ?? null,
      doctor_name: record?.doctor_name ?? null,
      doctor_mobile: record?.doctor_mobile ?? null,
      notes: record?.notes ?? null,
      last_checkup_on: record?.last_checkup_on ?? null,
      updated_at: record?.updated_at ?? null,
      vaccinations: vaccinations.map((item) => this.presentVaccination(item, today)),
    };
  }

  async saveHealth(schoolId: number, studentId: number, dto: HealthInputDto, actor: AuthUser): Promise<HealthDto> {
    await this.assertStudent(schoolId, studentId);
    const existing = await this.health.findOneBy({ student_id: studentId });
    const { height_cm, weight_kg, ...rest } = dto;
    const decimal = (value: number | null) => (value === null ? null : String(value));
    const values: Partial<StudentHealth> = { ...rest };
    if (height_cm !== undefined) values.height_cm = decimal(height_cm);
    if (weight_kg !== undefined) values.weight_kg = decimal(weight_kg);
    await this.health.save(
      this.health.merge(existing ?? this.health.create({ school_id: schoolId, student_id: studentId }), values, {
        updated_by: actor.id,
      }),
    );
    return this.getHealth(schoolId, studentId);
  }

  async addVaccination(schoolId: number, studentId: number, dto: VaccinationInputDto): Promise<HealthDto> {
    await this.assertStudent(schoolId, studentId);
    await this.vaccinations.save(this.vaccinations.create({ ...dto, school_id: schoolId, student_id: studentId }));
    return this.getHealth(schoolId, studentId);
  }

  async updateVaccination(
    schoolId: number,
    studentId: number,
    vaccinationId: number,
    dto: UpdateVaccinationDto,
  ): Promise<HealthDto> {
    const item = await this.vaccinations.findOneBy({ id: vaccinationId, student_id: studentId, school_id: schoolId });
    if (!item) throw AppException.notFound('Vaccination entry not found', 'VACCINATION_NOT_FOUND');
    await this.vaccinations.save(this.vaccinations.merge(item, dto));
    return this.getHealth(schoolId, studentId);
  }

  async removeVaccination(schoolId: number, studentId: number, vaccinationId: number): Promise<HealthDto> {
    const item = await this.vaccinations.findOneBy({ id: vaccinationId, student_id: studentId, school_id: schoolId });
    if (!item) throw AppException.notFound('Vaccination entry not found', 'VACCINATION_NOT_FOUND');
    await this.vaccinations.softDelete(vaccinationId);
    return this.getHealth(schoolId, studentId);
  }

  async listBehaviour(schoolId: number, studentId: number, audience: Audience = {}): Promise<BehaviourNoteDto[]> {
    await this.assertStudent(schoolId, studentId);
    const rows = await this.notes.find({
      where: { student_id: studentId, ...(audience.parent ? { visible_to_parent: true } : {}) },
      order: { noted_on: 'DESC', created_at: 'DESC' },
    });
    return this.presentNotes(rows);
  }

  async addBehaviour(schoolId: number, studentId: number, dto: BehaviourInputDto): Promise<BehaviourNoteDto> {
    await this.assertStudent(schoolId, studentId);
    const saved = await this.notes.save(
      this.notes.create({
        school_id: schoolId,
        student_id: studentId,
        category: dto.category,
        title: dto.title,
        details: dto.details ?? null,
        action_taken: dto.action_taken ?? null,
        noted_on: dto.noted_on ?? todayIn(this.app.timeZone),
        visible_to_parent: dto.visible_to_parent ?? true,
      }),
    );
    return (await this.presentNotes([saved]))[0];
  }

  async updateBehaviour(
    schoolId: number,
    studentId: number,
    noteId: number,
    dto: UpdateBehaviourDto,
  ): Promise<BehaviourNoteDto> {
    const note = await this.findNote(schoolId, studentId, noteId);
    return (await this.presentNotes([await this.notes.save(this.notes.merge(note, dto))]))[0];
  }

  async removeBehaviour(schoolId: number, studentId: number, noteId: number): Promise<{ id: number }> {
    await this.findNote(schoolId, studentId, noteId);
    await this.notes.softDelete(noteId);
    return { id: noteId };
  }

  private async assertStudent(schoolId: number, studentId: number): Promise<Student> {
    const student = await this.students.findOneBy({ id: studentId, school_id: schoolId });
    if (!student) throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');
    return student;
  }

  private async findDocument(schoolId: number, studentId: number, documentId: number): Promise<StudentDocument> {
    const document = await this.documents.findOneBy({ id: documentId, student_id: studentId, school_id: schoolId });
    if (!document) throw AppException.notFound('Document not found', 'DOCUMENT_NOT_FOUND');
    return document;
  }

  private async findNote(schoolId: number, studentId: number, noteId: number): Promise<BehaviourNote> {
    const note = await this.notes.findOneBy({ id: noteId, student_id: studentId, school_id: schoolId });
    if (!note) throw AppException.notFound('Behaviour note not found', 'BEHAVIOUR_NOTE_NOT_FOUND');
    return note;
  }

  private async names(ids: (number | null)[]): Promise<Map<number, PersonNameDto>> {
    const wanted = [...new Set(ids.filter((id): id is number => typeof id === 'number'))];
    if (!wanted.length) return new Map();
    const rows = await this.users.find({
      where: { id: In(wanted) },
      withDeleted: true,
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [row.id, { id: row.id, name: row.name }]));
  }

  private async presentDocuments(rows: StudentDocument[]): Promise<StudentDocumentDto[]> {
    const [files, people] = await Promise.all([
      this.files.presentMany(rows.map((row) => row.file_id)),
      this.names(rows.map((row) => row.verified_by)),
    ]);
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      status: row.status,
      remarks: row.remarks,
      visible_to_parent: row.visible_to_parent,
      verified_by: row.verified_by ? (people.get(row.verified_by) ?? null) : null,
      verified_at: row.verified_at,
      file: files.get(row.file_id) ?? null,
      created_at: row.created_at,
    }));
  }

  private async presentNotes(rows: BehaviourNote[]): Promise<BehaviourNoteDto[]> {
    const people = await this.names(rows.map((row) => row.created_by));
    return rows.map((row) => ({
      id: row.id,
      noted_on: row.noted_on,
      category: row.category,
      title: row.title,
      details: row.details,
      action_taken: row.action_taken,
      visible_to_parent: row.visible_to_parent,
      recorded_by: row.created_by ? (people.get(row.created_by) ?? null) : null,
      created_at: row.created_at,
    }));
  }

  private presentVaccination(item: Vaccination, today: string): VaccinationDto {
    return {
      id: item.id,
      vaccine: item.vaccine,
      dose: item.dose,
      given_on: item.given_on,
      due_on: item.due_on,
      overdue: isOverdue(item, today),
      notes: item.notes,
    };
  }
}
