/**
 * Loads Chart.js and Leaflet on demand from /vendor (served by Express
 * straight from node_modules, see api/app.js). Each loader resolves with the
 * library's global, or rejects - screens then fall back (charts become
 * tables, the map becomes a list), so a missing library never blanks a page.
 */
const scripts = new Map();

function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(
      src,
      new Promise((resolve, reject) => {
        const el = document.createElement("script");
        el.src = src;
        el.async = true;
        el.onload = resolve;
        el.onerror = () => {
          el.remove();
          scripts.delete(src);
          reject(new Error(`Could not load ${src}`));
        };
        document.head.append(el);
      }),
    );
  }
  return scripts.get(src);
}

/** Resolves once the stylesheet has loaded (or failed - the caller carries on). */
function loadCss(href) {
  const existing = document.querySelector(`link[href="${href}"]`);
  if (existing) return existing.dataset.loaded ? Promise.resolve() : new Promise((r) => existing.addEventListener("load", r, { once: true }));
  return new Promise((resolve) => {
    const link = Object.assign(document.createElement("link"), { rel: "stylesheet", href });
    link.onload = () => {
      link.dataset.loaded = "1";
      resolve();
    };
    link.onerror = () => resolve();
    document.head.append(link);
  });
}

/** Chart.js 4 UMD build (file name differs between minor versions). */
export async function loadChart() {
  if (window.Chart) return window.Chart;
  for (const file of ["chart.umd.js", "chart.umd.min.js"]) {
    try {
      await loadScript(`/vendor/chart.js/${file}`);
      if (window.Chart) return window.Chart;
    } catch {
      /* try the next name */
    }
  }
  throw new Error("Chart.js is not available. Run npm install, then reload.");
}

/**
 * Leaflet 1.9 (global L) and its stylesheet. The CSS must be loaded before a
 * map is created: Leaflet measures the container and positions tiles with
 * it, and a map built without it shows scattered or missing tiles.
 */
export async function loadLeaflet() {
  const css = loadCss("/vendor/leaflet/leaflet.css");
  if (window.L?.map) {
    await css;
    return window.L;
  }
  await Promise.all([
    css,
    loadScript("/vendor/leaflet/leaflet.js").catch(() => {
      throw new Error("Leaflet is not available. Run npm install, then reload.");
    }),
  ]);
  if (!window.L?.map) throw new Error("Leaflet did not start.");
  return window.L;
}

/**
 * Series colours for charts, validated for colour-blind separation (the
 * first five pass on their own; 6-7 rely on the plate legend + table view).
 * Plate yellow is not used: in this design it always means "a vehicle".
 */
export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#6250d6", "#e87ba4", "#008300", "#e34948"];

/** Colour follows the entity, not its rank: a vehicle keeps its colour across filter changes. */
const remembered = new Map();
export function seriesColors(ids) {
  const used = new Set();
  const out = new Map();
  for (const id of ids) {
    const prev = remembered.get(id);
    if (prev !== undefined && !used.has(prev)) {
      out.set(id, prev);
      used.add(prev);
    }
  }
  for (const id of ids) {
    if (out.has(id)) continue;
    const slot = SERIES.findIndex((_c, i) => !used.has(i));
    const i = slot === -1 ? out.size % SERIES.length : slot;
    out.set(id, i);
    used.add(i);
    remembered.set(id, i);
  }
  return new Map([...out].map(([id, i]) => [id, SERIES[i]]));
}

export const prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
