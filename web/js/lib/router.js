/**
 * Hash router: #/path/with/:params?query=string
 *
 *   route("/browse/riders/:id", screen)   // screen = { title, nav, render(ctx) }
 *   start(outlet)
 *
 * render(ctx) receives { params, query, signal, outlet, navigate, setQuery }
 * and may return a cleanup function. `signal` is aborted when the user
 * leaves the screen, so pending fetches are cancelled instead of painting
 * into the next screen. Hash URLs need no server routing and every screen
 * state that matters (filters, page, selected tab) lives in the query
 * string, so it survives reloads and can be shared.
 */
const routes = [];
let notFound = null;
let current = { cleanup: null, controller: null };
let outletEl = null;
const listeners = new Set();

export function route(pattern, screen) {
  const keys = [];
  const re = new RegExp(
    `^${pattern.replace(/\/:([a-zA-Z]+)/g, (_m, key) => {
      keys.push(key);
      return "/([^/]+)";
    })}/?$`,
  );
  routes.push({ pattern, re, keys, screen });
}

export function fallback(screen) {
  notFound = screen;
}

/** Parses the current hash into { path, query }. */
export function location() {
  const raw = window.location.hash.replace(/^#/, "") || "/";
  const [path, qs = ""] = raw.split("?");
  return { path: path || "/", query: Object.fromEntries(new URLSearchParams(qs)) };
}

export function href(path, query = {}) {
  const q = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  const s = q.toString();
  return `#${path}${s ? `?${s}` : ""}`;
}

export function navigate(path, query = {}, { replace = false } = {}) {
  const target = href(path, query);
  if (target === window.location.hash) return render();
  if (replace) {
    history.replaceState(null, "", target);
    render();
  } else {
    window.location.hash = target;
  }
}

/** Merges into the current query (page, filters) - one history entry. */
export function setQuery(patch, opts) {
  const { path, query } = location();
  navigate(path, { ...query, ...patch }, opts);
}

/** Called after each render with { path, screen } (nav highlighting). */
export function onRoute(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function match(path) {
  for (const r of routes) {
    const m = r.re.exec(path);
    if (m) {
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      return { screen: r.screen, params };
    }
  }
  return { screen: notFound, params: {} };
}

async function render() {
  const { path, query } = location();
  const { screen, params } = match(path);

  if (screen?.redirect) return navigate(screen.redirect, query, { replace: true });

  current.controller?.abort();
  try {
    current.cleanup?.();
  } catch (err) {
    console.error("[router] cleanup failed", err);
  }
  const controller = new AbortController();
  current = { cleanup: null, controller };

  outletEl.replaceChildren();
  document.title = screen?.title ? `${screen.title} - RideSync` : "RideSync";
  for (const fn of listeners) fn({ path, screen });

  try {
    const cleanup = await screen.render({ params, query, path, signal: controller.signal, outlet: outletEl, navigate, setQuery });
    if (controller.signal.aborted) cleanup?.();
    else current.cleanup = typeof cleanup === "function" ? cleanup : null;
  } catch (err) {
    if (err?.name !== "AbortError") throw err;
  }

  // Move focus to the new page heading so keyboard and screen-reader users
  // land on the new content (only after real navigations, not first load).
  if (render.count++ > 0) {
    const heading = outletEl.querySelector("h1");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }
    window.scrollTo({ top: 0 });
  }
}
render.count = 0;

export function start(outlet) {
  outletEl = outlet;
  window.addEventListener("hashchange", render);
  return render();
}
