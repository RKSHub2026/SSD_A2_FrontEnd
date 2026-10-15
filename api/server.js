import { createApp } from "./app.js";
import { config } from "./config.js";
import { createMongo } from "./db/mongo.js";
import { createDb } from "./db/pg.js";

const db = createDb(config.pg);
const mongo = await createMongo(config.mongo);
const app = createApp({ db, mongo });

const server = app.listen(config.port, config.host, async (err) => {
  if (err) {
    console.error(err.message);
    process.exit(1);
  }
  const [pgOk, mongoOk, rs] = await Promise.all([db.ping(), mongo.ping(), mongo.isReplicaSet()]);
  console.log(`RideSync running on http://localhost:${config.port}`);
  console.log(`  PostgreSQL ${pgOk ? "connected" : "UNREACHABLE"} (${config.pg.database})`);
  console.log(`  MongoDB    ${mongoOk ? "connected" : "UNREACHABLE"} (${config.mongo.db})`);
  console.log(`  Live map   ${rs ? "change streams" : "polling fallback (MongoDB is not a replica set)"}`);
});

async function shutdown(signal) {
  console.log(`\n${signal} received, shutting down...`);
  server.close();
  await Promise.allSettled([db.close(), mongo.close()]);
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
