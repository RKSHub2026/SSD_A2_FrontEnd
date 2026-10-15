import { Router } from "express";
import { IdParams, RiderListQuery, TripListQuery, VehicleListQuery } from "../../shared/schemas.js";
import { notFound } from "../lib/errors.js";
import { validate } from "../lib/validate.js";
import { getRider, listRiders } from "../services/riders.js";
import { getTrip, listTrips } from "../services/trips.js";
import { getVehicle, listVehicles } from "../services/vehicles.js";

/**
 * Browse screen: riders, vehicles and trips - paginated lists + detail views.
 * Lists return { items, page, pageSize, total, totalPages }.
 */
export function browseRouter({ db }) {
  const router = Router();

  // GET /api/riders?q=&sort=name|wallet_balance&order=&page=&pageSize=
  router.get("/riders", validate({ query: RiderListQuery }), async (req, res) => {
    res.json(await listRiders(db, req.valid.query));
  });

  // GET /api/riders/:id - wallet, active trip, lifetime stats, last wallet change
  router.get("/riders/:id", validate({ params: IdParams }), async (req, res) => {
    const rider = await getRider(db, req.valid.params.id);
    if (!rider) throw notFound("Rider");
    res.json(rider);
  });

  // GET /api/vehicles?q=&class=&active=&available=&sort=&order=&page=&pageSize=
  router.get("/vehicles", validate({ query: VehicleListQuery }), async (req, res) => {
    res.json(await listVehicles(db, req.valid.query));
  });

  // GET /api/vehicles/:id - lifetime stats (mv_vehicle_stats) + current trip
  router.get("/vehicles/:id", validate({ params: IdParams }), async (req, res) => {
    const vehicle = await getVehicle(db, req.valid.params.id);
    if (!vehicle) throw notFound("Vehicle");
    res.json(vehicle);
  });

  // GET /api/trips?status=&active=&riderId=&vehicleId=&from=&to=&order=&page=&pageSize=
  router.get("/trips", validate({ query: TripListQuery }), async (req, res) => {
    res.json(await listTrips(db, req.valid.query));
  });

  // GET /api/trips/:id - trip + the wallet_audit_logs rows linked to it
  router.get("/trips/:id", validate({ params: IdParams }), async (req, res) => {
    const trip = await getTrip(db, req.valid.params.id);
    if (!trip) throw notFound("Trip");
    res.json(trip);
  });

  return router;
}
