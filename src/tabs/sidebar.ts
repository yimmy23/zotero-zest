import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { bestAttachment } from "../utils/items";
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
  pruneGroups,
  type TabGroup,
} from "./model";
import { iconButton } from "../ui/icons";
import { createDOMOwnership } from "../utils/domOwnership";

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
  nativeRoot: HTMLElement;
  observer?: MutationObserver;
  notifierID?: string;
  refreshTimer?: number;
}

type XULish = Element & { setAttribute(name: string, value: string): void };

const bars = new Map<Window, SidebarState>();
const ownership = createDOMOwnership();
const NATIVE_VISIBILITY = "class:zest-hide-native-tabs";

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
  // The sidebar has to live OUTSIDE the deck: #zotero-layout-switcher sits in
  // #zotero-trees, which is the library tab's own deck page, so mounting there
  // makes the bar vanish the moment a reader tab is selected. Verified on
  // Zotero 10.0: #tabs-deck's parent is the anonymous hbox inside
  // #zotero-pane-stack, and it holds the deck plus the context pane.
  const deck =
    ((win as any).Zotero_Tabs?.deck as HTMLElement | undefined) ||
    doc.getElementById("tabs-deck");
  const host = deck?.parentElement;
  if (!deck || !host) {
    ztoolkit.log("[tabs] no tab deck to mount beside");
    return;
  }

  // leftover from an in-place upgrade (the outgoing copy removes its own
  // bar only when its shutdown finally runs)
  const previousBar = doc.getElementById(`${config.addonRef}-tabbar`);
  previousBar?.remove();
  doc.getElementById(`${config.addonRef}-tabbar-splitter`)?.remove();
  const nativeRoot = doc.documentElement as HTMLElement;
  // Legacy copies owned the hiding class but had no saved baseline. Their
  // teardown removed it; never preserve it as the native tab bar's state.
  const wasHidden =
    !previousBar && nativeRoot.classList.contains("zest-hide-native-tabs");
  ownership.claim(nativeRoot, NATIVE_VISIBILITY, () => {
    nativeRoot.classList.toggle("zest-hide-native-tabs", wasHidden);
  });

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

  host.insertBefore(box as unknown as Node, deck);
  host.insertBefore(splitter as unknown as Node, deck);

  const state: SidebarState = {
    win,
    box,
    splitter,
    list,
    search,
    query: "",
    nativeRoot,
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
  // items get deleted while the sidebar is closed; drop their group entries
  // once, here, rather than on every render
  pruneGroups();
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
    if (ownership.owns(state.nativeRoot, NATIVE_VISIBILITY))
      win.document.getElementById(`${config.addonRef}-tabs-menu`)?.remove();
  } catch {
    // window closing
  }
  const released = ownership.release(state.nativeRoot, NATIVE_VISIBILITY);
  if (persist && released) setPref("tabs.sidebar", false);
}

export function uninstallSidebars() {
  for (const win of [...bars.keys()]) hideSidebar(win, false);
}

/** re-read `tabs.hideNative` and apply it to every window that has a sidebar */
export function syncNativeBarVisibility() {
  const hide = !!getPref("tabs.hideNative");
  for (const win of bars.keys()) applyNativeBarVisibility(win, hide);
}

function applyNativeBarVisibility(win: Window, hide: boolean) {
  try {
    const root = bars.get(win)?.nativeRoot;
    if (root && ownership.owns(root, NATIVE_VISIBILITY))
      root.classList.toggle("zest-hide-native-tabs", hide);
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
  /** what a saved session stores for this tab: the item key for readers,
   *  "note:<libraryID>/<key>" for note tabs ("" = not restorable) */
  sessionKey: string;
}

function readTabs(win: Window): TabInfo[] {
  const T = (win as any).Zotero_Tabs;
  const out: TabInfo[] = [];
  for (const tab of T?._tabs ?? []) {
    let item: Zotero.Item | undefined;
    let sessionKey = "";
    try {
      // `tab.data.itemID` is written by Zotero_Tabs.add() and round-trips
      // through session.json, so it is there for reader, reader-unloaded and
      // note tabs alike; a live reader is only a fallback. Without it, every
      // tab restored at startup (all of them are `reader-unloaded`) would look
      // item-less and drop out of its group.
      const itemID =
        (tab as any).data?.itemID ??
        (Zotero.Reader as any).getByTabID?.(tab.id)?.itemID;
      if (itemID) {
        const opened = Zotero.Items.get(itemID) as Zotero.Item;
        // groups are keyed by the PARENT (a note and its PDF sit together);
        // a session must reopen the note itself, not the parent's PDF
        item = ((opened as any)?.parentItem as Zotero.Item) || opened;
        if (String(tab.type).startsWith("note") && opened?.isNote?.()) {
          sessionKey = `note:${opened.libraryID}/${opened.key}`;
        } else {
          sessionKey = itemKeyOf(item);
        }
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
      sessionKey,
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
  if (!state || !ownership.owns(state.nativeRoot, NATIVE_VISIBILITY)) return;
  const doc = win.document;
  const list = state.list;
  list.textContent = "";

  const tabs = readTabs(win)
    // the library tab is not a document; Zotero always keeps it and it cannot
    // be closed or grouped, so it does not belong in the list
    .filter((t) => t.type !== "library")
    .filter((t) => !state.query || t.title.toLowerCase().includes(state.query));
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
  row.draggable = true;

  const label = doc.createElement("span");
  label.className = "zest-tabbar-title";
  label.textContent = tab.title || getString("tabs-untitled");
  row.appendChild(label);

  {
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
    const tabs = T._tabs ?? [];
    const from = tabs.findIndex((t: any) => t.id === draggedID);
    const to = tabs.findIndex((t: any) => t.id === targetID);
    if (from < 0 || to < 0 || from === to) return;
    // Zotero's move() removes the tab first and then splices, decrementing the
    // index when it moves forward — so "drop onto row N" is index N when
    // dragging up, and N + 1 when dragging down.
    T.move(draggedID, from < to ? to + 1 : to);
  } catch (e) {
    ztoolkit.log("[tabs] move failed", e);
  }
  scheduleRender(win, 60);
}

/** close a set of tabs in one call (Zotero_Tabs.close accepts an array) */
function closeMany(win: Window, ids: string[]) {
  if (!ids.length) return;
  try {
    (win as any).Zotero_Tabs.close(ids);
  } catch (e) {
    ztoolkit.log("[tabs] close failed", e);
  }
  scheduleRender(win, 80);
}

function closeOthers(win: Window, keepID: string) {
  const T = (win as any).Zotero_Tabs;
  closeMany(
    win,
    [...(T._tabs ?? [])]
      .filter((tab: any) => tab.id !== keepID && tab.type !== "library")
      .map((tab: any) => tab.id),
  );
}

function closeToTheRight(win: Window, fromID: string) {
  const T = (win as any).Zotero_Tabs;
  const tabs = [...(T._tabs ?? [])];
  const index = tabs.findIndex((t: any) => t.id === fromID);
  if (index < 0) return;
  closeMany(
    win,
    tabs
      .slice(index + 1)
      .filter((tab: any) => tab.type !== "library")
      .map((tab: any) => tab.id),
  );
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
      .filter((t) => t.sessionKey)
      .map((t) => t.sessionKey);
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

/** how many tabs a restore may open without asking */
const RESTORE_WARN_AT = 12;

async function restoreSession(win: Window, sessionID: string) {
  const session = sessions().find((s) => s.id === sessionID);
  if (!session) return;
  if (session.items.length > RESTORE_WARN_AT) {
    const ok = Services.prompt.confirm(
      win as any,
      getString("tabs-restore-session"),
      getString("tabs-restore-confirm", {
        args: { count: session.items.length },
      }),
    );
    if (!ok) return;
  }
  for (const entry of session.items) {
    try {
      const isNote = entry.startsWith("note:");
      const key = isNote ? entry.slice(5) : entry;
      const [libraryID, itemKey] = key.split("/");
      const id = Zotero.Items.getIDFromLibraryAndKey(
        Number(libraryID),
        itemKey,
      );
      if (!id) continue;
      const item = Zotero.Items.get(id as number) as Zotero.Item;
      if (isNote || item.isNote()) {
        await (Zotero as any).Notes.open(item.id, undefined, {
          openInBackground: true,
        });
        await Zotero.Promise.delay(150);
        continue;
      }
      const attachmentID = item.isAttachment()
        ? item.id
        : bestAttachment(item)?.id;
      if (!attachmentID) continue;
      // open in the background and pace the loop: opening a dozen readers as
      // fast as possible freezes the window while each one loads
      await Zotero.Reader.open(attachmentID, undefined, {
        openInBackground: true,
      });
      await Zotero.Promise.delay(150);
    } catch (e) {
      ztoolkit.log("[tabs] restore item failed", e);
    }
  }
  scheduleRender(win, 200);
}

/** the width preference changed (Settings, or the splitter wrote it back) */
export function applySidebarWidth() {
  const width = Math.min(
    MAX_WIDTH,
    Math.max(MIN_WIDTH, Number(getPref("tabs.width")) || 220),
  );
  for (const state of bars.values()) {
    try {
      const box = state.box as unknown as HTMLElement | undefined;
      if (box && Math.round(box.getBoundingClientRect().width) !== width) {
        box.style.width = `${width}px`;
      }
    } catch {
      // window closing
    }
  }
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
