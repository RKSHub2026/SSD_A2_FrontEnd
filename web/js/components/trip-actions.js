import { api } from "../lib/api.js";
import { h } from "../lib/dom.js";
import { confirmDialog } from "./dialog.js";
import { toast } from "./toast.js";
import { busy, errorAlert } from "./ui.js";

/**
 * Status buttons for one trip: only the next valid step is a primary button
 * (Start trip / Complete trip). A small "Try to skip to Completed" button on
 * REQUESTED trips shows the forward-only rule (RS009) on purpose.
 *
 *   tripActions(trip, { onChanged(result) })   // result = PATCH response
 */
const NEXT = {
  REQUESTED: { status: "IN TRANSIT", label: "Start trip", done: "Trip started" },
  "IN TRANSIT": { status: "COMPLETED", label: "Complete trip", done: "Trip completed" },
};

export function tripActions(trip, { onChanged } = {}) {
  const feedback = h("div", { class: "trip-actions__feedback" });
  const next = NEXT[trip.status];
  if (!next) return h("p", { class: "muted small" }, "This trip is completed. Trips cannot change after that.");

  async function change(status, btn, { confirm = false, label } = {}) {
    if (confirm) {
      const ok = await confirmDialog({
        title: "Complete this trip?",
        body: "The rider and the vehicle become free to book again. A completed trip cannot change.",
        confirmLabel: "Complete trip",
      });
      if (!ok) return;
    }
    feedback.replaceChildren();
    busy(btn, true);
    try {
      const result = await api.patch(`/trips/${trip.id}/status`, { status });
      toast({ title: label, body: result.released ? "The rider and the vehicle can be booked again." : null });
      onChanged?.(result);
    } catch (err) {
      feedback.replaceChildren(errorAlert(err));
    } finally {
      busy(btn, false);
    }
  }

  const primary = h("button", { type: "button", class: "btn btn--primary" }, next.label);
  primary.addEventListener("click", () => change(next.status, primary, { confirm: next.status === "COMPLETED", label: next.done }));

  let skip = null;
  if (trip.status === "REQUESTED") {
    skip = h("button", { type: "button", class: "btn btn--ghost btn--sm", title: "Shows the forward-only rule: the database rejects it (RS009)" }, "Try to skip to Completed");
    skip.addEventListener("click", () => change("COMPLETED", skip, { label: "Trip completed" }));
  }

  return h("div", { class: "trip-actions" }, h("div", { class: "row" }, primary, skip), feedback);
}
