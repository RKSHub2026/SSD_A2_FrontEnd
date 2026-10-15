-- ============================================================
-- RideSync test fixtures (loaded into the ridesync_test database by
-- test/support/test-db.js, after the sql/0*.sql files).
-- Small and deterministic: every scenario the tests need has its own
-- named rider, so test files do not depend on each other.
-- Dates are relative to CURRENT_DATE so the analytics always have data.
-- ============================================================

-- Named riders (one per scenario) ---------------------------------------
INSERT INTO riders (id, name, wallet_balance) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'Test Asha',  5000.00),  -- API booking success
  ('aaaaaaaa-0000-4000-8000-000000000002', 'Test Bala',    50.00),  -- insufficient balance
  ('aaaaaaaa-0000-4000-8000-000000000003', 'Test Chen',  5000.00),  -- already has an active trip
  ('aaaaaaaa-0000-4000-8000-000000000004', 'Test Dev',   5000.00),  -- status flow
  ('aaaaaaaa-0000-4000-8000-000000000005', 'Test Ekta',  3000.00),  -- audit history
  ('aaaaaaaa-0000-4000-8000-000000000006', 'Test Farah', 3000.00),  -- browser: booking
  ('aaaaaaaa-0000-4000-8000-000000000007', 'Test Gopal',   50.00),  -- browser: insufficient balance
  ('aaaaaaaa-0000-4000-8000-000000000008', 'Test Hari',  3000.00);  -- browser: status flow

-- 22 more riders so lists have more than one page (20 per page)
INSERT INTO riders (id, name, wallet_balance)
SELECT ('aaaaaaaa-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
       'Rider ' || lpad(g::text, 2, '0'),
       1000 + g * 10
FROM generate_series(9, 30) g;

-- Vehicles: 12 active, 1 out of service ----------------------------------
INSERT INTO vehicles (id, license_plate, class, is_active)
SELECT ('bbbbbbbb-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
       'MH' || lpad(g::text, 2, '0') || 'TS' || lpad(g::text, 4, '0'),
       (ARRAY['Sedan', 'SUV', 'Hatchback'])[1 + g % 3],
       g <> 13
FROM generate_series(1, 13) g;

-- History: 12 vehicles x 20 days of completed trips (bulk riders only) ------
INSERT INTO trips (rider_id, vehicle_id, fare_amount, status, created_at)
SELECT ('aaaaaaaa-0000-4000-8000-' || lpad((9 + (v * 7 + d) % 22)::text, 12, '0'))::uuid,
       ('bbbbbbbb-0000-4000-8000-' || lpad(v::text, 12, '0'))::uuid,
       100 + (v * 37 + d * 11) % 500,
       'COMPLETED',
       (CURRENT_DATE - d) + TIME '10:00'
FROM generate_series(1, 12) v, generate_series(1, 20) d;

-- Wallet history for Test Ekta: two top-ups and one completed booking ------
CALL sp_top_up_wallet('aaaaaaaa-0000-4000-8000-000000000005', 500, NULL);
CALL sp_top_up_wallet('aaaaaaaa-0000-4000-8000-000000000005', 250, NULL);
DO $$
DECLARE t UUID;
BEGIN
  CALL sp_book_ride('aaaaaaaa-0000-4000-8000-000000000005', 'bbbbbbbb-0000-4000-8000-000000000005', 120, t);
  CALL sp_update_trip_status(t, 'IN TRANSIT');
  CALL sp_update_trip_status(t, 'COMPLETED');
END $$;

-- Test Chen is on an active trip in vehicle 3 (REQUESTED) -------------------
CALL sp_book_ride('aaaaaaaa-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000003', 200, NULL);

-- Statistics view up to date with the fixtures ------------------------------
SELECT * FROM refresh_mv_vehicle_stats();
