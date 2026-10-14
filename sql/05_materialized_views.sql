-- ============================================================
-- RideSync - 05 Materialized View: vehicle lifetime stats
-- ============================================================
-- A2 changes:
--   * The refresh function now really uses REFRESH ... CONCURRENTLY (the A1
--     version did a blocking refresh, which the spec does not allow).
--   * mv_refresh_log records each refresh, which the UI needs for
--     "last refreshed". PostgreSQL does not track this itself.
--   * Extra columns: class, is_active, completed_trips, last_trip_at
--     (last_trip_at was on the A1 ERD but missing from the code).
--     total_trips = lifetime trips of ANY status (spec: "lifetime trip
--     count"); total_earnings = fares of COMPLETED trips only.
-- ============================================================

CREATE MATERIALIZED VIEW mv_vehicle_stats AS
SELECT
    v.id            AS vehicle_id,
    v.license_plate,
    v.class         AS vehicle_class,
    v.is_active,
    COUNT(t.id)                                          AS total_trips,
    COUNT(t.id) FILTER (WHERE t.status = 'COMPLETED')    AS completed_trips,
    COALESCE(SUM(t.fare_amount) FILTER (WHERE t.status = 'COMPLETED'), 0)::NUMERIC(12, 2)
                                                         AS total_earnings,
    MAX(t.created_at)                                    AS last_trip_at
FROM vehicles v
LEFT JOIN trips t ON t.vehicle_id = v.id
GROUP BY v.id, v.license_plate, v.class, v.is_active;

-- REFRESH ... CONCURRENTLY requires a UNIQUE index on the view.
CREATE UNIQUE INDEX idx_mv_vehicle_stats_id ON mv_vehicle_stats (vehicle_id);
-- Ranked table in the UI sorts by earnings.
CREATE INDEX idx_mv_vehicle_stats_earnings ON mv_vehicle_stats (total_earnings DESC);


-- ------------------------------------------------------------
-- Refresh log (A2)
-- ------------------------------------------------------------
CREATE TABLE mv_refresh_log (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    view_name    TEXT          NOT NULL,
    refreshed_at TIMESTAMPTZ   NOT NULL DEFAULT clock_timestamp(),
    duration_ms  NUMERIC(12, 3)
);
CREATE INDEX idx_mv_refresh_log_view_time ON mv_refresh_log (view_name, refreshed_at DESC);

-- The view was populated by CREATE MATERIALIZED VIEW above.
INSERT INTO mv_refresh_log (view_name, duration_ms) VALUES ('mv_vehicle_stats', NULL);


-- ------------------------------------------------------------
-- Refresh function
-- ------------------------------------------------------------
-- Usage:  SELECT * FROM refresh_mv_vehicle_stats();
--         -> refreshed_at | duration_ms
-- The A1 call form `SELECT refresh_mv_vehicle_stats();` still works.
DROP FUNCTION IF EXISTS refresh_mv_vehicle_stats();

CREATE FUNCTION refresh_mv_vehicle_stats()
RETURNS TABLE (refreshed_at TIMESTAMPTZ, duration_ms NUMERIC)
LANGUAGE plpgsql
AS $$
DECLARE
    v_start TIMESTAMPTZ := clock_timestamp();
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_vehicle_stats;

    RETURN QUERY
    INSERT INTO mv_refresh_log AS l (view_name, refreshed_at, duration_ms)
    VALUES (
        'mv_vehicle_stats',
        clock_timestamp(),
        ROUND((EXTRACT(EPOCH FROM clock_timestamp() - v_start) * 1000)::NUMERIC, 3)
    )
    RETURNING l.refreshed_at, l.duration_ms;
END;
$$;

-- Convenience: when was the view last refreshed?
--   SELECT mv_vehicle_stats_last_refreshed();
CREATE OR REPLACE FUNCTION mv_vehicle_stats_last_refreshed()
RETURNS TIMESTAMPTZ
LANGUAGE sql STABLE
AS $$
    SELECT MAX(refreshed_at) FROM mv_refresh_log WHERE view_name = 'mv_vehicle_stats';
$$;
