import { h } from "../lib/dom.js";

/**
 * Confirmation dialog on the native <dialog> element (focus trap, Escape
 * and backdrop handling come from the browser). Resolves true / false.
 *   if (await confirmDialog({ title: "Complete trip?", confirmLabel: "Complete trip" })) ...
 */
export function confirmDialog({ title, body, confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false }) {
  return new Promise((resolve) => {
    const titleId = `dlg-${Date.now()}`;
    const dlg = h(
      "dialog",
      { class: "dialog", "aria-labelledby": titleId },
      h("form", { method: "dialog" },
        h("div", { class: "dialog__head" }, h("h2", { id: titleId }, title)),
        body ? h("div", { class: "dialog__body" }, body) : null,
        h(
          "div",
          { class: "dialog__foot" },
          h("button", { class: "btn btn--secondary", value: "cancel" }, cancelLabel),
          h("button", { class: `btn ${danger ? "btn--danger" : "btn--primary"}`, value: "confirm", autofocus: true }, confirmLabel),
        ),
      ),
    );
    dlg.addEventListener("close", () => {
      resolve(dlg.returnValue === "confirm");
      dlg.remove();
    });
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) dlg.close("cancel"); // backdrop click
    });
    document.body.append(dlg);
    dlg.showModal();
  });
}
