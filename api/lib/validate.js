/**
 * Express middleware: validates req.params / req.query / req.body with Zod
 * schemas from shared/schemas.js and stores the parsed (typed, defaulted)
 * values on req.valid. Invalid input throws a ZodError, which the error
 * middleware turns into a 400 with per-field messages.
 *
 *   router.get("/trips", validate({ query: TripListQuery }), handler)
 *   -> handler reads req.valid.query
 *
 * (Express 5 makes req.query read-only, hence req.valid.)
 */
export const validate =
  ({ params, query, body } = {}) =>
  (req, _res, next) => {
    req.valid = {
      params: params ? params.parse(req.params) : req.params,
      query: query ? query.parse(req.query ?? {}) : req.query,
      body: body ? body.parse(req.body ?? {}) : req.body,
    };
    next();
  };
