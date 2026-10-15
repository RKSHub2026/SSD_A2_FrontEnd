import { DB_ERRORS } from "/shared/errors.js";
import { formatDateTime, formatMoney, formatRelative, formatSignedMoney, shortId } from "/shared/format.js";
import { h } from "../lib/dom.js";

/**
 * Small presentational components. Each returns a DOM node; class names
 * match web/css/components.css and the catalogue in docs/design/README.md.
 */

/** License plate chip - the one bold element of the design. */
export const plate = (text, { large = false, off = false } = {}) =>
  h("span", { class: `plate${large ? " plate--lg" : ""}${off ? " plate--off" : ""}`, title: off ? "Out of service" : null }, text ?? "—");

const STATUS_CLASS = { REQUESTED: "requested", "IN TRANSIT": "transit", COMPLETED: "completed" };
const STATUS_LABEL = { REQUESTED: "Requested", "IN TRANSIT": "In transit", COMPLETED: "Completed" };

/** Trip status badge; colour + shape + text, so it never relies on colour alone. */
export const statusBadge = (status) =>
  h("span", { class: `status status--${STATUS_CLASS[status] ?? "completed"}` }, STATUS_LABEL[status] ?? status);

export const inactiveBadge = () => h("span", { class: "status status--inactive" }, "Out of service");

/** Money. signed: green "+₹500.00" for credits, red "−₹120.00" for debits. */
export function money(value, { signed = false } = {}) {
  if (!signed) return h("span", { class: "money" }, formatMoney(value));
  const kind = value > 0 ? " money--credit" : value < 0 ? " money--debit" : "";
  return h("span", { class: `money${kind}` }, formatSignedMoney(value));
}

/** <time> with a readable date and the exact ISO value for tooltips. */
export const dateTime = (iso, { relative = false } = {}) =>
  iso
    ? h("time", { datetime: iso, title: formatDateTime(iso) }, relative ? formatRelative(iso) : formatDateTime(iso))
    : h("span", { class: "muted" }, "—");

/** Short UUID with the full value in the tooltip. */
export const idText = (id) => h("span", { class: "id", title: id }, shortId(id));

/** Page title row with optional description and actions. */
export const pageHeader = (title, description, ...actions) =>
  h(
    "header",
    { class: "page-header" },
    h("div", { class: "page-header__text" }, h("h1", {}, title), description ? h("p", {}, description) : null),
    actions.length ? h("div", { class: "page-header__actions" }, actions) : null,
  );

export const panel = ({ title, description, actions, flush = false, foot }, ...body) =>
  h(
    "section",
    { class: `panel${flush ? " panel--flush" : ""}` },
    title
      ? h(
          "div",
          { class: "panel__head" },
          h("div", {}, h("h2", { class: "panel__title" }, title), description ? h("p", {}, description) : null),
          actions ? h("div", { class: "row" }, actions) : null,
        )
      : null,
    h("div", { class: "panel__body" }, body),
    foot ? h("div", { class: "panel__foot" }, foot) : null,
  );

export const figures = (items, { columns } = {}) =>
  h(
    "div",
    { class: `figures${columns ? ` figures--${columns}` : ""}` },
    items.map(({ label, value }) =>
      h("div", { class: "figure" }, h("span", { class: "figure__value" }, value), h("span", { class: "figure__label" }, label)),
    ),
  );

export const kv = (pairs) =>
  h("dl", { class: "kv" }, pairs.filter(Boolean).map(([k, v]) => [h("dt", {}, k), h("dd", {}, v ?? "—")]));

export const button = (label, { variant = "secondary", size, ...attrs } = {}) =>
  h("button", { type: "button", class: `btn btn--${variant}${size ? ` btn--${size}` : ""}`, ...attrs }, label);

/** Sets / clears the busy state of a button while a request runs. */
export function busy(btn, on, busyLabel) {
  btn.disabled = on;
  btn.setAttribute("aria-busy", on ? "true" : "false");
  if (busyLabel) {
    btn.dataset.label ??= btn.textContent;
    btn.textContent = on ? busyLabel : btn.dataset.label;
  }
}

// ------------------------------------------------------------------ forms

let fieldSeq = 0;

/**
 * Label + control + hint + error, wired with for/id and aria-describedby.
 * control: an <input>/<select> element (gets an id if it has none).
 */
export function field({ label, hint, name, control, money: isMoney = false }) {
  const id = control.id || `f${++fieldSeq}`;
  control.id = id;
  if (name) control.name = name;
  const hintEl = hint ? h("span", { class: "field__hint", id: `${id}-hint` }, hint) : null;
  const errorEl = h("span", { class: "field__error", id: `${id}-error`, hidden: true });
  control.setAttribute("aria-describedby", [hintEl ? `${id}-hint` : null, `${id}-error`].filter(Boolean).join(" "));
  return h(
    "div",
    { class: "field", dataset: { field: name ?? "" } },
    h("label", { class: "field__label", for: id }, label),
    isMoney ? h("div", { class: "money-wrap" }, control) : control,
    hintEl,
    errorEl,
  );
}

export const input = (attrs = {}) => h("input", { class: `input${attrs.money ? " input--money" : ""}`, type: "text", ...attrs, money: null });

export const select = (options, attrs = {}) =>
  h(
    "select",
    { class: "select", ...attrs },
    options.map((o) => (typeof o === "string" ? { value: o, label: o } : o)).map((o) => h("option", { value: o.value, selected: o.value === attrs.value }, o.label)),
  );

/**
 * Shows the API's per-field messages (400 VALIDATION) next to the fields and,
 * after a submit, moves focus to the first invalid one.
 */
export function showFieldErrors(form, fieldErrors, { focus = true } = {}) {
  for (const el of form.querySelectorAll(".field")) {
    const msgs = fieldErrors?.[el.dataset.field];
    const err = el.querySelector(".field__error");
    const control = el.querySelector("input, select, textarea");
    el.classList.toggle("field--invalid", Boolean(msgs));
    control?.setAttribute("aria-invalid", msgs ? "true" : "false");
    if (err) {
      err.hidden = !msgs;
      err.textContent = msgs ? msgs[0] : "";
    }
  }
  if (focus) form.querySelector(".field--invalid input, .field--invalid select")?.focus();
}

// ------------------------------------------------------------------ feedback

/**
 * Inline error for a failed request. For RS006 / RS007 it names the partial
 * unique index that blocked the booking; for RS004 the CHECK constraint.
 */
export function errorAlert(err, { onRetry, actions } = {}) {
  const meta = [];
  if (err?.code) meta.push(h("span", {}, "Code ", h("code", {}, err.code)));
  if (err?.constraint) meta.push(h("span", {}, "Blocked by ", h("code", {}, err.constraint)));
  else if (err?.code === "RS004") meta.push(h("span", {}, "Blocked by ", h("code", {}, "CHECK (wallet_balance >= 0)")));
  else if (err?.code === "RS010") meta.push(h("span", {}, "Blocked by ", h("code", {}, "trg_wallet_audit_immutable")));
  return h(
    "div",
    { class: "alert alert--error", role: "alert" },
    h("span", { class: "alert__icon", "aria-hidden": "true" }, "!"),
    h("span", { class: "alert__title" }, err?.title ?? "Something went wrong"),
    h("span", {}, err?.message ?? String(err)),
    meta.length || onRetry || actions
      ? h("span", { class: "alert__meta" }, meta, onRetry ? h("button", { type: "button", class: "btn btn--sm btn--secondary", onclick: onRetry }, "Try again") : null, actions ?? null)
      : null,
  );
}

export const notice = (kind, title, body) =>
  h(
    "div",
    { class: `alert alert--${kind}`, role: kind === "error" ? "alert" : "status" },
    h("span", { class: "alert__icon", "aria-hidden": "true" }, kind === "ok" ? "✓" : kind === "warn" ? "!" : "i"),
    h("span", { class: "alert__title" }, title),
    body ? h("span", {}, body) : null,
  );

export const empty = ({ title, body, action }) =>
  h("div", { class: "empty" }, h("p", { class: "empty__title" }, title), body ? h("p", {}, body) : null, action ?? null);

export const skeleton = (rows = 5) =>
  h(
    "div",
    { class: "skeleton", "aria-busy": "true", "aria-label": "Loading" },
    Array.from({ length: rows }, (_, i) => h("div", { class: "skeleton__bar", style: { width: `${92 - ((i * 17) % 40)}%` } })),
  );

/** Human message for every RS code, for docs and the style guide. */
export const dbErrorCatalogue = () => Object.entries(DB_ERRORS);
