import { notFound } from "../lib/errors.js";
import { offsetOf, paginate } from "../lib/sql.js";

/**
 * Reviews (Workflow 4) and the flexible vehicle catalog - MongoDB.
 * The $facet pipeline matches mongo/03_workflow4_facet.js; keep the two in
 * sync. Review documents: { vehicleId, riderId, rating 1-5, feedback_tags[],
 * driver_feedback, createdAt }.
 */

/** Optional vehicle / date filter BEFORE $facet (stages inside $facet cannot use indexes). */
function reviewMatch({ vehicleId, from, to, rating }) {
  const match = {};
  if (vehicleId) match.vehicleId = vehicleId;
  if (rating) match.rating = rating;
  if (from || to) {
    match.createdAt = {};
    if (from) match.createdAt.$gte = new Date(`${from}T00:00:00Z`);
    // `to` is inclusive: everything before the next midnight (UTC)
    if (to) match.createdAt.$lt = new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000);
  }
  return match;
}

/** Workflow 4 pipeline: rating distribution (always 5 buckets), top tags, average. */
export function summaryPipeline(q) {
  return [
    { $match: reviewMatch(q) },
    {
      $facet: {
        rating_distribution: [{ $group: { _id: "$rating", count: { $sum: 1 } } }, { $sort: { _id: -1 } }],
        common_feedback: [
          { $unwind: "$feedback_tags" },
          { $group: { _id: "$feedback_tags", total_occurrences: { $sum: 1 } } },
          { $sort: { total_occurrences: -1, _id: 1 } },
          { $limit: q.topTags },
        ],
        overall_average_rating: [
          { $group: { _id: null, average_rating: { $avg: "$rating" }, total_reviews: { $sum: 1 } } },
          { $project: { _id: 0, average_rating: { $round: ["$average_rating", 3] }, total_reviews: 1 } },
        ],
      },
    },
    {
      $set: {
        rating_distribution: {
          $map: {
            input: [5, 4, 3, 2, 1],
            as: "star",
            in: {
              _id: "$$star",
              count: {
                $ifNull: [
                  {
                    $first: {
                      $map: {
                        input: {
                          $filter: { input: "$rating_distribution", cond: { $eq: ["$$this._id", "$$star"] } },
                        },
                        in: "$$this.count",
                      },
                    },
                  },
                  0,
                ],
              },
            },
          },
        },
      },
    },
  ];
}

/** GET /api/reviews/summary */
export async function reviewSummary({ mongo }, q) {
  const started = performance.now();
  const [doc] = await mongo.db.collection("TripReviews").aggregate(summaryPipeline(q)).toArray();
  const queryMs = Math.round(performance.now() - started);
  const overall = doc?.overall_average_rating?.[0];
  return {
    filters: { vehicleId: q.vehicleId ?? null, from: q.from ?? null, to: q.to ?? null },
    queryMs,
    totalReviews: overall?.total_reviews ?? 0,
    averageRating: overall?.average_rating ?? null,
    ratingDistribution: (doc?.rating_distribution ?? [5, 4, 3, 2, 1].map((s) => ({ _id: s, count: 0 }))).map(
      (b) => ({ rating: b._id, count: b.count }),
    ),
    commonFeedback: (doc?.common_feedback ?? []).map((t) => ({ tag: t._id, count: t.total_occurrences })),
  };
}

/**
 * GET /api/reviews - newest first. Plates come from VehicleMetadata and
 * rider names from PostgreSQL, one query each for the ids on the page.
 */
export async function listReviews({ db, mongo }, q) {
  const reviews = mongo.db.collection("TripReviews");
  const match = reviewMatch(q);
  const unfiltered = Object.keys(match).length === 0;

  const [docs, total] = await Promise.all([
    reviews
      // sort on createdAt alone so the createdAt / vehicleId_createdAt index provides the order
      .find(match, { sort: { createdAt: -1 }, skip: offsetOf(q.page, q.pageSize), limit: q.pageSize })
      .toArray(),
    unfiltered ? reviews.estimatedDocumentCount() : reviews.countDocuments(match),
  ]);

  const vehicleIds = [...new Set(docs.map((d) => d.vehicleId))];
  const riderIds = [...new Set(docs.map((d) => d.riderId).filter(Boolean))];
  const [metas, riders] = await Promise.all([
    vehicleIds.length
      ? mongo.db
          .collection("VehicleMetadata")
          .find({ vehicleId: { $in: vehicleIds } }, { projection: { _id: 0, vehicleId: 1, licensePlate: 1, class: 1 } })
          .toArray()
      : [],
    riderIds.length
      ? db.query("SELECT id, name FROM riders WHERE id = ANY($1::uuid[])", [riderIds]).then((r) => r.rows)
      : [],
  ]);
  const plateOf = new Map(metas.map((m) => [m.vehicleId, m]));
  const nameOf = new Map(riders.map((r) => [r.id, r.name]));

  const items = docs.map((d) => ({
    id: String(d._id),
    vehicleId: d.vehicleId,
    licensePlate: plateOf.get(d.vehicleId)?.licensePlate ?? null,
    vehicleClass: plateOf.get(d.vehicleId)?.class ?? null,
    riderId: d.riderId ?? null,
    riderName: nameOf.get(d.riderId) ?? null,
    rating: d.rating,
    tags: d.feedback_tags ?? [],
    driverFeedback: d.driver_feedback ?? null,
    createdAt: d.createdAt,
  }));
  return paginate(items, total, q.page, q.pageSize);
}

/**
 * GET /api/vehicles/:id/catalog - the VehicleMetadata document as stored.
 * Its shape differs per vehicle (specs depend on class and fuel type,
 * inspectionHistory is a nested array), which is the point of keeping it
 * in MongoDB.
 */
export async function vehicleCatalog({ mongo }, vehicleId) {
  const doc = await mongo.db.collection("VehicleMetadata").findOne({ vehicleId }, { projection: { _id: 0 } });
  if (!doc) throw notFound("Vehicle catalog entry");
  return doc;
}
