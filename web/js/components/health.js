import { h } from "../lib/dom.js";

/**
 * Header badge: are both databases reachable? Polls GET /api/health every
 * 30 s and immediately when the tab becomes visible again.
 *   ok        "Databases online"
 *   degraded  "MongoDB offline" / "PostgreSQL offline" (API up, one DB down)
 *   down      "API offline" (npm run dev not running)
 */
export function healthBadge({ intervalMs = 30_000 } = {}) {
  const el = h("span", { class: "health", role: "status", title: "Checking the databases" }, "Checking…");

  const set = (state, text, title) => {
    el.className = `health health--${state}`;
    el.textContent = text;
    el.title = title;
  };

  async function check() {
    let body;
    try {
      // fetch directly: a 503 here is not an error envelope, it still says which DB is down
      const res = await fetch("/api/health", { headers: { Accept: "application/json" } });
      body = await res.json();
    } catch {
      return set("down", "API offline", "The API did not respond. Is npm run dev running?");
    }
    if (body.postgres && body.mongo) {
      return set("ok", "Databases online", `PostgreSQL and MongoDB reachable. Live map: ${body.changeStreams ? "change streams" : "polling"}.`);
    }
    const down = [!body.postgres && "PostgreSQL", !body.mongo && "MongoDB"].filter(Boolean);
    set("degraded", `${down.join(" and ")} offline`, `${down.join(" and ")} cannot be reached. Screens that need it show an error.`);
  }

  check();
  const timer = setInterval(check, intervalMs);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && check());
  el.stop = () => clearInterval(timer);
  el.check = check;
  return el;
}
