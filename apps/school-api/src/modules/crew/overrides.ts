import { DataSource, In } from 'typeorm';
import { DutyOverride, OverrideSubject } from '../transport/entities/duty-override.entity';

export interface OverrideView {
  on_date: string;
  reason: string;
  by: { id: number; name: string } | null;
  at: Date;
}

export async function readOverrides(
  dataSource: DataSource,
  schoolId: number,
  subject: OverrideSubject,
  ids: number[],
  onDate: string,
): Promise<Map<number, OverrideView>> {
  if (!ids.length) return new Map();
  const rows = await dataSource
    .getRepository(DutyOverride)
    .findBy({ school_id: schoolId, subject, subject_id: In(ids), on_date: onDate });
  const people: { id: number; name: string }[] = rows.length
    ? await dataSource.query(`SELECT u.id, u.name FROM users u WHERE u.id = ANY($1)`, [
        rows.map((row) => row.created_by),
      ])
    : [];
  return new Map(
    rows.map((row) => {
      const person = people.find((item) => Number(item.id) === row.created_by);
      return [
        row.subject_id,
        {
          on_date: row.on_date,
          reason: row.reason,
          by: person ? { id: Number(person.id), name: person.name } : null,
          at: row.created_at,
        },
      ];
    }),
  );
}
