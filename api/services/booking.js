import { one } from "../db/pg.js";
import { AppError } from "../lib/errors.js";
import { AUDIT_COLS } from "./columns.js";
import { findTrip } from "./trips.js";

/**
 * Workflow 1. The stored procedures do the work (validation, row locks,
 * atomic trip insert + wallet deduction, audit row via trigger); this file
 * only calls them and reads back what they wrote, inside the SAME
 * transaction so the response matches what was committed.
 *
 * Failures arrive as PostgreSQL errors with SQLSTATE RS001-RS009, which
 * lib/errors.js maps to HTTP statuses - nothing is caught here.
 */

/**
 * POST /api/trips
 * CALL sp_book_ride -> new trip id; then the trip and the FARE_DEDUCTION
 * audit row the trigger linked to it (wallet_audit_logs.trip_id).
 */
export function bookTrip(db, { riderId, vehicleId, fare }) {
  return db.tx(async (q) => {
    const { rows } = await q.query("CALL sp_book_ride($1::uuid, $2::uuid, $3::numeric, NULL)", [
      riderId,
      vehicleId,
      fare,
    ]);
    const tripId = rows[0].p_trip_id;
    const trip = await findTrip(q, tripId);
    const auditEntry = await one(
      q,
      `SELECT ${AUDIT_COLS} FROM wallet_audit_logs w WHERE w.trip_id = $1::uuid`,
      [tripId],
    );
    return {
      trip,
      auditEntry,
      wallet: {
        riderId,
        balanceBefore: auditEntry.balanceBefore,
        balanceAfter: auditEntry.balanceAfter,
      },
    };
  });
}

/**
 * PATCH /api/trips/:id/status
 * Locks the trip row first so previousStatus is exact, then lets
 * sp_update_trip_status enforce REQUESTED -> IN TRANSIT -> COMPLETED (RS009).
 */
export function updateTripStatus(db, tripId, status) {
  return db.tx(async (q) => {
    const current = await one(q, "SELECT status::text AS status FROM trips WHERE id = $1::uuid FOR UPDATE", [
      tripId,
    ]);
    // same code the procedure would raise, so the UI sees one "trip not found"
    if (!current) throw new AppError("RS008");
    await q.query("CALL sp_update_trip_status($1::uuid, $2::trip_status)", [tripId, status]);
    const trip = await findTrip(q, tripId);
    return {
      trip,
      previousStatus: current.status,
      // COMPLETED frees the rider and the vehicle (partial unique indexes)
      released: status === "COMPLETED",
    };
  });
}

/**
 * POST /api/riders/:id/top-up
 * CALL sp_top_up_wallet -> new balance; the trigger logs a TOP_UP row.
 * The rider row stays locked by the UPDATE until COMMIT, so the newest
 * TOP_UP row for this rider inside the transaction is the one just written.
 */
export function topUpWallet(db, riderId, amount) {
  return db.tx(async (q) => {
    const { rows } = await q.query("CALL sp_top_up_wallet($1::uuid, $2::numeric, NULL)", [
      riderId,
      amount,
    ]);
    const auditEntry = await one(
      q,
      `SELECT ${AUDIT_COLS} FROM wallet_audit_logs w
       WHERE w.rider_id = $1::uuid AND w.action_type = 'TOP_UP'
       ORDER BY w.timestamp DESC, w.id DESC
       LIMIT 1`,
      [riderId],
    );
    return {
      riderId,
      walletBalance: Number(rows[0].p_new_balance),
      auditEntry,
    };
  });
}
