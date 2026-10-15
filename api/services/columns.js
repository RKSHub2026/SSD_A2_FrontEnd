/**
 * SELECT lists that map snake_case columns to the camelCase DTOs in
 * @ridesync/shared/types. Keeping them in one place keeps every endpoint's
 * JSON identical.
 */

export const RIDER_COLS = `
  r.id,
  r.name,
  r.wallet_balance AS "walletBalance"`;

/** requires FROM trips t JOIN riders r ON r.id = t.rider_id JOIN vehicles v ON v.id = t.vehicle_id */
export const TRIP_COLS = `
  t.id,
  t.rider_id      AS "riderId",
  r.name          AS "riderName",
  t.vehicle_id    AS "vehicleId",
  v.license_plate AS "licensePlate",
  t.fare_amount   AS "fareAmount",
  t.status::text  AS status,
  t.created_at    AS "createdAt"`;

export const TRIP_FROM = `
  FROM trips t
  JOIN riders r   ON r.id = t.rider_id
  JOIN vehicles v ON v.id = t.vehicle_id`;

/** requires FROM wallet_audit_logs w */
export const AUDIT_COLS = `
  w.id,
  w.rider_id                         AS "riderId",
  w.amount_changed                   AS "amountChanged",
  w.action_type                      AS "actionType",
  w.balance_after                    AS "balanceAfter",
  (w.balance_after - w.amount_changed) AS "balanceBefore",
  w.timestamp,
  w.trip_id                          AS "tripId"`;

/** requires FROM vehicles v LEFT JOIN mv_vehicle_stats s ON s.vehicle_id = v.id */
export const VEHICLE_COLS = `
  v.id,
  v.license_plate AS "licensePlate",
  v.class,
  v.is_active     AS "isActive",
  EXISTS (
    SELECT 1 FROM trips a
    WHERE a.vehicle_id = v.id AND a.status IN ('REQUESTED', 'IN TRANSIT')
  )               AS "hasActiveTrip",
  COALESCE(s.total_trips, 0)    AS "totalTrips",
  COALESCE(s.total_earnings, 0) AS "totalEarnings"`;

export const MV_STAT_COLS = `
  s.vehicle_id      AS "vehicleId",
  s.license_plate   AS "licensePlate",
  s.vehicle_class   AS "vehicleClass",
  s.is_active       AS "isActive",
  s.total_trips     AS "totalTrips",
  s.completed_trips AS "completedTrips",
  s.total_earnings  AS "totalEarnings",
  s.last_trip_at    AS "lastTripAt"`;
