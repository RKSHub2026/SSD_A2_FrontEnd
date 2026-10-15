# Tests

Three suites, chosen by risk: money moving between wallets, the rules that stop double bookings, and
data the screens could show wrong without anyone noticing.

| Command | What runs | Time |
|---|---|---|
| `npm run test:db` | `test/db/test_booking_workflow.sql`: the stored procedures, triggers, view and analytics function, straight in PostgreSQL | ~1 s |
| `npm test` | `test/api/*.test.js`: the real Express app against a fresh test database (Node's built-in test runner) | ~20 s |
| `npm run e2e` | `test/e2e/*.spec.js`: the screens in Chromium, clicked like a user would (Playwright) | ~1 min |
| `npm run test:all` | all three, in that order | |

First time only: `npm install` (installs Playwright), then `npm run e2e:install` (downloads Chromium).

## Your data is never touched

- `npm test` drops and rebuilds a database called **`ridesync_test`** for every test file. It runs every `sql/0*.sql` file
  (the same schema, triggers, procedures and view as the real system), then `test/support/fixtures.sql`.
- `npm run e2e` starts its own server on port 4100 with another fresh database, **`ridesync_e2e_test`**. The Map and Reviews
  tests read your seeded MongoDB (`ridesync_db`) without changing it, and they are skipped when MongoDB is not running.
- `npm run test:db` runs inside one transaction that is rolled back.
- Both test database names must contain "test", or the setup refuses to run (`PGTEST_DATABASE` overrides the name).
  The tests connect with the same `PG*` settings as the app (`.env`).

The fixtures are small and deterministic: 30 riders, 13 vehicles (one out of service), 242 trips. Each scenario has its own
named rider (for example "Test Bala" has ₹50 for the insufficient-balance case), so test files don't depend on each other.

## What is tested, and why

### Workflow 1: booking (`api/booking.test.js`, `e2e/booking.spec.js`)

This is the most important code: it moves money. Every failure test checks the error **and** that nothing changed in the
database: no trip, no deduction, no audit row. A friendly message that still charged the rider would be the worst possible bug.

- **Success:** returns 201, the balance before and after, and the `FARE_DEDUCTION` audit row linked to the new trip. The test
  re-reads the database to confirm.
- **RS006:** a second active trip for the same rider is refused, naming `idx_unique_active_rider_trip`.
- **RS007:** a vehicle that is already busy is refused (`idx_unique_active_vehicle_trip`).
- **RS004:** not enough money. The CHECK constraint rolls back everything and the balance is unchanged.
- **RS003, RS001, RS002:** an out-of-service vehicle, or an unknown rider or vehicle.
- **Bad input:** fares of 0, 12.345, 10001 or "abc", invalid ids, a missing field and malformed JSON all get a 400 naming the
  field, before the database is touched.
- **Status changes:** REQUESTED → IN TRANSIT → COMPLETED. Skipping, repeating or going back is refused (RS009). Completing
  frees the rider and the vehicle, and does not charge again.
- **Top-up:** writes a `TOP_UP` audit row, and a low-balance rider can then book.
- **In the browser:** the same story as a user sees it. The result shows the balance before and after and the audit row. The
  RS006 and RS004 messages name the index or constraint, "Top up wallet" fills in the shortfall, and the header balance
  updates.

### Audit trail (`api/audit.test.js`, `e2e/audit.spec.js`)

- The running balance chains: each row's balance before equals the next older row's balance after.
- The totals are correct, the type and date filters work (`to` is inclusive), and a reversed date range is a 400.
- **Immutability:** `DELETE /api/audit/:id` returns 403 RS010 and the row is still there. The test also tries `UPDATE` and
  `DELETE` directly in SQL, to show the trigger blocks them in the database and not only in the API.

### Analytics (`api/analytics.test.js`, `e2e/screens.spec.js`)

- **The moving average is recomputed in the test:** every point must equal the mean of the 7 days ending that day.
- **DENSE_RANK:** ranks start at 1 with no gaps, and equal averages share a rank. A single vehicle keeps its real rank across
  the fleet.
- **Materialized view:** a new booking makes it stale ("1 new trip not counted"), and the concurrent refresh brings it back to
  zero.

### MongoDB workflows (`api/mongo.test.js`, `e2e/screens.spec.js`)

- **Contract tests:** the `$geoNear` and `$facet` pipelines the API sends are compared, stage by stage, with the Assignment 1
  scripts `mongo/02` and `mongo/03` (run in a sandbox to capture them). If someone edits one without the other, the test fails.
- The `bookable` flag on the map comes from PostgreSQL, not from the possibly stale ping.
- MongoDB being down returns a 503 "Database unavailable", and health reports it.
- **In the browser:** the Leaflet map, the live label and the nearest list; the review summary and the catalog panel.

### Browsing and front-end quality (`api/browse.test.js`, `e2e/browse.spec.js`)

- Lists are paginated, never the whole table. Search, sort and filters work. `%` in a search is literal.
- 404s and 400s are JSON and name the field.
- Filters survive a reload. Detail views work. A search with no match shows an empty state.
- **Phone:** no sideways scrolling at phone width (Pixel 7 profile).

## Do the tests catch real bugs?

We broke the code on purpose and checked that the suite notices:

| Deliberate bug | Caught by |
|---|---|
| RS006 mapped to HTTP 400 instead of 409 | `booking.test.js` › RS006 |
| Booking response built without reading the audit row back | `booking.test.js` › creates the trip… returns the audit row |

## Not covered (on purpose)

- **How the chart and the map are drawn** (pixels) is left to Chart.js and Leaflet. The tests check the data given to them and
  that they appear.
- **Workflow 3 and 4 results on real data** are checked by the browser tests against your seeded MongoDB. The API tests use
  an in-memory MongoDB, so they run anywhere.
- **Load and concurrency:** there is no multi-client load test. Correctness under concurrency rests on the database: the row lock
  in `sp_book_ride` and the partial unique indexes. The tests check that the indexes block a second active trip, but not
  with two clients racing.
