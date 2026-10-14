"""
RideSync - capture MongoDB explain("executionStats") evidence for Workflows 3 and 4.

Writes (run from the repository root):
    performance/mongo_explain_raw.json      full explain documents
    performance/mongo_execution_stats.json  compact summary

A2: pipelines updated to the fixed Workflow 3 / 4 versions (same as
mongo/02 and mongo/03). Connection is read from MONGO_URI / MONGO_DB.

Run `python3 data_generations/mongo_seeder.py --live` for a minute first, so
Workflow 3 has fresh pings.
"""

import json
import os
from datetime import datetime, timedelta, timezone

from pymongo import MongoClient

from mongo_seeder import mongo_db_name, mongo_uri

OUT_DIR = "performance"
RIDER_LOCATION = [-73.9857, 40.7484]


def geo_pipeline():
    since = datetime.now(timezone.utc) - timedelta(minutes=10)
    return [
        {"$geoNear": {
            "near": {"type": "Point", "coordinates": RIDER_LOCATION},
            "key": "location",
            "distanceField": "distanceMeters",
            "maxDistance": 5000,
            "spherical": True,
            "query": {"createdAt": {"$gte": since}},
        }},
        {"$group": {"_id": "$vehicleId", "latest": {"$top": {
            "sortBy": {"createdAt": -1},
            "output": {"isAvailable": "$isAvailable", "distanceMeters": "$distanceMeters",
                       "location": "$location", "lastSeen": "$createdAt"}}}}},
        {"$match": {"latest.isAvailable": True}},
        {"$sort": {"latest.distanceMeters": 1}},
        {"$limit": 5},
        {"$lookup": {"from": "VehicleMetadata", "localField": "_id", "foreignField": "vehicleId",
                     "as": "meta", "pipeline": [{"$project": {"_id": 0, "licensePlate": 1, "class": 1}}]}},
        {"$project": {"_id": 0, "vehicleId": "$_id",
                      "licensePlate": {"$first": "$meta.licensePlate"},
                      "distanceKm": {"$round": [{"$divide": ["$latest.distanceMeters", 1000]}, 3]}}},
    ]


FACET_PIPELINE = [
    {"$facet": {
        "rating_distribution": [
            {"$group": {"_id": "$rating", "count": {"$sum": 1}}},
            {"$sort": {"_id": -1}},
        ],
        "common_feedback": [
            {"$unwind": "$feedback_tags"},
            {"$group": {"_id": "$feedback_tags", "total_occurrences": {"$sum": 1}}},
            {"$sort": {"total_occurrences": -1, "_id": 1}},
            {"$limit": 10},
        ],
        "overall_average_rating": [
            {"$group": {"_id": None, "average_rating": {"$avg": "$rating"}, "total_reviews": {"$sum": 1}}},
            {"$project": {"_id": 0, "average_rating": {"$round": ["$average_rating", 3]}, "total_reviews": 1}},
        ],
    }}
]


def explain(db, collection, pipeline):
    return db.command("explain", {"aggregate": collection, "pipeline": pipeline, "cursor": {}},
                      verbosity="executionStats")


def summarize(doc):
    s = {"indexes": set(), "stages": set(), "keys": [], "docs": [], "ms": []}

    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k == "indexName" and isinstance(v, str):
                    s["indexes"].add(v)
                elif k == "stage" and isinstance(v, str):
                    s["stages"].add(v)
                elif k in ("totalKeysExamined", "keysExamined") and isinstance(v, (int, float)):
                    s["keys"].append(v)
                elif k in ("totalDocsExamined", "docsExamined") and isinstance(v, (int, float)):
                    s["docs"].append(v)
                elif k in ("executionTimeMillis", "executionTimeMillisEstimate") and isinstance(v, (int, float)):
                    s["ms"].append(v)
                walk(v)
        elif isinstance(o, list):
            for i in o:
                walk(i)

    walk(doc)
    return {
        "indexes_used": sorted(s["indexes"]),
        "plan_stages": sorted(s["stages"]),
        "collscan": "COLLSCAN" in s["stages"],
        "max_keysExamined": max(s["keys"], default=0),
        "max_docsExamined": max(s["docs"], default=0),
        "max_executionTimeMillis": max(s["ms"], default=None),
    }


def main():
    client = MongoClient(mongo_uri())
    db = client[mongo_db_name()]
    os.makedirs(OUT_DIR, exist_ok=True)

    geo = explain(db, "TelemetryPings", geo_pipeline())
    facet = explain(db, "TripReviews", FACET_PIPELINE)
    now = datetime.now(timezone.utc).isoformat()

    with open(os.path.join(OUT_DIR, "mongo_explain_raw.json"), "w") as f:
        json.dump({"generated_at": now, "workflow3_geonear": geo, "workflow4_facet": facet},
                  f, indent=2, default=str)

    report = {
        "database": db.name,
        "mongo_version": client.server_info()["version"],
        "generated_at": now,
        "counts": {c: db[c].estimated_document_count()
                   for c in ("VehicleMetadata", "TripReviews", "TelemetryPings")},
        "workflow3_geonear": {
            "description": "Nearest available vehicles (latest fresh ping per vehicle) within 5 km",
            **summarize(geo),
        },
        "workflow4_facet": {
            "description": "Rating distribution, top tags ($unwind), average rating",
            "note": "$facet sub-pipelines cannot use indexes; a collection scan is expected",
            **summarize(facet),
        },
    }
    with open(os.path.join(OUT_DIR, "mongo_execution_stats.json"), "w") as f:
        json.dump(report, f, indent=2)

    print(json.dumps(report, indent=2))
    print(f"\nSaved {OUT_DIR}/mongo_execution_stats.json and {OUT_DIR}/mongo_explain_raw.json")
    client.close()


if __name__ == "__main__":
    main()
