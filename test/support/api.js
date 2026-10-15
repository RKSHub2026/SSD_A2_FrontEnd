import { createApp } from "../../api/app.js";
import { createDb } from "../../api/db/pg.js";
import { fakeMongo } from "./fake-mongo.js";
import { testDbConfig } from "./test-db.js";

/**
 * Starts the real Express app (routes, validation, error mapping, services)
 * on a random port against the test database. MongoDB is the in-memory fake
 * unless a test passes its own.
 *   const api = await startApi();
 *   const { status, body } = await api.post("/trips", { ... });
 *   await api.close();
 */
export async function startApi({ mongo = fakeMongo() } = {}) {
  const db = createDb(testDbConfig());
  const app = createApp({ db, mongo });
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, "127.0.0.1", (err) => (err ? reject(err) : resolve(s)));
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;

  async function call(method, path, body, { raw } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
  }

  return {
    db,
    mongo,
    get: (p) => call("GET", p),
    post: (p, b, o) => call("POST", p, b, o),
    patch: (p, b) => call("PATCH", p, b),
    del: (p) => call("DELETE", p),
    /** First row of a SQL query against the test database (for checking side effects). */
    sql: async (text, params) => (await db.query(text, params)).rows[0],
    async close() {
      await new Promise((r) => server.close(r));
      await db.close();
    },
  };
}
