import { config } from "../../package.json";
import { getString, getLocaleID } from "../utils/locale";
import { guard } from "../utils/guard";
import { getPref } from "../utils/prefs";
import { mountMatrix, openMatrix, type MatrixSource } from "./annotMatrix";
import { mountStats, openStatsDialog } from "./statsDialog";
import { showGraphPane } from "../graph/pane";
import { mountSidebarGraph } from "./sidebarGraph";
import { bindSidebarTheme } from "../ui/dialogTheme";

type Kind = "stats" | "matrix" | "graph";
interface Controller {
  refresh(): void;
  setActive(active: boolean): void;
  dispose(): void;
}
interface Props {
  body: HTMLElement;
  doc?: Document;
  item?: Zotero.Item;
  tabType?: string;
  setEnabled?: (enabled: boolean) => void;
  setSectionSummary?: (summary: string) => void;
  setSectionButtonStatus?: (
    type: string,
    status: { disabled?: boolean },
  ) => void;
}
interface State {
  kind: Kind;
  body: HTMLElement;
  win: Window;
  item?: Zotero.Item;
  tabType?: string;
  enabled: boolean;
  requested: boolean;
  active: boolean;
  visible: boolean;
  disposed: boolean;
  failed: boolean;
  shell?: HTMLElement;
  content?: HTMLElement;
  note?: HTMLElement;
  status?: HTMLElement;
  frame?: HTMLIFrameElement;
  controller?: Controller;
  theme?: ReturnType<typeof bindSidebarTheme>;
  observer?: IntersectionObserver;
  load?: () => void;
  error?: () => void;
  frameError?: boolean;
  timeout?: number;
  frameWindow?: Window;
  frameUnload?: () => void;
  visibility: () => void;
  unload: () => void;
}
const HOST_URL = `chrome://${config.addonRef}/content/panel.xhtml`;
const FRAME_LOAD_TIMEOUT = 10_000;
const ids = new Map<Kind, string>();
const states = new Map<HTMLElement, State>();
const icons: Record<Kind, string> = {
  stats: "reading-stats",
  matrix: "matrix",
  graph: "local-graph",
};

/** Explicit context source: a reader must never borrow the hidden library selection. */
export function sidebarMatrixSource(
  item: Zotero.Item | undefined,
  tabType: string | undefined,
  win: Window,
): MatrixSource {
  const allowViewScope =
    tabType !== "reader" &&
    typeof (win as any).ZoteroPane?.itemsView?.getSortedItems === "function";
  return {
    allowViewScope,
    selectedLabel: "matrix-scope-current",
    getItems: (scope) => {
      if (scope === "view" && allowViewScope) {
        const rows = (win as any).ZoteroPane.itemsView.getSortedItems();
        if (!Array.isArray(rows)) throw new Error("Library view unavailable");
        return rows;
      }
      return item ? [item] : [];
    },
  };
}

function supports(item?: Zotero.Item) {
  return (
    !!item && !item.deleted && (item.isRegularItem?.() || item.isAttachment?.())
  );
}
function open(state: State) {
  if (state.disposed || !state.enabled) return;
  if (state.kind === "stats") openStatsDialog(state.win);
  else if (state.kind === "matrix")
    openMatrix(
      state.win,
      sidebarMatrixSource(state.item, state.tabType, state.win),
    );
  else if ((state.win as any).ZoteroPane) showGraphPane(state.win);
}
function dispose(state: State) {
  if (state.disposed) return;
  state.disposed = true;
  state.observer?.disconnect();
  state.win.document.removeEventListener("visibilitychange", state.visibility);
  state.win.removeEventListener("unload", state.unload);
  clearContent(state);
  state.shell?.remove();
  states.delete(state.body);
}
function getState(props: Props, kind: Kind) {
  let state = states.get(props.body);
  if (state) return state;
  const win = props.body.ownerDocument?.defaultView as Window | null;
  if (!win) throw new Error("Sidebar container has no window");
  state = {
    kind,
    body: props.body,
    win,
    enabled: false,
    // A rapid preference off/on can be coalesced by Zotero's async registry
    // notifications, leaving a native body whose render cache is still warm.
    requested:
      props.body.getAttribute("data-zest-sidebar-requested") === "true",
    active: false,
    visible: false,
    disposed: false,
    failed: false,
    visibility: () => sync(state!),
    unload: () => dispose(state!),
  };
  states.set(props.body, state);
  const IO = (win as any).IntersectionObserver;
  if (IO) {
    state.observer = new IO((entries: IntersectionObserverEntry[]) => {
      if (state!.disposed) return;
      state!.visible = entries.some((entry) => entry.isIntersecting);
      sync(state!);
    });
    state.observer!.observe(props.body);
  }
  win.document.addEventListener("visibilitychange", state.visibility);
  win.addEventListener("unload", state.unload, { once: true });
  return state;
}
function isOpen(state: State) {
  const section = state.body.closest("collapsible-section") as
    (HTMLElement & { open: boolean }) | null;
  return section?.open !== false;
}
function sync(state: State) {
  if (state.disposed) return;
  const active =
    state.enabled &&
    state.visible &&
    isOpen(state) &&
    !state.win.document.hidden;
  state.active = active;
  state.theme?.setActive(active);
  state.controller?.setActive(active);
  // Native async-render callbacks can be consumed before a section reaches the
  // viewport. Our own observer must be able to initialize it independently.
  if (active && !state.requested) {
    state.requested = true;
    state.body.dataset.zestSidebarRequested = "true";
  }
  if (!active) stopDeadline(state);
  if (active && !state.controller) ensureContent(state);
}
function renderShell(state: State) {
  if (state.shell) return;
  const doc = state.win.document;
  const shell = doc.createElement("div");
  shell.className = "zest-sidebar-shell";
  shell.dataset.kind = state.kind;
  shell.dataset.loadState = "loading";
  const style = doc.createElement("style");
  style.textContent = `
    .zest-sidebar-shell { position:relative; min-width:0; color:var(--fill-primary); }
    .zest-sidebar-scope { font-size:.92em; color:var(--fill-secondary); line-height:1.5; margin:0 0 8px; overflow-wrap:anywhere; }
    .zest-sidebar-content { min-width:0; }
    .zest-sidebar-shell[data-kind=stats] .zest-sidebar-content { height:190px; }
    .zest-sidebar-shell[data-kind=matrix] .zest-sidebar-content { height:clamp(360px,72vh,700px); }
    .zest-sidebar-shell[data-kind=graph] .zest-sidebar-content { min-height:calc(clamp(260px,44vh,420px) + 104px); }
    .zest-sidebar-frame { display:block; width:100%; height:100%; border:0; border-radius:8px; background:transparent; }
    .zest-sidebar-message { position:absolute; margin:0; padding:8px; color:var(--fill-secondary); font-size:.92em; pointer-events:none; }
    .zest-sidebar-message[hidden],.zest-sidebar-scope[hidden] { display:none; }
    .zest-sidebar-retry { appearance:none; font:inherit; color:var(--fill-primary); background:var(--fill-quinary); padding:5px 10px; margin-top:38px; border:0; border-radius:6px; }
  `;
  const note = doc.createElement("p");
  note.className = "zest-sidebar-scope";
  const status = doc.createElement("p");
  status.className = "zest-sidebar-message";
  status.textContent = getString("sidebar-loading");
  status.setAttribute("role", "status");
  const content = doc.createElement("div");
  content.className = "zest-sidebar-content";
  shell.append(style, note, status, content);
  state.body.append(shell);
  Object.assign(state, { shell, note, status, content });
  updateScope(state);
}
function updateScope(state: State) {
  if (!state.note) return;
  state.note.hidden = state.kind !== "graph";
  state.note.textContent = getString(
    state.kind === "stats"
      ? "sidebar-stats-scope"
      : state.tabType === "reader"
        ? "sidebar-graph-item"
        : "sidebar-graph-view",
  );
}
function graphSource(state: State) {
  const current = state.item?.isRegularItem?.() ? state.item : undefined;
  const rows = sidebarMatrixSource(current, state.tabType, state.win).getItems(
    "view",
  );
  const items = rows.filter((item) => item?.isRegularItem?.() && !item.deleted);
  if (state.tabType === "reader" && current) {
    for (const key of current.relatedItems || []) {
      const item = Zotero.Items.getByLibraryAndKey(current.libraryID, key);
      if (
        item &&
        item.isRegularItem() &&
        !item.deleted &&
        !items.some((row) => row.id === item.id)
      )
        items.push(item);
    }
  }
  if (current && !items.some((item) => item.id === current.id))
    items.push(current);
  return { items, itemID: current?.id, host: state.win };
}
function stopDeadline(state: State) {
  if (state.timeout === undefined) return;
  state.win.clearTimeout(state.timeout);
  state.timeout = undefined;
}
function stopLoading(state: State) {
  stopDeadline(state);
  if (state.load) state.frame?.removeEventListener("load", state.load, true);
  if (state.error) state.frame?.removeEventListener("error", state.error, true);
  state.load = undefined;
  state.error = undefined;
}
function clearContent(state: State) {
  stopLoading(state);
  if (state.frameUnload)
    state.frameWindow?.removeEventListener("unload", state.frameUnload);
  state.frameUnload = undefined;
  state.frameWindow = undefined;
  state.controller?.dispose();
  state.controller = undefined;
  state.theme?.dispose();
  state.theme = undefined;
  const frame = state.frame;
  state.frame = undefined;
  state.frameError = false;
  frame?.remove();
}
function failed(state: State, error: unknown) {
  if (state.disposed || state.failed || !state.content || !state.status) return;
  ztoolkit.log("[sidebar] content load failed", error);
  state.failed = true;
  clearContent(state);
  state.shell!.dataset.loadState = "failed";
  state.status.hidden = false;
  state.status.textContent = getString("sidebar-load-failed");
  state.content.replaceChildren();
  const button = state.win.document.createElement("button");
  button.type = "button";
  button.className = "zest-sidebar-retry";
  button.textContent = getString("sidebar-retry");
  button.addEventListener(
    "click",
    guard("sidebar retry", () => {
      if (
        state.disposed ||
        !state.failed ||
        button.parentElement !== state.content
      )
        return;
      button.remove();
      state.failed = false;
      state.shell!.dataset.loadState = "loading";
      state.status!.textContent = getString("sidebar-loading");
      sync(state);
    }),
  );
  state.content.append(button);
}
function ensureContent(state: State) {
  if (state.disposed || !state.active || state.controller || state.failed)
    return;
  renderShell(state);
  try {
    if (state.kind === "graph") {
      state.controller = mountSidebarGraph(state.content!, () =>
        graphSource(state),
      );
      state.status!.hidden = true;
      state.shell!.dataset.loadState = "ready";
      return;
    }
    if (state.frame) {
      state.load?.();
      startDeadline(state);
      return;
    }
    const frame = state.win.document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "iframe",
    ) as HTMLIFrameElement;
    frame.className = "zest-sidebar-frame";
    frame.title = getString(
      state.kind === "stats" ? "stats-title" : "matrix-title",
    );
    state.frame = frame;
    const ready = () => {
      if (
        state.disposed ||
        state.frame !== frame ||
        !state.active ||
        state.controller ||
        state.failed
      )
        return;
      try {
        if (state.frameError) throw new Error("Sidebar iframe failed to load");
        const win = frame.contentWindow;
        if (!win || win.document.readyState !== "complete") return;
        if (win.location.href === "about:blank") return;
        if (win.location.href !== HOST_URL)
          throw new Error("Sidebar iframe loaded an unexpected document");
        state.theme?.dispose();
        state.theme = bindSidebarTheme(win, state.body);
        if (state.kind === "stats")
          state.controller = mountStats(win, () => open(state));
        else
          state.controller = mountMatrix(win, state.win, {
            allowViewScope: sidebarMatrixSource(
              state.item,
              state.tabType,
              state.win,
            ).allowViewScope,
            selectedLabel: "matrix-scope-current",
            getItems: (scope) =>
              sidebarMatrixSource(
                state.item,
                state.tabType,
                state.win,
              ).getItems(scope),
          });
        stopLoading(state);
        const controller = state.controller;
        // The embedded controllers dispose themselves when their document
        // unloads. Do not retain that dead controller after an iframe reload.
        state.frameWindow = win;
        state.frameUnload = () => {
          if (state.frame === frame && state.controller === controller)
            failed(state, new Error("Sidebar iframe document unloaded"));
        };
        win.addEventListener("unload", state.frameUnload, { once: true });
        state.status!.hidden = true;
        state.shell!.dataset.loadState = "ready";
      } catch (e) {
        failed(state, e);
      }
    };
    state.load = ready;
    state.error = () => {
      if (state.disposed || state.frame !== frame || state.controller) return;
      state.frameError = true;
      // Hidden sections stay idle; surface the pending error when reopened.
      if (state.active)
        failed(state, new Error("Sidebar iframe failed to load"));
    };
    // Privileged chrome documents deliver their load through capture here.
    frame.addEventListener("load", ready, true);
    frame.addEventListener("error", state.error, true);
    frame.src = HOST_URL;
    state.content!.append(frame);
    ready();
    startDeadline(state);
  } catch (e) {
    failed(state, e);
  }
}
function startDeadline(state: State) {
  if (
    state.disposed ||
    !state.active ||
    state.controller ||
    state.failed ||
    !state.frame ||
    state.timeout !== undefined
  )
    return;
  const frame = state.frame;
  const timer = state.win.setTimeout(() => {
    if (state.timeout !== timer || state.frame !== frame || state.disposed)
      return;
    state.timeout = undefined;
    if (!state.active || !isOpen(state) || state.win.document.hidden) return;
    // The host document may already be complete even if its load event was lost.
    state.load?.();
    if (state.frame === frame && !state.controller && !state.failed)
      failed(state, new Error("Sidebar iframe load timed out"));
  }, FRAME_LOAD_TIMEOUT);
  state.timeout = timer;
}

export function registerSidebarSections() {
  const manager = (Zotero as any).ItemPaneManager;
  if (typeof manager?.registerSection !== "function") return;
  for (const kind of ["stats", "matrix", "graph"] as const) {
    if (getPref(`sidebar.${kind}`) === false) {
      for (const state of states.values())
        if (state.kind === kind) dispose(state);
      const id = ids.get(kind);
      if (id) {
        manager.unregisterSection?.(id);
        ids.delete(kind);
      }
      continue;
    }
    if (ids.has(kind)) continue;
    const result = manager.registerSection({
      paneID: `workspace-${kind}`,
      pluginID: config.addonID,
      header: {
        l10nID: getLocaleID(`sidebar-${kind}-header`),
        l10nArgs: "{}",
        icon: `chrome://${config.addonRef}/content/icons/${icons[kind]}.svg`,
      },
      sidenav: {
        l10nID: getLocaleID(`sidebar-${kind}-sidenav`),
        l10nArgs: "{}",
        icon: `chrome://${config.addonRef}/content/icons/20/${icons[kind]}.svg`,
      },
      sectionButtons: [
        {
          type: "zest-popout",
          icon: `chrome://${config.addonRef}/content/icons/open-window.svg`,
          l10nID: getLocaleID(
            kind === "graph" ? "sidebar-open-graph" : "sidebar-open-window",
          ),
          onClick: guard("sidebar popout", (props: Props) =>
            open(getState(props, kind)),
          ),
        },
      ],
      onInit: guard("sidebar init", (props: Props) => {
        getState(props, kind);
      }),
      onItemChange: guard("sidebar item", (props: Props) => {
        const state = getState(props, kind);
        const changed =
          state.item !== props.item || state.tabType !== props.tabType;
        const contextChanged = state.tabType !== props.tabType;
        state.item = props.item;
        state.tabType = props.tabType;
        state.enabled =
          getPref(`sidebar.${kind}`) !== false && supports(props.item);
        props.setEnabled?.(state.enabled);
        // A retained native body can skip onRender after a fast off/on. Restore
        // its cheap shell first: an empty, zero-height body cannot intersect.
        if (state.enabled) renderShell(state);
        props.setSectionButtonStatus?.("zest-popout", {
          disabled: kind === "graph" && !(state.win as any).ZoteroPane,
        });
        // Cancel a previous item's scan before exposing this item's context.
        if (contextChanged && kind === "matrix" && state.controller) {
          clearContent(state);
          state.shell!.dataset.loadState = "loading";
          state.status!.hidden = false;
          state.status!.textContent = getString("sidebar-loading");
        } else if (changed && kind !== "stats" && state.controller) {
          state.controller.setActive(false);
          state.controller.refresh();
        }
        updateScope(state);
        sync(state);
        return true;
      }),
      onRender: guard("sidebar shell", (props: Props) =>
        renderShell(getState(props, kind)),
      ),
      onAsyncRender: guard("sidebar visible", (props: Props) => {
        const state = getState(props, kind);
        state.requested = true;
        state.body.dataset.zestSidebarRequested = "true";
        // A never-visible retained body may have lost its cached shell. Give
        // it layout before measuring; expensive content still waits for sync.
        renderShell(state);
        const r = state.body.getBoundingClientRect();
        state.visible = r.width > 0 && r.height > 0;
        sync(state);
      }),
      onToggle: guard("sidebar toggle", (props: Props) =>
        sync(getState(props, kind)),
      ),
      onDestroy: guard("sidebar destroy", (props: Props) => {
        const state = states.get(props.body);
        if (state) dispose(state);
      }),
    });
    if (typeof result === "string") ids.set(kind, result);
    else ztoolkit.log(`[sidebar] ${kind} registration rejected`);
  }
}
export function closeSidebarSectionsForWindow(win: Window) {
  for (const state of states.values()) if (state.win === win) dispose(state);
}
export function unregisterSidebarSections() {
  for (const state of states.values()) dispose(state);
  for (const id of ids.values()) {
    try {
      (Zotero as any).ItemPaneManager?.unregisterSection?.(id);
    } catch (e) {
      ztoolkit.log("[sidebar] unregister failed", e);
    }
  }
  ids.clear();
}
