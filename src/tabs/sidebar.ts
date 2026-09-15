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
  type TabSessionTarget,
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
  library: HTMLButtonElement;
  entries: FocusEntry[];
  focusKey?: string;
  query: string;
  nativeRoot: HTMLElement;
  observer?: MutationObserver;
  notifierID?: string;
  refreshTimer?: number;
}

interface FocusEntry {
  key: string;
  button: HTMLButtonElement;
  close?: HTMLButtonElement;
  groupID?: string;
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
  box.setAttribute("role", "navigation");
  box.setAttribute("aria-label", getString("tabs-sidebar-label"));
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
  search.setAttribute("aria-label", getString("tabs-search"));
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
  list.setAttribute("role", "list");
  list.setAttribute("aria-label", getString("tabs-documents"));

  // Library is never filtered, grouped or scrolled out with the documents.
  const library = doc.createElement("button");
  library.type = "button";
  library.className = "zest-tabbar-library";
  library.textContent = getString("tabs-library");
  library.addEventListener(
    "click",
    guard("tabs library", () => {
      if (!liveSidebar(win, library)) return;
      const tab = (win as any).Zotero_Tabs._tabs.find(
        (t: any) => t.type === "library",
      );
      if (tab) selectTab(win, tab.id);
    }),
  );
  library.addEventListener(
    "keydown",
    guard("tabs library key", (event: KeyboardEvent) => {
      const state = liveSidebar(win, library);
      if (
        !state ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      const entry =
        event.key === "End"
          ? state.entries.at(-1)
          : ["ArrowDown", "Home"].includes(event.key)
            ? state.entries[0]
            : undefined;
      if (entry) {
        event.preventDefault();
        focusEntry(state, entry);
      }
    }),
  );

  box.appendChild(header as unknown as Node);
  box.appendChild(library as unknown as Node);
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
    library,
    entries: [],
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
  /** Exact opened document, independently of the parent used for grouping. */
  sessionTarget?: TabSessionTarget;
}

function readTabs(win: Window): TabInfo[] {
  const T = (win as any).Zotero_Tabs;
  const out: TabInfo[] = [];
  for (const tab of T?._tabs ?? []) {
    let item: Zotero.Item | undefined;
    let sessionTarget: TabSessionTarget | undefined;
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
        // Groups share the parent, but a session must reopen this exact
        // attachment/note: a supplementary PDF is a different document.
        item = ((opened as any)?.parentItem as Zotero.Item) || opened;
        if (String(tab.type).startsWith("note") && opened?.isNote?.()) {
          sessionTarget = {
            kind: "note",
            libraryID: opened.libraryID,
            key: opened.key,
          };
        } else if (
          String(tab.type).startsWith("reader") &&
          opened?.isAttachment?.()
        ) {
          sessionTarget = {
            kind: "attachment",
            libraryID: opened.libraryID,
            key: opened.key,
          };
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
      sessionTarget,
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

interface FocusSnapshot {
  key: string;
  index: number;
  close: boolean;
  groupID?: string;
}

function liveSidebar(
  win: Window,
  element: HTMLElement,
): SidebarState | undefined {
  const state = bars.get(win);
  return state &&
    addon.data.alive &&
    element.isConnected &&
    ownership.owns(state.nativeRoot, NATIVE_VISIBILITY)
    ? state
    : undefined;
}

function captureFocus(state: SidebarState): FocusSnapshot | undefined {
  const active = state.win.document.activeElement;
  const index = state.entries.findIndex(
    (entry) => entry.button === active || entry.close === active,
  );
  if (index < 0) return;
  const entry = state.entries[index];
  return {
    key: entry.key,
    index,
    close: entry.close === active,
    groupID: entry.groupID,
  };
}

/** Tab visits one document/group and its close control; arrows move the row stop. */
function setRovingEntry(state: SidebarState, key: string) {
  state.focusKey = key;
  for (const entry of state.entries) {
    const tabIndex = entry.key === key ? 0 : -1;
    entry.button.tabIndex = tabIndex;
    if (entry.close) entry.close.tabIndex = tabIndex;
  }
}

function focusEntry(state: SidebarState, entry: FocusEntry, close = false) {
  setRovingEntry(state, entry.key);
  (close && entry.close ? entry.close : entry.button).focus({
    preventScroll: true,
  });
  entry.button.scrollIntoView?.({ block: "nearest" });
}

function bindNavigation(
  win: Window,
  entry: FocusEntry,
  activate: () => void,
  group?: TabGroup,
) {
  const state = bars.get(win)!;
  state.entries.push(entry);
  entry.button.setAttribute("data-focus-key", entry.key);
  const onFocus = () => {
    if (liveSidebar(win, entry.button)) setRovingEntry(state, entry.key);
  };
  entry.button.addEventListener("focus", onFocus);
  entry.close?.addEventListener("focus", onFocus);
  const onKey = guard("tabs navigation", (event: KeyboardEvent) => {
    if (
      !liveSidebar(win, entry.button) ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    )
      return;
    const index = state.entries.indexOf(entry);
    let target: FocusEntry | undefined;
    if (event.key === "ArrowDown")
      target = state.entries[Math.min(index + 1, state.entries.length - 1)];
    else if (event.key === "ArrowUp") {
      if (index === 0) {
        event.preventDefault();
        state.library.focus();
        return;
      }
      target = state.entries[index - 1];
    } else if (event.key === "Home") target = state.entries[0];
    else if (event.key === "End") target = state.entries.at(-1);
    else if (
      (event.key === "ArrowLeft" && group && !group.collapsed) ||
      (event.key === "ArrowRight" && group?.collapsed)
    ) {
      event.preventDefault();
      activate();
      return;
    } else if (event.key === "ArrowRight" && group)
      target = state.entries[index + 1];
    else if (event.key === "ArrowLeft" && entry.groupID)
      target = state.entries.find((e) => e.key === `group:${entry.groupID}`);
    else if (
      (event.key === "Enter" || event.key === " ") &&
      event.target !== entry.close
    ) {
      event.preventDefault();
      activate();
      return;
    }
    if (target) {
      event.preventDefault();
      focusEntry(state, target);
    }
  });
  entry.button.addEventListener("keydown", onKey);
  entry.close?.addEventListener("keydown", onKey);
}

export function renderList(win: Window, restoreFocus?: FocusSnapshot) {
  const state = bars.get(win);
  if (!state || !ownership.owns(state.nativeRoot, NATIVE_VISIBILITY)) return;
  const doc = win.document;
  const list = state.list;
  const focused = restoreFocus || captureFocus(state);
  const previousKey = state.focusKey;
  list.textContent = "";
  state.entries = [];

  const allTabs = readTabs(win);
  const library = allTabs.find((tab) => tab.type === "library");
  state.library.disabled = !library;
  state.library.setAttribute(
    "aria-current",
    library?.selected ? "page" : "false",
  );
  state.library.classList.toggle("selected", !!library?.selected);
  const tabs = allTabs
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
      for (const tab of members)
        list.appendChild(tabRow(doc, win, tab, group.id));
    }
  }
  for (const tab of ungrouped) list.appendChild(tabRow(doc, win, tab));

  if (!tabs.length) {
    const empty = doc.createElement("div");
    empty.className = "zest-tabbar-empty";
    empty.setAttribute("role", "listitem");
    empty.textContent = getString("tabs-empty");
    list.appendChild(empty);
  }

  const selectedKey = `tab:${allTabs.find((tab) => tab.selected)?.id}`;
  const selected = state.entries.find((entry) => entry.key === selectedKey);
  const target =
    state.entries.find(
      (entry) => entry.key === (focused?.key || previousKey),
    ) ||
    (focused?.groupID
      ? state.entries.find((entry) => entry.key === `group:${focused.groupID}`)
      : undefined) ||
    (focused
      ? state.entries[Math.min(focused.index, state.entries.length - 1)]
      : selected) ||
    state.entries[0];
  if (target) {
    setRovingEntry(state, target.key);
    if (focused)
      focusEntry(state, target, focused.key === target.key && focused.close);
  } else if (focused) state.library.focus();
}

function groupHeader(
  doc: Document,
  win: Window,
  group: TabGroup,
  count: number,
): HTMLElement {
  const wrapper = doc.createElement("div");
  wrapper.setAttribute("role", "listitem");
  const el = doc.createElement("button");
  el.type = "button";
  el.className = "zest-tabbar-group";
  el.setAttribute("aria-expanded", String(!group.collapsed));
  const twisty = doc.createElement("span");
  twisty.className = "zest-tabbar-twisty";
  twisty.textContent = group.collapsed ? "▸" : "▾";
  twisty.setAttribute("aria-hidden", "true");
  el.appendChild(twisty);
  const name = doc.createElement("span");
  name.className = "zest-tabbar-group-name";
  name.textContent = `${group.name} (${count})`;
  el.appendChild(name);
  const activate = () => {
    if (!liveSidebar(win, el)) return;
    setGroupCollapsed(group.id, !group.collapsed);
    renderList(win);
  };
  bindNavigation(
    win,
    { key: `group:${group.id}`, button: el },
    activate,
    group,
  );
  el.addEventListener("click", guard("tabs group toggle", activate));
  el.addEventListener(
    "contextmenu",
    guard("tabs group menu", (ev: MouseEvent) => {
      if (!liveSidebar(win, el)) return;
      ev.preventDefault();
      el.focus();
      showGroupMenu(win, group, ev.screenX, ev.screenY);
    }),
  );
  wrapper.appendChild(el);
  return wrapper;
}

function tabRow(
  doc: Document,
  win: Window,
  tab: TabInfo,
  groupID?: string,
): HTMLElement {
  const row = doc.createElement("div");
  row.className = "zest-tabbar-row";
  row.setAttribute("role", "listitem");
  if (tab.selected) row.classList.add("selected");
  row.setAttribute("data-tab", tab.id);
  row.draggable = true;

  const button = doc.createElement("button");
  button.type = "button";
  button.className = "zest-tabbar-tab";
  button.setAttribute("aria-current", tab.selected ? "page" : "false");
  const label = doc.createElement("span");
  label.className = "zest-tabbar-title";
  label.textContent = tab.title || getString("tabs-untitled");
  button.appendChild(label);
  row.appendChild(button);

  const entry: FocusEntry = { key: `tab:${tab.id}`, button, groupID };
  {
    const close = iconButton(
      doc,
      "close",
      getString("tabs-close"),
      "zest-tabbar-close",
      12,
    );
    close.type = "button";
    close.setAttribute(
      "aria-label",
      `${getString("tabs-close")}: ${tab.title || getString("tabs-untitled")}`,
    );
    entry.close = close;
    close.addEventListener(
      "click",
      guard("tabs close", (ev: Event) => {
        ev.stopPropagation();
        if (!liveSidebar(win, close)) return;
        closeTab(win, tab.id);
      }),
    );
    row.appendChild(close);
  }

  const activate = () => {
    const state = liveSidebar(win, button);
    if (!state) return;
    focusEntry(state, entry);
    selectTab(win, tab.id);
  };
  bindNavigation(win, entry, activate);

  row.addEventListener("click", guard("tabs select", activate));
  row.addEventListener(
    "contextmenu",
    guard("tabs row menu", (ev: MouseEvent) => {
      const state = liveSidebar(win, button);
      if (!state) return;
      ev.preventDefault();
      focusEntry(state, entry);
      showTabMenu(win, tab, ev.screenX, ev.screenY);
    }),
  );
  row.addEventListener("dragstart", (ev: Event) => {
    if (!liveSidebar(win, button)) return;
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
      if (!liveSidebar(win, button)) return;
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
  const state = bars.get(win);
  const focused = state && captureFocus(state);
  try {
    // Zotero otherwise schedules a refocus hook which can await reader loading
    // and steal focus after this render. Its own keyboard option suppresses it.
    (win as any).Zotero_Tabs.select(
      id,
      false,
      focused ? { keepTabFocused: true } : {},
    );
    renderList(win, focused);
  } catch (e) {
    // select() throws on an unknown id since 8.0
    ztoolkit.log("[tabs] select failed", e);
    scheduleRender(win, 0);
  }
}

/** Preserve Zotero's close-selection order while suppressing its async refocus. */
function closeNativeTabs(
  win: Window,
  ids: string | string[],
  preserveFocus: boolean,
) {
  const tabs = (win as any).Zotero_Tabs;
  const closing = new Set(typeof ids === "string" ? [ids] : ids);
  if (preserveFocus && closing.has(tabs.selectedID)) {
    const open = tabs._tabs as { id: string }[];
    const index = open.findIndex((tab) => tab.id === tabs.selectedID);
    // Match Zotero 10's jump-back target first, then right/left adjacency.
    const previous = open.find(
      (tab) => tab.id === tabs._prevSelectedID && !closing.has(tab.id),
    );
    const next =
      previous ||
      [...open.slice(index + 1), ...open.slice(0, index).reverse()].find(
        (tab) => !closing.has(tab.id),
      );
    if (next) tabs.select(next.id, false, { keepTabFocused: true });
  }
  // Preselection keeps close() from scheduling another reader/library refocus.
  tabs.close(ids);
}

function closeTab(win: Window, id: string, restoreFocus?: FocusSnapshot) {
  const state = bars.get(win);
  const focused = restoreFocus || (state && captureFocus(state));
  try {
    closeNativeTabs(win, id, !!focused);
  } catch (e) {
    ztoolkit.log("[tabs] close failed", e);
  }
  renderList(win, focused);
  scheduleRender(win, 60);
}

function moveTab(win: Window, draggedID: string, targetID: string) {
  const T = (win as any).Zotero_Tabs;
  const state = bars.get(win);
  const focused = state && captureFocus(state);
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
  renderList(win, focused);
  scheduleRender(win, 60);
}

/** close a set of tabs in one call (Zotero_Tabs.close accepts an array) */
function closeMany(win: Window, ids: string[], restoreFocus?: FocusSnapshot) {
  if (!ids.length) return;
  const state = bars.get(win);
  const focused = restoreFocus || (state && captureFocus(state));
  try {
    closeNativeTabs(win, ids, !!focused);
  } catch (e) {
    ztoolkit.log("[tabs] close failed", e);
  }
  renderList(win, focused);
  scheduleRender(win, 80);
}

function closeOthers(win: Window, keepID: string, focused?: FocusSnapshot) {
  const T = (win as any).Zotero_Tabs;
  closeMany(
    win,
    [...(T._tabs ?? [])]
      .filter((tab: any) => tab.id !== keepID && tab.type !== "library")
      .map((tab: any) => tab.id),
    focused,
  );
}

function closeToTheRight(win: Window, fromID: string, focused?: FocusSnapshot) {
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
    focused,
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
  const state = bars.get(win);
  const focused = state && captureFocus(state);
  const popup = popupFor(win);
  addItem(win, popup, getString("tabs-close"), () =>
    closeTab(win, tab.id, focused),
  );
  addItem(win, popup, getString("tabs-close-others"), () =>
    closeOthers(win, tab.id, focused),
  );
  addItem(win, popup, getString("tabs-close-right"), () =>
    closeToTheRight(win, tab.id, focused),
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
          renderList(win, focused && { ...focused, groupID: group.id });
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
        renderList(win, focused && { ...focused, groupID: group.id });
      }),
    );
    sub.appendChild(create);
    const clear = win.document.createXULElement("menuitem");
    clear.setAttribute("label", getString("tabs-ungroup"));
    clear.addEventListener(
      "command",
      guard("tabs ungroup", () => {
        assignToGroup(tab.itemKey, null);
        renderList(win, focused && { ...focused, groupID: undefined });
      }),
    );
    sub.appendChild(clear);
    popup.appendChild(menu);
  }
  openAt(win, popup, x, y);
}

function showGroupMenu(win: Window, group: TabGroup, x: number, y: number) {
  const state = bars.get(win);
  const focused = state && captureFocus(state);
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
      renderList(win, focused);
    }
  });
  addItem(win, popup, getString("tabs-group-delete"), () => {
    removeGroup(group.id);
    renderList(win, focused);
  });
  openAt(win, popup, x, y);
}

function showBarMenu(win: Window, x: number, y: number) {
  const popup = popupFor(win);
  addItem(win, popup, getString("tabs-save-session"), () => {
    if (!readTabs(win).some((tab) => tab.sessionTarget)) return;
    const out = { value: new Date().toLocaleString() };
    const ok = Services.prompt.prompt(
      win as any,
      getString("tabs-save-session"),
      getString("tabs-session-name"),
      out,
      null as any,
      { value: false },
    );
    if (ok) captureSession(win, out.value);
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

/** Capture tab order and the selected document, without using group keys. */
export function captureSession(win: Window, name: string) {
  const tabs = readTabs(win);
  const items = tabs.flatMap((tab) =>
    tab.sessionTarget ? [tab.sessionTarget] : [],
  );
  if (!items.length) return;
  return saveSession(
    name,
    items,
    tabs.find((tab) => tab.selected)?.sessionTarget,
  );
}

export async function restoreSession(win: Window, sessionID: string) {
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
  let selectedItemID: number | undefined;
  for (const entry of session.items) {
    try {
      if (win.closed || !addon.data.alive) return;
      const legacy = typeof entry === "string";
      const isNote = legacy ? entry.startsWith("note:") : entry.kind === "note";
      const [libraryID, itemKey] = legacy
        ? (isNote ? entry.slice(5) : entry).split("/")
        : [entry.libraryID, entry.key];
      const id = Zotero.Items.getIDFromLibraryAndKey(
        Number(libraryID),
        itemKey,
      );
      if (!id) continue;
      const item = Zotero.Items.get(id as number) as Zotero.Item;
      if (!item || item.deleted) continue;
      // Explicit targets never fall back to a parent's different attachment.
      if (!legacy && (isNote ? !item.isNote() : !item.isAttachment())) continue;
      const selected =
        !legacy &&
        session.selected?.kind === entry.kind &&
        session.selected.libraryID === entry.libraryID &&
        session.selected.key === entry.key;
      if (isNote || item.isNote()) {
        await (Zotero as any).Notes.open(item.id, undefined, {
          openInBackground: true,
        });
        if (win.closed || !addon.data.alive) return;
        if (selected) selectedItemID = item.id;
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
      if (win.closed || !addon.data.alive) return;
      if (selected) selectedItemID = attachmentID;
      await Zotero.Promise.delay(150);
    } catch (e) {
      ztoolkit.log("[tabs] restore item failed", e);
    }
  }
  if (win.closed || !addon.data.alive) return;
  if (selectedItemID) {
    try {
      const tabs = (win as any).Zotero_Tabs;
      const selected = tabs?._tabs?.find(
        (tab: any) => tab.data?.itemID === selectedItemID,
      );
      if (selected && typeof tabs.select === "function")
        tabs.select(selected.id);
    } catch (e) {
      ztoolkit.log("[tabs] restore selection failed", e);
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
