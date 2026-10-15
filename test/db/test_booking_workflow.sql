-- ============================================================
-- RideSync - database smoke tests (Workflow 1 + supporting objects)
-- ============================================================
-- Runs inside ONE transaction and ROLLS BACK at the end, so it is safe
-- to run against a seeded database. Any failure aborts with "FAIL: ...".
--
--   psql -X -v ON_ERROR_STOP=1 -d ridesync_v2 -f test/db/test_booking_workflow.sql
-- ============================================================
\set ON_ERROR_STOP 1
SET client_min_messages = notice;
BEGIN;

-- Fixtures (fixed UUIDs that the seeder never generates)
INSERT INTO riders (id, name, wallet_balance) VALUES
  ('f0000000-0000-0000-0000-000000000001', 'TEST_Asha', 500.00),
  ('f0000000-0000-0000-0000-000000000002', 'TEST_Bala',  50.00),
  ('f0000000-0000-0000-0000-000000000003', 'TEST_Chen', 900.00);
INSERT INTO vehicles (id, license_plate, class, is_active) VALUES
  ('fa000000-0000-0000-0000-000000000001', 'TEST-0001', 'Sedan', TRUE),
  ('fa000000-0000-0000-0000-000000000002', 'TEST-0002', 'SUV',   FALSE),
  ('fa000000-0000-0000-0000-000000000003', 'TEST-0003', 'SUV',   TRUE);

-- 1. Happy path: trip created, wallet debited, audit row linked to trip
DO $$
DECLARE
  t   UUID;
  bal NUMERIC;
  a   RECORD;
BEGIN
  CALL sp_book_ride('f0000000-0000-0000-0000-000000000001',
                    'fa000000-0000-0000-0000-000000000001', 120.00, t);
  ASSERT t IS NOT NULL, 'FAIL: sp_book_ride did not return trip id';

  SELECT wallet_balance INTO bal FROM riders WHERE id = 'f0000000-0000-0000-0000-000000000001';
  ASSERT bal = 380.00, format('FAIL: balance expected 380.00 got %s', bal);

  SELECT * INTO a FROM wallet_audit_logs
  WHERE rider_id = 'f0000000-0000-0000-0000-000000000001'
  ORDER BY timestamp DESC LIMIT 1;
  ASSERT a.action_type = 'FARE_DEDUCTION' AND a.amount_changed = -120.00
     AND a.balance_after = 380.00 AND a.trip_id = t,
     'FAIL: audit row missing or not linked to trip';

  ASSERT (SELECT status FROM trips WHERE id = t) = 'REQUESTED', 'FAIL: status not REQUESTED';
  RAISE NOTICE 'PASS 1  booking success + audit row linked to trip %', t;
END $$;

-- 2. Same rider again -> blocked by idx_unique_active_rider_trip (RS006), nothing changes
DO $$
DECLARE t UUID; n_before INT; n_after INT; bal NUMERIC;
BEGIN
  SELECT count(*) INTO n_before FROM wallet_audit_logs;
  BEGIN
    CALL sp_book_ride('f0000000-0000-0000-0000-000000000001',
                      'fa000000-0000-0000-0000-000000000003', 50.00, t);
    RAISE EXCEPTION 'FAIL: second active trip was allowed';
  EXCEPTION WHEN SQLSTATE 'RS006' THEN NULL;
  END;
  SELECT count(*) INTO n_after FROM wallet_audit_logs;
  SELECT wallet_balance INTO bal FROM riders WHERE id = 'f0000000-0000-0000-0000-000000000001';
  ASSERT n_before = n_after AND bal = 380.00, 'FAIL: rollback incomplete after RS006';
  RAISE NOTICE 'PASS 2  second active trip blocked (RS006), wallet + audit untouched';
END $$;

-- 3. Another rider, same (busy) vehicle -> RS007
DO $$
DECLARE t UUID;
BEGIN
  CALL sp_book_ride('f0000000-0000-0000-0000-000000000003',
                    'fa000000-0000-0000-0000-000000000001', 50.00, t);
  RAISE EXCEPTION 'FAIL: busy vehicle was double-booked';
EXCEPTION WHEN SQLSTATE 'RS007' THEN
  RAISE NOTICE 'PASS 3  busy vehicle blocked (RS007)';
END $$;

-- 4. Insufficient balance -> CHECK constraint fires -> RS004, no trip left behind
DO $$
DECLARE t UUID; n INT;
BEGIN
  BEGIN
    CALL sp_book_ride('f0000000-0000-0000-0000-000000000002',
                      'fa000000-0000-0000-0000-000000000003', 100.00, t);
    RAISE EXCEPTION 'FAIL: overdraft allowed';
  EXCEPTION WHEN SQLSTATE 'RS004' THEN NULL;
  END;
  SELECT count(*) INTO n FROM trips WHERE rider_id = 'f0000000-0000-0000-0000-000000000002';
  ASSERT n = 0, 'FAIL: trip row survived the rollback';
  RAISE NOTICE 'PASS 4  insufficient balance (RS004) rolled back trip insert';
END $$;

-- 5. Validation errors
DO $$ DECLARE t UUID; BEGIN
  CALL sp_book_ride('f0000000-0000-0000-0000-000000000002', 'fa000000-0000-0000-0000-000000000002', 10, t);
  RAISE EXCEPTION 'FAIL: inactive vehicle accepted';
EXCEPTION WHEN SQLSTATE 'RS003' THEN RAISE NOTICE 'PASS 5a inactive vehicle (RS003)'; END $$;

DO $$ DECLARE t UUID; BEGIN
  CALL sp_book_ride('f0000000-0000-0000-0000-0000000000ff', 'fa000000-0000-0000-0000-000000000003', 10, t);
  RAISE EXCEPTION 'FAIL: unknown rider accepted';
EXCEPTION WHEN SQLSTATE 'RS001' THEN RAISE NOTICE 'PASS 5b unknown rider (RS001)'; END $$;

DO $$ DECLARE t UUID; BEGIN
  CALL sp_book_ride('f0000000-0000-0000-0000-000000000002', 'fa000000-0000-0000-0000-0000000000ff', 10, t);
  RAISE EXCEPTION 'FAIL: unknown vehicle accepted';
EXCEPTION WHEN SQLSTATE 'RS002' THEN RAISE NOTICE 'PASS 5c unknown vehicle (RS002)'; END $$;

DO $$ DECLARE t UUID; BEGIN
  CALL sp_book_ride('f0000000-0000-0000-0000-000000000002', 'fa000000-0000-0000-0000-000000000003', 0, t);
  RAISE EXCEPTION 'FAIL: zero fare accepted';
EXCEPTION WHEN SQLSTATE 'RS005' THEN RAISE NOTICE 'PASS 5d zero fare (RS005)'; END $$;

-- 6. Status transitions, then the rider can book again
DO $$
DECLARE t UUID; t2 UUID;
BEGIN
  SELECT id INTO t FROM trips
  WHERE rider_id = 'f0000000-0000-0000-0000-000000000001' AND status = 'REQUESTED';

  BEGIN
    CALL sp_update_trip_status(t, 'COMPLETED');
    RAISE EXCEPTION 'FAIL: skipped IN TRANSIT';
  EXCEPTION WHEN SQLSTATE 'RS009' THEN NULL;
  END;

  CALL sp_update_trip_status(t, 'IN TRANSIT');
  CALL sp_update_trip_status(t, 'COMPLETED');
  ASSERT (SELECT status FROM trips WHERE id = t) = 'COMPLETED', 'FAIL: not completed';

  CALL sp_book_ride('f0000000-0000-0000-0000-000000000001',
                    'fa000000-0000-0000-0000-000000000001', 30.00, t2);
  ASSERT t2 IS NOT NULL, 'FAIL: could not rebook after completion';
  RAISE NOTICE 'PASS 6  REQUESTED -> IN TRANSIT -> COMPLETED, invalid jump rejected (RS009), rebook OK';
END $$;

-- 7. Top-up
DO $$
DECLARE nb NUMERIC; a RECORD;
BEGIN
  CALL sp_top_up_wallet('f0000000-0000-0000-0000-000000000002', 200.00, nb);
  ASSERT nb = 250.00, format('FAIL: new balance %s', nb);
  SELECT * INTO a FROM wallet_audit_logs
  WHERE rider_id = 'f0000000-0000-0000-0000-000000000002' ORDER BY timestamp DESC LIMIT 1;
  ASSERT a.action_type = 'TOP_UP' AND a.trip_id IS NULL, 'FAIL: top-up audit row';
  BEGIN
    CALL sp_top_up_wallet('f0000000-0000-0000-0000-000000000002', -5, nb);
    RAISE EXCEPTION 'FAIL: negative top-up accepted';
  EXCEPTION WHEN SQLSTATE 'RS005' THEN NULL;
  END;
  RAISE NOTICE 'PASS 7  top-up logged as TOP_UP; invalid amount rejected';
END $$;

-- 8. Audit log is append-only
DO $$ BEGIN
  UPDATE wallet_audit_logs SET amount_changed = 0
  WHERE rider_id = 'f0000000-0000-0000-0000-000000000002';
  RAISE EXCEPTION 'FAIL: audit row updated';
EXCEPTION WHEN SQLSTATE 'RS010' THEN RAISE NOTICE 'PASS 8a audit UPDATE blocked (RS010)'; END $$;

DO $$ BEGIN
  DELETE FROM wallet_audit_logs WHERE rider_id = 'f0000000-0000-0000-0000-000000000002';
  RAISE EXCEPTION 'FAIL: audit row deleted';
EXCEPTION WHEN SQLSTATE 'RS010' THEN RAISE NOTICE 'PASS 8b audit DELETE blocked (RS010)'; END $$;

-- 9. Backward-compatible 3-argument CALL still works
CALL sp_book_ride('f0000000-0000-0000-0000-000000000002',
                  'fa000000-0000-0000-0000-000000000003', 20.00);

-- 10. Materialized view refresh (CONCURRENTLY) + refresh log
DO $$
DECLARE r RECORD; s RECORD;
BEGIN
  SELECT * INTO r FROM refresh_mv_vehicle_stats();
  ASSERT r.refreshed_at IS NOT NULL, 'FAIL: refresh returned nothing';
  ASSERT mv_vehicle_stats_last_refreshed() = r.refreshed_at, 'FAIL: last refreshed mismatch';
  SELECT * INTO s FROM mv_vehicle_stats WHERE vehicle_id = 'fa000000-0000-0000-0000-000000000001';
  ASSERT s.total_trips = 2 AND s.completed_trips = 1 AND s.total_earnings = 120.00,
     format('FAIL: MV stats %s', s);
  RAISE NOTICE 'PASS 10 concurrent refresh + log (% ms)', r.duration_ms;
END $$;

-- 11. Workflow 2 function: ranking is global even when filtering one vehicle
DO $$
DECLARE all_rank BIGINT; one_rank BIGINT; n INT;
BEGIN
  UPDATE trips SET created_at = now() - INTERVAL '1 day' WHERE rider_id = 'f0000000-0000-0000-0000-000000000001' AND status = 'COMPLETED';
  SELECT count(*) INTO n FROM fn_vehicle_revenue_moving_avg(CURRENT_DATE - 2, CURRENT_DATE);
  ASSERT n > 0, 'FAIL: analytics returned no rows';
  SELECT rank_on_day INTO all_rank FROM fn_vehicle_revenue_moving_avg(CURRENT_DATE - 2, CURRENT_DATE)
   WHERE vehicle_id = 'fa000000-0000-0000-0000-000000000001' AND trip_date = CURRENT_DATE;
  SELECT rank_on_day INTO one_rank FROM fn_vehicle_revenue_moving_avg(CURRENT_DATE - 2, CURRENT_DATE, 'fa000000-0000-0000-0000-000000000001')
   WHERE trip_date = CURRENT_DATE;
  ASSERT all_rank = one_rank, format('FAIL: rank differs (%s vs %s)', all_rank, one_rank);
  RAISE NOTICE 'PASS 11 moving-average function (rank % consistent)', one_rank;
END $$;

ROLLBACK;
\echo 'ALL DATABASE TESTS PASSED (changes rolled back)'
