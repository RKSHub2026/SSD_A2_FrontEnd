import { one } from "../db/pg.js";
import { offsetOf, paginate, Where } from "../lib/sql.js";
import { AUDIT_COLS, TRIP_COLS, TRIP_FROM } from "./columns.js";

function tripFilters(q) {
  const w = new Where();
  w.addIf(q.status, "t.status = $?::trip_status");
  if (q.active === true) w.add("t.status IN ('REQUESTED', 'IN TRANSIT')");
  if (q.active === false) w.add("t.status = 'COMPLETED'");
  w.addIf(q.riderId, "t.rider_id = $?::uuid");
  w.addIf(q.vehicleId, "t.vehicle_id = $?::uuid");
  w.addIf(q.from, "t.created_at >= $?::date");
  // `to` is inclusive: everything before the next midnight
  w.addIf(q.to, "t.created_at < ($?::date + 1)");
  return w;
}

/**
 * GET /api/trips - newest first, paginated. Uses idx_trips_created_at,
 * idx_trips_rider_created / idx_trips_vehicle_created, or the partial
 * unique indexes for active trips, depending on the filters.
 */
export async function listTrips(db, q) {
  const w = tripFilters(q);
  const countParams = [...w.params];
  const limit = w.bind(q.pageSize);
  const offset = w.bind(offsetOf(q.page, q.pageSize));
  const dir = q.order === "asc" ? "ASC" : "DESC";

  const [items, count] = await Promise.all([
    db.query(
      `SELECT ${TRIP_COLS} ${TRIP_FROM}
       ${w.sql()}
       ORDER BY t.created_at ${dir}, t.id ${dir}
       LIMIT ${limit} OFFSET ${offset}`,
      w.params,
    ),
    one(db, `SELECT count(*)::int AS total FROM trips t ${w.sql()}`, countParams),
  ]);
  return paginate(items.rows, count?.total ?? 0, q.page, q.pageSize);
}

/** GET /api/trips/:id - trip + the audit rows linked to it (via wallet_audit_logs.trip_id). */
export async function getTrip(db, id) {
  const trip = await one(
    db,
    `SELECT ${TRIP_COLS}, v.class AS "vehicleClass" ${TRIP_FROM} WHERE t.id = $1::uuid`,
    [id],
  );
  if (!trip) return null;
  const audit = await db.query(
    `SELECT ${AUDIT_COLS} FROM wallet_audit_logs w
     WHERE w.trip_id = $1::uuid ORDER BY w.timestamp`,
    [id],
  );
  return { ...trip, auditEntries: audit.rows };
}

/** Single trip by id (used after booking / status changes). */
export function findTrip(db, id) {
  return one(db, `SELECT ${TRIP_COLS} ${TRIP_FROM} WHERE t.id = $1::uuid`, [id]);
}
