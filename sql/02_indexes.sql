-- ============================================================
-- RideSync - 02 Indexes
-- ============================================================

-- ------------------------------------------------------------
-- 1. PARTIAL UNIQUE INDEXES (business rules)
-- ------------------------------------------------------------

-- A rider may have at most one active trip (A1 requirement, unchanged).
CREATE UNIQUE INDEX idx_unique_active_rider_trip
ON trips (rider_id)
WHERE status IN ('REQUESTED', 'IN TRANSIT');

-- A2: a vehicle may serve at most one active trip at a time.
-- (Before this, two riders could book the same car simultaneously.)
CREATE UNIQUE INDEX idx_unique_active_vehicle_trip
ON trips (vehicle_id)
WHERE status IN ('REQUESTED', 'IN TRANSIT');


-- ------------------------------------------------------------
-- 2. TRIPS - browsing / analytics
-- ------------------------------------------------------------

-- A2: composite (fk, created_at DESC) replaces the single-column
-- idx_trips_rider_id / idx_trips_vehicle_id. Serves both the FK lookups
-- and "trips of rider X, newest first" pagination in the UI.
CREATE INDEX idx_trips_rider_created   ON trips (rider_id,   created_at DESC);
CREATE INDEX idx_trips_vehicle_created ON trips (vehicle_id, created_at DESC);

-- Global "latest trips" browse / keyset pagination.
CREATE INDEX idx_trips_created_at ON trips (created_at);

-- A2: replaces idx_trips_status_completed ON trips(status) WHERE status='COMPLETED'.
-- Indexing the constant column `status` gave the planner nothing useful.
-- This partial covering index lets Workflow 2 read a date range of
-- completed trips with an index-only scan.
CREATE INDEX idx_trips_completed_created
ON trips (created_at) INCLUDE (vehicle_id, fare_amount)
WHERE status = 'COMPLETED';


-- ------------------------------------------------------------
-- 3. VEHICLES
-- ------------------------------------------------------------
-- A2: idx_vehicles_license_plate removed - the UNIQUE constraint on
-- license_plate already creates an identical index.
CREATE INDEX idx_vehicles_active_status ON vehicles (is_active);


-- ------------------------------------------------------------
-- 4. RIDERS
-- ------------------------------------------------------------
CREATE INDEX idx_riders_name ON riders (name);
-- A2: case-insensitive prefix search for the rider picker:
--   WHERE lower(name) LIKE lower($1) || '%'
CREATE INDEX idx_riders_name_lower ON riders (lower(name) text_pattern_ops);


-- ------------------------------------------------------------
-- 5. WALLET AUDIT LOGS
-- ------------------------------------------------------------
-- A2: missing in A1 (the ERD claimed it existed). Serves the Audit
-- Trail screen: one rider, date range, ordered by time.
CREATE INDEX idx_wallet_audit_rider_ts ON wallet_audit_logs (rider_id, timestamp DESC);
-- A2: "which audit row did this booking write?" (trip detail / booking result).
-- Partial: only fare deductions made by sp_book_ride carry a trip_id.
CREATE INDEX idx_wallet_audit_trip ON wallet_audit_logs (trip_id) WHERE trip_id IS NOT NULL;
