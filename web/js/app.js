import { actorSwitcher } from "./components/actor.js";
import { healthBadge } from "./components/health.js";
import { toast } from "./components/toast.js";
import { $, h, mount } from "./lib/dom.js";
import { fallback, onRoute, route, start } from "./lib/router.js";
import { refreshActor } from "./lib/store.js";
import { notFoundScreen } from "./screens/not-found.js";
import { placeholder } from "./screens/placeholder.js";
import { styleguideScreen } from "./screens/styleguide.js";

/**
 * App entry: header (nav, health badge, actor switcher), routes, start.
 * Screens live in screens/; each exports { title, nav, render(ctx) }.
 */

// Main navigation, in the order of the demo: look around, book, check the
// money trail, then the analytics and MongoDB screens.
const NAV = [
  { id: "browse", label: "Browse", href: "#/browse" },
  { id: "book", label: "Book a ride", href: "#/book" },
  { id: "audit", label: "Audit trail", href: "#/audit" },
  { id: "analytics", label: "Analytics", href: "#/analytics" },
  { id: "map", label: "Map", href: "#/map" },
  { id: "reviews", label: "Reviews", href: "#/reviews" },
];

// Phase 4 and 5 replace these placeholders with the real screens.
const browse = placeholder({
  nav: "browse",
  title: "Browse",
  description: "Riders, vehicles and trips, with search, filters and detail views.",
  phase: 4,
  endpoints: ["GET /api/riders", "GET /api/vehicles", "GET /api/trips", "GET /api/…/:id"],
});
const book = placeholder({
  nav: "book",
  title: "Book a ride",
  description: "Book a ride for the selected rider, move it through its statuses, top up the wallet.",
  phase: 4,
  needsActor: true,
  endpoints: ["POST /api/trips", "PATCH /api/trips/:id/status", "POST /api/riders/:id/top-up"],
});
const audit = placeholder({
  nav: "audit",
  title: "Audit trail",
  description: "Every wallet change of the selected rider, with the running balance.",
  phase: 4,
  needsActor: true,
  endpoints: ["GET /api/riders/:id/audit", "DELETE /api/audit/:id"],
});
const analytics = placeholder({
  nav: "analytics",
  title: "Analytics",
  description: "7-day moving average of revenue per vehicle, daily ranking and lifetime vehicle stats.",
  phase: 5,
  endpoints: ["GET /api/analytics/moving-average", "GET /api/analytics/vehicle-stats", "POST /api/analytics/vehicle-stats/refresh"],
});
const map = placeholder({
  nav: "map",
  title: "Map",
  description: "Nearest available vehicles around a pickup point, with the live fleet.",
  phase: 5,
  endpoints: ["GET /api/map/nearest", "GET /api/map/fleet", "GET /api/map/stream"],
});
const reviews = placeholder({
  nav: "reviews",
  title: "Reviews",
  description: "Rating distribution, common feedback and each vehicle's catalog document.",
  phase: 5,
  endpoints: ["GET /api/reviews/summary", "GET /api/reviews", "GET /api/vehicles/:id/catalog"],
});

route("/", { redirect: "/browse" });
route("/browse", browse);
route("/browse/:tab", browse);
route("/browse/:tab/:id", browse);
route("/book", book);
route("/audit", audit);
route("/analytics", analytics);
route("/map", map);
route("/reviews", reviews);
route("/styleguide", styleguideScreen);
fallback(notFoundScreen);

// ---------------------------------------------------------------- header
const navEl = $("#nav");
mount(navEl, NAV.map((n) => h("a", { href: n.href, dataset: { nav: n.id } }, n.label)));
onRoute(({ screen }) => {
  for (const a of navEl.querySelectorAll("a")) {
    if (a.dataset.nav === screen?.nav) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
});

mount($("#header-tools"), healthBadge(), actorSwitcher());

// The stored rider may be gone after a re-seed; refresh the balance too.
refreshActor().then((result) => {
  if (result === "missing") {
    toast({ title: "Rider not found", body: "The rider you were acting as no longer exists. Choose another one.", kind: "error" });
  }
});

start($("#main"));
