import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { getPref, setPref } from "../utils/prefs";
import { guard } from "../utils/guard";
import { setTimeout, clearTimeout } from "../utils/timers";
import { parseTagRule } from "./match";
import {
  collectTagScope,
  cachedTags,
  matchChildTags,
  selectedLibraryID,
  invalidateTagCache,
  clearTagCache,
} from "./scope";
import {
  buildTagTree,
  tagNamesOf,
  walk,
  type TagNode,
  type TagSortMode,
  LINK_SYMBOLS,
} from "./tree";
import { resolveTagStyle, ruleFor } from "./rules";
import { setItemFilter, refreshItemView, canFilter } from "../views/itemFilter";
import { showTagContextMenu } from "./menu";
import { icon, iconButton, type IconName } from "../ui/icons";
import { createDOMOwnership } from "../utils/domOwnership";

/**
 * Nested tag tree — our own view of the tag selector.
 *
 * Mounting (this is the load-bearing detail): the tree is a SIBLING inside
 * `#zotero-tag-selector-container`, never a child of `#zotero-tag-selector`.
 * React 18 clears its container's textContent on the first commit after a
 * remount, so anything placed inside the React root dies the next time the
 * tag selector is collapsed and reopened. The native root is only ever
 * hidden, never removed — Zotero queries it globally in a few places.
 *
 * Filtering does NOT use `setFilter('tags', …)`: that ANDs exact tag names,
 * so a parent node ("everything under #Method") can never be expressed. We
 * push a predicate into our own getItems pipeline instead (see
 * views/itemFilter.ts): OR inside a branch, AND between selected branches.
 */

interface TreeState {
  win: Window;
  root: HTMLElement;
  native: HTMLElement;
  body: HTMLElement;
  /** display path → real tag names in that branch */
  selection: Map<string, Set<string>>;
  collapsed: Map<string, boolean>;
  nodes: TagNode[];
  query: string;
  inView: Set<string>;
  libraryID: number;
  /** Branch metadata is computed once per snapshot, not for every row click. */
  branches: Map<string, { node: TagNode; names: Set<string>; inView: boolean }>;
  filterKey: string;
  loading: boolean;
  failed: boolean;
  refreshTimer?: number;
  searchTimer?: number;
  /** display path of the row that owns the tab stop (roving tabindex) */
  focusPath?: string;
  /** the two tab buttons, keyed by mode */
  tabs: Map<TagPaneMode, HTMLElement>;
  /** bar controls that only make sense on the nested tab */
  treeOnly: HTMLElement[];
  /** listeners we added to Zotero's views, so they can be removed again */
  viewListeners: Array<{ target: any; fn: (...args: any[]) => void }>;
}

const states = new Map<Window, TreeState>();
const ownership = createDOMOwnership();
const NATIVE_VISIBILITY = "hidden:zest-native-tags";
let notifierID: string | undefined;

export function linkSymbol(): string {
  const raw = String(getPref("nestedTags.linkSymbol") || "/");
  return (LINK_SYMBOLS as readonly string[]).includes(raw) && raw.length === 1
    ? raw
    : "/";
}

export function sortMode(): { mode: TagSortMode; descending: boolean } {
  switch (String(getPref("nestedTags.sort") || "az")) {
    case "za":
      return { mode: "name", descending: true };
    case "freq-asc":
      return { mode: "count", descending: true }; // count sorts desc by default
    case "freq-desc":
      return { mode: "count", descending: false };
    default:
      return { mode: "name", descending: false };
  }
}

export function isTreeShown(): boolean {
  return !!getPref("nestedTags.show");
}

/**
 * Which view the tag pane is showing. This is a TAB, not an on/off switch:
 * both views live in the pane at once, so reaching Zotero's flat tag list no
 * longer means turning Zest's off (and then hunting for the way back).
 *
 * `nestedTags.show` is still the master switch — off means the tag pane is
 * exactly what Zotero ships, tab strip included.
 */
export type TagPaneMode = "tree" | "native";

export function tagPaneMode(): TagPaneMode {
  return getPref("nestedTags.tab") === "native" ? "native" : "tree";
}

/**
 * The tree only has to hold data while it is on screen. Refreshing it behind
 * the "All" tab walks every item in the view and re-queries the library's
 * tags to fill a `hidden` element — the most expensive no-op in the plugin,
 * and it would fire on every collection change, tag edit and sync burst.
 * `syncTagPanes` refetches on the way back in, so nothing arrives stale.
 */
function treeActive(): boolean {
  return isTreeShown() && tagPaneMode() === "tree";
}

/**
 * Re-apply the pane layout in every window, and refetch.
 *
 * Both halves are load-bearing. The tree stops rebuilding while it is off
 * screen (see `treeActive`), so whatever puts it back on screen has to fetch —
 * and that can be a tab click, the toolbar menu, the Settings pane or a
 * hand-edited pref, which is why the work lives here rather than in the
 * setters. `scheduleRefresh` no-ops when the tree is not showing, so calling
 * it unconditionally costs nothing.
 */
export function syncTagPanes() {
  for (const w of states.keys()) {
    // Preference observers and tab clicks must have the same hand-back path.
    if (!treeActive()) clearSelection(w);
    applyVisibility(w);
    scheduleRefresh(w, 0);
  }
}

export function setTagPaneMode(_win: Window, mode: TagPaneMode) {
  setPref("nestedTags.tab", mode);
  syncTagPanes();
}

/* ------------------------------------------------------------------ */
/* mount / unmount                                                     */
/* ------------------------------------------------------------------ */

/** windows we are still waiting on (the tag selector mounts asynchronously) */
const pendingInstalls = new Map<Window, number>();

export function installTagTree(win: Window) {
  if (states.has(win)) return;
  const doc = win.document;
  const container = doc.getElementById("zotero-tag-selector-container");
  const native = doc.getElementById("zotero-tag-selector");
  if (!container || !native) {
    // The tag selector is created after the pane and may be collapsed at
    // startup; retry for a while instead of silently never appearing. The
    // counter must survive the retries (deleting it inside the callback made
    // the cap unreachable and the chain retried forever), and a closed or
    // torn-down window (its pendingInstalls entry cleared) ends the chain.
    const attempts = pendingInstalls.get(win) ?? 0;
    if (attempts < 40 && !win.closed) {
      pendingInstalls.set(win, attempts + 1);
      setTimeout(() => {
        if (pendingInstalls.has(win) && !win.closed) installTagTree(win);
      }, 500);
    } else {
      pendingInstalls.delete(win);
    }
    return;
  }
  pendingInstalls.delete(win);
  const nativeElement = native as HTMLElement;
  const previousTree = doc.getElementById(`${config.addonRef}-tag-tree`);
  // A pre-ownership tree hid this selector itself; its native hand-back
  // state was visible. Modern claims already carry the true original value.
  const wasHidden = previousTree ? false : nativeElement.hidden;
  ownership.claim(nativeElement, NATIVE_VISIBILITY, () => {
    nativeElement.hidden = wasHidden;
    if (!wasHidden) remeasureNativeTags(win);
  });

  // leftover from an in-place upgrade: the outgoing copy's tree may still be
  // mounted here until its own shutdown runs
  previousTree?.remove();

  const root = doc.createElement("div");
  root.id = `${config.addonRef}-tag-tree`;
  root.className = "zest-tagtree";

  const bar = doc.createElement("div");
  bar.className = "zest-tagtree-bar";

  const mkButton = (
    cls: string,
    name: IconName,
    tip: string,
    fn: () => void,
  ) => {
    const b = iconButton(doc, name, tip, `zest-tagtree-btn ${cls}`);
    b.type = "button";
    b.addEventListener("click", guard("tag tree button", fn));
    return b;
  };

  // Keep switching/actions separate from search: the native sidebar can be
  // just 200px wide. One crowded row leaves only a few characters to type in.
  const tabs = new Map<TagPaneMode, HTMLElement>();
  const tabStrip = doc.createElement("div");
  tabStrip.className = "zest-tagtree-tabs";
  tabStrip.setAttribute("role", "tablist");
  tabStrip.setAttribute("aria-label", getString("tags-view-label"));
  for (const [mode, iconName, key] of [
    ["tree", "tagnest", "tags-tab-tree"],
    ["native", "list", "tags-tab-all"],
  ] as Array<[TagPaneMode, IconName, "tags-tab-tree" | "tags-tab-all"]>) {
    const tab = iconButton(
      doc,
      iconName,
      getString(key),
      "zest-tagtree-tab",
      13,
    );
    tab.type = "button";
    const text = doc.createElement("span");
    text.textContent = getString(key);
    tab.appendChild(text);
    tab.setAttribute("role", "tab");
    tab.addEventListener(
      "click",
      guard("tag pane tab", () => setTagPaneMode(win, mode)),
    );
    tabStrip.appendChild(tab);
    tabs.set(mode, tab);
  }
  // roving tabindex (applyVisibility parks the inactive tab at -1) means Tab
  // alone can never reach the other view — the arrows have to be the way
  // across, as in the WAI-ARIA tabs pattern the tree rows already follow
  tabStrip.addEventListener(
    "keydown",
    guard("tag pane tabs", (ev: KeyboardEvent) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(ev.key)) return;
      ev.preventDefault();
      const next: TagPaneMode =
        ev.key === "Home"
          ? "tree"
          : ev.key === "End"
            ? "native"
            : tagPaneMode() === "tree"
              ? "native"
              : "tree";
      setTagPaneMode(win, next);
      tabs.get(next)?.focus();
    }),
  );
  bar.appendChild(tabStrip);

  const treeOnly: HTMLElement[] = [];
  const addTreeOnly = <T extends HTMLElement>(el: T): T => {
    treeOnly.push(el);
    bar.appendChild(el);
    return el;
  };

  addTreeOnly(
    mkButton("zest-sort", "sort", getString("tags-sort-tip"), () =>
      cycleSort(win),
    ),
  );
  addTreeOnly(
    mkButton("zest-collapse", "collapse", getString("tags-collapse-tip"), () =>
      toggleAll(win),
    ),
  );
  const search = doc.createElement("input");
  search.className = "zest-tagtree-search";
  search.type = "search";
  search.placeholder = getString("tags-search-placeholder");
  search.setAttribute("aria-label", getString("tags-search-placeholder"));
  const searchBar = doc.createElement("div");
  searchBar.className = "zest-tagtree-searchbar";
  searchBar.appendChild(icon(doc, "search", 13));
  searchBar.appendChild(search);
  const resetSearch = mkButton(
    "zest-search-clear",
    "clear",
    getString("tags-search-clear"),
    () => {
      search.value = "";
      updateSearch();
      search.focus();
    },
  );
  resetSearch.hidden = true;
  searchBar.appendChild(resetSearch);
  treeOnly.push(searchBar);
  const updateSearch = () => {
    const state = states.get(win);
    if (!state) return;
    if (state.searchTimer) clearTimeout(state.searchTimer);
    state.searchTimer = undefined;
    state.query = search.value.trim().toLowerCase();
    resetSearch.hidden = !search.value;
    if (treeActive()) render(state);
  };
  search.addEventListener(
    "input",
    guard("tag search", () => {
      const state = states.get(win);
      if (!state) return;
      if (state.searchTimer) clearTimeout(state.searchTimer);
      resetSearch.hidden = !search.value;
      state.searchTimer = setTimeout(updateSearch, 150);
    }),
  );
  search.addEventListener(
    "keydown",
    guard("tag search keys", (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && search.value) {
        ev.preventDefault();
        search.value = "";
        updateSearch();
      } else if (ev.key === "ArrowDown") {
        ev.preventDefault();
        updateSearch();
        body
          .querySelector<HTMLElement>('.zest-tagtree-row[tabindex="0"]')
          ?.focus();
      }
    }),
  );
  const selectionBar = doc.createElement("div");
  selectionBar.className = "zest-tagtree-selection";
  selectionBar.hidden = true;
  const count = doc.createElement("span");
  count.className = "zest-tagtree-count";
  count.setAttribute("role", "status");
  selectionBar.appendChild(count);
  const chips = doc.createElement("div");
  chips.className = "zest-tagtree-chips";
  selectionBar.appendChild(chips);
  selectionBar.appendChild(
    mkButton("zest-clear", "clear", getString("tags-clear-tip"), () =>
      clearSelection(win),
    ),
  );

  const body = doc.createElement("div");
  body.className = "zest-tagtree-body";
  installTreeKeys(win, body);
  const scroller = doc.createElement("div");
  scroller.className = "zest-tagtree-scroll";
  scroller.appendChild(selectionBar);
  scroller.appendChild(body);
  treeOnly.push(scroller);

  root.appendChild(bar);
  root.appendChild(searchBar);
  root.appendChild(scroller);
  // above the native selector: the tab row has to head the pane in both
  // modes, and our root is still a sibling, never inside the React root
  container.insertBefore(root, native);

  const state: TreeState = {
    win,
    root,
    native: nativeElement,
    body,
    selection: new Map(),
    collapsed: new Map(),
    nodes: [],
    query: "",
    inView: new Set(),
    libraryID: 1,
    branches: new Map(),
    filterKey: "",
    loading: false,
    failed: false,
    tabs,
    treeOnly,
    viewListeners: [],
  };
  states.set(win, state);
  applyVisibility(win);
  watchLibrary(win);
  startNotifier();
  scheduleRefresh(win, 0);
}

export function uninstallTagTree(win: Window) {
  // a window may be torn down while still waiting for its tag selector —
  // clearing the entry stops the pending retry chain
  pendingInstalls.delete(win);
  const state = states.get(win);
  if (!state) return;
  states.delete(win);
  refreshing.delete(win);
  refreshGeneration.delete(win);
  if (state.refreshTimer) clearTimeout(state.refreshTimer);
  if (state.searchTimer) clearTimeout(state.searchTimer);
  for (const { target, fn } of state.viewListeners) {
    try {
      target?.removeListener?.(fn);
    } catch {
      // view already gone
    }
  }
  state.viewListeners.length = 0;
  try {
    state.root.remove();
  } catch {
    // window closing
  }
  try {
    // our context menu lives in the window's popupset, not in our subtree
    if (ownership.owns(state.native, NATIVE_VISIBILITY))
      win.document.getElementById(`${config.addonRef}-tag-menu`)?.remove();
  } catch {
    // window closing
  }
  try {
    ownership.release(state.native, NATIVE_VISIBILITY);
  } catch {
    // window closing
  }
  setItemFilter(win, "tags", null);
  if (!states.size) stopNotifier();
}

export function uninstallAllTagTrees() {
  pendingInstalls.clear();
  for (const win of [...states.keys()]) uninstallTagTree(win);
  // nothing left to filter, so the cached tag lists are dead weight
  clearTagCache();
}

/** switch between Zotero's tag selector and ours */
export function setTreeShown(win: Window, shown: boolean) {
  setPref("nestedTags.show", shown);
  // the tree may not be mounted yet (collapsed selector at startup)
  if (shown && !states.has(win)) installTagTree(win);
  if (!shown) clearSelection(win);
  syncTagPanes();
}

export function toggleTagTree(win: Window) {
  setTreeShown(win, !isTreeShown());
}

/**
 * Make Zotero re-measure its tag widths after we hand the pane back.
 *
 * Zotero sizes each tag from a hidden `div` it appends **inside**
 * `#zotero-tag-selector` (`containers/tagSelectorContainer.js`: `divMeasure`),
 * and on a HiDPI screen emoji tags — plus the first few coloured ones — are
 * measured through that div rather than through canvas, because canvas is off
 * by enough to show. While the element carries our `hidden` attribute its
 * `clientWidth` is 0, so every tag measured in that state gets width 0 and the
 * value is cached; switching back to Zotero's tab then paints those tags on
 * top of each other. Measured on 10.0: "⭐" is 0px hidden, 13px shown.
 *
 * `handleUIPropertiesChange` is Zotero's own cache-clearing path (it is what
 * runs when the UI font or pixel density changes), so we reuse it instead of
 * reaching into the width maps.
 */
function remeasureNativeTags(win: Window) {
  const selector = (win as any).ZoteroPane?.tagSelector;
  if (!selector) return;
  // one tick: the attribute is off, but let the pane get its layout back
  // before Zotero reads clientWidth out of it
  win.setTimeout(() => {
    try {
      // A new copy may have taken over and hidden the native selector again.
      const native = win.document.getElementById(
        "zotero-tag-selector",
      ) as HTMLElement | null;
      if (native?.hidden) return;
      if (typeof selector.handleUIPropertiesChange === "function") {
        selector.handleUIPropertiesChange({});
      }
      if (typeof selector.handleResize === "function") selector.handleResize();
    } catch (e) {
      ztoolkit.log("[tags] native tag re-measure failed", e);
    }
  }, 0);
}

function applyVisibility(win: Window) {
  const state = states.get(win);
  if (!state || !ownership.owns(state.native, NATIVE_VISIBILITY)) return;
  const on = isTreeShown();
  const tree = on && tagPaneMode() === "tree";
  const native = win.document.getElementById(
    "zotero-tag-selector",
  ) as HTMLElement | null;
  // master off → the pane is Zotero's, tab strip and all
  const wasHidden = !!native?.hidden;
  if (native) native.hidden = tree;
  if (native && wasHidden && !tree) remeasureNativeTags(win);
  state.root.hidden = !on;
  // on the native tab our root is just the tab row: it must not eat the
  // height the tag list needs
  state.root.classList.toggle("zest-tagtree-baronly", on && !tree);
  state.body.hidden = !tree;
  for (const el of state.treeOnly) el.hidden = !tree;
  const selectionBar = state.root.querySelector<HTMLElement>(
    ".zest-tagtree-selection",
  );
  if (selectionBar) selectionBar.hidden = !tree || !state.selection.size;
  if (!tree && state.searchTimer) {
    clearTimeout(state.searchTimer);
    state.searchTimer = undefined;
    const search = state.root.querySelector<HTMLInputElement>(
      ".zest-tagtree-search",
    );
    state.query = search?.value.trim().toLowerCase() || "";
  }
  for (const [mode, tab] of state.tabs) {
    const active = on && tagPaneMode() === mode;
    tab.classList.toggle("selected", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
    tab.tabIndex = active ? 0 : -1;
  }
}

/* ------------------------------------------------------------------ */
/* the way back: Zotero's own tag-selector options menu                */
/* ------------------------------------------------------------------ */

/**
 * Switching to Zotero's tag selector used to be a trapdoor: the button that
 * did it lives inside the tree, so once the tree was gone the only way back
 * was Tools ▸ Zest. Both directions now live in the widget you are actually
 * looking at — the tree's own button on the way out, and a checkbox in
 * Zotero's tag-selector options menu (the ≡ under its filter box) on the way
 * back.
 *
 * That menu is a static XUL popup in zoteroPane.xhtml, NOT part of the tag
 * selector's React tree, so appending to it on `popupshowing` is safe and
 * leaves nothing behind — the same technique as the column-picker submenu.
 */
const OPTIONS_MENU_ID = "tag-selector-view-settings-menu";
const TOGGLE_ITEM_ID = `${config.addonRef}-tagtree-toggle`;
const optionsListeners = new Map<Window, (ev: Event) => void>();
const optionsItems = new WeakMap<Window, Element>();

export function installTagOptionsMenu(win: Window) {
  if (optionsListeners.has(win)) return;
  const handler = guard("tag options menu", (ev: Event) => {
    const popup = ev.target as Element | null;
    if (popup?.id !== OPTIONS_MENU_ID) return;
    const doc = win.document;
    let item = doc.getElementById(TOGGLE_ITEM_ID);
    if (item && item !== optionsItems.get(win)) {
      item.remove();
      item = null;
    }
    if (!item) {
      item = doc.createXULElement("menuitem");
      item.id = TOGGLE_ITEM_ID;
      optionsItems.set(win, item);
      item.setAttribute("type", "checkbox");
      item.setAttribute("label", getString("tags-tree-toggle", "label"));
      item.addEventListener(
        "command",
        guard("tag tree toggle", () => toggleTagTree(win)),
      );
      // with the other "what does this pane show" options, not next to the
      // destructive "delete automatic tags"
      const before = doc.getElementById("show-automatic");
      if (before?.parentElement === popup) {
        popup.insertBefore(item, before);
      } else {
        popup.appendChild(item);
      }
    }
    item.setAttribute("checked", isTreeShown() ? "true" : "false");
  });
  win.document.addEventListener("popupshowing", handler);
  optionsListeners.set(win, handler);
}

export function uninstallTagOptionsMenu(win: Window) {
  const handler = optionsListeners.get(win);
  optionsListeners.delete(win);
  try {
    if (handler) win.document.removeEventListener("popupshowing", handler);
    optionsItems.get(win)?.remove();
    optionsItems.delete(win);
  } catch {
    // window gone
  }
}

export function uninstallAllTagOptionsMenus() {
  for (const win of [...optionsListeners.keys()]) uninstallTagOptionsMenu(win);
}

/* ------------------------------------------------------------------ */
/* data + rendering                                                    */
/* ------------------------------------------------------------------ */

function scheduleRefresh(win: Window, delay = 300) {
  const state = states.get(win);
  if (!state || !ownership.owns(state.native, NATIVE_VISIBILITY)) return;
  // Invalidate on the event, not 300ms later when its debounce runs. An old
  // collection's async scope must not paint in the meantime (or after a
  // quick native → tree round trip).
  if (refreshing.has(win))
    refreshGeneration.set(win, (refreshGeneration.get(win) ?? 0) + 1);
  if (state.refreshTimer) clearTimeout(state.refreshTimer);
  state.refreshTimer = undefined;
  if (!treeActive()) return;
  state.refreshTimer = setTimeout(() => {
    state.refreshTimer = undefined;
    void refreshTagTree(win);
  }, delay);
}

export function refreshAllTagTrees() {
  for (const win of states.keys()) scheduleRefresh(win);
}

/** one full-library pass at a time, per window (a sync fires bursts) */
const refreshing = new Map<Window, Promise<void>>();
const refreshGeneration = new Map<Window, number>();

export async function refreshTagTree(win: Window): Promise<void> {
  const inFlight = refreshing.get(win);
  if (inFlight) {
    // a pass is already walking the library; mark it stale and let it re-run
    // once, instead of starting a second walk beside it
    refreshGeneration.set(win, (refreshGeneration.get(win) ?? 0) + 1);
    return inFlight;
  }
  const state = states.get(win);
  if (state?.refreshTimer) {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = undefined;
  }
  refreshGeneration.set(win, 0);
  const run = runTagTreeRefresh(win).finally(() => {
    // An old window/copy's promise must not remove a newer pass's lock.
    if (refreshing.get(win) !== run) return;
    refreshing.delete(win);
    const pending = refreshGeneration.get(win) ?? 0;
    if (pending > 0 && !states.get(win)?.refreshTimer) {
      refreshGeneration.set(win, 0);
      void refreshTagTree(win);
    }
  });
  refreshing.set(win, run);
  return run;
}

async function runTagTreeRefresh(win: Window) {
  const state = states.get(win);
  if (
    !state ||
    !treeActive() ||
    !ownership.owns(state.native, NATIVE_VISIBILITY)
  )
    return;
  const libraryID = selectedLibraryID(win);
  const cancelled = () =>
    states.get(win) !== state ||
    !treeActive() ||
    !ownership.owns(state.native, NATIVE_VISIBILITY) ||
    selectedLibraryID(win) !== libraryID ||
    (refreshGeneration.get(win) ?? 0) > 0;
  try {
    const zp = (win as any).ZoteroPane;
    if (state.libraryID !== libraryID) {
      clearSelection(win);
      state.collapsed.clear();
      state.nodes = [];
      state.branches.clear();
      state.focusPath = undefined;
      state.libraryID = libraryID;
    }
    state.loading = true;
    state.failed = false;
    render(state);
    const rows: Zotero.Item[] = (zp?.itemsView?.getSortedItems?.() ??
      []) as Zotero.Item[];
    const viewItems = rows.filter(
      (i) => i instanceof Zotero.Item && !i.isAnnotation?.(),
    );
    const scope = await collectTagScope(libraryID, viewItems, cancelled);
    if (cancelled()) return;
    const { mode, descending } = sortMode();
    state.libraryID = libraryID;
    state.inView = scope.inView;
    state.nodes = buildTagTree(scope.inputs, {
      linkSymbol: linkSymbol(),
      sort: mode,
      descending,
      matcher: parseTagRule(getPref("textTags.match") as string),
    });
    state.branches.clear();
    const indexBranch = (node: TagNode): Set<string> => {
      // A single post-order pass per snapshot. Subsequent selections, search
      // and expansion reuse these sets rather than re-walking each branch.
      const names = new Set(tagNamesOf(node));
      for (const child of node.children)
        for (const name of indexBranch(child)) names.add(name);
      state.branches.set(node.name, {
        node,
        names,
        inView: [...names].some((n) => state.inView.has(n)),
      });
      return names;
    };
    for (const node of state.nodes) indexBranch(node);
    for (const path of state.collapsed.keys())
      if (!state.branches.has(path)) state.collapsed.delete(path);
    for (const path of state.selection.keys()) {
      const branch = state.branches.get(path);
      if (branch) state.selection.set(path, branch.names);
      else state.selection.delete(path);
    }
    state.loading = false;
    applyTagFilter(state);
    render(state);
  } catch (e) {
    if (cancelled()) return;
    ztoolkit.log("[tags] refresh failed", e);
    state.loading = false;
    state.failed = true;
    render(state);
  }
}

function render(state: TreeState) {
  const doc = state.win.document;
  const body = state.body;
  const hadFocus = !!doc.activeElement && body.contains(doc.activeElement);
  // In a background chrome window focus() can update activeElement without
  // dispatching focus yet. Read the actual row before replacing its DOM.
  if (hadFocus) {
    const path = doc.activeElement?.getAttribute("data-tag");
    if (path) state.focusPath = path;
  }
  const scroller = body.parentElement!;
  const scrollTop = scroller.scrollTop;
  body.textContent = "";
  // Zotero's own "Display All Tags in This Library" switch (tag selector ≡
  // menu) decides this for the tree too — one setting, not two
  const showAll = !!Zotero.Prefs.get(
    "extensions.zotero.tagSelector.displayAllTags",
    true,
  );

  const query = state.query;
  const matching = new Map<TagNode, boolean>();
  const matches = (node: TagNode): boolean => {
    if (!query) return true;
    if (!matching.has(node))
      matching.set(
        node,
        node.name.toLowerCase().includes(query) || node.children.some(matches),
      );
    return matching.get(node)!;
  };

  const rows: HTMLElement[] = [];
  const addNode = (node: TagNode, depth: number) => {
    if (!matches(node)) return;
    const { names: realNames, inView } = state.branches.get(node.name)!;
    const selected = state.selection.has(node.name);
    // a search always opens the branches that contain a hit
    const collapsed = query ? false : (state.collapsed.get(node.name) ?? true);

    const row = doc.createElement("div");
    row.className = "zest-tagtree-row";
    row.style.setProperty("--zest-tag-depth", String(Math.min(depth, 7)));
    row.classList.toggle("zest-tagtree-branch", !!node.children.length);
    if (selected) row.classList.add("selected");
    if (!inView && !selected) row.classList.add("dim");
    row.setAttribute("data-tag", node.name);
    // Zotero's own tag selector is keyboard operable, and this tree REPLACES
    // it — so it carries the same contract: one tab stop for the whole tree,
    // arrow keys to move, Enter/Space to select.
    row.setAttribute("role", "treeitem");
    row.setAttribute("aria-level", String(depth + 1));
    row.setAttribute("aria-selected", selected ? "true" : "false");
    if (node.children.length) {
      row.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }
    row.tabIndex = -1;
    row.addEventListener("focus", () => {
      state.focusPath = node.name;
    });

    const twisty = doc.createElement("span");
    twisty.className = "zest-tagtree-twisty";
    if (node.children.length) {
      twisty.textContent = collapsed ? "▸" : "▾";
      twisty.addEventListener(
        "click",
        guard("tag twisty", (ev: Event) => {
          ev.stopPropagation();
          if (state.loading) return;
          state.focusPath = node.name;
          state.collapsed.set(node.name, !collapsed);
          render(state);
          focusTreePath(state, node.name);
        }),
      );
    }
    row.appendChild(twisty);

    const style = resolveTagStyle(
      node.name,
      new Map(
        node.color ? [[node.name, { color: node.color, position: 0 }]] : [],
      ),
    );
    if (node.color || style.emoji || ruleFor(node.name)?.color) {
      const dot = doc.createElement("span");
      if (style.emoji) {
        dot.className = "zest-tagtree-emoji";
        dot.textContent = style.emoji;
      } else {
        dot.className = "zest-tagtree-dot";
        dot.style.backgroundColor = node.color || style.color;
      }
      row.appendChild(dot);
    }

    const label = doc.createElement("span");
    label.className = "zest-tagtree-label";
    label.textContent = node.segment;
    row.appendChild(label);

    const num = doc.createElement("span");
    num.className = "zest-tagtree-num";
    num.textContent = String(node.total);
    row.appendChild(num);

    row.title = getString("tags-row-tip", {
      args: { path: node.name, items: node.total, tags: realNames.size },
    });

    const clickable = !state.loading && (showAll || inView || selected);
    if (!clickable) row.classList.add("disabled");
    row.setAttribute("aria-disabled", String(!clickable));
    row.addEventListener(
      "click",
      guard("tag click", () => {
        if (!clickable) return;
        toggleNode(state, node, realNames);
      }),
    );
    row.addEventListener(
      "contextmenu",
      guard("tag context", (ev: MouseEvent) => {
        ev.preventDefault();
        showTagContextMenu(state.win, {
          node,
          realNames: [...realNames],
          libraryID: state.libraryID,
          linkSymbol: linkSymbol(),
          screenX: ev.screenX,
          screenY: ev.screenY,
          onChanged: () => scheduleRefresh(state.win, 100),
        });
      }),
    );
    rows.push(row);
    if (!collapsed) for (const c of node.children) addNode(c, depth + 1);
  };

  if (!state.failed) for (const n of state.nodes) addNode(n, 0);
  for (const r of rows) body.appendChild(r);

  body.setAttribute("role", "tree");
  body.setAttribute("aria-label", getString("tags-tree-label"));
  body.setAttribute("aria-multiselectable", "true");
  body.setAttribute("aria-busy", String(state.loading));
  // the remembered row keeps the tab stop across re-renders; if it is gone
  // (collapsed away, filtered out) the first row takes it
  let focusPath = state.focusPath;
  let tabStop = rows.find((r) => r.getAttribute("data-tag") === focusPath);
  while (!tabStop && focusPath?.includes(linkSymbol())) {
    focusPath = focusPath.slice(0, focusPath.lastIndexOf(linkSymbol()));
    tabStop = rows.find((r) => r.getAttribute("data-tag") === focusPath);
  }
  tabStop ??= rows[0];
  if (tabStop) {
    tabStop.tabIndex = 0;
    state.focusPath = tabStop.getAttribute("data-tag") || undefined;
    if (hadFocus) tabStop.focus({ preventScroll: true });
  }

  if (!rows.length) {
    const empty = doc.createElement("div");
    empty.className = "zest-tagtree-empty";
    empty.textContent = getString(
      state.loading
        ? "tags-loading"
        : state.failed
          ? "tags-load-failed"
          : query
            ? "tags-no-results"
            : "tags-empty",
    );
    if (state.failed) {
      const retry = doc.createElement("button");
      retry.type = "button";
      retry.className = "zest-tagtree-retry";
      retry.textContent = getString("tags-retry");
      retry.addEventListener(
        "click",
        guard("tag retry", () => void refreshTagTree(state.win)),
      );
      empty.appendChild(retry);
    }
    body.appendChild(empty);
  }
  scroller.scrollTop = scrollTop;
  syncControls(state);
}

function syncControls(state: TreeState) {
  const doc = state.win.document;
  const sort = state.root.querySelector<HTMLButtonElement>(".zest-sort");
  if (sort) {
    const mode =
      SORTS.find((mode) => mode === getPref("nestedTags.sort")) ?? "az";
    sort.title = getString(`tags-sort-${mode}`);
    sort.setAttribute("aria-label", sort.title);
    sort.disabled = state.loading;
  }
  const collapse =
    state.root.querySelector<HTMLButtonElement>(".zest-collapse");
  if (collapse) {
    const branches = [...state.branches.values()].filter(
      (b) => b.node.children.length,
    );
    const open = branches.some(
      (b) => state.collapsed.get(b.node.name) === false,
    );
    collapse.title = getString(open ? "tags-collapse-all" : "tags-expand-all");
    collapse.setAttribute("aria-label", collapse.title);
    collapse.disabled = !branches.length || !!state.query || state.loading;
  }
  const selected = state.root.querySelector<HTMLElement>(
    ".zest-tagtree-selection",
  );
  if (selected) selected.hidden = !treeActive() || !state.selection.size;
  const chips = state.root.querySelector<HTMLElement>(".zest-tagtree-chips");
  if (chips) {
    const focused = doc.activeElement?.getAttribute("data-selected-tag");
    chips.textContent = "";
    for (const path of state.selection.keys()) {
      const chip = doc.createElement("button");
      chip.type = "button";
      chip.className = "zest-tagtree-chip";
      chip.setAttribute("data-selected-tag", path);
      chip.title = getString("tags-remove-selection", { args: { path } });
      chip.setAttribute("aria-label", chip.title);
      const text = doc.createElement("span");
      text.textContent = path;
      chip.appendChild(text);
      chip.appendChild(icon(doc, "clear", 10));
      chip.addEventListener(
        "click",
        guard("tag remove selection", () => {
          state.selection.delete(path);
          applyTagFilter(state);
          render(state);
          state.root
            .querySelector<HTMLInputElement>(".zest-tagtree-search")
            ?.focus();
        }),
      );
      chips.appendChild(chip);
      if (focused === path) chip.focus({ preventScroll: true });
    }
  }

  const counter = state.root.querySelector(".zest-tagtree-count");
  if (counter) {
    counter.textContent = state.selection.size
      ? getString("tags-selected", { args: { count: state.selection.size } })
      : "";
  }
}

function focusTreePath(state: TreeState, path: string) {
  // No selector interpolation: imported labels may contain quotes/newlines.
  const row = [
    ...state.body.querySelectorAll<HTMLElement>(".zest-tagtree-row"),
  ].find((r) => r.getAttribute("data-tag") === path);
  row?.focus();
}

/**
 * Keyboard contract, mirroring Zotero's own tag selector:
 *   ↑ ↓        move between visible rows
 *   ← →        collapse / expand a branch (→ on a leaf does nothing)
 *   Home End   first / last row
 *   Enter Space  select or deselect the branch
 * The tree keeps ONE tab stop (see the roving tabindex in render), so Tab
 * moves past the whole tree rather than through every tag.
 */
function installTreeKeys(win: Window, body: HTMLElement) {
  body.addEventListener(
    "keydown",
    guard("tag keys", (ev: KeyboardEvent) => {
      const state = states.get(win);
      if (!state || state.loading || ev.altKey || ev.ctrlKey || ev.metaKey)
        return;
      const rows = [...body.querySelectorAll<HTMLElement>(".zest-tagtree-row")];
      if (!rows.length) return;
      const active = win.document.activeElement as HTMLElement | null;
      const index = active ? rows.indexOf(active) : -1;
      const current = index >= 0 ? rows[index] : rows[0];
      const focusRow = (row: HTMLElement | undefined) => {
        if (!row) return;
        for (const r of rows) r.tabIndex = -1;
        row.tabIndex = 0;
        state.focusPath = row.getAttribute("data-tag") || undefined;
        row.focus();
      };
      const path = current.getAttribute("data-tag") || "";
      switch (ev.key) {
        case "ArrowDown":
          ev.preventDefault();
          focusRow(rows[Math.min(rows.length - 1, index + 1)]);
          return;
        case "ArrowUp":
          ev.preventDefault();
          focusRow(rows[Math.max(0, index - 1)]);
          return;
        case "Home":
          ev.preventDefault();
          focusRow(rows[0]);
          return;
        case "End":
          ev.preventDefault();
          focusRow(rows[rows.length - 1]);
          return;
        case "ArrowRight":
        case "ArrowLeft": {
          ev.preventDefault();
          const expanded = current.getAttribute("aria-expanded");
          const level = Number(current.getAttribute("aria-level"));
          if (ev.key === "ArrowRight") {
            if (expanded === "false") {
              state.collapsed.set(path, false);
              render(state);
              focusTreePath(state, path);
            } else if (expanded === "true") focusRow(rows[index + 1]);
          } else if (expanded === "true" && !state.query) {
            state.collapsed.set(path, true);
            render(state);
            focusTreePath(state, path);
          } else {
            for (let i = index - 1; i >= 0; i--)
              if (Number(rows[i].getAttribute("aria-level")) < level) {
                focusRow(rows[i]);
                break;
              }
          }
          return;
        }
        case "Enter":
        case " ":
          ev.preventDefault();
          current.click();
          focusTreePath(state, path);
          return;
        default:
          return;
      }
    }),
  );
}

function toggleNode(state: TreeState, node: TagNode, realNames: Set<string>) {
  if (state.selection.has(node.name)) state.selection.delete(node.name);
  else state.selection.set(node.name, realNames);
  applyTagFilter(state);
  render(state);
}

export function clearSelection(win: Window) {
  const state = states.get(win);
  if (!state) return;
  if (!state.selection.size) {
    // No phantom refresh when the normal preference observer calls us twice.
    if (state.filterKey) applyTagFilter(state);
    return;
  }
  state.selection.clear();
  applyTagFilter(state);
  render(state);
}

/**
 * Listeners for "the selected tags changed" (the annotation cards subscribe).
 * A callback registry rather than an import keeps this module free of a cycle
 * with panes/annotSection — circular imports in the bundled IIFE evaluate in
 * an unpredictable order and can blow up at load time.
 */
const selectionListeners = new Set<() => void>();

export function onTagSelectionChange(fn: () => void): () => void {
  selectionListeners.add(fn);
  return () => selectionListeners.delete(fn);
}

function emitSelectionChange() {
  for (const fn of selectionListeners) {
    try {
      fn();
    } catch (e) {
      ztoolkit.log("[tags] selection listener failed", e);
    }
  }
}

function applyTagFilter(state: TreeState) {
  const groups = [...state.selection.values()].map((set) => new Set(set));
  const withChildren = matchChildTags();
  const showAutomatic =
    Zotero.Prefs.get("extensions.zotero.tagSelector.showAutomatic", true) !==
    false;
  const link = linkSymbol();
  const key = groups.length
    ? JSON.stringify([
        state.libraryID,
        withChildren,
        showAutomatic,
        link,
        [...state.selection].map(([path, names]) => [path, [...names].sort()]),
      ])
    : "";
  if (key === state.filterKey) return;
  state.filterKey = key;
  emitSelectionChange();
  if (!groups.length) {
    setItemFilter(state.win, "tags", null);
    void refreshItemView(state.win);
    return;
  }
  // per selected branch: the exact names as a set, the "under this tag"
  // prefixes as strings — built once, not per item per tag
  const tests = groups.map((names) => ({
    exact: names,
    prefixes: [...names].map((n) => n + link),
  }));
  const ok = setItemFilter(state.win, "tags", (items) => {
    // the tag cache is NOT cleared here: this predicate runs on every refresh
    // of the item list, and rebuilding every item's tag list each time made
    // typing in the quick search walk the whole library. The notifier drops
    // the entries that actually changed.
    return items.filter((item) => {
      try {
        const tags = cachedTags(item, withChildren, showAutomatic);
        if (!tags.length) return false;
        // AND between branches, OR within a branch
        return tests.every(({ exact, prefixes }) =>
          tags.some(
            (t) => exact.has(t) || prefixes.some((p) => t.startsWith(p)),
          ),
        );
      } catch {
        return true; // never hide an item because of our own error
      }
    });
  });
  if (!ok) {
    ztoolkit.log("[tags] filtering unavailable on this Zotero build");
    return;
  }
  void refreshItemView(state.win);
}

/* ------------------------------------------------------------------ */
/* toolbar actions                                                     */
/* ------------------------------------------------------------------ */

const SORTS = ["az", "za", "freq-desc", "freq-asc"] as const;

function cycleSort(win: Window) {
  const cur = String(getPref("nestedTags.sort") || "az");
  const i = SORTS.indexOf(cur as (typeof SORTS)[number]);
  const next = SORTS[(i + 1) % SORTS.length];
  // the nestedTags.sort pref observer (hooks.ts) refreshes every tree
  setPref("nestedTags.sort", next);
  const state = states.get(win);
  if (state) syncControls(state);
}

function toggleAll(win: Window) {
  const state = states.get(win);
  if (!state) return;
  let anyOpen = false;
  walk(state.nodes, (n) => {
    if (n.children.length && state.collapsed.get(n.name) === false) {
      anyOpen = true;
    }
  });
  walk(state.nodes, (n) => {
    if (n.children.length) state.collapsed.set(n.name, anyOpen);
  });
  render(state);
}

/* ------------------------------------------------------------------ */
/* live updates                                                        */
/* ------------------------------------------------------------------ */

function watchLibrary(win: Window) {
  const state = states.get(win);
  if (!state) return;
  try {
    const zp = (win as any).ZoteroPane;
    const bind = (target: any, name: string) => {
      if (!target?.addListener) return;
      const fn = guard(`tag tree ${name}`, () => scheduleRefresh(win));
      target.addListener(fn);
      state.viewListeners.push({ target, fn });
    };
    bind(zp?.itemsView?.onRefresh, "onRefresh");
    bind(zp?.collectionsView?.onSelect, "onSelect");
  } catch (e) {
    ztoolkit.log("[tags] view listeners unavailable", e);
  }
}

function startNotifier() {
  if (notifierID) return;
  notifierID = Zotero.Notifier.registerObserver(
    {
      notify: (_event: string, type: string, ids: Array<string | number>) => {
        // `setting` fires for every synced setting — including the reader's
        // lastPageIndex on each page turn — so only react to tag colours
        if (type === "setting") {
          if (ids.some((id) => String(id).endsWith("/tagColors"))) {
            refreshAllTagTrees();
          }
          return;
        }
        if (
          type === "tag" ||
          type === "item-tag" ||
          type === "item" ||
          type === "collection-item"
        ) {
          // a renamed or deleted tag can touch any item; an item-tag event
          // names the items it touched
          invalidateTagCache(
            type === "item-tag" || type === "item" ? ids : undefined,
          );
          refreshAllTagTrees();
        }
      },
    },
    ["tag", "item-tag", "item", "setting", "collection-item"],
    `${config.addonRef}-tagtree`,
    101,
  );
}

function stopNotifier() {
  if (!notifierID) return;
  try {
    Zotero.Notifier.unregisterObserver(notifierID);
  } catch {
    // ignore
  }
  notifierID = undefined;
}

/** the currently selected branches (used by the annotation locator cards) */
export function selectedTagNames(win?: Window): string[] {
  const state = win ? states.get(win) : [...states.values()][0];
  if (!state) return [];
  const out = new Set<string>();
  for (const names of state.selection.values()) {
    for (const n of names) out.add(n);
  }
  return [...out];
}

export function tagFilteringSupported(): boolean {
  return canFilter();
}
