import { config } from "../../package.json";
import { guard } from "../utils/guard";
import { setTimeout, clearTimeout } from "../utils/window";

/**
 * Thin, opinionated wrapper around `Zotero.ItemTreeManager.registerColumn`.
 *
 * Rules baked in (from itemTree.js 9.0.6 + Zotero 10 dev notes):
 * - register each column exactly once per plugin lifetime; never re-register
 *   on a pref change (Zotero re-creates the Columns object and loses widths);
 * - dataKey short and [a-z0-9_] (Zotero namespaces it with the pluginID);
 * - `defaultIn: ["default"]` or the column is hidden the first time;
 * - `width` is a unit-less numeric STRING; `zoteroPersist` must list "width"
 *   for the user's resize to survive restarts;
 * - dataProvider is sync, must return a string, must tolerate non-items
 *   (Zotero 10 multi-select adds library header rows);
 * - renderCell is sync, must return an Element of `doc` shaped
 *   `<span class="cell {column.className}"><span class="cell-text">` — the
 *   className carries the flex-basis width rule;
 * - refresh = `Notifier.trigger('refresh','item',ids)` (clears the row cache
 *   for those rows), never `refreshColumns()` except when columns are
 *   added/removed.
 */

export interface ColumnSpec {
  /** short key, [a-z0-9_] */
  key: string;
  label: string;
  iconPath?: string;
  flex?: number;
  width?: number;
  fixedWidth?: boolean;
  staticWidth?: boolean;
  minWidth?: number;
  showInColumnPicker?: boolean;
  columnPickerSubMenu?: boolean;
  /** pref key (boolean) gating registration */
  enabledPref?: string;
  dataProvider: (item: Zotero.Item, dataKey: string) => string;
  renderCell?: (
    index: number,
    data: string,
    column: any,
    isFirstColumn: boolean,
    doc: Document,
  ) => HTMLElement;
}

const registered = new Map<string, string>(); // spec.key -> registered dataKey

export function registerColumn(spec: ColumnSpec): boolean {
  if (registered.has(spec.key)) return true;
  if (spec.enabledPref && !Zotero.Prefs.get(spec.enabledPref, true)) {
    return false;
  }
  const mgr = (Zotero as any).ItemTreeManager;
  if (!mgr?.registerColumn) {
    ztoolkit.log("[columns] ItemTreeManager.registerColumn missing");
    return false;
  }
  const dataProvider = guard(
    `column:${spec.key}:data`,
    (item: any, dataKey: string) => {
      if (!(item instanceof Zotero.Item)) return "";
      const v = spec.dataProvider(item, dataKey);
      return typeof v === "string" ? v : v == null ? "" : String(v);
    },
  );
  const opts: any = {
    dataKey: spec.key,
    label: spec.label,
    pluginID: config.addonID,
    enabledTreeIDs: ["main"],
    defaultIn: ["default"],
    showInColumnPicker: spec.showInColumnPicker ?? true,
    columnPickerSubMenu: spec.columnPickerSubMenu ?? false,
    zoteroPersist: ["width", "hidden", "sortDirection", "ordinal"],
    dataProvider,
  };
  if (spec.iconPath) opts.iconPath = spec.iconPath;
  if (spec.flex !== undefined) opts.flex = spec.flex;
  if (spec.width !== undefined) opts.width = String(spec.width);
  if (spec.fixedWidth) opts.fixedWidth = true;
  if (spec.staticWidth) opts.staticWidth = true;
  if (spec.minWidth !== undefined) opts.minWidth = spec.minWidth;
  if (spec.renderCell) {
    opts.renderCell = guard(`column:${spec.key}:render`, spec.renderCell);
  }
  const key = mgr.registerColumn(opts);
  if (!key) {
    ztoolkit.log(`[columns] registerColumn(${spec.key}) returned false`);
    return false;
  }
  registered.set(spec.key, key);
  return true;
}

export function unregisterColumn(key: string) {
  const dataKey = registered.get(key);
  if (!dataKey) return;
  registered.delete(key);
  try {
    (Zotero as any).ItemTreeManager?.unregisterColumn?.(dataKey);
  } catch (e) {
    ztoolkit.log(`[columns] unregister ${key} failed`, e);
  }
}

export function unregisterAllColumns() {
  for (const key of [...registered.keys()]) unregisterColumn(key);
}

export function registeredDataKey(key: string): string | undefined {
  return registered.get(key);
}

export function isRegistered(key: string): boolean {
  return registered.has(key);
}

/* ------------------------------------------------------------------ */
/* refresh helpers                                                     */

const pendingIDs = new Set<number>();
let refreshTimer: number | undefined;

/** Re-run dataProvider + renderCell for these items (debounced, batched). */
export function refreshItems(ids: number[]) {
  for (const id of ids) if (id) pendingIDs.add(id);
  if (!pendingIDs.size) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    const batch = [...pendingIDs];
    pendingIDs.clear();
    try {
      void Zotero.Notifier.trigger("refresh", "item", batch);
    } catch (e) {
      ztoolkit.log("[columns] refresh trigger failed", e);
    }
  }, 300);
}

/** Recompute + repaint every visible row of every main window's item tree. */
export function refreshAllRows() {
  for (const win of Zotero.getMainWindows()) {
    try {
      const view = (win as any).ZoteroPane?.itemsView;
      if (!view) continue;
      if (typeof view.invalidateRowCache === "function") {
        view.invalidateRowCache(true);
      } else if (view._rowCache) {
        view._rowCache = {};
      }
      view.tree?.invalidate?.();
    } catch (e) {
      ztoolkit.log("[columns] refreshAllRows failed", e);
    }
  }
}

/** Repaint only (renderCell re-runs, dataProvider does not). */
export function redrawAll() {
  try {
    void Zotero.Notifier.trigger("redraw", "item", []);
  } catch (e) {
    ztoolkit.log("[columns] redraw failed", e);
  }
}

/* ------------------------------------------------------------------ */
/* cell helpers                                                        */

/** The Zotero.Item behind row `index` of the main tree of `doc`'s window. */
export function rowItem(doc: Document, index: number): Zotero.Item | null {
  try {
    const view = (doc.defaultView as any)?.ZoteroPane?.itemsView;
    const ref = view?.getRow?.(index)?.ref;
    return ref instanceof Zotero.Item ? ref : null;
  } catch {
    return null;
  }
}

/** `<span class="cell {className} zest-cell zest-<key>"><span class="cell-text">text</span></span>` */
export function makeCell(
  doc: Document,
  column: any,
  key: string,
  text = "",
): { cell: HTMLSpanElement; textSpan: HTMLSpanElement } {
  const cell = doc.createElement("span");
  cell.className = `cell ${column?.className || ""} zest-cell zest-${key}`;
  const textSpan = doc.createElement("span");
  textSpan.className = "cell-text";
  if (text) textSpan.textContent = text;
  cell.appendChild(textSpan);
  return { cell, textSpan };
}

/** zero-padded numeric sort key; empty string for "no value" */
export function numKey(n: number | undefined | null, width = 8): string {
  if (n === undefined || n === null || !Number.isFinite(n) || n <= 0) return "";
  return String(Math.round(n)).padStart(width, "0");
}
