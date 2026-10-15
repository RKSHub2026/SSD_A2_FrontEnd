// ============================================================
// RideSync - Workflow 3: Nearest available vehicles within 5 km of a rider
// Run:  mongosh --quiet --file mongo/02_workflow3_geonear.js
// ============================================================
// A2 changes vs A1:
//   * Runs on ridesync_db and prints its result (A1 printed nothing with --file).
//   * Returns VEHICLES, not pings. A1 returned the 5 nearest pings, so one
//     car could appear several times. It also filtered isAvailable on any
//     ping, so a car could look available from a stale ping while busy now.
//     Now each vehicle's LATEST fresh ping inside the radius decides its
//     position and availability.
//   * Freshness window (default 10 min): uses the compound
//     { location: "2dsphere", createdAt: -1 } index, so old pings are
//     skipped inside the index scan instead of being fetched.
//   * Removed the redundant $sort after $geoNear ($geoNear already sorts by
//     distance) and added plate + class from VehicleMetadata.
// Requires MongoDB 5.2+ ($top accumulator).
// ============================================================

db = db.getSiblingDB("ridesync_db");

// ---- parameters (the API passes these) ----
const riderLocation = [72.8426, 19.0178];    // [longitude, latitude] - Dadar station, Mumbai
const maxDistanceMeters = 5000;              // 5 km
const freshMinutes = 10;                     // ignore pings older than this
const resultLimit = 5;

const since = new Date(Date.now() - freshMinutes * 60 * 1000);

const pipeline = [
  // 1. pings within 5 km, fresh only, nearest first (2dsphere index)
  {
    $geoNear: {
      near: { type: "Point", coordinates: riderLocation },
      key: "location",
      distanceField: "distanceMeters",
      maxDistance: maxDistanceMeters,
      spherical: true,
      query: { createdAt: { $gte: since } }
    }
  },
  // 2. one row per vehicle, from its most recent ping
  {
    $group: {
      _id: "$vehicleId",
      latest: {
        $top: {
          sortBy: { createdAt: -1 },
          output: {
            isAvailable: "$isAvailable",
            distanceMeters: "$distanceMeters",
            location: "$location",
            lastSeen: "$createdAt"
          }
        }
      }
    }
  },
  // 3. only vehicles that are available right now
  { $match: { "latest.isAvailable": true } },
  { $sort: { "latest.distanceMeters": 1 } },
  { $limit: resultLimit },
  // 4. enrich with the catalog document (same id as PostgreSQL vehicles.id)
  {
    $lookup: {
      from: "VehicleMetadata",
      localField: "_id",
      foreignField: "vehicleId",
      as: "meta",
      pipeline: [{ $project: { _id: 0, licensePlate: 1, class: 1, make: 1, model: 1 } }]
    }
  },
  {
    $project: {
      _id: 0,
      vehicleId: "$_id",
      licensePlate: { $first: "$meta.licensePlate" },
      class: { $first: "$meta.class" },
      distanceKm: { $round: [{ $divide: ["$latest.distanceMeters", 1000] }, 3] },
      location: "$latest.location",
      lastSeen: "$latest.lastSeen"
    }
  }
];

const results = db.TelemetryPings.aggregate(pipeline).toArray();
print(`Nearest available vehicles within ${maxDistanceMeters / 1000} km of [${riderLocation}] ` +
      `(pings newer than ${freshMinutes} min): ${results.length}`);
printjson(results);

if (results.length === 0) {
  print("No fresh pings found. Seeded pings age out (2 h TTL, 10 min freshness);");
  print("run: python3 data_generations/mongo_seeder.py --live   (streams live pings)");
}
