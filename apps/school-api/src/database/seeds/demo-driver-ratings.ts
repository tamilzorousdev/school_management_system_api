import { EntityManager } from 'typeorm';
import { School } from '../../modules/schools/entities/school.entity';
import { DriverRating, RatingTag } from '../../modules/transport/entities/driver-rating.entity';
import { ratingMonth } from '../../modules/transport/driver-rating.logic';
import { todayIn } from '../../shared/dates';
import { addDays } from '../../shared/school-days';

const SAMPLES: { rating: number; tags: RatingTag[]; comment: string | null }[] = [
  { rating: 5, tags: ['safe_driving', 'careful_with_children'], comment: 'Waits until every child is seated.' },
  { rating: 4, tags: ['on_time', 'polite'], comment: null },
  { rating: 5, tags: ['safe_driving', 'on_time'], comment: null },
  { rating: 3, tags: ['late'], comment: 'Bus came 10 minutes late twice this week.' },
  { rating: 4, tags: ['clean_bus'], comment: null },
  { rating: 2, tags: ['rash_driving'], comment: 'Too fast near the school gate.' },
];

export async function seedDemoDriverRatings(manager: EntityManager, school: School): Promise<void> {
  if (await manager.existsBy(DriverRating, { school_id: school.id })) {
    console.log('  Driver ratings: already set up: kept');
    return;
  }
  const riders: { driver_user_id: number; vehicle_id: number; student_id: number; parent_user_id: number }[] =
    await manager.query(
      `SELECT DISTINCT ON (v.id, g.user_id) v.driver_user_id, v.id AS vehicle_id, t.student_id, g.user_id AS parent_user_id
       FROM vehicles v
       JOIN transport_routes r ON r.vehicle_id = v.id AND r.deleted_at IS NULL
       JOIN student_transport t ON t.route_id = r.id AND t.deleted_at IS NULL
       JOIN student_guardians sg ON sg.student_id = t.student_id
       JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL AND g.user_id IS NOT NULL
       WHERE v.school_id = $1 AND v.deleted_at IS NULL AND v.driver_user_id IS NOT NULL
       ORDER BY v.id, g.user_id, t.student_id`,
      [school.id],
    );
  const today = todayIn(process.env.APP_TIMEZONE ?? 'Asia/Kolkata');
  const months = [ratingMonth(today), ratingMonth(addDays(`${ratingMonth(today)}-01`, -1))];
  const rows: Partial<DriverRating>[] = [];
  const perBus = new Map<number, number>();
  for (const rider of riders) {
    const index = perBus.get(Number(rider.vehicle_id)) ?? 0;
    if (index >= 8) continue;
    perBus.set(Number(rider.vehicle_id), index + 1);
    const sample = SAMPLES[(index + Number(rider.vehicle_id)) % SAMPLES.length]!;
    rows.push({
      school_id: school.id,
      driver_user_id: Number(rider.driver_user_id),
      vehicle_id: Number(rider.vehicle_id),
      student_id: Number(rider.student_id),
      parent_user_id: Number(rider.parent_user_id),
      month: months[index % 2]!,
      rating: sample.rating,
      tags: sample.tags,
      comment: sample.comment,
      created_by: Number(rider.parent_user_id),
    });
  }
  if (rows.length) {
    await manager.save(
      DriverRating,
      rows.map((row) => manager.create(DriverRating, row)),
    );
    await manager.query(
      `UPDATE driver_ratings SET created_at = ($2 || '-15')::date, updated_at = ($2 || '-15')::date
       WHERE school_id = $1 AND month = $2`,
      [school.id, months[1]],
    );
  }
  console.log(`  Driver ratings: ${rows.length} added`);
}
