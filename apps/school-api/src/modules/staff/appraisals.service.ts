import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AppException, AuthUser, Paginated, listQuery } from '@app/common';
import { StaffAppraisal, OverallRating } from './entities/staff-appraisal.entity';
import { Staff } from './entities/staff.entity';
import { User } from '../users/entities/user.entity';
import {
  AppraisalQueryDto,
  StaffAppraisalCommentDto,
  StaffAppraisalDto,
  StaffAppraisalInputDto,
} from './dto/staff-appraisal.dto';

export function calculateRating(score: number): OverallRating {
  if (score >= 4.6) return 'outstanding';
  if (score >= 3.8) return 'exceeds_expectations';
  if (score >= 3.0) return 'meets_expectations';
  if (score >= 2.0) return 'needs_improvement';
  return 'unsatisfactory';
}

@Injectable()
export class AppraisalsService {
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
    const staffRow = await this.staff.findOne({
      where: { id: dto.staff_id, school_id: schoolId },
    });
    if (!staffRow) throw AppException.notFound('Staff member not found', 'STAFF_NOT_FOUND');

    const total =
      Number(dto.teaching_effectiveness) +
      Number(dto.student_outcomes) +
      Number(dto.classroom_management) +
      Number(dto.professional_conduct) +
      Number(dto.extracurricular_contribution);
    const overallScore = Math.round((total / 5) * 10) / 10;
    const overallRating = calculateRating(overallScore);

    const saved = await this.appraisals.save(
      this.appraisals.create({
        school_id: schoolId,
        academic_year_id: dto.academic_year_id,
        staff_id: dto.staff_id,
        user_id: staffRow.user_id,
        reviewer_user_id: reviewer.id,
        period: dto.period,
        review_date: dto.review_date,
        status: 'draft',
        teaching_effectiveness: dto.teaching_effectiveness,
        student_outcomes: dto.student_outcomes,
        classroom_management: dto.classroom_management,
        professional_conduct: dto.professional_conduct,
        extracurricular_contribution: dto.extracurricular_contribution,
        overall_score: overallScore,
        overall_rating: overallRating,
        strengths: dto.strengths ?? null,
        areas_for_improvement: dto.areas_for_improvement ?? null,
        goals_next_period: dto.goals_next_period ?? null,
        reviewer_remarks: dto.reviewer_remarks ?? null,
        recommendation: dto.recommendation ?? 'increment',
        increment_percent: dto.increment_percent ?? 0.0,
      }),
    );

    return (await this.presentMany([saved]))[0];
  }

  async update(schoolId: number, id: number, dto: StaffAppraisalInputDto): Promise<StaffAppraisalDto> {
    const appraisal = await this.appraisals.findOne({
      where: { id, school_id: schoolId },
    });
    if (!appraisal) throw AppException.notFound('Staff appraisal not found', 'APPRAISAL_NOT_FOUND');
    if (appraisal.status === 'finalized') {
      throw AppException.badRequest('Finalized appraisals cannot be modified', 'APPRAISAL_FINALIZED');
    }

    const total =
      Number(dto.teaching_effectiveness) +
      Number(dto.student_outcomes) +
      Number(dto.classroom_management) +
      Number(dto.professional_conduct) +
      Number(dto.extracurricular_contribution);
    const overallScore = Math.round((total / 5) * 10) / 10;
    const overallRating = calculateRating(overallScore);

    Object.assign(appraisal, {
      academic_year_id: dto.academic_year_id,
      period: dto.period,
      review_date: dto.review_date,
      teaching_effectiveness: dto.teaching_effectiveness,
      student_outcomes: dto.student_outcomes,
      classroom_management: dto.classroom_management,
      professional_conduct: dto.professional_conduct,
      extracurricular_contribution: dto.extracurricular_contribution,
      overall_score: overallScore,
      overall_rating: overallRating,
      strengths: dto.strengths ?? appraisal.strengths,
      areas_for_improvement: dto.areas_for_improvement ?? appraisal.areas_for_improvement,
      goals_next_period: dto.goals_next_period ?? appraisal.goals_next_period,
      reviewer_remarks: dto.reviewer_remarks ?? appraisal.reviewer_remarks,
      recommendation: dto.recommendation ?? appraisal.recommendation,
      increment_percent: dto.increment_percent ?? appraisal.increment_percent,
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
      where: { school_id: schoolId, user_id: userId, status: 'finalized' },
      order: { review_date: 'DESC', id: 'DESC' },
    });
    return this.presentMany(rows);
  }

  async myAppraisal(schoolId: number, userId: number, id: number): Promise<StaffAppraisalDto> {
    const appraisal = await this.appraisals.findOne({
      where: { id, school_id: schoolId, user_id: userId, status: 'finalized' },
    });
    if (!appraisal) throw AppException.notFound('Appraisal not found or not published', 'APPRAISAL_NOT_FOUND');
    return (await this.presentMany([appraisal]))[0];
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
        recommendation: row.recommendation,
        increment_percent: Number(row.increment_percent),
        finalized_at: row.finalized_at,
        created_at: row.created_at,
      };
    });
  }
}
