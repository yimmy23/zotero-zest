import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { getPref, setPref, getNumPref } from "../utils/prefs";
import { guard } from "../utils/guard";
import {
  buildGraph,
  type GraphMode,
  type ZGraphData,
  type ZNode,
} from "./build";
import { GraphView } from "./view";

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
  splitter: XULElement;
  box: XULElement;
  canvas: HTMLElement;
  status: HTMLElement;
  view?: GraphView;
  modeButtons: Map<GraphMode, HTMLElement>;
  building: boolean;
}

const panes = new Map<Window, PaneState>();

type XULElement = Element & { setAttribute(name: string, value: string): void };

export function graphMode(): GraphMode {
  const v = String(getPref("graph.mode") || "related");
  return (MODES as string[]).includes(v) ? (v as GraphMode) : "related";
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
  title.textContent = getString("graph-title");
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

  const status = doc.createElement("span");
  status.className = "zest-graph-status";
  header.appendChild(status);

  const refresh = doc.createElement("button");
  refresh.className = "zest-graph-btn";
  refresh.textContent = getString("graph-reanalyse");
  refresh.title = getString("graph-reanalyse-tip");
  refresh.addEventListener(
    "click",
    guard("graph rebuild", () => void rebuild(win)),
  );
  header.appendChild(refresh);

  const close = doc.createElement("button");
  close.className = "zest-graph-btn zest-graph-close";
  close.textContent = "✕";
  close.title = getString("graph-close");
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
    building: false,
  };
  panes.set(win, state);
  syncModeButtons(win);

  try {
    state.view = new GraphView(canvas, {
      onSelect: (node) => selectNode(win, node),
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
  const state = panes.get(win);
  if (!state) return;
  panes.delete(win);
  try {
    state.view?.destroy();
  } catch {
    // already gone
  }
  try {
    (state.box as unknown as HTMLElement).remove();
    (state.splitter as unknown as HTMLElement).remove();
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
    const data = await buildGraph(items, graphMode(), {
      maxNodes,
      centerItemID,
    });
    if (!panes.get(win)) return; // pane closed while building
    state.view?.setData(data);
    state.status.textContent = statusText(data);
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
  return getString(data.truncated ? "graph-status-truncated" : "graph-status", {
    args: { items, nodes: data.nodes.length, edges: data.edges.length },
  });
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

function selectNode(win: Window, node: ZNode) {
  if (!node.itemID) return;
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
    doc.getElementById("mainPopupSet")?.appendChild(popup);
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
