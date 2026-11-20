import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppException } from '@app/common';
import { KraConfig } from './entities/kra-config.entity';
import {
  BulkUpdateKraConfigDto,
  CreateKraConfigDto,
  KraConfigDto,
  UpdateKraConfigDto,
} from './dto/kra-config.dto';

export const DEFAULT_SCHOOL_KRAS = [
  {
    code: 'curriculum_pedagogy',
    title: 'Curriculum Delivery & Innovative Pedagogy',
    description:
      'Lesson plan completion, engaging pedagogy, smart board/digital tool integration, and practical exercises.',
    category: 'pedagogy' as const,
    weightage_percent: 25.0,
    min_score: 1.0,
    max_score: 5.0,
    applicable_to: 'teaching' as const,
    sort_order: 1,
  },
  {
    code: 'student_outcomes',
    title: 'Student Academic Growth & Exam Outcomes',
    description:
      'Class pass percentage, subject mastery, learning curve improvements, and remedial support for struggling students.',
    category: 'academics' as const,
    weightage_percent: 25.0,
    min_score: 1.0,
    max_score: 5.0,
    applicable_to: 'teaching' as const,
    sort_order: 2,
  },
  {
    code: 'classroom_management',
    title: 'Classroom Culture & Student Discipline',
    description:
      'Classroom decorum, student attendance adherence, positive behavioral reinforcement, and inclusive learning atmosphere.',
    category: 'administrative' as const,
    weightage_percent: 20.0,
    min_score: 1.0,
    max_score: 5.0,
    applicable_to: 'all' as const,
    sort_order: 3,
  },
  {
    code: 'parent_collaboration',
    title: 'Parent Communication & Feedback Index',
    description:
      'Regular homework and diary dispatch, proactive PTM participation, prompt query responses, and positive parent satisfaction index.',
    category: 'general' as const,
    weightage_percent: 15.0,
    min_score: 1.0,
    max_score: 5.0,
    applicable_to: 'all' as const,
    sort_order: 4,
  },
  {
    code: 'professional_conduct',
    title: 'Professional Conduct & School Initiatives',
    description:
      'Staff punctuality, participation in annual day/sports/science fairs, collegial mentorship, and professional upskilling.',
    category: 'extracurricular' as const,
    weightage_percent: 15.0,
    min_score: 1.0,
    max_score: 5.0,
    applicable_to: 'all' as const,
    sort_order: 5,
  },
];

@Injectable()
export class KraConfigService {
  private readonly logger = new Logger(KraConfigService.name);

  constructor(
    @InjectRepository(KraConfig)
    private readonly kraRepo: Repository<KraConfig>,
  ) {}

  async list(schoolId: number): Promise<KraConfigDto[]> {
    let rows = await this.kraRepo.find({
      where: { school_id: schoolId, is_active: true },
      order: { sort_order: 'ASC', id: 'ASC' },
    });

    if (rows.length === 0) {
      this.logger.log(`No active KRAs found for school ${schoolId}. Seeding standard default KRAs.`);
      rows = await this.seedDefaults(schoolId);
    }

    return rows.map((r) => this.present(r));
  }

  async create(schoolId: number, dto: CreateKraConfigDto): Promise<KraConfigDto> {
    const existing = await this.kraRepo.findOne({
      where: { school_id: schoolId, code: dto.code },
    });
    if (existing && existing.is_active) {
      throw AppException.badRequest(`KRA with code '${dto.code}' already exists for this school.`);
    }

    const kra = this.kraRepo.create({
      school_id: schoolId,
      code: dto.code,
      title: dto.title,
      description: dto.description ?? null,
      category: dto.category ?? 'academics',
      weightage_percent: dto.weightage_percent,
      min_score: dto.min_score ?? 1.0,
      max_score: dto.max_score ?? 5.0,
      applicable_to: dto.applicable_to ?? 'all',
      sort_order: dto.sort_order ?? 0,
      is_active: true,
    });

    const saved = await this.kraRepo.save(kra);
    return this.present(saved);
  }

  async update(schoolId: number, id: number, dto: UpdateKraConfigDto): Promise<KraConfigDto> {
    const kra = await this.kraRepo.findOne({
      where: { id, school_id: schoolId },
    });
    if (!kra) {
      throw AppException.notFound('KRA configuration not found');
    }

    if (dto.title !== undefined) kra.title = dto.title;
    if (dto.description !== undefined) kra.description = dto.description ?? null;
    if (dto.category !== undefined) kra.category = dto.category;
    if (dto.weightage_percent !== undefined) kra.weightage_percent = dto.weightage_percent;
    if (dto.min_score !== undefined) kra.min_score = dto.min_score;
    if (dto.max_score !== undefined) kra.max_score = dto.max_score;
    if (dto.applicable_to !== undefined) kra.applicable_to = dto.applicable_to;
    if (dto.sort_order !== undefined) kra.sort_order = dto.sort_order;
    if (dto.is_active !== undefined) kra.is_active = dto.is_active;

    const saved = await this.kraRepo.save(kra);
    return this.present(saved);
  }

  async bulkUpdate(schoolId: number, dto: BulkUpdateKraConfigDto): Promise<KraConfigDto[]> {
    for (const item of dto.items) {
      const kra = await this.kraRepo.findOne({ where: { id: item.id, school_id: schoolId } });
      if (kra) {
        kra.weightage_percent = item.weightage_percent;
        if (item.sort_order !== undefined) kra.sort_order = item.sort_order;
        if (item.is_active !== undefined) kra.is_active = item.is_active;
        await this.kraRepo.save(kra);
      }
    }
    return this.list(schoolId);
  }

  async delete(schoolId: number, id: number): Promise<void> {
    const kra = await this.kraRepo.findOne({ where: { id, school_id: schoolId } });
    if (!kra) throw AppException.notFound('KRA configuration not found');
    kra.is_active = false;
    await this.kraRepo.save(kra);
  }

  async resetDefaults(schoolId: number): Promise<KraConfigDto[]> {
    await this.kraRepo.update({ school_id: schoolId }, { is_active: false });
    const created = await this.seedDefaults(schoolId);
    return created.map((r) => this.present(r));
  }

  private async seedDefaults(schoolId: number): Promise<KraConfig[]> {
    const entities = DEFAULT_SCHOOL_KRAS.map((def) =>
      this.kraRepo.create({
        school_id: schoolId,
        code: def.code,
        title: def.title,
        description: def.description,
        category: def.category,
        weightage_percent: def.weightage_percent,
        min_score: def.min_score,
        max_score: def.max_score,
        applicable_to: def.applicable_to,
        sort_order: def.sort_order,
        is_active: true,
      }),
    );
    return this.kraRepo.save(entities);
  }

  private present(entity: KraConfig): KraConfigDto {
    return {
      id: entity.id,
      school_id: entity.school_id,
      academic_year_id: entity.academic_year_id,
      code: entity.code,
      title: entity.title,
      description: entity.description,
      category: entity.category,
      weightage_percent: Number(entity.weightage_percent),
      min_score: Number(entity.min_score),
      max_score: Number(entity.max_score),
      applicable_to: entity.applicable_to,
      sort_order: entity.sort_order,
      is_active: entity.is_active,
      created_at: entity.created_at ? new Date(entity.created_at).toISOString() : new Date().toISOString(),
      updated_at: entity.updated_at ? new Date(entity.updated_at).toISOString() : new Date().toISOString(),
    };
  }
}
