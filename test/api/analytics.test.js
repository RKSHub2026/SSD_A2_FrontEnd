/**
 * Workflow 2 (window function) and the materialized view.
 * The API only calls fn_vehicle_revenue_moving_avg and the view; these tests
 * check that what reaches the browser is mathematically right.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startApi } from "../support/api.js";
import { COUNTS, RIDERS, VEHICLES } from "../support/ids.js";
import { createTestDatabase } from "../support/test-db.js";

let api;
before(async () => {
  await createTestDatabase();
  api = await startApi();
});
after(() => api?.close());

test("moving average: one point per day, and each point is the mean of the last 7 days", async () => {
  const { status, body } = await api.get("/analytics/moving-average?topN=3");
  assert.equal(status, 200);
  assert.ok(body.series.length >= 3);
  for (const s of body.series) {
    assert.equal(s.points.length, 30);
    // the API returns 30 days; the function looks 6 days further back, so
    // from day 7 on the window is fully inside what we received
    for (let i = 6; i < s.points.length; i++) {
      const mean = s.points.slice(i - 6, i + 1).reduce((a, p) => a + p.revenue, 0) / 7;
      assert.ok(Math.abs(mean - s.points[i].movingAvg7d) < 0.01, `${s.licensePlate} day ${i}: ${mean} vs ${s.points[i].movingAvg7d}`);
    }
  }
  const ranks = body.series.map((s) => s.rankOnLastDay);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), "series ordered by rank on the last day");
});

test("one vehicle keeps its real rank across the fleet", async () => {
  const all = await api.get("/analytics/ranking?limit=100");
  const target = all.body.items.at(-1);
  const one = await api.get(`/analytics/moving-average?vehicleId=${target.vehicleId}&from=${all.body.date}&to=${all.body.date}`);
  assert.equal(one.body.series[0].points[0].rank, target.rank);
});

test("ranking is DENSE_RANK: starts at 1, no gaps, ties share a rank", async () => {
  const { body } = await api.get("/analytics/ranking?limit=100");
  const ranks = body.items.map((r) => r.rank);
  assert.equal(ranks[0], 1);
  for (let i = 1; i < ranks.length; i++) assert.ok(ranks[i] === ranks[i - 1] || ranks[i] === ranks[i - 1] + 1, `gap at ${i}: ${ranks}`);
  for (let i = 1; i < body.items.length; i++) {
    const same = body.items[i].movingAvg7d === body.items[i - 1].movingAvg7d;
    assert.equal(ranks[i] === ranks[i - 1], same, "equal averages <=> equal rank");
  }
});

test("a range over 92 days or ending before it starts is rejected", async () => {
  assert.equal((await api.get("/analytics/moving-average?from=2026-01-01&to=2026-06-30")).status, 400);
  assert.equal((await api.get("/analytics/moving-average?from=2026-10-10&to=2026-10-01")).status, 400);
});

test("materialized view: summary, staleness after a booking, concurrent refresh", async () => {
  const before = await api.get("/analytics/vehicle-stats");
  assert.equal(before.body.summary.vehicles, COUNTS.vehicles);
  assert.equal(before.body.summary.totalTrips, COUNTS.trips);
  assert.equal(before.body.freshness.tripsNotInView, 0);

  await api.post("/trips", { riderId: RIDERS.asha, vehicleId: VEHICLES.v2, fare: 300 });
  const stale = await api.get("/analytics/vehicle-stats");
  assert.equal(stale.body.freshness.tripsNotInView, 1, "the view is a snapshot until refreshed");
  assert.equal(stale.body.summary.totalTrips, COUNTS.trips);

  const refreshed = await api.post("/analytics/vehicle-stats/refresh");
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.body.concurrent, true);
  assert.ok(refreshed.body.refreshedAt > before.body.freshness.refreshedAt);
  assert.equal(refreshed.body.freshness.tripsNotInView, 0);
  assert.equal((await api.get("/analytics/vehicle-stats")).body.summary.totalTrips, COUNTS.trips + 1);
});

test("overview counts agree with the browse endpoints", async () => {
  const o = (await api.get("/analytics/overview")).body;
  const free = (await api.get("/vehicles?available=true")).body.total;
  assert.equal(o.availableVehicles, free);
  assert.equal(o.inactiveVehicles, 1);
  assert.equal(o.riders, COUNTS.riders);
});
