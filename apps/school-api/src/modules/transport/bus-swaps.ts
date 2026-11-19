export interface Queryable {
  query(sql: string, parameters?: unknown[]): Promise<unknown>;
}

export async function swappedVehicle(db: Queryable, routeId: number, date: string): Promise<number | null> {
  const rows = (await db.query(
    `SELECT vehicle_id FROM route_bus_swaps WHERE route_id = $1 AND swap_date = $2 AND deleted_at IS NULL`,
    [routeId, date],
  )) as { vehicle_id: number }[];
  return rows[0] ? Number(rows[0].vehicle_id) : null;
}

export async function vehicleOnDay(
  db: Queryable,
  route: { id: number; vehicle_id: number | null },
  date: string,
): Promise<number | null> {
  return (await swappedVehicle(db, route.id, date)) ?? route.vehicle_id;
}

export async function routeIdsRunBy(
  db: Queryable,
  schoolId: number,
  vehicleId: number,
  date: string,
): Promise<number[]> {
  const rows = (await db.query(
    `SELECT r.id FROM transport_routes r
     LEFT JOIN route_bus_swaps w ON w.route_id = r.id AND w.swap_date = $3 AND w.deleted_at IS NULL
     WHERE r.school_id = $1 AND r.deleted_at IS NULL AND r.is_active = true
       AND COALESCE(w.vehicle_id, r.vehicle_id) = $2
     ORDER BY r.code`,
    [schoolId, vehicleId, date],
  )) as { id: number }[];
  return rows.map((row) => Number(row.id));
}
