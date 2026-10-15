import { one } from "../db/pg.js";
import { escapeLike, offsetOf, orderBy, paginate, Where } from "../lib/sql.js";
import { AUDIT_COLS, RIDER_COLS, TRIP_COLS, TRIP_FROM } from "./columns.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SORT = { name: "r.name", wallet_balance: "r.wallet_balance" };

/** GET /api/riders - search by name fragment (or exact id), paginated. */
export async function listRiders(db, q) {
  const w = new Where();
  if (q.q) {
    if (UUID_RE.test(q.q)) w.add("r.id = $?::uuid", q.q);
    else w.add("lower(r.name) LIKE $? ESCAPE '\\'", `%${escapeLike(q.q.toLowerCase())}%`);
  }
  const countParams = [...w.params];
  const limit = w.bind(q.pageSize);
  const offset = w.bind(offsetOf(q.page, q.pageSize));

  const [items, count] = await Promise.all([
    db.query(
      `SELECT ${RIDER_COLS}
       FROM riders r
       ${w.sql()}
       ${orderBy(SORT, q.sort, q.order, "r.id")}
       LIMIT ${limit} OFFSET ${offset}`,
      w.params,
    ),
    one(db, `SELECT count(*)::int AS total FROM riders r ${w.sql()}`, countParams),
  ]);
  return paginate(items.rows, count?.total ?? 0, q.page, q.pageSize);
}

/** GET /api/riders/:id - rider + active trip + lifetime stats + last wallet change. */
export async function getRider(db, id) {
  const rider = await one(db, `SELECT ${RIDER_COLS} FROM riders r WHERE r.id = $1::uuid`, [id]);
  if (!rider) return null;

  const [activeTrip, stats, lastAudit] = await Promise.all([
    one(
      db,
      `SELECT ${TRIP_COLS} ${TRIP_FROM}
       WHERE t.rider_id = $1::uuid AND t.status IN ('REQUESTED', 'IN TRANSIT')
       LIMIT 1`,
      [id],
    ),
    one(
      db,
      `SELECT count(*)::int                                              AS "tripCount",
              (count(*) FILTER (WHERE status = 'COMPLETED'))::int         AS "completedTrips",
              COALESCE(sum(fare_amount) FILTER (WHERE status = 'COMPLETED'), 0) AS "totalSpent"
       FROM trips WHERE rider_id = $1::uuid`,
      [id],
    ),
    one(
      db,
      `SELECT ${AUDIT_COLS} FROM wallet_audit_logs w
       WHERE w.rider_id = $1::uuid
       ORDER BY w.timestamp DESC, w.id DESC
       LIMIT 1`,
      [id],
    ),
  ]);

  return {
    ...rider,
    activeTrip,
    tripCount: stats?.tripCount ?? 0,
    completedTrips: stats?.completedTrips ?? 0,
    totalSpent: stats?.totalSpent ?? 0,
    lastAudit,
  };
}
