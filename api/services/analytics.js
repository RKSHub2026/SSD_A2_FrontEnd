import { one } from "../db/pg.js";
import { offsetOf, orderBy, paginate } from "../lib/sql.js";
import { MV_STAT_COLS } from "./columns.js";

/**
 * Workflow 2 + the materialized view. The window functions, the dense
 * calendar and the ranking live in fn_vehicle_revenue_moving_avg
 * (sql/06_window_analytics.sql); the view and its refresh log in
 * sql/05_materialized_views.sql. This file only calls them and shapes the
 * rows for charts and tables.
 */

/** Effective date range: the function's own defaults (last 30 days). */
const RANGE_SQL = `
  SELECT COALESCE($1::date, CURRENT_DATE - 29)::text AS "from",
         COALESCE($2::date, CURRENT_DATE)::text      AS "to"`;

/**
 * GET /api/analytics/moving-average
 * One series per vehicle, oldest day first. Without vehicleId, keeps the
 * vehicles ranked <= topN on the LAST day of the range (DENSE_RANK, so ties
 * can return a few more than topN).
 */
export async function movingAverage(db, q) {
  const range = await one(db, RANGE_SQL, [q.from ?? null, q.to ?? null]);
  const params = [range.from, range.to, q.vehicleId ?? null];

  const sql = q.vehicleId
    ? `SELECT * FROM fn_vehicle_revenue_moving_avg($1::date, $2::date, $3::uuid)
       ORDER BY trip_date`
    : `WITH r AS (SELECT * FROM fn_vehicle_revenue_moving_avg($1::date, $2::date, $3::uuid)),
            top AS (SELECT vehicle_id FROM r WHERE trip_date = $2::date AND rank_on_day <= $4)
       SELECT r.* FROM r WHERE r.vehicle_id IN (SELECT vehicle_id FROM top)
       ORDER BY r.trip_date`;
  if (!q.vehicleId) params.push(q.topN);

  const { rows } = await db.query(sql, params);

  const byVehicle = new Map();
  for (const row of rows) {
    let s = byVehicle.get(row.vehicle_id);
    if (!s) {
      s = { vehicleId: row.vehicle_id, licensePlate: row.license_plate, rankOnLastDay: null, points: [] };
      byVehicle.set(row.vehicle_id, s);
    }
    s.points.push({
      date: row.trip_date,
      trips: row.trips_that_day,
      revenue: row.daily_revenue,
      movingAvg7d: row.moving_avg_7d,
      rank: row.rank_on_day,
    });
    if (row.trip_date === range.to) s.rankOnLastDay = row.rank_on_day;
  }
  const series = [...byVehicle.values()].sort(
    (a, b) => (a.rankOnLastDay ?? Infinity) - (b.rankOnLastDay ?? Infinity) || a.licensePlate.localeCompare(b.licensePlate),
  );

  return { from: range.from, to: range.to, vehicleId: q.vehicleId ?? null, topN: q.vehicleId ? null : q.topN, series };
}

/** GET /api/analytics/ranking - DENSE_RANK of the 7-day moving average on one day. */
export async function dailyRanking(db, q) {
  const { rows } = await db.query(
    `SELECT rank_on_day    AS rank,
            vehicle_id     AS "vehicleId",
            license_plate  AS "licensePlate",
            trips_that_day AS "tripsThatDay",
            daily_revenue  AS "dailyRevenue",
            moving_avg_7d  AS "movingAvg7d",
            trip_date::text AS date
     FROM fn_vehicle_revenue_moving_avg(COALESCE($1::date, CURRENT_DATE), COALESCE($1::date, CURRENT_DATE))
     WHERE rank_on_day <= $2
     ORDER BY rank_on_day, license_plate`,
    [q.date ?? null, q.limit],
  );
  const date = rows[0]?.date ?? (await one(db, "SELECT COALESCE($1::date, CURRENT_DATE)::text AS d", [q.date ?? null])).d;
  return { date, limit: q.limit, items: rows.map(({ date: _d, ...r }) => r) };
}

/**
 * How far the view is behind the live table: trips created since the last
 * refresh are not counted in it (status changes are not either).
 */
const FRESHNESS_SQL = `
  SELECT mv_vehicle_stats_last_refreshed()                           AS "refreshedAt",
         (SELECT count(*) FROM trips)::int                           AS "liveTrips",
         (SELECT COALESCE(sum(total_trips), 0) FROM mv_vehicle_stats)::int AS "tripsInView"`;

async function freshness(db) {
  const f = await one(db, FRESHNESS_SQL);
  return { ...f, tripsNotInView: Math.max(0, f.liveTrips - f.tripsInView) };
}

const STAT_SORT = {
  total_earnings: "s.total_earnings",
  total_trips: "s.total_trips",
  completed_trips: "s.completed_trips",
  license_plate: "s.license_plate",
};

/** GET /api/analytics/vehicle-stats - the materialized view, ranked by earnings. */
export async function vehicleStats(db, q) {
  const [items, count, fresh] = await Promise.all([
    db.query(
      `SELECT ${MV_STAT_COLS},
              (RANK() OVER (ORDER BY s.total_earnings DESC))::int AS "earningsRank"
       FROM mv_vehicle_stats s
       ${orderBy(STAT_SORT, q.sort, q.order, "s.vehicle_id")}
       LIMIT $1 OFFSET $2`,
      [q.pageSize, offsetOf(q.page, q.pageSize)],
    ),
    one(db, "SELECT count(*)::int AS total FROM mv_vehicle_stats"),
    freshness(db),
  ]);
  return { ...paginate(items.rows, count.total, q.page, q.pageSize), freshness: fresh };
}

/**
 * POST /api/analytics/vehicle-stats/refresh
 * refresh_mv_vehicle_stats() runs REFRESH MATERIALIZED VIEW CONCURRENTLY
 * (reads are not blocked) and logs it in mv_refresh_log.
 */
export async function refreshVehicleStats(db) {
  const r = await one(
    db,
    `SELECT refreshed_at AS "refreshedAt", duration_ms AS "durationMs" FROM refresh_mv_vehicle_stats()`,
  );
  return { ...r, concurrent: true, freshness: await freshness(db) };
}

/** GET /api/analytics/overview - headline numbers for the dashboard. */
export async function overview(db) {
  return one(
    db,
    `SELECT
       (SELECT count(*) FROM riders)::int                                        AS riders,
       (SELECT count(*) FROM vehicles)::int                                      AS vehicles,
       (SELECT count(*) FROM vehicles WHERE NOT is_active)::int                  AS "inactiveVehicles",
       (SELECT count(*) FROM vehicles v WHERE v.is_active AND NOT EXISTS (
          SELECT 1 FROM trips a WHERE a.vehicle_id = v.id AND a.status IN ('REQUESTED', 'IN TRANSIT')
        ))::int                                                                  AS "availableVehicles",
       (SELECT count(*) FROM trips WHERE status = 'REQUESTED')::int              AS "requestedTrips",
       (SELECT count(*) FROM trips WHERE status = 'IN TRANSIT')::int             AS "inTransitTrips",
       (SELECT count(*) FROM trips WHERE created_at >= CURRENT_DATE)::int        AS "tripsToday",
       (SELECT COALESCE(sum(fare_amount), 0) FROM trips
         WHERE status = 'COMPLETED' AND created_at >= CURRENT_DATE)              AS "revenueToday",
       (SELECT count(*) FROM wallet_audit_logs WHERE timestamp >= CURRENT_DATE)::int AS "walletChangesToday",
       mv_vehicle_stats_last_refreshed()                                         AS "statsRefreshedAt"`,
  );
}
