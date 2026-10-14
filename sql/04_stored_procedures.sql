-- ============================================================
-- RideSync - 04 Stored Procedures
-- ============================================================
-- Error contract (custom SQLSTATEs; the API maps these to HTTP errors):
--   RS001 rider not found               RS006 rider already has an active trip
--   RS002 vehicle not found             RS007 vehicle already on an active trip
--   RS003 vehicle inactive              RS008 trip not found
--   RS004 insufficient wallet balance   RS009 invalid trip status transition
--   RS005 invalid amount (<= 0)         RS010 audit log is append-only (03 file)
-- RS006 / RS007 carry the violated partial unique index name in the
-- CONSTRAINT field and in DETAIL, so the UI can show which index fired.
-- ============================================================


-- ------------------------------------------------------------
-- Workflow 1: Atomic Booking  (sp_book_ride)
-- ------------------------------------------------------------
-- A2 changes vs A1:
--   * INOUT p_trip_id returns the new trip id (A1 returned nothing).
--   * The wallet CHECK (wallet_balance >= 0) now does the rejecting, as
--     the A1 spec intended ("rolls back on CHECK constraint failure").
--     The A1 version pre-checked the balance, so the CHECK never fired.
--   * Partial unique index violations are caught and re-raised with
--     clear messages and stable SQLSTATEs instead of a raw 23505.
--   * The trip is inserted first, and its id is passed to the audit
--     trigger, so the FARE_DEDUCTION audit row references the trip.
--
-- Atomicity: CALL runs inside a single transaction. The inner
-- BEGIN ... EXCEPTION block is a savepoint, so if any step fails, the
-- trip insert and the wallet deduction are both rolled back and the
-- error is re-raised to the caller. Concurrency: the rider row is locked
-- FOR UPDATE, so two bookings for the same rider are serialised. The
-- partial unique indexes cover races on active trips.
--
-- Usage:
--   CALL sp_book_ride('<rider uuid>', '<vehicle uuid>', 250.00, NULL);
--   -> returns one row: p_trip_id
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_book_ride(UUID, UUID, NUMERIC);
DROP PROCEDURE IF EXISTS sp_book_ride(UUID, UUID, NUMERIC, UUID);

CREATE PROCEDURE sp_book_ride(
    p_rider_id    UUID,
    p_vehicle_id  UUID,
    p_fare_amount NUMERIC,
    INOUT p_trip_id UUID DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_balance    NUMERIC;
    v_active     BOOLEAN;
    v_constraint TEXT;
BEGIN
    IF p_fare_amount IS NULL OR p_fare_amount <= 0 THEN
        RAISE EXCEPTION 'Fare must be greater than zero (got %)', p_fare_amount
            USING ERRCODE = 'RS005';
    END IF;

    -- Lock the rider row for the rest of the transaction.
    SELECT wallet_balance INTO v_balance
    FROM riders
    WHERE id = p_rider_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Rider % not found', p_rider_id USING ERRCODE = 'RS001';
    END IF;

    SELECT is_active INTO v_active FROM vehicles WHERE id = p_vehicle_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Vehicle % not found', p_vehicle_id USING ERRCODE = 'RS002';
    ELSIF NOT v_active THEN
        RAISE EXCEPTION 'Vehicle % is not active', p_vehicle_id USING ERRCODE = 'RS003';
    END IF;

    BEGIN
        -- 1) create the trip (partial unique indexes checked here)
        INSERT INTO trips (rider_id, vehicle_id, fare_amount, status)
        VALUES (p_rider_id, p_vehicle_id, p_fare_amount, 'REQUESTED')
        RETURNING id INTO p_trip_id;

        -- 2) hold the fare from the wallet. The CHECK constraint rejects
        --    a negative balance; the trigger writes the audit row.
        PERFORM set_config('ridesync.trip_id', p_trip_id::text, true);

        UPDATE riders
        SET wallet_balance = wallet_balance - p_fare_amount
        WHERE id = p_rider_id;

        PERFORM set_config('ridesync.trip_id', '', true);

    EXCEPTION
        WHEN check_violation THEN
            p_trip_id := NULL;
            RAISE EXCEPTION 'Insufficient wallet balance: fare %, available %',
                    p_fare_amount, v_balance
                USING ERRCODE = 'RS004',
                      DETAIL  = 'riders.wallet_balance CHECK (wallet_balance >= 0) rejected the deduction',
                      HINT    = 'Top up the wallet and try again';

        WHEN unique_violation THEN
            p_trip_id := NULL;
            GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;

            IF v_constraint = 'idx_unique_active_rider_trip' THEN
                RAISE EXCEPTION 'Rider already has an active trip (REQUESTED or IN TRANSIT)'
                    USING ERRCODE    = 'RS006',
                          CONSTRAINT = v_constraint,
                          DETAIL     = 'Blocked by partial unique index ' || v_constraint,
                          HINT       = 'Complete the current trip first';
            ELSIF v_constraint = 'idx_unique_active_vehicle_trip' THEN
                RAISE EXCEPTION 'Vehicle is already serving an active trip'
                    USING ERRCODE    = 'RS007',
                          CONSTRAINT = v_constraint,
                          DETAIL     = 'Blocked by partial unique index ' || v_constraint,
                          HINT       = 'Choose another vehicle';
            ELSE
                RAISE;
            END IF;
    END;

    RAISE NOTICE 'Ride % booked for rider %', p_trip_id, p_rider_id;
END;
$$;


-- ------------------------------------------------------------
-- A2: Trip status transitions (sp_update_trip_status)
-- ------------------------------------------------------------
-- Allowed: REQUESTED -> IN TRANSIT -> COMPLETED (forward only).
-- Completing a trip frees the rider and the vehicle, which lets the UI
-- demonstrate the partial unique indexes. The fare was already taken at
-- booking, so the wallet does not change here.
--
-- Usage: CALL sp_update_trip_status('<trip uuid>', 'IN TRANSIT');
-- ------------------------------------------------------------
CREATE OR REPLACE PROCEDURE sp_update_trip_status(
    p_trip_id    UUID,
    p_new_status trip_status
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_current trip_status;
BEGIN
    SELECT status INTO v_current FROM trips WHERE id = p_trip_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Trip % not found', p_trip_id USING ERRCODE = 'RS008';
    END IF;

    IF NOT (
        (v_current = 'REQUESTED'  AND p_new_status = 'IN TRANSIT') OR
        (v_current = 'IN TRANSIT' AND p_new_status = 'COMPLETED')
    ) THEN
        RAISE EXCEPTION 'Cannot move trip from % to %', v_current, p_new_status
            USING ERRCODE = 'RS009',
                  HINT    = 'Allowed: REQUESTED -> IN TRANSIT -> COMPLETED';
    END IF;

    UPDATE trips SET status = p_new_status WHERE id = p_trip_id;
END;
$$;


-- ------------------------------------------------------------
-- A2: Wallet top-up (sp_top_up_wallet)
-- ------------------------------------------------------------
-- Lets the demo recover after an "insufficient balance" failure.
-- The audit trigger logs it as TOP_UP.
--
-- Usage: CALL sp_top_up_wallet('<rider uuid>', 500.00, NULL);
--   -> returns one row: p_new_balance
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_top_up_wallet(UUID, NUMERIC, NUMERIC);

CREATE PROCEDURE sp_top_up_wallet(
    p_rider_id UUID,
    p_amount   NUMERIC,
    INOUT p_new_balance NUMERIC DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 100000 THEN
        RAISE EXCEPTION 'Top-up amount must be between 0 and 100000 (got %)', p_amount
            USING ERRCODE = 'RS005';
    END IF;

    UPDATE riders
    SET wallet_balance = wallet_balance + p_amount
    WHERE id = p_rider_id
    RETURNING wallet_balance INTO p_new_balance;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Rider % not found', p_rider_id USING ERRCODE = 'RS001';
    END IF;
END;
$$;
