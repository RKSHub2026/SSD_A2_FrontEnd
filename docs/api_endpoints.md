# RideSync API reference

Express API in `api/` (routes → services → databases). Base URL: `http://localhost:4000/api`.
Every write goes through a stored procedure, and every analytic is computed by the database (window function,
materialized view, `$geoNear`, `$facet`). The API validates input, calls those objects, and shapes the JSON.

## Endpoints at a glance

| Method | Path | Screen | Database object |
|---|---|---|---|
| GET | [`/health`](#get-health) | header badge | `SELECT 1`, Mongo `ping`, `hello` |
| GET | [`/riders`](#get-riders) | Browse, actor switcher | `riders` (`idx_riders_name_lower`) |
| GET | [`/riders/:id`](#get-ridersid) | Browse | `riders`, `trips`, `wallet_audit_logs` |
| GET | [`/vehicles`](#get-vehicles) | Browse, Book a ride | `vehicles` + `mv_vehicle_stats` |
| GET | [`/vehicles/:id`](#get-vehiclesid) | Browse | `vehicles`, `mv_vehicle_stats`, `mv_vehicle_stats_last_refreshed()` |
| GET | [`/trips`](#get-trips) | Browse | `trips` (`idx_trips_*`, partial unique indexes) |
| GET | [`/trips/:id`](#get-tripsid) | Browse, Book a ride | `trips`, `wallet_audit_logs.trip_id` |
| POST | [`/trips`](#post-trips) | Book a ride (Workflow 1) | `sp_book_ride` |
| PATCH | [`/trips/:id/status`](#patch-tripsidstatus) | Book a ride | `sp_update_trip_status` |
| POST | [`/riders/:id/top-up`](#post-ridersidtop-up) | Book a ride | `sp_top_up_wallet` |
| GET | [`/riders/:id/audit`](#get-ridersidaudit) | Audit trail | `wallet_audit_logs` (`idx_wallet_audit_rider_ts`) |
| DELETE | [`/audit/:id`](#delete-auditid) | Audit trail | `trg_wallet_audit_immutable` (always 403) |
| GET | [`/analytics/overview`](#get-analyticsoverview) | Analytics | counts, `mv_vehicle_stats_last_refreshed()` |
| GET | [`/analytics/moving-average`](#get-analyticsmoving-average) | Analytics (Workflow 2) | `fn_vehicle_revenue_moving_avg` |
| GET | [`/analytics/ranking`](#get-analyticsranking) | Analytics (Workflow 2) | `fn_vehicle_revenue_moving_avg` |
| GET | [`/analytics/vehicle-stats`](#get-analyticsvehicle-stats) | Analytics | `mv_vehicle_stats`, `mv_refresh_log` |
| POST | [`/analytics/vehicle-stats/refresh`](#post-analyticsvehicle-statsrefresh) | Analytics | `refresh_mv_vehicle_stats()` (CONCURRENTLY) |
| GET | [`/map/nearest`](#get-mapnearest) | Map (Workflow 3) | `TelemetryPings` `$geoNear`, `VehicleMetadata`, PostgreSQL `trips` |
| GET | [`/map/fleet`](#get-mapfleet) | Map | `TelemetryPings`, `VehicleMetadata` |
| GET | [`/map/stream`](#get-mapstream) | Map (live) | change stream or polling |
| GET | [`/reviews/summary`](#get-reviewssummary) | Reviews (Workflow 4) | `TripReviews` `$facet` |
| GET | [`/reviews`](#get-reviews) | Reviews | `TripReviews`, `VehicleMetadata`, PostgreSQL `riders` |
| GET | [`/vehicles/:id/catalog`](#get-vehiclesidcatalog) | Reviews / vehicle detail | `VehicleMetadata` |

## Conventions

- **JSON** in and out. Request bodies need `Content-Type: application/json` (limit 100 kB).
- **Field names** are camelCase. Ids are UUID strings. `vehicleId` is the same value in PostgreSQL and MongoDB.
- **Money** is a JSON number in rupees with at most 2 decimals (`DECIMAL(10,2)` in the database).
- **Timestamps** are ISO 8601 strings. **Dates** in query strings are `YYYY-MM-DD`, and `to` is **inclusive**.
  PostgreSQL turns a date into a day using the database session time zone. The MongoDB review filters use UTC days.
- **Trip status** is `REQUESTED`, `IN TRANSIT` (with a space, URL-encoded as `IN%20TRANSIT`), or `COMPLETED`.
- **Lists** return `{ items, page, pageSize, total, totalPages }`. `page` starts at 1, `pageSize` defaults to 20 (max 100).
- **Unknown query parameters** are ignored. Invalid ones return a 400 that names the field.
- **Examples** below are trimmed (`"…"`). Counts and amounts are illustrative; your seeded data gives different values.

### Errors

Every error has the same shape. The UI shows `title` and `message`, and the other fields are there for detail.

```json
{
  "error": {
    "code": "RS006",
    "title": "Rider already has an active trip",
    "message": "A rider can only have one trip that is REQUESTED or IN TRANSIT. Complete the current trip first, then book again.",
    "detail": "Blocked by partial unique index idx_unique_active_rider_trip",
    "hint": "Complete the current trip first",
    "constraint": "idx_unique_active_rider_trip",
    "dbMessage": "Rider already has an active trip (REQUESTED or IN TRANSIT)"
  }
}
```

| Code | HTTP | When |
|---|---|---|
| `VALIDATION` | 400 | Bad params, query or body. Includes `fieldErrors: { field: [messages] }`. Malformed JSON also returns this. |
| `NOT_FOUND` | 404 | No such record or API route |
| `CONFLICT` | 409 | Another constraint violation (`23505`, `23503`, `23514`) outside the procedures |
| `DB_UNAVAILABLE` | 503 | PostgreSQL or MongoDB cannot be reached |
| `INTERNAL` | 500 | Anything unexpected (logged on the server) |
| `RS001` | 404 | Rider not found (procedures) |
| `RS002` | 404 | Vehicle not found |
| `RS003` | 409 | Vehicle is inactive |
| `RS004` | 409 | Insufficient balance: the `CHECK (wallet_balance >= 0)` fired and the whole booking rolled back |
| `RS005` | 400 | Amount must be > 0 (the API's own validation normally catches this first) |
| `RS006` | 409 | Rider already has an active trip (`idx_unique_active_rider_trip`) |
| `RS007` | 409 | Vehicle already on an active trip (`idx_unique_active_vehicle_trip`) |
| `RS008` | 404 | Trip not found |
| `RS009` | 409 | Status change not allowed (forward only) |
| `RS010` | 403 | `wallet_audit_logs` is append-only |

The catalogue lives in `shared/errors.js` and is shared with the browser.

---

## Health

### GET /health

```json
{ "status": "ok", "postgres": true, "mongo": true, "changeStreams": false, "time": "2026-10-15T05:18:57.000Z" }
```

Returns 503 with `"status": "degraded"` if either database is down. `changeStreams` is `true` only on a replica set.

---

## Browse

### GET /riders

| Param | Default | Notes |
|---|---|---|
| `q` | | Part of a name (case-insensitive; `%` and `_` match literally) or an exact rider id |
| `sort` | `name` | `name` or `wallet_balance` |
| `order` | `asc` | `asc` or `desc` |
| `page`, `pageSize` | 1, 20 | |

Item: `{ id, name, walletBalance }`.

### GET /riders/:id

The rider plus `activeTrip` (or `null`), `tripCount`, `completedTrips`, `totalSpent` and `lastAudit` (the newest audit row, or `null`).
Returns 404 `NOT_FOUND` if the rider doesn't exist.

### GET /vehicles

| Param | Notes |
|---|---|
| `q` | Part of a plate, or an exact vehicle id |
| `class` | `Sedan`, `SUV` or `Hatchback` |
| `active` | `true` or `false` (`vehicles.is_active`) |
| `available` | `true` = active and no `REQUESTED`/`IN TRANSIT` trip (bookable now); `false` = the rest |
| `sort` | `license_plate` (default), `class`, `total_trips`, `total_earnings` |
| `order`, `page`, `pageSize` | |

Item: `{ id, licensePlate, class, isActive, hasActiveTrip, totalTrips, totalEarnings }`. The totals come from the materialized view,
so they can lag until the next refresh.

### GET /vehicles/:id

The vehicle plus `completedTrips`, `lastTripAt`, `statsRefreshedAt` and `activeTrip`.

### GET /trips

| Param | Notes |
|---|---|
| `status` | One trip status |
| `active` | `true` = `REQUESTED` or `IN TRANSIT`; `false` = `COMPLETED` |
| `riderId`, `vehicleId` | |
| `from`, `to` | Date range on `created_at` (`to` inclusive and must not be before `from`) |
| `order` | `desc` (newest first, default) or `asc` |

Item: `{ id, riderId, riderName, vehicleId, licensePlate, fareAmount, status, createdAt }`.

### GET /trips/:id

The trip plus `vehicleClass` and `auditEntries` (the wallet rows linked by `trip_id`: one `FARE_DEDUCTION` for trips booked through the API, none for seeded history).

---

## Workflow 1: book a ride

### POST /trips

Calls `sp_book_ride`, which locks the rider row, inserts the trip and deducts the fare in one transaction. The trigger writes the audit row and links it
to the trip. The API reads the trip and audit row back in the **same** transaction.

Request:

```json
{ "riderId": "…", "vehicleId": "…", "fare": 250 }
```

`fare` must be between 1 and 10,000 with at most 2 decimals. A numeric string such as `"250.50"` is also accepted.

**201 Created**, with `Location: /api/trips/<id>`:

```json
{
  "trip": {
    "id": "2d166ba3-…", "riderId": "…", "riderName": "Rohan Das", "vehicleId": "…",
    "licensePlate": "MH04AB1004", "fareAmount": 250, "status": "REQUESTED", "createdAt": "2026-10-15T05:18:57.138614+00:00"
  },
  "auditEntry": {
    "id": "6e5e1160-…", "riderId": "…", "amountChanged": -250, "actionType": "FARE_DEDUCTION",
    "balanceAfter": 8298, "balanceBefore": 8548, "timestamp": "2026-10-15T05:18:57.143398+00:00", "tripId": "2d166ba3-…"
  },
  "wallet": { "riderId": "…", "balanceBefore": 8548, "balanceAfter": 8298 }
}
```

Errors: `VALIDATION`, `RS001`, `RS002`, `RS003`, `RS004`, `RS006`, `RS007`. On any error, nothing is written: no trip, no deduction, no audit row.

### PATCH /trips/:id/status

```json
{ "status": "IN TRANSIT" }
```

`status` must be `IN TRANSIT` or `COMPLETED`. The API locks the trip row, then `sp_update_trip_status` allows only
`REQUESTED → IN TRANSIT → COMPLETED`.

```json
{ "trip": { "…": "…", "status": "IN TRANSIT" }, "previousStatus": "REQUESTED", "released": false }
```

`released: true` means the trip is now `COMPLETED`, so the rider and the vehicle can be booked again. No money moves at this
point: the fare was taken at booking.
Errors: `VALIDATION`, `RS008`, `RS009`.

### POST /riders/:id/top-up

```json
{ "amount": 500 }
```

`amount` must be between 1 and 100,000 with at most 2 decimals. Calls `sp_top_up_wallet`, and the trigger logs a `TOP_UP`.

```json
{
  "riderId": "…",
  "walletBalance": 550,
  "auditEntry": { "id": "…", "amountChanged": 500, "actionType": "TOP_UP", "balanceAfter": 550, "balanceBefore": 50, "tripId": null, "…": "…" }
}
```

Errors: `VALIDATION`, `RS001`.

---

## Audit trail

### GET /riders/:id/audit

| Param | Default | Notes |
|---|---|---|
| `from`, `to` | | Date range on `timestamp` (`to` inclusive) |
| `action` | | `TOP_UP` or `FARE_DEDUCTION` |
| `order` | `desc` | Newest first by default |
| `page`, `pageSize` | 1, 20 | |

```json
{
  "rider": { "id": "…", "name": "Sana Iyer", "walletBalance": 550 },
  "items": [
    { "id": "…", "riderId": "…", "amountChanged": 500, "actionType": "TOP_UP",
      "balanceAfter": 550, "balanceBefore": 50, "timestamp": "…", "tripId": null }
  ],
  "page": 1, "pageSize": 20, "total": 1, "totalPages": 1,
  "summary": { "topUpCount": 1, "topUpTotal": 500, "deductionCount": 0, "deductionTotal": 0, "netChange": 500 }
}
```

`balanceAfter` is the running balance after each change. `balanceBefore` is `balance_after − amount_changed`.
`summary` covers every row that matches the filters, not just the current page.
Errors: `VALIDATION` (including `to` before `from`), `NOT_FOUND` (rider).

### DELETE /audit/:id

Demonstrates that the log is immutable. The API tries the `DELETE`, the trigger `trg_wallet_audit_immutable` rejects it, and the
transaction is always rolled back.

- Existing entry: **403** `RS010` "Audit log is read-only"
- Unknown id: **404** `NOT_FOUND`
- If the guard were ever missing, the row is still restored and the API returns **500**. It never reports a delete as successful.

---

## Analytics: Workflow 2 and the materialized view

### GET /analytics/overview

```json
{
  "riders": 1000, "vehicles": 100, "inactiveVehicles": 5, "availableVehicles": 65,
  "requestedTrips": 20, "inTransitTrips": 10, "tripsToday": 3312, "revenueToday": 1490423.5,
  "walletChangesToday": 3290, "statsRefreshedAt": "…"
}
```

### GET /analytics/moving-average

7-day moving average of daily revenue (completed trips) per vehicle, from `fn_vehicle_revenue_moving_avg`. The function builds a dense calendar
(idle days count as 0, so the window is exactly 7 calendar days) and ranks every vehicle per day with `DENSE_RANK`.

| Param | Default | Notes |
|---|---|---|
| `from`, `to` | last 30 days | At most 92 days |
| `vehicleId` | | One vehicle (its real rank across the fleet is kept) |
| `topN` | 5 | Without `vehicleId`: only the vehicles ranked ≤ `topN` on the **last** day (ties can add a few) |

```json
{
  "from": "2026-09-16", "to": "2026-10-15", "vehicleId": null, "topN": 2,
  "series": [
    {
      "vehicleId": "…", "licensePlate": "MH09AB1009", "rankOnLastDay": 1,
      "points": [
        { "date": "2026-10-14", "trips": 0, "revenue": 0, "movingAvg7d": 1085.61, "rank": 1 },
        { "date": "2026-10-15", "trips": 1, "revenue": 585.24, "movingAvg7d": 1071.74, "rank": 1 }
      ]
    }
  ]
}
```

Points go oldest first, one per day in the range. The series are ordered by `rankOnLastDay`.

### GET /analytics/ranking

| Param | Default |
|---|---|
| `date` | today |
| `limit` | 10 (ranks ≤ limit, so ties can return more rows) |

```json
{
  "date": "2026-10-15", "limit": 2,
  "items": [
    { "rank": 1, "vehicleId": "…", "licensePlate": "MH09AB1009", "tripsThatDay": 1, "dailyRevenue": 585.24, "movingAvg7d": 1071.74 }
  ]
}
```

### GET /analytics/vehicle-stats

Rows of `mv_vehicle_stats`.

| Param | Default |
|---|---|
| `sort` | `total_earnings` (`total_trips`, `completed_trips`, `license_plate`) |
| `order` | `desc` |
| `page`, `pageSize` | 1, 20 |

```json
{
  "items": [
    { "vehicleId": "…", "licensePlate": "MH03AB1003", "vehicleClass": "Sedan", "isActive": true,
      "totalTrips": 41, "completedTrips": 40, "totalEarnings": 20233.01, "lastTripAt": "…", "earningsRank": 1 }
  ],
  "page": 1, "pageSize": 20, "total": 100, "totalPages": 5,
  "summary": { "vehicles": 100, "activeVehicles": 95, "totalTrips": 100030, "completedTrips": 100000,
               "totalEarnings": 45012345.67, "lastTripAt": "…" },
  "freshness": { "refreshedAt": "…", "liveTrips": 100031, "tripsInView": 100030, "tripsNotInView": 1 }
}
```

`summary` holds fleet-wide totals summed over the whole view (all pages), so they lag the live tables in the same way as the rows.

`totalTrips` counts trips of every status. `totalEarnings` counts completed trips only. `earningsRank` is the rank across the whole view.
`freshness.tripsNotInView` is how many trips were created since the last refresh, so the UI can show "1 new trip not counted yet".
Status changes since the refresh are not counted in it either.

### POST /analytics/vehicle-stats/refresh

Runs `refresh_mv_vehicle_stats()`, which does `REFRESH MATERIALIZED VIEW CONCURRENTLY` (readers are not blocked) and logs the refresh in `mv_refresh_log`.

```json
{ "refreshedAt": "2026-10-15T05:18:58.079862+00:00", "durationMs": 4.973, "concurrent": true,
  "freshness": { "refreshedAt": "…", "liveTrips": 100031, "tripsInView": 100031, "tripsNotInView": 0 } }
```

---

## Map: Workflow 3

Needs `python3 data_generations/mongo_seeder.py --live` running. Without it, the pings fall outside the 10-minute window and the map is empty.

### GET /map/nearest

The same pipeline as `mongo/02_workflow3_geonear.js`:

1. `$geoNear` on fresh pings inside the radius, using the `{ location: "2dsphere", createdAt: -1 }` index
2. Latest ping per vehicle (`$top`)
3. Available vehicles only
4. Nearest first
5. Plate, class, make and model from `VehicleMetadata`

| Param | Default | Range |
|---|---|---|
| `lon`, `lat` | 72.8426, 19.0178 (Dadar station, Mumbai) | |
| `radiusMeters` | 5000 | 100–20000 |
| `freshMinutes` | 10 | 1–120 |
| `limit` | 10 | 1–50 |

```json
{
  "origin": { "lon": 72.8426, "lat": 19.0178 }, "radiusMeters": 5000, "freshMinutes": 10, "queryMs": 12,
  "items": [
    { "vehicleId": "…", "licensePlate": "MH07AB1007", "class": "SUV", "make": "…", "model": "…",
      "distanceKm": 0.412, "location": { "lon": 72.8451, "lat": 19.0203 }, "lastSeen": "…", "bookable": true }
  ]
}
```

`bookable` is checked against PostgreSQL, the source of truth for bookings: the vehicle is active and has no `REQUESTED`/`IN TRANSIT` trip.
A ping's `isAvailable` can lag one simulator tick (3 s) behind a booking. Book only when `bookable` is true. Otherwise the booking fails with RS007.

### GET /map/fleet

The latest fresh ping for every vehicle, available and busy, for the map markers.

```json
{
  "freshMinutes": 10, "generatedAt": "…",
  "counts": { "total": 95, "available": 65, "busy": 30 },
  "items": [ { "vehicleId": "…", "licensePlate": "…", "class": "…", "make": "…", "model": "…",
               "isAvailable": true, "location": { "lon": 72.84, "lat": 19.02 }, "lastSeen": "…" } ]
}
```

### GET /map/stream

Server-Sent Events (`text/event-stream`). Query: `freshMinutes`.

| Event | Data |
|---|---|
| `hello` | `{ "mode": "change-stream" \| "polling", "intervalMs": 3000 \| null, "reason"?: "…" }` |
| `fleet` | The same body as `GET /map/fleet` |
| `error` | `{ "code": "DB_UNAVAILABLE", "message": "…" }`. The stream stays open and tries again on the next tick. |

- **Replica set:** a change stream on `TelemetryPings` inserts triggers a new snapshot, at most one per second. One simulator tick
  inserts about 95 pings at once, so a tick produces one snapshot.
- **Standalone MongoDB** (the default install): no change streams, so the server polls every `LIVE_POLL_MS` (3000 ms).
  If a change stream fails mid-way, the server sends a new `hello` with `mode: "polling"` and switches to polling.
- A `: ping` comment every 15 s keeps proxies from closing the connection. `retry: 5000` tells the browser how long to wait before reconnecting.
- **Browser fallback:** if `EventSource` is not available or keeps failing, the UI polls `GET /map/fleet` itself.

```bash
curl -N localhost:4000/api/map/stream      # Ctrl+C to stop
```

---

## Reviews: Workflow 4

### GET /reviews/summary

`ratingDistribution` always has 5 buckets, ordered 5 → 1, with 0 for a missing rating. The same pipeline as `mongo/03_workflow4_facet.js`. The optional filters go in a `$match` before `$facet`, because stages inside `$facet` can't use indexes.

| Param | Default | Notes |
|---|---|---|
| `vehicleId` | | |
| `from`, `to` | | UTC days, `to` inclusive |
| `topTags` | 10 | 1–20 |

```json
{
  "filters": { "vehicleId": null, "from": null, "to": null }, "queryMs": 85,
  "totalReviews": 100000, "averageRating": 3.84,
  "ratingDistribution": [
    { "rating": 5, "count": 38000 }, { "rating": 4, "count": 30000 }, { "rating": 3, "count": 15000 },
    { "rating": 2, "count": 9000 }, { "rating": 1, "count": 8000 }
  ],
  "commonFeedback": [ { "tag": "Clean car", "count": 21000 } ]
}
```

### GET /reviews

Newest first. Query: `vehicleId`, `rating` (1–5), `page`, `pageSize`.

```json
{
  "items": [
    { "id": "…", "vehicleId": "…", "licensePlate": "MH01AB1001", "vehicleClass": "SUV",
      "riderId": "…", "riderName": "Rider_0001", "rating": 5, "tags": ["Clean car"],
      "driverFeedback": "…", "createdAt": "…" }
  ],
  "page": 1, "pageSize": 20, "total": 100000, "totalPages": 5000
}
```

Plates come from `VehicleMetadata` and rider names from PostgreSQL, each looked up once for the ids on the current page.
The unfiltered total uses `estimatedDocumentCount()`.

### GET /vehicles/:id/catalog

The `VehicleMetadata` document as stored (without `_id`). Its shape differs from vehicle to vehicle: `specs` depends on class and fuel type
(`batteryKWh`, `rangeKm` for electric cars, `cngTankKg` for CNG, `driveTrain` for SUVs, …), and `inspectionHistory` is a nested array.
This is the "flexible document" part of the design. Returns 404 `NOT_FOUND` if the vehicle has no catalog entry.

---

## Try it

```bash
# pick a rider and a free vehicle
curl -s "localhost:4000/api/riders?pageSize=1"
curl -s "localhost:4000/api/vehicles?available=true&pageSize=2"

# book, then the same rider again (409 RS006)
curl -s -X POST localhost:4000/api/trips -H 'Content-Type: application/json' \
     -d '{"riderId":"<rider>","vehicleId":"<vehicle 1>","fare":250}'
curl -s -X POST localhost:4000/api/trips -H 'Content-Type: application/json' \
     -d '{"riderId":"<rider>","vehicleId":"<vehicle 2>","fare":100}'

# move the trip forward, then try to go back (409 RS009)
curl -s -X PATCH localhost:4000/api/trips/<trip>/status -H 'Content-Type: application/json' -d '{"status":"IN TRANSIT"}'
curl -s -X PATCH localhost:4000/api/trips/<trip>/status -H 'Content-Type: application/json' -d '{"status":"COMPLETED"}'
curl -s -X PATCH localhost:4000/api/trips/<trip>/status -H 'Content-Type: application/json' -d '{"status":"IN TRANSIT"}'

# top up, see the audit trail, try to delete an entry (403 RS010)
curl -s -X POST localhost:4000/api/riders/<rider>/top-up -H 'Content-Type: application/json' -d '{"amount":500}'
curl -s "localhost:4000/api/riders/<rider>/audit?pageSize=5"
curl -s -X DELETE localhost:4000/api/audit/<audit id>

# analytics and the view
curl -s "localhost:4000/api/analytics/moving-average?topN=3"
curl -s "localhost:4000/api/analytics/vehicle-stats?pageSize=5"
curl -s -X POST localhost:4000/api/analytics/vehicle-stats/refresh

# MongoDB (needs mongo_seeder.py --live running for the map)
curl -s "localhost:4000/api/map/nearest?limit=5"
curl -s "localhost:4000/api/map/fleet"
curl -s "localhost:4000/api/reviews/summary"
curl -s "localhost:4000/api/vehicles/<vehicle>/catalog"
```
