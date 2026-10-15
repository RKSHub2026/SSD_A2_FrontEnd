import { MAP_DEFAULTS, MAP_ORIGINS } from "/shared/constants.js";
import { formatInt, formatKm, formatRelative } from "/shared/format.js";
import { empty, errorAlert, field, notice, pageHeader, plate, select, skeleton } from "../components/ui.js";
import { api, isAbort } from "../lib/api.js";
import { h } from "../lib/dom.js";
import { href, setQuery } from "../lib/router.js";
import { loadLeaflet } from "../lib/vendor.js";

/**
 * Map (Workflow 3): nearest available vehicles around a pickup point.
 *   - origin: a preset, or click the map; radius 5 km by default
 *   - GET /api/map/nearest  -> the $geoNear pipeline, list sorted by distance
 *   - GET /api/map/stream   -> live fleet (server-sent events); if the stream
 *     fails three times, the page polls GET /api/map/fleet instead
 * Without Leaflet (not installed / blocked), the list and live counts still work.
 */
const RADII = [1000, 2000, 5000, 10000];
const POLL_FALLBACK_MS = 5000;
const NEAREST_MIN_GAP_MS = 2500;

export const mapScreen = {
  nav: "map",
  title: "Map",
  render(ctx) {
    const q = ctx.query;
    const preset = MAP_ORIGINS.find((o) => o.id === q.origin);
    const state = {
      originId: preset ? preset.id : q.lon && q.lat ? "custom" : MAP_ORIGINS[0].id,
      lon: preset?.lon ?? (Number(q.lon) || MAP_ORIGINS[0].lon),
      lat: preset?.lat ?? (Number(q.lat) || MAP_ORIGINS[0].lat),
      radius: RADII.includes(Number(q.radius)) ? Number(q.radius) : MAP_DEFAULTS.radiusMeters,
    };
    let closed = false;
    let L = null;
    let map = null;
    let circle = null;
    let pin = null;
    let fleetLayer = null;
    let nearestLayer = null;
    const fleetMarkers = new Map();
    let es = null;
    let pollTimer = null;
    let streamFailures = 0;
    let nearestController = null;
    let lastNearest = 0;
    let nearestTimer = null;
    let fleet = null;

    // ----------------------------------------------------------- controls
    const originSelect = select(
      [...MAP_ORIGINS.map((o) => ({ value: o.id, label: o.label })), { value: "custom", label: "Point picked on the map" }],
      { value: state.originId },
    );
    originSelect.querySelector('option[value="custom"]').disabled = state.originId !== "custom";
    const radiusSelect = select(
      RADII.map((r) => ({ value: String(r), label: `${r / 1000} km` })),
      { value: String(state.radius) },
    );
    const live = h("span", { class: "live", role: "status" }, "Connecting…");
    const counts = h("p", { class: "small muted", "aria-live": "polite" });
    const mapBox = h("div", { class: "map-box", role: "region", "aria-label": "Map of vehicles around the pickup point" });
    const mapNote = h("div");
    const list = h("div", { class: "nearest" }, skeleton(5));
    const listHead = h("p", { class: "small muted" });

    originSelect.addEventListener("change", () => {
      const o = MAP_ORIGINS.find((x) => x.id === originSelect.value);
      if (o) setOrigin(o.lon, o.lat, o.id);
    });
    radiusSelect.addEventListener("change", () => {
      state.radius = Number(radiusSelect.value);
      saveQuery();
      drawOrigin(true);
      loadNearest();
    });

    function saveQuery() {
      setQuery(
        state.originId === "custom"
          ? { origin: undefined, lon: state.lon.toFixed(5), lat: state.lat.toFixed(5), radius: state.radius === 5000 ? undefined : state.radius }
          : { origin: state.originId === MAP_ORIGINS[0].id ? undefined : state.originId, lon: undefined, lat: undefined, radius: state.radius === 5000 ? undefined : state.radius },
        { silent: true },
      );
    }

    function setOrigin(lon, lat, id = "custom") {
      Object.assign(state, { lon, lat, originId: id });
      const custom = originSelect.querySelector('option[value="custom"]');
      custom.disabled = id !== "custom";
      originSelect.value = id;
      saveQuery();
      drawOrigin(id !== "custom");
      loadNearest();
    }

    // ----------------------------------------------------------- map drawing
    /**
     * The square around the pickup point that holds the whole radius. Computed
     * from the point itself: circle.getBounds() only works once the circle is
     * drawn on a map that already has a view, which is not the case at start.
     */
    const radiusBounds = () => L.latLng(state.lat, state.lon).toBounds(state.radius * 2);

    function drawOrigin(fit) {
      if (!map) return;
      const ll = [state.lat, state.lon];
      pin.setLatLng(ll);
      circle.setLatLng(ll);
      circle.setRadius(state.radius);
      if (fit) map.fitBounds(radiusBounds(), { padding: [12, 12] });
    }

    function drawFleet() {
      if (!map || !fleet) return;
      const seen = new Set();
      for (const v of fleet.items) {
        if (!v.location) continue;
        seen.add(v.vehicleId);
        const style = v.isAvailable
          ? { radius: 6, color: "#ffffff", weight: 1.5, fillColor: "#0c6e55", fillOpacity: 1 }
          : { radius: 5, color: "#535f68", weight: 2, fillColor: "#ffffff", fillOpacity: 1 };
        let m = fleetMarkers.get(v.vehicleId);
        if (!m) {
          m = L.circleMarker([v.location.lat, v.location.lon], style).addTo(fleetLayer);
          fleetMarkers.set(v.vehicleId, m);
        } else {
          m.setLatLng([v.location.lat, v.location.lon]);
          m.setStyle(style);
        }
        m.bindTooltip(`${v.licensePlate ?? "Vehicle"}: ${v.isAvailable ? "available" : "busy"}`);
      }
      for (const [id, m] of fleetMarkers) {
        if (!seen.has(id)) {
          fleetLayer.removeLayer(m);
          fleetMarkers.delete(id);
        }
      }
    }

    function drawNearest(items) {
      if (!map) return;
      nearestLayer.clearLayers();
      items.forEach((v, i) => {
        if (!v.location) return;
        L.marker([v.location.lat, v.location.lon], {
          icon: L.divIcon({ className: "nearest-pin", html: `<span>${i + 1}</span>`, iconSize: [24, 24], iconAnchor: [12, 12] }),
          title: `${i + 1}. ${v.licensePlate ?? "Vehicle"}, ${formatKm(v.distanceKm)}`,
          zIndexOffset: 1000,
        })
          .bindTooltip(`${i + 1}. ${v.licensePlate ?? "Vehicle"}, ${formatKm(v.distanceKm)}`)
          .addTo(nearestLayer);
      });
    }

    async function startMap() {
      try {
        L = await loadLeaflet();
      } catch (err) {
        mapNote.replaceChildren(notice("warn", "The map could not load", `${err.message} The list of nearest vehicles still works.`));
        mapBox.hidden = true;
        return;
      }
      if (closed) return;
      try {
        buildMap();
      } catch (err) {
        console.error("[map]", err);
        map?.remove();
        map = null;
        mapBox.hidden = true;
        mapNote.replaceChildren(notice("warn", "The map could not start", `${err.message} The list of nearest vehicles still works.`));
      }
    }

    function buildMap() {
      // a view first: layers are only drawn on a map that has a centre and zoom
      map = L.map(mapBox, { zoomControl: true, scrollWheelZoom: false }).setView([state.lat, state.lon], 13);
      let tileErrors = 0;
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      })
        .on("tileerror", () => {
          tileErrors += 1;
          if (tileErrors === 4) {
            mapNote.replaceChildren(notice("info", "Map tiles are not loading", "The street map needs an internet connection. Vehicles and the pickup point are still drawn."));
          }
        })
        .on("tileload", () => {
          if (tileErrors) mapNote.replaceChildren();
          tileErrors = 0;
        })
        .addTo(map);
      circle = L.circle([state.lat, state.lon], { radius: state.radius, color: "#1c2a33", weight: 1.5, dashArray: "6 6", fillColor: "#1c2a33", fillOpacity: 0.04, interactive: false }).addTo(map);
      pin = L.marker([state.lat, state.lon], {
        icon: L.divIcon({ className: "pickup-pin", html: "<span></span>", iconSize: [22, 22], iconAnchor: [11, 11] }),
        title: "Pickup point",
        zIndexOffset: 2000,
      })
        .bindTooltip("Pickup point")
        .addTo(map);
      fleetLayer = L.layerGroup().addTo(map);
      nearestLayer = L.layerGroup().addTo(map);
      map.on("click", (e) => setOrigin(e.latlng.lng, e.latlng.lat));
      map.fitBounds(radiusBounds(), { padding: [12, 12] });
      // the panel may still be settling (fonts, the list beside it): re-measure once
      setTimeout(() => map?.invalidateSize(), 150);
      drawFleet();
      if (lastItems) drawNearest(lastItems);
    }

    // ----------------------------------------------------------- nearest (Workflow 3)
    let lastItems = null;
    async function loadNearest() {
      clearTimeout(nearestTimer);
      nearestTimer = null;
      nearestController?.abort();
      nearestController = new AbortController();
      lastNearest = Date.now();
      try {
        const r = await api.get(
          "/map/nearest",
          { lon: state.lon.toFixed(6), lat: state.lat.toFixed(6), radiusMeters: state.radius, limit: 10 },
          { signal: nearestController.signal },
        );
        lastItems = r.items;
        listHead.textContent = `Within ${r.radiusMeters / 1000} km, seen in the last ${r.freshMinutes} min. Query took ${r.queryMs} ms.`;
        list.replaceChildren(
          r.items.length
            ? h(
                "ol",
                { class: "nearest__list" },
                r.items.map((v, i) =>
                  h(
                    "li",
                    { class: "nearest__item" },
                    h("span", { class: "nearest__rank", "aria-hidden": "true" }, i + 1),
                    h(
                      "div",
                      { class: "nearest__main" },
                      h("div", { class: "row" }, plate(v.licensePlate), h("span", { class: "small muted" }, [v.class, v.make && `${v.make} ${v.model}`].filter(Boolean).join(", "))),
                      h("span", { class: "small muted" }, `Seen ${formatRelative(v.lastSeen)}`),
                    ),
                    h(
                      "div",
                      { class: "nearest__side" },
                      h("strong", { class: "nearest__distance" }, formatKm(v.distanceKm)),
                      v.bookable
                        ? h("a", { class: "btn btn--sm btn--secondary", href: href("/book", { vehicleId: v.vehicleId }), "aria-label": `Book ${v.licensePlate}` }, "Book")
                        : h("span", { class: "small muted", title: "PostgreSQL has an active trip for it or it is out of service" }, "Just booked"),
                    ),
                  ),
                ),
              )
            : empty({
                title: "No available vehicle in range",
                body:
                  fleet && fleet.counts.total === 0
                    ? "No vehicle has reported in the last 10 minutes. Start the simulator: python3 data_generations/mongo_seeder.py --live"
                    : "Try a larger radius or another pickup point.",
              }),
        );
        drawNearest(r.items);
      } catch (err) {
        if (!isAbort(err)) list.replaceChildren(errorAlert(err, { onRetry: loadNearest }));
      }
    }

    /** Fleet updates arrive every few seconds; re-run the query at most every 2.5 s. */
    function nearestSoon() {
      if (nearestTimer) return;
      const wait = Math.max(0, NEAREST_MIN_GAP_MS - (Date.now() - lastNearest));
      nearestTimer = setTimeout(loadNearest, wait);
    }

    // ----------------------------------------------------------- live fleet
    function setLive(kind, text) {
      live.className = `live live--${kind}`;
      live.textContent = text;
    }

    function applyFleet(f) {
      fleet = f;
      counts.textContent = `${formatInt(f.counts.available)} available, ${formatInt(f.counts.busy)} busy, updated ${new Date(f.generatedAt).toLocaleTimeString("en-IN")}`;
      drawFleet();
      nearestSoon();
    }

    function connect() {
      if (!("EventSource" in window)) return startPolling("This browser has no live stream.");
      es = new EventSource("/api/map/stream");
      es.addEventListener("hello", (e) => {
        const hello = JSON.parse(e.data);
        setLive("on", hello.mode === "change-stream" ? "Live (change stream)" : `Live (every ${Math.round(hello.intervalMs / 1000)} s)`);
      });
      es.addEventListener("fleet", (e) => {
        streamFailures = 0;
        applyFleet(JSON.parse(e.data));
      });
      es.addEventListener("error", (e) => {
        if (e.data) {
          // the server sent an error event (MongoDB down); the stream stays open
          const info = JSON.parse(e.data);
          setLive("warn", "Live, database unreachable");
          counts.textContent = info.message;
          return;
        }
        streamFailures += 1;
        setLive("warn", "Reconnecting…");
        if (streamFailures >= 3) {
          es.close();
          es = null;
          startPolling("The live stream keeps failing.");
        }
      });
    }

    function startPolling(reason) {
      setLive("warn", `Refreshing every ${POLL_FALLBACK_MS / 1000} s`);
      live.title = `${reason} Polling GET /api/map/fleet instead.`;
      const tick = async () => {
        try {
          applyFleet(await api.get("/map/fleet"));
        } catch (err) {
          counts.textContent = `Could not refresh: ${err.message}`;
        }
      };
      tick();
      pollTimer = setInterval(tick, POLL_FALLBACK_MS);
    }

    // ----------------------------------------------------------- layout
    ctx.outlet.append(
      pageHeader("Map", "Nearest available vehicles to a pickup point, from the $geoNear pipeline on live telemetry.", live),
      h(
        "div",
        { class: "stack stack--tight" },
        h(
          "div",
          { class: "filters" },
          field({ label: "Pickup point", control: originSelect }),
          field({ label: "Radius", control: radiusSelect }),
          h("p", { class: "filters__note muted" }, "Or click anywhere on the map to search from there."),
        ),
        h(
          "div",
          { class: "map-layout" },
          h(
            "section",
            { class: "panel map-panel" },
            mapNote,
            mapBox,
            h(
              "div",
              { class: "panel__foot map-legend" },
              h("span", { class: "map-legend__item" }, h("span", { class: "dot dot--available", "aria-hidden": "true" }), "Available"),
              h("span", { class: "map-legend__item" }, h("span", { class: "dot dot--busy", "aria-hidden": "true" }), "Busy"),
              h("span", { class: "map-legend__item" }, h("span", { class: "dot dot--nearest", "aria-hidden": "true" }, "1"), "Nearest, by rank"),
              counts,
            ),
          ),
          h(
            "section",
            { class: "panel", "aria-labelledby": "nearest-title" },
            h("div", { class: "panel__head" }, h("div", {}, h("h2", { class: "panel__title", id: "nearest-title" }, "Nearest available"), listHead)),
            h("div", { class: "panel__body" }, list),
          ),
        ),
      ),
    );

    startMap();
    loadNearest();
    connect();

    return () => {
      closed = true;
      es?.close();
      clearInterval(pollTimer);
      clearTimeout(nearestTimer);
      nearestController?.abort();
      map?.remove();
    };
  },
};
