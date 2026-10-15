/**
 * Workflow 1 - the transaction (POST /api/trips) and everything around it.
 * The most important part of the app: money moves here. Each test checks
 * the HTTP answer AND what really happened in the database (balances,
 * trips, audit rows), because a friendly error that still charged the
 * rider would be the worst possible bug.
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { startApi } from "../support/api.js";
import { MISSING, RIDERS, VEHICLES } from "../support/ids.js";
import { createTestDatabase } from "../support/test-db.js";

let api;
before(async () => {
  await createTestDatabase();
  api = await startApi();
});
after(() => api?.close());

const balance = async (riderId) => Number((await api.sql("SELECT wallet_balance AS b FROM riders WHERE id = $1", [riderId])).b);
const tripCount = async (riderId) => (await api.sql("SELECT count(*)::int AS n FROM trips WHERE rider_id = $1", [riderId])).n;
const auditCount = async (riderId) => (await api.sql("SELECT count(*)::int AS n FROM wallet_audit_logs WHERE rider_id = $1", [riderId])).n;
const book = (riderId, vehicleId, fare) => api.post("/trips", { riderId, vehicleId, fare });

/** For every failure: nothing may change - no trip, no deduction, no audit row. */
async function expectNothingChanged(riderId, fn) {
  const before = [await balance(riderId), await tripCount(riderId), await auditCount(riderId)];
  const res = await fn();
  assert.deepEqual([await balance(riderId), await tripCount(riderId), await auditCount(riderId)], before, "the database changed after a failed booking");
  return res;
}

describe("booking succeeds", () => {
  test("creates the trip, takes the fare and returns the audit row the trigger wrote", async () => {
    const res = await book(RIDERS.asha, VEHICLES.v1, 250.5);
    assert.equal(res.status, 201);
    assert.equal(res.headers.get("location"), `/api/trips/${res.body.trip.id}`);

    const { trip, auditEntry, wallet } = res.body;
    assert.equal(trip.status, "REQUESTED");
    assert.equal(trip.fareAmount, 250.5);
    assert.deepEqual(wallet, { riderId: RIDERS.asha, balanceBefore: 5000, balanceAfter: 4749.5 });

    // the audit row is linked to the trip and matches the balance change
    assert.equal(auditEntry.actionType, "FARE_DEDUCTION");
    assert.equal(auditEntry.amountChanged, -250.5);
    assert.equal(auditEntry.tripId, trip.id);
    assert.equal(auditEntry.balanceAfter, 4749.5);

    // and the database agrees
    assert.equal(await balance(RIDERS.asha), 4749.5);
    const row = await api.sql("SELECT action_type, amount_changed::float AS amt FROM wallet_audit_logs WHERE trip_id = $1", [trip.id]);
    assert.deepEqual(row, { action_type: "FARE_DEDUCTION", amt: -250.5 });
  });

  test("the trip detail shows the linked audit entry", async () => {
    const { body } = await api.get(`/trips?riderId=${RIDERS.asha}&active=true`);
    const detail = await api.get(`/trips/${body.items[0].id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.auditEntries.length, 1);
    assert.equal(detail.body.auditEntries[0].amountChanged, -250.5);
  });
});

describe("booking fails with a clear reason and changes nothing", () => {
  test("RS006: the rider already has an active trip (partial unique index)", async () => {
    const res = await expectNothingChanged(RIDERS.chen, () => book(RIDERS.chen, VEHICLES.v2, 100));
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, "RS006");
    assert.equal(res.body.error.constraint, "idx_unique_active_rider_trip");
    assert.match(res.body.error.title, /already has an active trip/);
  });

  test("RS007: the vehicle is already on an active trip", async () => {
    const res = await expectNothingChanged(RIDERS.dev, () => book(RIDERS.dev, VEHICLES.busy, 100));
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, "RS007");
    assert.equal(res.body.error.constraint, "idx_unique_active_vehicle_trip");
  });

  test("RS004: the fare is more than the wallet (CHECK constraint, full rollback)", async () => {
    const res = await expectNothingChanged(RIDERS.bala, () => book(RIDERS.bala, VEHICLES.v2, 500));
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, "RS004");
    assert.match(res.body.error.hint, /Top up/);
    assert.equal(await balance(RIDERS.bala), 50);
  });

  test("RS003: the vehicle is out of service", async () => {
    const res = await expectNothingChanged(RIDERS.dev, () => book(RIDERS.dev, VEHICLES.inactive, 100));
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, "RS003");
  });

  test("RS001 / RS002: unknown rider or vehicle", async () => {
    const r1 = await book(MISSING, VEHICLES.v2, 100);
    assert.equal(r1.status, 404);
    assert.equal(r1.body.error.code, "RS001");
    const r2 = await expectNothingChanged(RIDERS.dev, () => book(RIDERS.dev, MISSING, 100));
    assert.equal(r2.status, 404);
    assert.equal(r2.body.error.code, "RS002");
  });

  test("invalid input is rejected before the database, naming the field", async () => {
    for (const [body, field] of [
      [{ riderId: RIDERS.dev, vehicleId: VEHICLES.v2, fare: 0 }, "fare"],
      [{ riderId: RIDERS.dev, vehicleId: VEHICLES.v2, fare: 12.345 }, "fare"],
      [{ riderId: RIDERS.dev, vehicleId: VEHICLES.v2, fare: 10001 }, "fare"],
      [{ riderId: RIDERS.dev, vehicleId: VEHICLES.v2, fare: "abc" }, "fare"],
      [{ riderId: "not-a-uuid", vehicleId: VEHICLES.v2, fare: 100 }, "riderId"],
      [{ riderId: RIDERS.dev, fare: 100 }, "vehicleId"],
    ]) {
      const res = await expectNothingChanged(RIDERS.dev, () => api.post("/trips", body));
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.error.code, "VALIDATION");
      assert.ok(res.body.error.fieldErrors[field], `expected an error for ${field}: ${JSON.stringify(res.body.error)}`);
    }
  });

  test("a body that is not JSON gets a 400, not a crash", async () => {
    const res = await api.post("/trips", "{not json", { raw: true });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.message, "The request body is not valid JSON.");
  });
});

describe("trip status moves forward only", () => {
  let tripId;
  test("REQUESTED -> IN TRANSIT -> COMPLETED, and completing frees the rider", async () => {
    tripId = (await book(RIDERS.dev, VEHICLES.v4, 150)).body.trip.id;

    const skip = await api.patch(`/trips/${tripId}/status`, { status: "COMPLETED" });
    assert.equal(skip.status, 409);
    assert.equal(skip.body.error.code, "RS009", "cannot skip IN TRANSIT");

    const start = await api.patch(`/trips/${tripId}/status`, { status: "IN TRANSIT" });
    assert.equal(start.status, 200);
    assert.deepEqual([start.body.previousStatus, start.body.trip.status, start.body.released], ["REQUESTED", "IN TRANSIT", false]);

    const back = await api.patch(`/trips/${tripId}/status`, { status: "IN TRANSIT" });
    assert.equal(back.body.error.code, "RS009", "cannot repeat or go back");

    const done = await api.patch(`/trips/${tripId}/status`, { status: "COMPLETED" });
    assert.deepEqual([done.body.previousStatus, done.body.trip.status, done.body.released], ["IN TRANSIT", "COMPLETED", true]);

    // the partial unique indexes no longer block the rider or the vehicle
    const again = await book(RIDERS.dev, VEHICLES.v4, 90);
    assert.equal(again.status, 201);
  });

  test("completing does not move money again (the fare was taken at booking)", async () => {
    const audits = await api.sql("SELECT count(*)::int AS n FROM wallet_audit_logs WHERE trip_id = $1", [tripId]);
    assert.equal(audits.n, 1);
  });

  test("unknown trip -> RS008; invalid status -> 400", async () => {
    assert.equal((await api.patch(`/trips/${MISSING}/status`, { status: "IN TRANSIT" })).body.error.code, "RS008");
    const bad = await api.patch(`/trips/${tripId}/status`, { status: "IN_TRANSIT" });
    assert.equal(bad.status, 400);
    assert.ok(bad.body.error.fieldErrors.status);
  });
});

describe("top-up", () => {
  test("adds money, logs TOP_UP, and lets a low-balance rider book", async () => {
    const res = await api.post(`/riders/${RIDERS.bala}/top-up`, { amount: 450 });
    assert.equal(res.status, 200);
    assert.equal(res.body.walletBalance, 500);
    assert.equal(res.body.auditEntry.actionType, "TOP_UP");
    assert.equal(res.body.auditEntry.amountChanged, 450);
    assert.equal(res.body.auditEntry.tripId, null);

    const booked = await book(RIDERS.bala, VEHICLES.v6, 500);
    assert.equal(booked.status, 201);
    assert.equal(booked.body.wallet.balanceAfter, 0);
  });

  test("rejects a zero amount and an unknown rider", async () => {
    const zero = await api.post(`/riders/${RIDERS.asha}/top-up`, { amount: 0 });
    assert.equal(zero.status, 400);
    assert.ok(zero.body.error.fieldErrors.amount);
    assert.equal((await api.post(`/riders/${MISSING}/top-up`, { amount: 10 })).body.error.code, "RS001");
  });
});
