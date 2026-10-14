"""
RideSync - MongoDB seeder

Generates (database ridesync_db):
  * VehicleMetadata : 100 docs, one per PostgreSQL vehicle (same ids, plates and classes)
  * TripReviews     : 100,000 reviews about those vehicles
  * TelemetryPings  : 500,000 GeoJSON pings, a random-walk track per active vehicle

Run AFTER mongo/01_collections_and_indexes.js (validators + indexes):
    mongosh --quiet --file mongo/01_collections_and_indexes.js
    python3 data_generations/mongo_seeder.py                 # seed all three collections

Live mode (A2) - keep the Map screen alive, see "LIVE MODE" below:
    python3 data_generations/mongo_seeder.py --live          # one ping per vehicle every 3 s
    python3 data_generations/mongo_seeder.py --live --interval 5
    python3 data_generations/mongo_seeder.py --live --once   # single tick (testing)
    python3 data_generations/mongo_seeder.py --live --no-postgres

Environment: MONGO_URI (mongodb://127.0.0.1:27017/?directConnection=true),
MONGO_DB (ridesync_db), SEED; PG* variables for live mode availability.

A2 changes vs A1:
  * vehicleId is the PostgreSQL vehicle UUID (string). A1 used V00001..V00150,
    which matched nothing in PostgreSQL.
  * VehicleMetadata is richer and varies by vehicle (inspection history,
    class- and fuel-specific specs) to show the "flexible document" idea.
  * Reviews: realistic rating skew, and tags that match the rating
    (A1 picked tags at random, so 1-star reviews were tagged "friendly").
  * Pings: each vehicle follows a continuous track with sticky
    availability, so the "latest ping per vehicle" is meaningful.
    Inactive vehicles send no pings.
  * NOTE (TTL): pings are 0-110 minutes old when seeded, and the 2-hour TTL
    index removes them over time. Run this script with --live during demos
    to keep live pings flowing.
"""

import argparse
import os
import random
import time
from datetime import datetime, timedelta, timezone

from pymongo import InsertOne, MongoClient

# Shared fleet definition (same vehicle ids / plates / classes as PostgreSQL)
from postgres_seeder import (CITY_CENTER, CITY_SPREAD_LAT, CITY_SPREAD_LON, pg_config,
                             riders, vehicle_fleet)


def mongo_uri():
    return os.getenv("MONGO_URI", "mongodb://127.0.0.1:27017/?directConnection=true")


def mongo_db_name():
    return os.getenv("MONGO_DB", "ridesync_db")

REVIEW_COUNT = 100_000
TELEMETRY_COUNT = 500_000
BATCH_SIZE = 5_000
LIVE_WINDOW_MIN = 110        # most pings fall inside the last 110 minutes
EXPIRED_SHARE = 0.01         # 1% older than 2 h -> removed by TTL (demonstration)

MODELS = {
    "Sedan":     [("Toyota", "Camry"), ("Honda", "City"), ("Hyundai", "Verna")],
    "SUV":       [("Mahindra", "XUV700"), ("Toyota", "Fortuner"), ("Kia", "Seltos")],
    "Hatchback": [("Maruti", "Swift"), ("Hyundai", "i20"), ("Tata", "Altroz")],
}
FEATURES = ["AC", "GPS", "Bluetooth", "WiFi", "ChildSeat", "WheelchairAccessible",
            "PhoneCharger", "DashCam"]
INSPECTORS = ["A. Rao", "M. Iyer", "S. Khan", "P. Das", "J. Lee"]

POSITIVE_TAGS = ["clean", "friendly", "safe", "fast", "professional",
                 "comfortable", "polite", "helpful"]
NEGATIVE_TAGS = ["slow", "late", "rude", "unsafe_driving", "dirty", "wrong_route"]
FEEDBACK = {
    "pos": ["Excellent ride", "Driver was friendly", "Vehicle was clean",
            "Very comfortable", "Driver was professional", "Ride was safe"],
    "mid": ["Good ride", "Overall okay experience", "Could be faster", "Average trip"],
    "neg": ["Driver was late", "Car was not clean", "Took a longer route",
            "Uncomfortable ride", "Driver was rude"],
}
RATING_WEIGHTS = [6, 9, 17, 33, 35]  # 1..5 stars


def now_utc():
    return datetime.now(timezone.utc)


# ============================================================
# VehicleMetadata
# ============================================================

def vehicle_doc(v, rnd):
    make, model = rnd.choice(MODELS[v["class"]])
    fuel = rnd.choice(["Petrol", "Diesel", "CNG", "Electric"])
    seats = 7 if v["class"] == "SUV" and rnd.random() < 0.5 else (5 if v["class"] != "Hatchback" else 4)

    # Dynamic, class/fuel dependent attributes - the flexible part
    specs = {"seats": seats, "fuelType": fuel, "transmission": rnd.choice(["Manual", "Automatic"])}
    if fuel == "Electric":
        specs["batteryKWh"] = rnd.choice([30.2, 40.5, 59.0])
        specs["rangeKm"] = rnd.randint(250, 480)
        specs["fastCharging"] = rnd.random() < 0.7
    if fuel == "CNG":
        specs["cngTankKg"] = rnd.choice([8, 10, 12])
    if v["class"] == "SUV":
        specs["driveTrain"] = rnd.choice(["FWD", "AWD"])
        specs["bootLitres"] = rnd.randint(300, 600)

    history = []
    d = now_utc() - timedelta(days=rnd.randint(1, 60))
    odo = rnd.randint(20_000, 120_000)
    for _ in range(rnd.randint(2, 5)):
        status = rnd.choice(["PASSED", "PASSED", "PASSED", "PASSED_WITH_NOTES", "FAILED"])
        rec = {
            "date": d,
            "inspector": rnd.choice(INSPECTORS),
            "status": status,
            "odometerKm": odo,
            "checks": {
                "brakes": rnd.choice(["OK", "OK", "Pads 30%"]),
                "tyres": rnd.choice(["OK", "OK", "Replace soon"]),
                "lights": "OK",
            },
        }
        if status != "PASSED":
            rec["notes"] = rnd.choice(["Wiper blade worn", "AC weak", "Minor dent rear bumper",
                                       "Brake pads replaced on re-check"])
        history.append(rec)
        d -= timedelta(days=rnd.randint(60, 120))
        odo -= rnd.randint(5_000, 15_000)

    latest = history[0]
    doc = {
        "vehicleId": str(v["id"]),            # = PostgreSQL vehicles.id
        "licensePlate": v["license_plate"],   # = PostgreSQL vehicles.license_plate
        "class": v["class"],                  # = PostgreSQL vehicles.class
        "isActive": v["is_active"],
        "make": make,
        "model": model,
        "year": rnd.randint(2017, 2025),
        "color": rnd.choice(["White", "Silver", "Black", "Blue", "Red", "Grey"]),
        "features": sorted(rnd.sample(FEATURES, rnd.randint(2, 6))),
        "specs": specs,
        # A1 shape kept: latest inspection summary
        "inspection": {"status": latest["status"], "date": latest["date"]},
        "inspectionHistory": history,
        "maintenance": {
            "lastService": now_utc() - timedelta(days=rnd.randint(1, 120)),
            "serviceDue": rnd.random() < 0.25,
        },
        "insurance": {
            "provider": "RideSafe",
            "policyNumber": f"RS-POL-{v['index']:05d}",
            "valid": rnd.random() < 0.9,
            "expiresOn": now_utc() + timedelta(days=rnd.randint(-30, 365)),
        },
        "updatedAt": now_utc(),
    }
    if not v["is_active"]:
        doc["outOfServiceReason"] = rnd.choice(["Scheduled maintenance", "Accident repair",
                                                "Insurance renewal pending"])
    return doc


def seed_vehicle_metadata(db, fleet):
    col = db["VehicleMetadata"]
    col.delete_many({})
    docs = [vehicle_doc(v, random.Random(1000 + v["index"])) for v in fleet]
    col.insert_many(docs)
    print(f"VehicleMetadata inserted: {len(docs):,}")


# ============================================================
# TripReviews
# ============================================================

def review_doc(fleet, rider_ids, now):
    rating = random.choices([1, 2, 3, 4, 5], weights=RATING_WEIGHTS)[0]
    if rating >= 4:
        tags = random.sample(POSITIVE_TAGS, random.randint(1, 3))
        feedback = random.choice(FEEDBACK["pos"])
    elif rating == 3:
        tags = random.sample(POSITIVE_TAGS, 1) + random.sample(NEGATIVE_TAGS, random.randint(0, 2))
        feedback = random.choice(FEEDBACK["mid"])
    else:
        tags = random.sample(NEGATIVE_TAGS, random.randint(1, 3))
        feedback = random.choice(FEEDBACK["neg"])
    return {
        "vehicleId": str(random.choice(fleet)["id"]),
        "riderId": str(random.choice(rider_ids)),
        "rating": rating,
        "feedback_tags": tags,
        "driver_feedback": feedback,
        "createdAt": now - timedelta(minutes=random.randint(0, 60 * 24 * 180)),
    }


def seed_reviews(db, fleet):
    col = db["TripReviews"]
    col.delete_many({})
    rider_ids = [r["id"] for r in riders()]
    now = now_utc()
    start = time.time()
    batch = []
    for i in range(1, REVIEW_COUNT + 1):
        batch.append(review_doc(fleet, rider_ids, now))
        if len(batch) >= BATCH_SIZE:
            col.insert_many(batch, ordered=False)
            batch = []
            if i % 25_000 == 0:
                print(f"  reviews {i:,}/{REVIEW_COUNT:,}")
    if batch:
        col.insert_many(batch, ordered=False)
    print(f"TripReviews inserted: {col.count_documents({}):,} ({time.time() - start:.1f}s)")


# ============================================================
# TelemetryPings
# ============================================================

def clamp(val, centre, spread):
    lo, hi = centre - spread, centre + spread
    return min(max(val, lo), hi)


def vehicle_track(vehicle_id, n, now):
    """Yield n pings for one vehicle: continuous random walk + sticky availability."""
    lon = CITY_CENTER[0] + random.uniform(-CITY_SPREAD_LON, CITY_SPREAD_LON)
    lat = CITY_CENTER[1] + random.uniform(-CITY_SPREAD_LAT, CITY_SPREAD_LAT)
    available = random.random() < 0.75
    n_expired = int(n * EXPIRED_SHARE)
    n_live = n - n_expired

    # timestamps: a few old ones (TTL demo), then evenly spaced recent ones
    times = [now - timedelta(hours=random.uniform(2.1, 5.0)) for _ in range(n_expired)]
    step = (LIVE_WINDOW_MIN * 60) / max(n_live, 1)
    base = now - timedelta(minutes=LIVE_WINDOW_MIN)
    times += [base + timedelta(seconds=i * step + random.uniform(0, step)) for i in range(n_live)]
    times.sort()

    for ts in times:
        lon = clamp(lon + random.gauss(0, 0.0004), CITY_CENTER[0], CITY_SPREAD_LON)
        lat = clamp(lat + random.gauss(0, 0.0003), CITY_CENTER[1], CITY_SPREAD_LAT)
        if random.random() < 0.003:          # occasionally picks up / drops off a rider
            available = not available
        yield {
            "vehicleId": vehicle_id,
            "isAvailable": available,
            "location": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
            "createdAt": ts,
        }


def seed_telemetry(db, fleet):
    col = db["TelemetryPings"]
    col.delete_many({})
    active = [v for v in fleet if v["is_active"]]
    per_vehicle = TELEMETRY_COUNT // len(active)
    remainder = TELEMETRY_COUNT - per_vehicle * len(active)
    now = now_utc()
    start = time.time()
    batch, inserted = [], 0
    for idx, v in enumerate(active):
        n = per_vehicle + (1 if idx < remainder else 0)
        for doc in vehicle_track(str(v["id"]), n, now):
            batch.append(InsertOne(doc))
            if len(batch) >= BATCH_SIZE:
                col.bulk_write(batch, ordered=False)
                inserted += len(batch)
                batch = []
                if inserted % 50_000 == 0:
                    print(f"  telemetry {inserted:,}/{TELEMETRY_COUNT:,}")
    if batch:
        col.bulk_write(batch, ordered=False)
        inserted += len(batch)
    print(f"TelemetryPings inserted: {inserted:,} for {len(active)} active vehicles "
          f"({time.time() - start:.1f}s)")


def check_indexes(db):
    names = {ix["name"] for ix in db["TelemetryPings"].list_indexes()}
    if not any("2dsphere" in n for n in names):
        print("\nWARNING: no 2dsphere index on TelemetryPings.location - run "
              "mongo/01_collections_and_indexes.js, otherwise $geoNear will fail.")




# ============================================================
# LIVE MODE  (A2)  -  python3 data_generations/mongo_seeder.py --live
# ------------------------------------------------------------
# Inserts one TelemetryPings document per active vehicle every few seconds.
# Needed because the 2-hour TTL index deletes the seeded pings, and the A2 Map
# screen must show new pings without a page reload.
#
# If PostgreSQL is reachable (psycopg2 installed, PG* env vars set), the
# availability follows the real database: a vehicle with a REQUESTED or
# IN TRANSIT trip pings isAvailable=false, so booking a ride in the UI removes
# that car from the "nearest available" results within one tick. Otherwise
# availability is simulated.
# ============================================================

class PostgresState:
    """Reads vehicle activity + busy vehicles from PostgreSQL (optional)."""

    def __init__(self):
        import psycopg2  # imported lazily so live mode runs without it
        cfg = pg_config()
        if not cfg["password"]:
            cfg.pop("password")
        self.conn = psycopg2.connect(**cfg)
        self.conn.autocommit = True

    def snapshot(self):
        with self.conn.cursor() as cur:
            cur.execute("SELECT id::text FROM vehicles WHERE is_active")
            active = {r[0] for r in cur.fetchall()}
            cur.execute("SELECT DISTINCT vehicle_id::text FROM trips "
                        "WHERE status IN ('REQUESTED', 'IN TRANSIT')")
            busy = {r[0] for r in cur.fetchall()}
        return active, busy


def latest_positions(col):
    """Last known coordinates per vehicle (uses the vehicleId_createdAt index)."""
    pipeline = [
        {"$sort": {"vehicleId": 1, "createdAt": -1}},
        {"$group": {"_id": "$vehicleId",
                    "coords": {"$first": "$location.coordinates"},
                    "available": {"$first": "$isAvailable"}}},
    ]
    return {d["_id"]: d for d in col.aggregate(pipeline, allowDiskUse=True)}


def run_live(args):
    client = MongoClient(mongo_uri())
    col = client[mongo_db_name()]["TelemetryPings"]

    pg = None
    if not args.no_postgres:
        try:
            pg = PostgresState()
            print("Availability source: PostgreSQL active trips")
        except Exception as e:  # driver missing / DB down
            print(f"PostgreSQL not used ({e.__class__.__name__}); availability is simulated")

    fleet = vehicle_fleet()
    ids = {str(v["id"]) for v in fleet if v["is_active"]}
    known = latest_positions(col)
    state = {}
    for vid in ids:
        if vid in known and known[vid].get("coords"):
            lon, lat = known[vid]["coords"]
            avail = known[vid].get("available", True)
        else:
            lon = CITY_CENTER[0] + random.uniform(-CITY_SPREAD_LON, CITY_SPREAD_LON)
            lat = CITY_CENTER[1] + random.uniform(-CITY_SPREAD_LAT, CITY_SPREAD_LAT)
            avail = random.random() < 0.75
        state[vid] = {"lon": lon, "lat": lat, "available": avail}
    print(f"Simulating {len(state)} vehicles every {args.interval}s -> "
          f"{mongo_db_name()}.TelemetryPings  (Ctrl+C to stop)")

    tick = 0
    try:
        while True:
            tick += 1
            busy = set()
            if pg:
                active, busy = pg.snapshot()
                for vid in list(state):
                    if vid not in active:
                        state.pop(vid)
                for vid in active - state.keys():
                    state[vid] = {"lon": CITY_CENTER[0], "lat": CITY_CENTER[1], "available": True}

            now = datetime.now(timezone.utc)
            docs = []
            for vid, s in state.items():
                s["lon"] = clamp(s["lon"] + random.gauss(0, 0.0004), CITY_CENTER[0], CITY_SPREAD_LON)
                s["lat"] = clamp(s["lat"] + random.gauss(0, 0.0003), CITY_CENTER[1], CITY_SPREAD_LAT)
                if pg:
                    s["available"] = vid not in busy
                elif random.random() < 0.02:
                    s["available"] = not s["available"]
                docs.append({
                    "vehicleId": vid,
                    "isAvailable": s["available"],
                    "location": {"type": "Point", "coordinates": [round(s["lon"], 6), round(s["lat"], 6)]},
                    "createdAt": now,
                })
            if docs:
                col.insert_many(docs, ordered=False)
            n_av = sum(1 for d in docs if d["isAvailable"])
            print(f"[{now:%H:%M:%S}] tick {tick}: {len(docs)} pings ({n_av} available, "
                  f"{len(docs) - n_av} busy)")
            if args.once:
                break
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        client.close()


# ============================================================
# MAIN
# ============================================================

def main():
    ap = argparse.ArgumentParser(description="RideSync MongoDB seeder / live telemetry")
    ap.add_argument("--live", action="store_true", help="stream live pings instead of seeding")
    ap.add_argument("--interval", type=float, default=3.0, help="live mode: seconds between ticks")
    ap.add_argument("--once", action="store_true", help="live mode: run a single tick and exit")
    ap.add_argument("--no-postgres", action="store_true",
                    help="live mode: do not read availability from PostgreSQL")
    args = ap.parse_args()
    if args.live:
        run_live(args)
        return

    random.seed(int(os.getenv("SEED", "42")))
    client = MongoClient(mongo_uri())
    db = client[mongo_db_name()]
    fleet = vehicle_fleet()

    print("=" * 70)
    print(f"RIDESYNC MONGODB DATA GENERATION  (database: {db.name})")
    print("=" * 70)
    seed_vehicle_metadata(db, fleet)
    seed_reviews(db, fleet)
    seed_telemetry(db, fleet)
    check_indexes(db)

    print("\nFinal counts:")
    for name in ("VehicleMetadata", "TripReviews", "TelemetryPings"):
        print(f"  {name:<16}: {db[name].count_documents({}):,}")
    client.close()


if __name__ == "__main__":
    main()
