import { config } from "../../package.json";
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
  /** parent rows recompute when a child item changes (Zotero honours this
   *  undocumented option for plugin columns: itemTree._getColumns reads it) */
  dependsOnChildren?: boolean;
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

/**
 * Column dataKeys are the same string in every plugin instance
 * (`zest@zotero-zest.app-reading`), so `unregisterColumn` from an OLD instance
 * removes the NEW instance's columns. That is not hypothetical: installing an
 * updated xpi (and every dev hot reload) overlaps a shutdown with a startup,
 * and the columns then vanish until Zotero is restarted while every
 * `column.*.enable` preference still says true.
 *
 * So registration claims ownership on a Zotero-global marker, and teardown
 * only touches the manager while it still holds that claim.
 */
const OWNER_KEY = "__zestColumnOwner";
const INSTANCE_ID = (((Zotero as any)[OWNER_KEY]?.instance as number) ?? 0) + 1;

function claimColumns() {
  (Zotero as any)[OWNER_KEY] = { instance: INSTANCE_ID };
}

function ownsColumns(): boolean {
  const owner = (Zotero as any)[OWNER_KEY];
  return !owner || owner.instance === INSTANCE_ID;
}

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
  if (spec.dependsOnChildren) opts.dependsOnChildren = true;
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
  claimColumns();
  return true;
}

export function unregisterColumn(key: string) {
  const dataKey = registered.get(key);
  if (!dataKey) return;
  registered.delete(key);
  if (!ownsColumns()) {
    // a newer instance of the plugin has re-registered these dataKeys; taking
    // them out now would strip the columns from the running Zotero
    ztoolkit.log(
      `[columns] skipping unregister of ${key}: newer instance owns it`,
    );
    return;
  }
  try {
    (Zotero as any).ItemTreeManager?.unregisterColumn?.(dataKey);
  } catch (e) {
    ztoolkit.log(`[columns] unregister ${key} failed`, e);
  }
}

export function unregisterAllColumns() {
  for (const key of [...registered.keys()]) unregisterColumn(key);
  // leave nothing of ours on the Zotero global once the last column is gone
  // (a newer instance re-claims on its own registration)
  if (ownsColumns()) delete (Zotero as any)[OWNER_KEY];
}

/**
 * Zotero strips EVERY registration under our plugin ID when a copy of the
 * plugin shuts down (PluginAPIBase's shutdown observer) — including the ones a
 * newer, overlapping copy just made. Forget what we think is registered so the
 * next `registerColumn` call re-registers instead of returning early.
 */
export function forgetRegistrations() {
  registered.clear();
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
let pendingResort = false;

export function refreshItems(ids: number[], options?: { resort?: boolean }) {
  for (const id of ids) if (id) pendingIDs.add(id);
  if (options?.resort) pendingResort = true;
  if (!pendingIDs.size) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    const batch = [...pendingIDs];
    const resort = pendingResort;
    pendingIDs.clear();
    pendingResort = false;
    for (const win of Zotero.getMainWindows()) {
      try {
        const view = (win as any).ZoteroPane?.itemsView;
        if (!view?.tree) continue;
        view.invalidateRowCache(batch);
        // a column filled in the background (ranks, annotation counts) was
        // sorted while its values were still empty: re-sort once they land,
        // but only when the tree is sorted by one of our columns
        if (resort && isOurSortField(view)) {
          void Promise.resolve(view.sort()).catch(() => undefined);
          continue;
        }
        for (const id of batch) {
          const row = view.getRowIndexByID(id);
          if (typeof row === "number") view.tree.invalidateRow(row);
        }
      } catch (e) {
        ztoolkit.log("[columns] local refresh failed", e);
      }
    }
  }, 300);
}

function isOurSortField(view: any): boolean {
  try {
    const field = String(view.getSortField?.() || "");
    if (!field) return false;
    for (const dataKey of registered.values())
      if (dataKey === field) return true;
  } catch {
    // ignore
  }
  return false;
}

/** Recompute + repaint every visible row of every main window's item tree (debounced). */
export function refreshAllRows() {
  clearTimeout(fullRefreshTimer);
  fullRefreshTimer = setTimeout(() => {
    for (const win of Zotero.getMainWindows()) {
      try {
        const view = (win as any).ZoteroPane?.itemsView;
        if (!view) continue;
        view.invalidateRowCache(true);
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
