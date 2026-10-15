/** Browse: paging, search, filters, detail views and error shapes. */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startApi } from "../support/api.js";
import { COUNTS, MISSING, RIDERS, VEHICLES } from "../support/ids.js";
import { createTestDatabase } from "../support/test-db.js";

let api;
before(async () => {
  await createTestDatabase();
  api = await startApi();
});
after(() => api?.close());

test("health reports both databases", async () => {
  const { status, body } = await api.get("/health");
  assert.equal(status, 200);
  assert.deepEqual([body.status, body.postgres, body.mongo], ["ok", true, true]);
});

test("lists are paginated, never the whole table", async () => {
  const p1 = await api.get("/riders");
  assert.deepEqual([p1.body.items.length, p1.body.total, p1.body.totalPages], [20, COUNTS.riders, 2]);
  const p2 = await api.get("/riders?page=2");
  assert.equal(p2.body.items.length, COUNTS.riders - 20);
  const trips = await api.get("/trips?pageSize=5");
  assert.deepEqual([trips.body.items.length, trips.body.total], [5, COUNTS.trips]);
  const dates = trips.body.items.map((t) => t.createdAt);
  assert.deepEqual(dates, [...dates].sort().reverse(), "newest first");
});

test("search and sort riders; LIKE wildcards are literal", async () => {
  const s = await api.get("/riders?q=test%20b");
  assert.deepEqual(s.body.items.map((r) => r.name), ["Test Bala"]);
  assert.equal((await api.get("/riders?q=%25")).body.total, 0, "'%' must not match everything");
  assert.equal((await api.get(`/riders?q=${RIDERS.ekta}`)).body.items[0].name, "Test Ekta", "search by exact id");
  const poor = await api.get("/riders?sort=wallet_balance&order=asc&pageSize=2");
  assert.deepEqual(poor.body.items.map((r) => r.walletBalance), [50, 50]);
});

test("vehicle filters: bookable now, out of service", async () => {
  const free = await api.get("/vehicles?available=true&pageSize=100");
  assert.equal(free.body.total, COUNTS.activeVehicles - 1, "all active vehicles except the busy one");
  assert.ok(!free.body.items.some((v) => v.id === VEHICLES.busy));
  const out = await api.get("/vehicles?active=false");
  assert.deepEqual(out.body.items.map((v) => v.id), [VEHICLES.inactive]);
});

test("trip filters: status, rider, date range", async () => {
  const requested = await api.get("/trips?status=REQUESTED");
  assert.deepEqual(requested.body.items.map((t) => t.riderId), [RIDERS.chen]);
  assert.equal((await api.get(`/trips?riderId=${RIDERS.ekta}`)).body.total, 1);
  assert.equal((await api.get("/trips?from=2020-01-01&to=2020-01-31")).body.total, 0);
});

test("detail views, and 404s that are JSON", async () => {
  const r = await api.get(`/riders/${RIDERS.chen}`);
  assert.equal(r.body.activeTrip.vehicleId, VEHICLES.busy);
  const v = await api.get(`/vehicles/${VEHICLES.busy}`);
  assert.equal(v.body.activeTrip.riderId, RIDERS.chen);
  assert.ok(v.body.statsRefreshedAt);
  for (const path of [`/riders/${MISSING}`, `/vehicles/${MISSING}`, `/trips/${MISSING}`, "/no-such-route"]) {
    const res = await api.get(path);
    assert.equal(res.status, 404, path);
    assert.equal(res.body.error.code, "NOT_FOUND");
  }
});

test("bad query parameters are a 400 that names the field", async () => {
  for (const [path, field] of [
    ["/riders/abc", "id"],
    ["/riders?pageSize=500", "pageSize"],
    ["/vehicles?class=Truck", "class"],
    ["/trips?status=IN_TRANSIT", "status"],
    ["/trips?from=15-10-2026", "from"],
  ]) {
    const res = await api.get(path);
    assert.equal(res.status, 400, path);
    assert.ok(res.body.error.fieldErrors[field], `${path}: ${JSON.stringify(res.body.error)}`);
  }
});
