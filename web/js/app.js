import { actorSwitcher } from "./components/actor.js";
import { healthBadge } from "./components/health.js";
import { toast } from "./components/toast.js";
import { $, h, mount } from "./lib/dom.js";
import { fallback, onRoute, route, start } from "./lib/router.js";
import { refreshActor } from "./lib/store.js";
import { analyticsScreen } from "./screens/analytics.js";
import { auditScreen } from "./screens/audit.js";
import { bookScreen } from "./screens/book.js";
import { browseScreen } from "./screens/browse.js";
import { mapScreen } from "./screens/map.js";
import { notFoundScreen } from "./screens/not-found.js";
import { reviewsScreen } from "./screens/reviews.js";
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

route("/", { redirect: "/browse" });
route("/browse", browseScreen);
route("/browse/:tab", browseScreen);
route("/browse/:tab/:id", browseScreen);
route("/book", bookScreen);
route("/audit", auditScreen);
route("/analytics", analyticsScreen);
route("/map", mapScreen);
route("/reviews", reviewsScreen);
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
