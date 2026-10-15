/**
 * Domain constants mirrored from the database (sql/01_schema_ddl.sql).
 * Browser-safe: no imports. Used by the API (api/) and the UI (web/).
 */

/** trips.status enum - note the SPACE in "IN TRANSIT". */
export const TRIP_STATUSES = ["REQUESTED", "IN TRANSIT", "COMPLETED"];

/** Statuses covered by the partial unique indexes (one per rider / per vehicle). */
export const ACTIVE_TRIP_STATUSES = ["REQUESTED", "IN TRANSIT"];

/** Forward-only transitions enforced by sp_update_trip_status. */
export const NEXT_TRIP_STATUS = {
  REQUESTED: "IN TRANSIT",
  "IN TRANSIT": "COMPLETED",
  COMPLETED: null,
};

/** wallet_audit_logs.action_type values written by trg_wallet_audit. */
export const AUDIT_ACTIONS = ["TOP_UP", "FARE_DEDUCTION"];

/** vehicles.class values produced by the seeder (data_generations/postgres_seeder.py). */
export const VEHICLE_CLASSES = ["Sedan", "SUV", "Hatchback"];

/** Workflow 3 defaults (mongo/02_workflow3_geonear.js). GeoJSON order is [lon, lat]. */
export const MAP_DEFAULTS = {
  center: { lon: -73.9857, lat: 40.7484 }, // Empire State Building
  radiusMeters: 5000,
  freshMinutes: 10,
  limit: 10,
};

/** Preset origins for the map's origin picker (all inside the simulated area). */
export const MAP_ORIGINS = [
  { id: "esb", label: "Empire State Building", lon: -73.9857, lat: 40.7484 },
  { id: "times-sq", label: "Times Square", lon: -73.9855, lat: 40.758 },
  { id: "union-sq", label: "Union Square", lon: -73.9903, lat: 40.7359 },
  { id: "grand-central", label: "Grand Central", lon: -73.9772, lat: 40.7527 },
  { id: "wtc", label: "World Trade Center", lon: -74.0134, lat: 40.7127 },
  { id: "central-park-s", label: "Central Park South", lon: -73.9762, lat: 40.7651 },
];

/** Booking limits (sp_book_ride requires fare > 0; DECIMAL(10,2)). */
export const FARE_LIMITS = { min: 1, max: 10_000 };
export const TOP_UP_LIMITS = { min: 1, max: 100_000 };

export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 100;
