import { Router } from "express";
import { MovingAvgQuery, RankingQuery, VehicleStatsQuery } from "../../shared/schemas.js";
import { validate } from "../lib/validate.js";
import {
  dailyRanking,
  movingAverage,
  overview,
  refreshVehicleStats,
  vehicleStats,
} from "../services/analytics.js";

/** Analytics screen: Workflow 2 (window functions) and the materialized view. */
export function analyticsRouter({ db }) {
  const router = Router();

  // GET /api/analytics/overview
  router.get("/analytics/overview", async (_req, res) => {
    res.json(await overview(db));
  });

  // GET /api/analytics/moving-average?from=&to=&vehicleId=&topN=
  router.get("/analytics/moving-average", validate({ query: MovingAvgQuery }), async (req, res) => {
    res.json(await movingAverage(db, req.valid.query));
  });

  // GET /api/analytics/ranking?date=&limit=
  router.get("/analytics/ranking", validate({ query: RankingQuery }), async (req, res) => {
    res.json(await dailyRanking(db, req.valid.query));
  });

  // GET /api/analytics/vehicle-stats?sort=&order=&page=&pageSize=
  router.get("/analytics/vehicle-stats", validate({ query: VehicleStatsQuery }), async (req, res) => {
    res.json(await vehicleStats(db, req.valid.query));
  });

  // POST /api/analytics/vehicle-stats/refresh -> REFRESH MATERIALIZED VIEW CONCURRENTLY
  router.post("/analytics/vehicle-stats/refresh", async (_req, res) => {
    res.json(await refreshVehicleStats(db));
  });

  return router;
}
