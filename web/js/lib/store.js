import { api, ApiError } from "./api.js";
import { storage } from "./dom.js";

/**
 * The actor: which rider the operator is acting for. There is no login in
 * this project, so the header's switcher picks a rider; Book a ride and the
 * Audit trail use it. null = operator view (no rider selected).
 *
 * Stored as { id, name, walletBalance } in localStorage so it survives
 * reloads; the balance is re-read from the API on start and after every
 * wallet change (refreshActor).
 */
const KEY = "ridesync.actor";
let actor = storage.get(KEY);
const listeners = new Set();

export const getActor = () => actor;

export function setActor(next) {
  actor = next ? { id: next.id, name: next.name, walletBalance: next.walletBalance } : null;
  storage.set(KEY, actor);
  for (const fn of listeners) fn(actor);
}

/** Subscribe; returns an unsubscribe function (call it in screen cleanup). */
export function onActorChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Re-reads the actor from the API (balance after a booking or top-up).
 * Returns "missing" if the stored rider no longer exists (the database was
 * re-seeded), "ok" otherwise. Network errors keep the cached value.
 */
export async function refreshActor() {
  if (!actor) return "ok";
  try {
    const r = await api.get(`/riders/${actor.id}`);
    setActor(r);
    return "ok";
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.code === "VALIDATION")) {
      setActor(null);
      return "missing";
    }
    return "ok";
  }
}
