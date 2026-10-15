import { FARE_LIMITS } from "/shared/constants.js";
import { formatMoney } from "/shared/format.js";
import { toast } from "../components/toast.js";
import { tripActions } from "../components/trip-actions.js";
import {
  busy,
  button,
  dateTime,
  empty,
  errorAlert,
  field,
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
import { api, isAbort } from "../lib/api.js";
import { debounce, h } from "../lib/dom.js";
import { href } from "../lib/router.js";
import { getActor, onActorChange, refreshActor } from "../lib/store.js";

/**
 * Book a ride (Workflow 1) for the rider chosen in the header.
 *   left:  vehicle picker + fare -> POST /api/trips, then the result
 *   right: wallet (top-up) and the rider's active trip (status buttons)
 * Failures are shown with the database's reason and the next step.
 */
export const bookScreen = {
  nav: "book",
  title: "Book a ride",
  render(ctx) {
    let teardown = null;
    const paint = () => {
      teardown?.();
      ctx.outlet.replaceChildren();
      teardown = paintBook(ctx, getActor());
    };
    paint();
    const off = onActorChange((a) => {
      // the balance changes after every booking; only repaint for a different rider
      if (a?.id !== current?.id) paint();
      current = a;
    });
    let current = getActor();
    return () => {
      off();
      teardown?.();
    };
  },
};

function paintBook(ctx, actor) {
  if (!actor) {
    ctx.outlet.append(
      pageHeader("Book a ride", "Book a ride for a rider, move it through its statuses and top up the wallet."),
      panel(
        {},
        empty({
          title: "Choose a rider first",
          body: "Bookings are made for one rider. Pick the rider you are acting for in the header.",
          action: button("Choose a rider", { variant: "primary", onclick: () => document.querySelector(".actor__button")?.click() }),
        }),
      ),
    );
    return null;
  }

  const controllers = new Set();
  const track = () => {
    const c = new AbortController();
    controllers.add(c);
    return c;
  };

  // ----------------------------------------------------------- vehicle picker
  const pickerState = { q: "", class: "", includeAll: false, selected: ctx.query.vehicleId ?? null };
  const vehicleList = h("div", { class: "vehicle-list", role: "radiogroup", "aria-labelledby": "vehicle-legend" });
  const vehicleStatus = h("p", { class: "small muted", "aria-live": "polite" });
  const vehicleError = h("span", { class: "field__error", id: "vehicle-error", hidden: true });
  let vehicleController = null;

  const vehicleOption = (v) => {
    const unavailable = !v.isActive || v.hasActiveTrip;
    const radio = h("input", {
      type: "radio",
      name: "vehicleId",
      value: v.id,
      checked: v.id === pickerState.selected,
      onchange: () => {
        pickerState.selected = v.id;
        vehicleError.hidden = true;
      },
    });
    return h(
      "label",
      { class: `vehicle-option${unavailable ? " vehicle-option--unavailable" : ""}` },
      radio,
      plate(v.licensePlate, { off: !v.isActive }),
      h("span", { class: "vehicle-option__class" }, v.class),
      !v.isActive ? inactiveBadge() : v.hasActiveTrip ? h("span", { class: "status status--requested" }, "On a trip") : null,
      h("span", { class: "vehicle-option__meta" }, `${v.totalTrips} trips`),
    );
  };

  async function loadVehicles() {
    vehicleController?.abort();
    vehicleController = track();
    vehicleStatus.textContent = "Loading vehicles…";
    try {
      const res = await api.get(
        "/vehicles",
        { q: pickerState.q, class: pickerState.class, available: pickerState.includeAll ? undefined : true, pageSize: 100, sort: "license_plate" },
        { signal: vehicleController.signal },
      );
      let items = res.items;
      // a vehicle chosen elsewhere (map, vehicle detail) stays visible
      if (pickerState.selected && !items.some((v) => v.id === pickerState.selected)) {
        try {
          const chosen = await api.get(`/vehicles/${pickerState.selected}`, undefined, { signal: vehicleController.signal });
          items = [chosen, ...items];
        } catch (err) {
          if (isAbort(err)) throw err;
          pickerState.selected = null;
        }
      }
      vehicleList.replaceChildren(...items.map(vehicleOption));
      vehicleStatus.textContent = items.length
        ? `${res.total} ${pickerState.includeAll ? "vehicles" : "vehicles free to book"}${res.total > items.length ? `, first ${items.length} shown` : ""}`
        : "No vehicle matches. Change the search or include busy vehicles.";
    } catch (err) {
      if (isAbort(err)) return;
      vehicleList.replaceChildren(errorAlert(err, { onRetry: loadVehicles }));
      vehicleStatus.textContent = "";
    }
  }

  const search = input({ type: "search", placeholder: "Search plate", autocomplete: "off", "aria-label": "Search vehicles by plate" });
  search.addEventListener(
    "input",
    debounce(() => {
      pickerState.q = search.value.trim();
      loadVehicles();
    }, 250),
  );
  const classSelect = select([{ value: "", label: "Any class" }, "Sedan", "SUV", "Hatchback"], {
    "aria-label": "Vehicle class",
    onchange: (e) => {
      pickerState.class = e.target.value;
      loadVehicles();
    },
  });
  const includeAll = h("input", {
    type: "checkbox",
    onchange: (e) => {
      pickerState.includeAll = e.target.checked;
      loadVehicles();
    },
  });

  const vehicleField = h(
    "fieldset",
    { class: "field vehicle-picker", dataset: { field: "vehicleId" }, "aria-describedby": "vehicle-error" },
    h("legend", { class: "field__label", id: "vehicle-legend" }, "Vehicle"),
    h("div", { class: "vehicle-picker__tools" }, search, classSelect),
    h("label", { class: "check" }, includeAll, " Include busy and out-of-service vehicles (to see the booking fail)"),
    vehicleStatus,
    vehicleList,
    vehicleError,
  );

  // ----------------------------------------------------------- fare + submit
  const fareInput = input({ inputmode: "decimal", value: ctx.query.fare ?? "250", money: true, autocomplete: "off" });
  const bookBtn = h("button", { type: "submit", class: "btn btn--primary" }, "Book ride");
  const result = h("div", { class: "book-result", "aria-live": "polite" });

  const form = h(
    "form",
    { class: "stack stack--tight", novalidate: true },
    vehicleField,
    field({ label: "Fare", name: "fare", money: true, hint: `Between ${formatMoney(FARE_LIMITS.min)} and ${formatMoney(FARE_LIMITS.max)}. It is taken from the wallet when the ride is booked.`, control: fareInput }),
    h("div", { class: "row" }, bookBtn),
    result,
  );

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    result.replaceChildren();
    showFieldErrors(form, null, { focus: false });
    if (!pickerState.selected) {
      vehicleError.textContent = "Choose a vehicle from the list.";
      vehicleError.hidden = false;
      vehicleList.querySelector("input")?.focus();
      return;
    }
    busy(bookBtn, true, "Booking…");
    const before = getActor();
    try {
      const res = await api.post("/trips", { riderId: before.id, vehicleId: pickerState.selected, fare: fareInput.value.trim() });
      result.replaceChildren(bookedResult(res));
      toast({ title: "Ride booked", body: `${formatMoney(res.trip.fareAmount)} taken from ${res.trip.riderName}'s wallet.` });
      pickerState.selected = null;
      await refreshActor();
      loadVehicles();
      loadSide();
    } catch (err) {
      if (err.code === "VALIDATION" && err.fieldErrors) {
        showFieldErrors(form, err.fieldErrors);
        if (err.fieldErrors.vehicleId) {
          vehicleError.textContent = err.fieldErrors.vehicleId[0];
          vehicleError.hidden = false;
        }
      }
      result.replaceChildren(failedResult(err));
      if (err.code === "RS001") refreshActor();
    } finally {
      busy(bookBtn, false, "Booking…");
    }
  });

  function bookedResult(res) {
    const a = res.auditEntry;
    return h(
      "div",
      { class: "alert alert--ok", role: "status" },
      h("span", { class: "alert__icon", "aria-hidden": "true" }, "✓"),
      h("span", { class: "alert__title" }, "Ride booked"),
      h(
        "div",
        { class: "stack stack--tight" },
        h("p", {}, `${res.trip.riderName} is booked on `, plate(res.trip.licensePlate), ` for ${formatMoney(res.trip.fareAmount)}. The trip and the wallet deduction were saved together in one transaction.`),
        h(
          "div",
          { class: "balance-change" },
          h("span", {}, "Wallet"),
          money(res.wallet.balanceBefore),
          h("span", { "aria-hidden": "true" }, "→"),
          h("strong", {}, money(res.wallet.balanceAfter)),
        ),
        h("p", { class: "small" }, "New audit entry written by the trigger:"),
        kv([
          ["Type", "Fare deduction"],
          ["Change", money(a.amountChanged, { signed: true })],
          ["Balance after", money(a.balanceAfter)],
          ["Linked trip", idText(a.tripId)],
          ["When", dateTime(a.timestamp)],
        ]),
        h(
          "div",
          { class: "row" },
          h("a", { class: "btn btn--sm btn--secondary", href: `#/browse/trips/${res.trip.id}` }, "Open the trip"),
          h("a", { class: "btn btn--sm btn--ghost", href: href("/audit", { highlight: a.id }) }, "See it in the audit trail"),
        ),
      ),
    );
  }

  function failedResult(err) {
    const actions = [];
    if (err.code === "RS004") {
      actions.push(
        button("Top up wallet", {
          size: "sm",
          onclick: () => {
            const shortfall = Math.ceil(Number(fareInput.value) - (getActor()?.walletBalance ?? 0));
            topUpInput.value = String(Math.max(100, shortfall));
            topUpInput.focus();
          },
        }),
      );
    } else if (err.code === "RS006") {
      actions.push(button("Go to the active trip", { size: "sm", onclick: () => sideTrip.querySelector("button, a")?.focus() }));
    } else if (["RS002", "RS003", "RS007"].includes(err.code)) {
      actions.push(
        button("Choose another vehicle", {
          size: "sm",
          onclick: () => {
            pickerState.selected = null;
            loadVehicles();
            search.focus();
          },
        }),
      );
    }
    const box = h("div", { class: "stack stack--tight" }, errorAlert(err, { actions }));
    if (err.code?.startsWith("RS")) box.append(h("p", { class: "small muted" }, "Nothing was charged and no trip was created: the database rolled the whole booking back."));
    return box;
  }

  // ----------------------------------------------------------- side: wallet + active trip
  const balanceEl = h("p", { class: "wallet__balance" }, formatMoney(actor.walletBalance));
  const topUpInput = input({ inputmode: "decimal", money: true, placeholder: "500", autocomplete: "off" });
  const topUpBtn = h("button", { type: "submit", class: "btn btn--secondary" }, "Top up wallet");
  const topUpResult = h("div", { "aria-live": "polite" });
  const topUpForm = h(
    "form",
    { class: "stack stack--tight", novalidate: true },
    h("div", { class: "topup-row" }, field({ label: "Amount", name: "amount", money: true, control: topUpInput }), topUpBtn),
    topUpResult,
  );
  topUpForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    topUpResult.replaceChildren();
    showFieldErrors(topUpForm, null, { focus: false });
    busy(topUpBtn, true, "Topping up…");
    try {
      const res = await api.post(`/riders/${getActor().id}/top-up`, { amount: topUpInput.value.trim() });
      topUpInput.value = "";
      toast({ title: "Wallet topped up", body: `${formatMoney(res.auditEntry.amountChanged)} added. New balance ${formatMoney(res.walletBalance)}.` });
      topUpResult.replaceChildren(notice("ok", "Wallet topped up", `${formatMoney(res.auditEntry.balanceBefore)} → ${formatMoney(res.walletBalance)}. The audit trail has a new TOP_UP entry.`));
      await refreshActor();
    } catch (err) {
      if (err.code === "VALIDATION" && err.fieldErrors) showFieldErrors(topUpForm, err.fieldErrors);
      else topUpResult.replaceChildren(errorAlert(err));
    } finally {
      busy(topUpBtn, false, "Topping up…");
    }
  });
  const offBalance = onActorChange((a) => a && (balanceEl.textContent = formatMoney(a.walletBalance)));

  const sideTrip = h("div", {}, skeleton(3));
  async function loadSide() {
    const c = track();
    try {
      const r = await api.get(`/riders/${actor.id}`, undefined, { signal: c.signal });
      const t = r.activeTrip;
      sideTrip.replaceChildren(
        t
          ? h(
              "div",
              { class: "stack stack--tight" },
              kv([
                ["Vehicle", plate(t.licensePlate)],
                ["Status", statusBadge(t.status)],
                ["Fare", money(t.fareAmount)],
                ["Booked", dateTime(t.createdAt)],
                ["Trip", h("a", { href: `#/browse/trips/${t.id}` }, idText(t.id))],
              ]),
              tripActions(t, {
                onChanged: async (res) => {
                  await loadSide();
                  if (res.released) loadVehicles();
                },
              }),
              notice("info", "Booking again will fail", "While this trip is active, a second booking for this rider is blocked by idx_unique_active_rider_trip (RS006). Try it to see the error."),
            )
          : empty({ title: "No active trip", body: "Book a ride on the left. It appears here so you can start and complete it." }),
      );
    } catch (err) {
      if (!isAbort(err)) sideTrip.replaceChildren(errorAlert(err, { onRetry: loadSide }));
    }
  }

  // ----------------------------------------------------------- layout
  ctx.outlet.append(
    pageHeader(`Book a ride for ${actor.name}`, "Pick a vehicle and a fare. The trip and the wallet deduction are saved together, or not at all."),
    h(
      "div",
      { class: "book-layout" },
      panel({ title: "New booking" }, form),
      h(
        "div",
        { class: "stack" },
        panel({ title: "Wallet", description: "Topping up writes a TOP_UP row to the audit trail." }, balanceEl, topUpForm),
        panel({ title: "Active trip" }, sideTrip),
      ),
    ),
  );

  loadVehicles();
  loadSide();

  return () => {
    offBalance();
    for (const c of controllers) c.abort();
  };
}
