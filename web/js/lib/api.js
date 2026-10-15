import { API_ERRORS, errorInfo } from "/shared/errors.js";

/**
 * Fetch wrapper for the RideSync API.
 * - Success: resolves with the parsed JSON body (or null for 204).
 * - Failure: rejects with ApiError, built from the API's
 *   { error: { code, title, message, ... } } body, or NETWORK when the
 *   server cannot be reached. Aborted requests reject with the original
 *   AbortError so screens can ignore them (see isAbort).
 */
export class ApiError extends Error {
  constructor(status, body) {
    const info = errorInfo(body?.code);
    super(body?.message ?? info.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body?.code ?? "INTERNAL";
    this.title = body?.title ?? info.title;
    this.detail = body?.detail;
    this.hint = body?.hint;
    this.constraint = body?.constraint;
    this.dbMessage = body?.dbMessage;
    this.fieldErrors = body?.fieldErrors ?? null;
  }
}

export const isAbort = (err) => err?.name === "AbortError";

/** Drops undefined / null / "" so they never reach the query string. */
export function toQuery(params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

async function request(method, path, { query, body, signal } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}${toQuery(query)}`, {
      method,
      signal,
      headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (isAbort(err)) throw err;
    throw new ApiError(0, { code: "NETWORK", ...API_ERRORS.NETWORK });
  }
  if (res.status === 204) return null;
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* not JSON (proxy error page, server crashed mid-response) */
  }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? { code: res.status >= 500 ? "INTERNAL" : "VALIDATION" });
  return data;
}

export const api = {
  get: (path, query, opts) => request("GET", path, { ...opts, query }),
  post: (path, body, opts) => request("POST", path, { ...opts, body: body ?? {} }),
  patch: (path, body, opts) => request("PATCH", path, { ...opts, body }),
  del: (path, opts) => request("DELETE", path, opts),
};
