import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config } from "../../api/config.js";

/**
 * Builds a throw-away PostgreSQL database for the tests:
 *   DROP + CREATE ridesync_test, run every sql/0*.sql file (the real schema,
 *   triggers, procedures, view and analytics function), then fixtures.sql.
 * Your seeded ridesync_v2 database is never touched.
 * Uses the same PG* settings as the app (.env); the database name comes
 * from PGTEST_DATABASE (default ridesync_test) and must contain "test".
 */
export const TEST_DB = process.env.PGTEST_DATABASE ?? "ridesync_test";
if (!/^[a-z_][a-z0-9_]*$/.test(TEST_DB) || !TEST_DB.includes("test")) {
  throw new Error(`Refusing to use "${TEST_DB}" as the test database: the name must contain "test".`);
}

const root = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const connection = ({ database }) => ({
  host: config.pg.host,
  port: config.pg.port,
  user: config.pg.user,
  password: config.pg.password,
  database,
  max: 1,
});

export const testDbConfig = () => ({ ...config.pg, database: TEST_DB, max: 4 });

export async function createTestDatabase() {
  const admin = new pg.Pool(connection({ database: process.env.PGADMIN_DATABASE ?? "postgres" }));
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
  } finally {
    await admin.end();
  }

  const db = new pg.Pool(connection({ database: TEST_DB }));
  try {
    const sqlDir = root("../../sql/");
    const files = (await readdir(sqlDir)).filter((f) => /^0\d.*\.sql$/.test(f)).sort();
    for (const f of files) {
      try {
        await db.query(await readFile(`${sqlDir}${f}`, "utf8"));
      } catch (err) {
        err.message = `sql/${f}: ${err.message}`;
        throw err;
      }
    }
    await db.query(await readFile(root("./fixtures.sql"), "utf8"));
  } finally {
    await db.end();
  }
}
