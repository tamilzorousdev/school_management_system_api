import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppException } from '@app/common';
import { createPdf, renderPdf } from '../student-lifecycle/pdf/pdf-kit';
import {
  AssignInvigilatorDto,
  AutoAllocateHallsDto,
  CreateExamHallDto,
  SaveGradingScaleDto,
  UpdateExamHallDto,
} from './dto/halls.dto';
import { ExamHall } from './entities/exam-hall.entity';
import { GradingScale } from './entities/grading-scale.entity';

@Injectable()
export class ExamHallsService {
  constructor(private readonly dataSource: DataSource) {}

  async listHalls(schoolId: number): Promise<ExamHall[]> {
    return this.dataSource.query(
      `SELECT id, school_id, name, building, floor, capacity, rows_count, columns_count, is_active, created_at, updated_at
       FROM exam_halls
       WHERE school_id = $1 AND deleted_at IS NULL
       ORDER BY name ASC`,
      [schoolId],
    );
  }

  async getHall(schoolId: number, hallId: number): Promise<ExamHall> {
    const [hall] = await this.dataSource.query(
      `SELECT * FROM exam_halls WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [hallId, schoolId],
    );
    if (!hall) throw AppException.notFound('Exam hall not found', 'EXAM_HALL_NOT_FOUND');
    return hall;
  }

  async createHall(schoolId: number, dto: CreateExamHallDto): Promise<ExamHall> {
    const [existing] = await this.dataSource.query(
      `SELECT id FROM exam_halls WHERE school_id = $1 AND LOWER(name) = LOWER($2) AND deleted_at IS NULL`,
      [schoolId, dto.name.trim()],
    );
    if (existing) throw AppException.badRequest('A hall with this name already exists', 'HALL_NAME_EXISTS');

    const [created] = await this.dataSource.query(
      `INSERT INTO exam_halls (school_id, name, building, floor, capacity, rows_count, columns_count, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        schoolId,
        dto.name.trim(),
        dto.building?.trim() ?? null,
        dto.floor?.trim() ?? null,
        dto.capacity,
        dto.rows_count ?? 5,
        dto.columns_count ?? 6,
        dto.is_active ?? true,
      ],
    );
    return created;
  }

  async updateHall(schoolId: number, hallId: number, dto: UpdateExamHallDto): Promise<ExamHall> {
    await this.getHall(schoolId, hallId);
    if (dto.name) {
      const [existing] = await this.dataSource.query(
        `SELECT id FROM exam_halls WHERE school_id = $1 AND LOWER(name) = LOWER($2) AND id != $3 AND deleted_at IS NULL`,
        [schoolId, dto.name.trim(), hallId],
      );
      if (existing) throw AppException.badRequest('A hall with this name already exists', 'HALL_NAME_EXISTS');
    }

    const updates: string[] = [];
    const values: (string | number | boolean | null)[] = [];
    let idx = 1;

    if (dto.name !== undefined) {
      updates.push(`name = $${idx++}`);
      values.push(dto.name.trim());
    }
    if (dto.building !== undefined) {
      updates.push(`building = $${idx++}`);
      values.push(dto.building?.trim() ?? null);
    }
    if (dto.floor !== undefined) {
      updates.push(`floor = $${idx++}`);
      values.push(dto.floor?.trim() ?? null);
    }
    if (dto.capacity !== undefined) {
      updates.push(`capacity = $${idx++}`);
      values.push(dto.capacity);
    }
    if (dto.rows_count !== undefined) {
      updates.push(`rows_count = $${idx++}`);
      values.push(dto.rows_count);
    }
    if (dto.columns_count !== undefined) {
      updates.push(`columns_count = $${idx++}`);
      values.push(dto.columns_count);
    }
    if (dto.is_active !== undefined) {
      updates.push(`is_active = $${idx++}`);
      values.push(dto.is_active);
    }

    if (!updates.length) return this.getHall(schoolId, hallId);

    updates.push(`updated_at = NOW()`);
    values.push(hallId, schoolId);

    const [updated] = await this.dataSource.query(
      `UPDATE exam_halls SET ${updates.join(', ')} WHERE id = $${idx++} AND school_id = $${idx++} RETURNING *`,
      values,
    );
    return updated;
  }

  async deleteHall(schoolId: number, hallId: number): Promise<void> {
    await this.getHall(schoolId, hallId);
    await this.dataSource.query(`UPDATE exam_halls SET deleted_at = NOW() WHERE id = $1 AND school_id = $2`, [
      hallId,
      schoolId,
    ]);
  }

  async autoAllocate(schoolId: number, examId: number, dto: AutoAllocateHallsDto) {
    const [exam] = await this.dataSource.query(
      `SELECT * FROM exams WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [examId, schoolId],
    );
    if (!exam) throw AppException.notFound('Exam not found', 'EXAM_NOT_FOUND');

    const classRows: { class_id: number }[] = await this.dataSource.query(
      `SELECT DISTINCT class_id FROM exam_subjects WHERE exam_id = $1`,
      [examId],
    );
    if (!classRows.length) throw AppException.badRequest('No classes configured for this exam', 'NO_CLASSES');
    const classIds = classRows.map((r) => r.class_id);

    const students: {
      student_id: number;
      first_name: string;
      last_name: string | null;
      admission_no: string;
      roll_no: number | null;
      class_id: number;
      class_name: string;
      section_id: number;
      section_name: string;
    }[] = await this.dataSource.query(
      `SELECT s.id as student_id, s.first_name, s.last_name, s.admission_no, e.roll_no,
              c.id as class_id, c.name as class_name, sec.id as section_id, sec.name as section_name
       FROM student_enrollments e
       JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
       JOIN sections sec ON sec.id = e.section_id AND sec.deleted_at IS NULL
       JOIN classes c ON c.id = sec.class_id AND c.deleted_at IS NULL
       WHERE e.school_id = $1 AND e.academic_year_id = $2 AND c.id = ANY($3)
       ORDER BY c.id ASC, sec.id ASC, COALESCE(e.roll_no, 9999) ASC, s.first_name ASC`,
      [schoolId, exam.academic_year_id, classIds],
    );

    if (!students.length) throw AppException.badRequest('No enrolled students found for exam classes', 'NO_STUDENTS');

    let orderedStudents = [...students];
    if (dto.strategy === 'alternate_section') {
      const sectionGroups = new Map<number, typeof students>();
      for (const st of students) {
        const arr = sectionGroups.get(st.section_id) ?? [];
        arr.push(st);
        sectionGroups.set(st.section_id, arr);
      }
      const queues = Array.from(sectionGroups.values());
      const interleaved: typeof students = [];
      let hadAny = true;
      let round = 0;
      while (hadAny) {
        hadAny = false;
        for (const q of queues) {
          if (round < q.length) {
            interleaved.push(q[round]);
            hadAny = true;
          }
        }
        round++;
      }
      orderedStudents = interleaved;
    }

    const halls: ExamHall[] = await this.dataSource.query(
      `SELECT * FROM exam_halls WHERE id = ANY($1) AND school_id = $2 AND is_active = true AND deleted_at IS NULL`,
      [dto.hall_ids, schoolId],
    );
    const hallMap = new Map(halls.map((h) => [h.id, h]));
    const chosenHalls = dto.hall_ids.map((id) => hallMap.get(id)).filter((h): h is ExamHall => Boolean(h));

    if (!chosenHalls.length) throw AppException.badRequest('No active exam halls selected', 'NO_HALLS');

    const totalCapacity = chosenHalls.reduce((sum, h) => sum + h.capacity, 0);

    return this.dataSource.transaction(async (tx) => {
      await tx.query(`DELETE FROM exam_hall_allocations WHERE exam_id = $1 AND school_id = $2`, [examId, schoolId]);

      let studentIdx = 0;
      const hallSummary: { hall_id: number; hall_name: string; allocated_count: number; capacity: number }[] = [];

      for (const hall of chosenHalls) {
        let deskOrder = 1;
        let hallCount = 0;
        const prefix =
          hall.name
            .replace(/[^a-zA-Z0-9]/g, '')
            .slice(0, 3)
            .toUpperCase() || 'H';

        while (deskOrder <= hall.capacity && studentIdx < orderedStudents.length) {
          const student = orderedStudents[studentIdx];
          const seatNumber = `${prefix}-${String(deskOrder).padStart(2, '0')}`;

          await tx.query(
            `INSERT INTO exam_hall_allocations (school_id, exam_id, hall_id, student_id, seat_number, desk_order)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [schoolId, examId, hall.id, student.student_id, seatNumber, deskOrder],
          );

          deskOrder++;
          studentIdx++;
          hallCount++;
        }

        hallSummary.push({
          hall_id: hall.id,
          hall_name: hall.name,
          allocated_count: hallCount,
          capacity: hall.capacity,
        });

        if (studentIdx >= orderedStudents.length) break;
      }

      return {
        total_students: students.length,
        total_capacity: totalCapacity,
        allocated: studentIdx,
        unallocated: Math.max(0, students.length - studentIdx),
        halls: hallSummary,
      };
    });
  }

  async getExamSeating(schoolId: number, examId: number, hallId?: number) {
    const [exam] = await this.dataSource.query(
      `SELECT id, name, academic_year_id FROM exams WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [examId, schoolId],
    );
    if (!exam) throw AppException.notFound('Exam not found', 'EXAM_NOT_FOUND');

    let query = `
      SELECT a.id, a.exam_id, a.hall_id, h.name as hall_name, h.building, h.floor,
             a.student_id, s.first_name, s.last_name, s.admission_no, e.roll_no,
             c.name as class_name, sec.name as section_name,
             a.seat_number, a.desk_order
      FROM exam_hall_allocations a
      JOIN exam_halls h ON h.id = a.hall_id
      JOIN students s ON s.id = a.student_id
      JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = $3
      JOIN sections sec ON sec.id = e.section_id
      JOIN classes c ON c.id = sec.class_id
      WHERE a.exam_id = $1 AND a.school_id = $2
    `;
    const params: (string | number)[] = [examId, schoolId, exam.academic_year_id];

    if (hallId) {
      query += ` AND a.hall_id = $4`;
      params.push(hallId);
    }

    query += ` ORDER BY h.name ASC, a.desk_order ASC`;

    const rows = await this.dataSource.query(query, params);
    return rows.map((r: Record<string, unknown>) => ({
      ...r,
      full_name: [r.first_name, r.last_name].filter(Boolean).join(' '),
    }));
  }

  async clearExamSeating(schoolId: number, examId: number): Promise<void> {
    await this.dataSource.query(`DELETE FROM exam_hall_allocations WHERE exam_id = $1 AND school_id = $2`, [
      examId,
      schoolId,
    ]);
  }

  async listInvigilators(schoolId: number, examId: number) {
    return this.dataSource.query(
      `SELECT i.id, i.exam_id, i.hall_id, h.name as hall_name,
              i.teacher_user_id, u.name as teacher_name, u.mobile as teacher_phone,
              i.exam_date, i.session
       FROM exam_invigilators i
       JOIN exam_halls h ON h.id = i.hall_id
       JOIN users u ON u.id = i.teacher_user_id
       WHERE i.exam_id = $1 AND i.school_id = $2 AND i.deleted_at IS NULL
       ORDER BY i.exam_date ASC, i.session ASC, h.name ASC`,
      [examId, schoolId],
    );
  }

  async assignInvigilator(schoolId: number, examId: number, dto: AssignInvigilatorDto) {
    const [hall] = await this.dataSource.query(
      `SELECT id FROM exam_halls WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [dto.hall_id, schoolId],
    );
    if (!hall) throw AppException.notFound('Exam hall not found', 'EXAM_HALL_NOT_FOUND');

    const [teacher] = await this.dataSource.query(
      `SELECT id FROM users WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [dto.teacher_user_id, schoolId],
    );
    if (!teacher) throw AppException.notFound('Teacher not found', 'TEACHER_NOT_FOUND');

    const [created] = await this.dataSource.query(
      `INSERT INTO exam_invigilators (school_id, exam_id, hall_id, teacher_user_id, exam_date, session)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [schoolId, examId, dto.hall_id, dto.teacher_user_id, dto.exam_date, dto.session ?? 'Morning'],
    );
    return created;
  }

  async deleteInvigilator(schoolId: number, invigilatorId: number): Promise<void> {
    await this.dataSource.query(`UPDATE exam_invigilators SET deleted_at = NOW() WHERE id = $1 AND school_id = $2`, [
      invigilatorId,
      schoolId,
    ]);
  }

  async getTeacherInvigilations(schoolId: number, teacherUserId: number) {
    return this.dataSource.query(
      `SELECT i.id, i.exam_date, i.session, e.id as exam_id, e.name as exam_name,
              h.id as hall_id, h.name as hall_name, h.building, h.floor
       FROM exam_invigilators i
       JOIN exams e ON e.id = i.exam_id AND e.deleted_at IS NULL
       JOIN exam_halls h ON h.id = i.hall_id AND h.deleted_at IS NULL
       WHERE i.school_id = $1 AND i.teacher_user_id = $2 AND i.deleted_at IS NULL
       ORDER BY i.exam_date ASC`,
      [schoolId, teacherUserId],
    );
  }

  async getStudentHallTicket(schoolId: number, studentId: number, examId: number) {
    const [exam] = await this.dataSource.query(
      `SELECT * FROM exams WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [examId, schoolId],
    );
    if (!exam) throw AppException.notFound('Exam not found', 'EXAM_NOT_FOUND');

    const [student] = await this.dataSource.query(
      `SELECT s.id, s.first_name, s.last_name, s.admission_no, e.roll_no,
              c.id as class_id, c.name as class_name, sec.name as section_name
       FROM student_enrollments e
       JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
       JOIN sections sec ON sec.id = e.section_id AND sec.deleted_at IS NULL
       JOIN classes c ON c.id = sec.class_id AND c.deleted_at IS NULL
       WHERE s.id = $1 AND e.school_id = $2 AND e.academic_year_id = $3`,
      [studentId, schoolId, exam.academic_year_id],
    );
    if (!student) throw AppException.notFound('Student enrollment not found', 'STUDENT_NOT_FOUND');

    const [alloc] = await this.dataSource.query(
      `SELECT a.seat_number, a.desk_order, h.name as hall_name, h.building, h.floor
       FROM exam_hall_allocations a
       JOIN exam_halls h ON h.id = a.hall_id
       WHERE a.exam_id = $1 AND a.student_id = $2 AND a.school_id = $3`,
      [examId, studentId, schoolId],
    );

    const papers = await this.dataSource.query(
      `SELECT es.id, es.exam_date, es.max_marks, es.pass_marks, s.name as subject_name, s.code as subject_code
       FROM exam_subjects es
       JOIN subjects s ON s.id = es.subject_id
       WHERE es.exam_id = $1 AND es.class_id = $2
       ORDER BY es.exam_date ASC NULLS LAST, s.name ASC`,
      [examId, student.class_id],
    );

    const [school] = await this.dataSource.query(`SELECT name, address, phone FROM schools WHERE id = $1`, [schoolId]);

    return {
      school: {
        name: school?.name ?? 'School',
        address: school?.address ?? '',
        phone: school?.phone ?? '',
      },
      exam: {
        id: exam.id,
        name: exam.name,
        start_date: exam.start_date,
        end_date: exam.end_date,
      },
      student: {
        id: student.id,
        full_name: [student.first_name, student.last_name].filter(Boolean).join(' '),
        admission_no: student.admission_no,
        roll_no: student.roll_no,
        class_name: student.class_name,
        section_name: student.section_name,
      },
      seating: alloc
        ? {
            hall_name: alloc.hall_name,
            building: alloc.building,
            floor: alloc.floor,
            seat_number: alloc.seat_number,
          }
        : null,
      timetable: papers.map(
        (p: {
          subject_name: string;
          subject_code: string | null;
          exam_date: string | null;
          max_marks: number;
          pass_marks: number;
        }) => ({
          subject_name: p.subject_name,
          subject_code: p.subject_code,
          exam_date: p.exam_date,
          max_marks: p.max_marks,
          pass_marks: p.pass_marks,
        }),
      ),
      instructions: [
        'Candidates must carry this Hall Ticket / Admit Card to every examination session.',
        'Please be seated in the assigned hall at least 15 minutes before the exam begins.',
        'Electronic gadgets, mobile phones, and smart watches are strictly prohibited.',
        'Borrowing stationery or talking during the examination is strictly disallowed.',
      ],
    };
  }

  async generateDoorChartPdf(schoolId: number, examId: number, hallId: number): Promise<Buffer> {
    const [exam] = await this.dataSource.query(`SELECT * FROM exams WHERE id = $1 AND school_id = $2`, [
      examId,
      schoolId,
    ]);
    const [hall] = await this.dataSource.query(`SELECT * FROM exam_halls WHERE id = $1 AND school_id = $2`, [
      hallId,
      schoolId,
    ]);
    const [school] = await this.dataSource.query(`SELECT name FROM schools WHERE id = $1`, [schoolId]);

    const seating = await this.getExamSeating(schoolId, examId, hallId);

    const doc = createPdf({ size: 'A4', layout: 'portrait', margin: 36 });

    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .fillColor('#0f1a15')
      .text(school?.name ?? 'Exam Seating Plan', { align: 'center' });
    doc.moveDown(0.3);
    doc
      .fontSize(12)
      .fillColor('#159053')
      .text(`SEATING PLAN / DOOR CHART - ${hall?.name ?? 'Hall'}`, { align: 'center' });
    doc
      .fontSize(10)
      .fillColor('#5a6a62')
      .text(`Exam: ${exam?.name ?? ''} | Capacity: ${hall?.capacity ?? 0} seats`, { align: 'center' });
    doc.moveDown(0.8);

    const startX = 36;
    let y = doc.y;

    doc.rect(startX, y, 523, 20).fill('#e4f2ea');
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0d5c35');
    doc.text('Seat No', startX + 10, y + 5);
    doc.text('Roll No', startX + 90, y + 5);
    doc.text('Student Name', startX + 160, y + 5);
    doc.text('Class & Sec', startX + 340, y + 5);
    doc.text('Desk Order', startX + 440, y + 5);

    y += 20;

    seating.forEach(
      (
        row: {
          seat_number: string;
          roll_no?: number | null;
          full_name: string;
          class_name: string;
          section_name: string;
          desk_order: number;
        },
        i: number,
      ) => {
        if (y > 750) {
          doc.addPage();
          y = 36;
        }
        const bg = i % 2 === 0 ? '#ffffff' : '#f9fafb';
        doc.rect(startX, y, 523, 18).fill(bg);
        doc
          .font('Helvetica-Bold')
          .fontSize(8.5)
          .fillColor('#111827')
          .text(row.seat_number, startX + 10, y + 4);
        doc.font('Helvetica').fontSize(8.5).fillColor('#374151');
        doc.text(String(row.roll_no ?? '—'), startX + 90, y + 4);
        doc.text(row.full_name, startX + 160, y + 4, { width: 170, lineBreak: false });
        doc.text(`${row.class_name} - ${row.section_name}`, startX + 340, y + 4);
        doc.text(String(row.desk_order), startX + 440, y + 4);
        y += 18;
      },
    );

    return renderPdf(doc);
  }

  async generateHallTicketsPdf(schoolId: number, examId: number, classId?: number): Promise<Buffer> {
    const [exam] = await this.dataSource.query(`SELECT * FROM exams WHERE id = $1 AND school_id = $2`, [
      examId,
      schoolId,
    ]);
    const [school] = await this.dataSource.query(`SELECT name, address, phone FROM schools WHERE id = $1`, [schoolId]);

    let studentsQuery = `
      SELECT DISTINCT s.id
      FROM exam_hall_allocations a
      JOIN students s ON s.id = a.student_id
      JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = $2
      JOIN sections sec ON sec.id = e.section_id
      WHERE a.exam_id = $1 AND a.school_id = $3
    `;
    const params: (string | number)[] = [examId, exam.academic_year_id, schoolId];
    if (classId) {
      studentsQuery += ` AND sec.class_id = $4`;
      params.push(classId);
    }

    const studentRows = await this.dataSource.query(studentsQuery, params);
    if (!studentRows.length) {
      throw AppException.badRequest('No allocated students found for hall ticket generation', 'NO_ALLOCATIONS');
    }

    const doc = createPdf({ size: 'A4', layout: 'portrait', margin: 36 });

    for (let i = 0; i < studentRows.length; i++) {
      if (i > 0) doc.addPage();
      const ticket = await this.getStudentHallTicket(schoolId, studentRows[i].id, examId);

      doc.rect(36, 36, 523, 770).strokeColor('#159053').lineWidth(1.5).stroke();

      doc
        .font('Helvetica-Bold')
        .fontSize(16)
        .fillColor('#0d5c35')
        .text(school?.name ?? 'School', 36, 50, { align: 'center', width: 523 });
      doc
        .fontSize(9)
        .fillColor('#5a6a62')
        .text(school?.address ?? '', 36, 70, { align: 'center', width: 523 });
      doc.moveDown(0.5);

      doc.rect(50, 90, 495, 24).fill('#e4f2ea');
      doc
        .font('Helvetica-Bold')
        .fontSize(11)
        .fillColor('#0d5c35')
        .text(`HALL TICKET / ADMIT CARD - ${exam?.name ?? ''}`, 50, 97, { align: 'center', width: 495 });

      let curY = 125;
      doc.rect(50, curY, 390, 85).strokeColor('#dbe3df').stroke();
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#111827');
      doc.text('Student Name:', 60, curY + 10);
      doc.text('Admission No:', 60, curY + 28);
      doc.text('Class & Section:', 60, curY + 46);
      doc.text('Roll Number:', 60, curY + 64);

      doc.font('Helvetica').fontSize(9).fillColor('#374151');
      doc.text(ticket.student.full_name, 150, curY + 10);
      doc.text(ticket.student.admission_no, 150, curY + 28);
      doc.text(`${ticket.student.class_name} - ${ticket.student.section_name}`, 150, curY + 46);
      doc.text(String(ticket.student.roll_no ?? '—'), 150, curY + 64);

      doc.rect(450, curY, 95, 85).strokeColor('#dbe3df').stroke();
      doc
        .fontSize(8)
        .fillColor('#9ca3af')
        .text('PHOTO', 450, curY + 38, { align: 'center', width: 95 });

      curY += 95;
      doc.rect(50, curY, 495, 45).fill('#f9fafb').strokeColor('#dbe3df').stroke();
      doc
        .font('Helvetica-Bold')
        .fontSize(9.5)
        .fillColor('#0d5c35')
        .text('ASSIGNED EXAM HALL & SEAT', 60, curY + 8);
      doc.font('Helvetica').fontSize(9).fillColor('#111827');
      const hallText = ticket.seating
        ? `${ticket.seating.hall_name} (${ticket.seating.building ?? ''} ${ticket.seating.floor ?? ''})`
        : 'Not Allocated';
      const seatText = ticket.seating ? ticket.seating.seat_number : '—';
      doc.text(`Exam Hall: ${hallText}`, 60, curY + 26);
      doc.text(`Desk / Seat No: ${seatText}`, 320, curY + 26);

      curY += 55;
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f1a15').text('EXAMINATION TIMETABLE', 50, curY);
      curY += 15;

      doc.rect(50, curY, 495, 20).fill('#e4f2ea');
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#0d5c35');
      doc.text('Subject', 60, curY + 5);
      doc.text('Code', 220, curY + 5);
      doc.text('Exam Date', 300, curY + 5);
      doc.text('Max Marks', 400, curY + 5);
      doc.text('Pass Marks', 470, curY + 5);
      curY += 20;

      ticket.timetable.forEach(
        (
          paper: {
            subject_name: string;
            subject_code?: string | null;
            exam_date?: string | null;
            max_marks: number;
            pass_marks: number;
          },
          idx: number,
        ) => {
          const bg = idx % 2 === 0 ? '#ffffff' : '#f9fafb';
          doc.rect(50, curY, 495, 18).fill(bg);
          doc
            .font('Helvetica-Bold')
            .fontSize(8.5)
            .fillColor('#111827')
            .text(paper.subject_name, 60, curY + 4);
          doc.font('Helvetica').fontSize(8.5).fillColor('#374151');
          doc.text(paper.subject_code ?? '—', 220, curY + 4);
          doc.text(paper.exam_date ?? 'TBA', 300, curY + 4);
          doc.text(String(paper.max_marks), 400, curY + 4);
          doc.text(String(paper.pass_marks), 470, curY + 4);
          curY += 18;
        },
      );

      curY += 15;
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f1a15').text('Instructions for Candidate:', 50, curY);
      curY += 14;
      doc.font('Helvetica').fontSize(8).fillColor('#4b5563');
      ticket.instructions.forEach((ins: string) => {
        doc.text(`• ${ins}`, 55, curY);
        curY += 12;
      });

      curY = 740;
      doc.moveTo(70, curY).lineTo(190, curY).strokeColor('#111827').lineWidth(0.8).stroke();
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor('#374151')
        .text('Student Signature', 70, curY + 5, { width: 120, align: 'center' });

      doc.moveTo(230, curY).lineTo(350, curY).strokeColor('#111827').lineWidth(0.8).stroke();
      doc.text('Invigilator Signature', 230, curY + 5, { width: 120, align: 'center' });

      doc.moveTo(390, curY).lineTo(510, curY).strokeColor('#111827').lineWidth(0.8).stroke();
      doc.text('Principal Signature & Seal', 390, curY + 5, { width: 120, align: 'center' });
    }

    return renderPdf(doc);
  }

  async listGradingScales(schoolId: number): Promise<GradingScale[]> {
    return this.dataSource.query(
      `SELECT * FROM grading_scales WHERE school_id = $1 AND deleted_at IS NULL ORDER BY is_default DESC, name ASC`,
      [schoolId],
    );
  }

  async saveGradingScale(schoolId: number, dto: SaveGradingScaleDto): Promise<GradingScale> {
    if (dto.is_default) {
      await this.dataSource.query(`UPDATE grading_scales SET is_default = false WHERE school_id = $1`, [schoolId]);
    }

    const [existing] = await this.dataSource.query(
      `SELECT id FROM grading_scales WHERE school_id = $1 AND LOWER(name) = LOWER($2) AND deleted_at IS NULL`,
      [schoolId, dto.name.trim()],
    );

    if (existing) {
      const [updated] = await this.dataSource.query(
        `UPDATE grading_scales
         SET board = $1, tiers = $2, is_default = $3, updated_at = NOW()
         WHERE id = $4 AND school_id = $5
         RETURNING *`,
        [dto.board, JSON.stringify(dto.tiers), dto.is_default ?? false, existing.id, schoolId],
      );
      return updated;
    }

    const [created] = await this.dataSource.query(
      `INSERT INTO grading_scales (school_id, board, name, is_default, tiers)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [schoolId, dto.board, dto.name.trim(), dto.is_default ?? false, JSON.stringify(dto.tiers)],
    );
    return created;
  }

  async setDefaultGradingScale(schoolId: number, scaleId: number): Promise<void> {
    await this.dataSource.transaction(async (tx) => {
      await tx.query(`UPDATE grading_scales SET is_default = false WHERE school_id = $1`, [schoolId]);
      await tx.query(
        `UPDATE grading_scales SET is_default = true, updated_at = NOW() WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
        [scaleId, schoolId],
      );
    });
  }

  async deleteGradingScale(schoolId: number, scaleId: number): Promise<void> {
    await this.dataSource.query(`UPDATE grading_scales SET deleted_at = NOW() WHERE id = $1 AND school_id = $2`, [
      scaleId,
      schoolId,
    ]);
  }
}
