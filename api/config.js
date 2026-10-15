/**
 * Configuration from environment variables. `npm run dev` / `npm start`
 * load the repo-root .env automatically (node --env-file-if-exists).
 */
const env = (key, fallback) => process.env[key] ?? fallback;

export const config = {
  port: Number(env("PORT", "4000")),
  host: env("HOST", "0.0.0.0"),
  /** "debug" logs every request, "info" logs errors + slow requests, "silent" logs nothing */
  logLevel: env("LOG_LEVEL", "info"),
  pg: {
    host: env("PGHOST", "localhost"),
    port: Number(env("PGPORT", "5432")),
    database: env("PGDATABASE", "ridesync_v2"),
    user: env("PGUSER", "postgres"),
    password: process.env.PGPASSWORD,
    max: Number(env("PG_POOL_MAX", "10")),
  },
  mongo: {
    uri: env("MONGO_URI", "mongodb://127.0.0.1:27017/?directConnection=true"),
    db: env("MONGO_DB", "ridesync_db"),
  },
  /** Polling interval of the live map stream when change streams are unavailable. */
  livePollMs: Number(env("LIVE_POLL_MS", "3000")),
};
