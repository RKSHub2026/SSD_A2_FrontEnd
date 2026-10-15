import { MongoClient } from "mongodb";

/**
 * MongoDB access. Start-up does not fail if MongoDB is down: /api/health
 * reports it and the Mongo-backed routes answer 503 until it is back.
 */
export async function createMongo(cfg) {
  const client = new MongoClient(cfg.uri, {
    serverSelectionTimeoutMS: 5_000,
    appName: "ridesync-api",
  });
  await client.connect().catch((err) => console.error("[mongo] not reachable:", err.message));
  const db = client.db(cfg.db);

  return {
    client,
    db,
    /** true when connected to a replica-set member (change streams available) */
    async isReplicaSet() {
      try {
        const hello = await db.admin().command({ hello: 1 });
        return typeof hello.setName === "string";
      } catch {
        return false;
      }
    },
    async ping() {
      try {
        await db.command({ ping: 1 });
        return true;
      } catch {
        return false;
      }
    },
    close: () => client.close(),
  };
}
