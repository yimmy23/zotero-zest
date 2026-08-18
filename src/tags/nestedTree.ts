import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { getPref, setPref } from "../utils/prefs";
import { guard } from "../utils/guard";
import { setTimeout, clearTimeout } from "../utils/timers";
import { parseTagRule } from "./match";
import {
  collectTagScope,
  itemHasPrefix,
  matchChildTags,
  selectedLibraryID,
  clearTagCache,
} from "./scope";
import {
  buildTagTree,
  branchTagNames,
  walk,
  type TagNode,
  type TagSortMode,
  LINK_SYMBOLS,
} from "./tree";
import { resolveTagStyle } from "./rules";
import { setItemFilter, refreshItemView, canFilter } from "../views/itemFilter";
import { showTagContextMenu } from "./menu";
import { iconButton, type IconName } from "../ui/icons";

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
  body: HTMLElement;
  /** display path → real tag names in that branch */
  selection: Map<string, Set<string>>;
  collapsed: Map<string, boolean>;
  nodes: TagNode[];
  query: string;
  inView: Set<string>;
  libraryID: number;
  refreshTimer?: number;
  searchTimer?: number;
  /** listeners we added to Zotero's views, so they can be removed again */
  viewListeners: Array<{ target: any; fn: (...args: any[]) => void }>;
}

const states = new Map<Window, TreeState>();
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
    // startup; retry for a while instead of silently never appearing.
    const attempts = pendingInstalls.get(win) ?? 0;
    if (attempts < 40) {
      pendingInstalls.set(win, attempts + 1);
      setTimeout(() => {
        pendingInstalls.delete(win);
        installTagTree(win);
      }, 500);
    }
    return;
  }
  pendingInstalls.delete(win);

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
    b.addEventListener("click", guard("tag tree button", fn));
    return b;
  };

  bar.appendChild(
    mkButton("zest-sort", "sort", getString("tags-sort-tip"), () =>
      cycleSort(win),
    ),
  );
  bar.appendChild(
    mkButton("zest-collapse", "collapse", getString("tags-collapse-tip"), () =>
      toggleAll(win),
    ),
  );
  const search = doc.createElement("input");
  search.className = "zest-tagtree-search";
  search.type = "search";
  search.placeholder = getString("tags-search-placeholder");
  search.addEventListener(
    "input",
    guard("tag search", () => {
      const state = states.get(win);
      if (!state) return;
      // debounce: every keystroke rebuilds the whole tree body
      if (state.searchTimer) clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(() => {
        state.searchTimer = undefined;
        state.query = search.value.trim().toLowerCase();
        render(state);
      }, 150);
    }),
  );
  bar.appendChild(search);
  const count = doc.createElement("span");
  count.className = "zest-tagtree-count";
  bar.appendChild(count);
  bar.appendChild(
    mkButton("zest-clear", "clear", getString("tags-clear-tip"), () =>
      clearSelection(win),
    ),
  );
  bar.appendChild(
    mkButton("zest-switch", "list", getString("tags-switch-tip"), () =>
      setTreeShown(win, false),
    ),
  );

  const body = doc.createElement("div");
  body.className = "zest-tagtree-body";

  root.appendChild(bar);
  root.appendChild(body);
  container.appendChild(root);

  const state: TreeState = {
    win,
    root,
    body,
    selection: new Map(),
    collapsed: new Map(),
    nodes: [],
    query: "",
    inView: new Set(),
    libraryID: 1,
    viewListeners: [],
  };
  states.set(win, state);
  applyVisibility(win);
  watchLibrary(win);
  startNotifier();
  if (isTreeShown()) scheduleRefresh(win, 0);
}

export function uninstallTagTree(win: Window) {
  const state = states.get(win);
  if (!state) return;
  states.delete(win);
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
    win.document.getElementById(`${config.addonRef}-tag-menu`)?.remove();
  } catch {
    // window closing
  }
  try {
    const native = win.document.getElementById(
      "zotero-tag-selector",
    ) as HTMLElement | null;
    if (native) native.hidden = false;
  } catch {
    // window closing
  }
  setItemFilter(win, "tags", null);
  if (!states.size) stopNotifier();
}

export function uninstallAllTagTrees() {
  for (const win of [...states.keys()]) uninstallTagTree(win);
}

/** switch between Zotero's tag selector and ours */
export function setTreeShown(win: Window, shown: boolean) {
  setPref("nestedTags.show", shown);
  // the tree may not be mounted yet (collapsed selector at startup)
  if (shown && !states.has(win)) installTagTree(win);
  for (const w of states.keys()) applyVisibility(w);
  if (shown) scheduleRefresh(win, 0);
  else clearSelection(win);
}

export function toggleTagTree(win: Window) {
  setTreeShown(win, !isTreeShown());
}

function applyVisibility(win: Window) {
  const state = states.get(win);
  if (!state) return;
  const shown = isTreeShown();
  const native = win.document.getElementById(
    "zotero-tag-selector",
  ) as HTMLElement | null;
  if (native) native.hidden = shown;
  state.root.hidden = !shown;
}

/* ------------------------------------------------------------------ */
/* data + rendering                                                    */
/* ------------------------------------------------------------------ */

function scheduleRefresh(win: Window, delay = 300) {
  const state = states.get(win);
  if (!state) return;
  if (state.refreshTimer) clearTimeout(state.refreshTimer);
  state.refreshTimer = setTimeout(() => {
    state.refreshTimer = undefined;
    void refreshTagTree(win);
  }, delay);
}

export function refreshAllTagTrees() {
  for (const win of states.keys()) scheduleRefresh(win);
}

export async function refreshTagTree(win: Window) {
  const state = states.get(win);
  if (!state || !isTreeShown()) return;
  try {
    const zp = (win as any).ZoteroPane;
    const libraryID = selectedLibraryID(win);
    const rows: Zotero.Item[] = (zp?.itemsView?.getSortedItems?.() ??
      []) as Zotero.Item[];
    const viewItems = rows.filter(
      (i) => i instanceof Zotero.Item && !i.isAnnotation?.(),
    );
    const scope = await collectTagScope(libraryID, viewItems);
    const { mode, descending } = sortMode();
    state.libraryID = libraryID;
    state.inView = scope.inView;
    state.nodes = buildTagTree(scope.inputs, {
      linkSymbol: linkSymbol(),
      sort: mode,
      descending,
      matcher: parseTagRule(getPref("textTags.match") as string),
    });
    render(state);
  } catch (e) {
    ztoolkit.log("[tags] refresh failed", e);
  }
}

function render(state: TreeState) {
  const doc = state.win.document;
  const body = state.body;
  body.textContent = "";
  const showAll = !!getPref("nestedTags.showAllTags");

  const query = state.query;
  const matches = (node: TagNode): boolean => {
    if (!query) return true;
    if (node.name.toLowerCase().includes(query)) return true;
    return node.children.some(matches);
  };

  const rows: HTMLElement[] = [];
  const addNode = (node: TagNode, depth: number) => {
    if (!matches(node)) return;
    const realNames = branchTagNames(node);
    const inView = [...realNames].some((n) => state.inView.has(n));
    const selected = state.selection.has(node.name);
    // a search always opens the branches that contain a hit
    const collapsed = query ? false : (state.collapsed.get(node.name) ?? true);

    const row = doc.createElement("div");
    row.className = "zest-tagtree-row";
    row.style.paddingInlineStart = `${6 + depth * 14}px`;
    if (selected) row.classList.add("selected");
    if (!inView && !selected) row.classList.add("dim");
    row.setAttribute("data-tag", node.name);

    const twisty = doc.createElement("span");
    twisty.className = "zest-tagtree-twisty";
    if (node.children.length) {
      twisty.textContent = collapsed ? "▸" : "▾";
      twisty.addEventListener(
        "click",
        guard("tag twisty", (ev: Event) => {
          ev.stopPropagation();
          state.collapsed.set(node.name, !collapsed);
          render(state);
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
    if (node.color || style.emoji) {
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
    num.textContent = node.total ? String(node.total) : "";
    row.appendChild(num);

    row.title = getString("tags-row-tip", {
      args: { path: node.name, items: node.total, tags: realNames.size },
    });

    const clickable = showAll || inView || selected;
    if (!clickable) row.classList.add("disabled");
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

  for (const n of state.nodes) addNode(n, 0);
  for (const r of rows) body.appendChild(r);

  if (!rows.length) {
    const empty = doc.createElement("div");
    empty.className = "zest-tagtree-empty";
    empty.textContent = getString("tags-empty");
    body.appendChild(empty);
  }

  const counter = state.root.querySelector(".zest-tagtree-count");
  if (counter) {
    counter.textContent = state.selection.size
      ? getString("tags-selected", { args: { count: state.selection.size } })
      : "";
  }
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
    setItemFilter(win, "tags", null);
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
  emitSelectionChange();
  const groups = [...state.selection.values()].map((set) => new Set(set));
  if (!groups.length) {
    setItemFilter(state.win, "tags", null);
    void refreshItemView(state.win);
    return;
  }
  const withChildren = matchChildTags();
  const link = linkSymbol();
  const ok = setItemFilter(state.win, "tags", (items) => {
    // the per-item tag lists are only valid for one pass over the view
    clearTagCache();
    return items.filter((item) => {
      try {
        for (const names of groups) {
          if (!itemHasAny(item, names, withChildren, link)) return false;
        }
        return true;
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

/** OR within one selected branch: any tag of the branch is enough */
function itemHasAny(
  item: Zotero.Item,
  names: Set<string>,
  withChildren: boolean,
  link: string,
): boolean {
  for (const n of names) {
    if (itemHasPrefix(item, [n], link, withChildren)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* toolbar actions                                                     */
/* ------------------------------------------------------------------ */

const SORTS = ["az", "za", "freq-desc", "freq-asc"] as const;

function cycleSort(win: Window) {
  const cur = String(getPref("nestedTags.sort") || "az");
  const i = SORTS.indexOf(cur as (typeof SORTS)[number]);
  const next = SORTS[(i + 1) % SORTS.length];
  setPref("nestedTags.sort", next);
  void refreshTagTree(win);
  try {
    const btn = states
      .get(win)
      ?.root.querySelector(".zest-sort") as HTMLElement;
    if (btn) btn.title = getString(`tags-sort-${next}`);
  } catch {
    // no button yet
  }
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
          type === "collection-item"
        ) {
          refreshAllTagTrees();
        }
      },
    },
    ["tag", "item-tag", "setting", "collection-item"],
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
