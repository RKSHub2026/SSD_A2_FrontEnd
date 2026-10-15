import { fileURLToPath } from "node:url";
import express from "express";
import { config } from "./config.js";
import { AppError, toApiError } from "./lib/errors.js";
import { analyticsRouter } from "./routes/analytics.js";
import { auditRouter } from "./routes/audit.js";
import { bookingRouter } from "./routes/booking.js";
import { browseRouter } from "./routes/browse.js";
import { healthRouter } from "./routes/health.js";
import { mapRouter } from "./routes/map.js";
import { reviewsRouter } from "./routes/reviews.js";

const path = (rel) => fileURLToPath(new URL(rel, import.meta.url));

/**
 * Builds the Express app. Dependencies are injected so tests can pass their own.
 *   /api/*          JSON API (routes/ -> services/ -> databases)
 *   /shared/*       browser-safe modules shared with the UI (constants, errors, format)
 *   /vendor/*       Chart.js + Leaflet straight from node_modules (no CDN needed)
 *   /*              the web front end (web/), plain static files
 *
 * @param {{ db: import("./db/pg.js").Db, mongo: Awaited<ReturnType<typeof import("./db/mongo.js").createMongo>> }} deps
 */
export function createApp(deps) {
  const app = express();
  app.disable("x-powered-by");

  app.use(express.json({ limit: "100kb" }));
  app.use(requestLogger);

  // ---- API ----
  app.use("/api", healthRouter(deps));
  app.use("/api", browseRouter(deps));
  app.use("/api", bookingRouter(deps));
  app.use("/api", auditRouter(deps));
  app.use("/api", analyticsRouter(deps));
  app.use("/api", mapRouter(deps));
  app.use("/api", reviewsRouter(deps));
  // Unknown /api/* paths -> JSON 404 (never the HTML page)
  app.use("/api", (req, _res, next) =>
    next(new AppError("NOT_FOUND", `No API route for ${req.method} ${req.originalUrl}`)),
  );

  // ---- Front end ----
  app.use("/shared", express.static(path("../shared")));
  app.use("/vendor/chart.js", express.static(path("../node_modules/chart.js/dist")));
  app.use("/vendor/leaflet", express.static(path("../node_modules/leaflet/dist")));
  app.use(express.static(path("../web")));

  app.use(errorHandler);
  return app;
}

/** Turns every error into { error: { code, title, message, ... } } with the right status. */
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err); // e.g. an SSE stream already started
  const { status, body } = toApiError(err);
  // a real bug gets the full stack; a database outage (503) is expected and gets one line
  if (status === 500) console.error(`[api] ${req.method} ${req.originalUrl} ->`, err);
  else if (status > 500) console.warn(`[api] ${req.method} ${req.originalUrl} -> ${status} ${body.error.code} (${err?.message})`);
  res.status(status).json(body);
}

/** Minimal request log: everything at LOG_LEVEL=debug, otherwise only errors and slow calls. */
function requestLogger(req, res, next) {
  // the map stream stays open for minutes, so its duration is not a "slow request"
  if (config.logLevel === "silent" || !req.path.startsWith("/api") || req.path === "/api/map/stream") {
    return next();
  }
  const start = performance.now();
  res.on("finish", () => {
    const ms = performance.now() - start;
    if (config.logLevel === "debug" || res.statusCode >= 500 || ms > 1000) {
      console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(0)}ms`);
    }
  });
  next();
}
