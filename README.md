**GitHub Repository:** GitHub - https://github.com/dudekulamahammad/2026202016_a1

# RideSync A1 - Database Implementation

## 1. PostgreSQL Schema

**File:** `01_schema_ddl.sql`

This script creates the PostgreSQL database schema required for the RideSync application.

### Main Tables

- `riders` — stores rider information and wallet balances.
- `vehicles` — stores vehicle information such as UUID and license plate.
- `trips` — stores ride information, including rider, vehicle, fare, status, and timestamps.
- `wallet_audit_logs` — stores audit records for wallet balance changes.

### Key Features

- UUID-based primary keys.
- Foreign-key relationships between riders, vehicles, and trips.
- Appropriate data types and constraints.
- Constraints for validating wallet balances, fares, and trip states.

---

## 2. PostgreSQL Indexing

**File:** `02_indexes.sql`

This script creates indexes for query performance and business-rule enforcement.

### Active Rider Partial Unique Index

The partial unique index on `trips(rider_id)` prevents a rider from having more than one active trip at the same time.

The active trip statuses are:

- `REQUESTED`
- `IN_TRANSIT`

### Secondary Indexes

Indexes are created for commonly queried columns, including:

- `trips.rider_id`
- `trips.vehicle_id`
- `trips.created_at`
- completed trips based on trip status
- vehicle-related lookup columns
- rider-related lookup columns

### Completed Trips Partial Index

A partial index is created for completed trips.

It is restricted to rows where:

`status = 'COMPLETED'`

This is intended to improve queries that specifically filter for completed trips.

---

## 3. PostgreSQL Trigger and Audit Logging

**File:** `03_triggers_and_audit.sql`

This script implements automatic auditing of rider wallet balance changes.

### Trigger

The trigger `trg_wallet_audit` fires after an update to the `wallet_balance` column of the `riders` table.

It only fires when the wallet balance actually changes.

### Audit Logic

The wallet balance change is calculated as:

`NEW.wallet_balance - OLD.wallet_balance`

The action is classified as:

- `TOP_UP` — when the wallet balance increases.
- `FARE_DEDUCTION` — when the wallet balance decreases.

The following information is stored in `wallet_audit_logs`:

- Rider UUID
- Amount changed
- Action type
- Balance after the transaction
- Timestamp

If the wallet balance does not change, no audit record is generated.

### Verification

The trigger was tested by performing wallet balance changes and checking the corresponding records in `wallet_audit_logs`.

This confirms that wallet changes are automatically recorded by PostgreSQL.

---

## 4. Atomic Booking — Stored Procedure

**File:** `04_stored_procedures.sql`

This script implements ride booking using the PostgreSQL stored procedure `sp_book_ride`.

### Procedure Parameters

The procedure accepts:

- Rider UUID
- Vehicle UUID
- Fare amount

### Workflow

The procedure performs the following operations:

1. Locks the rider row using `FOR UPDATE`.
2. Checks whether the rider exists.
3. Checks whether the rider has sufficient wallet balance.
4. Checks whether the selected vehicle is active.
5. Deducts the fare from the rider's wallet.
6. Inserts a new trip with status `REQUESTED`.
7. Commits the transaction after successful booking.

### Atomicity

The wallet deduction and trip creation are performed within the same transaction.

The procedure therefore ensures that the booking operation is completed as a single database transaction.

### Verification

The procedure was tested using valid rider and vehicle UUIDs.

The resulting wallet balance and trip records were verified in PostgreSQL.

The active-rider partial unique index also prevents a rider from creating another active trip while an existing trip is in `REQUESTED` or `IN_TRANSIT` status.

---

## 5. Materialized View

**File:** `05_materialized_views.sql`

This script creates the materialized view `mv_vehicle_stats`.

### Purpose

The materialized view provides precomputed vehicle-level statistics to make repeated analytical reads faster.

### Statistics Stored

The view contains:

- Vehicle UUID
- License plate
- Total number of trips
- Total earnings from completed trips

### Unique Index

A unique index is created on `vehicle_id`.

This provides the uniqueness requirement needed for concurrent materialized-view refreshes.

### Refresh Function

A PostgreSQL function is provided to refresh the materialized view.

The refresh function can be called using:

`SELECT refresh_mv_vehicle_stats();`

### Verification

The materialized-view statistics were compared against values calculated directly from the `trips` table.

The counts and earnings were verified against the underlying trip data.

---

## 6. SQL Window Analytics

**File:** `06_window_analytics.sql`

This script performs trend analysis and vehicle performance ranking using Common Table Expressions and SQL window functions.

### Step 1 — Daily Revenue

The `daily_revenue` CTE calculates the total fare revenue for each vehicle for each day.

Only trips with status `COMPLETED` are included.

### Step 2 — Seven-Day Moving Average

The `moving_metrics` CTE calculates a seven-day moving average for each vehicle.

The window is partitioned by `vehicle_id`, ordered by `trip_date`, and considers the current row and the previous six rows.

### Step 3 — Vehicle Ranking

The final query uses `DENSE_RANK()` to rank vehicles for each day according to their seven-day moving average.

### Output

The final result contains:

- Vehicle license plate
- Trip date
- Daily fare
- Seven-day moving average
- Vehicle rank for that day

The query was successfully executed on the populated database.

---

## 7. Performance Proof

PostgreSQL performance testing was performed using:

`EXPLAIN (ANALYZE, BUFFERS)`

The raw PostgreSQL execution plans are stored in:

`performance/postgres_explain_analyzes.txt`

### Workflow 2 — SQL Window Analytics

The Workflow 2 query processes approximately 100,001 rows from the `trips` table.

The execution plan contains a sequential scan on `trips`.

The filter is:

`status = 'COMPLETED'`

Only 2 rows were removed by this filter, meaning almost all rows in the table were completed trips.

Because the filter is not selective, PostgreSQL determined that scanning the table sequentially was cheaper than using the completed-trip partial index.

The partial index `idx_trips_status_completed` exists and can be used for completed-trip queries.

A diagnostic execution with sequential scans disabled confirmed that PostgreSQL can use the index.

Therefore, the sequential scan in the original execution plan is a cost-based optimizer decision rather than a missing-index problem.

### Workflow 2 Execution Statistics

- Rows processed: 100,001
- Rows returned: 1,400
- Rows removed by filter: 2
- Planning Time: 2.204 ms
- Execution Time: 108.391 ms

The complete `EXPLAIN (ANALYZE, BUFFERS)` output is included in `performance/postgres_explain_analyzes.txt`.

---

## 8. SQL File Structure

The SQL directory contains the following files:

```text
sql/
├── 01_schema_ddl.sql
├── 02_indexes.sql
├── 03_triggers_and_audit.sql
├── 04_stored_procedures.sql
├── 05_materialized_views.sql
└── 06_window_analytics.sql
```

# RideSync A2 — MongoDB Setup & Execution

Run all commands from the repository root.

---

## 1. Clone Repository

```bash
cd ~/Desktop/gitAsgn
git clone https://github.com/dudekulamahammad/2026202016_a1.git
cd 2026202016_a1
```

Check files:

```bash
find . -maxdepth 2 -type f | sort
```

---

## 2. Start MongoDB

```bash
sudo systemctl start mongod
```

Check MongoDB:

```bash
mongosh --eval 'db.runCommand({ ping: 1 })'
```

---

## 3. Install PyMongo

```bash
python3 -m pip install pymongo
```

---

## 4. Generate MongoDB Data

```bash
python3 data_generations/mongo_seeder.py
```

Creates:

- `VehicleMetadata` — 150 documents
- `TripReviews` — 100,000 documents
- `TelemetryPings` — 500,000 documents

Verify:

```bash
mongosh --quiet --eval 'const db=db.getSiblingDB("ridesync_db"); print("VehicleMetadata:",db.VehicleMetadata.countDocuments()); print("TripReviews:",db.TripReviews.countDocuments()); print("TelemetryPings:",db.TelemetryPings.countDocuments());'
```

---

## 5. Create Indexes

```bash
mongosh --quiet --file mongo/01_collections_and_indexes.js
```

Creates:

- `location_2dsphere`
- `createdAt_1` TTL index
- `rating_1`
- `vehicleId_1`

Verify:

```bash
mongosh --quiet --eval 'const db=db.getSiblingDB("ridesync_db"); printjson(db.TelemetryPings.getIndexes()); printjson(db.TripReviews.getIndexes());'
```

---

## 6. Run Workflow 3 — $geoNear

```bash
mongosh --quiet --file mongo/02_workflow3_geonear.js
```

Runs the nearest available vehicle search within 5 km.

---

## 7. Run Workflow 4 — $facet

```bash
mongosh --quiet --file mongo/03_workflow4_facet.js
```

Runs:

- Rating distribution
- Top feedback tags
- Average rating

---

## 8. Generate EXPLAIN Statistics

```bash
python3 data_generations/generate_mongo_stats.py
```

Generates:

```text
performance/mongo_execution_stats.json
performance/mongo_explain_raw.json
```

View summary:

```bash
cat performance/mongo_execution_stats.json
```

---

## 9. Run Complete MongoDB Report

```bash
mongosh --quiet --file mongo/run_all_mongo_workflows.js
```

This is the **main MongoDB demo command**.

It shows:

- Database/collection counts
- Indexes
- Workflow 3 results
- Workflow 3 EXPLAIN statistics
- Workflow 4 rating distribution
- Top feedback tags
- Average rating
- Workflow 4 EXPLAIN statistics

---

## 10. View Performance Files

```bash
ls -lh performance/
```

View MongoDB execution summary:

```bash
cat performance/mongo_execution_stats.json
```

View raw EXPLAIN:

```bash
less performance/mongo_explain_raw.json
```

Press `q` to exit.

---

## 11. Remove Python Cache Before Git

```bash
find . -name "__pycache__" -type d -prune -exec rm -rf {} +
```

```bash
find . -name "*.pyc" -delete
```

---

## 12. Check Git

```bash
git status
```

Add files:

```bash
git add .
```

Commit:

```bash
git commit -m "Add RideSync database assignment implementation"
```

Push:

```bash
git push origin master
```

If your branch is `main`:

```bash
git push origin main
```

---

# Quick Demo

If everything is already installed, run these from the repository root:

```bash
sudo systemctl start mongod
```

```bash
python3 data_generations/mongo_seeder.py
```

```bash
mongosh --quiet --file mongo/01_collections_and_indexes.js
```

```bash
mongosh --quiet --file mongo/run_all_mongo_workflows.js
```

```bash
python3 data_generations/generate_mongo_stats.py
```

```bash
cat performance/mongo_execution_stats.json
```

---

# Repository Structure

```text
docs/
mongo/
data_generations/
performance/
sql/
README.md
```

MongoDB scripts:

```text
mongo/
├── 01_collections_and_indexes.js
├── 02_workflow3_geonear.js
├── 03_workflow4_facet.js
└── run_all_mongo_workflows.js
```

Data generation:

```text
data_generations/
├── mongo_seeder.py
├── generate_mongo_stats.py
├── generate_trip_reviews.py
└── get_geo_summary.py
```

Performance evidence:

```text
performance/
├── mongo_execution_stats.json
├── mongo_explain_raw.json
├── workflow3_explain_executionStats.log
└── workflow4_explain_executionStats.log
```

**MongoDB data is generated locally. No database dump or raw data is stored in GitHub.**

## Assumptions

- **Data-generation scripts:** MongoDB data generation is split into multiple Python scripts (`mongo_seeder.py`, `generate_trip_reviews.py`, `get_geo_summary.py`) instead of using a single generation file, with each script handling a specific data-generation or supporting task.

- **MongoDB data volume:** The required high-volume MongoDB data is generated locally using the provided seeders; actual database records are not committed to GitHub, in accordance with the submission guidelines.

- **Performance evidence:** MongoDB execution statistics and EXPLAIN outputs are stored as generated JSON/log files under `performance/` so that the performance analysis can be reproduced and inspected without storing database dumps.

- **Workflow organization:** MongoDB workflows are maintained as separate `.js` files (`02_workflow3_geonear.js` and `03_workflow4_facet.js`), with `run_all_mongo_workflows.js` provided as a combined demonstration script for executing and displaying the final workflow outputs.
