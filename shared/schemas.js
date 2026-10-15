/**
 * Request schemas (Zod v4) - SERVER ONLY (imports "zod").
 * Every API route validates its params / query / body with one of these.
 * Query-string values arrive as strings, so numbers use z.coerce and
 * booleans use z.stringbool().
 */
import { z } from "zod";
import {
  AUDIT_ACTIONS,
  FARE_LIMITS,
  MAP_DEFAULTS,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  TOP_UP_LIMITS,
  TRIP_STATUSES,
  VEHICLE_CLASSES,
} from "./constants.js";

// ---------------------------------------------------------------- primitives

/**
 * Any 8-4-4-4-12 hex id, like PostgreSQL's uuid type. z.uuid() is stricter
 * (RFC version/variant bits) and would reject ids PostgreSQL accepts, such as
 * the fixtures in test/db/test_booking_workflow.sql.
 */
export const Uuid = z.guid({ message: "Must be a valid UUID" });
export const IsoDate = z.iso.date({ message: "Use the YYYY-MM-DD format" });
export const TripStatusSchema = z.enum(TRIP_STATUSES);
export const AuditActionSchema = z.enum(AUDIT_ACTIONS);
export const VehicleClassSchema = z.enum(VEHICLE_CLASSES);

/** Money: within [min, max], at most 2 decimals. Accepts numbers or numeric strings. */
const money = (min, max, label) =>
  z.coerce
    .number({ message: `${label} must be a number` })
    .min(min, `${label} must be at least ${min}`)
    .max(max, `${label} must be at most ${max.toLocaleString("en-US")}`)
    .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, {
      message: `${label} can have at most 2 decimal places`,
    });

export const Pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
});

const SortOrder = z.enum(["asc", "desc"]);

/** Free-text search, trimmed; empty string becomes undefined. */
const SearchText = z
  .string()
  .trim()
  .max(50)
  .optional()
  .transform((v) => (v ? v : undefined));

/**
 * Checks an optional from/to pair: to >= from and, if maxDays is given, at
 * most maxDays days inclusive. The error is reported on the "to" field.
 * ISO dates compare correctly as strings.
 */
const checkRange =
  (maxDays) =>
  ({ value, issues }) => {
    const { from, to } = value;
    if (!from || !to) return;
    if (to < from) {
      issues.push({
        code: "custom",
        input: to,
        path: ["to"],
        message: "End date must be on or after the start date",
      });
      return;
    }
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
    if (maxDays && days > maxDays) {
      issues.push({
        code: "custom",
        input: to,
        path: ["to"],
        message: `Pick a range of at most ${maxDays} days`,
      });
    }
  };

export const IdParams = z.object({ id: Uuid });

// ---------------------------------------------------------------- browse

export const RiderListQuery = Pagination.extend({
  q: SearchText,
  sort: z.enum(["name", "wallet_balance"]).default("name"),
  order: SortOrder.default("asc"),
});

export const VehicleListQuery = Pagination.extend({
  q: SearchText,
  class: VehicleClassSchema.optional(),
  active: z.stringbool().optional(),
  /** bookable right now: active AND no REQUESTED / IN TRANSIT trip */
  available: z.stringbool().optional(),
  sort: z.enum(["license_plate", "class", "total_trips", "total_earnings"]).default("license_plate"),
  order: SortOrder.default("asc"),
});

export const TripListQuery = Pagination.extend({
  status: TripStatusSchema.optional(),
  /** true = REQUESTED or IN TRANSIT (served by the partial unique indexes); false = COMPLETED */
  active: z.stringbool().optional(),
  riderId: Uuid.optional(),
  vehicleId: Uuid.optional(),
  from: IsoDate.optional(),
  /** inclusive */
  to: IsoDate.optional(),
  order: SortOrder.default("desc"),
}).check(checkRange());

// ---------------------------------------------------------------- workflow 1

export const BookTripBody = z.object({
  riderId: Uuid,
  vehicleId: Uuid,
  fare: money(FARE_LIMITS.min, FARE_LIMITS.max, "Fare"),
});

export const UpdateTripStatusBody = z.object({
  status: z.enum(["IN TRANSIT", "COMPLETED"], {
    message: 'Status must be "IN TRANSIT" or "COMPLETED"',
  }),
});

export const TopUpBody = z.object({
  amount: money(TOP_UP_LIMITS.min, TOP_UP_LIMITS.max, "Amount"),
});

// ---------------------------------------------------------------- audit

export const AuditQuery = Pagination.extend({
  from: IsoDate.optional(),
  /** inclusive */
  to: IsoDate.optional(),
  action: AuditActionSchema.optional(),
  order: SortOrder.default("desc"),
}).check(checkRange());

// ---------------------------------------------------------------- analytics (workflow 2 + MV)

export const MovingAvgQuery = z
  .object({
    from: IsoDate.optional(),
    to: IsoDate.optional(),
    vehicleId: Uuid.optional(),
    /** keep only the vehicles ranked <= topN on the LAST day of the range (chart readability) */
    topN: z.coerce.number().int().min(1).max(100).default(5),
  })
  .check(checkRange(92));

export const RankingQuery = z.object({
  date: IsoDate.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export const VehicleStatsQuery = Pagination.extend({
  sort: z
    .enum(["total_earnings", "total_trips", "completed_trips", "license_plate"])
    .default("total_earnings"),
  order: SortOrder.default("desc"),
});

// ---------------------------------------------------------------- map (workflow 3)

export const NearestQuery = z.object({
  lon: z.coerce.number().min(-180).max(180).default(MAP_DEFAULTS.center.lon),
  lat: z.coerce.number().min(-90).max(90).default(MAP_DEFAULTS.center.lat),
  radiusMeters: z.coerce.number().int().min(100).max(20_000).default(MAP_DEFAULTS.radiusMeters),
  freshMinutes: z.coerce.number().int().min(1).max(120).default(MAP_DEFAULTS.freshMinutes),
  limit: z.coerce.number().int().min(1).max(50).default(MAP_DEFAULTS.limit),
});

export const FleetQuery = z.object({
  freshMinutes: z.coerce.number().int().min(1).max(120).default(MAP_DEFAULTS.freshMinutes),
});

// ---------------------------------------------------------------- reviews (workflow 4)

export const ReviewSummaryQuery = z
  .object({
    vehicleId: Uuid.optional(),
    from: IsoDate.optional(),
    to: IsoDate.optional(),
    topTags: z.coerce.number().int().min(1).max(20).default(10),
  })
  .check(checkRange());

export const ReviewListQuery = Pagination.extend({
  vehicleId: Uuid.optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
});
