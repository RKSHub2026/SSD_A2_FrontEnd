/**
 * Audit trail: read-only wallet history with a running balance.
 * Fixture rider Test Ekta: 3000 -> +500 -> +250 -> -120 (booking) = 3630.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startApi } from "../support/api.js";
import { MISSING, RIDERS } from "../support/ids.js";
import { createTestDatabase } from "../support/test-db.js";

let api;
before(async () => {
  await createTestDatabase();
  api = await startApi();
});
after(() => api?.close());

/** "Today" as the database sees it (the date filters use its time zone, not Node's). */
const today = async () => (await api.sql("SELECT CURRENT_DATE::text AS d")).d;

test("newest first, and each row's balance before is the previous row's balance after", async () => {
  const { status, body } = await api.get(`/riders/${RIDERS.ekta}/audit`);
  assert.equal(status, 200);
  assert.equal(body.rider.walletBalance, 3630);
  assert.deepEqual(
    body.items.map((r) => [r.actionType, r.amountChanged, r.balanceAfter]),
    [
      ["FARE_DEDUCTION", -120, 3630],
      ["TOP_UP", 250, 3750],
      ["TOP_UP", 500, 3500],
    ],
  );
  for (let i = 0; i < body.items.length - 1; i++) {
    assert.equal(body.items[i].balanceBefore, body.items[i + 1].balanceAfter, "running balance must chain");
  }
  assert.equal(body.items.at(-1).balanceBefore, 3000);
  assert.equal(body.items[0].tripId !== null, true, "the deduction is linked to its trip");
  assert.deepEqual(body.summary, { topUpCount: 2, topUpTotal: 750, deductionCount: 1, deductionTotal: 120, netChange: 630 });
});

test("filters by type and date (to is inclusive); oldest first on request", async () => {
  const topUps = await api.get(`/riders/${RIDERS.ekta}/audit?action=TOP_UP`);
  assert.equal(topUps.body.total, 2);
  assert.equal(topUps.body.summary.deductionCount, 0);

  const d = await today();
  const todayOnly = await api.get(`/riders/${RIDERS.ekta}/audit?from=${d}&to=${d}`);
  assert.equal(todayOnly.body.total, 3);
  const past = await api.get(`/riders/${RIDERS.ekta}/audit?from=2020-01-01&to=2020-01-31`);
  assert.equal(past.body.total, 0);
  assert.equal(past.body.summary.netChange, 0);

  const asc = await api.get(`/riders/${RIDERS.ekta}/audit?order=asc&pageSize=1&page=2`);
  assert.equal(asc.body.items[0].amountChanged, 250);
  assert.equal(asc.body.totalPages, 3);
});

test("a date range that ends before it starts is a 400 on the 'to' field", async () => {
  const res = await api.get(`/riders/${RIDERS.ekta}/audit?from=2026-10-10&to=2026-10-01`);
  assert.equal(res.status, 400);
  assert.match(res.body.error.fieldErrors.to[0], /on or after/);
});

test("entries can never be deleted: 403 RS010 and the row is still there", async () => {
  const { body } = await api.get(`/riders/${RIDERS.ekta}/audit`);
  const id = body.items[0].id;
  const res = await api.del(`/audit/${id}`);
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, "RS010");
  assert.equal((await api.sql("SELECT count(*)::int AS n FROM wallet_audit_logs WHERE id = $1", [id])).n, 1);
});

test("the database itself refuses UPDATE and DELETE on the log", async () => {
  await assert.rejects(api.db.query("UPDATE wallet_audit_logs SET amount_changed = 0"), (e) => e.code === "RS010");
  await assert.rejects(api.db.query("DELETE FROM wallet_audit_logs"), (e) => e.code === "RS010");
});

test("unknown rider or entry -> 404", async () => {
  assert.equal((await api.get(`/riders/${MISSING}/audit`)).status, 404);
  assert.equal((await api.del(`/audit/${MISSING}`)).status, 404);
});
