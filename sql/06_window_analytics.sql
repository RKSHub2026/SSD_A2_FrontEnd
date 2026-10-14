-- ============================================================
-- RideSync - 06 Workflow 2: SQL Window Analytics
-- 7-day moving average of fare revenue per vehicle + DENSE_RANK()
-- ============================================================
-- A2 changes vs the A1 script:
--   * Now a parameterised SQL function (date range, optional vehicle,
--     time zone), so the API can call it directly. The CTE + window
--     logic stays inside the database.
--   * True calendar 7-day window. A1 used ROWS BETWEEN 6 PRECEDING over
--     the days that had trips only, so a vehicle with gaps averaged
--     over more than 7 calendar days. A dense calendar (vehicle x day,
--     with 0 revenue on idle days) makes ROWS 6 PRECEDING exactly 7 days.
--   * Reads 6 days before p_from, so the first plotted day still has a
--     full 7-day window.
--   * Ranks are computed across ALL vehicles first, then filtered, so a
--     single-vehicle query still returns its real rank.
--   * Date-range filter is sargable -> uses idx_trips_completed_created.
--
-- Usage:
--   SELECT * FROM fn_vehicle_revenue_moving_avg();                       -- last 30 days
--   SELECT * FROM fn_vehicle_revenue_moving_avg('2026-10-01','2026-10-12');
--   SELECT * FROM fn_vehicle_revenue_moving_avg(CURRENT_DATE, CURRENT_DATE)
--            WHERE rank_on_day <= 10;                                    -- today's top 10
--   SELECT * FROM fn_vehicle_revenue_moving_avg(NULL, NULL, '<vehicle uuid>'); -- one vehicle
-- ============================================================

DROP FUNCTION IF EXISTS fn_vehicle_revenue_moving_avg(DATE, DATE, UUID, TEXT);

CREATE FUNCTION fn_vehicle_revenue_moving_avg(
    p_from       DATE DEFAULT NULL,   -- NULL -> CURRENT_DATE - 29
    p_to         DATE DEFAULT NULL,   -- NULL -> CURRENT_DATE
    p_vehicle_id UUID DEFAULT NULL,   -- NULL -> all vehicles
    p_tz         TEXT DEFAULT NULL    -- NULL -> session TimeZone (same as CURRENT_DATE)
)
RETURNS TABLE (
    vehicle_id     UUID,
    license_plate  VARCHAR,
    trip_date      DATE,
    trips_that_day BIGINT,
    daily_revenue  NUMERIC,
    moving_avg_7d  NUMERIC,
    rank_on_day    BIGINT
)
LANGUAGE sql
STABLE
AS $$
WITH params AS (
    SELECT COALESCE(p_from, CURRENT_DATE - 29)            AS d_from,
           COALESCE(p_to,   CURRENT_DATE)                 AS d_to,
           COALESCE(p_tz,   current_setting('TimeZone'))  AS tz
),
bounds AS (
    SELECT d_from, d_to, tz,
           ((d_from - 6)::timestamp AT TIME ZONE tz) AS ts_from,
           ((d_to + 1)::timestamp   AT TIME ZONE tz) AS ts_to
    FROM params
),
-- Step 1: revenue per vehicle per day (completed trips only)
daily AS (
    SELECT t.vehicle_id,
           (t.created_at AT TIME ZONE b.tz)::date AS trip_date,
           COUNT(*)           AS trips,
           SUM(t.fare_amount) AS revenue
    FROM trips t
    CROSS JOIN bounds b
    WHERE t.status = 'COMPLETED'
      AND t.created_at >= b.ts_from
      AND t.created_at <  b.ts_to
    GROUP BY 1, 2
),
-- Step 2: dense calendar so idle days count as 0
calendar AS (
    SELECT dv.vehicle_id, g::date AS trip_date
    FROM (SELECT DISTINCT d.vehicle_id FROM daily d) dv
    CROSS JOIN bounds b
    CROSS JOIN generate_series(b.d_from - 6, b.d_to, INTERVAL '1 day') AS g
),
-- Step 3: 7-day moving average (window function)
moving AS (
    SELECT c.vehicle_id,
           c.trip_date,
           COALESCE(d.trips, 0)   AS trips,
           COALESCE(d.revenue, 0) AS revenue,
           AVG(COALESCE(d.revenue, 0)) OVER (
               PARTITION BY c.vehicle_id
               ORDER BY c.trip_date
               ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
           ) AS ma7
    FROM calendar c
    LEFT JOIN daily d
           ON d.vehicle_id = c.vehicle_id AND d.trip_date = c.trip_date
),
-- Step 4: rank vehicles per day by moving average (DENSE_RANK)
ranked AS (
    SELECT m.*,
           DENSE_RANK() OVER (
               PARTITION BY m.trip_date
               ORDER BY ROUND(m.ma7, 2) DESC
           ) AS rnk
    FROM moving m
    CROSS JOIN bounds b
    WHERE m.trip_date BETWEEN b.d_from AND b.d_to
)
SELECT r.vehicle_id,
       v.license_plate,
       r.trip_date,
       r.trips,
       r.revenue,
       ROUND(r.ma7, 2),
       r.rnk
FROM ranked r
JOIN vehicles v ON v.id = r.vehicle_id
WHERE p_vehicle_id IS NULL OR r.vehicle_id = p_vehicle_id
ORDER BY r.trip_date DESC, r.rnk, v.license_plate;
$$;


-- ------------------------------------------------------------
-- Workflow 2 demo (what the A1 script printed): top 5 vehicles
-- per day over the last 7 days.
-- ------------------------------------------------------------
SELECT license_plate, trip_date, daily_revenue, moving_avg_7d, rank_on_day
FROM fn_vehicle_revenue_moving_avg(CURRENT_DATE - 6, CURRENT_DATE)
WHERE rank_on_day <= 5
ORDER BY trip_date DESC, rank_on_day;
