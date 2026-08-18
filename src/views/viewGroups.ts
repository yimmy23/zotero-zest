import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { registeredDataKey } from "../columns/registry";
import { guard } from "../utils/guard";
import {
  zestConfig,
  newId,
  type ViewGroup,
  type ViewGroupColumn,
} from "../core/config";

/**
 * View groups — named column layouts ("Screening", "Writing", "Grant") that
 * remember which columns are shown, their order, their widths and the sort.
 *
 * Zotero has no API for this. Column state lives in `treePrefs.json` in the
 * profile and is written through four private ItemTree methods that still
 * exist in 9.0.6 and 10.0. Everything below is feature-detected, and when the
 * probe fails the views can still be managed — only "apply" is unavailable.
 *
 * Three Zotero 10 details this code depends on:
 *   - `_getColumnPrefs()` returns `{}` on a profile where the user never
 *     resized or sorted, so every entry must be created before it is written;
 *   - `_storeColumnPrefs()` no longer updates the live column model, so an
 *     explicit `_resetColumns()` is required afterwards;
 *   - `_resetColumns()` no longer re-sorts, so `sort()` must be called too.
 *
 * We only ever write when the user explicitly applies a view: this is Zotero's
 * own state, not ours.
 */

interface ColumnLike {
  dataKey: string;
  width?: number;
  hidden?: boolean;
  ordinal?: number;
  fixedWidth?: boolean;
  sortDirection?: number;
}

function itemsView(win: Window): any {
  return (win as any).ZoteroPane?.itemsView;
}

/** feature probe — all four private hooks plus the live column model */
export function canApplyViews(win: Window): boolean {
  const iv = itemsView(win);
  return !!(
    iv &&
    typeof iv._getColumnPrefs === "function" &&
    typeof iv._storeColumnPrefs === "function" &&
    typeof iv._resetColumns === "function" &&
    liveColumns(win).length
  );
}

function liveColumns(win: Window): ColumnLike[] {
  const iv = itemsView(win);
  try {
    const cols = iv?.tree?._columns;
    const arr =
      typeof cols?.getAsArray === "function" ? cols.getAsArray() : iv?._columns;
    return Array.isArray(arr) ? (arr as ColumnLike[]) : [];
  } catch (e) {
    ztoolkit.log("[views] cannot read columns", e);
    return [];
  }
}

/** snapshot of what the item tree looks like right now */
export function captureView(win: Window, name: string): ViewGroup | null {
  const cols = liveColumns(win);
  if (!cols.length) return null;
  const iv = itemsView(win);
  let sortField: string | undefined;
  let sortDirection: number | undefined;
  try {
    sortField = iv?.getSortField?.();
    const dir = iv?.getSortDirection?.();
    if (dir === 1 || dir === -1) sortDirection = dir;
  } catch {
    // sorting unavailable (feeds)
  }
  return {
    id: newId("vg"),
    name: name.trim().slice(0, 80) || getString("views-untitled"),
    columns: cols.map((c, i) => ({
      dataKey: c.dataKey,
      width: c.fixedWidth
        ? undefined
        : Math.round(Number(c.width) || 0) || undefined,
      hidden: !!c.hidden,
      ordinal: typeof c.ordinal === "number" ? c.ordinal : i,
    })),
    sortField,
    sortDirection,
  };
}

export function addView(win: Window, name: string): ViewGroup | null {
  const view = captureView(win, name);
  if (!view) return null;
  zestConfig.update((draft) => {
    draft.viewGroups.push(view);
  });
  return view;
}

export function updateView(win: Window, id: string): boolean {
  const fresh = captureView(win, "");
  if (!fresh) return false;
  let ok = false;
  zestConfig.update((draft) => {
    const target = draft.viewGroups.find((v) => v.id === id);
    if (!target) return;
    target.columns = fresh.columns;
    target.sortField = fresh.sortField;
    target.sortDirection = fresh.sortDirection;
    ok = true;
  });
  return ok;
}

export function removeView(id: string) {
  zestConfig.update((draft) => {
    draft.viewGroups = draft.viewGroups.filter((v) => v.id !== id);
  });
}

export function renameView(id: string, name: string) {
  zestConfig.update((draft) => {
    const v = draft.viewGroups.find((g) => g.id === id);
    if (v) v.name = name.trim().slice(0, 80) || v.name;
  });
}

export function moveView(id: string, delta: number) {
  zestConfig.update((draft) => {
    const i = draft.viewGroups.findIndex((v) => v.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= draft.viewGroups.length) return;
    const [item] = draft.viewGroups.splice(i, 1);
    draft.viewGroups.splice(j, 0, item);
  });
}

/** the layout the user had before the last apply, so it can be restored */
let previous: ViewGroup | null = null;

export function hasPreviousLayout(): boolean {
  return !!previous;
}

export async function applyView(
  win: Window,
  view: ViewGroup,
): Promise<boolean> {
  const iv = itemsView(win);
  if (!canApplyViews(win)) {
    ztoolkit.log("[views] apply unavailable on this Zotero build");
    return false;
  }
  // remember where we came from (one level of undo)
  previous = captureView(win, getString("views-previous"));

  try {
    const wanted = new Map(view.columns.map((c) => [c.dataKey, c]));
    const prefs = iv._getColumnPrefs() || {};
    const cols = liveColumns(win);
    for (const col of cols) {
      // Zotero 10 hands back {} on a fresh profile — create the entry first
      const entry = (prefs[col.dataKey] ??= { dataKey: col.dataKey });
      const target = wanted.get(col.dataKey);
      entry.hidden = !target || !!target.hidden;
      if (target) {
        if (typeof target.ordinal === "number") entry.ordinal = target.ordinal;
        if (!col.fixedWidth && target.width) entry.width = target.width;
      }
      if (view.sortField && col.dataKey === view.sortField) {
        entry.sortDirection = view.sortDirection ?? 1;
      } else {
        delete entry.sortDirection;
      }
    }
    iv._storeColumnPrefs(prefs);
    if (typeof iv._writeColumnPrefsToFile === "function") {
      await iv._writeColumnPrefsToFile(true);
    }
    // Zotero 10: storing does not touch the live model any more
    await iv._resetColumns?.();
    if (typeof iv.sort === "function") await iv.sort();
    iv.tree?.invalidate?.();
    return true;
  } catch (e) {
    ztoolkit.log("[views] apply failed", e);
    return false;
  }
}

/**
 * The layout Zest is designed around, as one click.
 *
 * New users see a Zotero item list with none of the plugin's columns visible
 * (Zotero remembers per-column visibility, and a fresh column starts where the
 * user's saved layout left off), then wonder where the features went. This
 * applies the arrangement the panels and columns were designed to be read
 * together in — and because it goes through applyView, the previous layout is
 * one undo away (Tools ▸ Zest ▸ Undo layout change).
 */
export async function applyRecommendedLayout(win: Window): Promise<boolean> {
  // never hardcode the plugin's dataKeys: Zotero escapes them
  // ("zest\\@zotero-zest\\.app-reading"), so ask the registry for the real one
  const wanted: Array<[string, number]> = [
    ["title", 320],
    ["firstCreator", 150],
    ["date", 60],
    ["reading", 90],
    ["status", 86],
    ["rating", 88],
    ["annots", 78],
    ["pubtags", 120],
    ["if", 84],
    ["citations", 74],
  ];
  const native = new Set(["title", "firstCreator", "date"]);
  const columns: ViewGroupColumn[] = [];
  for (const [key, width] of wanted) {
    const dataKey = native.has(key) ? key : registeredDataKey(key);
    // a column the user turned off in Settings is simply not in the layout
    if (!dataKey) continue;
    columns.push({ dataKey, width, ordinal: columns.length });
  }
  return applyView(win, {
    id: "zest-recommended",
    name: getString("views-recommended"),
    columns,
    sortField: registeredDataKey("reading"),
    sortDirection: -1,
  });
}

export async function restorePreviousLayout(win: Window): Promise<boolean> {
  if (!previous) return false;
  const layout = previous;
  const ok = await applyView(win, layout);
  // applyView overwrote `previous` with the layout we just left
  return ok;
}

export function views(): ViewGroup[] {
  return [...zestConfig.get().viewGroups];
}

/* ------------------------------------------------------------------ */
/* column-picker menu integration                                      */
/* ------------------------------------------------------------------ */

const listeners = new Map<Window, (ev: Event) => void>();

/**
 * Add a "Zest views" submenu to both column pickers (header right-click and
 * View ▸ Columns) by listening for `popupshowing` — Zotero fills those popups
 * before opening them and throws them away afterwards, so appending needs no
 * patch and leaves nothing behind.
 */
export function installViewMenu(win: Window) {
  if (listeners.has(win)) return;
  const handler = guard("view menu", (ev: Event) => {
    const target = ev.target as any;
    if (!target?.id && !target?.parentElement?.id) return;
    const isPicker = target.id === "zotero-column-picker";
    const isMenubar = target.parentElement?.id === "column-picker-submenu";
    if (!isPicker && !isMenubar) return;
    if (target.querySelector?.(`#${config.addonRef}-views-menu`)) return;
    target.appendChild(buildMenu(win));
  });
  win.document.addEventListener("popupshowing", handler);
  listeners.set(win, handler);
}

export function uninstallViewMenu(win: Window) {
  const handler = listeners.get(win);
  if (!handler) return;
  try {
    win.document.removeEventListener("popupshowing", handler);
  } catch {
    // window gone
  }
  listeners.delete(win);
}

export function uninstallAllViewMenus() {
  for (const win of [...listeners.keys()]) uninstallViewMenu(win);
}

function buildMenu(win: Window): Element {
  const doc = win.document;
  const menu = doc.createXULElement("menu");
  menu.id = `${config.addonRef}-views-menu`;
  menu.setAttribute("label", getString("views-menu"));
  const popup = doc.createXULElement("menupopup");
  menu.appendChild(popup);

  const list = views();
  for (const view of list) {
    const mi = doc.createXULElement("menuitem");
    mi.setAttribute("label", view.name);
    mi.setAttribute("type", "radio");
    mi.addEventListener(
      "command",
      guard("apply view", () => void applyView(win, view)),
    );
    popup.appendChild(mi);
  }
  if (!list.length) {
    const empty = doc.createXULElement("menuitem");
    empty.setAttribute("label", getString("views-empty"));
    empty.setAttribute("disabled", "true");
    popup.appendChild(empty);
  }
  popup.appendChild(doc.createXULElement("menuseparator"));

  const add = doc.createXULElement("menuitem");
  add.setAttribute("label", getString("views-add"));
  add.addEventListener(
    "command",
    guard("add view", () => {
      const out = { value: getString("views-untitled") };
      const ok = Services.prompt.prompt(
        win as any,
        getString("views-add"),
        getString("views-add-label"),
        out,
        null as any,
        { value: false },
      );
      if (ok) addView(win, out.value);
    }),
  );
  popup.appendChild(add);

  if (list.length) {
    const update = doc.createXULElement("menu");
    update.setAttribute("label", getString("views-update"));
    const updatePopup = doc.createXULElement("menupopup");
    update.appendChild(updatePopup);
    for (const view of list) {
      const mi = doc.createXULElement("menuitem");
      mi.setAttribute("label", view.name);
      mi.addEventListener(
        "command",
        guard("update view", () => updateView(win, view.id)),
      );
      updatePopup.appendChild(mi);
    }
    popup.appendChild(update);

    const del = doc.createXULElement("menu");
    del.setAttribute("label", getString("views-delete"));
    const delPopup = doc.createXULElement("menupopup");
    del.appendChild(delPopup);
    for (const view of list) {
      const mi = doc.createXULElement("menuitem");
      mi.setAttribute("label", view.name);
      mi.addEventListener(
        "command",
        guard("delete view", () => {
          const ok = Services.prompt.confirm(
            win as any,
            getString("views-delete"),
            getString("views-delete-confirm", { args: { name: view.name } }),
          );
          if (ok) removeView(view.id);
        }),
      );
      delPopup.appendChild(mi);
    }
    popup.appendChild(del);
  }

  if (hasPreviousLayout()) {
    popup.appendChild(doc.createXULElement("menuseparator"));
    const undo = doc.createXULElement("menuitem");
    undo.setAttribute("label", getString("views-restore"));
    undo.addEventListener(
      "command",
      guard("restore layout", () => void restorePreviousLayout(win)),
    );
    popup.appendChild(undo);
  }
  return menu;
}

/* ------------------------------------------------------------------ */
/* keyboard: Alt+, / Alt+. cycle views                                  */
/* ------------------------------------------------------------------ */

const keyHandlers = new Map<Window, (ev: KeyboardEvent) => void>();

export function installViewShortcuts(win: Window) {
  if (keyHandlers.has(win)) return;
  const handler = guard("view shortcut", (ev: KeyboardEvent) => {
    if (!ev.altKey || ev.ctrlKey || ev.metaKey) return;
    // ignore while typing
    const target = ev.target as HTMLElement | null;
    const tag = target?.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || target?.isContentEditable)
      return;
    if (ev.key === "," || ev.code === "Comma") {
      cycleView(win, -1);
      ev.preventDefault();
    } else if (ev.key === "." || ev.code === "Period") {
      cycleView(win, 1);
      ev.preventDefault();
    }
  });
  win.addEventListener("keydown", handler, true);
  keyHandlers.set(win, handler);
}

export function uninstallViewShortcuts(win: Window) {
  const handler = keyHandlers.get(win);
  if (!handler) return;
  try {
    win.removeEventListener("keydown", handler, true);
  } catch {
    // window gone
  }
  keyHandlers.delete(win);
}

export function uninstallAllViewShortcuts() {
  for (const win of [...keyHandlers.keys()]) uninstallViewShortcuts(win);
}

/** Alt+, / Alt+. cycle through the saved views */
export function cycleView(win: Window, delta: number) {
  const list = views();
  if (!list.length) return;
  const index = currentIndex(list, win);
  const next = list[(index + delta + list.length) % list.length];
  void applyView(win, next);
}

function currentIndex(list: ViewGroup[], win: Window): number {
  const cols = liveColumns(win);
  const visible = new Set(cols.filter((c) => !c.hidden).map((c) => c.dataKey));
  for (let i = 0; i < list.length; i++) {
    const want = new Set(
      list[i].columns.filter((c) => !c.hidden).map((c) => c.dataKey),
    );
    if (want.size === visible.size && [...want].every((k) => visible.has(k))) {
      return i;
    }
  }
  return -1;
}
