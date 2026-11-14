import { EntityManager } from 'typeorm';
import { School } from '../../modules/schools/entities/school.entity';
import { AcademicYear } from '../../modules/setup/entities/academic-year.entity';
import { TimetableSlot } from '../../modules/timetable/entities/timetable-slot.entity';
import { SCHOOL_DAYS } from '../../modules/timetable/timetable.service';
import { cell, PlannedSlot, WeekDemand } from './demo-final.plan';

interface SectionRow {
  id: number;
  room: string | null;
}

interface Unit {
  subject_id: number;
  teacher_user_id: number;
}

export function fillWeek(input: {
  days: number[];
  periods: number;
  demands: WeekDemand[];
  taken: Set<string>;
  teacherBusy: (teacherId: number, key: string) => boolean;
  perDay: Map<string, number>;
  capacity: Map<number, number>;
}): PlannedSlot[] {
  const units: Unit[] = input.demands
    .filter((demand) => demand.count > 0 && demand.teacher_user_id !== null)
    .sort((a, b) => b.count - a.count || a.subject_id - b.subject_id)
    .flatMap((demand) =>
      Array.from({ length: demand.count }, () => ({
        subject_id: demand.subject_id,
        teacher_user_id: demand.teacher_user_id!,
      })),
    );
  const placed: PlannedSlot[] = [];
  units.forEach((unit, index) => {
    if ((input.capacity.get(unit.teacher_user_id) ?? 0) <= 0) return;
    for (const maxPerDay of [1, 2, 3]) {
      const days = [...input.days].sort(
        (a, b) =>
          (input.perDay.get(`${unit.subject_id}:${a}`) ?? 0) - (input.perDay.get(`${unit.subject_id}:${b}`) ?? 0) ||
          ((a + index) % input.days.length) - ((b + index) % input.days.length),
      );
      for (const day of days) {
        const dayKey = `${unit.subject_id}:${day}`;
        if ((input.perDay.get(dayKey) ?? 0) >= maxPerDay) continue;
        for (let offset = 0; offset < input.periods; offset += 1) {
          const period = ((offset + index) % input.periods) + 1;
          const key = cell(day, period);
          if (input.taken.has(key) || input.teacherBusy(unit.teacher_user_id, key)) continue;
          input.taken.add(key);
          input.perDay.set(dayKey, (input.perDay.get(dayKey) ?? 0) + 1);
          input.capacity.set(unit.teacher_user_id, input.capacity.get(unit.teacher_user_id)! - 1);
          placed.push({ day_of_week: day, period_no: period, ...unit });
          return;
        }
      }
    }
  });
  return placed.sort((a, b) => a.day_of_week - b.day_of_week || a.period_no - b.period_no);
}

export async function seedDemoTimetable(manager: EntityManager, school: School): Promise<void> {
  const schoolId = school.id;
  const year = await manager.findOneBy(AcademicYear, { school_id: schoolId, is_current: true });
  if (!year) return;
  const [bell]: { periods: number | null }[] = await manager.query(
    `SELECT MAX(period_no) AS periods FROM bell_periods
     WHERE school_id = $1 AND class_id IS NULL AND period_no IS NOT NULL AND is_break = false`,
    [schoolId],
  );
  const periods = Number(bell?.periods ?? 0);
  if (!periods) return;
  const sections: SectionRow[] = await manager.query(
    `SELECT sec.id, sec.room FROM sections sec JOIN classes c ON c.id = sec.class_id
     WHERE sec.school_id = $1 AND sec.academic_year_id = $2 AND sec.deleted_at IS NULL
     ORDER BY c.grade_level, sec.name`,
    [schoolId, year.id],
  );
  const slots: {
    section_id: number;
    teacher_user_id: number | null;
    room: string | null;
    day_of_week: number;
    period_no: number;
    subject_id: number;
  }[] = await manager.query(
    `SELECT section_id, teacher_user_id, room, day_of_week, period_no, subject_id FROM timetable_slots
       WHERE school_id = $1 AND academic_year_id = $2`,
    [schoolId, year.id],
  );
  const teacherBusy = new Map<number, Set<string>>();
  const roomBusy = new Map<string, Set<string>>();
  const mark = <K>(map: Map<K, Set<string>>, id: K, key: string) => {
    if (!map.has(id)) map.set(id, new Set());
    map.get(id)!.add(key);
  };
  for (const slot of slots) {
    const key = cell(Number(slot.day_of_week), Number(slot.period_no));
    if (slot.teacher_user_id) mark(teacherBusy, Number(slot.teacher_user_id), key);
    if (slot.room) mark(roomBusy, slot.room.toLowerCase(), key);
  }
  const limits: { user_id: number; max_periods_per_week: number }[] = await manager.query(
    `SELECT user_id, max_periods_per_week FROM staff WHERE school_id = $1 AND deleted_at IS NULL`,
    [schoolId],
  );
  const capacity = new Map<number, number>(
    limits.map((row) => [
      Number(row.user_id),
      Number(row.max_periods_per_week) -
        slots.filter((slot) => Number(slot.teacher_user_id) === Number(row.user_id)).length,
    ]),
  );
  let added = 0;
  let filledSections = 0;
  for (const section of sections) {
    const assignments: { subject_id: number; teacher_user_id: number; periods_per_week: number }[] =
      await manager.query(
        `SELECT subject_id, teacher_user_id, periods_per_week FROM teacher_assignments
       WHERE section_id = $1 AND academic_year_id = $2 AND deleted_at IS NULL ORDER BY subject_id`,
        [section.id, year.id],
      );
    if (!assignments.length) continue;
    const own = slots.filter((slot) => Number(slot.section_id) === Number(section.id));
    const demands: WeekDemand[] = assignments.map((row) => ({
      subject_id: Number(row.subject_id),
      teacher_user_id: Number(row.teacher_user_id),
      count: Math.max(
        0,
        Number(row.periods_per_week) - own.filter((slot) => Number(slot.subject_id) === Number(row.subject_id)).length,
      ),
    }));
    if (!demands.some((demand) => demand.count > 0)) continue;
    const taken = new Set(own.map((slot) => cell(Number(slot.day_of_week), Number(slot.period_no))));
    const room = section.room?.toLowerCase() ?? null;
    if (room) for (const key of roomBusy.get(room) ?? []) taken.add(key);
    const perDay = new Map<string, number>();
    for (const slot of own) {
      const key = `${slot.subject_id}:${slot.day_of_week}`;
      perDay.set(key, (perDay.get(key) ?? 0) + 1);
    }
    const planned = fillWeek({
      days: SCHOOL_DAYS,
      periods,
      demands,
      taken,
      perDay,
      capacity,
      teacherBusy: (teacherId, key) => teacherBusy.get(teacherId)?.has(key) ?? false,
    });
    if (!planned.length) continue;
    for (const slot of planned) {
      const key = cell(slot.day_of_week, slot.period_no);
      mark(teacherBusy, slot.teacher_user_id!, key);
      if (room) mark(roomBusy, room, key);
    }
    await manager.insert(
      TimetableSlot,
      planned.map((slot) => ({
        ...slot,
        school_id: schoolId,
        academic_year_id: year.id,
        section_id: section.id,
        room: section.room,
      })),
    );
    added += planned.length;
    filledSections += 1;
  }
  console.log(
    `Timetable ${school.code}  +${added} periods across ${filledSections} sections (Monday to Saturday, no teacher or room clash, within each teacher's weekly limit)`,
  );
}
