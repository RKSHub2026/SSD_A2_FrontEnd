/**
 * npm run test:db - runs test/db/test_booking_workflow.sql with psql, using
 * the same PG* settings as the app (.env). The SQL tests run inside one
 * transaction and ROLL BACK, so they are safe on the seeded database.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const file = fileURLToPath(new URL("../db/test_booking_workflow.sql", import.meta.url));
const r = spawnSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-f", file], { stdio: "inherit", env: process.env });
if (r.error) {
  console.error(`Could not run psql: ${r.error.message}. Is the PostgreSQL client installed?`);
  process.exit(1);
}
process.exit(r.status ?? 1);
