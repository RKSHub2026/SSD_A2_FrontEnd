import { one } from "../db/pg.js";
import { escapeLike, offsetOf, orderBy, paginate, Where } from "../lib/sql.js";
import { TRIP_COLS, TRIP_FROM, VEHICLE_COLS } from "./columns.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SORT = {
  license_plate: "v.license_plate",
  class: "v.class",
  total_trips: "COALESCE(s.total_trips, 0)",
  total_earnings: "COALESCE(s.total_earnings, 0)",
};

const ACTIVE_TRIP_EXISTS = `EXISTS (
  SELECT 1 FROM trips a WHERE a.vehicle_id = v.id AND a.status IN ('REQUESTED', 'IN TRANSIT'))`;

const FROM = `FROM vehicles v LEFT JOIN mv_vehicle_stats s ON s.vehicle_id = v.id`;

/** GET /api/vehicles - filter by plate / class / active / bookable, sort by MV stats. */
export async function listVehicles(db, q) {
  const w = new Where();
  if (q.q) {
    if (UUID_RE.test(q.q)) w.add("v.id = $?::uuid", q.q);
    else w.add("v.license_plate ILIKE $? ESCAPE '\\'", `%${escapeLike(q.q)}%`);
  }
  w.addIf(q.class, "v.class = $?");
  w.addIf(q.active, "v.is_active = $?::boolean");
  if (q.available === true) w.add(`v.is_active AND NOT ${ACTIVE_TRIP_EXISTS}`);
  if (q.available === false) w.add(`(NOT v.is_active OR ${ACTIVE_TRIP_EXISTS})`);

  const countParams = [...w.params];
  const limit = w.bind(q.pageSize);
  const offset = w.bind(offsetOf(q.page, q.pageSize));

  const [items, count] = await Promise.all([
    db.query(
      `SELECT ${VEHICLE_COLS} ${FROM}
       ${w.sql()}
       ${orderBy(SORT, q.sort, q.order, "v.id")}
       LIMIT ${limit} OFFSET ${offset}`,
      w.params,
    ),
    one(db, `SELECT count(*)::int AS total ${FROM} ${w.sql()}`, countParams),
  ]);
  return paginate(items.rows, count?.total ?? 0, q.page, q.pageSize);
}

/** GET /api/vehicles/:id */
export async function getVehicle(db, id) {
  const vehicle = await one(
    db,
    `SELECT ${VEHICLE_COLS},
            COALESCE(s.completed_trips, 0) AS "completedTrips",
            s.last_trip_at                 AS "lastTripAt",
            mv_vehicle_stats_last_refreshed() AS "statsRefreshedAt"
     ${FROM}
     WHERE v.id = $1::uuid`,
    [id],
  );
  if (!vehicle) return null;
  const activeTrip = await one(
    db,
    `SELECT ${TRIP_COLS} ${TRIP_FROM}
     WHERE t.vehicle_id = $1::uuid AND t.status IN ('REQUESTED', 'IN TRANSIT')
     LIMIT 1`,
    [id],
  );
  return { ...vehicle, activeTrip };
}
