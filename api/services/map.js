/**
 * Map (Workflow 3) - MongoDB TelemetryPings + VehicleMetadata, with the
 * bookable flag checked against PostgreSQL. The pipelines match
 * mongo/02_workflow3_geonear.js; keep the two in sync.
 *
 * Ping documents: { vehicleId, isAvailable, location: GeoJSON Point
 * [lon, lat], createdAt }. vehicleId = PostgreSQL vehicles.id.
 */

const minutesAgo = (m, now = Date.now()) => new Date(now - m * 60_000);

/** Catalog fields shown next to a vehicle on the map. */
const META_LOOKUP = {
  $lookup: {
    from: "VehicleMetadata",
    localField: "_id",
    foreignField: "vehicleId",
    as: "meta",
    pipeline: [{ $project: { _id: 0, licensePlate: 1, class: 1, make: 1, model: 1 } }],
  },
};

const META_FIELDS = {
  licensePlate: { $first: "$meta.licensePlate" },
  class: { $first: "$meta.class" },
  make: { $first: "$meta.make" },
  model: { $first: "$meta.model" },
};

/** GeoJSON [lon, lat] -> { lon, lat } for Leaflet-friendly JSON. */
const toLonLat = (loc) =>
  loc?.coordinates ? { lon: loc.coordinates[0], lat: loc.coordinates[1] } : null;

/**
 * Workflow 3 pipeline: fresh pings within the radius (compound
 * { location: "2dsphere", createdAt: -1 } index), latest ping per vehicle
 * ($top), available only, nearest first, plate/class from the catalog.
 */
export function nearestPipeline({ lon, lat, radiusMeters, freshMinutes, limit }, now = Date.now()) {
  return [
    {
      $geoNear: {
        near: { type: "Point", coordinates: [lon, lat] },
        key: "location",
        distanceField: "distanceMeters",
        maxDistance: radiusMeters,
        spherical: true,
        query: { createdAt: { $gte: minutesAgo(freshMinutes, now) } },
      },
    },
    {
      $group: {
        _id: "$vehicleId",
        latest: {
          $top: {
            sortBy: { createdAt: -1 },
            output: {
              isAvailable: "$isAvailable",
              distanceMeters: "$distanceMeters",
              location: "$location",
              lastSeen: "$createdAt",
            },
          },
        },
      },
    },
    { $match: { "latest.isAvailable": true } },
    { $sort: { "latest.distanceMeters": 1 } },
    { $limit: limit },
    META_LOOKUP,
    {
      $project: {
        _id: 0,
        vehicleId: "$_id",
        ...META_FIELDS,
        distanceKm: { $round: [{ $divide: ["$latest.distanceMeters", 1000] }, 3] },
        location: "$latest.location",
        lastSeen: "$latest.lastSeen",
      },
    },
  ];
}

/**
 * Bookable right now according to PostgreSQL (the source of truth for
 * bookings): active and no REQUESTED / IN TRANSIT trip. The ping's
 * isAvailable can lag by one simulator tick, so the map shows both.
 */
async function bookableIds(db, vehicleIds) {
  if (vehicleIds.length === 0) return new Set();
  const { rows } = await db.query(
    `SELECT v.id
     FROM vehicles v
     WHERE v.id = ANY($1::uuid[])
       AND v.is_active
       AND NOT EXISTS (SELECT 1 FROM trips a
                       WHERE a.vehicle_id = v.id AND a.status IN ('REQUESTED', 'IN TRANSIT'))`,
    [vehicleIds],
  );
  return new Set(rows.map((r) => r.id));
}

/** GET /api/map/nearest */
export async function nearestVehicles({ db, mongo }, q) {
  const started = performance.now();
  const docs = await mongo.db.collection("TelemetryPings").aggregate(nearestPipeline(q)).toArray();
  const queryMs = Math.round(performance.now() - started);
  const bookable = await bookableIds(
    db,
    docs.map((d) => d.vehicleId),
  );
  return {
    origin: { lon: q.lon, lat: q.lat },
    radiusMeters: q.radiusMeters,
    freshMinutes: q.freshMinutes,
    queryMs,
    items: docs.map((d) => ({
      vehicleId: d.vehicleId,
      licensePlate: d.licensePlate ?? null,
      class: d.class ?? null,
      make: d.make ?? null,
      model: d.model ?? null,
      distanceKm: d.distanceKm,
      location: toLonLat(d.location),
      lastSeen: d.lastSeen,
      bookable: bookable.has(d.vehicleId),
    })),
  };
}

/**
 * Latest fresh ping of EVERY vehicle (available and busy) for the fleet
 * markers. $match on createdAt, then $top per vehicle.
 */
export function fleetPipeline({ freshMinutes }, now = Date.now()) {
  return [
    { $match: { createdAt: { $gte: minutesAgo(freshMinutes, now) } } },
    {
      $group: {
        _id: "$vehicleId",
        latest: {
          $top: {
            sortBy: { createdAt: -1 },
            output: { isAvailable: "$isAvailable", location: "$location", lastSeen: "$createdAt" },
          },
        },
      },
    },
    META_LOOKUP,
    {
      $project: {
        _id: 0,
        vehicleId: "$_id",
        ...META_FIELDS,
        isAvailable: "$latest.isAvailable",
        location: "$latest.location",
        lastSeen: "$latest.lastSeen",
      },
    },
    { $sort: { licensePlate: 1 } },
  ];
}

/** GET /api/map/fleet (also the payload of each stream event) */
export async function fleetSnapshot({ mongo }, q) {
  const docs = await mongo.db.collection("TelemetryPings").aggregate(fleetPipeline(q)).toArray();
  const items = docs.map((d) => ({
    vehicleId: d.vehicleId,
    licensePlate: d.licensePlate ?? null,
    class: d.class ?? null,
    make: d.make ?? null,
    model: d.model ?? null,
    isAvailable: d.isAvailable,
    location: toLonLat(d.location),
    lastSeen: d.lastSeen,
  }));
  const available = items.filter((v) => v.isAvailable).length;
  return {
    freshMinutes: q.freshMinutes,
    generatedAt: new Date().toISOString(),
    counts: { total: items.length, available, busy: items.length - available },
    items,
  };
}

/**
 * GET /api/map/stream - Server-Sent Events.
 *   event: hello  { mode: "change-stream" | "polling", intervalMs }
 *   event: fleet  same body as GET /api/map/fleet
 *   event: error  { code, message }  (the stream stays open and retries)
 *   ": ping" comment every 15 s keeps proxies from closing the connection.
 *
 * Replica set -> a change stream on TelemetryPings inserts triggers a new
 * snapshot (at most one per minGapMs). Standalone MongoDB (no change
 * streams) or a change-stream error -> poll every pollMs. If the browser
 * cannot use SSE at all, the UI polls GET /api/map/fleet itself.
 *
 * @param {{ mongo: any, res: import("node:http").ServerResponse,
 *           q: { freshMinutes: number }, pollMs: number, minGapMs?: number, heartbeatMs?: number }} opts
 */
export async function streamFleet({ mongo, res, q, pollMs, minGapMs = 1000, heartbeatMs = 15_000 }) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 5000\n\n");

  let closed = false;
  let timer = null;
  let changeStream = null;
  let lastSent = 0;
  let pending = null;

  const send = (event, data) => {
    if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const pushSnapshot = async () => {
    if (closed) return;
    lastSent = Date.now();
    try {
      send("fleet", await fleetSnapshot({ mongo }, q));
    } catch (err) {
      send("error", { code: "DB_UNAVAILABLE", message: err.message });
    }
  };

  /** Coalesces bursts of inserts (one tick = one ping per vehicle). */
  const schedule = () => {
    if (pending || closed) return;
    const wait = Math.max(0, minGapMs - (Date.now() - lastSent));
    pending = setTimeout(async () => {
      pending = null;
      await pushSnapshot();
    }, wait);
  };

  const startPolling = () => {
    if (closed || timer) return;
    timer = setInterval(pushSnapshot, pollMs);
  };

  const heartbeat = setInterval(() => !closed && res.write(": ping\n\n"), heartbeatMs);

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    if (timer) clearInterval(timer);
    if (pending) clearTimeout(pending);
    changeStream?.close().catch(() => {});
  };
  // res "close" = connection gone. (req "close" fires as soon as the request
  // has been read since Node 16, which would end the stream immediately.)
  res.on("close", cleanup);

  const useChangeStream = await mongo.isReplicaSet();
  if (closed) return cleanup;

  if (useChangeStream) {
    try {
      changeStream = mongo.db
        .collection("TelemetryPings")
        .watch([{ $match: { operationType: "insert" } }], { fullDocument: "default" });
      changeStream.on("change", schedule);
      changeStream.on("error", (err) => {
        // fall back to polling for the rest of this connection
        send("hello", { mode: "polling", intervalMs: pollMs, reason: err.message });
        changeStream?.close().catch(() => {});
        changeStream = null;
        startPolling();
      });
      send("hello", { mode: "change-stream", intervalMs: null });
    } catch (err) {
      send("hello", { mode: "polling", intervalMs: pollMs, reason: err.message });
      startPolling();
    }
  } else {
    send("hello", { mode: "polling", intervalMs: pollMs });
    startPolling();
  }

  await pushSnapshot();
  return cleanup;
}
