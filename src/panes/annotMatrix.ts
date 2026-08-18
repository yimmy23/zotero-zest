import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { guard } from "../utils/guard";
import { collectAnnotations, type CardAnnotation } from "./annotSection";

/**
 * Annotation matrix — every annotation of the current view in one table.
 *
 * The item pane answers "what did I mark in THIS paper"; this window answers
 * "what did I mark about THIS TOPIC across forty papers", which is the actual
 * literature-review move. It is a separate window rather than a pane so it can
 * be sorted, searched and exported without competing with Zotero's reader
 * sidebar.
 *
 * Search grammar, deliberately tiny: space-separated terms are ANDed, `|`
 * separates alternatives, a leading `-` excludes. Everything matches the
 * annotation text, its comment, its tags and the item title.
 */

interface MatrixRow extends CardAnnotation {
  itemTitle: string;
  itemID: number;
}

let openWindow: Window | null = null;
let rows: MatrixRow[] = [];

export function collectMatrix(items: Zotero.Item[]): MatrixRow[] {
  const out: MatrixRow[] = [];
  for (const item of items) {
    let title: string;
    try {
      if (!item.isRegularItem()) continue;
      title = String(item.getField("title") || "");
    } catch {
      continue;
    }
    for (const card of collectAnnotations(item)) {
      out.push({ ...card, itemTitle: title, itemID: item.id });
    }
  }
  return out;
}

export function matchesQuery(row: MatrixRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [row.text, row.comment, row.itemTitle, row.tags.join(" ")]
    .join(" ")
    .toLowerCase();
  for (const term of q.split(/\s+/)) {
    if (!term) continue;
    if (term.startsWith("-")) {
      if (term.length > 1 && haystack.includes(term.slice(1))) return false;
      continue;
    }
    const alternatives = term.split("|").filter(Boolean);
    if (!alternatives.some((a) => haystack.includes(a))) return false;
  }
  return true;
}

export function openMatrix(parent?: Window) {
  const host = (parent ||
    (Zotero.getMainWindow() as unknown as Window)) as Window | null;
  if (!host?.openDialog) return;
  const zp = (host as any).ZoteroPane;
  const items: Zotero.Item[] = (zp?.itemsView?.getSortedItems?.() ??
    []) as Zotero.Item[];
  rows = collectMatrix(items.filter((i) => i instanceof Zotero.Item));

  if (openWindow && !openWindow.closed) {
    try {
      openWindow.focus();
      render(openWindow);
      return;
    } catch {
      openWindow = null;
    }
  }
  const win = host.openDialog(
    "chrome://zotero/content/standalone/basicViewer.xhtml",
    `${config.addonRef}-matrix`,
    "chrome,centerscreen,resizable,width=1040,height=680",
  ) as Window | null;
  if (!win) return;
  openWindow = win;
  win.addEventListener(
    "load",
    guard("matrix load", () => render(win)),
    { once: true },
  );
  win.addEventListener("unload", () => {
    if (openWindow === win) openWindow = null;
  });
}

interface Filters {
  query: string;
  color: string;
  tag: string;
}

const filters: Filters = { query: "", color: "", tag: "" };

export function render(win: Window) {
  const doc = win.document;
  doc.title = getString("matrix-title");
  const body = (doc.body || doc.documentElement) as HTMLElement;
  body.textContent = "";

  const style = doc.createElement("style");
  style.textContent = MATRIX_CSS;
  body.appendChild(style);

  const root = doc.createElement("div");
  root.className = "zest-matrix";
  body.appendChild(root);

  /* toolbar */
  const bar = doc.createElement("div");
  bar.className = "zest-matrix-bar";
  const search = doc.createElement("input");
  search.type = "search";
  search.className = "zest-matrix-search";
  search.placeholder = getString("matrix-search-placeholder");
  search.value = filters.query;
  search.addEventListener(
    "input",
    guard("matrix search", () => {
      filters.query = search.value;
      paint();
    }),
  );
  bar.appendChild(search);

  const colorSelect = doc.createElement("select");
  colorSelect.className = "zest-matrix-select";
  const colors = [...new Set(rows.map((r) => r.color).filter(Boolean))];
  const colorOptions: Array<[string, string]> = [
    ["", getString("matrix-all-colors")],
    ...colors.map((c): [string, string] => [c, c]),
  ];
  for (const [value, label] of colorOptions) {
    const opt = doc.createElement("option");
    opt.value = value;
    opt.textContent = label;
    if (value === filters.color) opt.selected = true;
    colorSelect.appendChild(opt);
  }
  colorSelect.addEventListener(
    "change",
    guard("matrix colour", () => {
      filters.color = colorSelect.value;
      paint();
    }),
  );
  bar.appendChild(colorSelect);

  const tagSelect = doc.createElement("select");
  tagSelect.className = "zest-matrix-select";
  const tags = [...new Set(rows.flatMap((r) => r.tags))].sort();
  const tagOptions: Array<[string, string]> = [
    ["", getString("matrix-all-tags")],
    ...tags.map((t): [string, string] => [t, t]),
  ];
  for (const [value, label] of tagOptions) {
    const opt = doc.createElement("option");
    opt.value = value;
    opt.textContent = label;
    if (value === filters.tag) opt.selected = true;
    tagSelect.appendChild(opt);
  }
  tagSelect.addEventListener(
    "change",
    guard("matrix tag", () => {
      filters.tag = tagSelect.value;
      paint();
    }),
  );
  bar.appendChild(tagSelect);

  const count = doc.createElement("span");
  count.className = "zest-matrix-count";
  bar.appendChild(count);

  const csv = doc.createElement("button");
  csv.textContent = getString("matrix-export-csv");
  csv.addEventListener(
    "click",
    guard("matrix csv", () => void exportRows("csv", visible())),
  );
  bar.appendChild(csv);
  const md = doc.createElement("button");
  md.textContent = getString("matrix-export-md");
  md.addEventListener(
    "click",
    guard("matrix md", () => void exportRows("md", visible())),
  );
  bar.appendChild(md);

  root.appendChild(bar);

  const table = doc.createElement("table");
  table.className = "zest-matrix-table";
  const head = doc.createElement("tr");
  for (const label of [
    getString("matrix-col-item"),
    getString("matrix-col-page"),
    getString("matrix-col-text"),
    getString("matrix-col-tags"),
  ]) {
    const th = doc.createElement("th");
    th.textContent = label;
    head.appendChild(th);
  }
  table.appendChild(head);
  root.appendChild(table);

  function visible(): MatrixRow[] {
    return rows.filter(
      (r) =>
        (!filters.color || r.color === filters.color) &&
        (!filters.tag || r.tags.includes(filters.tag)) &&
        matchesQuery(r, filters.query),
    );
  }

  function paint() {
    while (table.children.length > 1) table.lastElementChild?.remove();
    const list = visible();
    count.textContent = getString("matrix-count", {
      args: { shown: list.length, total: rows.length },
    });
    for (const r of list.slice(0, 2000)) {
      const tr = doc.createElement("tr");
      tr.className = "zest-matrix-row";
      if (r.color) tr.style.borderInlineStart = `3px solid ${r.color}`;

      const item = doc.createElement("td");
      item.className = "item";
      item.textContent = r.itemTitle;
      const page = doc.createElement("td");
      page.className = "page";
      page.textContent = r.page || "";
      const text = doc.createElement("td");
      text.textContent = r.text || r.comment || `(${r.type})`;
      if (r.comment && r.text) {
        const note = doc.createElement("div");
        note.className = "comment";
        note.textContent = r.comment;
        text.appendChild(note);
      }
      const tagCell = doc.createElement("td");
      tagCell.className = "tags";
      tagCell.textContent = r.tags.join(", ");

      tr.appendChild(item);
      tr.appendChild(page);
      tr.appendChild(text);
      tr.appendChild(tagCell);
      tr.addEventListener(
        "dblclick",
        guard("matrix open", () => {
          void openAnnotationFromMatrix(r);
        }),
      );
      table.appendChild(tr);
    }
    if (list.length > 2000) {
      const tr = doc.createElement("tr");
      const td = doc.createElement("td");
      td.colSpan = 4;
      td.className = "zest-matrix-more";
      td.textContent = getString("matrix-truncated", {
        args: { shown: 2000, total: list.length },
      });
      tr.appendChild(td);
      table.appendChild(tr);
    }
  }

  paint();
}

async function openAnnotationFromMatrix(row: MatrixRow) {
  try {
    const location = { annotationID: row.key };
    const handlers = (Zotero as any).FileHandlers;
    if (handlers?.open) {
      await handlers.open(row.attachment, { location });
      return;
    }
    await Zotero.Reader.open(row.attachment.id, location as any);
  } catch (e) {
    ztoolkit.log("[matrix] open failed", e);
  }
}

export function toCSV(list: MatrixRow[]): string {
  const esc = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["item", "page", "text", "comment", "color", "tags"].join(",");
  const body = list.map((r) =>
    [r.itemTitle, r.page, r.text, r.comment, r.color, r.tags.join("; ")]
      .map((v) => esc(String(v ?? "")))
      .join(","),
  );
  return [head, ...body].join("\n");
}

export function toMarkdown(list: MatrixRow[]): string {
  const byItem = new Map<string, MatrixRow[]>();
  for (const r of list) {
    const group = byItem.get(r.itemTitle) ?? [];
    group.push(r);
    byItem.set(r.itemTitle, group);
  }
  const out: string[] = [];
  for (const [title, group] of byItem) {
    out.push(`## ${title}`, "");
    for (const r of group) {
      const page = r.page ? ` (p. ${r.page})` : "";
      out.push(`- ${r.text || `(${r.type})`}${page}`);
      if (r.comment) out.push(`  - ${r.comment}`);
      if (r.tags.length) out.push(`  - _${r.tags.join(", ")}_`);
    }
    out.push("");
  }
  return out.join("\n");
}

async function exportRows(kind: "csv" | "md", list: MatrixRow[]) {
  try {
    const FilePicker = ztoolkit.FilePicker as any;
    const path = await new FilePicker(
      getString("matrix-title"),
      "save",
      kind === "csv" ? [["CSV", "*.csv"]] : [["Markdown", "*.md"]],
      kind === "csv" ? "annotations.csv" : "annotations.md",
    ).open();
    if (!path) return;
    await Zotero.File.putContentsAsync(
      path,
      kind === "csv" ? toCSV(list) : toMarkdown(list),
    );
  } catch (e) {
    ztoolkit.log("[matrix] export failed", e);
  }
}

const MATRIX_CSS = `
  body { margin: 0; font: message-box; background: Field; color: FieldText; }
  .zest-matrix { padding: 14px 18px 22px; font-family: system-ui, sans-serif; }
  .zest-matrix-bar { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
  .zest-matrix-search { flex: 1 1 240px; padding: 4px 8px; border-radius: 6px;
    border: 1px solid color-mix(in srgb, FieldText 25%, transparent); background: transparent; color: inherit; }
  .zest-matrix-select { padding: 3px 6px; border-radius: 6px; }
  .zest-matrix-count { font-size: .85rem; opacity: .7; margin-inline: 4px; }
  .zest-matrix-table { width: 100%; border-collapse: collapse; font-size: .9rem; }
  .zest-matrix-table th { text-align: left; font-weight: 600; padding: 4px 8px; opacity: .7;
    border-bottom: 1px solid color-mix(in srgb, FieldText 20%, transparent); }
  .zest-matrix-table td { padding: 6px 8px; vertical-align: top;
    border-bottom: 1px solid color-mix(in srgb, FieldText 10%, transparent); }
  .zest-matrix-table td.item { width: 22%; opacity: .8; }
  .zest-matrix-table td.page { width: 4em; text-align: right; opacity: .7; font-variant-numeric: tabular-nums; }
  .zest-matrix-table td.tags { width: 16%; opacity: .7; }
  .zest-matrix-table .comment { margin-top: 3px; opacity: .7; font-style: italic; }
  .zest-matrix-row:hover { background: color-mix(in srgb, FieldText 6%, transparent); }
  .zest-matrix-more { text-align: center; opacity: .6; padding: 10px; }
`;
