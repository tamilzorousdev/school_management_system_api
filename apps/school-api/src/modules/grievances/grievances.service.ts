import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AppException, applySearch, applySort, AuthUser, offset, paginate, Paginated } from '@app/common';
import { User } from '../users/entities/user.entity';
import { Student } from '../students/entities/student.entity';
import { StudentEnrollment } from '../students/entities/student-enrollment.entity';
import {
  AddGrievanceNoteDto,
  AssignGrievanceDto,
  CreateGrievanceDto,
  EscalateGrievanceDto,
  GrievanceDetailDto,
  GrievanceInsightsDto,
  GrievanceItemDto,
  GrievanceQueryDto,
  GrievanceRefDto,
  GrievanceTimelineItemDto,
  ResolveGrievanceDto,
  UpdateGrievanceStatusDto,
} from './dto/grievance.dto';
import { Grievance, GrievanceCategory, GrievanceStatus } from './entities/grievance.entity';
import { GrievanceTimeline } from './entities/grievance-timeline.entity';
import { GrievanceAttachment } from './entities/grievance-attachment.entity';
import {
  computeSlaDueDate,
  defaultSlaHours,
  formatTicketNumber,
  isSlaBreached,
  parseTicketSequence,
} from './grievances.logic';
import { NotificationsService } from '../notifications/notifications.service';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import { ROLES } from '../access/access.catalog';

interface StudentInfo {
  name: string;
  admission_no: string;
  class_section: string | null;
}

@Injectable()
export class GrievancesService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Grievance)
    private readonly grievances: Repository<Grievance>,
    @InjectRepository(GrievanceTimeline)
    private readonly timeline: Repository<GrievanceTimeline>,
    @InjectRepository(GrievanceAttachment)
    private readonly attachments: Repository<GrievanceAttachment>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Student)
    private readonly students: Repository<Student>,
    @InjectRepository(StudentEnrollment)
    private readonly enrollments: Repository<StudentEnrollment>,
    private readonly notify: NotificationsService,
  ) {}

  async list(schoolId: number, query: GrievanceQueryDto): Promise<Paginated<GrievanceItemDto>> {
    const qb = this.grievances.createQueryBuilder('g');
    qb.where('g.school_id = :schoolId', { schoolId });

    if (query.status) {
      qb.andWhere('g.status = :status', { status: query.status });
    }
    if (query.category) {
      qb.andWhere('g.category = :category', { category: query.category });
    }
    if (query.priority) {
      qb.andWhere('g.priority = :priority', { priority: query.priority });
    }
    if (query.assigned_to) {
      qb.andWhere('g.assigned_to_user_id = :assignedTo', { assignedTo: query.assigned_to });
    }
    if (query.sla_breached === true) {
      qb.andWhere('g.sla_due_at < :now AND g.status NOT IN (:...closedStatuses)', {
        now: new Date(),
        closedStatuses: ['resolved', 'closed'],
      });
    } else if (query.sla_breached === false) {
      qb.andWhere('(g.sla_due_at >= :now OR g.status IN (:...closedStatuses))', {
        now: new Date(),
        closedStatuses: ['resolved', 'closed'],
      });
    }

    applySearch(qb, query.search, [
      'g.ticket_no',
      'g.subject',
      'g.description',
      'g.complainant_name',
      'g.complainant_mobile',
    ]);

    applySort(qb, query, {
      sortable: {
        created_at: 'g.created_at',
        sla_due_at: 'g.sla_due_at',
        priority: 'g.priority',
        status: 'g.status',
        ticket_no: 'g.ticket_no',
      },
      defaultSort: 'created_at',
    });

    qb.skip(offset(query.page, query.limit)).take(query.limit);
    const [rows, total] = await qb.getManyAndCount();

    const userIds = rows.map((row) => row.assigned_to_user_id).filter((id): id is number => Boolean(id));
    const studentIds = rows.map((row) => row.student_id).filter((id): id is number => Boolean(id));

    const [userMap, studentMap] = await Promise.all([
      this.loadUserMap(userIds),
      this.loadStudentMap(schoolId, studentIds),
    ]);

    const items = rows.map((row) => this.mapToItem(row, userMap, studentMap));
    return paginate([items, total], query.page, query.limit);
  }

  async insights(schoolId: number): Promise<GrievanceInsightsDto> {
    const qb = this.grievances.createQueryBuilder('g').where('g.school_id = :schoolId', { schoolId });

    const rows = await qb
      .select(['g.id', 'g.category', 'g.status', 'g.sla_due_at', 'g.created_at', 'g.resolved_at'])
      .getMany();

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    let totalOpen = 0;
    let slaBreached = 0;
    let inProgress = 0;
    let resolvedThisMonth = 0;
    let resolutionHoursTotal = 0;
    let resolvedCount = 0;

    const byCategory: Record<GrievanceCategory, number> = {
      transport: 0,
      academics: 0,
      safety_bullying: 0,
      fees_billing: 0,
      facilities: 0,
      staff_conduct: 0,
      workplace_staff: 0,
      other: 0,
    };

    for (const r of rows) {
      if (byCategory[r.category] !== undefined) {
        byCategory[r.category]++;
      }

      const isOpen = r.status !== 'resolved' && r.status !== 'closed';
      if (isOpen) {
        totalOpen++;
        if (new Date(r.sla_due_at).getTime() < now.getTime()) {
          slaBreached++;
        }
      }
      if (r.status === 'in_progress') {
        inProgress++;
      }
      if (r.resolved_at && new Date(r.resolved_at) >= startOfMonth) {
        resolvedThisMonth++;
      }
      if (r.resolved_at) {
        const diffMs = new Date(r.resolved_at).getTime() - new Date(r.created_at).getTime();
        resolutionHoursTotal += Math.max(0, diffMs / (1000 * 60 * 60));
        resolvedCount++;
      }
    }

    const avgResolutionHours = resolvedCount > 0 ? Math.round((resolutionHoursTotal / resolvedCount) * 10) / 10 : null;

    return {
      total_open: totalOpen,
      sla_breached: slaBreached,
      in_progress: inProgress,
      resolved_this_month: resolvedThisMonth,
      avg_resolution_hours: avgResolutionHours,
      by_category: byCategory,
    };
  }

  async getById(schoolId: number, id: number): Promise<GrievanceDetailDto> {
    const grievance = await this.grievances.findOne({
      where: { id, school_id: schoolId },
    });
    if (!grievance) {
      throw AppException.notFound('Grievance ticket not found', 'GRIEVANCE_NOT_FOUND');
    }

    const [timelineItems, attachmentItems, userMap, studentMap] = await Promise.all([
      this.timeline.find({
        where: { grievance_id: id, school_id: schoolId },
        order: { created_at: 'ASC' },
      }),
      this.attachments.find({
        where: { grievance_id: id, school_id: schoolId },
        order: { created_at: 'ASC' },
      }),
      this.loadUserMap(grievance.assigned_to_user_id ? [grievance.assigned_to_user_id] : []),
      this.loadStudentMap(schoolId, grievance.student_id ? [grievance.student_id] : []),
    ]);

    const item = this.mapToItem(grievance, userMap, studentMap);

    const timeline = timelineItems.map((t) => ({
      id: t.id,
      actor_name: t.actor_name,
      actor_role: t.actor_role,
      action: t.action,
      from_status: t.from_status,
      to_status: t.to_status,
      message: t.message,
      is_internal: t.is_internal,
      created_at: t.created_at.toISOString(),
    }));

    const attachments = attachmentItems.map((a) => ({
      id: a.id,
      file_name: a.file_name,
      file_url: a.file_url,
      file_size: a.file_size ?? undefined,
      mime_type: a.mime_type ?? undefined,
      is_internal: a.is_internal,
      uploaded_at: a.created_at.toISOString(),
    }));

    const internalNotes = timeline.filter((t) => t.is_internal);

    return {
      ...item,
      timeline,
      attachments,
      linked_entity_type: grievance.linked_entity_type,
      linked_entity_id: grievance.linked_entity_id,
      linked_entity_label: grievance.linked_entity_label,
      internal_notes: internalNotes,
    };
  }

  async create(schoolId: number, dto: CreateGrievanceDto, actor: AuthUser): Promise<GrievanceDetailDto> {
    const slaHours = dto.sla_hours || defaultSlaHours(dto.category, dto.priority);
    const slaDueAt = computeSlaDueDate(slaHours);
    const currentYear = new Date().getFullYear();

    const latest = await this.grievances
      .createQueryBuilder('g')
      .where('g.school_id = :schoolId', { schoolId })
      .andWhere('g.ticket_no LIKE :pattern', { pattern: `GRV-${currentYear}-%` })
      .orderBy('g.id', 'DESC')
      .getOne();

    const sequence = latest ? (parseTicketSequence(latest.ticket_no) ?? 0) + 1 : 1;
    const ticketNo = formatTicketNumber(currentYear, sequence);

    const isAnonymous = Boolean(dto.is_anonymous);
    const complainantName = isAnonymous ? null : dto.complainant_name || null;
    const complainantMobile = isAnonymous ? null : dto.complainant_mobile || null;

    const entity = this.grievances.create({
      school_id: schoolId,
      ticket_no: ticketNo,
      complainant_type: dto.complainant_type,
      complainant_user_id: isAnonymous ? null : actor.id || null,
      complainant_name: complainantName,
      complainant_mobile: complainantMobile,
      student_id: dto.student_id || null,
      category: dto.category,
      subcategory: dto.subcategory || null,
      priority: dto.priority,
      is_anonymous: isAnonymous,
      subject: dto.subject,
      description: dto.description,
      status: 'submitted',
      assigned_to_user_id: dto.assigned_to_user_id || null,
      assigned_at: dto.assigned_to_user_id ? new Date() : null,
      sla_due_at: slaDueAt,
      linked_entity_type: dto.linked_entity_type || null,
      linked_entity_id: dto.linked_entity_id || null,
      created_by: actor.id,
    });

    const saved = await this.grievances.save(entity);

    await this.timeline.save(
      this.timeline.create({
        school_id: schoolId,
        grievance_id: saved.id,
        actor_user_id: actor.id,
        actor_name: actor.name,
        actor_role: actor.roles?.[0] ?? null,
        action: 'submitted',
        from_status: null,
        to_status: 'submitted',
        message: 'Grievance ticket registered',
        is_internal: false,
      }),
    );

    if (dto.assigned_to_user_id) {
      const assignedUser = await this.users.findOne({ where: { id: dto.assigned_to_user_id } });
      await this.timeline.save(
        this.timeline.create({
          school_id: schoolId,
          grievance_id: saved.id,
          actor_user_id: actor.id,
          actor_name: actor.name,
          actor_role: actor.roles?.[0] ?? null,
          action: 'assigned',
          from_status: 'submitted',
          to_status: 'submitted',
          message: `Assigned to ${assignedUser ? assignedUser.name : 'Officer'}`,
          is_internal: false,
        }),
      );
    }

    void this.notify
      .dispatch({
        template: TEMPLATES.GRIEVANCE_NEW,
        audience: { roles: [ROLES.ADMIN, ROLES.PRINCIPAL, ROLES.AO], school_id: schoolId },
        data: {
          ticket_no: saved.ticket_no,
          complainant: complainantName || 'Anonymous',
          priority: saved.priority,
          subject: saved.subject,
          id: String(saved.id),
        },
      })
      .catch(() => {});

    return this.getById(schoolId, saved.id);
  }

  async assign(schoolId: number, id: number, dto: AssignGrievanceDto, actor: AuthUser): Promise<GrievanceDetailDto> {
    const grievance = await this.grievances.findOne({ where: { id, school_id: schoolId } });
    if (!grievance) {
      throw AppException.notFound('Grievance ticket not found', 'GRIEVANCE_NOT_FOUND');
    }

    const targetUser = await this.users.findOne({ where: { id: dto.assigned_to_user_id } });
    if (!targetUser) {
      throw AppException.badRequest('Assigned user not found', 'USER_NOT_FOUND');
    }

    const fromStatus = grievance.status;
    const toStatus: GrievanceStatus = grievance.status === 'submitted' ? 'acknowledged' : grievance.status;

    grievance.assigned_to_user_id = dto.assigned_to_user_id;
    grievance.assigned_at = new Date();
    grievance.status = toStatus;

    await this.grievances.save(grievance);

    const message = dto.note || `Assigned to ${targetUser.name}`;

    await this.timeline.save(
      this.timeline.create({
        school_id: schoolId,
        grievance_id: id,
        actor_user_id: actor.id,
        actor_name: actor.name,
        actor_role: actor.roles?.[0] ?? null,
        action: 'assigned',
        from_status: fromStatus,
        to_status: toStatus,
        message,
        is_internal: false,
      }),
    );

    void this.notify
      .dispatch({
        template: TEMPLATES.GRIEVANCE_ASSIGNED,
        audience: { user_ids: [dto.assigned_to_user_id], school_id: schoolId },
        data: {
          ticket_no: grievance.ticket_no,
          subject: grievance.subject,
          id: String(grievance.id),
        },
      })
      .catch(() => {});

    return this.getById(schoolId, id);
  }

  async updateStatus(
    schoolId: number,
    id: number,
    dto: UpdateGrievanceStatusDto,
    actor: AuthUser,
  ): Promise<GrievanceDetailDto> {
    const grievance = await this.grievances.findOne({ where: { id, school_id: schoolId } });
    if (!grievance) {
      throw AppException.notFound('Grievance ticket not found', 'GRIEVANCE_NOT_FOUND');
    }

    const fromStatus = grievance.status;
    grievance.status = dto.status;
    if (dto.status === 'resolved' && !grievance.resolved_at) {
      grievance.resolved_at = new Date();
    }

    await this.grievances.save(grievance);

    await this.timeline.save(
      this.timeline.create({
        school_id: schoolId,
        grievance_id: id,
        actor_user_id: actor.id,
        actor_name: actor.name,
        actor_role: actor.roles?.[0] ?? null,
        action: 'status_changed',
        from_status: fromStatus,
        to_status: dto.status,
        message: dto.note || `Status updated from ${fromStatus} to ${dto.status}`,
        is_internal: false,
      }),
    );

    return this.getById(schoolId, id);
  }

  async addNote(
    schoolId: number,
    id: number,
    dto: AddGrievanceNoteDto,
    actor: AuthUser,
  ): Promise<GrievanceTimelineItemDto> {
    const grievance = await this.grievances.findOne({ where: { id, school_id: schoolId } });
    if (!grievance) {
      throw AppException.notFound('Grievance ticket not found', 'GRIEVANCE_NOT_FOUND');
    }

    const created = await this.timeline.save(
      this.timeline.create({
        school_id: schoolId,
        grievance_id: id,
        actor_user_id: actor.id,
        actor_name: actor.name,
        actor_role: actor.roles?.[0] ?? null,
        action: dto.is_internal ? 'internal_note' : 'public_note',
        from_status: grievance.status,
        to_status: grievance.status,
        message: dto.note,
        is_internal: Boolean(dto.is_internal),
      }),
    );

    return {
      id: created.id,
      actor_name: created.actor_name,
      actor_role: created.actor_role,
      action: created.action,
      from_status: created.from_status,
      to_status: created.to_status,
      message: created.message,
      is_internal: created.is_internal,
      created_at: created.created_at.toISOString(),
    };
  }

  async resolve(schoolId: number, id: number, dto: ResolveGrievanceDto, actor: AuthUser): Promise<GrievanceDetailDto> {
    const grievance = await this.grievances.findOne({ where: { id, school_id: schoolId } });
    if (!grievance) {
      throw AppException.notFound('Grievance ticket not found', 'GRIEVANCE_NOT_FOUND');
    }

    const fromStatus = grievance.status;
    grievance.status = 'resolved';
    grievance.resolution_summary = dto.resolution_summary;
    grievance.resolved_at = new Date();

    await this.grievances.save(grievance);

    await this.timeline.save(
      this.timeline.create({
        school_id: schoolId,
        grievance_id: id,
        actor_user_id: actor.id,
        actor_name: actor.name,
        actor_role: actor.roles?.[0] ?? null,
        action: 'resolved',
        from_status: fromStatus,
        to_status: 'resolved',
        message: dto.resolution_summary,
        is_internal: false,
      }),
    );

    if (dto.notify_complainant !== false && grievance.complainant_user_id) {
      void this.notify
        .dispatch({
          template: TEMPLATES.GRIEVANCE_RESOLVED,
          audience: { user_ids: [grievance.complainant_user_id], school_id: schoolId },
          data: {
            ticket_no: grievance.ticket_no,
            subject: grievance.subject,
            id: String(grievance.id),
          },
        })
        .catch(() => {});
    }

    return this.getById(schoolId, id);
  }

  async escalate(
    schoolId: number,
    id: number,
    dto: EscalateGrievanceDto,
    actor: AuthUser,
  ): Promise<GrievanceDetailDto> {
    const grievance = await this.grievances.findOne({ where: { id, school_id: schoolId } });
    if (!grievance) {
      throw AppException.notFound('Grievance ticket not found', 'GRIEVANCE_NOT_FOUND');
    }

    const fromStatus = grievance.status;
    grievance.status = 'escalated';
    grievance.escalated_at = new Date();
    grievance.escalation_reason = dto.reason;

    await this.grievances.save(grievance);

    await this.timeline.save(
      this.timeline.create({
        school_id: schoolId,
        grievance_id: id,
        actor_user_id: actor.id,
        actor_name: actor.name,
        actor_role: actor.roles?.[0] ?? null,
        action: 'escalated',
        from_status: fromStatus,
        to_status: 'escalated',
        message: `Escalated: ${dto.reason}`,
        is_internal: false,
      }),
    );

    return this.getById(schoolId, id);
  }

  private mapToItem(
    entity: Grievance,
    userMap: Map<number, GrievanceRefDto>,
    studentMap: Map<number, StudentInfo>,
  ): GrievanceItemDto {
    const assignedUser = entity.assigned_to_user_id ? userMap.get(entity.assigned_to_user_id) : null;
    const student = entity.student_id ? studentMap.get(entity.student_id) : null;
    const breached = isSlaBreached(new Date(entity.sla_due_at), entity.status, entity.resolved_at);

    return {
      id: entity.id,
      ticket_no: entity.ticket_no,
      school_id: entity.school_id,
      complainant_type: entity.complainant_type,
      complainant_name: entity.is_anonymous ? null : entity.complainant_name,
      complainant_mobile: entity.is_anonymous ? null : entity.complainant_mobile,
      student_id: entity.student_id,
      student_name: student?.name ?? null,
      student_admission_no: student?.admission_no ?? null,
      class_section: student?.class_section ?? null,
      category: entity.category,
      subcategory: entity.subcategory,
      priority: entity.priority,
      is_anonymous: entity.is_anonymous,
      subject: entity.subject,
      description: entity.description,
      status: entity.status,
      assigned_to: assignedUser ?? null,
      assigned_at: entity.assigned_at ? entity.assigned_at.toISOString() : null,
      sla_due_at: entity.sla_due_at.toISOString(),
      is_sla_breached: breached,
      escalated_at: entity.escalated_at ? entity.escalated_at.toISOString() : null,
      escalation_reason: entity.escalation_reason,
      resolution_summary: entity.resolution_summary,
      resolved_at: entity.resolved_at ? entity.resolved_at.toISOString() : null,
      satisfaction_rating: entity.satisfaction_rating,
      created_at: entity.created_at.toISOString(),
      updated_at: entity.updated_at.toISOString(),
    };
  }

  private async loadUserMap(userIds: number[]): Promise<Map<number, GrievanceRefDto>> {
    const map = new Map<number, GrievanceRefDto>();
    if (!userIds.length) return map;

    const uniqueIds = Array.from(new Set(userIds));
    const users = await this.users.find({ where: { id: In(uniqueIds) } });

    for (const u of users) {
      map.set(u.id, { id: u.id, name: u.name });
    }
    return map;
  }

  private async loadStudentMap(schoolId: number, studentIds: number[]): Promise<Map<number, StudentInfo>> {
    const map = new Map<number, StudentInfo>();
    if (!studentIds.length) return map;

    const uniqueIds = Array.from(new Set(studentIds));
    const students = await this.students.find({
      where: { id: In(uniqueIds), school_id: schoolId },
    });

    const enrollments = await this.enrollments.find({
      where: { student_id: In(uniqueIds), school_id: schoolId },
      relations: ['school_class', 'section'],
    });

    const enrollmentMap = new Map<number, string>();
    for (const e of enrollments) {
      const className = e.school_class?.name ?? '';
      const sectionName = e.section?.name ?? '';
      const label = [className, sectionName].filter(Boolean).join(' - ');
      if (label && !enrollmentMap.has(e.student_id)) {
        enrollmentMap.set(e.student_id, label);
      }
    }

    for (const s of students) {
      const fullName = [s.first_name, s.last_name].filter(Boolean).join(' ');
      map.set(s.id, {
        name: fullName,
        admission_no: s.admission_no,
        class_section: enrollmentMap.get(s.id) ?? null,
      });
    }

    return map;
  }
}
