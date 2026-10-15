import { formatDate, formatDateTime, formatInt, formatMoney, formatMoneyCompact, formatRelative, toIsoDate } from "/shared/format.js";
import { dataTable, pager } from "../components/table.js";
import { toast } from "../components/toast.js";
import {
  busy,
  button,
  dateTime,
  empty,
  errorAlert,
  field,
  figures,
  inactiveBadge,
  input,
  money,
  notice,
  pageHeader,
  panel,
  plate,
  select,
  skeleton,
} from "../components/ui.js";
import { api, isAbort } from "../lib/api.js";
import { h } from "../lib/dom.js";
import { setQuery } from "../lib/router.js";
import { loadChart, prefersReducedMotion, seriesColors } from "../lib/vendor.js";

/**
 * Analytics (Workflow 2 + materialized view).
 *   Right now           live counts from the tables (GET /api/analytics/overview)
 *   Moving average      fn_vehicle_revenue_moving_avg -> line chart (Chart.js)
 *   Ranking             DENSE_RANK of the moving average on one day
 *   Lifetime statistics mv_vehicle_stats: totals, last refreshed, refresh button
 * Every panel loads, fails and retries on its own.
 */
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const analyticsScreen = {
  nav: "analytics",
  title: "Analytics",
  render(ctx) {
    const q = ctx.query;
    const today = toIsoDate(new Date());
    const state = {
      from: q.from,
      to: q.to,
      topN: q.topN ?? "5",
      rankDate: q.rankDate,
      statsSort: q.statsSort ?? "total_earnings",
      statsOrder: q.statsOrder ?? "desc",
      statsPage: Number(q.statsPage) || 1,
      view: q.view === "table" ? "table" : "chart",
    };
    const controllers = new Set();
    const fresh = () => {
      const c = new AbortController();
      controllers.add(c);
      return c;
    };
    const save = (patch) => {
      Object.assign(state, patch);
      setQuery({ ...patch, statsPage: state.statsPage > 1 ? state.statsPage : undefined, view: state.view === "table" ? "table" : undefined }, { silent: true });
    };
    let chart = null;

    // ======================================================= right now (live)
    const nowBox = h("div", {}, skeleton(2));
    async function loadNow() {
      try {
        const o = await api.get("/analytics/overview", undefined, { signal: fresh().signal });
        nowBox.replaceChildren(
          figures([
            { label: "Vehicles free to book", value: `${formatInt(o.availableVehicles)} of ${formatInt(o.vehicles)}` },
            { label: "Trips requested", value: formatInt(o.requestedTrips) },
            { label: "Trips in transit", value: formatInt(o.inTransitTrips) },
            { label: "Revenue today (completed)", value: formatMoneyCompact(o.revenueToday) },
          ]),
        );
      } catch (err) {
        if (!isAbort(err)) nowBox.replaceChildren(errorAlert(err, { onRetry: loadNow }));
      }
    }

    // ======================================================= moving average
    const fromInput = input({ type: "date", value: state.from ?? "", max: today });
    const toInput = input({ type: "date", value: state.to ?? "", max: today });
    const topSelect = select(
      [
        { value: "3", label: "Top 3" },
        { value: "5", label: "Top 5" },
        { value: "7", label: "Top 7" },
      ],
      { value: state.topN },
    );
    const maError = h("div", { "aria-live": "polite" });
    const maBody = h("div", {}, skeleton(6));
    const viewBtn = button(state.view === "table" ? "Show as chart" : "Show as table", { size: "sm" });
    let maData = null;
    let chartLib = null;
    let chartFailed = null;

    const onRange = () => {
      save({ from: fromInput.value || undefined, to: toInput.value || undefined, topN: topSelect.value, rankDate: undefined });
      loadMovingAverage();
    };
    fromInput.addEventListener("change", onRange);
    toInput.addEventListener("change", onRange);
    topSelect.addEventListener("change", onRange);
    viewBtn.addEventListener("click", () => {
      save({ view: state.view === "table" ? "chart" : "table" });
      viewBtn.textContent = state.view === "table" ? "Show as chart" : "Show as table";
      paintMovingAverage();
    });

    async function loadMovingAverage() {
      const c = fresh();
      maError.replaceChildren();
      maBody.setAttribute("aria-busy", "true");
      try {
        const [data, Chart] = await Promise.all([
          api.get("/analytics/moving-average", { from: state.from, to: state.to, topN: state.topN }, { signal: c.signal }),
          chartLib ? chartLib : loadChart().catch((err) => {
            chartFailed = err;
            return null;
          }),
        ]);
        chartLib = Chart;
        maData = data;
        if (!state.from) fromInput.placeholder = data.from;
        paintMovingAverage();
        loadRanking();
      } catch (err) {
        if (isAbort(err)) return;
        if (err.fieldErrors) maError.replaceChildren(errorAlert(err));
        else maBody.replaceChildren(errorAlert(err, { onRetry: loadMovingAverage }));
      } finally {
        maBody.setAttribute("aria-busy", "false");
      }
    }

    function paintMovingAverage() {
      chart?.destroy();
      chart = null;
      const d = maData;
      if (!d) return;
      if (d.series.length === 0) {
        maBody.replaceChildren(empty({ title: "No completed trips in this range", body: `Nothing between ${formatDate(d.from)} and ${formatDate(d.to)}. Pick another range.` }));
        return;
      }
      const colors = seriesColors(d.series.map((s) => s.vehicleId));
      const legend = h(
        "ul",
        { class: "chart-legend", "aria-label": "Vehicles in the chart" },
        d.series.map((s) =>
          h(
            "li",
            {},
            h("span", { class: "chart-legend__key", style: { background: colors.get(s.vehicleId) }, "aria-hidden": "true" }),
            plate(s.licensePlate),
            h("span", { class: "chart-legend__meta" }, `#${s.rankOnLastDay ?? "–"} on ${formatDate(d.to)}, `, money(s.points.at(-1)?.movingAvg7d)),
          ),
        ),
      );
      const caption = h("p", { class: "small muted" }, `${formatDate(d.from)} to ${formatDate(d.to)}. Each point is the average daily revenue of the 7 days ending that day; idle days count as ₹0.`);

      const showTable = state.view === "table" || !chartLib;
      const fallbackNote = !chartLib ? notice("warn", "The chart could not load", `${chartFailed?.message ?? "Chart.js is missing."} The same numbers are shown as a table.`) : null;
      if (showTable) {
        maBody.replaceChildren(fallbackNote ?? "", legend, maTable(d), caption);
        return;
      }

      const canvas = h("canvas", { role: "img", "aria-label": `Line chart of the 7-day moving average revenue for ${d.series.length} vehicles. Use "Show as table" for the numbers.` });
      maBody.replaceChildren(h("div", { class: "chart-box" }, canvas), legend, caption);
      const ink2 = css("--ink-2");
      chartLib.defaults.font.family = css("--font-ui");
      chartLib.defaults.color = ink2;
      chart = new chartLib(canvas, {
        type: "line",
        data: {
          labels: d.series[0].points.map((p) => formatDate(p.date).replace(/ \d{4}$/, "")),
          datasets: d.series.map((s) => ({
            label: s.licensePlate,
            data: s.points.map((p) => p.movingAvg7d),
            borderColor: colors.get(s.vehicleId),
            backgroundColor: colors.get(s.vehicleId),
            borderWidth: 2,
            borderJoinStyle: "round",
            borderCapStyle: "round",
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHitRadius: 10,
            tension: 0.25,
          })),
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: prefersReducedMotion() ? false : { duration: 300 },
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: (items) => formatDate(d.series[0].points[items[0].dataIndex].date),
                label: (item) => ` ${item.dataset.label}: ${formatMoney(item.parsed.y)}`,
              },
            },
          },
          scales: {
            x: { grid: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0 } },
            y: { beginAtZero: true, grid: { color: css("--surface-sunk") }, border: { display: false }, ticks: { callback: (v) => formatMoneyCompact(v), maxTicksLimit: 6 } },
          },
        },
      });
    }

    function maTable(d) {
      const dates = d.series[0].points.map((p) => p.date).reverse();
      return dataTable({
        caption: "7-day moving average per vehicle and day",
        columns: [
          { key: "date", label: "Day", render: (r) => formatDate(r.date) },
          ...d.series.map((s) => ({
            key: s.vehicleId,
            label: s.licensePlate,
            num: true,
            render: (r) => formatMoney(s.points.find((p) => p.date === r.date)?.movingAvg7d),
          })),
        ],
        rows: dates.map((date) => ({ date })),
      });
    }

    // ======================================================= ranking
    const rankDate = select([], { "aria-label": "Day to rank" });
    const rankBody = h("div", {}, skeleton(5));
    rankDate.addEventListener("change", () => {
      save({ rankDate: rankDate.value });
      loadRanking();
    });

    async function loadRanking() {
      if (!maData) return;
      // the dates offered are the days of the chart's range, newest first
      const days = [];
      for (let t = Date.parse(`${maData.to}T00:00:00`); t >= Date.parse(`${maData.from}T00:00:00`); t -= 86_400_000) days.push(toIsoDate(new Date(t)));
      const chosen = days.includes(state.rankDate) ? state.rankDate : maData.to;
      rankDate.replaceChildren(...days.map((dd) => h("option", { value: dd, selected: dd === chosen }, formatDate(dd))));
      rankBody.setAttribute("aria-busy", "true");
      try {
        const r = await api.get("/analytics/ranking", { date: chosen, limit: 10 }, { signal: fresh().signal });
        rankBody.replaceChildren(
          r.items.length
            ? dataTable({
                caption: `Vehicles ranked by 7-day average revenue on ${formatDate(r.date)}`,
                columns: [
                  { key: "rank", label: "Rank", render: (x) => h("span", { class: "rank" }, x.rank) },
                  { key: "licensePlate", label: "Vehicle", render: (x) => h("a", { href: `#/browse/vehicles/${x.vehicleId}`, class: "plate-link", "aria-label": `Vehicle ${x.licensePlate}` }, plate(x.licensePlate)) },
                  { key: "movingAvg7d", label: "7-day avg", num: true, render: (x) => h("strong", {}, money(x.movingAvg7d)) },
                  { key: "dailyRevenue", label: "Revenue", num: true, render: (x) => money(x.dailyRevenue) },
                  { key: "tripsThatDay", label: "Trips", num: true },
                ],
                rows: r.items,
              })
            : empty({ title: "No ranking for this day", body: "No vehicle had completed trips in the 7 days up to this day." }),
        );
      } catch (err) {
        if (!isAbort(err)) rankBody.replaceChildren(errorAlert(err, { onRetry: loadRanking }));
      } finally {
        rankBody.setAttribute("aria-busy", "false");
      }
    }

    // ======================================================= lifetime statistics (MV)
    const statsSummary = h("div", {}, skeleton(2));
    const statsFresh = h("div", { class: "freshness", "aria-live": "polite" });
    const statsTable = h("div", {}, skeleton(6));
    const statsFoot = h("div");
    const refreshBtn = button("Refresh statistics", { variant: "primary" });

    refreshBtn.addEventListener("click", async () => {
      busy(refreshBtn, true, "Refreshing…");
      try {
        const r = await api.post("/analytics/vehicle-stats/refresh");
        toast({ title: "Statistics refreshed", body: `REFRESH MATERIALIZED VIEW CONCURRENTLY took ${r.durationMs} ms.` });
        await loadStats();
      } catch (err) {
        statsFresh.replaceChildren(errorAlert(err));
      } finally {
        busy(refreshBtn, false, "Refreshing…");
      }
    });

    const STAT_COLUMNS = [
      { key: "earningsRank", label: "Rank", render: (r) => h("span", { class: "rank" }, r.earningsRank) },
      { key: "licensePlate", label: "Vehicle", sortKey: "license_plate", render: (r) => h("a", { href: `#/browse/vehicles/${r.vehicleId}`, class: "plate-link", "aria-label": `Vehicle ${r.licensePlate}` }, plate(r.licensePlate, { off: !r.isActive })) },
      { key: "vehicleClass", label: "Class", render: (r) => [r.vehicleClass, r.isActive ? "" : h("span", {}, " ", inactiveBadge())] },
      { key: "totalTrips", label: "Lifetime trips", num: true, sortKey: "total_trips", render: (r) => formatInt(r.totalTrips) },
      { key: "completedTrips", label: "Completed", num: true, sortKey: "completed_trips", render: (r) => formatInt(r.completedTrips) },
      { key: "totalEarnings", label: "Earnings", num: true, sortKey: "total_earnings", render: (r) => h("strong", {}, money(r.totalEarnings)) },
      { key: "lastTripAt", label: "Last trip", render: (r) => dateTime(r.lastTripAt) },
    ];

    async function loadStats() {
      statsTable.setAttribute("aria-busy", "true");
      try {
        const r = await api.get(
          "/analytics/vehicle-stats",
          { sort: state.statsSort, order: state.statsOrder, page: state.statsPage, pageSize: 10 },
          { signal: fresh().signal },
        );
        const s = r.summary;
        statsSummary.replaceChildren(
          figures([
            { label: `Vehicles (${formatInt(s.activeVehicles)} in service)`, value: formatInt(s.vehicles) },
            { label: "Lifetime trips", value: formatInt(s.totalTrips) },
            { label: "Completed trips", value: formatInt(s.completedTrips) },
            { label: "Lifetime earnings", value: formatMoneyCompact(s.totalEarnings) },
          ], { columns: 2 }),
        );
        const f = r.freshness;
        statsFresh.replaceChildren(
          h(
            "p",
            { class: "freshness__line" },
            "Last refreshed ",
            h("time", { datetime: f.refreshedAt ?? "" }, f.refreshedAt ? `${formatDateTime(f.refreshedAt)} (${formatRelative(f.refreshedAt)})` : "never"),
          ),
          f.tripsNotInView > 0
            ? notice("warn", `${formatInt(f.tripsNotInView)} new ${f.tripsNotInView === 1 ? "trip is" : "trips are"} not counted yet`, "The view is a stored snapshot. Refresh it to include trips booked since then.")
            : h("p", { class: "small muted" }, "Up to date with the trips table."),
        );
        statsTable.replaceChildren(
          dataTable({
            caption: "Lifetime statistics per vehicle (mv_vehicle_stats)",
            columns: STAT_COLUMNS,
            rows: r.items,
            sort: { key: state.statsSort, order: state.statsOrder },
            onSort: (key, order) => {
              save({ statsSort: key, statsOrder: order, statsPage: 1 });
              loadStats();
            },
          }),
        );
        statsFoot.replaceChildren(
          pager({
            ...r,
            onPage: (p) => {
              save({ statsPage: p });
              loadStats();
            },
          }),
        );
      } catch (err) {
        if (isAbort(err)) return;
        statsTable.replaceChildren(h("div", { class: "panel__body" }, errorAlert(err, { onRetry: loadStats })));
        statsSummary.replaceChildren();
        statsFoot.replaceChildren();
      } finally {
        statsTable.setAttribute("aria-busy", "false");
      }
    }

    // ======================================================= layout
    ctx.outlet.append(
      pageHeader("Analytics", "Revenue trends per vehicle, from the window-function query, and lifetime statistics, from the materialized view."),
      h(
        "div",
        { class: "stack" },
        h("section", { class: "stack stack--tight", "aria-labelledby": "now-title" }, h("h2", { id: "now-title" }, "Right now"), nowBox),
        panel(
          {
            title: "7-day moving average of revenue",
            description: "Completed-trip revenue per vehicle, from fn_vehicle_revenue_moving_avg. Vehicles are the top ranked on the last day.",
            actions: viewBtn,
          },
          h("div", { class: "filters" }, field({ label: "From", control: fromInput }), field({ label: "To", control: toInput }), field({ label: "Vehicles", control: topSelect })),
          maError,
          maBody,
        ),
        h(
          "div",
          { class: "analytics-grid" },
          panel(
            { title: "Ranking", description: "DENSE_RANK() of the 7-day average on the chosen day; revenue and trips are for that day. Equal averages share a rank.", flush: true, actions: field({ label: "Day", control: rankDate }) },
            rankBody,
          ),
          h(
            "section",
            { class: "panel" },
            h(
              "div",
              { class: "panel__head" },
              h("div", {}, h("h2", { class: "panel__title" }, "Lifetime statistics"), h("p", {}, "From the materialized view mv_vehicle_stats.")),
              refreshBtn,
            ),
            h("div", { class: "panel__body stack stack--tight" }, statsSummary, statsFresh),
          ),
        ),
        h("section", { class: "panel panel--flush" }, h("div", { class: "panel__head" }, h("h2", { class: "panel__title" }, "Per vehicle")), h("div", { class: "panel__body" }, statsTable), h("div", { class: "panel__foot" }, statsFoot)),
      ),
    );

    loadNow();
    loadMovingAverage();
    loadStats();

    return () => {
      for (const c of controllers) c.abort();
      chart?.destroy();
    };
  },
};
