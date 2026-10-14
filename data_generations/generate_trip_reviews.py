"""
RideSync - top up TripReviews to a target count (default 100,000).

mongo_seeder.py already creates 100,000 reviews. Use this script to add
reviews without re-seeding the other collections, e.g. after testing deletes:

    python3 data_generations/generate_trip_reviews.py               # up to 100,000
    python3 data_generations/generate_trip_reviews.py --target 150000

A2 fixes vs the A1 version of this file:
  * vehicleId used V00001..V05000, but only 150 vehicles existed in MongoDB
    and none of them in PostgreSQL. Reviews now use the shared fleet (the
    PostgreSQL vehicle UUIDs), the same as mongo_seeder.py.
  * Tags now match the rating and ratings follow a realistic skew: the same
    review_doc() as mongo_seeder.py, so both scripts produce identical data.
  * MONGO_URI / MONGO_DB environment variables; reproducible with SEED.
"""

import argparse
import os
import random
from datetime import datetime, timezone

from pymongo import MongoClient

from mongo_seeder import BATCH_SIZE, mongo_db_name, mongo_uri, review_doc
from postgres_seeder import riders, vehicle_fleet


def main():
    ap = argparse.ArgumentParser(description="Top up TripReviews to a target count")
    ap.add_argument("--target", type=int, default=100_000)
    args = ap.parse_args()
    random.seed(int(os.getenv("SEED", "7")))

    client = MongoClient(mongo_uri())
    collection = client[mongo_db_name()]["TripReviews"]

    current = collection.count_documents({})
    remaining = args.target - current
    print(f"Existing reviews: {current:,}")
    print(f"Reviews to generate: {max(remaining, 0):,}")
    if remaining <= 0:
        print(f"TripReviews already has {args.target:,}+ documents.")
        client.close()
        return

    fleet = vehicle_fleet()
    rider_ids = [r["id"] for r in riders()]
    now = datetime.now(timezone.utc)

    batch, inserted = [], 0
    for _ in range(remaining):
        batch.append(review_doc(fleet, rider_ids, now))
        if len(batch) >= BATCH_SIZE:
            collection.insert_many(batch, ordered=False)
            inserted += len(batch)
            batch = []
            print(f"Inserted {inserted:,} / {remaining:,}")
    if batch:
        collection.insert_many(batch, ordered=False)

    print()
    print("======================================")
    print("TripReviews generation complete")
    print("======================================")
    print(f"Final TripReviews count: {collection.count_documents({}):,}")
    client.close()


if __name__ == "__main__":
    main()
