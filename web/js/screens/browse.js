import { formatDateTime, formatInt, formatMoney } from "/shared/format.js";
import { dataTable, pager } from "../components/table.js";
import { tripActions } from "../components/trip-actions.js";
import {
  button,
  dateTime,
  empty,
  errorAlert,
  field,
  figures,
  idText,
  inactiveBadge,
  input,
  kv,
  money,
  notice,
  pageHeader,
  panel,
  plate,
  select,
  skeleton,
  statusBadge,
} from "../components/ui.js";
import { api, isAbort } from "../lib/api.js";
import { debounce, h } from "../lib/dom.js";
import { href, replaceQuery } from "../lib/router.js";
import { getActor, setActor } from "../lib/store.js";

/**
 * Browse: riders, vehicles and trips.
 *   #/browse/:tab           list with filters (state in the query string)
 *   #/browse/:tab/:id       detail view
 */
const TABS = [
  ["trips", "Trips"],
  ["riders", "Riders"],
  ["vehicles", "Vehicles"],
];

export const browseScreen = {
  nav: "browse",
  title: "Browse",
  render(ctx) {
    const tab = ctx.params.tab ?? "trips";
    if (!LISTS[tab]) return ctx.navigate("/browse/trips", {}, { replace: true });
    if (ctx.params.id) return DETAILS[tab](ctx, ctx.params.id);
    return listView(ctx, tab);
  },
};

const tabsNav = (current) =>
  h(
    "nav",
    { class: "tabs", "aria-label": "What to browse" },
    TABS.map(([id, label]) => h("a", { href: `#/browse/${id}`, "aria-current": id === current ? "page" : null }, label)),
  );

const vehicleState = (v) =>
  !v.isActive ? inactiveBadge() : v.hasActiveTrip ? h("span", { class: "status status--requested" }, "On a trip") : h("span", { class: "status status--transit status--static" }, "Free");

// ======================================================================= lists

/**
 * Each list: query keys it keeps in the URL, defaults, filter controls,
 * table columns and the API call.
 */
const LISTS = {
  trips: {
    path: "/trips",
    keys: ["status", "riderId", "vehicleId", "from", "to", "order", "page"],
    defaults: { order: "desc", page: 1 },
    caption: "Trips",
    sort: (s) => ({ key: "created_at", order: s.order }),
    onSort: (_key, order) => ({ order }),
    toApi: ({ status, ...s }) => ({ ...s, status: status === "ACTIVE" ? undefined : status, active: status === "ACTIVE" ? true : undefined, pageSize: 20 }),
    filters: (s, update) => [
      field({
        label: "Status",
        control: select(
          [
            { value: "", label: "Any status" },
            { value: "ACTIVE", label: "Active (requested or in transit)" },
            { value: "REQUESTED", label: "Requested" },
            { value: "IN TRANSIT", label: "In transit" },
            { value: "COMPLETED", label: "Completed" },
          ],
          { value: s.status ?? "", onchange: (e) => update({ status: e.target.value || undefined }) },
        ),
      }),
      field({ label: "Booked from", control: input({ type: "date", value: s.from ?? "", onchange: (e) => update({ from: e.target.value || undefined }) }) }),
      field({ label: "Booked to", control: input({ type: "date", value: s.to ?? "", onchange: (e) => update({ to: e.target.value || undefined }) }) }),
    ],
    chips: (s, update, first) => [
      s.riderId ? chip(`Rider: ${first?.riderName ?? "one rider"}`, () => update({ riderId: undefined })) : null,
      s.vehicleId ? chip(`Vehicle: ${first?.licensePlate ?? "one vehicle"}`, () => update({ vehicleId: undefined })) : null,
    ],
    columns: [
      { key: "id", label: "Trip", render: (r) => idText(r.id) },
      { key: "riderName", label: "Rider" },
      { key: "licensePlate", label: "Vehicle", render: (r) => plate(r.licensePlate) },
      { key: "status", label: "Status", render: (r) => statusBadge(r.status) },
      { key: "fareAmount", label: "Fare", num: true, render: (r) => money(r.fareAmount) },
      { key: "createdAt", label: "Booked", sortKey: "created_at", render: (r) => dateTime(r.createdAt) },
    ],
    rowLink: (r) => `#/browse/trips/${r.id}`,
    emptyTitle: "No trips match these filters",
  },

  riders: {
    path: "/riders",
    keys: ["q", "sort", "order", "page"],
    defaults: { sort: "name", order: "asc", page: 1 },
    caption: "Riders",
    sort: (s) => ({ key: s.sort, order: s.order }),
    onSort: (sort, order) => ({ sort, order }),
    toApi: (s) => ({ ...s, pageSize: 20 }),
    filters: (s, update) => [searchField("Search riders", "Name or rider id", s.q, (q) => update({ q }))],
    columns: [
      { key: "name", label: "Rider", sortKey: "name" },
      { key: "walletBalance", label: "Wallet", num: true, sortKey: "wallet_balance", render: (r) => money(r.walletBalance) },
      { key: "id", label: "Rider id", render: (r) => idText(r.id) },
    ],
    rowLink: (r) => `#/browse/riders/${r.id}`,
    emptyTitle: "No riders match this search",
  },

  vehicles: {
    path: "/vehicles",
    keys: ["q", "class", "availability", "sort", "order", "page"],
    defaults: { sort: "license_plate", order: "asc", page: 1 },
    caption: "Vehicles",
    sort: (s) => ({ key: s.sort, order: s.order }),
    onSort: (sort, order) => ({ sort, order }),
    toApi: ({ availability, ...s }) => ({
      ...s,
      available: availability === "free" ? true : availability === "busy" ? false : undefined,
      active: availability === "inactive" ? false : undefined,
      pageSize: 20,
    }),
    filters: (s, update) => [
      searchField("Search vehicles", "Plate or vehicle id", s.q, (q) => update({ q })),
      field({
        label: "Class",
        control: select([{ value: "", label: "Any class" }, "Sedan", "SUV", "Hatchback"], { value: s.class ?? "", onchange: (e) => update({ class: e.target.value || undefined }) }),
      }),
      field({
        label: "Availability",
        control: select(
          [
            { value: "", label: "Any" },
            { value: "free", label: "Free to book now" },
            { value: "busy", label: "On a trip or out of service" },
            { value: "inactive", label: "Out of service" },
          ],
          { value: s.availability ?? "", onchange: (e) => update({ availability: e.target.value || undefined }) },
        ),
      }),
    ],
    columns: [
      { key: "licensePlate", label: "Vehicle", sortKey: "license_plate", render: (r) => plate(r.licensePlate, { off: !r.isActive }) },
      { key: "class", label: "Class", sortKey: "class" },
      { key: "state", label: "Now", render: vehicleState },
      { key: "totalTrips", label: "Lifetime trips", num: true, sortKey: "total_trips", render: (r) => formatInt(r.totalTrips) },
      { key: "totalEarnings", label: "Earnings", num: true, sortKey: "total_earnings", render: (r) => money(r.totalEarnings) },
    ],
    rowLink: (r) => `#/browse/vehicles/${r.id}`,
    note: "Lifetime trips and earnings come from the statistics view, which updates when it is refreshed on the Analytics screen.",
    emptyTitle: "No vehicles match these filters",
  },
};

function searchField(label, placeholder, value, onSearch) {
  const control = input({ type: "search", value: value ?? "", placeholder, autocomplete: "off" });
  const run = debounce(() => onSearch(control.value.trim() || undefined), 300);
  control.addEventListener("input", run);
  return field({ label, control });
}

const chip = (label, onClear) =>
  h("span", { class: "chip" }, label, h("button", { type: "button", class: "chip__clear", "aria-label": `Remove filter ${label}`, onclick: onClear }, "×"));

function listView(ctx, tab) {
  const cfg = LISTS[tab];
  const state = { ...cfg.defaults };
  for (const k of cfg.keys) if (ctx.query[k] !== undefined && ctx.query[k] !== "") state[k] = k === "page" ? Number(ctx.query[k]) || 1 : ctx.query[k];

  const filterBar = h("div", { class: "filters" });
  const chips = h("div", { class: "row" });
  const results = h("div", { "aria-live": "polite", "aria-busy": "false" });
  const foot = h("div");
  let controller = null;
  let lastFirst = null;

  const hasFilters = () => cfg.keys.some((k) => !["page", "sort", "order"].includes(k) && state[k] !== undefined);
  const clearBtn = button("Clear filters", { variant: "ghost", onclick: () => update(Object.fromEntries(cfg.keys.map((k) => [k, cfg.defaults[k]])), { repaintFilters: true }) });

  function paintFilters() {
    filterBar.replaceChildren(...cfg.filters(state, update), h("div", { class: "filters__actions" }, clearBtn));
  }

  function update(patch, { resetPage = true, repaintFilters = false } = {}) {
    Object.assign(state, patch);
    if (resetPage && !("page" in patch)) state.page = 1;
    const q = Object.fromEntries(cfg.keys.map((k) => [k, state[k] === cfg.defaults[k] ? undefined : state[k]]));
    replaceQuery(q, { silent: true });
    if (repaintFilters) paintFilters();
    load();
  }

  async function load() {
    controller?.abort();
    controller = new AbortController();
    clearBtn.hidden = !hasFilters();
    if (!results.firstChild) results.replaceChildren(skeleton(8));
    results.setAttribute("aria-busy", "true");
    try {
      const data = await api.get(cfg.path, cfg.toApi({ ...state }), { signal: controller.signal });
      lastFirst = data.items[0] ?? lastFirst;
      chips.replaceChildren(...(cfg.chips?.(state, update, lastFirst) ?? []).filter(Boolean));
      if (data.items.length === 0) {
        results.replaceChildren(
          empty({
            title: cfg.emptyTitle,
            body: hasFilters() ? "Change or clear the filters to see more." : "There is nothing here yet. Run the seeders described in the README.",
            action: hasFilters() ? button("Clear filters", { onclick: () => clearBtn.click() }) : null,
          }),
        );
        foot.replaceChildren();
      } else {
        results.replaceChildren(
          dataTable({
            caption: cfg.caption,
            columns: cfg.columns,
            rows: data.items,
            sort: cfg.sort(state),
            onSort: (key, order) => update(cfg.onSort(key, order)),
            rowLink: cfg.rowLink,
          }),
        );
        foot.replaceChildren(
          pager({
            ...data,
            onPage: (page) => {
              update({ page }, { resetPage: false });
              results.scrollIntoView({ block: "start", behavior: "smooth" });
            },
          }),
        );
      }
    } catch (err) {
      if (isAbort(err)) return;
      results.replaceChildren(h("div", { class: "panel__body" }, errorAlert(err, { onRetry: load })));
      foot.replaceChildren();
    } finally {
      results.setAttribute("aria-busy", "false");
    }
  }

  paintFilters();
  ctx.outlet.append(
    pageHeader("Browse", "Riders, vehicles and trips, straight from PostgreSQL.", tabsNav(tab)),
    h(
      "div",
      { class: "stack stack--tight" },
      filterBar,
      chips,
      cfg.note ? h("p", { class: "small muted" }, cfg.note) : null,
      h("section", { class: "panel panel--flush" }, h("div", { class: "panel__body" }, results), h("div", { class: "panel__foot" }, foot)),
    ),
  );
  load();
  return () => controller?.abort();
}

// ===================================================================== details

/** Loads one record, showing skeleton / not-found / error states. */
async function loadDetail(ctx, path, what, backHref) {
  const holder = h("div", {}, skeleton(6));
  ctx.outlet.append(holder);
  try {
    const data = await api.get(path, undefined, { signal: ctx.signal });
    holder.remove();
    return data;
  } catch (err) {
    if (isAbort(err)) throw err;
    holder.replaceChildren(
      err.status === 404 || err.code === "VALIDATION"
        ? panel({}, empty({ title: `${what} not found`, body: "It may have been removed when the database was re-seeded.", action: h("a", { class: "btn btn--primary", href: backHref }, `Back to ${what.toLowerCase()}s`) }))
        : errorAlert(err, { onRetry: () => ctx.navigate(ctx.path, ctx.query) }),
    );
    return null;
  }
}

const backLink = (hrefValue, label) => h("a", { class: "back-link", href: hrefValue }, `‹ ${label}`);

async function riderDetail(ctx, id) {
  ctx.outlet.append(backLink("#/browse/riders", "All riders"));
  const r = await loadDetail(ctx, `/riders/${id}`, "Rider", "#/browse/riders");
  if (!r) return;
  document.title = `${r.name} - RideSync`;
  const isActor = getActor()?.id === r.id;
  const actBtn = isActor
    ? h("span", { class: "small muted" }, "You are acting as this rider")
    : button("Act as this rider", { variant: "primary", onclick: () => { setActor(r); ctx.navigate(ctx.path, ctx.query); } });

  ctx.outlet.append(
    pageHeader(r.name, `Rider ${r.id}`, actBtn),
    h(
      "div",
      { class: "stack" },
      figures([
        { label: "Wallet balance", value: formatMoney(r.walletBalance) },
        { label: "Trips", value: formatInt(r.tripCount) },
        { label: "Completed", value: formatInt(r.completedTrips) },
        { label: "Spent on completed trips", value: formatMoney(r.totalSpent) },
      ]),
      h(
        "div",
        { class: "grid-2" },
        panel(
          { title: "Active trip", actions: r.activeTrip ? h("a", { href: `#/browse/trips/${r.activeTrip.id}` }, "Open trip") : null },
          r.activeTrip
            ? kv([["Vehicle", plate(r.activeTrip.licensePlate)], ["Status", statusBadge(r.activeTrip.status)], ["Fare", money(r.activeTrip.fareAmount)], ["Booked", dateTime(r.activeTrip.createdAt)]])
            : empty({ title: "No active trip", body: "This rider can book a ride.", action: isActor ? h("a", { class: "btn btn--secondary", href: "#/book" }, "Book a ride") : null }),
        ),
        panel(
          { title: "Last wallet change", actions: h("a", { href: href("/audit", { riderId: r.id }) }, "Full audit trail") },
          r.lastAudit
            ? kv([
                ["Change", money(r.lastAudit.amountChanged, { signed: true })],
                ["Type", r.lastAudit.actionType === "TOP_UP" ? "Top-up" : "Fare deduction"],
                ["Balance after", money(r.lastAudit.balanceAfter)],
                ["When", dateTime(r.lastAudit.timestamp)],
              ])
            : empty({ title: "No wallet changes yet" }),
        ),
      ),
      h("div", { class: "row" }, h("a", { class: "btn btn--secondary", href: href("/browse/trips", { riderId: r.id }) }, "See this rider's trips")),
    ),
  );
}

async function vehicleDetail(ctx, id) {
  ctx.outlet.append(backLink("#/browse/vehicles", "All vehicles"));
  const v = await loadDetail(ctx, `/vehicles/${id}`, "Vehicle", "#/browse/vehicles");
  if (!v) return;
  document.title = `${v.licensePlate} - RideSync`;
  const header = pageHeader(v.licensePlate, `${v.class}, vehicle ${v.id}`, vehicleState(v));
  header.querySelector("h1").replaceChildren(h("span", { class: "visually-hidden" }, "Vehicle "), plate(v.licensePlate, { large: true, off: !v.isActive }));

  ctx.outlet.append(
    header,
    h(
      "div",
      { class: "stack" },
      !v.isActive ? notice("warn", "Out of service", "This vehicle cannot take bookings (vehicles.is_active is false). Booking it fails with RS003.") : null,
      figures([
        { label: "Lifetime trips", value: formatInt(v.totalTrips) },
        { label: "Completed", value: formatInt(v.completedTrips) },
        { label: "Earnings", value: formatMoney(v.totalEarnings) },
        { label: "Last trip", value: v.lastTripAt ? formatDateTime(v.lastTripAt) : "—" },
      ]),
      h("p", { class: "small muted" }, `Statistics from mv_vehicle_stats, refreshed ${v.statsRefreshedAt ? formatDateTime(v.statsRefreshedAt) : "never"}.`),
      panel(
        { title: "Current trip", actions: v.activeTrip ? h("a", { href: `#/browse/trips/${v.activeTrip.id}` }, "Open trip") : null },
        v.activeTrip
          ? kv([["Rider", v.activeTrip.riderName], ["Status", statusBadge(v.activeTrip.status)], ["Fare", money(v.activeTrip.fareAmount)], ["Booked", dateTime(v.activeTrip.createdAt)]])
          : empty({
              title: v.isActive ? "Free to book" : "Not available",
              action: v.isActive ? h("a", { class: "btn btn--secondary", href: href("/book", { vehicleId: v.id }) }, "Book this vehicle") : null,
            }),
      ),
      h(
        "div",
        { class: "row" },
        h("a", { class: "btn btn--secondary", href: href("/browse/trips", { vehicleId: v.id }) }, "See this vehicle's trips"),
        h("a", { class: "btn btn--ghost", href: href("/reviews", { vehicleId: v.id }) }, "Reviews and catalog details"),
      ),
    ),
  );
}

async function tripDetail(ctx, id) {
  ctx.outlet.append(backLink("#/browse/trips", "All trips"));
  const t = await loadDetail(ctx, `/trips/${id}`, "Trip", "#/browse/trips");
  if (!t) return;
  document.title = `Trip ${t.id.slice(0, 8)} - RideSync`;

  const auditTable = t.auditEntries.length
    ? dataTable({
        caption: "Wallet changes linked to this trip",
        columns: [
          { key: "timestamp", label: "When", render: (a) => dateTime(a.timestamp) },
          { key: "actionType", label: "Type", render: (a) => (a.actionType === "TOP_UP" ? "Top-up" : "Fare deduction") },
          { key: "amountChanged", label: "Change", num: true, render: (a) => money(a.amountChanged, { signed: true }) },
          { key: "balanceBefore", label: "Before", num: true, render: (a) => money(a.balanceBefore) },
          { key: "balanceAfter", label: "After", num: true, render: (a) => money(a.balanceAfter) },
        ],
        rows: t.auditEntries,
      })
    : h("div", { class: "panel__body" }, empty({ title: "No linked wallet change", body: "Seeded history trips were imported without charging the wallet. Trips booked through the app always have one." }));

  ctx.outlet.append(
    pageHeader(`Trip ${t.id.slice(0, 8)}`, `Booked ${formatDateTime(t.createdAt)}`, statusBadge(t.status)),
    h(
      "div",
      { class: "stack" },
      h(
        "div",
        { class: "grid-2" },
        panel(
          { title: "Details" },
          kv([
            ["Trip id", idText(t.id)],
            ["Rider", h("a", { href: `#/browse/riders/${t.riderId}` }, t.riderName)],
            ["Vehicle", h("a", { href: `#/browse/vehicles/${t.vehicleId}`, class: "plate-link", "aria-label": `Vehicle ${t.licensePlate}` }, plate(t.licensePlate))],
            ["Class", t.vehicleClass],
            ["Fare", money(t.fareAmount)],
            ["Status", statusBadge(t.status)],
          ]),
        ),
        panel(
          { title: "Status", description: "Trips move forward only: Requested, In transit, Completed." },
          tripActions(t, { onChanged: () => ctx.navigate(ctx.path, ctx.query) }),
        ),
      ),
      panel({ title: "Wallet audit entries", description: "Rows in wallet_audit_logs whose trip_id is this trip.", flush: true }, auditTable),
    ),
  );
}

const DETAILS = { riders: riderDetail, vehicles: vehicleDetail, trips: tripDetail };
