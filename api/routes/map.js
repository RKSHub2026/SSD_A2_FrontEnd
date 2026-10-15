import { Router } from "express";
import { FleetQuery, NearestQuery } from "../../shared/schemas.js";
import { config } from "../config.js";
import { validate } from "../lib/validate.js";
import { fleetSnapshot, nearestVehicles, streamFleet } from "../services/map.js";

/** Map screen: Workflow 3 (nearest available), fleet markers and a live stream. */
export function mapRouter({ db, mongo }) {
  const router = Router();

  // GET /api/map/nearest?lon=&lat=&radiusMeters=&freshMinutes=&limit=
  router.get("/map/nearest", validate({ query: NearestQuery }), async (req, res) => {
    res.json(await nearestVehicles({ db, mongo }, req.valid.query));
  });

  // GET /api/map/fleet?freshMinutes=  (also the polling fallback for the stream)
  router.get("/map/fleet", validate({ query: FleetQuery }), async (req, res) => {
    res.json(await fleetSnapshot({ mongo }, req.valid.query));
  });

  // GET /api/map/stream?freshMinutes=  (text/event-stream)
  router.get("/map/stream", validate({ query: FleetQuery }), async (req, res) => {
    await streamFleet({ mongo, res, q: req.valid.query, pollMs: config.livePollMs });
  });

  return router;
}
