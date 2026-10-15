import { h } from "../lib/dom.js";
import { getActor, onActorChange } from "../lib/store.js";
import { empty, notice, pageHeader, panel } from "../components/ui.js";

/** Stand-in for screens built in Phase 4 / 5: shows the purpose and the API it will use. */
export function placeholder({ nav, title, description, phase, endpoints, needsActor = false }) {
  return {
    nav,
    title,
    render({ outlet }) {
      const actorNote = h("div");
      const paint = (actor) =>
        actorNote.replaceChildren(
          needsActor
            ? actor
              ? notice("info", `Acting as ${actor.name}`, "This screen will use the selected rider.")
              : notice("warn", "Choose a rider first", "Use “Choose a rider” in the header. This screen works on one rider's account.")
            : "",
        );
      paint(getActor());
      outlet.append(
        pageHeader(title, description),
        h(
          "div",
          { class: "stack" },
          actorNote,
          panel(
            {},
            empty({
              title: `Built in Phase ${phase}`,
              body: "The API for this screen is ready and documented in docs/api_endpoints.md.",
              action: h("ul", { class: "endpoint-list" }, endpoints.map((e) => h("li", {}, h("code", {}, e)))),
            }),
          ),
        ),
      );
      return onActorChange(paint);
    },
  };
}
