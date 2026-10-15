import { h } from "../lib/dom.js";

/**
 * Toasts confirm what just happened ("Ride booked", "Wallet topped up").
 * Errors that need action stay inline next to the form instead; a toast
 * disappears and must never be the only place an error is shown.
 * The region is aria-live so screen readers announce new toasts.
 */
let region;

function ensureRegion() {
  if (!region) {
    region = h("div", { class: "toasts", role: "status", "aria-live": "polite" });
    document.body.append(region);
  }
  return region;
}

export function toast({ title, body, kind = "info", timeout = 5000 }) {
  const el = h(
    "div",
    { class: `toast${kind === "error" ? " toast--error" : ""}` },
    h("div", { class: "toast__body" }, h("span", { class: "toast__title" }, title), body ? h("span", {}, body) : null),
    h("button", { type: "button", class: "toast__close", "aria-label": "Dismiss", onclick: () => el.remove() }, "×"),
  );
  ensureRegion().append(el);
  if (timeout) setTimeout(() => el.remove(), timeout);
  return el;
}
