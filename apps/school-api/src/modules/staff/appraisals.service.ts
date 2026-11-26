import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AppException, AuthUser, Paginated, listQuery } from '@app/common';
import { StaffAppraisal, OverallRating } from './entities/staff-appraisal.entity';
import { Staff } from './entities/staff.entity';
import { User } from '../users/entities/user.entity';
import { currentYearId } from '../../shared/academic-year';
import {
  AppraisalQueryDto,
  RecentHomeworkItemDto,
  StaffAppraisalCommentDto,
  StaffAppraisalDto,
  StaffAppraisalInputDto,
  StaffHikeRequestDto,
  StaffPerformanceMetricsDto,
  TeachingAssignmentSummaryDto,
} from './dto/staff-appraisal.dto';
import { AppraisalAppealDto, ResolveAppealDto } from './dto/kra-config.dto';

export function calculateRating(score: number): OverallRating {
  if (score >= 4.6) return 'outstanding';
  if (score >= 3.8) return 'exceeds_expectations';
  if (score >= 3.0) return 'meets_expectations';
  if (score >= 2.0) return 'needs_improvement';
  return 'unsatisfactory';
}

@Injectable()
export class AppraisalsService {
  private readonly logger = new Logger(AppraisalsService.name);

  constructor(
    @InjectRepository(StaffAppraisal) private readonly appraisals: Repository<StaffAppraisal>,
    @InjectRepository(Staff) private readonly staff: Repository<Staff>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async list(schoolId: number, query: AppraisalQueryDto): Promise<Paginated<StaffAppraisalDto>> {
    const qb = this.appraisals
      .createQueryBuilder('a')
      .where('a.school_id = :schoolId', { schoolId })
      .orderBy('a.review_date', 'DESC')
      .addOrderBy('a.id', 'DESC');

    if (query.academic_year_id) {
      qb.andWhere('a.academic_year_id = :yearId', { yearId: query.academic_year_id });
    }
    if (query.status) {
      qb.andWhere('a.status = :status', { status: query.status });
    }
    if (query.rating) {
      qb.andWhere('a.overall_rating = :rating', { rating: query.rating });
    }
    if (query.staff_id) {
      qb.andWhere('a.staff_id = :staffId', { staffId: query.staff_id });
    }

    const page = await listQuery(qb, query, {
      searchable: ['a.period', 'a.strengths', 'a.areas_for_improvement'],
      sortable: { review_date: 'a.review_date', created_at: 'a.created_at' },
      defaultSort: 'review_date',
    });

    const presented = await this.presentMany(page.items);
    return { ...page, items: presented };
  }

  async get(schoolId: number, id: number): Promise<StaffAppraisalDto> {
    const appraisal = await this.appraisals.findOne({
      where: { id, school_id: schoolId },
    });
    if (!appraisal) throw AppException.notFound('Staff appraisal not found', 'APPRAISAL_NOT_FOUND');
    return (await this.presentMany([appraisal]))[0];
  }

  async create(schoolId: number, reviewer: AuthUser, dto: StaffAppraisalInputDto): Promise<StaffAppraisalDto> {
    let staffRow = null;
    if (dto.staff_id) {
      staffRow = await this.staff.findOne({
        where: { id: dto.staff_id, school_id: schoolId },
      });
    } else if (dto.employee_no) {
      staffRow = await this.staff.findOne({
        where: { employee_no: dto.employee_no, school_id: schoolId },
      });
    }

    if (!staffRow) throw AppException.notFound('Staff member not found', 'STAFF_NOT_FOUND');

    let academicYearId = dto.academic_year_id;
    if (!academicYearId) {
      try {
        academicYearId = await currentYearId(this.appraisals.manager, schoolId);
      } catch {
        academicYearId = 1;
      }
    }

    const te = dto.teaching_effectiveness !== undefined ? Number(dto.teaching_effectiveness) : 3.5;
    const so = dto.student_outcomes !== undefined ? Number(dto.student_outcomes) : 3.5;
    const cm = dto.classroom_management !== undefined ? Number(dto.classroom_management) : 3.5;
    const pc = dto.professional_conduct !== undefined ? Number(dto.professional_conduct) : 3.5;
    const ec = dto.extracurricular_contribution !== undefined ? Number(dto.extracurricular_contribution) : 3.5;

    let overallScore: number;
    if (dto.kra_scores && dto.kra_scores.length > 0) {
      let weightedSum = 0;
      let totalWeight = 0;
      for (const k of dto.kra_scores) {
        const sc = Number(k.score) || 0;
        const wt = Number(k.weightage) || 0;
        weightedSum += sc * wt;
        totalWeight += wt;
      }
      overallScore = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 10) / 10 : 3.5;
    } else {
      const total = te + so + cm + pc + ec;
      overallScore = Math.round((total / 5) * 10) / 10;
    }
    const overallRating = calculateRating(overallScore);

    const period = dto.period || '2026-27 Annual Review';
    const reviewDate = dto.review_date || new Date().toISOString().slice(0, 10);

    const saved = await this.appraisals.save(
      this.appraisals.create({
        school_id: schoolId,
        academic_year_id: academicYearId,
        staff_id: staffRow.id,
        user_id: staffRow.user_id,
        reviewer_user_id: reviewer.id,
        period,
        review_date: reviewDate,
        status: 'draft',
        teaching_effectiveness: te,
        student_outcomes: so,
        classroom_management: cm,
        professional_conduct: pc,
        extracurricular_contribution: ec,
        overall_score: overallScore,
        overall_rating: overallRating,
        kra_scores: dto.kra_scores ?? null,
        strengths: dto.strengths ?? null,
        areas_for_improvement: dto.areas_for_improvement ?? null,
        goals_next_period: dto.goals_next_period ?? null,
        reviewer_remarks: dto.reviewer_remarks ?? null,
        recommendation: dto.recommendation ?? 'increment',
        increment_percent: dto.increment_percent !== undefined ? Number(dto.increment_percent) : 0.0,
        expected_increment_percent:
          dto.expected_increment_percent !== undefined ? Number(dto.expected_increment_percent) : null,
        hike_justification: dto.hike_justification ?? null,
      }),
    );

    return (await this.presentMany([saved]))[0];
  }

  async bulkImport(schoolId: number, reviewer: AuthUser, dtos: StaffAppraisalInputDto[]): Promise<StaffAppraisalDto[]> {
    const results: StaffAppraisalDto[] = [];
    for (const dto of dtos) {
      try {
        const item = await this.create(schoolId, reviewer, dto);
        results.push(item);
      } catch (e) {
        this.logger.warn(`Bulk import row failed: ${(e as Error).message}`);
      }
    }
    return results;
  }

  async update(schoolId: number, id: number, dto: StaffAppraisalInputDto): Promise<StaffAppraisalDto> {
    const appraisal = await this.appraisals.findOne({
      where: { id, school_id: schoolId },
    });
    if (!appraisal) throw AppException.notFound('Staff appraisal not found', 'APPRAISAL_NOT_FOUND');
    if (appraisal.status === 'finalized') {
      throw AppException.badRequest('Finalized appraisals cannot be modified', 'APPRAISAL_FINALIZED');
    }

    const teachingEffectiveness = dto.teaching_effectiveness ?? appraisal.teaching_effectiveness;
    const studentOutcomes = dto.student_outcomes ?? appraisal.student_outcomes;
    const classroomManagement = dto.classroom_management ?? appraisal.classroom_management;
    const professionalConduct = dto.professional_conduct ?? appraisal.professional_conduct;
    const extracurricularContribution = dto.extracurricular_contribution ?? appraisal.extracurricular_contribution;

    let overallScore: number;
    if (dto.kra_scores && dto.kra_scores.length > 0) {
      let weightedSum = 0;
      let totalWeight = 0;
      for (const k of dto.kra_scores) {
        const sc = Number(k.score) || 0;
        const wt = Number(k.weightage) || 0;
        weightedSum += sc * wt;
        totalWeight += wt;
      }
      overallScore = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 10) / 10 : 3.5;
    } else {
      const total =
        Number(teachingEffectiveness) +
        Number(studentOutcomes) +
        Number(classroomManagement) +
        Number(professionalConduct) +
        Number(extracurricularContribution);
      overallScore = Math.round((total / 5) * 10) / 10;
    }
    const overallRating = calculateRating(overallScore);

    Object.assign(appraisal, {
      academic_year_id: dto.academic_year_id ?? appraisal.academic_year_id,
      period: dto.period ?? appraisal.period,
      review_date: dto.review_date ?? appraisal.review_date,
      teaching_effectiveness: teachingEffectiveness,
      student_outcomes: studentOutcomes,
      classroom_management: classroomManagement,
      professional_conduct: professionalConduct,
      extracurricular_contribution: extracurricularContribution,
      overall_score: overallScore,
      overall_rating: overallRating,
      kra_scores: dto.kra_scores !== undefined ? dto.kra_scores : appraisal.kra_scores,
      strengths: dto.strengths !== undefined ? dto.strengths : appraisal.strengths,
      areas_for_improvement:
        dto.areas_for_improvement !== undefined ? dto.areas_for_improvement : appraisal.areas_for_improvement,
      goals_next_period: dto.goals_next_period !== undefined ? dto.goals_next_period : appraisal.goals_next_period,
      reviewer_remarks: dto.reviewer_remarks !== undefined ? dto.reviewer_remarks : appraisal.reviewer_remarks,
      recommendation: dto.recommendation ?? appraisal.recommendation,
      increment_percent: dto.increment_percent ?? appraisal.increment_percent,
      expected_increment_percent:
        dto.expected_increment_percent !== undefined
          ? dto.expected_increment_percent
          : appraisal.expected_increment_percent,
      hike_justification: dto.hike_justification !== undefined ? dto.hike_justification : appraisal.hike_justification,
    });

    const saved = await this.appraisals.save(appraisal);
    return (await this.presentMany([saved]))[0];
  }

  async finalize(schoolId: number, id: number, actor: AuthUser): Promise<StaffAppraisalDto> {
    const appraisal = await this.appraisals.findOne({
      where: { id, school_id: schoolId },
    });
    if (!appraisal) throw AppException.notFound('Staff appraisal not found', 'APPRAISAL_NOT_FOUND');

    appraisal.status = 'finalized';
    appraisal.finalized_at = new Date();
    appraisal.finalized_by = actor.id;

    const saved = await this.appraisals.save(appraisal);
    return (await this.presentMany([saved]))[0];
  }

  async myAppraisals(schoolId: number, userId: number): Promise<StaffAppraisalDto[]> {
    const rows = await this.appraisals.find({
      where: { school_id: schoolId, user_id: userId },
      order: { review_date: 'DESC', id: 'DESC' },
    });
    return this.presentMany(rows);
  }

  async myAppraisal(schoolId: number, userId: number, id: number): Promise<StaffAppraisalDto> {
    const appraisal = await this.appraisals.findOne({
      where: { id, school_id: schoolId, user_id: userId },
    });
    if (!appraisal) throw AppException.notFound('Appraisal not found or not published', 'APPRAISAL_NOT_FOUND');
    return (await this.presentMany([appraisal]))[0];
  }

  async submitHikeRequest(
    schoolId: number,
    userId: number,
    id: number,
    dto: StaffHikeRequestDto,
  ): Promise<StaffAppraisalDto> {
    const appraisal = await this.appraisals.findOne({
      where: { id, school_id: schoolId, user_id: userId },
    });
    if (!appraisal) throw AppException.notFound('Appraisal not found', 'APPRAISAL_NOT_FOUND');
    if (appraisal.status === 'finalized') {
      throw AppException.badRequest('Cannot submit hike request for finalized appraisal', 'APPRAISAL_FINALIZED');
    }

    appraisal.expected_increment_percent = dto.expected_increment_percent;
    appraisal.hike_justification = dto.hike_justification;
    appraisal.status = 'submitted';

    const saved = await this.appraisals.save(appraisal);
    return (await this.presentMany([saved]))[0];
  }

  async addStaffRemarks(
    schoolId: number,
    userId: number,
    id: number,
    dto: StaffAppraisalCommentDto,
  ): Promise<StaffAppraisalDto> {
    const appraisal = await this.appraisals.findOne({
      where: { id, school_id: schoolId, user_id: userId, status: 'finalized' },
    });
    if (!appraisal) throw AppException.notFound('Appraisal not found', 'APPRAISAL_NOT_FOUND');

    appraisal.staff_remarks = dto.staff_remarks;
    const saved = await this.appraisals.save(appraisal);
    return (await this.presentMany([saved]))[0];
  }

  async raiseAppeal(schoolId: number, user: AuthUser, id: number, dto: AppraisalAppealDto): Promise<StaffAppraisalDto> {
    const appraisal = await this.appraisals.findOne({
      where: { id, school_id: schoolId },
    });
    if (!appraisal) throw AppException.notFound('Appraisal not found', 'APPRAISAL_NOT_FOUND');

    appraisal.status = 'appealed';
    appraisal.appeal_status = 'pending';
    appraisal.appeal_reason = dto.reason;
    if (dto.requested_hike !== undefined) {
      appraisal.appeal_requested_hike = dto.requested_hike;
    }
    appraisal.appealed_at = new Date();

    const saved = await this.appraisals.save(appraisal);
    this.logger.log(`Appraisal ${id} appealed by user ${user.id} with reason: ${dto.reason}`);
    return (await this.presentMany([saved]))[0];
  }

  async resolveAppeal(
    schoolId: number,
    reviewer: AuthUser,
    id: number,
    dto: ResolveAppealDto,
  ): Promise<StaffAppraisalDto> {
    const appraisal = await this.appraisals.findOne({
      where: { id, school_id: schoolId },
    });
    if (!appraisal) throw AppException.notFound('Appraisal not found', 'APPRAISAL_NOT_FOUND');

    appraisal.appeal_status = dto.decision === 'accept' ? 'resolved' : 'rejected';
    appraisal.appeal_feedback = dto.feedback;
    appraisal.appeal_resolved_at = new Date();
    appraisal.appeal_resolved_by = reviewer.id;

    if (dto.revised_rating) {
      appraisal.overall_rating = dto.revised_rating;
    }
    if (dto.revised_hike !== undefined) {
      appraisal.increment_percent = dto.revised_hike;
    }

    appraisal.status = 'finalized';
    appraisal.finalized_at = new Date();
    appraisal.finalized_by = reviewer.id;

    const saved = await this.appraisals.save(appraisal);
    this.logger.log(
      `Appraisal ${id} appeal resolved by ${reviewer.id}. Decision: ${dto.decision}, Final Hike: ${appraisal.increment_percent}%`,
    );
    return (await this.presentMany([saved]))[0];
  }

  async metrics(schoolId: number, staffId: number, academicYearId?: number): Promise<StaffPerformanceMetricsDto> {
    try {
      const staffRow = await this.staff.findOne({
        where: [
          { id: staffId, school_id: schoolId },
          { user_id: staffId, school_id: schoolId },
        ],
      });
      if (!staffRow) {
        this.logger.warn(`Staff member ${staffId} not found in school ${schoolId} for metrics`);
        return this.defaultMetrics(staffId);
      }

      const userRow = await this.users.findOne({ where: { id: staffRow.user_id } });

      // 1. Staff attendance records
      let totalWorkingDays = 0;
      let presentDays = 0;
      let absentDays = 0;
      let attendancePercentage = 100.0;
      try {
        const attResult = await this.appraisals.query(
          `SELECT 
             COUNT(*) FILTER (WHERE status = 'present') as present_days,
             COUNT(*) FILTER (WHERE status = 'absent' OR status = 'on_leave') as absent_days,
             COUNT(*) as total_days
           FROM staff_attendance
           WHERE school_id = $1 AND user_id = $2`,
          [schoolId, staffRow.user_id],
        );
        totalWorkingDays = Number(attResult[0]?.total_days ?? 0);
        presentDays = Number(attResult[0]?.present_days ?? 0);
        absentDays = Number(attResult[0]?.absent_days ?? 0);
        attendancePercentage = totalWorkingDays > 0 ? Math.round((presentDays / totalWorkingDays) * 1000) / 10 : 100.0;
      } catch (e) {
        this.logger.warn(`Staff attendance query failed: ${(e as Error).message}`);
      }

      // 2. Assigned teaching periods, sections & workload schedule
      const yearFilter = academicYearId ? 'AND ta.academic_year_id = $3' : '';
      const params: (number | string)[] = [schoolId, staffRow.user_id];
      if (academicYearId) params.push(academicYearId);

      let assignedPeriods = 0;
      let totalSections = 0;
      let teachingAssignments: TeachingAssignmentSummaryDto[] = [];
      try {
        const assignResult = await this.appraisals.query(
          `SELECT 
             COALESCE(SUM(ta.periods_per_week), 0) as total_periods,
             COUNT(DISTINCT ta.section_id) as total_sections
           FROM teacher_assignments ta
           WHERE ta.school_id = $1 AND ta.teacher_user_id = $2 AND ta.deleted_at IS NULL ${yearFilter}`,
          params,
        );
        assignedPeriods = Number(assignResult[0]?.total_periods ?? 0);
        totalSections = Number(assignResult[0]?.total_sections ?? 0);

        const teachingAssignmentsRaw = await this.appraisals.query(
          `SELECT 
             ta.id,
             c.name as class_name,
             sec.name as section_name,
             s.name as subject_name,
             ta.periods_per_week
           FROM teacher_assignments ta
           JOIN sections sec ON sec.id = ta.section_id
           JOIN classes c ON c.id = sec.class_id
           JOIN subjects s ON s.id = ta.subject_id
           WHERE ta.school_id = $1 AND ta.teacher_user_id = $2 AND ta.deleted_at IS NULL ${yearFilter}
           ORDER BY c.grade_level ASC, sec.name ASC, s.name ASC`,
          params,
        );
        teachingAssignments = teachingAssignmentsRaw.map((r: Record<string, unknown>) => ({
          id: Number(r.id),
          class_name: String(r.class_name),
          section_name: String(r.section_name),
          subject_name: String(r.subject_name),
          periods_per_week: Number(r.periods_per_week),
        }));
      } catch (e) {
        this.logger.warn(`Teaching assignments query failed: ${(e as Error).message}`);
      }

      // 3. Diary & Homework tracking
      let diaryEntriesCount = 0;
      let homeworkCount = 0;
      let recentHomework: RecentHomeworkItemDto[] = [];
      try {
        const diaryStats = await this.appraisals.query(
          `SELECT 
             COUNT(*) FILTER (WHERE type = 'homework') as homework_cnt,
             COUNT(*) as total_cnt
           FROM diary_entries
           WHERE school_id = $1 AND created_by = $2 AND deleted_at IS NULL`,
          [schoolId, staffRow.user_id],
        );
        diaryEntriesCount = Number(diaryStats[0]?.total_cnt ?? 0);
        homeworkCount = Number(diaryStats[0]?.homework_cnt ?? 0);

        const recentHomeworkRaw = await this.appraisals.query(
          `SELECT 
             de.id,
             de.title,
             de.due_date,
             de.created_at,
             s.name as subject_name,
             CONCAT(c.name, ' - ', sec.name) as class_section
           FROM diary_entries de
           LEFT JOIN subjects s ON s.id = de.subject_id
           LEFT JOIN sections sec ON sec.id = de.section_id
           LEFT JOIN classes c ON c.id = sec.class_id
           WHERE de.school_id = $1 AND de.created_by = $2 AND de.type = 'homework' AND de.deleted_at IS NULL
           ORDER BY de.created_at DESC
           LIMIT 5`,
          [schoolId, staffRow.user_id],
        );
        recentHomework = recentHomeworkRaw.map((r: Record<string, unknown>) => ({
          id: Number(r.id),
          title: String(r.title),
          due_date: r.due_date
            ? r.due_date instanceof Date
              ? r.due_date.toISOString().slice(0, 10)
              : String(r.due_date)
            : null,
          created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
          subject_name: r.subject_name ? String(r.subject_name) : null,
          class_section: r.class_section ? String(r.class_section) : null,
        }));
      } catch (e) {
        this.logger.warn(`Diary query failed: ${(e as Error).message}`);
      }

      // 4. Student academic outcomes: Pass % vs Fail % in subjects taught
      let totalStudentsEvaluated = 0;
      let passedStudents = 0;
      let failedStudents = 0;
      let averageStudentMarks: number | null = null;
      let studentPassPercentage: number | null = null;
      let studentFailPercentage: number | null = null;
      try {
        const examYearFilter = academicYearId ? 'AND ta.academic_year_id = $3' : '';
        const passResult = await this.appraisals.query(
          `SELECT 
             COUNT(*) FILTER (WHERE em.marks >= COALESCE(es.pass_marks, 35)) as passed_students,
             COUNT(*) FILTER (WHERE em.marks < COALESCE(es.pass_marks, 35) OR em.is_absent = true) as failed_students,
             COUNT(*) as total_students,
             ROUND(AVG(em.marks)::numeric, 1) as avg_marks
           FROM exam_marks em
           JOIN student_enrollments se ON se.student_id = em.student_id
           JOIN teacher_assignments ta ON ta.section_id = se.section_id AND ta.subject_id = em.subject_id
           LEFT JOIN exam_subjects es ON es.exam_id = em.exam_id AND es.subject_id = em.subject_id AND es.class_id = se.class_id
           WHERE em.school_id = $1 AND ta.teacher_user_id = $2 AND ta.deleted_at IS NULL ${examYearFilter}`,
          params,
        );
        totalStudentsEvaluated = Number(passResult[0]?.total_students ?? 0);
        passedStudents = Number(passResult[0]?.passed_students ?? 0);
        failedStudents = Number(passResult[0]?.failed_students ?? 0);
        averageStudentMarks = passResult[0]?.avg_marks !== null ? Number(passResult[0]?.avg_marks) : null;
        studentPassPercentage =
          totalStudentsEvaluated > 0 ? Math.round((passedStudents / totalStudentsEvaluated) * 1000) / 10 : null;
        studentFailPercentage =
          totalStudentsEvaluated > 0 ? Math.round((failedStudents / totalStudentsEvaluated) * 1000) / 10 : null;
      } catch (e) {
        this.logger.warn(`Exam marks query failed: ${(e as Error).message}`);
      }

      // 5. Parent rating and student feedback
      let parentRatingAvg: number | null = null;
      let parentRatingCount = 0;
      let studentFeedbackAvg: number | null = null;
      let studentFeedbackCount = 0;
      try {
        const parentRatingResult = await this.appraisals.query(
          `SELECT 
             ROUND(AVG(stars)::numeric, 1) as avg_stars,
             COUNT(*) as total_ratings
           FROM teacher_ratings
           WHERE school_id = $1 AND teacher_user_id = $2 AND deleted_at IS NULL`,
          [schoolId, staffRow.user_id],
        );
        parentRatingAvg = parentRatingResult[0]?.avg_stars ? Number(parentRatingResult[0].avg_stars) : null;
        parentRatingCount = Number(parentRatingResult[0]?.total_ratings ?? 0);

        const studentFeedbackResult = await this.appraisals.query(
          `SELECT 
             ROUND(AVG(studies)::numeric, 1) as avg_studies,
             COUNT(*) as total_feedback
           FROM student_feedback
           WHERE school_id = $1 AND teacher_user_id = $2 AND deleted_at IS NULL`,
          [schoolId, staffRow.user_id],
        );
        studentFeedbackAvg = studentFeedbackResult[0]?.avg_studies
          ? Number(studentFeedbackResult[0].avg_studies)
          : null;
        studentFeedbackCount = Number(studentFeedbackResult[0]?.total_feedback ?? 0);
      } catch (e) {
        this.logger.warn(`Feedback query failed: ${(e as Error).message}`);
      }

      return {
        staff_id: staffId,
        user_id: staffRow.user_id,
        name: userRow?.name ?? 'Staff',
        attendance_percentage: attendancePercentage,
        present_days: presentDays,
        absent_days: absentDays,
        total_working_days: totalWorkingDays,
        assigned_periods_per_week: assignedPeriods,
        total_sections_taught: totalSections,
        diary_entries_count: diaryEntriesCount,
        homework_count: homeworkCount,
        student_pass_percentage: studentPassPercentage,
        student_fail_percentage: studentFailPercentage,
        passed_students: passedStudents,
        failed_students: failedStudents,
        total_students_evaluated: totalStudentsEvaluated,
        average_student_marks: averageStudentMarks,
        parent_rating_average: parentRatingAvg,
        parent_rating_count: parentRatingCount,
        student_feedback_average: studentFeedbackAvg,
        student_feedback_count: studentFeedbackCount,
        teaching_assignments: teachingAssignments,
        recent_homework: recentHomework,
      };
    } catch (err) {
      this.logger.error(`Error loading metrics for staff ${staffId}: ${(err as Error).message}`);
      return this.defaultMetrics(staffId);
    }
  }

  private defaultMetrics(staffId: number): StaffPerformanceMetricsDto {
    return {
      staff_id: staffId,
      user_id: staffId,
      name: 'Staff',
      attendance_percentage: 100,
      present_days: 0,
      absent_days: 0,
      total_working_days: 0,
      assigned_periods_per_week: 0,
      total_sections_taught: 0,
      diary_entries_count: 0,
      homework_count: 0,
      student_pass_percentage: null,
      student_fail_percentage: null,
      passed_students: 0,
      failed_students: 0,
      total_students_evaluated: 0,
      average_student_marks: null,
      parent_rating_average: null,
      parent_rating_count: 0,
      student_feedback_average: null,
      student_feedback_count: 0,
      teaching_assignments: [],
      recent_homework: [],
    };
  }

  private async presentMany(rows: StaffAppraisal[]): Promise<StaffAppraisalDto[]> {
    if (!rows.length) return [];

    const staffIds = [...new Set(rows.map((r) => r.staff_id))];
    const userIds = [...new Set([...rows.map((r) => r.user_id), ...rows.map((r) => r.reviewer_user_id)])];

    const [staffList, usersList] = await Promise.all([
      this.staff.find({ where: { id: In(staffIds) } }),
      this.users.find({ where: { id: In(userIds) } }),
    ]);

    const staffMap = new Map(staffList.map((s) => [s.id, s]));
    const userMap = new Map(usersList.map((u) => [u.id, u]));

    return rows.map((row) => {
      const st = staffMap.get(row.staff_id);
      const staffUser = userMap.get(row.user_id);
      const reviewerUser = userMap.get(row.reviewer_user_id);

      return {
        id: row.id,
        academic_year_id: row.academic_year_id,
        staff_id: row.staff_id,
        user_id: row.user_id,
        staff: {
          id: row.user_id,
          name: staffUser?.name ?? 'Staff',
        },
        employee_no: st?.employee_no ?? '',
        designation: st?.designation ?? 'Teacher',
        department: st?.department ?? null,
        reviewer: {
          id: row.reviewer_user_id,
          name: reviewerUser?.name ?? 'Principal',
        },
        period: row.period,
        review_date: row.review_date,
        status: row.status,
        teaching_effectiveness: Number(row.teaching_effectiveness),
        student_outcomes: Number(row.student_outcomes),
        classroom_management: Number(row.classroom_management),
        professional_conduct: Number(row.professional_conduct),
        extracurricular_contribution: Number(row.extracurricular_contribution),
        overall_score: Number(row.overall_score),
        overall_rating: row.overall_rating,
        strengths: row.strengths,
        areas_for_improvement: row.areas_for_improvement,
        goals_next_period: row.goals_next_period,
        reviewer_remarks: row.reviewer_remarks,
        staff_remarks: row.staff_remarks,
        expected_increment_percent:
          row.expected_increment_percent !== null && row.expected_increment_percent !== undefined
            ? Number(row.expected_increment_percent)
            : null,
        hike_justification: row.hike_justification,
        recommendation: row.recommendation,
        increment_percent: Number(row.increment_percent),
        kra_scores: row.kra_scores ?? null,
        appeal_status: row.appeal_status ?? 'none',
        appeal_reason: row.appeal_reason ?? null,
        appeal_requested_hike:
          row.appeal_requested_hike !== null && row.appeal_requested_hike !== undefined
            ? Number(row.appeal_requested_hike)
            : null,
        appeal_feedback: row.appeal_feedback ?? null,
        appealed_at: row.appealed_at ?? null,
        appeal_resolved_at: row.appeal_resolved_at ?? null,
        appeal_resolved_by: row.appeal_resolved_by ?? null,
        finalized_at: row.finalized_at,
        created_at: row.created_at,
      };
    });
  }
}
