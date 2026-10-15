# Handover note: RideSync (Project 2) A1 → A2

**Inherited:** https://github.com/dudekulamahammad/2026202016_a1 (PostgreSQL + MongoDB, no front end).
**Purpose of this note:** what we found when we picked the project up, what we changed, and what we would tell the original team.
The full per-file change list is in the README under *Changes to the inherited backend*.

## What worked

- **The PostgreSQL schema loaded cleanly** on PostgreSQL 16. Tables, foreign keys, the `CHECK (wallet_balance >= 0)` constraint and the trip-status enum were all sensible.
- **The core rules held.** The wallet audit trigger fired correctly and skipped no-op updates. The partial unique index `idx_unique_active_rider_trip` reliably blocked a second active trip. `sp_book_ride` was atomic, and its `FOR UPDATE` row lock is the right concurrency choice.
- **The seeders reached the required volumes.** They produced 100k trips, 100k audit rows (written by the real trigger rather than inserted directly, which was a good decision), 500k pings and 100k reviews.
- **The Workflow 4 `$facet` pipeline was correct.** The README's explanation of why Workflow 2 uses a sequential scan (the `COMPLETED` filter matches almost every row) was also accurate.

## What did not work

- **Postgres and Mongo described two different fleets.** Postgres had 100 vehicles with random UUIDs and `MH..` plates; Mongo had 150 vehicles named `V00001…` with `NYC-…` plates. No ping or review could be linked to a bookable vehicle. This was the biggest problem for a front end.
- **The Mongo scripts ran against the wrong database.** `use ridesync_db` was commented out, so `mongosh --file` used `test`, and Workflow 3 had no 2dsphere index on the real data. Scripts 02 and 03 also printed nothing.
- **Workflow 3 returned pings, not vehicles.** The same car could appear several times, and availability came from any ping, including stale ones. Every seeded ping expires within about 2 hours (TTL), so the map would be empty in any demo run later than that.
- **The materialized view was out of spec.** The refresh function was not `CONCURRENTLY`, the seeder never refreshed the view (so it stayed empty), and nothing recorded when it was last refreshed.
- **The seed data couldn't demonstrate the workflows.** All 100k audit rows carried the same seeding timestamp, so a date filter showed nothing. Every trip was `COMPLETED` and every vehicle active, so the failure cases could not be shown.
- **The procedure was hard to use from an API.** It returned no trip id, all failures used the same error code (`P0001` or a raw `23505`), there was no way to change a trip's status, and a fare of 0 created a trip with no audit row.
- **Documentation and code disagreed.** The README had no PostgreSQL setup steps and spelled the status `IN_TRANSIT`; the code uses `'IN TRANSIT'`. The ERD showed an enum and indexes that did not exist. `get_geo_summary.py` unwound tags before `$facet`, which inflated the rating counts.

## What we changed and why

All changes are edits to existing files; nothing was added or deleted.

1. **One fleet for both databases.** Deterministic `uuid5` ids are defined once in `postgres_seeder.py` and imported by the Mongo seeders. The front end can now join a map result or a review to a bookable vehicle.
2. **Workflow 1 made usable from a UI.**
   - The procedure returns the trip id.
   - The CHECK constraint now does the overdraft rejection, as the A1 spec intended.
   - Each failure has its own error code (RS001–RS010).
   - New procedures move a trip through its statuses and top up a wallet.
   - Audit rows now record `trip_id`, and their timestamps use `clock_timestamp()` so rows written in one transaction are ordered correctly.
   - An append-only guard was added, since the spec says "immutable".
3. **Integrity and performance.**
   - A partial unique index stops one vehicle being booked twice.
   - Indexes for the audit-trail and browse queries were added.
   - The unused status index was replaced with a covering partial index, so Workflow 2 is now an index-only scan.
4. **Workflow 2** became a parameterised function with a true 7-day calendar window.
5. **Materialized view:** `REFRESH CONCURRENTLY`, plus a refresh log for "last refreshed".
6. **MongoDB:**
   - Every script selects the correct database.
   - Workflow 3 returns the latest fresh ping per vehicle.
   - A compound 2dsphere index lets the freshness filter run inside the index.
   - `$jsonSchema` validators were added.
   - `mongo_seeder.py --live` streams pings, with availability taken from PostgreSQL's active trips.
   - Telemetry moved from Manhattan to Mumbai, so the map matches the `MH..` (Maharashtra) plates. Cars stay on land strips from Colaba to Andheri.
7. **Seed data that can demonstrate each workflow:** a 30-day audit history, 30 active trips, 5 inactive vehicles, an MV refresh after seeding, and ratings and tags that match each other.
8. **Documentation:** README rewritten with setup steps, the error codes and the change log; schema map updated; new EXPLAIN evidence appended to the original.

## Suggestions for the original authors

- **Run your scripts exactly as the README says, on a fresh machine.** The commented-out `use` and the empty materialized view would have shown up immediately.
- **When two databases share an entity, define its ids in one place**, and check that a join across them actually works.
- **Give each failure its own error code and return the ids you create.** That is what makes a procedure usable from code, not only from `psql`.
- **Make seed data demonstrate every rule,** including failures and active states, not only the volume targets. Watch out for TTL indexes deleting your demo data.
- **Keep the ERD, the README and the code in sync, and prefer one script per job.** We found duplicate helpers that had already drifted apart.
