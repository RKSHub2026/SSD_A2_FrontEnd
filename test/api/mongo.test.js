/**
 * Workflows 3 and 4 (MongoDB) - contract tests.
 * MongoDB is replaced by an in-memory fake, so these tests check:
 *  - the pipelines the API sends are exactly the ones in mongo/02 and mongo/03
 *    (the Assignment 1 workflows), run in a sandbox to capture them;
 *  - how the API combines MongoDB results with PostgreSQL (bookable flag);
 *  - error handling when MongoDB is down.
 * Running the pipelines on real data is covered by the browser tests.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import vm from "node:vm";
import { nearestPipeline } from "../../api/services/map.js";
import { summaryPipeline } from "../../api/services/reviews.js";
import { MAP_DEFAULTS } from "../../shared/constants.js";
import { startApi } from "../support/api.js";
import { fakeMongo } from "../support/fake-mongo.js";
import { MISSING, VEHICLES, plateOf } from "../support/ids.js";
import { createTestDatabase } from "../support/test-db.js";

/** Runs a mongosh script with a fake db and returns the pipeline it aggregates. */
function pipelineOf(file, collection) {
  let captured;
  const db = { getSiblingDB: () => db, [collection]: { aggregate: (p) => ((captured = p), { toArray: () => [] }) } };
  vm.runInNewContext(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), { db, print() {}, printjson() {}, Date });
  return JSON.parse(JSON.stringify(captured, (k, v) => (k === "$gte" ? "<since>" : v)));
}

describe("pipelines match the Assignment 1 scripts", () => {
  test("Workflow 3: $geoNear nearest available (mongo/02_workflow3_geonear.js)", () => {
    const script = pipelineOf("mongo/02_workflow3_geonear.js", "TelemetryPings");
    const { lon, lat } = MAP_DEFAULTS.center;
    const api = JSON.parse(JSON.stringify(nearestPipeline({ lon, lat, radiusMeters: 5000, freshMinutes: 10, limit: 5 }), (k, v) => (k === "$gte" ? "<since>" : v)));
    // the API adds make/model for the list; everything else must be identical
    api[5].$lookup.pipeline[0].$project = script[5].$lookup.pipeline[0].$project;
    delete api[6].$project.make;
    delete api[6].$project.model;
    assert.equal(JSON.stringify(api), JSON.stringify(script));
  });

  test("Workflow 4: $facet review analytics (mongo/03_workflow4_facet.js)", () => {
    const script = pipelineOf("mongo/03_workflow4_facet.js", "TripReviews");
    assert.equal(JSON.stringify(summaryPipeline({ topTags: 10 })), JSON.stringify(script));
  });

  test("filters go into $match before $facet (stages inside $facet cannot use indexes)", () => {
    const p = summaryPipeline({ topTags: 5, vehicleId: VEHICLES.v1, from: "2026-10-01", to: "2026-10-01" });
    assert.equal(p[0].$match.vehicleId, VEHICLES.v1);
    assert.equal(p[0].$match.createdAt.$lt.toISOString(), "2026-10-02T00:00:00.000Z", "'to' is inclusive");
  });
});

describe("API on top of MongoDB", () => {
  const ping = (n) => ({ vehicleId: `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, "0")}`, licensePlate: plateOf(n), class: "SUV", distanceKm: n / 10, location: { type: "Point", coordinates: [72.84, 19.02] }, lastSeen: new Date() });
  let api;
  let mongo;
  before(async () => {
    await createTestDatabase();
    mongo = fakeMongo({
      TelemetryPings: { aggregate: [ping(1), ping(3), ping(13)] },
      TripReviews: {
        aggregate: [{ rating_distribution: [5, 4, 3, 2, 1].map((s, i) => ({ _id: s, count: 10 - i })), common_feedback: [{ _id: "Clean car", total_occurrences: 9 }], overall_average_rating: [{ average_rating: 3.71, total_reviews: 40 }] }],
      },
      VehicleMetadata: { find: [{ vehicleId: VEHICLES.v1, licensePlate: plateOf(1), specs: { fuelType: "Electric", batteryKWh: 40.5 } }] },
    });
    api = await startApi({ mongo });
  });
  after(() => api?.close());

  test("nearest: 'bookable' comes from PostgreSQL, not from the ping", async () => {
    const { body } = await api.get("/map/nearest?limit=3");
    const bookable = Object.fromEntries(body.items.map((i) => [i.vehicleId, i.bookable]));
    assert.deepEqual(bookable, { [VEHICLES.v1]: true, [VEHICLES.busy]: false, [VEHICLES.inactive]: false });
    assert.deepEqual(body.items[0].location, { lon: 72.84, lat: 19.02 });
    assert.equal(mongo.calls.at(-1).pipeline[4].$limit, 3);
  });

  test("nearest validates the origin", async () => {
    assert.equal((await api.get("/map/nearest?lat=95")).status, 400);
    assert.equal((await api.get("/map/nearest?radiusMeters=50")).status, 400);
  });

  test("review summary is shaped for the charts", async () => {
    const { body } = await api.get("/reviews/summary");
    assert.equal(body.averageRating, 3.71);
    assert.equal(body.totalReviews, 40);
    assert.deepEqual(body.ratingDistribution[0], { rating: 5, count: 10 });
    assert.deepEqual(body.commonFeedback, [{ tag: "Clean car", count: 9 }]);
  });

  test("catalog document, or 404", async () => {
    assert.equal((await api.get(`/vehicles/${VEHICLES.v1}/catalog`)).body.specs.batteryKWh, 40.5);
    assert.equal((await api.get(`/vehicles/${MISSING}/catalog`)).status, 404);
  });
});

test("MongoDB down -> 503 'Database unavailable', health degraded", async () => {
  const api = await startApi({ mongo: fakeMongo({}, { down: true }) });
  try {
    const res = await api.get("/reviews/summary");
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, "DB_UNAVAILABLE");
    const health = await api.get("/health");
    assert.equal(health.status, 503);
    assert.equal(health.body.mongo, false);
  } finally {
    await api.close();
  }
});
