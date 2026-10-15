/**
 * Server for the browser tests: builds a fresh test database, then serves
 * the real app on E2E_PORT (4100). Started by playwright.config.js.
 * PostgreSQL: ridesync_e2e_test (fixtures). MongoDB: your ridesync_db (read only).
 */
process.env.PGTEST_DATABASE ??= "ridesync_e2e_test";

const { createTestDatabase, testDbConfig, TEST_DB } = await import("../support/test-db.js");
const { createApp } = await import("../../api/app.js");
const { config } = await import("../../api/config.js");
const { createMongo } = await import("../../api/db/mongo.js");
const { createDb } = await import("../../api/db/pg.js");

const port = Number(process.env.E2E_PORT ?? 4100);
await createTestDatabase();
const db = createDb(testDbConfig());
const mongo = await createMongo(config.mongo);
createApp({ db, mongo }).listen(port, "127.0.0.1", () => {
  console.log(`E2E server on http://127.0.0.1:${port} (PostgreSQL ${TEST_DB}, MongoDB ${config.mongo.db})`);
});
