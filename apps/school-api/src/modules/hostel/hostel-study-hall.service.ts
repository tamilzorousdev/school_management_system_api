import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AppException, AuthUser } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import {
  AutoAssignDto,
  AutoAssignResultDto,
  AutoSkippedDto,
  HallQueryDto,
  HallStatus,
  SeatAllocateDto,
  SeatMapDto,
  StudyHallDto,
  StudyHallInputDto,
  StudyHallPatchDto,
} from './dto/hostel-duty.dto';
import { HostelSeatAllocation, HostelStudyHall, HostelStudySeat } from './entities/hostel-duty.entity';
import { HostelAuditService } from './hostel-audit.service';
import { ensurePlace, staffNames } from './hostel-duty-checks';
import { capacityPlan, pairUp, seatLabels } from './hostel-duty.logic';
import { STUDENT_COLUMNS, studentFromRow, studentJoins } from './hostel-sql';

const SEAT_ORDER = `NULLIF(regexp_replace(st.seat_no, '\\D', '', 'g'), '')::int NULLS LAST, st.seat_no`;

interface Candidate {
  admission_id: number;
  student_id: number;
  student_name: string;
  seated: boolean;
}

@Injectable()
export class HostelStudyHallService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: HostelAuditService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async halls(schoolId: number, query: HallQueryDto): Promise<StudyHallDto[]> {
    const params: unknown[] = [schoolId];
    const where = ['hl.school_id = $1', 'hl.deleted_at IS NULL'];
    if (query.hostel_id) where.push(`hl.hostel_id = $${params.push(query.hostel_id)}`);
    return this.hallRows(where, params);
  }

  async hall(schoolId: number, id: number): Promise<StudyHallDto> {
    const [row] = await this.hallRows(['hl.school_id = $1', 'hl.id = $2', 'hl.deleted_at IS NULL'], [schoolId, id]);
    if (!row) throw AppException.notFound('Study hall not found', 'HOSTEL_STUDY_HALL_NOT_FOUND');
    return row;
  }

  async create(schoolId: number, dto: StudyHallInputDto, actor: AuthUser): Promise<StudyHallDto> {
    const id = await this.dataSource.transaction(async (manager) => {
      await ensurePlace(manager, schoolId, dto.hostel_id, null);
      if (dto.supervisor_user_id) {
        await staffNames(manager, schoolId, [dto.supervisor_user_id], 'supervisor_user_id');
      }
      await this.ensureName(manager, schoolId, dto.hostel_id, dto.name);
      const hall = await manager.save(
        manager.create(HostelStudyHall, {
          school_id: schoolId,
          hostel_id: dto.hostel_id,
          name: dto.name,
          location: dto.location ?? null,
          capacity: dto.capacity,
          supervisor_user_id: dto.supervisor_user_id ?? null,
          status: dto.status ?? 'open',
          notes: dto.notes ?? null,
          created_by: actor.id,
        }),
      );
      await this.addSeats(manager, schoolId, hall.id, seatLabels(dto.capacity));
      await this.audit.record(manager, schoolId, actor, {
        entity: 'study_hall',
        entity_id: hall.id,
        action: 'create',
        changes: { name: hall.name, capacity: hall.capacity },
      });
      return hall.id;
    });
    return this.hall(schoolId, id);
  }

  async update(schoolId: number, id: number, dto: StudyHallPatchDto, actor: AuthUser): Promise<StudyHallDto> {
    await this.dataSource.transaction(async (manager) => {
      const hall = await this.lockHall(manager, schoolId, id);
      if (dto.supervisor_user_id) {
        await staffNames(manager, schoolId, [dto.supervisor_user_id], 'supervisor_user_id');
      }
      if (dto.name && dto.name.toLowerCase() !== hall.name.toLowerCase()) {
        await this.ensureName(manager, schoolId, hall.hostel_id, dto.name);
      }
      if (dto.capacity !== undefined && dto.capacity !== hall.capacity) {
        await this.resize(manager, schoolId, hall.id, dto.capacity);
      }
      const changes = Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined));
      Object.assign(hall, changes);
      await manager.save(hall);
      await this.audit.record(manager, schoolId, actor, {
        entity: 'study_hall',
        entity_id: hall.id,
        action: 'update',
        changes,
      });
    });
    return this.hall(schoolId, id);
  }

  async remove(schoolId: number, id: number, actor: AuthUser): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const hall = await this.lockHall(manager, schoolId, id);
      const [seated] = await manager.query(
        `SELECT 1 FROM hostel_seat_allocations WHERE hall_id = $1 AND to_date IS NULL LIMIT 1`,
        [hall.id],
      );
      if (seated) {
        throw AppException.conflict(
          'Students still have seats here. Release them first.',
          'HOSTEL_STUDY_HALL_OCCUPIED',
        );
      }
      const [scheduled] = await manager.query(
        `SELECT name FROM hostel_study_schedules WHERE hall_id = $1 AND deleted_at IS NULL LIMIT 1`,
        [hall.id],
      );
      if (scheduled) {
        throw AppException.conflict(
          `The study schedule "${scheduled.name}" uses this hall`,
          'HOSTEL_STUDY_HALL_IN_USE',
        );
      }
      await manager.softDelete(HostelStudyHall, { id: hall.id });
      await this.audit.record(manager, schoolId, actor, {
        entity: 'study_hall',
        entity_id: hall.id,
        action: 'delete',
        changes: { name: hall.name },
      });
    });
  }

  async seatMap(schoolId: number, hallId: number): Promise<SeatMapDto> {
    const hall = await this.hall(schoolId, hallId);
    const rows: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT st.id, st.seat_no, st.active, sa.id AS allocation_id, sa.admission_id, sa.from_date::text AS since,
         ${STUDENT_COLUMNS}
       FROM hostel_study_seats st
       LEFT JOIN hostel_seat_allocations sa ON sa.seat_id = st.id AND sa.to_date IS NULL
       LEFT JOIN hostel_admissions a ON a.id = sa.admission_id
       LEFT JOIN students s ON s.id = a.student_id
       ${studentJoins('s')}
       WHERE st.school_id = $1 AND st.hall_id = $2
       ORDER BY ${SEAT_ORDER}`,
      [schoolId, hallId],
    );
    return {
      hall,
      seats: rows.map((row) => ({
        id: Number(row.id),
        seat_no: row.seat_no as string,
        active: Boolean(row.active),
        allocation_id: row.allocation_id ? Number(row.allocation_id) : null,
        admission_id: row.admission_id ? Number(row.admission_id) : null,
        student: row.student_id ? studentFromRow(row) : null,
        since: (row.since as string | null) ?? null,
      })),
    };
  }

  async allocate(schoolId: number, hallId: number, dto: SeatAllocateDto, actor: AuthUser): Promise<SeatMapDto> {
    await this.dataSource.transaction(async (manager) => {
      const hall = await this.lockHall(manager, schoolId, hallId);
      this.ensureOpen(hall.status);
      const [seat] = await manager.query(
        `SELECT id, seat_no, active FROM hostel_study_seats WHERE school_id = $1 AND hall_id = $2 AND id = $3 FOR UPDATE`,
        [schoolId, hallId, dto.seat_id],
      );
      if (!seat) throw AppException.notFound('Seat not found in this hall', 'HOSTEL_SEAT_NOT_FOUND');
      if (!seat.active) throw AppException.conflict('This seat is not in use', 'HOSTEL_SEAT_INACTIVE');
      const [taken] = await manager.query(
        `SELECT 1 FROM hostel_seat_allocations WHERE seat_id = $1 AND to_date IS NULL`,
        [seat.id],
      );
      if (taken) throw AppException.conflict(`Seat ${seat.seat_no} is taken`, 'HOSTEL_SEAT_TAKEN');
      const [resident] = await manager.query(
        `SELECT a.student_id, st.seat_no AS current_seat FROM hostel_admissions a
         LEFT JOIN hostel_seat_allocations sa ON sa.admission_id = a.id AND sa.hall_id = $3 AND sa.to_date IS NULL
         LEFT JOIN hostel_study_seats st ON st.id = sa.seat_id
         WHERE a.school_id = $1 AND a.id = $2 AND a.hostel_id = $4 AND a.status <> 'checked_out' AND a.deleted_at IS NULL`,
        [schoolId, dto.admission_id, hallId, hall.hostel_id],
      );
      if (!resident) {
        throw AppException.badRequest('This student does not stay in this hostel', 'HOSTEL_NOT_RESIDENT');
      }
      if (resident.current_seat) {
        throw AppException.conflict(
          `This student already has seat ${resident.current_seat} in this hall`,
          'HOSTEL_SEAT_ALREADY_GIVEN',
        );
      }
      const allocation = await this.seatStudent(manager, schoolId, hallId, seat.id, dto.admission_id, actor);
      await this.audit.record(manager, schoolId, actor, {
        entity: 'seat',
        entity_id: allocation.id,
        action: 'allocate',
        student_id: Number(resident.student_id),
        changes: { hall_id: hallId, seat_no: seat.seat_no },
      });
    });
    return this.seatMap(schoolId, hallId);
  }

  async release(schoolId: number, allocationId: number, actor: AuthUser): Promise<SeatMapDto> {
    const hallId = await this.dataSource.transaction(async (manager) => {
      const allocation = await manager.findOne(HostelSeatAllocation, {
        where: { school_id: schoolId, id: allocationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!allocation) throw AppException.notFound('Seat allocation not found', 'HOSTEL_SEAT_ALLOCATION_NOT_FOUND');
      if (allocation.to_date) throw AppException.conflict('This seat was already released', 'HOSTEL_SEAT_RELEASED');
      allocation.to_date = this.today();
      await manager.save(allocation);
      const [admission] = await manager.query(`SELECT student_id FROM hostel_admissions WHERE id = $1`, [
        allocation.admission_id,
      ]);
      await this.audit.record(manager, schoolId, actor, {
        entity: 'seat',
        entity_id: allocation.id,
        action: 'release',
        student_id: admission ? Number(admission.student_id) : null,
        changes: { hall_id: allocation.hall_id, seat_id: allocation.seat_id },
      });
      return allocation.hall_id;
    });
    return this.seatMap(schoolId, hallId);
  }

  async autoAssign(
    schoolId: number,
    hallId: number,
    dto: AutoAssignDto,
    actor: AuthUser,
  ): Promise<AutoAssignResultDto> {
    return this.dataSource.transaction(async (manager) => {
      const hall = await this.lockHall(manager, schoolId, hallId);
      this.ensureOpen(hall.status);
      if (dto.block_id) await ensurePlace(manager, schoolId, hall.hostel_id, dto.block_id);
      const candidates = await this.candidates(manager, schoolId, hall, dto);
      const skipped: AutoSkippedDto[] = [];
      if (dto.admission_ids) {
        const found = new Set(candidates.map((candidate) => candidate.admission_id));
        for (const id of dto.admission_ids.filter((value) => !found.has(value))) {
          skipped.push({
            admission_id: id,
            student_name: null,
            reason: dto.block_id ? 'Not staying in this hostel block' : 'Not staying in this hostel',
          });
        }
      }
      for (const candidate of candidates.filter((item) => item.seated)) {
        skipped.push({
          admission_id: candidate.admission_id,
          student_name: candidate.student_name,
          reason: 'Already has a seat in this hall',
        });
      }
      const seats: { id: number; seat_no: string }[] = await manager.query(
        `SELECT st.id, st.seat_no FROM hostel_study_seats st
         WHERE st.school_id = $1 AND st.hall_id = $2 AND st.active = true
           AND NOT EXISTS (SELECT 1 FROM hostel_seat_allocations sa WHERE sa.seat_id = st.id AND sa.to_date IS NULL)
         ORDER BY ${SEAT_ORDER}`,
        [schoolId, hallId],
      );
      const { pairs, left } = pairUp(
        candidates.filter((item) => !item.seated),
        seats,
      );
      const assigned: AutoAssignResultDto['assigned'] = [];
      for (const [candidate, seat] of pairs) {
        const allocation = await this.seatStudent(manager, schoolId, hallId, seat.id, candidate.admission_id, actor);
        await this.audit.record(manager, schoolId, actor, {
          entity: 'seat',
          entity_id: allocation.id,
          action: 'allocate',
          student_id: candidate.student_id,
          changes: { hall_id: hallId, seat_no: seat.seat_no },
          note: 'Auto-assigned',
        });
        assigned.push({
          admission_id: candidate.admission_id,
          student_name: candidate.student_name,
          seat_id: Number(seat.id),
          seat_no: seat.seat_no,
        });
      }
      for (const candidate of left) {
        skipped.push({
          admission_id: candidate.admission_id,
          student_name: candidate.student_name,
          reason: 'No free seat left',
        });
      }
      return { assigned, skipped };
    });
  }

  today(): string {
    return todayIn(this.app.timeZone);
  }

  private async candidates(
    manager: EntityManager,
    schoolId: number,
    hall: HostelStudyHall,
    dto: AutoAssignDto,
  ): Promise<Candidate[]> {
    const params: unknown[] = [schoolId, hall.id, hall.hostel_id];
    const where = ['a.school_id = $1', 'a.hostel_id = $3', `a.status <> 'checked_out'`, 'a.deleted_at IS NULL'];
    if (dto.admission_ids) where.push(`a.id = ANY($${params.push(dto.admission_ids)}::int[])`);
    if (dto.block_id) where.push(`r.block_id = $${params.push(dto.block_id)}`);
    const rows: Record<string, unknown>[] = await manager.query(
      `SELECT a.id AS admission_id, a.student_id, TRIM(CONCAT(s.first_name, ' ', s.last_name)) AS student_name,
         EXISTS (SELECT 1 FROM hostel_seat_allocations x WHERE x.hall_id = $2 AND x.admission_id = a.id
           AND x.to_date IS NULL) AS seated
       FROM hostel_admissions a
       JOIN students s ON s.id = a.student_id
       LEFT JOIN hostel_allocations al ON al.admission_id = a.id AND al.to_date IS NULL
       LEFT JOIN hostel_rooms r ON r.id = al.room_id
       LEFT JOIN hostel_beds bd ON bd.id = al.bed_id
       LEFT JOIN hostel_blocks b ON b.id = r.block_id
       WHERE ${where.join(' AND ')}
       ORDER BY b.sort_order NULLS LAST, r.room_no NULLS LAST, bd.bed_no, s.first_name, a.id`,
      params,
    );
    const list: Candidate[] = rows.map((row) => ({
      admission_id: Number(row.admission_id),
      student_id: Number(row.student_id),
      student_name: row.student_name as string,
      seated: Boolean(row.seated),
    }));
    if (!dto.admission_ids) return list;
    const order = new Map(dto.admission_ids.map((id, index) => [id, index]));
    return list.sort((a, b) => order.get(a.admission_id)! - order.get(b.admission_id)!);
  }

  private async seatStudent(
    manager: EntityManager,
    schoolId: number,
    hallId: number,
    seatId: number,
    admissionId: number,
    actor: AuthUser,
  ): Promise<HostelSeatAllocation> {
    return manager.save(
      manager.create(HostelSeatAllocation, {
        school_id: schoolId,
        hall_id: hallId,
        seat_id: seatId,
        admission_id: admissionId,
        from_date: this.today(),
        to_date: null,
        created_by: actor.id,
      }),
    );
  }

  private async resize(manager: EntityManager, schoolId: number, hallId: number, capacity: number): Promise<void> {
    const seats: { id: number; seat_no: string; active: boolean; occupied: boolean }[] = await manager.query(
      `SELECT st.id, st.seat_no, st.active,
         EXISTS (SELECT 1 FROM hostel_seat_allocations sa WHERE sa.seat_id = st.id AND sa.to_date IS NULL) AS occupied
       FROM hostel_study_seats st WHERE st.school_id = $1 AND st.hall_id = $2 FOR UPDATE OF st`,
      [schoolId, hallId],
    );
    const plan = capacityPlan(
      seats.map((seat) => ({ ...seat, id: Number(seat.id) })),
      capacity,
    );
    if (!plan) {
      const taken = seats.filter((seat) => seat.active && seat.occupied).length;
      throw AppException.conflict(
        `${taken} seats are taken. Release seats before going below ${taken}.`,
        'HOSTEL_STUDY_HALL_SEATS_TAKEN',
      );
    }
    if (plan.activate.length) {
      await manager.query(`UPDATE hostel_study_seats SET active = true WHERE id = ANY($1::int[])`, [plan.activate]);
    }
    if (plan.deactivate.length) {
      await manager.query(`UPDATE hostel_study_seats SET active = false WHERE id = ANY($1::int[])`, [plan.deactivate]);
    }
    await this.addSeats(manager, schoolId, hallId, plan.add);
  }

  private async addSeats(manager: EntityManager, schoolId: number, hallId: number, labels: string[]): Promise<void> {
    if (!labels.length) return;
    await manager.save(
      labels.map((label) =>
        manager.create(HostelStudySeat, { school_id: schoolId, hall_id: hallId, seat_no: label, active: true }),
      ),
    );
  }

  private async ensureName(manager: EntityManager, schoolId: number, hostelId: number, name: string): Promise<void> {
    const [taken] = await manager.query(
      `SELECT 1 FROM hostel_study_halls WHERE school_id = $1 AND hostel_id = $2 AND LOWER(name) = LOWER($3)
         AND deleted_at IS NULL`,
      [schoolId, hostelId, name],
    );
    if (taken)
      throw AppException.conflict('A study hall with this name already exists', 'HOSTEL_STUDY_HALL_NAME_TAKEN');
  }

  private ensureOpen(status: HallStatus): void {
    if (status !== 'open') throw AppException.conflict('This study hall is closed', 'HOSTEL_STUDY_HALL_CLOSED');
  }

  private async lockHall(manager: EntityManager, schoolId: number, id: number): Promise<HostelStudyHall> {
    const hall = await manager.findOne(HostelStudyHall, {
      where: { school_id: schoolId, id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!hall) throw AppException.notFound('Study hall not found', 'HOSTEL_STUDY_HALL_NOT_FOUND');
    return hall;
  }

  private async hallRows(where: string[], params: unknown[]): Promise<StudyHallDto[]> {
    const rows: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT hl.id, hl.hostel_id, h.name AS hostel_name, hl.name, hl.location, hl.capacity, hl.supervisor_user_id,
         su.name AS supervisor_name, hl.status, hl.notes,
         COUNT(st.id) FILTER (WHERE st.active)::int AS seats_active,
         COUNT(sa.id)::int AS seats_taken
       FROM hostel_study_halls hl
       JOIN hostels h ON h.id = hl.hostel_id
       LEFT JOIN users su ON su.id = hl.supervisor_user_id
       LEFT JOIN hostel_study_seats st ON st.hall_id = hl.id
       LEFT JOIN hostel_seat_allocations sa ON sa.seat_id = st.id AND sa.to_date IS NULL
       WHERE ${where.join(' AND ')}
       GROUP BY hl.id, h.name, su.name
       ORDER BY h.name, hl.name, hl.id`,
      params,
    );
    return rows.map((row) => ({
      id: Number(row.id),
      hostel_id: Number(row.hostel_id),
      hostel_name: row.hostel_name as string,
      name: row.name as string,
      location: (row.location as string | null) ?? null,
      capacity: Number(row.capacity),
      supervisor_user_id: (row.supervisor_user_id as number | null) ?? null,
      supervisor_name: (row.supervisor_name as string | null) ?? null,
      status: row.status as HallStatus,
      notes: (row.notes as string | null) ?? null,
      seats_active: Number(row.seats_active),
      seats_taken: Number(row.seats_taken),
      seats_free: Math.max(0, Number(row.seats_active) - Number(row.seats_taken)),
    }));
  }
}
