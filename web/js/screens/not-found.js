import { h } from "../lib/dom.js";
import { empty, pageHeader, panel } from "../components/ui.js";

export const notFoundScreen = {
  title: "Page not found",
  render({ outlet, path }) {
    outlet.append(
      pageHeader("Page not found"),
      panel(
        {},
        empty({
          title: `There is no page at ${path}`,
          body: "The link may be from an older version of the app.",
          action: h("a", { class: "btn btn--primary", href: "#/browse" }, "Go to Browse"),
        }),
      ),
    );
  },
};
