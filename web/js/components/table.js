import { h } from "../lib/dom.js";
import { formatInt } from "/shared/format.js";

/**
 * Data table.
 *   columns: [{ key, label, num?, sortKey?, render?(row) }]
 *   rows:    array of objects
 *   sort:    { key, order } - current sort (matches a column's sortKey)
 *   onSort:  (sortKey, order) => void
 *   rowLink: (row) => href   - first cell becomes a real link (keyboard
 *            and screen readers), and clicking anywhere on the row follows it.
 *   caption: accessible name (visually hidden)
 */
export function dataTable({ columns, rows, sort, onSort, rowLink, caption, highlight }) {
  const head = h(
    "tr",
    {},
    columns.map((c) => {
      const active = sort && c.sortKey && sort.key === c.sortKey;
      const ariaSort = active ? (sort.order === "asc" ? "ascending" : "descending") : c.sortKey ? "none" : null;
      const label = c.sortKey && onSort
        ? h(
            "button",
            {
              type: "button",
              class: "sort-btn",
              onclick: () => onSort(c.sortKey, active && sort.order === "asc" ? "desc" : "asc"),
            },
            c.label,
          )
        : c.label;
      return h("th", { scope: "col", class: c.num ? "num" : null, "aria-sort": ariaSort }, label);
    }),
  );

  const body = rows.map((row) => {
    const link = rowLink?.(row);
    const tr = h(
      "tr",
      { "data-href": link ?? null, class: highlight?.(row) ? "is-new" : null },
      columns.map((c, i) => {
        const content = c.render ? c.render(row) : row[c.key];
        const cell = i === 0 && link ? h("a", { href: link, class: "row-link" }, content) : content;
        return h(i === 0 ? "th" : "td", { scope: i === 0 ? "row" : null, class: c.num ? "num" : null }, cell);
      }),
    );
    if (link) {
      tr.addEventListener("click", (e) => {
        if (e.target.closest("a, button, input, select") || window.getSelection()?.toString()) return;
        window.location.hash = link.replace(/^#/, "");
      });
    }
    return tr;
  });

  return h(
    "div",
    { class: "table-wrap" },
    h("table", { class: "table" }, caption ? h("caption", { class: "visually-hidden" }, caption) : null, h("thead", {}, head), h("tbody", {}, body)),
  );
}

/** "21–40 of 1,000" + Previous / Next. */
export function pager({ page, pageSize, total, totalPages, onPage }) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return h(
    "nav",
    { class: "pager", "aria-label": "Pagination" },
    h("span", { "aria-live": "polite" }, total === 0 ? "No results" : `${formatInt(from)}–${formatInt(to)} of ${formatInt(total)}`),
    h(
      "span",
      { class: "pager__buttons" },
      h("button", { type: "button", class: "btn btn--sm btn--secondary", disabled: page <= 1, onclick: () => onPage(page - 1) }, "Previous"),
      h("span", { class: "pager__page" }, `Page ${formatInt(page)} of ${formatInt(totalPages)}`),
      h("button", { type: "button", class: "btn btn--sm btn--secondary", disabled: page >= totalPages, onclick: () => onPage(page + 1) }, "Next"),
    ),
  );
}
