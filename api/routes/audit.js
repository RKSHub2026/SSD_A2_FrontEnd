import { Router } from "express";
import { AuditQuery, IdParams } from "../../shared/schemas.js";
import { validate } from "../lib/validate.js";
import { attemptAuditDelete, listRiderAudit } from "../services/audit.js";

/** Audit trail screen: one rider's wallet history, and proof that it is append-only. */
export function auditRouter({ db }) {
  const router = Router();

  // GET /api/riders/:id/audit?from=&to=&action=&order=&page=&pageSize=
  router.get(
    "/riders/:id/audit",
    validate({ params: IdParams, query: AuditQuery }),
    async (req, res) => {
      res.json(await listRiderAudit(db, req.valid.params.id, req.valid.query));
    },
  );

  // DELETE /api/audit/:id -> always 403 RS010 (the trigger blocks it; rolled back regardless)
  router.delete("/audit/:id", validate({ params: IdParams }), async (req, res) => {
    await attemptAuditDelete(db, req.valid.params.id);
    res.status(204).end(); // not reached while the guard exists
  });

  return router;
}
