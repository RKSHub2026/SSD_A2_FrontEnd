-- ============================================================
-- RideSync - 03 Triggers & Audit
-- ============================================================

-- ------------------------------------------------------------
-- 1. AUDIT TRIGGER FUNCTION
-- ------------------------------------------------------------
-- A2 changes:
--   * timestamp uses clock_timestamp() instead of CURRENT_TIMESTAMP.
--     CURRENT_TIMESTAMP is frozen at transaction start, so several wallet
--     changes in one transaction got identical timestamps and the running
--     balance could not be ordered reliably.
--   * trip_id is taken from the transaction-local setting
--     'ridesync.trip_id', which sp_book_ride sets just before it deducts
--     the fare. Any other UPDATE leaves it NULL.
CREATE OR REPLACE FUNCTION fn_audit_wallet_change()
RETURNS TRIGGER AS $$
DECLARE
    v_amount_changed NUMERIC(12, 2);
    v_action_type    VARCHAR(20);
    v_trip_id        UUID;
BEGIN
    v_amount_changed := NEW.wallet_balance - OLD.wallet_balance;

    IF v_amount_changed > 0 THEN
        v_action_type := 'TOP_UP';
    ELSIF v_amount_changed < 0 THEN
        v_action_type := 'FARE_DEDUCTION';
    ELSE
        RETURN NEW;  -- no change, nothing to log
    END IF;

    v_trip_id := NULLIF(current_setting('ridesync.trip_id', true), '')::uuid;

    INSERT INTO wallet_audit_logs (
        rider_id, amount_changed, action_type, balance_after, timestamp, trip_id
    )
    VALUES (
        NEW.id, v_amount_changed, v_action_type, NEW.wallet_balance,
        clock_timestamp(), v_trip_id
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- 2. BIND TRIGGER TO RIDERS (unchanged from A1)
-- ------------------------------------------------------------
CREATE TRIGGER trg_wallet_audit
AFTER UPDATE OF wallet_balance ON riders
FOR EACH ROW
WHEN (OLD.wallet_balance IS DISTINCT FROM NEW.wallet_balance)
EXECUTE FUNCTION fn_audit_wallet_change();


-- ------------------------------------------------------------
-- 3. A2: MAKE THE AUDIT LOG IMMUTABLE
-- ------------------------------------------------------------
-- The A1 spec asks for "immutable logs", but nothing stopped
-- UPDATE/DELETE on wallet_audit_logs. Row-level guard below.
-- (TRUNCATE is not blocked so the seeder can reset the database.)
CREATE OR REPLACE FUNCTION fn_block_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'wallet_audit_logs is append-only (% blocked)', TG_OP
        USING ERRCODE = 'RS010';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_wallet_audit_immutable
BEFORE UPDATE OR DELETE ON wallet_audit_logs
FOR EACH ROW
EXECUTE FUNCTION fn_block_audit_mutation();
