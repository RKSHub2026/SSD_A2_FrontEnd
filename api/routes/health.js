import { Router } from "express";

/** GET /api/health - database connectivity (header badge, status checks). */
export function healthRouter({ db, mongo }) {
  const router = Router();

  router.get("/health", async (_req, res) => {
    const [postgres, mongoOk, changeStreams] = await Promise.all([
      db.ping(),
      mongo.ping(),
      mongo.isReplicaSet(),
    ]);
    const ok = postgres && mongoOk;
    res.status(ok ? 200 : 503).json({
      status: ok ? "ok" : "degraded",
      postgres,
      mongo: mongoOk,
      changeStreams, // true -> live map uses change streams, false -> polling fallback
      time: new Date().toISOString(),
    });
  });

  return router;
}
