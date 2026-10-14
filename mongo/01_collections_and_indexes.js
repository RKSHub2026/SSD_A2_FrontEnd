// ============================================================
// RideSync - MongoDB collections, validators and indexes
// Run:  mongosh --quiet --file mongo/01_collections_and_indexes.js
// Safe to re-run (idempotent).
// ============================================================
// A2 changes vs A1:
//   * Selects ridesync_db explicitly. In A1 `use ridesync_db` was commented
//     out, so `mongosh --file` created everything in the default "test"
//     database and $geoNear on ridesync_db had no 2dsphere index.
//   * Idempotent: createCollection only when missing; validators applied
//     with collMod; old A1 index replaced if present.
//   * $jsonSchema validators (the A1 schema map promised "validation models").
//   * The 2dsphere index is compound { location: "2dsphere", createdAt: -1 },
//     so Workflow 3 can filter "fresh pings only" inside the index scan.
//   * Extra indexes for the UI: latest ping per vehicle, reviews per vehicle,
//     unique vehicleId on VehicleMetadata.
// ============================================================

db = db.getSiblingDB("ridesync_db");

const NUM = ["int", "long", "double", "decimal"];

const validators = {
  VehicleMetadata: {
    $jsonSchema: {
      bsonType: "object",
      required: ["vehicleId", "licensePlate", "class", "updatedAt"],
      properties: {
        vehicleId:    { bsonType: "string", description: "PostgreSQL vehicles.id (UUID string)" },
        licensePlate: { bsonType: "string" },
        class:        { bsonType: "string" },
        isActive:     { bsonType: "bool" },
        features:     { bsonType: "array", items: { bsonType: "string" } },
        specs:        { bsonType: "object" },
        inspection:   { bsonType: "object" },
        inspectionHistory: { bsonType: "array", items: { bsonType: "object" } },
        maintenance:  { bsonType: "object" },
        insurance:    { bsonType: "object" },
        updatedAt:    { bsonType: "date" }
      }
      // additional fields are allowed on purpose: this is the flexible catalog
    }
  },

  TripReviews: {
    $jsonSchema: {
      bsonType: "object",
      required: ["vehicleId", "rating", "feedback_tags", "createdAt"],
      properties: {
        vehicleId:       { bsonType: "string" },
        riderId:         { bsonType: "string" },
        rating:          { bsonType: NUM, minimum: 1, maximum: 5 },
        feedback_tags:   { bsonType: "array", items: { bsonType: "string" } },
        driver_feedback: { bsonType: "string" },
        createdAt:       { bsonType: "date" }
      }
    }
  },

  TelemetryPings: {
    $jsonSchema: {
      bsonType: "object",
      required: ["vehicleId", "isAvailable", "location", "createdAt"],
      properties: {
        vehicleId:   { bsonType: "string" },
        isAvailable: { bsonType: "bool" },
        location: {
          bsonType: "object",
          required: ["type", "coordinates"],
          properties: {
            type: { enum: ["Point"] },
            coordinates: {
              bsonType: "array", minItems: 2, maxItems: 2,
              items: { bsonType: NUM }   // [longitude, latitude]
            }
          }
        },
        createdAt: { bsonType: "date" }
      }
    }
  }
};

const existing = db.getCollectionNames();
for (const [name, validator] of Object.entries(validators)) {
  if (!existing.includes(name)) {
    db.createCollection(name, { validator, validationLevel: "strict", validationAction: "error" });
    print("created collection " + name);
  } else {
    db.runCommand({ collMod: name, validator, validationLevel: "strict", validationAction: "error" });
    print("updated validator on " + name);
  }
}

function dropIfExists(coll, indexName) {
  if (db[coll].getIndexes().some(ix => ix.name === indexName)) {
    db[coll].dropIndex(indexName);
    print("dropped old index " + coll + "." + indexName);
  }
}

// ---------------- TelemetryPings ----------------
// A1 had a plain { location: "2dsphere" }. Two 2dsphere indexes on the same
// field would make $geoNear's index choice ambiguous, so the A1 index is
// replaced by the compound one (location is still the 2dsphere key).
dropIfExists("TelemetryPings", "location_2dsphere");
db.TelemetryPings.createIndex(
  { location: "2dsphere", createdAt: -1 },
  { name: "location_2dsphere_createdAt" }
);
// TTL: delete pings 2 hours (7200 s) after createdAt (A1 requirement)
dropIfExists("TelemetryPings", "createdAt_1");
db.TelemetryPings.createIndex(
  { createdAt: 1 },
  { name: "createdAt_ttl_2h", expireAfterSeconds: 7200 }
);
// Latest ping per vehicle (map markers, simulator start positions)
db.TelemetryPings.createIndex({ vehicleId: 1, createdAt: -1 }, { name: "vehicleId_createdAt" });

// ---------------- TripReviews ----------------
db.TripReviews.createIndex({ rating: 1 }, { name: "rating_1" });
dropIfExists("TripReviews", "vehicleId_1");
db.TripReviews.createIndex({ vehicleId: 1, createdAt: -1 }, { name: "vehicleId_createdAt" });
db.TripReviews.createIndex({ createdAt: -1 }, { name: "createdAt_-1" });

// ---------------- VehicleMetadata ----------------
db.VehicleMetadata.createIndex({ vehicleId: 1 }, { name: "vehicleId_unique", unique: true });
db.VehicleMetadata.createIndex({ licensePlate: 1 }, { name: "licensePlate_1" });

print("");
for (const name of Object.keys(validators)) {
  print(name + " indexes: " + db[name].getIndexes().map(ix =>
    ix.name + (ix.expireAfterSeconds !== undefined ? " (TTL " + ix.expireAfterSeconds + "s)" : "")
  ).join(", "));
}
