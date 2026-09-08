import { getString } from "../utils/locale";
import { getNumPref } from "../utils/prefs";
import { guard } from "../utils/guard";
import { bestAttachment, openAttachmentAt } from "../utils/items";
import { iconButton } from "../ui/icons";
import {
  buildGraph,
  type GraphMode,
  type ZGraphData,
  type ZNode,
} from "../graph/build";
import { GraphView } from "../graph/view";

/** A container-owned local graph. No bottom-pane state or network subscriptions. */
export function mountSidebarGraph(
  body: HTMLElement,
  source: () => { items: Zotero.Item[]; itemID?: number; host: Window },
) {
  const doc = body.ownerDocument;
  if (!doc) throw new Error("Graph container has no document");
  let active = true,
    disposed = false,
    dirty = true,
    generation = 0;
  let mode: GraphMode = "related";
  let data: ZGraphData | undefined;
  let view: GraphView | undefined;
  let selected: ZNode | undefined;
  const root = doc.createElement("div");
  root.className = "zest-sidebar-graph";
  const style = doc.createElement("style");
  style.textContent = `
    .zest-sidebar-graph { color:var(--fill-primary); font-size:var(--zotero-font-size); min-width:0; }
    .zest-sidebar-graph-bar { display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin-bottom:8px; }
    .zest-sidebar-graph button,.zest-sidebar-graph select { appearance:none; color:inherit; font:inherit; border:1px solid var(--fill-quinary); border-radius:6px; background:var(--material-background); margin:0; min-width:0; max-width:100%; padding:5px 8px; }
    .zest-sidebar-graph select { appearance:auto; flex:1; }
    .zest-sidebar-graph button:hover { background:var(--fill-quinary); }
    .zest-sidebar-graph button:focus-visible,.zest-sidebar-graph select:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
    .zest-sidebar-graph-canvas { box-sizing:border-box; height:clamp(260px,44vh,420px); width:100%; min-width:0; border:1px solid var(--fill-quinary); border-radius:9px; overflow:hidden; background:var(--material-background); }
    .zest-sidebar-graph-status,.zest-sidebar-graph-detail { font-size:.92em; line-height:1.5; color:var(--fill-secondary); margin:8px 0; overflow-wrap:anywhere; }
    .zest-sidebar-graph-open { font-size:.92em !important; }
    .zest-sidebar-graph [hidden] { display:none !important; }
  `;
  const bar = doc.createElement("div");
  bar.className = "zest-sidebar-graph-bar";
  const modes = doc.createElement("select");
  modes.setAttribute("aria-label", getString("graph-filter-modes"));
  for (const value of ["related", "author", "tag", "collection"] as const) {
    const option = doc.createElement("option");
    option.value = value;
    option.textContent = getString(`graph-mode-${value}`);
    modes.append(option);
  }
  const refresh = iconButton(doc, "refresh", getString("graph-reanalyse"));
  const fit = iconButton(doc, "expand", getString("graph-fit"));
  refresh.type = fit.type = "button";
  bar.append(modes, refresh, fit);
  const canvas = doc.createElement("div");
  canvas.className = "zest-sidebar-graph-canvas";
  canvas.setAttribute("aria-label", getString("graph-title"));
  const status = doc.createElement("p");
  status.className = "zest-sidebar-graph-status";
  status.setAttribute("role", "status");
  const detail = doc.createElement("p");
  detail.className = "zest-sidebar-graph-detail";
  detail.textContent = getString("sidebar-graph-select");
  const open = doc.createElement("button");
  open.type = "button";
  open.className = "zest-sidebar-graph-open";
  open.textContent = getString("sidebar-graph-open");
  open.hidden = true;
  root.append(style, bar, canvas, status, detail, open);
  body.append(root);

  function openNode(node?: ZNode) {
    if (!active || disposed || !node?.itemID) return;
    const item = Zotero.Items.get(node.itemID) as Zotero.Item | false;
    if (!item) return;
    const attachment = bestAttachment(item);
    if (attachment)
      void openAttachmentAt(attachment, {}).catch((e) =>
        ztoolkit.log("[sidebar graph] open failed", e),
      );
    else void (source().host as any).ZoteroPane?.selectItem?.(item.id);
  }
  function showData() {
    if (!active || disposed || !data) return;
    if (!view) {
      const revision = generation;
      const current = () =>
        active && !disposed && view === instance && generation === revision;
      const instance = new GraphView(canvas, {
        onSelect: (node) => {
          if (!current()) return;
          selected = node;
          detail.textContent = node.title || node.label;
          open.hidden = !node.itemID;
        },
        onOpen: (node) => {
          if (current()) openNode(node);
        },
      });
      view = instance;
    }
    view.setData(data);
  }
  async function rebuild() {
    dirty = true;
    if (!active || disposed) return;
    const current = ++generation;
    dirty = false;
    view?.destroy();
    view = undefined;
    data = undefined;
    refresh.disabled = true;
    canvas.setAttribute("aria-busy", "true");
    status.textContent = getString("graph-building");
    selected = undefined;
    open.hidden = true;
    detail.textContent = getString("sidebar-graph-select");
    try {
      const scope = source();
      const result = await buildGraph(scope.items, mode, {
        maxNodes: Math.max(
          30,
          Math.min(120, getNumPref("graph.maxNodes", 250)),
        ),
        centerItemID: scope.itemID,
        authorRoles: "firstlast",
        minShared: 2,
      });
      if (disposed || !active || current !== generation) return;
      data = result;
      showData();
      status.textContent = data.nodes.length
        ? getString(
            data.truncated ? "graph-status-truncated" : "graph-status",
            {
              args: {
                items: data.nodes.filter((n) => n.itemID).length,
                nodes: data.nodes.length,
                edges: data.edges.length,
              },
            },
          )
        : getString("graph-empty");
    } catch (e) {
      ztoolkit.log("[sidebar graph] build failed", e);
      if (!disposed && active && current === generation)
        status.textContent = getString("graph-failed");
    } finally {
      if (!disposed && current === generation) {
        refresh.disabled = false;
        canvas.setAttribute("aria-busy", "false");
      }
    }
  }
  modes.addEventListener(
    "change",
    guard("sidebar graph mode", () => {
      if (!active || disposed) return;
      mode = modes.value as GraphMode;
      void rebuild();
    }),
  );
  refresh.addEventListener(
    "click",
    guard("sidebar graph refresh", () => void rebuild()),
  );
  fit.addEventListener(
    "click",
    guard("sidebar graph fit", () => {
      if (active && !disposed) view?.fitView();
    }),
  );
  open.addEventListener(
    "click",
    guard("sidebar graph open", () => openNode(selected)),
  );
  void rebuild();
  return {
    refresh: () => {
      void rebuild();
    },
    setActive(value: boolean) {
      if (disposed || active === value) return;
      active = value;
      if (!active) {
        if (canvas.getAttribute("aria-busy") === "true") dirty = true;
        generation++;
        view?.destroy();
        view = undefined;
      } else if (dirty) void rebuild();
      else showData();
    },
    dispose() {
      disposed = true;
      generation++;
      view?.destroy();
      view = undefined;
      data = undefined;
      root.remove();
    },
  };
}
