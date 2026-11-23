import { Injectable } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { AppException } from '@app/common';
import { SequencesService } from '../schools/sequences.service';
import { gradeFor } from '../exams/exam-results';
import { studentResults } from '../student-lifecycle/promotion-results';
import { Student } from '../students/entities/student.entity';
import { StudentEnrollment } from '../students/entities/student-enrollment.entity';
import { Alumni, AlumniExitType, AlumniSource } from './entities/alumni.entity';
import {
  AlumniAcademicHistory,
  AlumniTimeline,
  FieldChanges,
  HistoryResult,
  TimelineAction,
} from './entities/alumni-records.entity';
import { alumniNumber, batchYearOf, finalGradeLevel, fullName } from './alumni.logic';
import { PassOutPreviewDto, PassOutResultDto } from './dto/alumni.dto';

export interface Actor {
  id: number | null;
  name: string | null;
}

export interface HistoryInput {
  academic_year_name: string;
  class_name: string;
  section_name?: string | null;
  roll_no?: number | null;
  result?: HistoryResult | null;
  percent?: number | null;
  grade?: string | null;
}

interface YearRow {
  id: number;
  name: string;
  end_date: string;
}

interface CandidateRow {
  student_id: number;
  first_name: string;
  last_name: string | null;
  admission_no: string;
  student_status: string;
  section_name: string | null;
  enrollment_status: string;
  already: boolean;
}

interface Snapshot {
  history: (HistoryInput & { academic_year_id: number })[];
  final: { percent: number | null; grade: string | null; result: 'pass' | 'fail' | null };
}

const oneDecimal = (value: number) => Math.round(value * 10) / 10;
const percentText = (value: number | null | undefined) =>
  value === null || value === undefined ? null : String(value);

@Injectable()
export class AlumniRecordsService {
  constructor(private readonly sequences: SequencesService) {}

  async preview(manager: EntityManager, schoolId: number, yearId: number): Promise<PassOutPreviewDto> {
    const year = await this.year(manager, schoolId, yearId);
    const finalClass = await this.finalClass(manager, schoolId);
    if (!finalClass) {
      return {
        academic_year: { id: year.id, name: year.name },
        final_class: null,
        will_convert: 0,
        detained: 0,
        already_alumni: 0,
        students: [],
      };
    }
    const rows = await this.candidates(manager, schoolId, year.id, finalClass.id);
    const eligible = rows.filter((row) => this.eligible(row));
    const ids = eligible.map((row) => row.student_id);
    const snapshots = await this.snapshots(manager, schoolId, ids);
    const dues = await this.dues(manager, schoolId, ids);
    return {
      academic_year: { id: year.id, name: year.name },
      final_class: { id: finalClass.id, name: finalClass.name },
      will_convert: eligible.length,
      detained: rows.filter((row) => row.enrollment_status === 'detained').length,
      already_alumni: rows.filter((row) => row.already).length,
      students: eligible.map((row) => ({
        student_id: row.student_id,
        full_name: fullName(row.first_name, row.last_name),
        admission_no: row.admission_no,
        section_name: row.section_name,
        percent: snapshots.get(row.student_id)?.final.percent ?? null,
        fee_due: dues.get(row.student_id) ?? 0,
      })),
    };
  }

  async passOut(manager: EntityManager, schoolId: number, yearId: number, actorId: number): Promise<PassOutResultDto> {
    const year = await this.year(manager, schoolId, yearId);
    const batchYear = batchYearOf(year.end_date);
    const finalClass = await this.finalClass(manager, schoolId);
    if (!finalClass) return { created: 0, batch_year: batchYear };

    const rows = (await this.candidates(manager, schoolId, year.id, finalClass.id)).filter((row) => this.eligible(row));
    if (!rows.length) return { created: 0, batch_year: batchYear };

    const ids = rows.map((row) => row.student_id);
    const students = await manager.findBy(Student, { id: In(ids), school_id: schoolId });
    const snapshots = await this.snapshots(manager, schoolId, ids);
    const contacts = await this.guardianContacts(manager, ids);
    const actor = await this.actor(manager, actorId);
    const byId = new Map(students.map((student) => [student.id, student]));

    for (const row of rows) {
      const student = byId.get(row.student_id);
      if (!student) continue;
      const snapshot = snapshots.get(student.id);
      const contact = contacts.get(student.id);
      const history = (snapshot?.history ?? []).map((item) =>
        item.academic_year_id === year.id ? { ...item, result: 'completed' as const } : item,
      );
      await this.create(
        manager,
        schoolId,
        {
          ...this.fromStudent(student),
          source: 'pass_out',
          exit_type: 'graduated',
          batch_year: batchYear,
          left_on: year.end_date,
          final_academic_year_id: year.id,
          final_academic_year_name: year.name,
          final_class_name: finalClass.name,
          final_section_name: row.section_name,
          final_percent: percentText(snapshot?.final.percent),
          final_grade: snapshot?.final.grade ?? null,
          final_result: snapshot?.final.result ?? null,
          mobile: contact?.mobile ?? null,
          email: contact?.email ?? null,
          address_line: student.address_line ?? contact?.address_line ?? null,
          city: student.city ?? contact?.city ?? null,
          pincode: student.pincode ?? contact?.pincode ?? null,
        },
        history,
        'passed_out',
        actor,
        `Passed out of ${finalClass.name} at the close of ${year.name}`,
      );
      await manager.update(Student, student.id, { status: 'alumni', left_on: year.end_date });
      await manager.update(
        StudentEnrollment,
        { student_id: student.id, academic_year_id: year.id },
        { status: 'completed', roll_no: null },
      );
    }
    return { created: rows.length, batch_year: batchYear };
  }

  async convert(manager: EntityManager, schoolId: number, studentId: number, actor: Actor): Promise<number> {
    const student = await manager.findOneBy(Student, { id: studentId, school_id: schoolId });
    if (!student) throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');
    if (student.status === 'active') {
      throw AppException.conflict(
        'This student is still studying. Students become alumni when they leave with a TC or pass out of the final class.',
        'STUDENT_STILL_ACTIVE',
      );
    }
    if (await manager.exists(Alumni, { where: { school_id: schoolId, student_id: studentId } })) {
      throw AppException.conflict('This student already has an alumni record', 'ALUMNI_EXISTS');
    }
    const [tc] = (await manager.query(
      `SELECT tc_no, exit_type, leaving_date::text AS leaving_date, academic_year_name, class_name, section_name
       FROM transfer_certificates
       WHERE school_id = $1 AND student_id = $2 AND deleted_at IS NULL
       ORDER BY issued_on DESC, id DESC LIMIT 1`,
      [schoolId, studentId],
    )) as {
      tc_no: string;
      exit_type: string;
      leaving_date: string;
      academic_year_name: string | null;
      class_name: string | null;
      section_name: string | null;
    }[];
    const leftOn = tc?.leaving_date ?? student.left_on;
    if (!leftOn) {
      throw AppException.badRequest('This student has no leaving date or transfer certificate', 'NO_LEAVING_DATE');
    }
    const snapshots = await this.snapshots(manager, schoolId, [studentId]);
    const contacts = await this.guardianContacts(manager, [studentId]);
    const snapshot = snapshots.get(studentId);
    const contact = contacts.get(studentId);
    const last = snapshot?.history[snapshot.history.length - 1];
    const exitType: AlumniExitType =
      student.status === 'alumni' ? 'graduated' : tc?.exit_type === 'transferred' ? 'transferred' : 'withdrawn';
    return this.create(
      manager,
      schoolId,
      {
        ...this.fromStudent(student),
        source: 'converted',
        exit_type: exitType,
        batch_year: batchYearOf(leftOn),
        left_on: leftOn,
        final_academic_year_id: last?.academic_year_id ?? null,
        final_academic_year_name: tc?.academic_year_name ?? last?.academic_year_name ?? null,
        final_class_name: tc?.class_name ?? last?.class_name ?? null,
        final_section_name: tc?.section_name ?? last?.section_name ?? null,
        final_percent: percentText(snapshot?.final.percent),
        final_grade: snapshot?.final.grade ?? null,
        final_result: snapshot?.final.result ?? null,
        tc_no: tc?.tc_no ?? null,
        mobile: contact?.mobile ?? null,
        email: contact?.email ?? null,
        address_line: student.address_line ?? contact?.address_line ?? null,
        city: student.city ?? contact?.city ?? null,
        pincode: student.pincode ?? contact?.pincode ?? null,
      },
      snapshot?.history ?? [],
      'converted',
      actor,
      tc ? `Converted from transfer certificate ${tc.tc_no}` : 'Converted from student record',
    );
  }

  async create(
    manager: EntityManager,
    schoolId: number,
    data: Partial<Alumni> & { source: AlumniSource; batch_year: number; first_name: string },
    history: HistoryInput[],
    action: TimelineAction,
    actor: Actor,
    note: string | null = null,
    historySource: 'system' | 'manual' = 'system',
  ): Promise<number> {
    const alumni_no = await this.nextNumber(manager, schoolId, data.batch_year);
    const saved = await manager.save(
      manager.create(Alumni, {
        ...data,
        school_id: schoolId,
        alumni_no,
        created_by: actor.id,
        status: 'active',
      }),
    );
    await this.writeHistory(manager, schoolId, saved.id, history, historySource);
    await this.log(manager, schoolId, saved.id, action, actor, null, note);
    return saved.id;
  }

  async writeHistory(
    manager: EntityManager,
    schoolId: number,
    alumniId: number,
    rows: HistoryInput[],
    source: 'system' | 'manual',
    offset = 0,
  ): Promise<void> {
    if (!rows.length) return;
    await manager.insert(
      AlumniAcademicHistory,
      rows.map((row, index) => ({
        school_id: schoolId,
        alumni_id: alumniId,
        academic_year_name: row.academic_year_name,
        class_name: row.class_name,
        section_name: row.section_name ?? null,
        roll_no: row.roll_no ?? null,
        result: row.result ?? null,
        percent: row.percent === null || row.percent === undefined ? null : String(row.percent),
        grade: row.grade ?? null,
        source,
        sort_order: offset + index,
      })),
    );
  }

  async log(
    manager: EntityManager,
    schoolId: number,
    alumniId: number,
    action: TimelineAction,
    actor: Actor,
    changes: FieldChanges | null = null,
    note: string | null = null,
  ): Promise<void> {
    await manager.save(
      manager.create(AlumniTimeline, {
        school_id: schoolId,
        alumni_id: alumniId,
        action,
        actor_user_id: actor.id,
        actor_name: actor.name,
        changes,
        note,
      }),
    );
  }

  private async nextNumber(manager: EntityManager, schoolId: number, batchYear: number): Promise<string> {
    const [school] = (await manager.query(`SELECT code FROM schools WHERE id = $1`, [schoolId])) as { code: string }[];
    const sequence = await this.sequences.next(manager, schoolId, `alumni:${batchYear}`);
    return alumniNumber(school?.code ?? 'SCH', batchYear, sequence);
  }

  private fromStudent(student: Student): Partial<Alumni> & { first_name: string } {
    return {
      student_id: student.id,
      first_name: student.first_name,
      last_name: student.last_name,
      gender: student.gender,
      dob: student.dob,
      photo_file_id: student.photo_file_id,
      admission_no: student.admission_no,
      admission_date: student.admission_date,
    };
  }

  private eligible(row: CandidateRow): boolean {
    return !row.already && row.enrollment_status === 'studying' && row.student_status === 'active';
  }

  private async year(manager: EntityManager, schoolId: number, yearId: number): Promise<YearRow> {
    const [row] = (await manager.query(
      `SELECT id, name, end_date::text AS end_date FROM academic_years
       WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [yearId, schoolId],
    )) as YearRow[];
    if (!row) throw AppException.notFound('Academic year not found', 'ACADEMIC_YEAR_NOT_FOUND');
    return { ...row, id: Number(row.id) };
  }

  private async finalClass(manager: EntityManager, schoolId: number): Promise<{ id: number; name: string } | null> {
    const classes = (await manager.query(
      `SELECT id, name, grade_level FROM classes WHERE school_id = $1 AND deleted_at IS NULL`,
      [schoolId],
    )) as { id: number; name: string; grade_level: number | null }[];
    const level = finalGradeLevel(classes);
    const found = classes.find((row) => row.grade_level === level);
    return found ? { id: Number(found.id), name: found.name } : null;
  }

  private async candidates(
    manager: EntityManager,
    schoolId: number,
    yearId: number,
    classId: number,
  ): Promise<CandidateRow[]> {
    return manager.query(
      `SELECT s.id AS student_id, s.first_name, s.last_name, s.admission_no, s.status AS student_status,
              sec.name AS section_name, e.status AS enrollment_status, (a.id IS NOT NULL) AS already
       FROM student_enrollments e
       JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
       LEFT JOIN sections sec ON sec.id = e.section_id
       LEFT JOIN alumni a ON a.student_id = s.id AND a.school_id = $1 AND a.deleted_at IS NULL
       WHERE e.school_id = $1 AND e.academic_year_id = $2 AND e.class_id = $3
       ORDER BY sec.name NULLS LAST, s.first_name, s.last_name`,
      [schoolId, yearId, classId],
    ) as Promise<CandidateRow[]>;
  }

  private async snapshots(
    manager: EntityManager,
    schoolId: number,
    studentIds: number[],
  ): Promise<Map<number, Snapshot>> {
    const result = new Map<number, Snapshot>();
    if (!studentIds.length) return result;
    const enrollments = await (manager.query(
      `SELECT e.student_id, e.academic_year_id, y.name AS academic_year_name, c.name AS class_name,
                sec.name AS section_name, e.roll_no, e.status
         FROM student_enrollments e
         JOIN academic_years y ON y.id = e.academic_year_id
         JOIN classes c ON c.id = e.class_id
         LEFT JOIN sections sec ON sec.id = e.section_id
         WHERE e.school_id = $1 AND e.student_id = ANY($2)
         ORDER BY y.start_date ASC`,
      [schoolId, studentIds],
    ) as Promise<
      {
        student_id: number;
        academic_year_id: number;
        academic_year_name: string;
        class_name: string;
        section_name: string | null;
        roll_no: number | null;
        status: string;
      }[]
    >);
    const marks = await (manager.query(
      `SELECT m.student_id, x.academic_year_id, m.marks, m.is_absent, es.max_marks, es.pass_marks
         FROM exam_marks m
         JOIN exams x ON x.id = m.exam_id AND x.school_id = $1 AND x.status = 'published' AND x.deleted_at IS NULL
         JOIN student_enrollments e ON e.student_id = m.student_id AND e.academic_year_id = x.academic_year_id
         JOIN exam_subjects es ON es.exam_id = m.exam_id AND es.subject_id = m.subject_id AND es.class_id = e.class_id
         WHERE m.student_id = ANY($2) AND (m.is_absent OR m.marks IS NOT NULL)`,
      [schoolId, studentIds],
    ) as Promise<
      {
        student_id: number;
        academic_year_id: number;
        marks: number | null;
        is_absent: boolean;
        max_marks: number;
        pass_marks: number;
      }[]
    >);

    const byYear = new Map<number, typeof marks>();
    for (const row of marks) {
      const yearId = Number(row.academic_year_id);
      byYear.set(yearId, [...(byYear.get(yearId) ?? []), row]);
    }
    const scores = new Map<string, { percent: number; passed: boolean }>();
    for (const [yearId, rows] of byYear) {
      const computed = studentResults(
        rows.map((row) => ({
          student_id: Number(row.student_id),
          group_id: yearId,
          marks: row.marks === null ? null : Number(row.marks),
          is_absent: row.is_absent,
          max_marks: Number(row.max_marks),
          pass_marks: Number(row.pass_marks),
        })),
      );
      for (const [studentId, score] of computed) scores.set(`${studentId}:${yearId}`, score);
    }

    for (const row of enrollments) {
      const studentId = Number(row.student_id);
      const yearId = Number(row.academic_year_id);
      const score = scores.get(`${studentId}:${yearId}`);
      const percent = score ? oneDecimal(score.percent) : null;
      const entry = result.get(studentId) ?? { history: [], final: { percent: null, grade: null, result: null } };
      entry.history.push({
        academic_year_id: yearId,
        academic_year_name: row.academic_year_name,
        class_name: row.class_name,
        section_name: row.section_name,
        roll_no: row.roll_no === null ? null : Number(row.roll_no),
        result: (row.status as HistoryResult) ?? null,
        percent,
        grade: percent === null ? null : gradeFor(percent),
      });
      entry.final = {
        percent,
        grade: percent === null ? null : gradeFor(percent),
        result: score ? (score.passed ? 'pass' : 'fail') : null,
      };
      result.set(studentId, entry);
    }
    return result;
  }

  private async guardianContacts(
    manager: EntityManager,
    studentIds: number[],
  ): Promise<
    Map<
      number,
      {
        mobile: string | null;
        email: string | null;
        address_line: string | null;
        city: string | null;
        pincode: string | null;
      }
    >
  > {
    if (!studentIds.length) return new Map();
    const rows = (await manager.query(
      `SELECT DISTINCT ON (sg.student_id) sg.student_id, g.mobile, g.email, g.address_line, g.city, g.pincode
       FROM student_guardians sg
       JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
       WHERE sg.student_id = ANY($1)
       ORDER BY sg.student_id, sg.is_primary DESC, sg.id ASC`,
      [studentIds],
    )) as {
      student_id: number;
      mobile: string | null;
      email: string | null;
      address_line: string | null;
      city: string | null;
      pincode: string | null;
    }[];
    return new Map(rows.map((row) => [Number(row.student_id), row]));
  }

  private async dues(manager: EntityManager, schoolId: number, studentIds: number[]): Promise<Map<number, number>> {
    if (!studentIds.length) return new Map();
    const rows = (await manager.query(
      `SELECT student_id, coalesce(sum(balance), 0) AS balance FROM fee_invoices
       WHERE school_id = $1 AND student_id = ANY($2) AND status <> 'cancelled' AND deleted_at IS NULL
       GROUP BY student_id`,
      [schoolId, studentIds],
    )) as { student_id: number; balance: string }[];
    return new Map(rows.map((row) => [Number(row.student_id), Number(row.balance)]));
  }

  private async actor(manager: EntityManager, userId: number): Promise<Actor> {
    const [row] = (await manager.query(`SELECT name FROM users WHERE id = $1`, [userId])) as { name: string }[];
    return { id: userId, name: row?.name ?? null };
  }
}
