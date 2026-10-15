/**
 * Error catalogue shared by the API and the UI (browser-safe, no imports).
 *
 * RS001-RS010 are the custom SQLSTATEs raised by the stored procedures and
 * triggers (sql/03, sql/04). The API turns a PostgreSQL error into
 *   { error: { code, title, message, detail?, hint?, constraint?, dbMessage?, fieldErrors? } }
 * using this table; the UI shows title + message, and for RS006/RS007 also
 * names the partial unique index that fired.
 *
 * @typedef {{ status: number, title: string, message: string }} ErrorInfo
 */

/** @type {Record<string, ErrorInfo>} */
export const DB_ERRORS = {
  RS001: {
    status: 404,
    title: "Rider not found",
    message: "This rider does not exist any more. Pick another rider in the switcher.",
  },
  RS002: {
    status: 404,
    title: "Vehicle not found",
    message: "This vehicle does not exist. Choose a vehicle from the list.",
  },
  RS003: {
    status: 409,
    title: "Vehicle out of service",
    message: "This vehicle is marked inactive and cannot take bookings. Choose another vehicle.",
  },
  RS004: {
    status: 409,
    title: "Insufficient wallet balance",
    message:
      "The fare is more than the rider's wallet balance, so nothing was charged and no trip was created. Top up the wallet or lower the fare.",
  },
  RS005: {
    status: 400,
    title: "Invalid amount",
    message: "The amount must be greater than zero.",
  },
  RS006: {
    status: 409,
    title: "Rider already has an active trip",
    message:
      "A rider can only have one trip that is REQUESTED or IN TRANSIT. Complete the current trip first, then book again.",
  },
  RS007: {
    status: 409,
    title: "Vehicle is busy",
    message: "This vehicle is already serving an active trip. Choose another vehicle.",
  },
  RS008: {
    status: 404,
    title: "Trip not found",
    message: "This trip does not exist.",
  },
  RS009: {
    status: 409,
    title: "Status change not allowed",
    message: "Trips move forward only: REQUESTED → IN TRANSIT → COMPLETED.",
  },
  RS010: {
    status: 403,
    title: "Audit log is read-only",
    message: "Wallet audit entries can never be edited or deleted.",
  },
};

/** Non-database error codes produced by the API itself. @type {Record<string, ErrorInfo>} */
export const API_ERRORS = {
  VALIDATION: { status: 400, title: "Invalid input", message: "Some fields are missing or invalid." },
  NOT_FOUND: { status: 404, title: "Not found", message: "The requested record does not exist." },
  CONFLICT: { status: 409, title: "Conflict", message: "The request conflicts with the current data." },
  DB_UNAVAILABLE: {
    status: 503,
    title: "Database unavailable",
    message: "The server cannot reach the database right now. Check that PostgreSQL and MongoDB are running.",
  },
  INTERNAL: {
    status: 500,
    title: "Something went wrong",
    message: "An unexpected error happened on the server. Try again.",
  },
  NETWORK: {
    status: 0,
    title: "Cannot reach the server",
    message: "The API did not respond. Check that `npm run dev` is running.",
  },
};

/** @param {unknown} code */
export const isDbErrorCode = (code) => typeof code === "string" && Object.hasOwn(DB_ERRORS, code);

/** @param {string} code @returns {ErrorInfo} */
export function errorInfo(code) {
  if (isDbErrorCode(code)) return DB_ERRORS[code];
  return API_ERRORS[code] ?? API_ERRORS.INTERNAL;
}
