import { Router } from "express";
import { IdParams, ReviewListQuery, ReviewSummaryQuery } from "../../shared/schemas.js";
import { validate } from "../lib/validate.js";
import { listReviews, reviewSummary, vehicleCatalog } from "../services/reviews.js";

/** Reviews screen: Workflow 4 ($facet), the review list and the flexible catalog document. */
export function reviewsRouter({ db, mongo }) {
  const router = Router();

  // GET /api/reviews/summary?vehicleId=&from=&to=&topTags=
  router.get("/reviews/summary", validate({ query: ReviewSummaryQuery }), async (req, res) => {
    res.json(await reviewSummary({ mongo }, req.valid.query));
  });

  // GET /api/reviews?vehicleId=&rating=&page=&pageSize=
  router.get("/reviews", validate({ query: ReviewListQuery }), async (req, res) => {
    res.json(await listReviews({ db, mongo }, req.valid.query));
  });

  // GET /api/vehicles/:id/catalog
  router.get("/vehicles/:id/catalog", validate({ params: IdParams }), async (req, res) => {
    res.json(await vehicleCatalog({ mongo }, req.valid.params.id));
  });

  return router;
}
