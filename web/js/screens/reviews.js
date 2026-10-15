import { formatDate, formatDateTime, formatInt } from "/shared/format.js";
import { pager } from "../components/table.js";
import { dateTime, empty, errorAlert, field, input, kv, pageHeader, panel, plate, select, skeleton } from "../components/ui.js";
import { api, isAbort } from "../lib/api.js";
import { h } from "../lib/dom.js";
import { setQuery } from "../lib/router.js";

/**
 * Reviews (Workflow 4) + the flexible vehicle catalog.
 *   GET /api/reviews/summary         $facet: rating distribution, top tags, average
 *   GET /api/reviews                 latest reviews (filter by rating)
 *   GET /api/vehicles/:id/catalog    the VehicleMetadata document
 * The two bar charts are plain HTML (real text, no chart library), so they
 * read well with a screen reader and still work if Chart.js fails to load.
 */
export const reviewsScreen = {
  nav: "reviews",
  title: "Reviews",
  render(ctx) {
    const q = ctx.query;
    const state = { vehicleId: q.vehicleId, from: q.from, to: q.to, rating: q.rating, page: Number(q.page) || 1 };
    const controllers = new Set();
    const fresh = () => {
      const c = new AbortController();
      controllers.add(c);
      return c;
    };
    const save = (patch) => {
      Object.assign(state, patch);
      setQuery({ vehicleId: state.vehicleId, from: state.from, to: state.to, rating: state.rating, page: state.page > 1 ? state.page : undefined }, { silent: true });
    };
    let vehicles = [];

    // ----------------------------------------------------------- filters
    const vehicleSelect = select([{ value: "", label: "All vehicles" }], { "aria-label": "Vehicle" });
    const fromInput = input({ type: "date", value: state.from ?? "" });
    const toInput = input({ type: "date", value: state.to ?? "" });
    const filterError = h("div", { "aria-live": "polite" });
    const onFilter = () => {
      save({ vehicleId: vehicleSelect.value || undefined, from: fromInput.value || undefined, to: toInput.value || undefined, page: 1 });
      loadSummary();
      loadList();
      loadCatalog();
    };
    vehicleSelect.addEventListener("change", onFilter);
    fromInput.addEventListener("change", onFilter);
    toInput.addEventListener("change", onFilter);

    async function loadVehicles() {
      try {
        const r = await api.get("/vehicles", { pageSize: 100, sort: "license_plate" }, { signal: fresh().signal });
        vehicles = r.items;
        vehicleSelect.replaceChildren(
          h("option", { value: "" }, "All vehicles"),
          ...vehicles.map((v) => h("option", { value: v.id, selected: v.id === state.vehicleId }, `${v.licensePlate} (${v.class})`)),
        );
        loadCatalog();
      } catch (err) {
        if (!isAbort(err)) filterError.replaceChildren(errorAlert(err, { onRetry: loadVehicles }));
      }
    }

    // ----------------------------------------------------------- $facet summary
    const avgBox = h("div", { class: "rating-hero" }, skeleton(2));
    const distBox = h("div", {}, skeleton(5));
    const tagsBox = h("div", {}, skeleton(6));

    const barList = (rows, { label, value, valueText, max, caption }) =>
      h(
        "figure",
        { class: "bars" },
        h("figcaption", { class: "visually-hidden" }, caption),
        h(
          "ul",
          { class: "bars__list" },
          rows.map((r) =>
            h(
              "li",
              { class: "bars__row" },
              h("span", { class: "bars__label" }, label(r)),
              h("span", { class: "bars__track", "aria-hidden": "true" }, h("span", { class: "bars__bar", style: { width: `${max ? (value(r) / max) * 100 : 0}%` } })),
              h("span", { class: "bars__value" }, valueText(r)),
            ),
          ),
        ),
      );

    async function loadSummary() {
      filterError.replaceChildren();
      for (const b of [avgBox, distBox, tagsBox]) b.setAttribute("aria-busy", "true");
      try {
        const s = await api.get("/reviews/summary", { vehicleId: state.vehicleId, from: state.from, to: state.to }, { signal: fresh().signal });
        const vehicle = vehicles.find((v) => v.id === state.vehicleId);
        if (s.totalReviews === 0) {
          avgBox.replaceChildren(h("p", { class: "rating-hero__value" }, "–"), h("p", { class: "muted" }, "No reviews"));
          distBox.replaceChildren(empty({ title: "No reviews match these filters", body: "Pick another vehicle or widen the dates." }));
          tagsBox.replaceChildren(empty({ title: "No tags to show" }));
          return;
        }
        avgBox.replaceChildren(
          h("p", { class: "rating-hero__value" }, s.averageRating.toFixed(2), h("span", { class: "rating-hero__of" }, " out of 5")),
          stars(s.averageRating),
          h("p", { class: "muted" }, `${formatInt(s.totalReviews)} reviews${vehicle ? ` of ${vehicle.licensePlate}` : ""}. The query took ${s.queryMs} ms.`),
        );
        const maxCount = Math.max(...s.ratingDistribution.map((b) => b.count));
        distBox.replaceChildren(
          barList(s.ratingDistribution, {
            caption: "Number of reviews per star rating",
            label: (b) => `${b.rating} ★`,
            value: (b) => b.count,
            valueText: (b) => `${formatInt(b.count)} (${Math.round((b.count / s.totalReviews) * 100)}%)`,
            max: maxCount,
          }),
        );
        const maxTag = s.commonFeedback[0]?.count ?? 0;
        tagsBox.replaceChildren(
          s.commonFeedback.length
            ? barList(s.commonFeedback, { caption: "Most common feedback tags", label: (t) => t.tag, value: (t) => t.count, valueText: (t) => formatInt(t.count), max: maxTag })
            : empty({ title: "No tags in these reviews" }),
        );
      } catch (err) {
        if (isAbort(err)) return;
        const box = errorAlert(err, { onRetry: loadSummary });
        if (err.fieldErrors) filterError.replaceChildren(box);
        else {
          avgBox.replaceChildren();
          tagsBox.replaceChildren();
          distBox.replaceChildren(box);
        }
      } finally {
        for (const b of [avgBox, distBox, tagsBox]) b.setAttribute("aria-busy", "false");
      }
    }

    // ----------------------------------------------------------- review list
    const ratingTabs = h(
      "div",
      { class: "tabs", role: "group", "aria-label": "Filter by rating" },
      ["", "5", "4", "3", "2", "1"].map((r) =>
        h(
          "button",
          {
            type: "button",
            "aria-pressed": String((state.rating ?? "") === r),
            dataset: { rating: r },
            onclick: () => {
              save({ rating: r || undefined, page: 1 });
              for (const b of ratingTabs.children) b.setAttribute("aria-pressed", String(b.dataset.rating === r));
              loadList();
            },
          },
          r ? `${r} ★` : "All",
        ),
      ),
    );
    const listBox = h("div", {}, skeleton(6));
    const listFoot = h("div");

    async function loadList() {
      listBox.setAttribute("aria-busy", "true");
      try {
        const r = await api.get("/reviews", { vehicleId: state.vehicleId, rating: state.rating, page: state.page, pageSize: 8 }, { signal: fresh().signal });
        listBox.replaceChildren(
          r.items.length
            ? h(
                "ul",
                { class: "review-list" },
                r.items.map((rv) =>
                  h(
                    "li",
                    { class: "review" },
                    h("div", { class: "review__head" }, stars(rv.rating, { small: true }), h("span", { class: "small muted" }, dateTime(rv.createdAt, { relative: true }))),
                    rv.driverFeedback ? h("p", { class: "review__text" }, rv.driverFeedback) : null,
                    rv.tags.length ? h("ul", { class: "tag-list", "aria-label": "Tags" }, rv.tags.map((t) => h("li", { class: "tag" }, t))) : null,
                    h(
                      "p",
                      { class: "review__meta small muted" },
                      rv.riderName ? `${rv.riderName}, ` : "",
                      rv.licensePlate ? plate(rv.licensePlate) : "unknown vehicle",
                      rv.vehicleClass ? ` ${rv.vehicleClass}` : "",
                    ),
                  ),
                ),
              )
            : empty({ title: "No reviews with this rating", body: "Choose another rating or vehicle." }),
        );
        listFoot.replaceChildren(
          r.items.length
            ? pager({
                ...r,
                onPage: (p) => {
                  save({ page: p });
                  loadList();
                },
              })
            : "",
        );
      } catch (err) {
        if (!isAbort(err)) {
          listBox.replaceChildren(errorAlert(err, { onRetry: loadList }));
          listFoot.replaceChildren();
        }
      } finally {
        listBox.setAttribute("aria-busy", "false");
      }
    }

    // ----------------------------------------------------------- catalog document
    const catalogBox = h("div", {}, skeleton(6));
    const catalogTitle = h("h2", { class: "panel__title" }, "Vehicle catalog");
    const catalogNote = h("p", {});

    async function loadCatalog() {
      const id = state.vehicleId ?? vehicles[0]?.id;
      if (!id) return;
      const v = vehicles.find((x) => x.id === id);
      catalogNote.textContent = state.vehicleId
        ? "The VehicleMetadata document for this vehicle, from MongoDB."
        : `Showing ${v?.licensePlate ?? "the first vehicle"}. Pick a vehicle above to see another one.`;
      catalogBox.setAttribute("aria-busy", "true");
      try {
        const doc = await api.get(`/vehicles/${id}/catalog`, undefined, { signal: fresh().signal });
        catalogBox.replaceChildren(catalogView(doc));
      } catch (err) {
        if (isAbort(err)) return;
        catalogBox.replaceChildren(
          err.status === 404
            ? empty({ title: "No catalog document", body: "This vehicle has no VehicleMetadata entry. Run the MongoDB seeder." })
            : errorAlert(err, { onRetry: loadCatalog }),
        );
      } finally {
        catalogBox.setAttribute("aria-busy", "false");
      }
    }

    // ----------------------------------------------------------- layout
    ctx.outlet.append(
      pageHeader("Reviews", "What riders say about the fleet, from the $facet pipeline on TripReviews, and each vehicle's catalog document."),
      h(
        "div",
        { class: "stack" },
        h(
          "div",
          { class: "filters" },
          field({ label: "Vehicle", control: vehicleSelect }),
          field({ label: "From", control: fromInput }),
          field({ label: "To", control: toInput }),
        ),
        filterError,
        h(
          "div",
          { class: "reviews-grid" },
          panel({ title: "Average rating" }, avgBox),
          panel({ title: "Rating distribution", description: "Reviews per star rating" }, distBox),
          panel({ title: "Top feedback tags", description: "How often each tag was chosen" }, tagsBox),
        ),
        h(
          "div",
          { class: "grid-2 reviews-lower" },
          h(
            "section",
            { class: "panel" },
            h("div", { class: "panel__head" }, h("h2", { class: "panel__title" }, "Latest reviews"), ratingTabs),
            h("div", { class: "panel__body" }, listBox),
            h("div", { class: "panel__foot" }, listFoot),
          ),
          h("section", { class: "panel" }, h("div", { class: "panel__head" }, h("div", {}, catalogTitle, catalogNote)), h("div", { class: "panel__body" }, catalogBox)),
        ),
      ),
    );

    loadVehicles();
    loadSummary();
    loadList();

    return () => {
      for (const c of controllers) c.abort();
    };
  },
};

// ======================================================================= helpers

/** Star row with the exact value for screen readers. */
function stars(value, { small = false } = {}) {
  const full = Math.round(value);
  return h(
    "span",
    { class: `stars${small ? " stars--sm" : ""}`, role: "img", "aria-label": `${Number(value).toFixed(small ? 0 : 2)} out of 5 stars` },
    "★".repeat(full),
    h("span", { class: "stars__off" }, "★".repeat(5 - full)),
  );
}

/** Readable names for the catalog's known keys; anything else is humanized. */
const LABELS = {
  batteryKWh: "Battery (kWh)",
  rangeKm: "Range",
  fastCharging: "Fast charging",
  cngTankKg: "CNG tank",
  driveTrain: "Drive train",
  bootLitres: "Boot space",
  fuelType: "Fuel",
  odometerKm: "Odometer",
  serviceDue: "Service due",
  lastService: "Last service",
  policyNumber: "Policy number",
  expiresOn: "Expires on",
};

/** "fuelType" -> "Fuel type" for keys without a label */
const humanize = (key) =>
  LABELS[key] ??
  key
    .replace(/KWh/g, " kWh")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/ ([A-Z])(?=[a-z])/g, (_m, c) => ` ${c.toLowerCase()}`);

const UNITS = { rangeKm: " km", bootLitres: " L", cngTankKg: " kg", odometerKm: " km" };

const isIsoDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v);

function fmtValue(key, v) {
  if (v === true) return "Yes";
  if (v === false) return "No";
  if (v === null || v === undefined) return "—";
  if (isIsoDate(v)) return formatDate(v);
  if (typeof v === "number") return `${formatInt(v)}${UNITS[key] ?? ""}`;
  return String(v);
}

/** Renders a VehicleMetadata document: known sections first, anything else generically. */
function catalogView(doc) {
  const {
    vehicleId: _id,
    licensePlate,
    class: vClass,
    isActive,
    make,
    model,
    year,
    color,
    features = [],
    specs = {},
    inspection,
    inspectionHistory = [],
    maintenance,
    insurance,
    updatedAt,
    ...rest
  } = doc;

  const objectKv = (obj) => kv(Object.entries(obj ?? {}).map(([k, v]) => [humanize(k), typeof v === "object" && v && !isIsoDate(v) ? JSON.stringify(v) : fmtValue(k, v)]));
  const statusClass = (s) => (s === "PASSED" ? "status--transit status--static" : s === "FAILED" ? "status--danger" : "status--inactive");

  const raw = h("pre", { class: "json" }, JSON.stringify(doc, null, 2));

  return h(
    "div",
    { class: "catalog stack stack--tight" },
    h(
      "div",
      { class: "catalog__head" },
      plate(licensePlate, { large: true, off: isActive === false }),
      h("div", {}, h("p", { class: "catalog__name" }, [make, model].filter(Boolean).join(" ") || "Vehicle"), h("p", { class: "small muted" }, [vClass, year, color].filter(Boolean).join(", "))),
    ),
    isActive === false && rest.outOfServiceReason ? h("p", { class: "alert alert--warn" }, h("span", { class: "alert__icon" }, "!"), h("span", { class: "alert__title" }, "Out of service"), h("span", {}, rest.outOfServiceReason)) : null,
    features.length ? h("ul", { class: "tag-list", "aria-label": "Features" }, features.map((f) => h("li", { class: "tag" }, f))) : null,
    h("h3", { class: "catalog__section" }, "Specs"),
    h("p", { class: "small muted" }, "The keys differ by class and fuel type: electric cars have battery and range, CNG cars a tank size, SUVs a drive train."),
    objectKv(specs),
    inspectionHistory.length
      ? [
          h("h3", { class: "catalog__section" }, `Inspection history (${inspectionHistory.length})`),
          h(
            "ol",
            { class: "timeline" },
            inspectionHistory.map((i) =>
              h(
                "li",
                {},
                h("div", { class: "row" }, h("strong", {}, fmtValue("date", i.date)), h("span", { class: `status ${statusClass(i.status)}` }, (i.status ?? "").replace(/_/g, " ").toLowerCase()), h("span", { class: "small muted" }, `${i.inspector ?? ""}, ${fmtValue("odometerKm", i.odometerKm)}`)),
                i.checks ? h("p", { class: "small muted" }, Object.entries(i.checks).map(([k, v]) => `${humanize(k)}: ${v}`).join(", ")) : null,
                i.notes ? h("p", { class: "small" }, i.notes) : null,
              ),
            ),
          ),
        ]
      : inspection
        ? [h("h3", { class: "catalog__section" }, "Latest inspection"), objectKv(inspection)]
        : null,
    maintenance ? [h("h3", { class: "catalog__section" }, "Maintenance"), objectKv(maintenance)] : null,
    insurance ? [h("h3", { class: "catalog__section" }, "Insurance"), objectKv(insurance)] : null,
    Object.keys(rest).filter((k) => k !== "outOfServiceReason").length
      ? [h("h3", { class: "catalog__section" }, "Other fields"), objectKv(Object.fromEntries(Object.entries(rest).filter(([k]) => k !== "outOfServiceReason")))]
      : null,
    h("p", { class: "small muted" }, `Updated ${updatedAt ? formatDateTime(updatedAt) : "—"}.`),
    h("details", { class: "raw" }, h("summary", {}, "Show the stored JSON document"), raw),
  );
}
