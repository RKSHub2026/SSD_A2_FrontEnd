import { one } from "../db/pg.js";
import { AppError, notFound } from "../lib/errors.js";
import { offsetOf, paginate, Where } from "../lib/sql.js";
import { AUDIT_COLS, RIDER_COLS } from "./columns.js";

/**
 * Audit trail for one rider: wallet_audit_logs rows written by
 * trg_wallet_audit, newest first, with the running balance (balance_after)
 * and the balance before each change. Served by idx_wallet_audit_rider_ts
 * (rider_id, timestamp DESC). Dates are calendar days in the database
 * session time zone; `to` is inclusive.
 */
export async function listRiderAudit(db, riderId, q) {
  const rider = await one(db, `SELECT ${RIDER_COLS} FROM riders r WHERE r.id = $1::uuid`, [riderId]);
  if (!rider) throw notFound("Rider");

  const w = new Where();
  w.add("w.rider_id = $?::uuid", riderId);
  w.addIf(q.from, "w.timestamp >= $?::date");
  w.addIf(q.to, "w.timestamp < ($?::date + 1)");
  w.addIf(q.action, "w.action_type = $?");

  const filterParams = [...w.params];
  const limit = w.bind(q.pageSize);
  const offset = w.bind(offsetOf(q.page, q.pageSize));
  const dir = q.order === "asc" ? "ASC" : "DESC";

  const [items, summary] = await Promise.all([
    db.query(
      `SELECT ${AUDIT_COLS}
       FROM wallet_audit_logs w
       ${w.sql()}
       ORDER BY w.timestamp ${dir}, w.id ${dir}
       LIMIT ${limit} OFFSET ${offset}`,
      w.params,
    ),
    one(
      db,
      `SELECT count(*)::int                                                        AS total,
              (count(*) FILTER (WHERE w.action_type = 'TOP_UP'))::int               AS "topUpCount",
              COALESCE(sum(w.amount_changed) FILTER (WHERE w.action_type = 'TOP_UP'), 0)          AS "topUpTotal",
              (count(*) FILTER (WHERE w.action_type = 'FARE_DEDUCTION'))::int       AS "deductionCount",
              COALESCE(-sum(w.amount_changed) FILTER (WHERE w.action_type = 'FARE_DEDUCTION'), 0) AS "deductionTotal",
              COALESCE(sum(w.amount_changed), 0)                                    AS "netChange"
       FROM wallet_audit_logs w
       ${w.sql()}`,
      filterParams,
    ),
  ]);

  const { total, ...totals } = summary;
  return {
    rider,
    ...paginate(items.rows, total, q.page, q.pageSize),
    summary: totals,
  };
}

/**
 * DELETE /api/audit/:id - demonstrates that the log is append-only.
 * The DELETE runs inside a transaction that is ALWAYS rolled back:
 *   - normal case: trg_wallet_audit_immutable raises RS010 -> 403
 *   - if the guard were missing, the row is still restored (rollback) and
 *     the API reports a 500 instead of pretending the log is protected.
 * A row-level trigger does not fire for 0 rows, so a missing id is a 404.
 */
export async function attemptAuditDelete(db, id) {
  const exists = await one(db, "SELECT 1 AS ok FROM wallet_audit_logs WHERE id = $1::uuid", [id]);
  if (!exists) throw notFound("Audit entry");
  await db.tx(async (q) => {
    await q.query("DELETE FROM wallet_audit_logs WHERE id = $1::uuid", [id]);
    throw new AppError("INTERNAL", "The append-only guard did not fire; the delete was rolled back.");
  });
}
