-- ============================================================
-- RideSync - 01 Schema DDL (PostgreSQL 13+)
-- ============================================================
-- A2 changes (see README "Changes to the inherited backend"):
--   * wallet_audit_logs.trip_id added (nullable) so a FARE_DEDUCTION
--     audit row points at the trip that caused it.
--   * Comments document the exact enum spelling: 'IN TRANSIT' (space).
-- gen_random_uuid() is built in from PostgreSQL 13 onwards.
-- ============================================================

-- 1. Trip status ENUM.
--    NOTE: the middle value is 'IN TRANSIT' with a SPACE, not an underscore.
CREATE TYPE trip_status AS ENUM ('REQUESTED', 'IN TRANSIT', 'COMPLETED');

-- 2. Riders
CREATE TABLE riders (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name           VARCHAR(50)    NOT NULL,
    wallet_balance DECIMAL(10, 2) NOT NULL DEFAULT 0.00
                   CHECK (wallet_balance >= 0.00)
);

-- 3. Vehicles
CREATE TABLE vehicles (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    license_plate VARCHAR(50) NOT NULL UNIQUE,
    class         VARCHAR(50) NOT NULL,
    is_active     BOOLEAN     NOT NULL DEFAULT TRUE
);

-- 4. Trips
CREATE TABLE trips (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id    UUID           NOT NULL REFERENCES riders(id),
    vehicle_id  UUID           NOT NULL REFERENCES vehicles(id),
    fare_amount DECIMAL(10, 2) NOT NULL CHECK (fare_amount >= 0.00),
    status      trip_status    NOT NULL DEFAULT 'REQUESTED',
    created_at  TIMESTAMPTZ    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 5. Wallet audit logs (append-only; see 03_triggers_and_audit.sql)
CREATE TABLE wallet_audit_logs (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id       UUID           NOT NULL REFERENCES riders(id),
    amount_changed DECIMAL(10, 2) NOT NULL,
    action_type    VARCHAR(50)    NOT NULL,
    balance_after  DECIMAL(10, 2) NOT NULL CHECK (balance_after >= 0.00),
    timestamp      TIMESTAMPTZ    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- A2: the trip that caused this wallet change (NULL for top-ups /
    -- seeded history). Filled by the trigger from sp_book_ride.
    trip_id        UUID           NULL REFERENCES trips(id)
);
