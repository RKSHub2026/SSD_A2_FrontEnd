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
  center: { lon: 72.8426, lat: 19.0178 }, // Dadar station, Mumbai
  radiusMeters: 5000,
  freshMinutes: 10,
  limit: 10,
};

/**
 * Preset pickup points for the map, all in Mumbai where the simulated fleet
 * drives (data_generations/postgres_seeder.py LAND_ZONES). The first is the default.
 */
export const MAP_ORIGINS = [
  { id: "dadar", label: "Dadar station", lon: 72.8426, lat: 19.0178 },
  { id: "csmt", label: "CSMT (Chhatrapati Shivaji Maharaj Terminus)", lon: 72.8355, lat: 18.9398 },
  { id: "gateway", label: "Gateway of India", lon: 72.8347, lat: 18.922 },
  { id: "lower-parel", label: "Lower Parel", lon: 72.8258, lat: 18.9953 },
  { id: "bkc", label: "Bandra Kurla Complex", lon: 72.8656, lat: 19.0607 },
  { id: "juhu", label: "Juhu Beach", lon: 72.8268, lat: 19.0988 },
  { id: "airport", label: "Mumbai Airport, Terminal 2", lon: 72.8742, lat: 19.099 },
];

/** Booking limits (sp_book_ride requires fare > 0; DECIMAL(10,2)). */
export const FARE_LIMITS = { min: 1, max: 10_000 };
export const TOP_UP_LIMITS = { min: 1, max: 100_000 };

export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 100;
