import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { AppException, AuthUser } from '@app/common';
import { PERMISSIONS } from '../access/access.catalog';
import { FilesService } from '../files/files.service';
import { School } from '../schools/entities/school.entity';
import { Student } from '../students/entities/student.entity';
import { RoutesService } from '../transport/routes.service';
import { yearClause } from '../../shared/year-context';
import { rupees } from '../payroll/payroll.calc';
import {
  feeBalance,
  feeBlocker,
  libraryBlocker,
  libraryPending,
  transportBlocker,
  transportPending,
} from './clearance';
import { CancelNocDto, ClearNocItemDto, NocDto, NocItemDto, StartNocDto } from './dto/lifecycle.dto';
import { NOC_DEPARTMENTS, NocDepartment, StudentNoc, StudentNocItem } from './entities/student-noc.entity';
import { nocPdf } from './pdf/noc.pdf';

export const NOC_DEPARTMENT_PERMISSIONS: Record<NocDepartment, string[]> = {
  fees: [PERMISSIONS.FEES_MANAGE, PERMISSIONS.FEES_APPROVE],
  library: [PERMISSIONS.LIBRARY_MANAGE],
  transport: [PERMISSIONS.FLEET_MANAGE],
  inventory: [PERMISSIONS.INVENTORY_MANAGE],
  class_teacher: [],
};

export const NOC_DEPARTMENT_LABELS: Record<NocDepartment, string> = {
  fees: 'Fees',
  library: 'Library',
  transport: 'Transport',
  inventory: 'Inventory and lab',
  class_teacher: 'Class teacher',
};

export function canClearNocLine(permissions: string[], department: NocDepartment): boolean {
  return (
    permissions.includes(PERMISSIONS.STUDENTS_MANAGE) ||
    NOC_DEPARTMENT_PERMISSIONS[department].some((permission) => permissions.includes(permission))
  );
}

interface LiveChecks {
  fees: number;
  library: string | null;
  transport: string | null;
}

@Injectable()
export class NocService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly routes: RoutesService,
    private readonly files: FilesService,
  ) {}

  async start(schoolId: number, studentId: number, dto: StartNocDto, actor: AuthUser): Promise<NocDto> {
    await this.dataSource.transaction(async (manager) => {
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
      if (await this.live(manager, schoolId, studentId)) {
        throw AppException.conflict('A leaving request is already open for this student', 'NOC_EXISTS');
      }
      const noc = await manager.save(
        manager.create(StudentNoc, {
          school_id: schoolId,
          student_id: studentId,
          status: 'open',
          exit_type: dto.exit_type,
          leaving_date: dto.leaving_date,
          reason: dto.reason,
          requested_by: actor.id,
          requested_by_name: actor.name,
          created_by: actor.id,
        }),
      );
      await manager.save(
        NOC_DEPARTMENTS.map((department) => manager.create(StudentNocItem, { noc_id: noc.id, department })),
      );
    });
    return this.current(schoolId, studentId, actor);
  }

  async current(schoolId: number, studentId: number, actor: AuthUser): Promise<NocDto> {
    const noc = await this.require(this.dataSource.manager, schoolId, studentId);
    return this.present(this.dataSource.manager, schoolId, noc, actor.permissions);
  }

  async clear(
    schoolId: number,
    studentId: number,
    department: NocDepartment,
    dto: ClearNocItemDto,
    actor: AuthUser,
  ): Promise<NocDto> {
    this.assertCanClear(actor, department);
    const noc = await this.require(this.dataSource.manager, schoolId, studentId);
    if (noc.status !== 'open') throw AppException.conflict('Every department has already cleared', 'NOC_NOT_OPEN');
    const item = this.item(noc, department);
    if (item.status === 'cleared')
      throw AppException.conflict('This department has already cleared', 'NOC_ITEM_CLEARED');

    let snapshot: string | null = null;
    if (department === 'fees') {
      const balance = await feeBalance(this.dataSource.manager, schoolId, studentId);
      if (balance > 0 && !dto.acknowledge_dues) {
        throw AppException.conflict(
          `${rupees(balance)} of fees is unpaid. Confirm to clear anyway; the dues stay on record.`,
          'FEE_DUES_PENDING',
        );
      }
      snapshot = balance > 0 ? `${rupees(balance)} unpaid, acknowledged` : null;
    }
    if (department === 'library') {
      const blocker = libraryBlocker(await libraryPending(this.dataSource.manager, studentId));
      if (blocker) throw AppException.conflict(`Clear the library first: ${blocker}`, 'LIBRARY_CLEARANCE_PENDING');
    }
    if (department === 'transport') {
      const pending = await transportPending(this.dataSource.manager, schoolId, studentId);
      if (pending) {
        snapshot = `Removed from route ${pending.route_name}`;
        await this.routes.unassignStudent(schoolId, studentId);
      }
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.update(StudentNocItem, item.id, {
        status: 'cleared',
        cleared_by: actor.id,
        cleared_by_name: actor.name,
        cleared_at: new Date(),
        remarks: dto.remarks ?? null,
        blocker_snapshot: snapshot,
      });
      const pending = await manager.countBy(StudentNocItem, { noc_id: noc.id, status: 'pending' });
      if (!pending) await manager.update(StudentNoc, noc.id, { status: 'cleared', cleared_at: new Date() });
    });
    return this.current(schoolId, studentId, actor);
  }

  async reopen(schoolId: number, studentId: number, department: NocDepartment, actor: AuthUser): Promise<NocDto> {
    this.assertCanClear(actor, department);
    const noc = await this.require(this.dataSource.manager, schoolId, studentId);
    const item = this.item(noc, department);
    if (item.status !== 'cleared')
      throw AppException.conflict('This department has not cleared yet', 'NOC_ITEM_PENDING');
    await this.dataSource.transaction(async (manager) => {
      await manager.update(StudentNocItem, item.id, {
        status: 'pending',
        cleared_by: null,
        cleared_by_name: null,
        cleared_at: null,
        remarks: null,
        blocker_snapshot: null,
      });
      if (noc.status === 'cleared') await manager.update(StudentNoc, noc.id, { status: 'open', cleared_at: null });
    });
    return this.current(schoolId, studentId, actor);
  }

  async cancel(schoolId: number, studentId: number, dto: CancelNocDto): Promise<void> {
    const noc = await this.require(this.dataSource.manager, schoolId, studentId);
    await this.dataSource.manager.update(StudentNoc, noc.id, {
      status: 'cancelled',
      cancelled_at: new Date(),
      cancel_note: dto.note,
    });
  }

  async pdf(schoolId: number, studentId: number): Promise<{ name: string; pdf: Buffer }> {
    const manager = this.dataSource.manager;
    const noc =
      (await this.live(manager, schoolId, studentId)) ??
      (await manager.findOne(StudentNoc, {
        where: { school_id: schoolId, student_id: studentId, status: 'issued' },
        relations: { items: true },
        order: { created_at: 'DESC' },
      }));
    if (!noc) throw AppException.notFound('No leaving request for this student', 'NOC_NOT_FOUND');
    const student = await manager.findOneByOrFail(Student, { id: studentId });
    const school = await manager.findOneByOrFail(School, { id: schoolId });
    const [enrollment]: { class_name: string | null; section_name: string | null }[] = await manager.query(
      `SELECT c.name AS class_name, sec.name AS section_name
         FROM student_enrollments e
         JOIN academic_years y ON y.id = e.academic_year_id AND ${yearClause('y')}
         LEFT JOIN classes c ON c.id = e.class_id
         LEFT JOIN sections sec ON sec.id = e.section_id
        WHERE e.student_id = $1
        LIMIT 1`,
      [studentId],
    );
    const items = this.sorted(noc.items ?? []);
    const pdf = await nocPdf({
      school_name: school.name,
      school_address: [school.address, school.city, school.state, school.pincode].filter(Boolean).join(', ') || null,
      school_logo: await this.files.readImage(school.logo_file_id),
      student_name: [student.first_name, student.last_name].filter(Boolean).join(' '),
      admission_no: student.admission_no,
      emis_number: student.emis_number ?? null,
      class_name: enrollment?.class_name
        ? [enrollment.class_name, enrollment.section_name].filter(Boolean).join(' - ')
        : null,
      leaving_date: noc.leaving_date,
      reason: noc.reason,
      requested_on: noc.created_at.toISOString().slice(0, 10),
      cleared: noc.status !== 'open',
      lines: items.map((item) => ({
        department: NOC_DEPARTMENT_LABELS[item.department],
        status: item.status === 'cleared' ? 'Cleared' : 'Pending',
        cleared_by: item.cleared_by_name,
        cleared_on: item.cleared_at ? item.cleared_at.toISOString().slice(0, 10) : null,
        remarks: [item.remarks, item.blocker_snapshot].filter(Boolean).join('. ') || null,
      })),
    });
    return { name: `NOC-${student.admission_no}`.replace(/\//g, '-'), pdf };
  }

  async clearedFor(manager: EntityManager, schoolId: number, studentId: number): Promise<StudentNoc> {
    const noc = await this.live(manager, schoolId, studentId);
    if (!noc || noc.status !== 'cleared') {
      throw AppException.conflict(
        noc
          ? 'Every department has to clear the NOC before the TC is issued'
          : 'Start a leaving request and get the NOC cleared before the TC is issued',
        'NOC_NOT_CLEARED',
      );
    }
    return noc;
  }

  async markIssued(manager: EntityManager, nocId: number, tcId: number): Promise<void> {
    await manager.update(StudentNoc, nocId, { status: 'issued', tc_id: tcId });
  }

  private assertCanClear(actor: AuthUser, department: NocDepartment): void {
    if (!canClearNocLine(actor.permissions, department)) {
      throw AppException.forbidden(
        `Only ${NOC_DEPARTMENT_LABELS[department]} staff can clear this line`,
        'NOC_FORBIDDEN',
      );
    }
  }

  private live(manager: EntityManager, schoolId: number, studentId: number): Promise<StudentNoc | null> {
    return manager.findOne(StudentNoc, {
      where: { school_id: schoolId, student_id: studentId, status: In(['open', 'cleared']) },
      relations: { items: true },
    });
  }

  private async require(manager: EntityManager, schoolId: number, studentId: number): Promise<StudentNoc> {
    const noc = await this.live(manager, schoolId, studentId);
    if (!noc) throw AppException.notFound('No open leaving request for this student', 'NOC_NOT_FOUND');
    return noc;
  }

  private item(noc: StudentNoc, department: NocDepartment): StudentNocItem {
    const item = (noc.items ?? []).find((row) => row.department === department);
    if (!item) throw AppException.notFound('No such department on this NOC', 'NOC_ITEM_NOT_FOUND');
    return item;
  }

  private sorted(items: StudentNocItem[]): StudentNocItem[] {
    return [...items].sort((a, b) => NOC_DEPARTMENTS.indexOf(a.department) - NOC_DEPARTMENTS.indexOf(b.department));
  }

  private async checks(manager: EntityManager, schoolId: number, studentId: number): Promise<LiveChecks> {
    const [fees, library, transport] = await Promise.all([
      feeBalance(manager, schoolId, studentId),
      libraryPending(manager, studentId),
      transportPending(manager, schoolId, studentId),
    ]);
    return { fees, library: libraryBlocker(library), transport: transportBlocker(transport) };
  }

  private async present(
    manager: EntityManager,
    schoolId: number,
    noc: StudentNoc,
    permissions: string[],
  ): Promise<NocDto> {
    const live = await this.checks(manager, schoolId, noc.student_id);
    const items = this.sorted(noc.items ?? []).map((item): NocItemDto => {
      const pending = item.status === 'pending';
      const blocker = !pending
        ? null
        : item.department === 'fees'
          ? feeBlocker(live.fees)
          : item.department === 'library'
            ? live.library
            : item.department === 'transport'
              ? live.transport
              : null;
      return {
        department: item.department,
        status: item.status,
        blocker,
        blocking: pending && item.department === 'library' && Boolean(blocker),
        amount: item.department === 'fees' ? live.fees : 0,
        can_clear: noc.status !== 'issued' && canClearNocLine(permissions, item.department),
        cleared_by_name: item.cleared_by_name,
        cleared_at: item.cleared_at ? item.cleared_at.toISOString() : null,
        remarks: item.remarks,
        blocker_snapshot: item.blocker_snapshot,
      };
    });
    return {
      id: noc.id,
      student_id: noc.student_id,
      status: noc.status,
      exit_type: noc.exit_type,
      leaving_date: noc.leaving_date,
      reason: noc.reason,
      requested_by_name: noc.requested_by_name,
      requested_at: noc.created_at.toISOString(),
      cleared_at: noc.cleared_at ? noc.cleared_at.toISOString() : null,
      cleared_count: items.filter((item) => item.status === 'cleared').length,
      items,
    };
  }
}
