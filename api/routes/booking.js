import { Router } from "express";
import { BookTripBody, IdParams, TopUpBody, UpdateTripStatusBody } from "../../shared/schemas.js";
import { validate } from "../lib/validate.js";
import { bookTrip, topUpWallet, updateTripStatus } from "../services/booking.js";

/**
 * Workflow 1: book a ride, move it through its statuses, top up a wallet.
 * Every write goes through a stored procedure; RS001-RS009 come back as
 * { error: { code, title, message, constraint?, hint? } } with 4xx statuses.
 */
export function bookingRouter({ db }) {
  const router = Router();

  // POST /api/trips  { riderId, vehicleId, fare } -> 201 { trip, auditEntry, wallet }
  router.post("/trips", validate({ body: BookTripBody }), async (req, res) => {
    const result = await bookTrip(db, req.valid.body);
    res.status(201).location(`/api/trips/${result.trip.id}`).json(result);
  });

  // PATCH /api/trips/:id/status  { status: "IN TRANSIT" | "COMPLETED" } -> { trip, previousStatus, released }
  router.patch(
    "/trips/:id/status",
    validate({ params: IdParams, body: UpdateTripStatusBody }),
    async (req, res) => {
      res.json(await updateTripStatus(db, req.valid.params.id, req.valid.body.status));
    },
  );

  // POST /api/riders/:id/top-up  { amount } -> { riderId, walletBalance, auditEntry }
  router.post(
    "/riders/:id/top-up",
    validate({ params: IdParams, body: TopUpBody }),
    async (req, res) => {
      res.json(await topUpWallet(db, req.valid.params.id, req.valid.body.amount));
    },
  );

  return router;
}
