"""
RideSync - Workflow 3 geo summary (prints only, writes no files).

For a few rider locations it runs the fixed Workflow 3 pipeline (same as
mongo/02_workflow3_geonear.js) and prints how many vehicles are near and
available, the nearest one, and the explain statistics for the first
location (index used, keys / documents examined, time).

    python3 data_generations/get_geo_summary.py
    python3 data_generations/get_geo_summary.py --fresh-minutes 30

A2 fixes vs the A1 version of this file:
  * The A1 $facet pipeline here ran $unwind on feedback_tags BEFORE $facet,
    so every review was counted once per tag and the rating distribution
    and average were inflated. Workflow 4 evidence is now produced only by
    generate_mongo_stats.py (correct pipeline); this script focuses on geo.
  * It no longer overwrites performance/mongo_execution_stats.json (that is
    generate_mongo_stats.py's job).
  * Uses the fixed Workflow 3 pipeline (one row per vehicle, latest fresh
    ping) and the MONGO_URI / MONGO_DB environment variables.
"""

import argparse
from datetime import datetime, timedelta, timezone

from pymongo import MongoClient

from mongo_seeder import mongo_db_name, mongo_uri

LOCATIONS = [
    ("Dadar station", [72.8426, 19.0178]),
    ("CSMT", [72.8355, 18.9398]),
    ("Bandra Kurla Complex", [72.8656, 19.0607]),
    ("Mumbai Airport T2", [72.8742, 19.0990]),
]
MAX_DISTANCE_M = 5000


def nearest_pipeline(coords, since, limit=5):
    return [
        {"$geoNear": {
            "near": {"type": "Point", "coordinates": coords},
            "key": "location",
            "distanceField": "distanceMeters",
            "maxDistance": MAX_DISTANCE_M,
            "spherical": True,
            "query": {"createdAt": {"$gte": since}},
        }},
        {"$group": {"_id": "$vehicleId", "latest": {"$top": {
            "sortBy": {"createdAt": -1},
            "output": {"isAvailable": "$isAvailable", "distanceMeters": "$distanceMeters"}}}}},
        {"$match": {"latest.isAvailable": True}},
        {"$sort": {"latest.distanceMeters": 1}},
        {"$limit": limit},
        {"$lookup": {"from": "VehicleMetadata", "localField": "_id", "foreignField": "vehicleId",
                     "as": "meta", "pipeline": [{"$project": {"_id": 0, "licensePlate": 1}}]}},
        {"$project": {"_id": 0, "vehicleId": "$_id",
                      "licensePlate": {"$first": "$meta.licensePlate"},
                      "distanceKm": {"$round": [{"$divide": ["$latest.distanceMeters", 1000]}, 3]}}},
    ]


def find_values(obj, key):
    """Recursively collect all values for a key in an explain document."""
    found = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == key:
                found.append(v)
            found.extend(find_values(v, key))
    elif isinstance(obj, list):
        for item in obj:
            found.extend(find_values(item, key))
    return found


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fresh-minutes", type=int, default=10, help="ignore pings older than this")
    args = ap.parse_args()

    client = MongoClient(mongo_uri())
    db = client[mongo_db_name()]
    since = datetime.now(timezone.utc) - timedelta(minutes=args.fresh_minutes)

    fresh = db.TelemetryPings.count_documents({"createdAt": {"$gte": since}})
    print("=" * 70)
    print(f"WORKFLOW 3 GEO SUMMARY  ({db.name}, pings newer than {args.fresh_minutes} min: {fresh:,})")
    print("=" * 70)
    if fresh == 0:
        print("No fresh pings. Run: python3 data_generations/mongo_seeder.py --live")

    for label, coords in LOCATIONS:
        rows = list(db.TelemetryPings.aggregate(nearest_pipeline(coords, since)))
        nearest = f"{rows[0]['licensePlate']} at {rows[0]['distanceKm']} km" if rows else "none"
        print(f"{label:<24} available within 5 km (top 5 shown): {len(rows)}   nearest: {nearest}")

    label, coords = LOCATIONS[0]
    explain = db.command(
        "explain",
        {"aggregate": "TelemetryPings", "pipeline": nearest_pipeline(coords, since), "cursor": {}},
        verbosity="executionStats",
    )
    keys = [v for v in find_values(explain, "totalKeysExamined") + find_values(explain, "keysExamined")
            if isinstance(v, (int, float))]
    docs = [v for v in find_values(explain, "totalDocsExamined") + find_values(explain, "docsExamined")
            if isinstance(v, (int, float))]
    times = [v for v in find_values(explain, "executionTimeMillis") if isinstance(v, (int, float))]
    stages = sorted({s for s in find_values(explain, "stage") if isinstance(s, str)})
    print()
    print(f"Explain for {label}:")
    print(f"  indexes used   : {sorted({str(x) for x in find_values(explain, 'indexName')})}")
    print(f"  plan stages    : {stages}")
    print(f"  keys examined  : {max(keys, default=0):,}")
    print(f"  docs examined  : {max(docs, default=0):,}")
    print(f"  execution time : {max(times, default=0)} ms")
    print(f"  COLLSCAN       : {'COLLSCAN' in stages}")
    client.close()


if __name__ == "__main__":
    main()
