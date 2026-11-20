import { EntityManager } from 'typeorm';
import { School } from '../../modules/schools/entities/school.entity';
import { AcademicYear } from '../../modules/setup/entities/academic-year.entity';
import { StaffAppraisal } from '../../modules/staff/entities/staff-appraisal.entity';
import { Staff } from '../../modules/staff/entities/staff.entity';
import { User } from '../../modules/users/entities/user.entity';

export async function seedDemoAppraisals(manager: EntityManager, school: School): Promise<void> {
  const activeYear = await manager.findOne(AcademicYear, {
    where: { school_id: school.id, status: 'active' },
    order: { id: 'DESC' },
  });
  if (!activeYear) return;

  const principalUser = await manager.findOne(User, {
    where: { mobile: '9000000001' },
  });
  const reviewerUserId = principalUser ? principalUser.id : 1;

  const teachingStaff = await manager.find(Staff, {
    where: { school_id: school.id, staff_type: 'teaching' },
    relations: ['user'],
    take: 4,
  });
  if (!teachingStaff.length) return;

  const appraisalRepo = manager.getRepository(StaffAppraisal);

  const existingCount = await appraisalRepo.count({
    where: { school_id: school.id, academic_year_id: activeYear.id },
  });
  if (existingCount > 0) return;

  const demoAppraisalsData = [
    {
      staff: teachingStaff[0],
      period: `${activeYear.name} Annual Review`,
      review_date: new Date().toISOString().slice(0, 10),
      status: 'finalized' as const,
      teaching_effectiveness: 4.9,
      student_outcomes: 4.8,
      classroom_management: 4.7,
      professional_conduct: 4.9,
      extracurricular_contribution: 4.6,
      overall_score: 4.8,
      overall_rating: 'outstanding' as const,
      strengths: 'Exceptional subject mastery, innovative teaching aids, and high student engagement.',
      areas_for_improvement: 'Continue mentoring junior faculty members in lesson planning.',
      goals_next_period: 'Publish department question bank and conduct remedial sessions.',
      reviewer_remarks:
        'Teacher requested 50% hike. While teaching outcomes and board results are exemplary, annual school increment ceiling is 15%. Approved highest tier 15% increment with performance recognition.',
      staff_remarks:
        'Thank you management for the review and approving the 15% top-tier increment. I will continue organizing the math olympiad workshops.',
      expected_increment_percent: 50.0,
      hike_justification:
        'Led high school mathematics team to national championship, achieved 100% board exam distinctions, and conducted weekend remedial batches.',
      recommendation: 'increment' as const,
      increment_percent: 15.0,
      finalized_at: new Date(),
      finalized_by: reviewerUserId,
    },
    {
      staff: teachingStaff[1],
      period: `${activeYear.name} Annual Review`,
      review_date: new Date().toISOString().slice(0, 10),
      status: 'finalized' as const,
      teaching_effectiveness: 4.2,
      student_outcomes: 4.3,
      classroom_management: 4.0,
      professional_conduct: 4.5,
      extracurricular_contribution: 4.0,
      overall_score: 4.2,
      overall_rating: 'exceeds_expectations' as const,
      strengths: 'Punctual, well-structured lesson plans, and strong rapport with parents.',
      areas_for_improvement: 'Adopt more digital interactive tools in the classroom.',
      goals_next_period: 'Lead the science exhibition and organize inter-school quiz competition.',
      reviewer_remarks: 'Solid and dependable educator with great parent feedback. Approved 10% increment.',
      staff_remarks: 'I acknowledge the feedback and will integrate smart classroom tools.',
      expected_increment_percent: 15.0,
      hike_justification: 'Coordinated district science expo resulting in 2 state-level prizes.',
      recommendation: 'increment' as const,
      increment_percent: 10.0,
      finalized_at: new Date(),
      finalized_by: reviewerUserId,
    },
    {
      staff: teachingStaff[2],
      period: `${activeYear.name} Annual Review`,
      review_date: new Date().toISOString().slice(0, 10),
      status: 'submitted' as const,
      teaching_effectiveness: 4.4,
      student_outcomes: 4.2,
      classroom_management: 4.3,
      professional_conduct: 4.5,
      extracurricular_contribution: 4.0,
      overall_score: 4.3,
      overall_rating: 'exceeds_expectations' as const,
      strengths: 'Active participation in morning assemblies, debate club, and sports day coordination.',
      areas_for_improvement: 'Introduce structured weekly homework revision plans.',
      goals_next_period: 'Achieve 100% pass rate in mid-term and board assessments.',
      reviewer_remarks: null,
      staff_remarks: null,
      expected_increment_percent: 50.0,
      hike_justification:
        'Requested 50% salary increment for managing literary club, coaching quiz teams to state finals, and achieving 98% class pass rate.',
      recommendation: 'increment' as const,
      increment_percent: 0.0,
      finalized_at: null,
      finalized_by: null,
    },
  ];

  for (const item of demoAppraisalsData) {
    if (!item.staff) continue;
    const appraisal = appraisalRepo.create({
      school_id: school.id,
      academic_year_id: activeYear.id,
      staff_id: item.staff.id,
      user_id: item.staff.user_id,
      reviewer_user_id: reviewerUserId,
      period: item.period,
      review_date: item.review_date,
      status: item.status,
      teaching_effectiveness: item.teaching_effectiveness,
      student_outcomes: item.student_outcomes,
      classroom_management: item.classroom_management,
      professional_conduct: item.professional_conduct,
      extracurricular_contribution: item.extracurricular_contribution,
      overall_score: item.overall_score,
      overall_rating: item.overall_rating,
      strengths: item.strengths,
      areas_for_improvement: item.areas_for_improvement,
      goals_next_period: item.goals_next_period,
      reviewer_remarks: item.reviewer_remarks,
      staff_remarks: item.staff_remarks,
      expected_increment_percent: item.expected_increment_percent,
      hike_justification: item.hike_justification,
      recommendation: item.recommendation,
      increment_percent: item.increment_percent,
      finalized_at: item.finalized_at,
      finalized_by: item.finalized_by,
    });
    await appraisalRepo.save(appraisal);
  }
}
