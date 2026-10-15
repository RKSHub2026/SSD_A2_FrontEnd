import pg from "pg";

/**
 * PostgreSQL access.
 *
 * node-postgres returns NUMERIC and BIGINT as strings; we convert them to JS
 * numbers (wallets are DECIMAL(10,2) and counts are far below 2^53, so this is
 * lossless here). TIMESTAMPTZ becomes an ISO string and DATE stays
 * "YYYY-MM-DD", so rows can be sent to the browser as JSON directly.
 */
const { types } = pg;
const NUMERIC = 1700;
const INT8 = 20;
const DATE = 1082;
const TIMESTAMPTZ = 1184;

const parseTimestamptz = types.getTypeParser(TIMESTAMPTZ);
types.setTypeParser(NUMERIC, (v) => Number.parseFloat(v));
types.setTypeParser(INT8, (v) => Number.parseInt(v, 10));
types.setTypeParser(DATE, (v) => v);
types.setTypeParser(TIMESTAMPTZ, (v) => parseTimestamptz(v).toISOString());

/**
 * @typedef {{ query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> }} Queryable
 * @typedef {Queryable & {
 *   tx: <T>(fn: (q: Queryable) => Promise<T>) => Promise<T>,
 *   ping: () => Promise<boolean>,
 *   close: () => Promise<void>,
 * }} Db
 */

/** @returns {Db} */
export function createDb(cfg) {
  const pool = new pg.Pool({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    max: cfg.max,
    application_name: "ridesync-api",
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000, // guard against runaway queries
  });
  // An idle client losing its connection must not crash the server.
  pool.on("error", (err) => console.error("[pg] idle client error:", err.message));

  return {
    query: (text, params) => pool.query(text, params),

    /** Runs fn inside BEGIN/COMMIT on one connection; ROLLBACK on error. */
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    async ping() {
      try {
        await pool.query("SELECT 1");
        return true;
      } catch {
        return false;
      }
    },

    close: () => pool.end(),
  };
}

/** First row or null. @param {Queryable} q */
export async function one(q, text, params) {
  const { rows } = await q.query(text, params);
  return rows[0] ?? null;
}
