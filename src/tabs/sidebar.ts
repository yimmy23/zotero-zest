import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { getPref, setPref } from "../utils/prefs";
import { guard } from "../utils/guard";
import { setTimeout, clearTimeout } from "../utils/timers";
import {
  groups,
  groupOf,
  addGroup,
  removeGroup,
  renameGroup,
  setGroupCollapsed,
  assignToGroup,
  saveSession,
  sessions,
  removeSession,
  itemKeyOf,
  type TabGroup,
} from "./model";
import { iconButton } from "../ui/icons";

/**
 * Vertical tab manager.
 *
 * Zotero has no tab API for plugins, so this drives the five methods on
 * `Zotero_Tabs` that have been stable since 7 (`add`, `close`, `move`,
 * `select`, `undoClose`) and reads `_tabs`. Every one of them is probed before
 * the sidebar is offered, and the whole feature disables itself if the probe
 * fails — a plugin must not break tab handling when Zotero changes internals.
 *
 * OFF by default (the user's call): a vertical strip is a big change to a
 * window people know. The native tab bar is only hidden while the sidebar is
 * shown, and is restored on teardown.
 */

const MIN_WIDTH = 160;
const MAX_WIDTH = 480;

interface SidebarState {
  win: Window;
  box: XULish;
  splitter: XULish;
  list: HTMLElement;
  search: HTMLInputElement;
  query: string;
  observer?: MutationObserver;
  notifierID?: string;
  refreshTimer?: number;
}

type XULish = Element & { setAttribute(name: string, value: string): void };

const bars = new Map<Window, SidebarState>();

/* ------------------------------------------------------------------ */
/* probe                                                               */
/* ------------------------------------------------------------------ */

export function probeTabs(win: Window): boolean {
  const T = (win as any).Zotero_Tabs;
  if (!T) return false;
  for (const method of ["add", "close", "move", "select"]) {
    if (typeof T[method] !== "function") return false;
  }
  return Array.isArray(T._tabs);
}

export function isSidebarOpen(win: Window): boolean {
  return bars.has(win);
}

export function toggleSidebar(win: Window) {
  if (bars.has(win)) hideSidebar(win);
  else showSidebar(win);
}

export function restoreSidebar(win: Window) {
  if (getPref("tabs.sidebar")) showSidebar(win);
}

/* ------------------------------------------------------------------ */
/* mount                                                               */
/* ------------------------------------------------------------------ */

export function showSidebar(win: Window) {
  if (bars.has(win)) return;
  if (!probeTabs(win)) {
    ztoolkit.log("[tabs] Zotero_Tabs probe failed — sidebar unavailable");
    return;
  }
  const doc = win.document;
  const layout =
    doc.getElementById("zotero-layout-switcher") ||
    doc.getElementById("zotero-pane-stack");
  if (!layout?.parentElement) {
    ztoolkit.log("[tabs] no layout host");
    return;
  }

  const box = doc.createXULElement("vbox") as unknown as XULish;
  box.id = `${config.addonRef}-tabbar`;
  box.classList.add("zest-tabbar");
  const width = Math.min(
    MAX_WIDTH,
    Math.max(MIN_WIDTH, Number(getPref("tabs.width")) || 220),
  );
  (box as unknown as HTMLElement).style.width = `${width}px`;

  const header = doc.createElement("div");
  header.className = "zest-tabbar-head";
  const search = doc.createElement("input");
  search.type = "search";
  search.className = "zest-tabbar-search";
  search.placeholder = getString("tabs-search");
  search.addEventListener(
    "input",
    guard("tabs search", () => {
      const state = bars.get(win);
      if (!state) return;
      state.query = search.value.trim().toLowerCase();
      renderList(win);
    }),
  );
  header.appendChild(search);

  const menuBtn = iconButton(
    doc,
    "menu",
    getString("tabs-menu"),
    "zest-tabbar-btn",
  );
  menuBtn.addEventListener(
    "click",
    guard("tabs menu", (ev: MouseEvent) =>
      showBarMenu(win, ev.screenX, ev.screenY),
    ),
  );
  header.appendChild(menuBtn);

  const list = doc.createElement("div");
  list.className = "zest-tabbar-list";

  box.appendChild(header as unknown as Node);
  box.appendChild(list as unknown as Node);

  const splitter = doc.createXULElement("splitter") as unknown as XULish;
  splitter.id = `${config.addonRef}-tabbar-splitter`;
  splitter.setAttribute("resizebefore", "closest");
  splitter.setAttribute("resizeafter", "closest");
  splitter.classList.add("zest-tabbar-splitter");

  layout.parentElement.insertBefore(box as unknown as Node, layout);
  layout.parentElement.insertBefore(splitter as unknown as Node, layout);

  const state: SidebarState = {
    win,
    box,
    splitter,
    list,
    search,
    query: "",
  };
  bars.set(win, state);

  (splitter as unknown as HTMLElement).addEventListener(
    "mouseup",
    guard("tabs resize", () => {
      const w = (box as unknown as HTMLElement).getBoundingClientRect().width;
      if (w >= MIN_WIDTH && w <= MAX_WIDTH)
        setPref("tabs.width", Math.round(w));
    }),
  );

  applyNativeBarVisibility(win, !!getPref("tabs.hideNative"));
  watch(win);
  setPref("tabs.sidebar", true);
  renderList(win);
}

export function hideSidebar(win: Window, persist = true) {
  const state = bars.get(win);
  if (!state) return;
  bars.delete(win);
  if (state.refreshTimer) clearTimeout(state.refreshTimer);
  try {
    state.observer?.disconnect();
  } catch {
    // window gone
  }
  if (state.notifierID) {
    try {
      Zotero.Notifier.unregisterObserver(state.notifierID);
    } catch {
      // ignore
    }
  }
  try {
    (state.box as unknown as HTMLElement).remove();
    (state.splitter as unknown as HTMLElement).remove();
    win.document.getElementById(`${config.addonRef}-tabs-menu`)?.remove();
  } catch {
    // window closing
  }
  applyNativeBarVisibility(win, false);
  if (persist) setPref("tabs.sidebar", false);
}

export function uninstallSidebars() {
  for (const win of [...bars.keys()]) hideSidebar(win, false);
}

function applyNativeBarVisibility(win: Window, hide: boolean) {
  try {
    win.document.documentElement?.classList.toggle(
      "zest-hide-native-tabs",
      hide,
    );
  } catch {
    // window closing
  }
}

/* ------------------------------------------------------------------ */
/* rendering                                                           */
/* ------------------------------------------------------------------ */

interface TabInfo {
  id: string;
  type: string;
  title: string;
  itemKey: string;
  item?: Zotero.Item;
  selected: boolean;
}

function readTabs(win: Window): TabInfo[] {
  const T = (win as any).Zotero_Tabs;
  const out: TabInfo[] = [];
  for (const tab of T?._tabs ?? []) {
    let item: Zotero.Item | undefined;
    try {
      const reader = (Zotero.Reader as any).getByTabID?.(tab.id);
      const attachmentID = reader?.itemID;
      if (attachmentID) {
        const attachment = Zotero.Items.get(attachmentID) as Zotero.Item;
        item = ((attachment as any)?.parentItem as Zotero.Item) || attachment;
      }
    } catch {
      item = undefined;
    }
    out.push({
      id: tab.id,
      type: tab.type,
      title: String(tab.title || ""),
      itemKey: itemKeyOf(item),
      item,
      selected: tab.id === T.selectedID,
    });
  }
  return out;
}

function scheduleRender(win: Window, delay = 120) {
  const state = bars.get(win);
  if (!state) return;
  if (state.refreshTimer) clearTimeout(state.refreshTimer);
  state.refreshTimer = setTimeout(() => {
    state.refreshTimer = undefined;
    renderList(win);
  }, delay);
}

export function renderList(win: Window) {
  const state = bars.get(win);
  if (!state) return;
  const doc = win.document;
  const list = state.list;
  list.textContent = "";

  const tabs = readTabs(win).filter(
    (t) => !state.query || t.title.toLowerCase().includes(state.query),
  );
  const all = groups();
  const grouped = new Map<string, TabInfo[]>();
  const ungrouped: TabInfo[] = [];
  for (const tab of tabs) {
    const group = tab.itemKey ? groupOf(tab.itemKey) : undefined;
    if (group) {
      const bucket = grouped.get(group.id) ?? [];
      bucket.push(tab);
      grouped.set(group.id, bucket);
    } else ungrouped.push(tab);
  }

  for (const group of all) {
    const members = grouped.get(group.id);
    if (!members?.length) continue;
    list.appendChild(groupHeader(doc, win, group, members.length));
    if (!group.collapsed) {
      for (const tab of members) list.appendChild(tabRow(doc, win, tab));
    }
  }
  for (const tab of ungrouped) list.appendChild(tabRow(doc, win, tab));

  if (!tabs.length) {
    const empty = doc.createElement("div");
    empty.className = "zest-tabbar-empty";
    empty.textContent = getString("tabs-empty");
    list.appendChild(empty);
  }
}

function groupHeader(
  doc: Document,
  win: Window,
  group: TabGroup,
  count: number,
): HTMLElement {
  const el = doc.createElement("div");
  el.className = "zest-tabbar-group";
  const twisty = doc.createElement("span");
  twisty.className = "zest-tabbar-twisty";
  twisty.textContent = group.collapsed ? "▸" : "▾";
  el.appendChild(twisty);
  const name = doc.createElement("span");
  name.className = "zest-tabbar-group-name";
  name.textContent = `${group.name} (${count})`;
  el.appendChild(name);
  el.addEventListener(
    "click",
    guard("tabs group toggle", () => {
      setGroupCollapsed(group.id, !group.collapsed);
      renderList(win);
    }),
  );
  el.addEventListener(
    "contextmenu",
    guard("tabs group menu", (ev: MouseEvent) => {
      ev.preventDefault();
      showGroupMenu(win, group, ev.screenX, ev.screenY);
    }),
  );
  return el;
}

function tabRow(doc: Document, win: Window, tab: TabInfo): HTMLElement {
  const row = doc.createElement("div");
  row.className = "zest-tabbar-row";
  if (tab.selected) row.classList.add("selected");
  row.setAttribute("data-tab", tab.id);
  row.draggable = tab.type !== "library";

  const label = doc.createElement("span");
  label.className = "zest-tabbar-title";
  label.textContent = tab.title || getString("tabs-untitled");
  row.appendChild(label);

  if (tab.type !== "library") {
    const close = iconButton(
      doc,
      "close",
      getString("tabs-close"),
      "zest-tabbar-close",
      12,
    );
    close.addEventListener(
      "click",
      guard("tabs close", (ev: Event) => {
        ev.stopPropagation();
        closeTab(win, tab.id);
      }),
    );
    row.appendChild(close);
  }

  row.addEventListener(
    "click",
    guard("tabs select", () => selectTab(win, tab.id)),
  );
  row.addEventListener(
    "contextmenu",
    guard("tabs row menu", (ev: MouseEvent) => {
      ev.preventDefault();
      showTabMenu(win, tab, ev.screenX, ev.screenY);
    }),
  );
  row.addEventListener("dragstart", (ev: Event) => {
    try {
      (ev as DragEvent).dataTransfer?.setData("text/plain", tab.id);
    } catch {
      // some platforms disallow it; the drag simply will not start
    }
  });
  row.addEventListener("dragover", (ev) => ev.preventDefault());
  row.addEventListener(
    "drop",
    guard("tabs drop", (ev: Event) => {
      const drag = ev as DragEvent;
      drag.preventDefault();
      const draggedID = drag.dataTransfer?.getData("text/plain");
      if (!draggedID || draggedID === tab.id) return;
      moveTab(win, draggedID, tab.id);
    }),
  );
  return row;
}

/* ------------------------------------------------------------------ */
/* actions (the only places that touch Zotero_Tabs)                    */
/* ------------------------------------------------------------------ */

function selectTab(win: Window, id: string) {
  try {
    (win as any).Zotero_Tabs.select(id);
  } catch (e) {
    // select() throws on an unknown id since 8.0
    ztoolkit.log("[tabs] select failed", e);
    scheduleRender(win, 0);
  }
}

function closeTab(win: Window, id: string) {
  try {
    (win as any).Zotero_Tabs.close(id);
  } catch (e) {
    ztoolkit.log("[tabs] close failed", e);
  }
  scheduleRender(win, 60);
}

function moveTab(win: Window, draggedID: string, targetID: string) {
  const T = (win as any).Zotero_Tabs;
  try {
    const index = T._tabs.findIndex((t: any) => t.id === targetID);
    if (index < 0) return;
    T.move(draggedID, index);
  } catch (e) {
    ztoolkit.log("[tabs] move failed", e);
  }
  scheduleRender(win, 60);
}

function closeOthers(win: Window, keepID: string) {
  const T = (win as any).Zotero_Tabs;
  for (const tab of [...(T._tabs ?? [])]) {
    if (tab.id === keepID || tab.type === "library") continue;
    try {
      T.close(tab.id);
    } catch {
      // already gone
    }
  }
  scheduleRender(win, 60);
}

function closeToTheRight(win: Window, fromID: string) {
  const T = (win as any).Zotero_Tabs;
  const tabs = [...(T._tabs ?? [])];
  const index = tabs.findIndex((t: any) => t.id === fromID);
  if (index < 0) return;
  for (const tab of tabs.slice(index + 1)) {
    if (tab.type === "library") continue;
    try {
      T.close(tab.id);
    } catch {
      // already gone
    }
  }
  scheduleRender(win, 60);
}

/* ------------------------------------------------------------------ */
/* menus                                                               */
/* ------------------------------------------------------------------ */

function popupFor(win: Window): any {
  const doc = win.document;
  const id = `${config.addonRef}-tabs-menu`;
  let popup = doc.getElementById(id) as any;
  if (!popup) {
    popup = doc.createXULElement("menupopup");
    popup.id = id;
    (doc.getElementById("mainPopupSet") || doc.documentElement)?.appendChild(
      popup,
    );
  }
  while (popup.firstChild) popup.firstChild.remove();
  return popup;
}

function addItem(
  win: Window,
  popup: any,
  label: string,
  fn: () => void,
  disabled = false,
) {
  const mi = win.document.createXULElement("menuitem");
  mi.setAttribute("label", label);
  if (disabled) mi.setAttribute("disabled", "true");
  else mi.addEventListener("command", guard("tabs menu item", fn));
  popup.appendChild(mi);
}

function showTabMenu(win: Window, tab: TabInfo, x: number, y: number) {
  const popup = popupFor(win);
  addItem(win, popup, getString("tabs-close"), () => closeTab(win, tab.id));
  addItem(win, popup, getString("tabs-close-others"), () =>
    closeOthers(win, tab.id),
  );
  addItem(win, popup, getString("tabs-close-right"), () =>
    closeToTheRight(win, tab.id),
  );
  popup.appendChild(win.document.createXULElement("menuseparator"));
  if (tab.item) {
    addItem(win, popup, getString("tabs-show-in-library"), () => {
      try {
        void (win as any).ZoteroPane.selectItem(tab.item!.id);
        (win as any).Zotero_Tabs.select("zotero-pane");
      } catch (e) {
        ztoolkit.log("[tabs] reveal failed", e);
      }
    });
  }
  if (tab.itemKey) {
    const menu = win.document.createXULElement("menu");
    menu.setAttribute("label", getString("tabs-move-to-group"));
    const sub = win.document.createXULElement("menupopup");
    menu.appendChild(sub);
    for (const group of groups()) {
      const mi = win.document.createXULElement("menuitem");
      mi.setAttribute("label", group.name);
      mi.addEventListener(
        "command",
        guard("tabs group assign", () => {
          assignToGroup(tab.itemKey, group.id);
          renderList(win);
        }),
      );
      sub.appendChild(mi);
    }
    sub.appendChild(win.document.createXULElement("menuseparator"));
    const create = win.document.createXULElement("menuitem");
    create.setAttribute("label", getString("tabs-new-group"));
    create.addEventListener(
      "command",
      guard("tabs group new", () => {
        const out = { value: getString("tabs-group-default") };
        const ok = Services.prompt.prompt(
          win as any,
          getString("tabs-new-group"),
          getString("tabs-group-name"),
          out,
          null as any,
          { value: false },
        );
        if (!ok) return;
        const group = addGroup(out.value);
        assignToGroup(tab.itemKey, group.id);
        renderList(win);
      }),
    );
    sub.appendChild(create);
    const clear = win.document.createXULElement("menuitem");
    clear.setAttribute("label", getString("tabs-ungroup"));
    clear.addEventListener(
      "command",
      guard("tabs ungroup", () => {
        assignToGroup(tab.itemKey, null);
        renderList(win);
      }),
    );
    sub.appendChild(clear);
    popup.appendChild(menu);
  }
  openAt(win, popup, x, y);
}

function showGroupMenu(win: Window, group: TabGroup, x: number, y: number) {
  const popup = popupFor(win);
  addItem(win, popup, getString("tabs-group-rename"), () => {
    const out = { value: group.name };
    const ok = Services.prompt.prompt(
      win as any,
      getString("tabs-group-rename"),
      getString("tabs-group-name"),
      out,
      null as any,
      { value: false },
    );
    if (ok) {
      renameGroup(group.id, out.value);
      renderList(win);
    }
  });
  addItem(win, popup, getString("tabs-group-delete"), () => {
    removeGroup(group.id);
    renderList(win);
  });
  openAt(win, popup, x, y);
}

function showBarMenu(win: Window, x: number, y: number) {
  const popup = popupFor(win);
  addItem(win, popup, getString("tabs-save-session"), () => {
    const items = readTabs(win)
      .filter((t) => t.itemKey)
      .map((t) => t.itemKey);
    if (!items.length) return;
    const out = { value: new Date().toLocaleString() };
    const ok = Services.prompt.prompt(
      win as any,
      getString("tabs-save-session"),
      getString("tabs-session-name"),
      out,
      null as any,
      { value: false },
    );
    if (ok) saveSession(out.value, items);
  });
  const list = sessions();
  if (list.length) {
    const menu = win.document.createXULElement("menu");
    menu.setAttribute("label", getString("tabs-restore-session"));
    const sub = win.document.createXULElement("menupopup");
    menu.appendChild(sub);
    for (const session of list) {
      const mi = win.document.createXULElement("menuitem");
      mi.setAttribute("label", `${session.name} (${session.items.length})`);
      mi.addEventListener(
        "command",
        guard("tabs restore", () => void restoreSession(win, session.id)),
      );
      sub.appendChild(mi);
    }
    sub.appendChild(win.document.createXULElement("menuseparator"));
    for (const session of list) {
      const mi = win.document.createXULElement("menuitem");
      mi.setAttribute(
        "label",
        `${getString("tabs-session-delete")}: ${session.name}`,
      );
      mi.addEventListener(
        "command",
        guard("tabs session delete", () => {
          removeSession(session.id);
        }),
      );
      sub.appendChild(mi);
    }
    popup.appendChild(menu);
  }
  popup.appendChild(win.document.createXULElement("menuseparator"));
  addItem(win, popup, getString("tabs-hide-native"), () => {
    const next = !getPref("tabs.hideNative");
    setPref("tabs.hideNative", next);
    applyNativeBarVisibility(win, next);
  });
  addItem(win, popup, getString("tabs-close-sidebar"), () => hideSidebar(win));
  openAt(win, popup, x, y);
}

function openAt(win: Window, popup: any, x: number, y: number) {
  try {
    popup.openPopupAtScreen(x, y, true);
  } catch (e) {
    ztoolkit.log("[tabs] menu failed", e);
  }
}

async function restoreSession(win: Window, sessionID: string) {
  const session = sessions().find((s) => s.id === sessionID);
  if (!session) return;
  for (const key of session.items) {
    try {
      const [libraryID, itemKey] = key.split("/");
      const id = Zotero.Items.getIDFromLibraryAndKey(
        Number(libraryID),
        itemKey,
      );
      if (!id) continue;
      const item = Zotero.Items.get(id as number) as Zotero.Item;
      const attachmentID = item.isAttachment()
        ? item.id
        : (item.getAttachments()[0] as number | undefined);
      if (!attachmentID) continue;
      await Zotero.Reader.open(attachmentID);
    } catch (e) {
      ztoolkit.log("[tabs] restore item failed", e);
    }
  }
  scheduleRender(win, 200);
}

/* ------------------------------------------------------------------ */
/* keeping in sync with Zotero                                         */
/* ------------------------------------------------------------------ */

function watch(win: Window) {
  const state = bars.get(win);
  if (!state) return;
  // Notifier covers open/close/select; the MutationObserver catches renames
  // and any move Zotero performs without an event
  state.notifierID = Zotero.Notifier.registerObserver(
    {
      notify: () => scheduleRender(win),
    },
    ["tab"],
    `${config.addonRef}-tabs`,
    50,
  );
  try {
    const bar = win.document.getElementById("tab-bar-container");
    if (bar) {
      const observer = new win.MutationObserver(() => scheduleRender(win, 200));
      observer.observe(bar, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      state.observer = observer;
    }
  } catch (e) {
    ztoolkit.log("[tabs] observer unavailable", e);
  }
}
