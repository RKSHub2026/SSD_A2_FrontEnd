import { formatInt, formatMoney } from "/shared/format.js";
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
  input,
  money,
  notice,
  pageHeader,
  panel,
  select,
  skeleton,
} from "../components/ui.js";
import { api, isAbort } from "../lib/api.js";
import { h } from "../lib/dom.js";
import { replaceQuery } from "../lib/router.js";
import { getActor, onActorChange, setActor } from "../lib/store.js";

/**
 * Audit trail: every wallet change of one rider (wallet_audit_logs, written
 * only by the trigger), newest first, with the running balance.
 *   #/audit                     the rider chosen in the header
 *   #/audit?riderId=…           any rider (link from a rider's page)
 *   #/audit?highlight=<audit id> flashes the row just created by a booking
 * "Try to delete" calls DELETE /api/audit/:id, which the database always
 * refuses (RS010) - the log is append-only.
 */
const KEYS = ["riderId", "from", "to", "action", "order", "page", "highlight"];
const DEFAULTS = { order: "desc", page: 1 };

export const auditScreen = {
  nav: "audit",
  title: "Audit trail",
  render(ctx) {
    let teardown = null;
    let shownFor = null;
    const paint = () => {
      teardown?.();
      ctx.outlet.replaceChildren();
      const riderId = ctx.query.riderId ?? getActor()?.id ?? null;
      shownFor = riderId;
      teardown = paintAudit(ctx, riderId);
    };
    paint();
    // follow the header switcher unless a specific rider is in the URL
    const off = onActorChange((a) => {
      if (!ctx.query.riderId && a?.id !== shownFor) paint();
    });
    return () => {
      off();
      teardown?.();
    };
  },
};

function paintAudit(ctx, riderId) {
  if (!riderId) {
    ctx.outlet.append(
      pageHeader("Audit trail", "Every change to a rider's wallet, with the balance after each one."),
      panel(
        {},
        empty({
          title: "Choose a rider first",
          body: "The audit trail shows one rider's wallet. Pick the rider in the header, or open a rider from Browse.",
          action: button("Choose a rider", { variant: "primary", onclick: () => document.querySelector(".actor__button")?.click() }),
        }),
      ),
    );
    return null;
  }

  const state = { ...DEFAULTS };
  for (const k of KEYS) if (ctx.query[k]) state[k] = k === "page" ? Number(ctx.query[k]) || 1 : ctx.query[k];
  let controller = null;

  const header = h("div");
  const summary = h("div");
  const deleteFeedback = h("div", { "aria-live": "polite" });
  const results = h("div", {}, skeleton(8));
  const foot = h("div");

  const update = (patch) => {
    Object.assign(state, patch);
    if (!("page" in patch)) state.page = 1;
    delete state.highlight;
    const q = Object.fromEntries(KEYS.map((k) => [k, state[k] === DEFAULTS[k] ? undefined : state[k]]));
    replaceQuery(q, { silent: true });
    clearBtn.hidden = !(state.from || state.to || state.action);
    load();
  };

  const fromInput = input({ type: "date", value: state.from ?? "", onchange: (e) => update({ from: e.target.value || undefined }) });
  const toInput = input({ type: "date", value: state.to ?? "", onchange: (e) => update({ to: e.target.value || undefined }) });
  const actionSelect = select(
    [
      { value: "", label: "All changes" },
      { value: "TOP_UP", label: "Top-ups" },
      { value: "FARE_DEDUCTION", label: "Fare deductions" },
    ],
    { value: state.action ?? "", onchange: (e) => update({ action: e.target.value || undefined }) },
  );
  const clearBtn = button("Clear filters", {
    variant: "ghost",
    hidden: !(state.from || state.to || state.action),
    onclick: () => {
      fromInput.value = "";
      toInput.value = "";
      actionSelect.value = "";
      update({ from: undefined, to: undefined, action: undefined });
    },
  });

  async function tryDelete(row, btn) {
    deleteFeedback.replaceChildren();
    busy(btn, true);
    try {
      await api.del(`/audit/${row.id}`);
      deleteFeedback.replaceChildren(notice("warn", "The entry was deleted", "The append-only guard did not stop it. Check sql/03_triggers_and_audit.sql."));
    } catch (err) {
      if (err.code === "RS010") {
        deleteFeedback.replaceChildren(
          h(
            "div",
            { class: "stack stack--tight" },
            errorAlert(err),
            h("p", { class: "small muted" }, `The entry from ${new Date(row.timestamp).toLocaleString("en-IN")} is unchanged. The database refuses any UPDATE or DELETE on wallet_audit_logs.`),
          ),
        );
        toast({ title: "Delete refused by the database", body: "Audit entries cannot be changed." });
      } else {
        deleteFeedback.replaceChildren(errorAlert(err));
      }
    } finally {
      busy(btn, false);
    }
    deleteFeedback.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  async function load() {
    controller?.abort();
    controller = new AbortController();
    results.setAttribute("aria-busy", "true");
    const { highlight, ...query } = state;
    try {
      const data = await api.get(`/riders/${riderId}/audit`, { ...query, riderId: undefined, pageSize: 20 }, { signal: controller.signal });
      paintHeader(data.rider);
      const s = data.summary;
      summary.replaceChildren(
        figures([
          { label: `Top-ups (${formatInt(s.topUpCount)})`, value: formatMoney(s.topUpTotal) },
          { label: `Fare deductions (${formatInt(s.deductionCount)})`, value: formatMoney(s.deductionTotal) },
          { label: "Net change", value: h("span", {}, money(s.netChange, { signed: true })) },
          { label: "Entries", value: formatInt(data.total) },
        ]),
      );
      if (data.items.length === 0) {
        results.replaceChildren(
          empty({
            title: state.from || state.to || state.action ? "No wallet changes match these filters" : "No wallet changes yet",
            body: state.from || state.to || state.action ? "Widen the date range or clear the filters." : "Book a ride or top up the wallet and the change appears here.",
          }),
        );
        foot.replaceChildren();
        return;
      }
      results.replaceChildren(
        dataTable({
          caption: `Wallet changes for ${data.rider.name}`,
          columns: [
            { key: "timestamp", label: "When", sortKey: "timestamp", render: (r) => dateTime(r.timestamp) },
            { key: "actionType", label: "Type", render: (r) => h("span", { class: `change-type change-type--${r.actionType === "TOP_UP" ? "credit" : "debit"}` }, r.actionType === "TOP_UP" ? "Top-up" : "Fare deduction") },
            { key: "amountChanged", label: "Change", num: true, render: (r) => money(r.amountChanged, { signed: true }) },
            { key: "balanceBefore", label: "Before", num: true, render: (r) => money(r.balanceBefore) },
            { key: "balanceAfter", label: "After", num: true, render: (r) => h("strong", {}, money(r.balanceAfter)) },
            { key: "tripId", label: "Trip", render: (r) => (r.tripId ? h("a", { href: `#/browse/trips/${r.tripId}` }, idText(r.tripId)) : h("span", { class: "muted" }, "—")) },
            {
              key: "actions",
              label: h("span", { class: "visually-hidden" }, "Actions"),
              render: (r) => {
                const b = h("button", { type: "button", class: "btn btn--sm btn--ghost", title: "Shows that audit entries cannot be deleted" }, "Try to delete");
                b.addEventListener("click", () => tryDelete(r, b));
                return b;
              },
            },
          ],
          rows: data.items,
          sort: { key: "timestamp", order: state.order },
          onSort: (_k, order) => update({ order }),
          highlight: (r) => r.id === highlight,
        }),
      );
      foot.replaceChildren(pager({ ...data, onPage: (page) => update({ page }) }));
    } catch (err) {
      if (isAbort(err)) return;
      if (err.status === 404) {
        paintHeader(null);
        results.replaceChildren(empty({ title: "Rider not found", body: "This rider does not exist. Choose another one in the header." }));
      } else {
        results.replaceChildren(h("div", { class: "panel__body" }, errorAlert(err, { onRetry: load })));
      }
      summary.replaceChildren();
      foot.replaceChildren();
    } finally {
      results.setAttribute("aria-busy", "false");
    }
  }

  function paintHeader(rider) {
    const actor = getActor();
    const viewingOther = rider && actor?.id !== rider.id;
    header.replaceChildren(
      pageHeader(
        rider ? `Audit trail: ${rider.name}` : "Audit trail",
        "Every change to the wallet, written by the database trigger. Entries can never be edited or deleted.",
        rider ? h("div", { class: "wallet-now" }, h("span", { class: "small muted" }, "Wallet now"), h("strong", {}, formatMoney(rider.walletBalance))) : null,
      ),
      viewingOther
        ? h(
            "div",
            { class: "row viewing-other" },
            h("span", { class: "small muted" }, `You are viewing ${rider.name}, not the rider you are acting as.`),
            button("Act as this rider", { size: "sm", onclick: () => setActor(rider) }),
          )
        : "",
    );
  }

  ctx.outlet.append(
    header,
    h(
      "div",
      { class: "stack stack--tight" },
      h(
        "div",
        { class: "filters" },
        field({ label: "From", control: fromInput }),
        field({ label: "To", control: toInput }),
        field({ label: "Type", control: actionSelect }),
        h("div", { class: "filters__actions" }, clearBtn),
      ),
      summary,
      deleteFeedback,
      h("section", { class: "panel panel--flush" }, h("div", { class: "panel__body" }, results), h("div", { class: "panel__foot" }, foot)),
    ),
  );
  load();
  return () => controller?.abort();
}
