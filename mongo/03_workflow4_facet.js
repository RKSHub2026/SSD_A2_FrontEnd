// ============================================================
// RideSync - Workflow 4: Multi-faceted review analytics ($facet)
// Run:  mongosh --quiet --file mongo/03_workflow4_facet.js
// ============================================================
// A2 changes vs A1 (the A1 pipeline logic was correct and is kept):
//   * Runs on ridesync_db and prints its result (A1 printed nothing with --file).
//   * Optional $match before $facet (one vehicle and/or a date range) so the
//     Reviews screen can filter. It uses the vehicleId_createdAt / createdAt
//     indexes. Note: stages INSIDE $facet can never use indexes.
//   * The rating distribution always has all 5 buckets (0 if none), and the
//     summary facet also returns the review count.
// ============================================================

db = db.getSiblingDB("ridesync_db");

// ---- optional filters (the API passes these; null = no filter) ----
const vehicleId = null;          // e.g. "<PostgreSQL vehicle uuid>"
const fromDate = null;           // e.g. new Date("2026-09-01")
const toDate = null;
const topTagLimit = 10;

const match = {};
if (vehicleId) match.vehicleId = vehicleId;
if (fromDate || toDate) {
  match.createdAt = {};
  if (fromDate) match.createdAt.$gte = fromDate;
  if (toDate) match.createdAt.$lt = toDate;
}

const pipeline = [
  { $match: match },
  {
    $facet: {
      // 1. rating distribution (1-5 stars)
      rating_distribution: [
        { $group: { _id: "$rating", count: { $sum: 1 } } },
        { $sort: { _id: -1 } }
      ],
      // 2. most frequent feedback tags ($unwind)
      common_feedback: [
        { $unwind: "$feedback_tags" },
        { $group: { _id: "$feedback_tags", total_occurrences: { $sum: 1 } } },
        { $sort: { total_occurrences: -1, _id: 1 } },
        { $limit: topTagLimit }
      ],
      // 3. overall average rating
      overall_average_rating: [
        {
          $group: {
            _id: null,
            average_rating: { $avg: "$rating" },
            total_reviews: { $sum: 1 }
          }
        },
        {
          $project: {
            _id: 0,
            average_rating: { $round: ["$average_rating", 3] },
            total_reviews: 1
          }
        }
      ]
    }
  },
  // fill missing star buckets with 0 so charts always show 5 bars
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
                        $filter: { input: "$rating_distribution", cond: { $eq: ["$$this._id", "$$star"] } }
                      },
                      in: "$$this.count"
                    }
                  }
                },
                0
              ]
            }
          }
        }
      }
    }
  }
];

const result = db.TripReviews.aggregate(pipeline).toArray()[0];
printjson(result);
