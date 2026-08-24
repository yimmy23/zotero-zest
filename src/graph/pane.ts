import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { getPref, setPref, getNumPref } from "../utils/prefs";
import { setTimeout, clearTimeout } from "../utils/timers";
import { guard } from "../utils/guard";
import { ensureAuthorships } from "./authorFetch";
import { appendAuthorMenuItems } from "../authors/authorMenu";
import {
  buildGraph,
  type GraphMode,
  type ZGraphData,
  type ZNode,
} from "./build";
import { GraphView } from "./view";
import { icon, iconButton } from "../ui/icons";

/**
 * Graph panel — a collapsible pane under the item list.
 *
 * Host: `#zotero-items-pane-container` is a plain `<vbox>` holding the item
 * toolbar, the advanced-search deck and `#zotero-items-pane`. Appending a
 * `<splitter>` + our own `<vbox>` after the items pane gives a resizable
 * bottom panel without touching Zotero's own layout code (verified on 9.0.6
 * and 10.0).
 *
 * The graph is built from the CURRENT VIEW (the rows the item tree shows), and
 * only on an explicit action — opening the pane, switching mode, or pressing
 * "Re-analyse". Rebuilding on every selection change would make browsing a big
 * collection lurch, which is exactly the complaint about the original.
 */

const MODES: GraphMode[] = ["related", "author", "tag", "collection"];
const MIN_HEIGHT = 160;
const MAX_HEIGHT = 900;

interface PaneState {
  win: Window;
  /** listener we attached to the item view, so it can be removed again */
  refreshListener?: (...args: any[]) => void;
  refreshTarget?: any;
  rebuildTimer?: number;
  splitter: XULElement;
  box: XULElement;
  canvas: HTMLElement;
  status: HTMLElement;
  view?: GraphView;
  modeButtons: Map<GraphMode, HTMLElement>;
  roleButtons: Map<string, HTMLElement>;
  rolesWrap: HTMLElement;
  minButtons: Map<number, HTMLElement>;
  minWrap: HTMLElement;
  building: boolean;
}

const panes = new Map<Window, PaneState>();

type XULElement = Element & { setAttribute(name: string, value: string): void };

const MIN_SHARED_STEPS = [2, 3, 5] as const;

function minShared(): number {
  const v = Number(getPref("graph.minShared")) || 2;
  return (MIN_SHARED_STEPS as readonly number[]).includes(v) ? v : 2;
}

function authorRoles(): "all" | "firstlast" {
  return String(getPref("graph.authorRoles") || "firstlast") === "all"
    ? "all"
    : "firstlast";
}

export function graphMode(): GraphMode {
  const v = String(getPref("graph.mode") || "related");
  return (MODES as string[]).includes(v) ? (v as GraphMode) : "related";
}

/**
 * The toolbar button lives in another module that imports this one, so the
 * sync goes through a registered callback rather than a circular import.
 */
let buttonSync: (() => void) | undefined;

export function onGraphVisibilityChange(fn: () => void) {
  buttonSync = fn;
}

function queueButtonSync() {
  const fn = buttonSync;
  if (!fn) return;
  // after the caller finished mutating `panes`
  setTimeout(() => {
    try {
      fn();
    } catch (e) {
      ztoolkit.log("[graph] button sync failed", e);
    }
  }, 0);
}

export function isGraphVisible(win: Window): boolean {
  return !!panes.get(win);
}

export function toggleGraphPane(win: Window) {
  if (panes.get(win)) hideGraphPane(win);
  else showGraphPane(win);
}

export function showGraphPane(win: Window) {
  if (panes.get(win)) return;
  // the toolbar button reads this state; keep it honest whichever route the
  // user took (button, Tools menu, shortcut, preference)
  queueButtonSync();
  const doc = win.document;
  const container = doc.getElementById("zotero-items-pane-container");
  const itemsPane = doc.getElementById("zotero-items-pane");
  if (!container || !itemsPane) {
    ztoolkit.log("[graph] host not found — pane unavailable");
    return;
  }

  const splitter = doc.createXULElement("splitter") as unknown as XULElement;
  splitter.id = `${config.addonRef}-graph-splitter`;
  splitter.setAttribute("orient", "vertical");
  splitter.setAttribute("resizebefore", "closest");
  splitter.setAttribute("resizeafter", "closest");
  splitter.classList.add("zest-graph-splitter");

  const box = doc.createXULElement("vbox") as unknown as XULElement;
  box.id = `${config.addonRef}-graph-pane`;
  box.classList.add("zest-graph-pane");
  const height = Math.min(
    MAX_HEIGHT,
    Math.max(MIN_HEIGHT, getNumPref("graph.height", 400)),
  );
  (box as unknown as HTMLElement).style.height = `${height}px`;

  // ---- header -------------------------------------------------------
  const header = doc.createElement("div");
  header.className = "zest-graph-header";
  const title = doc.createElement("span");
  title.className = "zest-graph-title";
  title.appendChild(icon(doc, "graph", 14));
  const titleText = doc.createElement("span");
  titleText.textContent = getString("graph-title");
  title.appendChild(titleText);
  header.appendChild(title);

  const modeButtons = new Map<GraphMode, HTMLElement>();
  const modeWrap = doc.createElement("div");
  modeWrap.className = "zest-graph-modes";
  for (const mode of MODES) {
    const b = doc.createElement("button");
    b.className = "zest-graph-mode";
    b.textContent = getString(`graph-mode-${mode}`);
    b.title = getString(`graph-mode-${mode}-tip`);
    b.addEventListener(
      "click",
      guard("graph mode", () => {
        setPref("graph.mode", mode);
        syncModeButtons(win);
        void rebuild(win);
      }),
    );
    modeWrap.appendChild(b);
    modeButtons.set(mode, b);
  }
  header.appendChild(modeWrap);

  // author mode: every author, or only first + last (the corresponding slot)
  const roleButtons = new Map<string, HTMLElement>();
  const rolesWrap = doc.createElement("div");
  rolesWrap.className = "zest-graph-modes zest-graph-roles";
  for (const role of ["firstlast", "all"] as const) {
    const b = doc.createElement("button");
    b.className = "zest-graph-mode";
    b.textContent = getString(`graph-roles-${role}`);
    b.title = getString(`graph-roles-${role}-tip`);
    b.addEventListener(
      "click",
      guard("graph roles", () => {
        setPref("graph.authorRoles", role);
        syncModeButtons(win);
        void rebuild(win);
      }),
    );
    rolesWrap.appendChild(b);
    roleButtons.set(role, b);
  }
  header.appendChild(rolesWrap);

  // bipartite modes: how many items must share an author/tag/collection
  const minButtons = new Map<number, HTMLElement>();
  const minWrap = doc.createElement("div");
  minWrap.className = "zest-graph-modes zest-graph-min";
  for (const n of MIN_SHARED_STEPS) {
    const b = doc.createElement("button");
    b.className = "zest-graph-mode";
    b.textContent = `≥${n}`;
    b.title = getString("graph-min-tip", { args: { count: n } });
    b.addEventListener(
      "click",
      guard("graph min shared", () => {
        setPref("graph.minShared", n);
        syncModeButtons(win);
        void rebuild(win);
      }),
    );
    minWrap.appendChild(b);
    minButtons.set(n, b);
  }
  header.appendChild(minWrap);

  const status = doc.createElement("span");
  status.className = "zest-graph-status";
  header.appendChild(status);

  const refresh = iconButton(
    doc,
    "refresh",
    getString("graph-reanalyse-tip"),
    "zest-graph-btn",
  );
  const refreshLabel = doc.createElement("span");
  refreshLabel.textContent = getString("graph-reanalyse");
  refresh.appendChild(refreshLabel);
  refresh.addEventListener(
    "click",
    guard("graph rebuild", () => void rebuild(win)),
  );
  header.appendChild(refresh);

  const close = iconButton(
    doc,
    "close",
    getString("graph-close"),
    "zest-graph-btn zest-graph-close",
  );
  close.addEventListener(
    "click",
    guard("graph close", () => hideGraphPane(win)),
  );
  header.appendChild(close);

  const canvas = doc.createElement("div");
  canvas.className = "zest-graph-canvas";

  box.appendChild(header as unknown as Node);
  box.appendChild(canvas as unknown as Node);
  container.appendChild(splitter as unknown as Node);
  container.appendChild(box as unknown as Node);

  const state: PaneState = {
    win,
    splitter,
    box,
    canvas,
    status,
    modeButtons,
    roleButtons,
    rolesWrap,
    minButtons,
    minWrap,
    building: false,
  };
  panes.set(win, state);
  syncModeButtons(win);
  watchScope(win);

  try {
    state.view = new GraphView(canvas, {
      onSelect: (node, x, y) => selectNode(win, node, x, y),
      onOpen: (node) => openNode(win, node),
      onContext: (node, x, y) => showNodeMenu(win, node, x, y),
    });
  } catch (e) {
    ztoolkit.log("[graph] view init failed", e);
  }

  // remember the height the user drags to
  const onMouseUp = guard("graph resize", () => {
    const h = (box as unknown as HTMLElement).getBoundingClientRect().height;
    if (h >= MIN_HEIGHT && h <= MAX_HEIGHT)
      setPref("graph.height", Math.round(h));
    state.view?.resize();
  });
  (splitter as unknown as HTMLElement).addEventListener("mouseup", onMouseUp);

  setPref("graph.visible", true);
  void rebuild(win);
}

/**
 * @param persist false while tearing down (plugin shutdown, window close) —
 * otherwise closing Zotero would remember the pane as "closed by the user"
 * and it would not come back next launch.
 */
export function hideGraphPane(win: Window, persist = true) {
  queueButtonSync();
  const state = panes.get(win);
  if (!state) return;
  panes.delete(win);
  if (state.rebuildTimer) clearTimeout(state.rebuildTimer);
  try {
    if (state.refreshListener && state.refreshTarget?.removeListener) {
      state.refreshTarget.removeListener(state.refreshListener);
    }
  } catch {
    // view already gone
  }
  try {
    state.view?.destroy();
  } catch {
    // already gone
  }
  try {
    (state.box as unknown as HTMLElement).remove();
    (state.splitter as unknown as HTMLElement).remove();
    // the node context menu lives in the window's popupset
    win.document.getElementById(`${config.addonRef}-graph-menu`)?.remove();
  } catch {
    // window closing
  }
  if (persist) setPref("graph.visible", false);
}

export function uninstallGraphPanes() {
  for (const win of [...panes.keys()]) hideGraphPane(win, false);
}

/** called on main-window load: restore the pane when it was open last time */
export function restoreGraphPane(win: Window) {
  if (getPref("graph.visible")) showGraphPane(win);
}

function syncModeButtons(win: Window) {
  const state = panes.get(win);
  if (!state) return;
  const active = graphMode();
  for (const [mode, btn] of state.modeButtons) {
    btn.classList.toggle("active", mode === active);
  }
  state.rolesWrap.style.display = active === "author" ? "" : "none";
  const roles = authorRoles();
  for (const [role, btn] of state.roleButtons) {
    btn.classList.toggle("active", role === roles);
  }
  state.minWrap.style.display = active === "related" ? "none" : "";
  const min = minShared();
  for (const [n, btn] of state.minButtons) {
    btn.classList.toggle("active", n === min);
  }
}

/**
 * Rebuild when the item list changes scope. The graph is about the rows you
 * are looking at, so leaving it on a previous collection's data (or on "0
 * nodes" because it was opened while the view was empty) is just confusing —
 * but it is debounced, because a collection switch fires several refreshes.
 */
function watchScope(win: Window) {
  const state = panes.get(win);
  if (!state) return;
  try {
    const target = (win as any).ZoteroPane?.itemsView?.onRefresh;
    if (!target?.addListener) return;
    const listener = guard("graph scope", () => {
      const current = panes.get(win);
      if (!current) return;
      if (current.rebuildTimer) clearTimeout(current.rebuildTimer);
      current.rebuildTimer = setTimeout(() => {
        current.rebuildTimer = undefined;
        void rebuild(win);
      }, 600);
    });
    target.addListener(listener);
    state.refreshListener = listener;
    state.refreshTarget = target;
  } catch (e) {
    ztoolkit.log("[graph] scope listener unavailable", e);
  }
}

async function rebuild(win: Window) {
  const state = panes.get(win);
  if (!state || state.building) return;
  state.building = true;
  state.status.textContent = getString("graph-building");
  try {
    const items = scopeItems(win);
    const centerItemID = selectedItemID(win);
    const maxNodes = Math.max(
      30,
      Math.min(1200, getNumPref("graph.maxNodes", 250)),
    );
    const mode = graphMode();
    const data = await buildGraph(items, mode, {
      maxNodes,
      centerItemID,
      authorRoles: authorRoles(),
      minShared: minShared(),
    });
    if (!panes.get(win)) return; // pane closed while building
    state.view?.setData(data);
    state.status.textContent = statusText(data);
    if (mode === "author") {
      // top up the OpenAlex authorship cache in the background; rebuild
      // only when something new actually arrived (then everything is
      // cached or backed off, so the second pass fetches nothing)
      void ensureAuthorships(items).then((changed) => {
        if (changed && panes.get(win)) void rebuild(win);
      });
    }
  } catch (e) {
    ztoolkit.log("[graph] build failed", e);
    state.status.textContent = getString("graph-failed");
  } finally {
    state.building = false;
  }
}

function statusText(data: ZGraphData): string {
  const items = data.nodes.filter(
    (n) => n.kind === "item" || n.kind === "center",
  ).length;
  const base = getString(
    data.truncated ? "graph-status-truncated" : "graph-status",
    {
      args: { items, nodes: data.nodes.length, edges: data.edges.length },
    },
  );
  return data.isolated
    ? `${base} · ${getString("graph-status-isolated", { args: { count: data.isolated } })}`
    : base;
}

/** the rows the item tree currently shows (regular items only) */
function scopeItems(win: Window): Zotero.Item[] {
  const out: Zotero.Item[] = [];
  try {
    const zp = (win as any).ZoteroPane;
    const rows: Zotero.Item[] = zp?.itemsView?.getSortedItems?.() ?? [];
    for (const it of rows) {
      if (it instanceof Zotero.Item && it.isRegularItem()) out.push(it);
    }
  } catch (e) {
    ztoolkit.log("[graph] scope failed", e);
  }
  return out;
}

function selectedItemID(win: Window): number | undefined {
  try {
    const sel = (win as any).ZoteroPane?.getSelectedItems?.() ?? [];
    const first = sel.find(
      (i: any) => i instanceof Zotero.Item && i.isRegularItem(),
    );
    return first?.id;
  } catch {
    return undefined;
  }
}

function selectNode(win: Window, node: ZNode, sx?: number, sy?: number) {
  if (!node.itemID) {
    // an author has no item to select — clicking it opens its menu
    if (node.kind === "author" && node.author && sx !== undefined) {
      showNodeMenu(win, node, sx, sy ?? 0);
    }
    return;
  }
  try {
    void (win as any).ZoteroPane?.selectItem(node.itemID);
  } catch (e) {
    ztoolkit.log("[graph] select failed", e);
  }
}

function openNode(win: Window, node: ZNode) {
  if (!node.itemID) return;
  try {
    const item = Zotero.Items.get(node.itemID) as Zotero.Item;
    const zp = (win as any).ZoteroPane;
    void zp?.selectItem(node.itemID);
    void zp?.viewItems?.([item]);
  } catch (e) {
    ztoolkit.log("[graph] open failed", e);
  }
}

function showNodeMenu(win: Window, node: ZNode, x: number, y: number) {
  const doc = win.document;
  const id = `${config.addonRef}-graph-menu`;
  let popup = doc.getElementById(id) as any;
  if (!popup) {
    popup = doc.createXULElement("menupopup");
    popup.id = id;
    // Zotero 10's main window has no #mainPopupSet — the old target left the
    // popup unattached and the whole node menu silently dead. Use the same
    // Zest popupset the status picker relies on, creating it on demand.
    let set = doc.getElementById("zest-popupset");
    if (!set) {
      set = doc.createXULElement("popupset");
      set.id = "zest-popupset";
      doc.documentElement?.appendChild(set);
    }
    set.appendChild(popup);
  }
  while (popup.firstChild) popup.firstChild.remove();
  const add = (label: string, fn: () => void) => {
    const mi = doc.createXULElement("menuitem");
    mi.setAttribute("label", label);
    mi.addEventListener("command", guard("graph menu", fn));
    popup.appendChild(mi);
  };
  if (node.itemID) {
    add(getString("graph-menu-show"), () => selectNode(win, node));
    add(getString("graph-menu-open"), () => openNode(win, node));
    add(getString("graph-menu-center"), () => {
      selectNode(win, node);
      void rebuild(win);
    });
  } else if (node.kind === "author" && node.author) {
    appendAuthorMenuItems(win, popup, { ...node.author, label: node.label });
  } else {
    add(node.label, () => undefined);
  }
  try {
    popup.openPopupAtScreen(x, y, true);
  } catch (e) {
    ztoolkit.log("[graph] menu failed", e);
  }
}

/** re-run the build for every open pane (e.g. after a mode pref change) */
export function refreshGraphPanes() {
  for (const win of panes.keys()) {
    syncModeButtons(win);
    void rebuild(win);
  }
}

/** the height preference changed (Settings, or the splitter wrote it back):
 *  resize the open panes in place — a rebuild would re-run the layout */
export function applyGraphHeight() {
  const height = Math.min(
    MAX_HEIGHT,
    Math.max(MIN_HEIGHT, getNumPref("graph.height", 400)),
  );
  for (const state of panes.values()) {
    try {
      const box = state.box as unknown as HTMLElement | undefined;
      if (!box) continue;
      if (Math.round(box.getBoundingClientRect().height) !== height) {
        box.style.height = `${height}px`;
      }
      state.view?.resize();
    } catch {
      // window closing
    }
  }
}
