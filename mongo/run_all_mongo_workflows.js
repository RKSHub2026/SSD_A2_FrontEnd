// ============================================================
// RideSync - MongoDB demo runner (counts, indexes, Workflow 3 + 4, explain)
// Run:  mongosh --quiet --file mongo/run_all_mongo_workflows.js
// ============================================================
// A2: pipelines updated to match 02_workflow3_geonear.js and
// 03_workflow4_facet.js (keep them in sync). Explain statistics are now
// found by walking the whole explain document, because the stage layout
// differs between MongoDB versions.
// ============================================================

db = db.getSiblingDB("ridesync_db");
const line = "============================================================";

function walk(obj, fn) {
  if (Array.isArray(obj)) obj.forEach(o => walk(o, fn));
  else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) { fn(k, v); walk(v, fn); }
  }
}
function explainSummary(explain) {
  const s = { indexes: new Set(), keys: 0, docs: 0, stages: new Set(), ms: null };
  walk(explain, (k, v) => {
    if (k === "indexName" && typeof v === "string") s.indexes.add(v);
    if (k === "totalKeysExamined" || k === "keysExamined") s.keys = Math.max(s.keys, Number(v));
    if (k === "totalDocsExamined" || k === "docsExamined") s.docs = Math.max(s.docs, Number(v));
    if (k === "stage" && typeof v === "string") s.stages.add(v);
    if (k === "executionTimeMillis" && s.ms === null) s.ms = Number(v);
  });
  return s;
}
function printExplain(title, explain) {
  const s = explainSummary(explain);
  print(title);
  print("  index(es) used     : " + ([...s.indexes].join(", ") || "none"));
  print("  plan stages        : " + [...s.stages].join(", "));
  print("  keys examined (max): " + s.keys);
  print("  docs examined (max): " + s.docs);
  print("  execution time ms  : " + s.ms);
  print("  COLLSCAN present   : " + s.stages.has("COLLSCAN"));
}

print(line); print("              RIDESYNC MONGODB EXECUTION REPORT"); print(line);
print("Database: " + db.getName() + "\n");

const collections = ["VehicleMetadata", "TripReviews", "TelemetryPings"];
print("DATABASE SUMMARY");
collections.forEach(n => print("  " + n.padEnd(16) + ": " + db[n].countDocuments() + " documents"));
const freshCount = db.TelemetryPings.countDocuments({ createdAt: { $gte: new Date(Date.now() - 10 * 60 * 1000) } });
print("  pings in last 10 min: " + freshCount);

print("\nINDEX SUMMARY");
collections.forEach(n => {
  print("  " + n + ":");
  db[n].getIndexes().forEach(ix => print("    - " + ix.name +
    (ix.expireAfterSeconds !== undefined ? " (TTL " + ix.expireAfterSeconds + " s)" : "")));
});

// ---------------- WORKFLOW 3 ----------------
print("\n" + line); print("WORKFLOW 3: NEAREST AVAILABLE VEHICLES ($geoNear, 5 km)"); print(line);
const riderLocation = [-73.9857, 40.7484];
const since = new Date(Date.now() - 10 * 60 * 1000);
const w3 = [
  { $geoNear: { near: { type: "Point", coordinates: riderLocation }, key: "location",
                distanceField: "distanceMeters", maxDistance: 5000, spherical: true,
                query: { createdAt: { $gte: since } } } },
  { $group: { _id: "$vehicleId", latest: { $top: { sortBy: { createdAt: -1 }, output: {
      isAvailable: "$isAvailable", distanceMeters: "$distanceMeters", location: "$location", lastSeen: "$createdAt" } } } } },
  { $match: { "latest.isAvailable": true } },
  { $sort: { "latest.distanceMeters": 1 } },
  { $limit: 5 },
  { $lookup: { from: "VehicleMetadata", localField: "_id", foreignField: "vehicleId", as: "meta",
               pipeline: [{ $project: { _id: 0, licensePlate: 1, class: 1 } }] } },
  { $project: { _id: 0, vehicleId: "$_id", licensePlate: { $first: "$meta.licensePlate" },
                class: { $first: "$meta.class" },
                distanceKm: { $round: [{ $divide: ["$latest.distanceMeters", 1000] }, 3] },
                lastSeen: "$latest.lastSeen" } }
];
const r3 = db.TelemetryPings.aggregate(w3).toArray();
r3.forEach((v, i) => print(`${i + 1}. ${v.licensePlate} (${v.class}) ${v.distanceKm} km  last seen ${v.lastSeen.toISOString()}`));
if (!r3.length) print("No fresh pings - run: python3 data_generations/mongo_seeder.py --live");
printExplain("\nWorkflow 3 explain (executionStats):",
             db.TelemetryPings.explain("executionStats").aggregate(w3));

// ---------------- WORKFLOW 4 ----------------
print("\n" + line); print("WORKFLOW 4: MULTI-FACETED REVIEW ANALYTICS ($facet)"); print(line);
const w4 = [
  { $facet: {
      rating_distribution: [ { $group: { _id: "$rating", count: { $sum: 1 } } }, { $sort: { _id: -1 } } ],
      common_feedback: [ { $unwind: "$feedback_tags" },
                         { $group: { _id: "$feedback_tags", total_occurrences: { $sum: 1 } } },
                         { $sort: { total_occurrences: -1, _id: 1 } }, { $limit: 10 } ],
      overall_average_rating: [ { $group: { _id: null, average_rating: { $avg: "$rating" }, total_reviews: { $sum: 1 } } },
                                { $project: { _id: 0, average_rating: { $round: ["$average_rating", 3] }, total_reviews: 1 } } ]
  } }
];
const r4 = db.TripReviews.aggregate(w4).toArray()[0];
print("RATING DISTRIBUTION");
r4.rating_distribution.forEach(x => print(`  ${x._id} stars : ${x.count}`));
print("TOP 10 FEEDBACK TAGS");
r4.common_feedback.forEach((x, i) => print(`  ${i + 1}. ${x._id} : ${x.total_occurrences}`));
print("OVERALL AVERAGE RATING");
const overall = r4.overall_average_rating[0];
if (overall) print("  " + overall.average_rating + " over " + overall.total_reviews + " reviews");
else print("  no reviews yet - run: python3 data_generations/mongo_seeder.py");
printExplain("\nWorkflow 4 explain (executionStats):",
             db.TripReviews.explain("executionStats").aggregate(w4));
print("  note: $facet sub-pipelines cannot use indexes; a full scan of TripReviews is expected");

print("\n" + line); print("                 END OF MONGODB REPORT"); print(line);
