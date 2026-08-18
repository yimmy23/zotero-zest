import { config } from "../../package.json";
import { guard } from "../utils/guard";
import { setTimeout, clearTimeout } from "../utils/timers";

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
  // Zotero requires a STRING from dataProvider (sort/type-to-find crash on
  // undefined), so the failure path returns "" rather than guard()'s undefined.
  const dataProvider = (item: any, dataKey: string): string => {
    try {
      if (!(item instanceof Zotero.Item)) return "";
      const v = spec.dataProvider(item, dataKey);
      return typeof v === "string" ? v : v == null ? "" : String(v);
    } catch (e) {
      ztoolkit.log(`[column:${spec.key}] dataProvider failed`, e);
      try {
        Zotero.logError(e as any);
      } catch {
        // never throw
      }
      return "";
    }
  };

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
    const render = spec.renderCell;
    // A renderCell that returns anything but an Element makes Zotero fall back
    // to its own cell renderer, which paints the raw dataProvider string —
    // i.e. our SORT KEY ("00000600", "lovelace ada"). An empty cell is the
    // honest failure; guard() alone would return undefined and produce that
    // garbage instead.
    opts.renderCell = (
      index: number,
      data: string,
      column: any,
      isFirstColumn: boolean,
      doc: Document,
    ) => {
      try {
        const cell = render(index, data, column, isFirstColumn, doc);
        if (cell) return cell;
      } catch (e) {
        ztoolkit.log(`[column:${spec.key}] renderCell failed`, e);
        try {
          Zotero.logError(e as any);
        } catch {
          // never throw out of a render
        }
      }
      return makeCell(doc, column, spec.key).cell;
    };
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
let repaintTimer: number | undefined;
let fullRefreshTimer: number | undefined;

/**
 * Re-run dataProvider + renderCell for these items (debounced, batched).
 * Done locally per main window (row-cache invalidation + row repaint): our
 * dataProviders read only the in-memory store, so no cross-component
 * Notifier broadcast is needed — a global 'refresh' would re-render the
 * item pane and re-select the item on every reading tick.
 */
export function refreshItems(ids: number[]) {
  for (const id of ids) if (id) pendingIDs.add(id);
  if (!pendingIDs.size) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    const batch = [...pendingIDs];
    pendingIDs.clear();
    let done = false;
    for (const win of Zotero.getMainWindows()) {
      try {
        const view = (win as any).ZoteroPane?.itemsView;
        if (!view?.tree) continue;
        if (typeof view.invalidateRowCache === "function") {
          view.invalidateRowCache(batch);
        } else if (view._rowCache) {
          for (const id of batch) delete view._rowCache[id];
        }
        for (const id of batch) {
          const row =
            typeof view.getRowIndexByID === "function"
              ? view.getRowIndexByID(id)
              : view._rowMap?.[id];
          if (typeof row === "number") view.tree.invalidateRow(row);
        }
        done = true;
      } catch (e) {
        ztoolkit.log("[columns] local refresh failed", e);
      }
    }
    if (!done) {
      // no usable tree API (unexpected build) → fall back to Zotero's own event
      try {
        void Zotero.Notifier.trigger("refresh", "item", batch);
      } catch (e) {
        ztoolkit.log("[columns] refresh trigger failed", e);
      }
    }
  }, 300);
}

/** Recompute + repaint every visible row of every main window's item tree (debounced). */
export function refreshAllRows() {
  clearTimeout(fullRefreshTimer);
  fullRefreshTimer = setTimeout(() => {
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
  }, 120);
}

/** Repaint only (renderCell re-runs, dataProvider does not), debounced. */
export function redrawAll() {
  clearTimeout(repaintTimer);
  repaintTimer = setTimeout(() => {
    for (const win of Zotero.getMainWindows()) {
      try {
        (win as any).ZoteroPane?.itemsView?.tree?.invalidate?.();
      } catch (e) {
        ztoolkit.log("[columns] redraw failed", e);
      }
    }
  }, 120);
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
export function numKey(
  n: number | undefined | null,
  width = 8,
  /** keep a real 0 as a sortable key — "not cited yet" is not "unknown" */
  keepZero = false,
): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "";
  if (n < 0 || (n === 0 && !keepZero)) return "";
  return String(Math.round(n)).padStart(width, "0");
}

/**
 * A click that carries a selection modifier belongs to Zotero, not to us.
 *
 * The item tree implements Shift-click range select and Cmd/Ctrl-click toggle
 * on mousedown/mouseup; a widget that swallows those events inside its own
 * column turns an ordinary multi-select into "set this item's rating" (and
 * writes to Extra). Only a plain primary-button click is ours.
 */
export function isPlainClick(ev: MouseEvent): boolean {
  return (
    ev.button === 0 && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey && !ev.altKey
  );
}
