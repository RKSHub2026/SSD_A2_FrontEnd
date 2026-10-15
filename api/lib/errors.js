import { z } from "zod";
import { API_ERRORS, DB_ERRORS, errorInfo, isDbErrorCode } from "../../shared/errors.js";

/** An error the API raises on purpose (validation, not found, ...). */
export class AppError extends Error {
  /**
   * @param {string} code  key of API_ERRORS or DB_ERRORS
   * @param {string} [message]
   * @param {Record<string, unknown>} [extra]  extra fields for the error body (title, detail, ...)
   */
  constructor(code, message, extra = {}) {
    super(message ?? errorInfo(code).message);
    this.name = "AppError";
    this.code = code;
    this.extra = extra;
  }
}

export const notFound = (what) =>
  new AppError("NOT_FOUND", `${what} was not found.`, { title: `${what} not found` });

const isPgError = (e) =>
  typeof e === "object" && e !== null && typeof e.code === "string" && "severity" in e;

const CONNECTION_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "ECONNRESET",
  "57P01", // admin_shutdown
  "57P03", // cannot_connect_now
  "08000",
  "08001",
  "08003",
  "08006",
]);

/**
 * Converts anything thrown into { status, body }.
 * Order: validation -> our own errors -> PostgreSQL -> infrastructure -> Express -> fallback.
 */
export function toApiError(err) {
  // 1. Zod validation
  if (err instanceof z.ZodError) {
    const flat = z.flattenError(err);
    const first = Object.entries(flat.fieldErrors)[0];
    const message = first ? `${first[0]}: ${first[1][0]}` : (flat.formErrors[0] ?? API_ERRORS.VALIDATION.message);
    return build("VALIDATION", { message, fieldErrors: flat.fieldErrors });
  }

  // 2. Raised by our code
  if (err instanceof AppError) return build(err.code, { message: err.message, ...err.extra });

  // 3. PostgreSQL (custom RS SQLSTATEs from the procedures, constraints, ...)
  if (isPgError(err)) {
    if (isDbErrorCode(err.code)) {
      return build(err.code, {
        detail: err.detail,
        hint: err.hint,
        constraint: err.constraint,
        dbMessage: err.message,
      });
    }
    if (CONNECTION_CODES.has(err.code)) return build("DB_UNAVAILABLE");
    if (["23505", "23503", "23514"].includes(err.code)) {
      return build("CONFLICT", { message: err.detail ?? err.message, constraint: err.constraint, dbMessage: err.message });
    }
    if (["22P02", "22007", "22008"].includes(err.code)) return build("VALIDATION", { message: err.message });
  }

  // 4. Infrastructure: connection refused, Mongo server selection, pool timeout
  if (
    (err?.code && CONNECTION_CODES.has(err.code)) ||
    err?.name === "MongoServerSelectionError" ||
    err?.name === "MongoNotConnectedError" ||
    /timeout exceeded when trying to connect/i.test(err?.message ?? "")
  ) {
    return build("DB_UNAVAILABLE");
  }

  // 5. Express / body-parser (malformed JSON, payload too large)
  const status = err?.status ?? err?.statusCode;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return {
      status,
      body: {
        error: {
          code: status === 404 ? "NOT_FOUND" : "VALIDATION",
          title: status === 404 ? "Not found" : "Bad request",
          message: err.type === "entity.parse.failed" ? "The request body is not valid JSON." : (err.message ?? "Bad request"),
        },
      },
    };
  }

  return build("INTERNAL");
}

function build(code, extra = {}) {
  const info = isDbErrorCode(code) ? DB_ERRORS[code] : errorInfo(code);
  const clean = Object.fromEntries(
    Object.entries(extra).filter(([, v]) => v !== undefined && v !== null && v !== ""),
  );
  return { status: info.status, body: { error: { code, title: info.title, message: info.message, ...clean } } };
}
