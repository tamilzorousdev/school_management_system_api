import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppException } from '@app/common';
import { AgoraTokenService } from '../meetings/agora-token.service';
import {
  CreateLessonPlanDto,
  CreateOnlineClassDto,
  CreateStudyMaterialDto,
  CreateSyllabusUnitDto,
  UpdateLessonPlanDto,
  UpdateSyllabusUnitDto,
} from './dto/academics.dto';

@Injectable()
export class AcademicsService {
  private readonly logger = new Logger('AcademicsService');

  constructor(
    private readonly dataSource: DataSource,
    private readonly agora: AgoraTokenService,
  ) {}

  // ==========================================
  // 1. SYLLABUS UNITS & TRACKING
  // ==========================================

  async listSyllabusUnits(schoolId: number, classId?: number, subjectId?: number, yearId?: number) {
    let sql = `
      SELECT su.id, su.school_id, su.academic_year_id, su.class_id, su.subject_id,
             su.unit_number, su.unit_name, su.description, su.total_planned_hours,
             su.is_completed, su.completed_at, su.completion_percentage,
             c.name as class_name, sub.name as subject_name,
             (SELECT COUNT(*)::int FROM lesson_plans lp WHERE lp.unit_id = su.id AND lp.deleted_at IS NULL) as total_lesson_plans
      FROM syllabus_units su
      JOIN classes c ON c.id = su.class_id
      JOIN subjects sub ON sub.id = su.subject_id
      WHERE su.school_id = $1 AND su.deleted_at IS NULL
    `;
    const params: unknown[] = [schoolId];
    let idx = 2;

    if (classId) {
      sql += ` AND su.class_id = $${idx++}`;
      params.push(classId);
    }
    if (subjectId) {
      sql += ` AND su.subject_id = $${idx++}`;
      params.push(subjectId);
    }
    if (yearId) {
      sql += ` AND su.academic_year_id = $${idx++}`;
      params.push(yearId);
    }

    sql += ` ORDER BY su.class_id ASC, su.subject_id ASC, su.unit_number ASC`;

    return this.dataSource.query(sql, params);
  }

  async createSyllabusUnit(schoolId: number, dto: CreateSyllabusUnitDto) {
    const [created] = await this.dataSource.query(
      `INSERT INTO syllabus_units (
        school_id, academic_year_id, class_id, subject_id,
        unit_number, unit_name, description, total_planned_hours,
        completion_percentage, is_completed
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, false)
      RETURNING *`,
      [
        schoolId,
        dto.academic_year_id,
        dto.class_id,
        dto.subject_id,
        dto.unit_number,
        dto.unit_name,
        dto.description ?? null,
        dto.total_planned_hours ?? 0,
      ],
    );
    return created;
  }

  async updateSyllabusUnit(schoolId: number, unitId: number, dto: UpdateSyllabusUnitDto) {
    const [unit] = await this.dataSource.query(
      `SELECT * FROM syllabus_units WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [unitId, schoolId],
    );
    if (!unit) throw AppException.notFound('Syllabus unit not found', 'UNIT_NOT_FOUND');

    const completion = dto.completion_percentage ?? unit.completion_percentage;
    const isCompleted = dto.is_completed !== undefined ? dto.is_completed : completion >= 100;
    const completedAt = isCompleted ? (unit.completed_at ?? new Date()) : null;

    const [updated] = await this.dataSource.query(
      `UPDATE syllabus_units
       SET unit_number = COALESCE($1, unit_number),
           unit_name = COALESCE($2, unit_name),
           description = COALESCE($3, description),
           total_planned_hours = COALESCE($4, total_planned_hours),
           completion_percentage = $5,
           is_completed = $6,
           completed_at = $7,
           updated_at = NOW()
       WHERE id = $8 AND school_id = $9
       RETURNING *`,
      [
        dto.unit_number ?? null,
        dto.unit_name ?? null,
        dto.description !== undefined ? dto.description : null,
        dto.total_planned_hours ?? null,
        completion,
        isCompleted,
        completedAt,
        unitId,
        schoolId,
      ],
    );
    return updated;
  }

  async deleteSyllabusUnit(schoolId: number, unitId: number) {
    await this.dataSource.query(`UPDATE syllabus_units SET deleted_at = NOW() WHERE id = $1 AND school_id = $2`, [
      unitId,
      schoolId,
    ]);
  }

  // ==========================================
  // 2. LESSON PLANS
  // ==========================================

  async listLessonPlans(schoolId: number, sectionId?: number, teacherId?: number, unitId?: number, date?: string) {
    let sql = `
      SELECT lp.id, lp.school_id, lp.unit_id, lp.teacher_user_id, lp.section_id,
             lp.planned_date, lp.topic, lp.learning_objectives, lp.teaching_aid,
             lp.homework_assigned, lp.status, lp.review_notes, lp.created_at,
             su.unit_number, su.unit_name,
             sec.name as section_name, c.name as class_name,
             sub.name as subject_name,
             u.name as teacher_name
      FROM lesson_plans lp
      JOIN syllabus_units su ON su.id = lp.unit_id
      JOIN sections sec ON sec.id = lp.section_id
      JOIN classes c ON c.id = sec.class_id
      JOIN subjects sub ON sub.id = su.subject_id
      JOIN users u ON u.id = lp.teacher_user_id
      WHERE lp.school_id = $1 AND lp.deleted_at IS NULL
    `;
    const params: unknown[] = [schoolId];
    let idx = 2;

    if (sectionId) {
      sql += ` AND lp.section_id = $${idx++}`;
      params.push(sectionId);
    }
    if (teacherId) {
      sql += ` AND lp.teacher_user_id = $${idx++}`;
      params.push(teacherId);
    }
    if (unitId) {
      sql += ` AND lp.unit_id = $${idx++}`;
      params.push(unitId);
    }
    if (date) {
      sql += ` AND lp.planned_date = $${idx++}`;
      params.push(date);
    }

    sql += ` ORDER BY lp.planned_date DESC, lp.id DESC`;

    return this.dataSource.query(sql, params);
  }

  async createLessonPlan(schoolId: number, teacherUserId: number, dto: CreateLessonPlanDto) {
    const [created] = await this.dataSource.query(
      `INSERT INTO lesson_plans (
        school_id, unit_id, teacher_user_id, section_id,
        planned_date, topic, learning_objectives, teaching_aid,
        homework_assigned, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        schoolId,
        dto.unit_id,
        teacherUserId,
        dto.section_id,
        dto.planned_date,
        dto.topic,
        dto.learning_objectives ?? null,
        dto.teaching_aid ?? null,
        dto.homework_assigned ?? null,
        dto.status ?? 'draft',
      ],
    );
    return created;
  }

  async updateLessonPlan(
    schoolId: number,
    planId: number,
    reviewerUserId: number | undefined,
    dto: UpdateLessonPlanDto,
  ) {
    const [plan] = await this.dataSource.query(
      `SELECT * FROM lesson_plans WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [planId, schoolId],
    );
    if (!plan) throw AppException.notFound('Lesson plan not found', 'PLAN_NOT_FOUND');

    const [updated] = await this.dataSource.query(
      `UPDATE lesson_plans
       SET planned_date = COALESCE($1, planned_date),
           topic = COALESCE($2, topic),
           learning_objectives = COALESCE($3, learning_objectives),
           teaching_aid = COALESCE($4, teaching_aid),
           homework_assigned = COALESCE($5, homework_assigned),
           status = COALESCE($6, status),
           reviewed_by_user_id = COALESCE($7, reviewed_by_user_id),
           review_notes = COALESCE($8, review_notes),
           updated_at = NOW()
       WHERE id = $9 AND school_id = $10
       RETURNING *`,
      [
        dto.planned_date ?? null,
        dto.topic ?? null,
        dto.learning_objectives !== undefined ? dto.learning_objectives : null,
        dto.teaching_aid !== undefined ? dto.teaching_aid : null,
        dto.homework_assigned !== undefined ? dto.homework_assigned : null,
        dto.status ?? null,
        reviewerUserId ?? null,
        dto.review_notes !== undefined ? dto.review_notes : null,
        planId,
        schoolId,
      ],
    );
    return updated;
  }

  // ==========================================
  // 3. STUDY MATERIALS & E-CONTENT
  // ==========================================

  async listStudyMaterials(
    schoolId: number,
    classId?: number,
    subjectId?: number,
    sectionId?: number,
    unitId?: number,
  ) {
    let sql = `
      SELECT sm.id, sm.school_id, sm.class_id, sm.subject_id, sm.section_id, sm.unit_id,
             sm.uploader_user_id, sm.title, sm.description, sm.material_type,
             sm.file_id, sm.file_url, sm.external_url, sm.created_at,
             c.name as class_name, sub.name as subject_name,
             sec.name as section_name, su.unit_name,
             u.name as uploader_name
      FROM study_materials sm
      JOIN classes c ON c.id = sm.class_id
      JOIN subjects sub ON sub.id = sm.subject_id
      LEFT JOIN sections sec ON sec.id = sm.section_id
      LEFT JOIN syllabus_units su ON su.id = sm.unit_id
      JOIN users u ON u.id = sm.uploader_user_id
      WHERE sm.school_id = $1 AND sm.deleted_at IS NULL
    `;
    const params: unknown[] = [schoolId];
    let idx = 2;

    if (classId) {
      sql += ` AND sm.class_id = $${idx++}`;
      params.push(classId);
    }
    if (subjectId) {
      sql += ` AND sm.subject_id = $${idx++}`;
      params.push(subjectId);
    }
    if (sectionId) {
      sql += ` AND (sm.section_id = $${idx++} OR sm.section_id IS NULL)`;
      params.push(sectionId);
    }
    if (unitId) {
      sql += ` AND sm.unit_id = $${idx++}`;
      params.push(unitId);
    }

    sql += ` ORDER BY sm.created_at DESC`;

    return this.dataSource.query(sql, params);
  }

  async createStudyMaterial(schoolId: number, uploaderUserId: number, dto: CreateStudyMaterialDto) {
    const [created] = await this.dataSource.query(
      `INSERT INTO study_materials (
        school_id, class_id, subject_id, section_id, unit_id,
        uploader_user_id, title, description, material_type,
        file_id, file_url, external_url
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        schoolId,
        dto.class_id,
        dto.subject_id,
        dto.section_id ?? null,
        dto.unit_id ?? null,
        uploaderUserId,
        dto.title,
        dto.description ?? null,
        dto.material_type ?? 'document',
        dto.file_id ?? null,
        dto.file_url ?? null,
        dto.external_url ?? null,
      ],
    );
    return created;
  }

  async deleteStudyMaterial(schoolId: number, materialId: number) {
    await this.dataSource.query(`UPDATE study_materials SET deleted_at = NOW() WHERE id = $1 AND school_id = $2`, [
      materialId,
      schoolId,
    ]);
  }

  // ==========================================
  // 4. ONLINE CLASSES (AGORA RTC LIVE SESSIONS)
  // ==========================================

  async listOnlineClasses(schoolId: number, sectionId?: number, teacherId?: number, status?: string) {
    let sql = `
      SELECT oc.id, oc.school_id, oc.section_id, oc.subject_id, oc.teacher_user_id,
             oc.title, oc.description, oc.scheduled_start, oc.scheduled_end,
             oc.status, oc.channel_name, oc.meeting_url, oc.created_at,
             sec.name as section_name, c.name as class_name,
             sub.name as subject_name,
             u.name as teacher_name
      FROM online_classes oc
      JOIN sections sec ON sec.id = oc.section_id
      JOIN classes c ON c.id = sec.class_id
      JOIN subjects sub ON sub.id = oc.subject_id
      JOIN users u ON u.id = oc.teacher_user_id
      WHERE oc.school_id = $1 AND oc.deleted_at IS NULL
    `;
    const params: unknown[] = [schoolId];
    let idx = 2;

    if (sectionId) {
      sql += ` AND oc.section_id = $${idx++}`;
      params.push(sectionId);
    }
    if (teacherId) {
      sql += ` AND oc.teacher_user_id = $${idx++}`;
      params.push(teacherId);
    }
    if (status) {
      sql += ` AND oc.status = $${idx++}`;
      params.push(status);
    }

    sql += ` ORDER BY oc.scheduled_start DESC`;

    return this.dataSource.query(sql, params);
  }

  async createOnlineClass(schoolId: number, teacherUserId: number, dto: CreateOnlineClassDto) {
    const channelName = `class-${schoolId}-${dto.section_id}-${Date.now().toString(36)}`;
    const [created] = await this.dataSource.query(
      `INSERT INTO online_classes (
        school_id, section_id, subject_id, teacher_user_id,
        title, description, scheduled_start, scheduled_end,
        status, channel_name
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled', $9)
      RETURNING *`,
      [
        schoolId,
        dto.section_id,
        dto.subject_id,
        teacherUserId,
        dto.title,
        dto.description ?? null,
        dto.scheduled_start,
        dto.scheduled_end,
        channelName,
      ],
    );
    return created;
  }

  async getOnlineClassRtcToken(schoolId: number, classId: number, userId: number) {
    const [cls] = await this.dataSource.query(
      `SELECT * FROM online_classes WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [classId, schoolId],
    );
    if (!cls) throw AppException.notFound('Online class not found', 'CLASS_NOT_FOUND');

    const isTeacher = Number(cls.teacher_user_id) === Number(userId);
    let rtcToken = { token: 'mock-agora-token', app_id: 'test-app-id', expires_at: new Date(Date.now() + 7200000) };

    if (this.agora.enabled) {
      try {
        rtcToken = this.agora.issue(cls.channel_name, userId, new Date());
      } catch (err) {
        this.logger.warn(`Agora token issue error: ${err}`);
      }
    }

    return {
      class_id: cls.id,
      title: cls.title,
      channel_name: cls.channel_name,
      app_id: rtcToken.app_id,
      token: rtcToken.token,
      expires_at: rtcToken.expires_at,
      role: isTeacher ? 'broadcaster' : 'audience',
      is_host: isTeacher,
    };
  }

  async updateOnlineClassStatus(schoolId: number, classId: number, status: string) {
    const [cls] = await this.dataSource.query(
      `SELECT * FROM online_classes WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [classId, schoolId],
    );
    if (!cls) throw AppException.notFound('Online class not found', 'CLASS_NOT_FOUND');

    const [updated] = await this.dataSource.query(
      `UPDATE online_classes SET status = $1, updated_at = NOW() WHERE id = $2 AND school_id = $3 RETURNING *`,
      [status, classId, schoolId],
    );
    return updated;
  }
}
