const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers.cjs");

function fixture({ grouped = false, asyncNativeFocus = false } = {}) {
  const doc = { activeElement: null };
  class Element {
    constructor(tag) {
      this.tagName = tag;
      this.ownerDocument = doc;
      this.children = [];
      this.parentElement = null;
      this.attributes = new Map();
      this.listeners = new Map();
      this.style = {};
      this.className = "";
      this.tabIndex = tag === "button" || tag === "input" ? 0 : -1;
      this.disabled = false;
      this.value = "";
      this.content = "";
      this.classList = {
        contains: (name) => this.className.split(/\s+/).includes(name),
        add: (...names) => {
          this.className = [
            ...new Set([...this.className.split(/\s+/), ...names]),
          ].join(" ");
        },
        remove: (name) => {
          this.className = this.className
            .split(/\s+/)
            .filter((n) => n !== name)
            .join(" ");
        },
        toggle: (name, enabled) =>
          enabled ? this.classList.add(name) : this.classList.remove(name),
      };
    }
    get textContent() {
      return (
        this.content + this.children.map((child) => child.textContent).join("")
      );
    }
    set textContent(value) {
      for (const child of this.children) child.parentElement = null;
      this.children = [];
      this.content = String(value);
    }
    get isConnected() {
      return this === doc.documentElement || !!this.parentElement?.isConnected;
    }
    get firstChild() {
      return this.children[0];
    }
    openPopupAtScreen() {
      this.focus();
    }
    appendChild(child) {
      child.remove();
      child.parentElement = this;
      this.children.push(child);
      return child;
    }
    insertBefore(child, before) {
      child.remove();
      child.parentElement = this;
      this.children.splice(this.children.indexOf(before), 0, child);
      return child;
    }
    remove() {
      if (this.parentElement) {
        const siblings = this.parentElement.children;
        siblings.splice(siblings.indexOf(this), 1);
        this.parentElement = null;
      }
    }
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    }
    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    }
    addEventListener(name, fn) {
      if (!this.listeners.has(name)) this.listeners.set(name, []);
      this.listeners.get(name).push(fn);
    }
    dispatch(type, properties = {}) {
      const event = {
        type,
        target: this,
        key: "",
        screenX: 20,
        screenY: 30,
        preventDefault() {
          this.defaultPrevented = true;
        },
        stopPropagation() {
          this.stopped = true;
        },
        ...properties,
      };
      let current = this;
      do {
        for (const listener of current.listeners.get(type) || [])
          listener(event);
        current = current.parentElement;
      } while (current && !event.stopped && type !== "focus");
      return event;
    }
    click() {
      if (!this.disabled) this.dispatch("click");
    }
    focus() {
      doc.activeElement = this;
      this.dispatch("focus");
    }
    scrollIntoView() {}
    getBoundingClientRect() {
      return { width: 220, left: 10, bottom: 30 };
    }
  }
  doc.createElement = (tag) => new Element(tag);
  doc.createXULElement = doc.createElement;
  doc.documentElement = new Element("window");
  const walk = (node = doc.documentElement) => [
    node,
    ...node.children.flatMap(walk),
  ];
  doc.getElementById = (id) => walk().find((node) => node.id === id);
  const external = new Element("input");
  doc.documentElement.appendChild(external);
  const deck = new Element("div");
  deck.id = "tabs-deck";
  doc.documentElement.appendChild(deck);
  const native = new Element("div");
  native.id = "tab-bar-container";
  doc.documentElement.appendChild(native);
  const jobs = new Map();
  const observers = new Set();
  const selected = [],
    closed = [],
    moved = [],
    logs = [];
  const selectOptions = [];
  const nativeFocusJobs = [];
  let timerID = 0;
  let observerDisconnected = 0;
  const group = { id: "research", name: "Research", collapsed: false };
  const groupList = grouped ? [group] : [];
  const members = new Set(grouped ? ["A", "B"] : []);
  const win = {
    document: doc,
    MutationObserver: class {
      observe() {}
      disconnect() {
        observerDisconnected++;
      }
    },
    Zotero_Tabs: {
      deck,
      selectedID: "b",
      _tabs: [
        { id: "native-library", type: "library", title: "My Library" },
        ...["a", "b", "c"].map((id) => ({
          id,
          type: "reader",
          title: `Paper ${id.toUpperCase()}`,
          data: { itemID: id },
        })),
      ],
      add() {},
      select(id, _reopening, options = {}) {
        selected.push(id);
        selectOptions.push({ id, keepTabFocused: options.keepTabFocused });
        this.selectedID = id;
        if (asyncNativeFocus) {
          if (!options.keepTabFocused)
            nativeFocusJobs.push(() => external.focus());
        } else external.focus();
      },
      close(ids) {
        ids = Array.isArray(ids) ? ids : [ids];
        closed.push(...ids);
        if (asyncNativeFocus && ids.includes(this.selectedID)) {
          const index = this._tabs.findIndex(
            (tab) => tab.id === this.selectedID,
          );
          const next =
            this._tabs.find(
              (tab) => tab.id === this._prevSelectedID && !ids.includes(tab.id),
            ) ||
            [
              ...this._tabs.slice(index + 1),
              ...this._tabs.slice(0, index).reverse(),
            ].find((tab) => !ids.includes(tab.id));
          if (next) this.select(next.id, false, {});
        }
        this._tabs = this._tabs.filter((tab) => !ids.includes(tab.id));
        if (ids.includes(this.selectedID))
          this.selectedID = this._tabs.at(-1).id;
        if (!asyncNativeFocus) external.focus();
      },
      move(id, index) {
        moved.push({ id, index });
        const from = this._tabs.findIndex((tab) => tab.id === id);
        const [tab] = this._tabs.splice(from, 1);
        this._tabs.splice(from < index ? index - 1 : index, 0, tab);
      },
    },
  };
  const prefs = new Map([["tabs.hideNative", true]]);
  const h = createHarness({
    globals: {
      Zotero: {
        Items: { get: (id) => ({ key: id.toUpperCase(), libraryID: 1 }) },
        Reader: { getByTabID() {} },
        Notifier: {
          registerObserver(observer) {
            observers.add(observer);
            return observer;
          },
          unregisterObserver(observer) {
            observers.delete(observer);
          },
        },
      },
      ztoolkit: { log: (...args) => logs.push(args) },
    },
    mocks: {
      "src/utils/locale.ts": { getString: (key) => key },
      "src/utils/items.ts": {},
      "src/utils/prefs.ts": {
        getPref: (key) => prefs.get(key),
        setPref: (key, value) => prefs.set(key, value),
      },
      "src/utils/timers.ts": {
        setTimeout: (fn) => {
          jobs.set(++timerID, fn);
          return timerID;
        },
        clearTimeout: (id) => jobs.delete(id),
      },
      "src/ui/icons.ts": {
        iconButton(_doc, _icon, label, className) {
          const button = doc.createElement("button");
          button.className = className;
          button.setAttribute("aria-label", label);
          return button;
        },
      },
      "src/tabs/model.ts": {
        groups: () => groupList,
        groupOf: (key) => (members.has(key) ? group : undefined),
        itemKeyOf: (item) => item?.key || "",
        pruneGroups() {},
        setGroupCollapsed(_id, collapsed) {
          group.collapsed = collapsed;
        },
        assignToGroup(key, groupID) {
          if (groupID) members.add(key);
          else members.delete(key);
        },
      },
    },
  });
  const sidebar = h.load("src/tabs/sidebar.ts");
  sidebar.showSidebar(win);
  const byClass = (name) =>
    walk().find((node) => node.classList.contains(name));
  const focusable = (key) =>
    walk().find((node) => node.getAttribute("data-focus-key") === key);
  const key = (element, value, options = {}) => {
    const event = element.dispatch("keydown", { key: value, ...options });
    if (
      !event.defaultPrevented &&
      ["Enter", " "].includes(value) &&
      element.tagName === "button"
    )
      element.click();
    return event;
  };
  return {
    doc,
    win,
    sidebar,
    prefs,
    group,
    members,
    selected,
    selectOptions,
    nativeFocusJobs,
    closed,
    moved,
    logs,
    external,
    byClass,
    focusable,
    key,
    walk,
    jobs,
    observers,
    disconnected: () => observerDisconnected,
    drainNativeFocus() {
      for (const fn of nativeFocusJobs.splice(0)) fn();
    },
    drain() {
      for (const [id, fn] of jobs) {
        jobs.delete(id);
        fn();
      }
    },
    closeButton(id) {
      return focusable(`tab:${id}`).parentElement.children[1];
    },
  };
}

test("Library stays fixed and keyboard reachable when native tabs are hidden and filtering matches nothing", () => {
  const f = fixture();
  const library = f.byClass("zest-tabbar-library");
  assert.equal(
    f.doc.documentElement.classList.contains("zest-hide-native-tabs"),
    true,
  );
  assert.equal(library.disabled, false);
  const search = f.byClass("zest-tabbar-search");
  search.value = "not found";
  search.focus();
  search.dispatch("input");
  assert.equal(f.focusable("tab:a"), undefined);
  assert.equal(library.parentElement, f.byClass("zest-tabbar"));
  assert.equal(f.doc.activeElement, search);
  library.focus();
  f.key(library, "Enter");
  assert.deepEqual(f.selected, ["native-library"]);
  assert.equal(library.getAttribute("aria-current"), "page");
  assert.equal(library.children.length, 0);
});

test("document activation and close are sibling buttons with current-page semantics and one roving row", () => {
  const f = fixture();
  assert.equal(f.byClass("zest-tabbar-list").getAttribute("role"), "list");
  for (const id of ["a", "b", "c"]) {
    const button = f.focusable(`tab:${id}`);
    assert.equal(button.tagName, "button");
    assert.equal(button.parentElement.getAttribute("role"), "listitem");
    assert.equal(
      button.getAttribute("aria-current"),
      id === "b" ? "page" : "false",
    );
    assert.equal(button.tabIndex, id === "b" ? 0 : -1);
    assert.equal(f.closeButton(id).tabIndex, button.tabIndex);
    assert.equal(f.closeButton(id).parentElement, button.parentElement);
    assert.equal(
      button.children.some((child) => child.tagName === "button"),
      false,
    );
  }
});

test("arrows and Home/End move focus without selecting documents, leaving Tab and modified keys native", () => {
  const f = fixture();
  f.focusable("tab:b").focus();
  f.key(f.doc.activeElement, "ArrowDown");
  assert.equal(f.doc.activeElement, f.focusable("tab:c"));
  f.key(f.doc.activeElement, "Home");
  assert.equal(f.doc.activeElement, f.focusable("tab:a"));
  f.key(f.doc.activeElement, "ArrowUp");
  assert.equal(f.doc.activeElement, f.byClass("zest-tabbar-library"));
  f.key(f.doc.activeElement, "End");
  assert.equal(f.doc.activeElement, f.focusable("tab:c"));
  assert.equal(
    f.key(f.doc.activeElement, "Home", { ctrlKey: true }).defaultPrevented,
    undefined,
  );
  assert.equal(f.key(f.doc.activeElement, "Tab").defaultPrevented, undefined);
  assert.equal(f.doc.activeElement, f.focusable("tab:c"));
  assert.equal(f.closeButton("c").tabIndex, 0);
  assert.equal(f.closeButton("b").tabIndex, -1);
  assert.deepEqual(f.selected, []);
});

test("Enter and Space activate once and restore the same document focus after Zotero changes focus", () => {
  for (const key of ["Enter", " "]) {
    const f = fixture();
    f.focusable("tab:a").focus();
    f.key(f.doc.activeElement, key);
    assert.deepEqual(f.selected, ["a"]);
    assert.equal(f.doc.activeElement, f.focusable("tab:a"));
    assert.equal(f.doc.activeElement.getAttribute("aria-current"), "page");
  }
});

test("activation suppresses Zotero's delayed reader focus through its native keyboard option", () => {
  const f = fixture({ asyncNativeFocus: true });
  f.focusable("tab:a").focus();
  f.key(f.doc.activeElement, "Enter");
  assert.deepEqual(f.selectOptions, [{ id: "a", keepTabFocused: true }]);
  assert.equal(f.nativeFocusJobs.length, 0);
  f.drainNativeFocus();
  f.drain();
  assert.equal(f.doc.activeElement, f.focusable("tab:a"));
  // A later deliberate focus move is not undone by an ownership timer.
  f.external.focus();
  f.drainNativeFocus();
  f.drain();
  assert.equal(f.doc.activeElement, f.external);
});

test("closing the current reader suppresses deferred native focus for each adjacent target and Library", () => {
  const f = fixture({ asyncNativeFocus: true });
  for (const [id, expected] of [
    ["b", "c"],
    ["c", "a"],
    ["a", null],
  ]) {
    f.closeButton(id).focus();
    f.key(f.doc.activeElement, "Enter");
    assert.equal(f.nativeFocusJobs.length, 0);
    f.drainNativeFocus();
    f.drain();
    assert.equal(
      f.doc.activeElement,
      expected
        ? f.focusable(`tab:${expected}`)
        : f.byClass("zest-tabbar-library"),
    );
  }
  assert.deepEqual(f.selectOptions, [
    { id: "c", keepTabFocused: true },
    { id: "a", keepTabFocused: true },
    { id: "native-library", keepTabFocused: true },
  ]);
});

test("close retains Zotero's previous-selection jump-back preference before adjacent tabs", () => {
  const f = fixture({ asyncNativeFocus: true });
  f.win.Zotero_Tabs._prevSelectedID = "a";
  f.closeButton("b").focus();
  f.key(f.doc.activeElement, "Enter");
  assert.equal(f.win.Zotero_Tabs.selectedID, "a");
  assert.deepEqual(f.selectOptions, [{ id: "a", keepTabFocused: true }]);
  assert.equal(f.nativeFocusJobs.length, 0);
  assert.equal(f.doc.activeElement, f.focusable("tab:c"));
});

test("group keys expose expanded state and retain focus across collapse, expand and member navigation", () => {
  const f = fixture({ grouped: true });
  f.focusable("group:research").focus();
  f.key(f.doc.activeElement, " ");
  assert.equal(f.focusable("tab:a"), undefined);
  assert.equal(f.doc.activeElement, f.focusable("group:research"));
  assert.equal(f.doc.activeElement.getAttribute("aria-expanded"), "false");
  f.key(f.doc.activeElement, "ArrowRight");
  assert.equal(f.doc.activeElement.getAttribute("aria-expanded"), "true");
  f.key(f.doc.activeElement, "ArrowRight");
  assert.equal(f.doc.activeElement, f.focusable("tab:a"));
  f.key(f.doc.activeElement, "ArrowLeft");
  assert.equal(f.doc.activeElement, f.focusable("group:research"));
  f.key(f.doc.activeElement, "Enter");
  assert.equal(f.doc.activeElement.getAttribute("aria-expanded"), "false");
  assert.deepEqual(f.selected, []);
});

test("repaints preserve the stable document and close-control focus without stealing external focus", () => {
  const f = fixture();
  f.closeButton("b").focus();
  f.win.Zotero_Tabs._tabs[2].title = "Renamed";
  f.sidebar.renderList(f.win);
  assert.equal(f.doc.activeElement, f.closeButton("b"));
  assert.equal(f.focusable("tab:b").textContent, "Renamed");
  f.external.focus();
  f.sidebar.renderList(f.win);
  assert.equal(f.doc.activeElement, f.external);
});

test("keyboard closing chooses the adjacent document and falls back to Library after the last document", () => {
  const f = fixture();
  f.closeButton("b").focus();
  f.key(f.doc.activeElement, "Enter");
  assert.deepEqual(f.closed, ["b"]);
  assert.deepEqual(f.selected, ["c"]);
  assert.equal(f.doc.activeElement, f.focusable("tab:c"));
  f.closeButton("c").focus();
  f.key(f.doc.activeElement, " ");
  assert.equal(f.doc.activeElement, f.focusable("tab:a"));
  f.closeButton("a").focus();
  f.key(f.doc.activeElement, "Enter");
  assert.equal(f.doc.activeElement, f.byClass("zest-tabbar-library"));
  f.drain();
  assert.equal(f.doc.activeElement, f.byClass("zest-tabbar-library"));
});

test("drag reordering keeps its stable document focus and preserves native move coordinates", () => {
  const f = fixture();
  f.focusable("tab:a").focus();
  f.focusable("tab:c").parentElement.dispatch("drop", {
    dataTransfer: { getData: () => "a" },
  });
  assert.deepEqual(f.moved, [{ id: "a", index: 4 }]);
  assert.deepEqual(
    f.win.Zotero_Tabs._tabs.map((tab) => tab.id),
    ["native-library", "b", "c", "a"],
  );
  assert.equal(f.doc.activeElement, f.focusable("tab:a"));
  assert.equal(f.focusable("tab:a").parentElement.draggable, true);
});

test("collapsing a focused member's group restores focus to that group", () => {
  const f = fixture({ grouped: true });
  f.focusable("tab:b").focus();
  f.group.collapsed = true;
  f.sidebar.renderList(f.win);
  assert.equal(f.doc.activeElement, f.focusable("group:research"));
});

test("context-menu batch close restores the kept document after the native popup takes focus", () => {
  const f = fixture();
  f.focusable("tab:b").parentElement.dispatch("contextmenu");
  assert.equal(f.doc.activeElement.tagName, "menupopup");
  const command = f
    .walk()
    .find((node) => node.getAttribute("label") === "tabs-close-others");
  command.dispatch("command");
  assert.deepEqual(f.closed, ["a", "c"]);
  assert.equal(f.doc.activeElement, f.focusable("tab:b"));
  assert.deepEqual(f.logs, []);
});

test("moving a document into a collapsed group restores that group's focus", () => {
  const f = fixture({ grouped: true });
  f.group.collapsed = true;
  f.sidebar.renderList(f.win);
  f.focusable("tab:c").parentElement.dispatch("contextmenu");
  const command = f
    .walk()
    .find((node) => node.getAttribute("label") === "Research");
  command.dispatch("command");
  assert.equal(f.focusable("tab:c"), undefined);
  assert.equal(f.doc.activeElement, f.focusable("group:research"));
  assert.equal(f.doc.activeElement.getAttribute("aria-expanded"), "false");
  assert.deepEqual(f.logs, []);
});

test("teardown cancels refresh work, restores native tabs and makes retained buttons inert", () => {
  const f = fixture();
  const oldButton = f.focusable("tab:a");
  const oldClose = f.closeButton("a");
  const oldLibrary = f.byClass("zest-tabbar-library");
  for (const observer of f.observers) observer.notify();
  assert.equal(f.jobs.size, 1);
  f.sidebar.uninstallSidebars();
  assert.equal(f.jobs.size, 0);
  assert.equal(f.observers.size, 0);
  assert.equal(f.disconnected(), 1);
  assert.equal(f.byClass("zest-tabbar"), undefined);
  assert.equal(
    f.doc.documentElement.classList.contains("zest-hide-native-tabs"),
    false,
  );
  oldButton.click();
  oldClose.click();
  oldLibrary.click();
  f.key(oldButton, "Enter");
  assert.deepEqual(f.selected, []);
  assert.deepEqual(f.closed, []);
  assert.deepEqual(f.logs, []);
});
