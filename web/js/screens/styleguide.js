import { DB_ERRORS } from "/shared/errors.js";
import { formatInt, formatMoneyCompact } from "/shared/format.js";
import { confirmDialog } from "../components/dialog.js";
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
  showFieldErrors,
  skeleton,
  statusBadge,
} from "../components/ui.js";
import { ApiError } from "../lib/api.js";
import { h } from "../lib/dom.js";

/**
 * Live style guide (#/styleguide): every token and component in each of its
 * states, rendered by the same code the screens use. docs/design/README.md
 * describes the rules; this page shows them.
 */

const COLORS = [
  ["--paper", "Page background"],
  ["--surface", "Panels, inputs"],
  ["--surface-sunk", "Table header, hover"],
  ["--ink", "Text, primary button"],
  ["--ink-2", "Secondary text"],
  ["--ink-3", "Hints, placeholders"],
  ["--line", "Dividers"],
  ["--line-strong", "Input borders"],
  ["--plate", "License plates only"],
  ["--requested", "Requested"],
  ["--transit", "In transit, credit"],
  ["--completed", "Completed"],
  ["--debit", "Debit, errors"],
  ["--warn", "Warnings, inactive"],
];

const TYPE = [
  ["--text-3xl", "Big figure", "display"],
  ["--text-2xl", "Page title", "display"],
  ["--text-xl", "Section title", "display"],
  ["--text-lg", "Panel title", "display"],
  ["--text-md", "Body text for descriptions and table cells.", "ui"],
  ["--text-sm", "Secondary text, table meta.", "ui"],
  ["--text-xs", "Hints and field errors.", "ui"],
];

const now = Date.now();
const iso = (minAgo) => new Date(now - minAgo * 60_000).toISOString();
const SAMPLE_TRIPS = [
  { id: "2d166ba3-d0d9-4ec5-8d63-38443164f9f6", riderName: "Rider_0042", licensePlate: "MH12AB1004", fareAmount: 250, status: "REQUESTED", createdAt: iso(2) },
  { id: "8a51c0e4-3b7d-4c55-9d1e-0f3a6b2c9e71", riderName: "Rider_0007", licensePlate: "MH04AB1031", fareAmount: 412.5, status: "IN TRANSIT", createdAt: iso(19) },
  { id: "c37f2b90-6e14-4f0a-b8d2-71e5a9c4d306", riderName: "Rider_0913", licensePlate: "MH31AB1077", fareAmount: 180, status: "COMPLETED", createdAt: iso(260) },
];

const section = (title, description, ...body) =>
  h("section", { class: "sg-section stack stack--tight" }, h("h2", {}, title), description ? h("p", { class: "muted" }, description) : null, ...body);

export const styleguideScreen = {
  title: "Style guide",
  render({ outlet }) {
    const css = getComputedStyle(document.documentElement);

    // ---- colour
    const swatches = h(
      "div",
      { class: "swatches" },
      COLORS.map(([token, use]) => {
        const value = css.getPropertyValue(token).trim();
        return h(
          "div",
          { class: "swatch" },
          h("div", { class: "swatch__chip", style: { background: value } }),
          h("div", { class: "swatch__text" }, h("strong", {}, token), h("span", { class: "muted" }, `${value}, ${use}`)),
        );
      }),
    );

    // ---- type
    const type = h(
      "div",
      { class: "stack stack--tight" },
      TYPE.map(([token, sample, face]) =>
        h(
          "div",
          { class: "sg-type" },
          h("code", {}, token),
          h(
            "span",
            { style: { fontSize: `var(${token})`, fontFamily: face === "display" ? "var(--font-display)" : "var(--font-ui)", fontWeight: face === "display" ? "600" : "400", lineHeight: 1.2 } },
            sample,
          ),
        ),
      ),
    );

    // ---- buttons
    const busyBtn = button("Book ride", { variant: "primary" });
    busy(busyBtn, true, "Booking…");
    const buttons = h(
      "div",
      { class: "row" },
      button("Book ride", { variant: "primary" }),
      button("Top up wallet"),
      button("Clear filters", { variant: "ghost" }),
      button("Try to delete", { variant: "danger" }),
      button("Next", { size: "sm" }),
      button("Unavailable", { variant: "primary", disabled: true }),
      busyBtn,
    );

    // ---- form
    const form = h(
      "form",
      { class: "sg-form", novalidate: true, onsubmit: (e) => e.preventDefault() },
      field({ label: "Fare", name: "fare", money: true, hint: "Between ₹1 and ₹10,000", control: input({ inputmode: "decimal", value: "250", money: true }) }),
      field({ label: "Vehicle class", name: "class", control: select([{ value: "", label: "Any class" }, "Sedan", "SUV", "Hatchback"]) }),
      field({ label: "Top-up amount", name: "amount", money: true, control: input({ inputmode: "decimal", value: "0", money: true }) }),
    );
    // show the error state exactly as a 400 VALIDATION response would
    showFieldErrors(form, { amount: ["Amount must be at least 1"] }, { focus: false });

    // ---- errors
    const rs006 = new ApiError(409, {
      code: "RS006",
      title: DB_ERRORS.RS006.title,
      message: DB_ERRORS.RS006.message,
      constraint: "idx_unique_active_rider_trip",
    });
    const rs004 = new ApiError(409, { code: "RS004", title: DB_ERRORS.RS004.title, message: DB_ERRORS.RS004.message });
    const network = new ApiError(0, { code: "NETWORK", title: "Cannot reach the server", message: "The API did not respond. Check that `npm run dev` is running." });

    // ---- table
    let sort = { key: "created_at", order: "desc" };
    const tableHolder = h("div");
    const paintTable = () =>
      tableHolder.replaceChildren(
        dataTable({
          caption: "Sample trips",
          columns: [
            { key: "id", label: "Trip", render: (r) => idText(r.id) },
            { key: "riderName", label: "Rider", sortKey: "rider" },
            { key: "licensePlate", label: "Vehicle", render: (r) => plate(r.licensePlate) },
            { key: "status", label: "Status", render: (r) => statusBadge(r.status) },
            { key: "fareAmount", label: "Fare", num: true, sortKey: "fare", render: (r) => money(r.fareAmount) },
            { key: "createdAt", label: "Booked", sortKey: "created_at", render: (r) => dateTime(r.createdAt, { relative: true }) },
          ],
          rows: SAMPLE_TRIPS,
          sort,
          onSort: (key, order) => {
            sort = { key, order };
            paintTable();
          },
          highlight: (r) => r.status === "REQUESTED",
        }),
      );
    paintTable();

    const dbCodes = dataTable({
      caption: "Database error codes",
      columns: [
        { key: "code", label: "Code", render: (r) => h("code", {}, r.code) },
        { key: "status", label: "HTTP", num: true },
        { key: "title", label: "Title shown" },
        { key: "message", label: "Message shown" },
      ],
      rows: Object.entries(DB_ERRORS).map(([code, e]) => ({ code, ...e })),
    });

    outlet.append(
      pageHeader("Style guide", "The tokens and components every RideSync screen is built from, in each of their states."),
      h(
        "div",
        { class: "stack sg" },
        section(
          "License plate",
          "The one signature element: vehicles always appear as an Indian commercial plate, so a car is recognisable at a glance on every screen. Plate yellow is used for nothing else.",
          h("div", { class: "row" }, plate("MH12AB1004"), plate("MH04AB1031", { large: true }), plate("MH20AB1100", { off: true }), inactiveBadge()),
        ),
        section(
          "Trip status",
          "Colour, dot shape and the word together, so status never depends on colour alone. The In transit dot pulses (not with reduced motion).",
          h("div", { class: "row" }, statusBadge("REQUESTED"), statusBadge("IN TRANSIT"), statusBadge("COMPLETED")),
        ),
        section(
          "Money",
          "Rupees with two decimals and tabular figures, so columns line up. Wallet changes are signed: credits green, debits red, with a true minus sign.",
          h("div", { class: "row" }, money(8548), money(500, { signed: true }), money(-250, { signed: true }), h("span", { class: "money" }, formatMoneyCompact(1490423.5))),
        ),
        section("Colour", "Contrast ratios are in docs/design/README.md. Text colours meet WCAG AA (4.5:1) on their backgrounds.", swatches),
        section("Type", "Barlow for text, Barlow Condensed for headings and figures, on a 1.2 scale from 15px. Figures are tabular everywhere.", type),
        section("Buttons", "One primary action per screen. Busy buttons show a spinner and a new label, and cannot be pressed twice.", buttons),
        section("Form fields", "Labels above fields; hints under them; errors replace nothing and say how to fix the value.", form),
        section(
          "Feedback",
          "Errors stay next to what failed and keep the database's reason visible. Toasts only confirm things that already worked.",
          errorAlert(rs006),
          errorAlert(rs004),
          errorAlert(network, { onRetry: () => toast({ title: "Retrying", body: "In the app this repeats the request." }) }),
          notice("ok", "Ride booked", "₹250.00 was taken from the wallet. The audit trail has a new entry."),
          notice("warn", "Choose a rider first", "Use “Choose a rider” in the header."),
          notice("info", "Statistics are 3 trips behind", "Refresh the view to include the newest trips."),
          h(
            "div",
            { class: "row" },
            button("Show a toast", { onclick: () => toast({ title: "Wallet topped up", body: "₹500.00 added. New balance ₹550.00." }) }),
            button("Show an error toast", { onclick: () => toast({ title: "Rider not found", body: "Choose another rider.", kind: "error" }) }),
            button("Open a confirmation", {
              onclick: async () => {
                const ok = await confirmDialog({ title: "Complete this trip?", body: "The rider and the vehicle become free to book again. This cannot be undone.", confirmLabel: "Complete trip" });
                toast({ title: ok ? "Trip completed" : "Nothing changed" });
              },
            }),
          ),
        ),
        section(
          "Data table",
          "Sortable headers announce their order; the first cell is a real link, so rows work with the keyboard. New rows flash once.",
          panel({ flush: true, foot: pager({ page: 2, pageSize: 20, total: 1000, totalPages: 50, onPage: (p) => toast({ title: `Page ${p}` }) }) }, tableHolder),
        ),
        section(
          "Figures and details",
          null,
          figures([
            { label: "Riders", value: formatInt(1000) },
            { label: "Bookable vehicles", value: "65" },
            { label: "Trips in transit", value: "10" },
            { label: "Revenue today", value: formatMoneyCompact(1490423.5) },
          ]),
          panel({ title: "Trip details" }, kv([["Trip", idText(SAMPLE_TRIPS[0].id)], ["Vehicle", plate("MH12AB1004")], ["Status", statusBadge("REQUESTED")], ["Fare", money(250)], ["Booked", dateTime(SAMPLE_TRIPS[0].createdAt)]])),
        ),
        section(
          "Loading and empty",
          "Skeletons keep the layout still while data loads. Empty states say what to do next.",
          h(
            "div",
            { class: "grid-2" },
            panel({ title: "Loading" }, skeleton(4)),
            panel({}, empty({ title: "No trips on these dates", body: "Widen the date range or clear the filters.", action: button("Clear filters") })),
          ),
        ),
        section("Database error codes", "What the UI shows for each SQLSTATE raised by the procedures and triggers (shared/errors.js).", panel({ flush: true }, dbCodes)),
      ),
    );
  },
};
