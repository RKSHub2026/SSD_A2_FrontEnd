import { formatMoney } from "/shared/format.js";
import { api, isAbort } from "../lib/api.js";
import { debounce, h, mount, storage } from "../lib/dom.js";
import { getActor, onActorChange, setActor } from "../lib/store.js";

/**
 * Actor switcher (header). Picks the rider the operator is acting for.
 *
 * Keyboard: the button opens a popover with a search box (combobox).
 * Arrow Up/Down move through the list, Enter picks, Escape closes and
 * returns focus to the button. Typing searches /api/riders by name or id.
 * "Lowest balance" lists the poorest riders first - handy for showing the
 * insufficient-balance (RS004) case.
 */
const RECENT_KEY = "ridesync.recentRiders";

export function actorSwitcher() {
  let open = false;
  let options = []; // riders currently listed
  let active = -1; // keyboard-highlighted index
  let sort = "name";
  let controller = null;

  const button = h("button", {
    type: "button",
    class: "actor__button",
    "aria-haspopup": "dialog",
    "aria-expanded": "false",
    onclick: () => (open ? close() : show()),
  });

  const searchId = "actor-search";
  const listId = "actor-list";
  const search = h("input", {
    id: searchId,
    class: "input",
    type: "search",
    placeholder: "Search by name or paste a rider id",
    autocomplete: "off",
    role: "combobox",
    "aria-expanded": "true",
    "aria-controls": listId,
    "aria-autocomplete": "list",
  });
  const list = h("ul", { id: listId, class: "actor__list", role: "listbox", "aria-label": "Riders" });
  const status = h("p", { class: "small muted", "aria-live": "polite" });
  const sortTabs = h(
    "div",
    { class: "tabs", role: "group", "aria-label": "Order" },
    [
      ["name", "By name"],
      ["balance", "Lowest balance"],
    ].map(([value, label]) =>
      h("button", { type: "button", "aria-pressed": String(value === sort), dataset: { sort: value }, onclick: () => setSort(value) }, label),
    ),
  );
  const clearBtn = h("button", { type: "button", class: "btn btn--ghost btn--sm", onclick: () => choose(null) }, "Stop acting as a rider");

  // shown only while a rider is selected
  const clearRow = h("div", {}, h("hr", { class: "actor__divider" }), h("div", { class: "row row--end" }, clearBtn));

  const popover = h(
    "div",
    { class: "actor__popover", role: "dialog", "aria-label": "Choose the rider to act as", hidden: true },
    h("label", { class: "field__label", for: searchId }, "Act as rider"),
    search,
    h("div", { class: "row" }, sortTabs),
    status,
    list,
    clearRow,
  );

  const root = h("div", { class: "actor" }, button, popover);

  // ------------------------------------------------------------ rendering
  function renderButton(actor) {
    mount(
      button,
      actor
        ? [
            h("span", { class: "actor__prefix" }, "Acting as"),
            h("span", { class: "actor__name" }, actor.name),
            h("span", { class: "actor__balance money" }, formatMoney(actor.walletBalance)),
          ]
        : [h("span", { class: "actor__name" }, "Choose a rider")],
      h("span", { class: "actor__caret", "aria-hidden": "true" }, "▾"),
    );
    button.setAttribute("aria-label", actor ? `Acting as ${actor.name}, wallet ${formatMoney(actor.walletBalance)}. Change rider` : "Choose a rider to act as");
    clearRow.hidden = !actor;
  }

  function renderList() {
    const current = getActor();
    list.replaceChildren(
      ...options.map((r, i) =>
        h(
          "li",
          {
            id: `actor-opt-${i}`,
            class: "actor__option",
            role: "option",
            "aria-selected": String(i === active),
            dataset: { active: String(current?.id === r.id) },
            onmousedown: (e) => e.preventDefault(), // keep focus in the search box
            onclick: () => choose(r),
          },
          h("span", {}, h("span", { class: "actor__option-name" }, r.name), r.recent ? h("span", { class: "actor__option-sub" }, " recent") : null),
          h("span", { class: "actor__option-sub money" }, formatMoney(r.walletBalance)),
        ),
      ),
    );
    if (active >= 0) {
      search.setAttribute("aria-activedescendant", `actor-opt-${active}`);
      list.children[active]?.scrollIntoView({ block: "nearest" });
    } else {
      search.removeAttribute("aria-activedescendant");
    }
  }

  // ------------------------------------------------------------ data
  async function load() {
    controller?.abort();
    controller = new AbortController();
    const q = search.value.trim();
    status.textContent = "Loading riders…";
    try {
      const res = await api.get(
        "/riders",
        { q, pageSize: 8, sort: sort === "balance" ? "wallet_balance" : "name", order: "asc" },
        { signal: controller.signal },
      );
      const recent = !q && sort === "name" ? (storage.get(RECENT_KEY) ?? []).map((r) => ({ ...r, recent: true })) : [];
      const seen = new Set(recent.map((r) => r.id));
      options = [...recent, ...res.items.filter((r) => !seen.has(r.id))];
      active = options.length ? 0 : -1;
      status.textContent = res.total === 0 ? `No rider matches “${q}”.` : q ? `${res.total} matching riders` : "";
      renderList();
    } catch (err) {
      if (isAbort(err)) return;
      options = [];
      active = -1;
      renderList();
      status.textContent = `Could not load riders: ${err.message}`;
    }
  }
  const loadDebounced = debounce(load, 200);

  function setSort(value) {
    sort = value;
    for (const b of sortTabs.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.sort === value));
    load();
    search.focus();
  }

  function choose(rider) {
    setActor(rider);
    if (rider) {
      const recent = (storage.get(RECENT_KEY) ?? []).filter((r) => r.id !== rider.id);
      storage.set(RECENT_KEY, [{ id: rider.id, name: rider.name, walletBalance: rider.walletBalance }, ...recent].slice(0, 3));
    }
    close();
  }

  // ------------------------------------------------------------ open / close
  function show() {
    open = true;
    popover.hidden = false;
    button.setAttribute("aria-expanded", "true");
    search.value = "";
    load();
    search.focus();
    document.addEventListener("pointerdown", onOutside, true);
  }

  function close({ focusButton = true } = {}) {
    if (!open) return;
    open = false;
    popover.hidden = true;
    button.setAttribute("aria-expanded", "false");
    controller?.abort();
    document.removeEventListener("pointerdown", onOutside, true);
    if (focusButton) button.focus();
  }

  function onOutside(e) {
    if (!root.contains(e.target)) close({ focusButton: false });
  }

  search.addEventListener("input", loadDebounced);
  search.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!options.length) return;
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
      renderList();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (options[active]) choose(options[active]);
    }
  });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      close();
    }
  });

  renderButton(getActor());
  onActorChange(renderButton);
  return root;
}
