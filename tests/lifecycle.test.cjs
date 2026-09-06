const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers.cjs");

function documentFixture() {
  let doc;
  class Element {
    constructor(tag) {
      this.tagName = tag;
      this.ownerDocument = doc;
      this.children = [];
      this.parentElement = null;
      this.attributes = new Map();
      this.listeners = new Map();
      this.hidden = false;
      const properties = new Map();
      this.style = {
        setProperty: (name, value, priority = "") =>
          properties.set(name, { value, priority }),
        getPropertyValue: (name) => properties.get(name)?.value || "",
        getPropertyPriority: (name) => properties.get(name)?.priority || "",
        removeProperty: (name) => properties.delete(name),
      };
      const classes = () => new Set((this.className || "").split(/\s+/));
      this.classList = {
        contains: (name) => classes().has(name),
        add: (...names) => {
          this.className = [...new Set([...classes(), ...names])].join(" ");
        },
        remove: (name) => {
          this.className = [...classes()].filter((x) => x !== name).join(" ");
        },
        toggle: (name, on) => {
          if (on ?? !classes().has(name)) this.classList.add(name);
          else this.classList.remove(name);
        },
      };
    }
    appendChild(child) {
      child.remove();
      this.children.push(child);
      child.parentElement = this;
      return child;
    }
    insertBefore(child, next) {
      child.remove();
      this.children.splice(this.children.indexOf(next), 0, child);
      child.parentElement = this;
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
      this.attributes.set(name, value);
    }
    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    }
    addEventListener(name, fn) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      this.listeners.get(name).add(fn);
    }
    removeEventListener(name, fn) {
      this.listeners.get(name)?.delete(fn);
    }
    querySelectorAll(selector) {
      const match = (node) =>
        selector.startsWith("#")
          ? node.id === selector.slice(1)
          : selector
              .split(".")
              .filter(Boolean)
              .every((c) => node.classList.contains(c));
      const found = [];
      const walk = (node) => {
        for (const child of node.children) {
          if (match(child)) found.push(child);
          walk(child);
        }
      };
      walk(this);
      return found;
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }
    get firstChild() {
      return this.children[0];
    }
    get isConnected() {
      return this === doc.documentElement || !!this.parentElement?.isConnected;
    }
  }
  doc = {
    createElement: (tag) => new Element(tag),
    createXULElement: (tag) => new Element(tag),
    getElementById: (id) => doc.documentElement.querySelector(`#${id}`),
    querySelectorAll: (selector) =>
      doc.documentElement.querySelectorAll(selector),
    addEventListener: (name, fn) =>
      doc.documentElement.addEventListener(name, fn),
    removeEventListener: (name, fn) =>
      doc.documentElement.removeEventListener(name, fn),
  };
  doc.documentElement = new Element("window");
  const win = {
    document: doc,
    setTimeout() {},
    addEventListener() {},
    removeEventListener() {},
  };
  doc.defaultView = win;
  return win;
}

function clockFixture() {
  let id = 0;
  const tasks = new Map();
  return {
    setTimeout(fn, ms) {
      tasks.set(++id, { fn, ms });
      return id;
    },
    clearTimeout(id) {
      tasks.delete(id);
    },
    run(ms) {
      for (const [id, task] of [...tasks]) {
        if (task.ms === ms) {
          tasks.delete(id);
          task.fn();
        }
      }
    },
  };
}

function baseHarness(Zotero, prefs = {}, clock = clockFixture(), mocks = {}) {
  return createHarness({
    globals: { Zotero },
    mocks: {
      "src/utils/prefs.ts": {
        getPref: (name) => prefs[name],
        getNumPref: (name, fallback) => prefs[name] ?? fallback,
        setPref: (name, value) => {
          prefs[name] = value;
        },
      },
      "src/utils/timers.ts": clock,
      "src/utils/locale.ts": { getString: (key) => key },
      "src/utils/guard.ts": { guard: (_name, fn) => fn },
      "src/ui/icons.ts": { iconButton: (doc) => doc.createElement("button") },
      ...mocks,
    },
  });
}

function hostFixture() {
  let id = 0;
  return {
    Notifier: {
      registerObserver: () => `observer${++id}`,
      unregisterObserver() {},
    },
    Promise: { delay: async () => {} },
  };
}

test("overlapping plugin copies keep the new stylesheet, accent and root flags", () => {
  const win = documentFixture();
  const Zotero = { getMainWindows: () => [win] };
  const root = win.document.documentElement;
  root.style.setProperty("--zest-accent", "#123456", "important");
  const old = baseHarness(Zotero, { "ui.accent": "#111111" }).load(
    "src/ui/styles.ts",
  );
  const fresh = baseHarness(Zotero, { "ui.accent": "#222222" }).load(
    "src/ui/styles.ts",
  );
  old.registerStyles(win);
  old.applyRootFlags(win, true);
  fresh.registerStyles(win);
  fresh.applyRootFlags(win, true);
  const node = win.document.getElementById("zest-styles");
  old.applyRootFlags(win, false);
  old.syncAccent();
  old.registerStyles(win);
  old.unregisterStyles(win);
  assert.equal(win.document.getElementById("zest-styles"), node);
  assert.equal(root.style.getPropertyValue("--zest-accent"), "#222222");
  assert.equal(root.classList.contains("zest-hide-title-swatches"), true);
  fresh.unregisterStyles(win);
  assert.equal(win.document.getElementById("zest-styles"), null);
  assert.equal(root.style.getPropertyValue("--zest-accent"), "#123456");
  assert.equal(root.style.getPropertyPriority("--zest-accent"), "important");
  assert.equal(root.classList.contains("zest-hide-title-swatches"), false);
});

test("upgrading from legacy styles does not restore retired accent and root flags", () => {
  const win = documentFixture();
  const root = win.document.documentElement;
  const legacy = win.document.createElement("style");
  legacy.id = "zest-styles";
  root.appendChild(legacy);
  root.style.setProperty("--zest-accent", "#111111");
  root.classList.add("zest-hide-title-swatches");
  const fresh = baseHarness({}, { "ui.accent": "#222222" }).load(
    "src/ui/styles.ts",
  );
  fresh.registerStyles(win);
  fresh.applyRootFlags(win, true);
  // 1.0.10 does not know ownership: its teardown deletes shared state.
  win.document.getElementById("zest-styles").remove();
  root.style.removeProperty("--zest-accent");
  root.classList.remove("zest-hide-title-swatches");
  // The current copy's plugin-shutdown observer restores its live UI.
  fresh.registerStyles(win);
  fresh.applyRootFlags(win, true);
  assert.equal(root.style.getPropertyValue("--zest-accent"), "#222222");
  assert.equal(root.classList.contains("zest-hide-title-swatches"), true);
  fresh.unregisterStyles(win);
  assert.equal(root.style.getPropertyValue("--zest-accent"), "");
  assert.equal(root.classList.contains("zest-hide-title-swatches"), false);
});

test("legacy tag and tab replacements restore visible native UI after the new copy closes", () => {
  const win = documentFixture();
  const doc = win.document;
  const root = doc.documentElement;
  const container = doc.createElement("div");
  container.id = "zotero-tag-selector-container";
  const native = doc.createElement("div");
  native.id = "zotero-tag-selector";
  native.hidden = true;
  const oldTree = doc.createElement("div");
  oldTree.id = "zest-tag-tree";
  container.appendChild(oldTree);
  container.appendChild(native);
  root.appendChild(container);
  const deck = doc.createElement("div");
  deck.id = "tabs-deck";
  const oldBar = doc.createElement("div");
  oldBar.id = "zest-tabbar";
  root.appendChild(oldBar);
  root.appendChild(deck);
  root.classList.add("zest-hide-native-tabs");
  win.Zotero_Tabs = {
    deck,
    _tabs: [],
    add() {},
    close() {},
    move() {},
    select() {},
  };
  const Zotero = hostFixture();
  const prefs = { "nestedTags.show": true, "tabs.hideNative": true };
  const h = baseHarness(Zotero, prefs, clockFixture(), {
    "src/tags/scope.ts": { clearTagCache() {} },
    "src/tags/tree.ts": { LINK_SYMBOLS: ["/"] },
    "src/tags/rules.ts": {},
    "src/tags/match.ts": {},
    "src/tags/menu.ts": {},
    "src/views/itemFilter.ts": { setItemFilter() {} },
    "src/tabs/model.ts": { groups: () => [], pruneGroups() {} },
    "src/utils/items.ts": {},
  });
  const tags = h.load("src/tags/nestedTree.ts");
  const tabs = h.load("src/tabs/sidebar.ts");
  tags.installTagTree(win);
  tabs.showSidebar(win);
  native.hidden = false;
  root.classList.remove("zest-hide-native-tabs");
  tags.syncTagPanes();
  tabs.syncNativeBarVisibility();
  assert.equal(native.hidden, true);
  assert.equal(root.classList.contains("zest-hide-native-tabs"), true);
  tags.uninstallTagTree(win);
  tabs.hideSidebar(win, false);
  assert.equal(native.hidden, false);
  assert.equal(root.classList.contains("zest-hide-native-tabs"), false);
});

test("outgoing tag tree cannot unhide the native selector owned by the new copy", () => {
  const win = documentFixture();
  const doc = win.document;
  const container = doc.createElement("div");
  container.id = "zotero-tag-selector-container";
  const native = doc.createElement("div");
  native.id = "zotero-tag-selector";
  container.appendChild(native);
  doc.documentElement.appendChild(container);
  const Zotero = hostFixture();
  const prefs = { "nestedTags.show": true, "nestedTags.pane": "tree" };
  const mocks = {
    "src/tags/scope.ts": { clearTagCache() {} },
    "src/tags/tree.ts": { LINK_SYMBOLS: ["/"] },
    "src/tags/rules.ts": {},
    "src/tags/match.ts": {},
    "src/tags/menu.ts": {},
    "src/views/itemFilter.ts": { setItemFilter() {} },
  };
  const old = baseHarness(Zotero, prefs, clockFixture(), mocks).load(
    "src/tags/nestedTree.ts",
  );
  const fresh = baseHarness(Zotero, prefs, clockFixture(), mocks).load(
    "src/tags/nestedTree.ts",
  );
  old.installTagTree(win);
  fresh.installTagTree(win);
  const node = doc.getElementById("zest-tag-tree");
  old.uninstallTagTree(win);
  assert.equal(native.hidden, true);
  assert.equal(doc.getElementById("zest-tag-tree"), node);
  fresh.uninstallTagTree(win);
  assert.equal(native.hidden, false);
});

test("sidebar takeover keeps native tabs hidden and leaves only one splitter", () => {
  const win = documentFixture();
  const doc = win.document;
  const deck = doc.createElement("div");
  deck.id = "tabs-deck";
  doc.documentElement.appendChild(deck);
  win.Zotero_Tabs = {
    deck,
    _tabs: [],
    add() {},
    close() {},
    move() {},
    select() {},
  };
  const Zotero = hostFixture();
  const prefs = { "tabs.hideNative": true };
  const mocks = {
    "src/tabs/model.ts": { groups: () => [], pruneGroups() {} },
    "src/utils/items.ts": {},
  };
  const old = baseHarness(Zotero, prefs, clockFixture(), mocks).load(
    "src/tabs/sidebar.ts",
  );
  const fresh = baseHarness(Zotero, prefs, clockFixture(), mocks).load(
    "src/tabs/sidebar.ts",
  );
  old.showSidebar(win);
  fresh.showSidebar(win);
  const node = doc.getElementById("zest-tabbar");
  old.hideSidebar(win, false);
  assert.equal(
    doc.documentElement.classList.contains("zest-hide-native-tabs"),
    true,
  );
  assert.equal(doc.getElementById("zest-tabbar"), node);
  assert.equal(doc.querySelectorAll(".zest-tabbar-splitter").length, 1);
  fresh.hideSidebar(win, false);
  assert.equal(
    doc.documentElement.classList.contains("zest-hide-native-tabs"),
    false,
  );
  assert.equal(doc.querySelectorAll(".zest-tabbar-splitter").length, 0);
});

async function settle() {
  for (let i = 0; i < 15; i++) await Promise.resolve();
}

test("retired count renderers and delayed cleanup preserve newer badges", async () => {
  const win = documentFixture();
  const row = win.document.createElement("div");
  const cell = win.document.createElement("div");
  cell.className = "cell primary";
  row.appendChild(cell);
  win.document.documentElement.appendChild(row);
  const tree = {
    renderItem: () => row,
    getRow: () => ({ isCollection: () => true, ref: { id: 1 } }),
  };
  win.ZoteroPane = { collectionsView: tree };
  const Zotero = {
    ...hostFixture(),
    Libraries: { getAll: () => [{ libraryID: 1 }] },
    Collections: {
      getByLibrary: () => [{ id: 1, getChildItems: () => [1, 2] }],
    },
  };
  const clock = clockFixture();
  const prefs = { "collectionCounts.enable": true };
  const old = baseHarness(Zotero, prefs, clock).load(
    "src/views/collectionCounts.ts",
  );
  const fresh = baseHarness(Zotero, prefs, clock).load(
    "src/views/collectionCounts.ts",
  );
  old.installCollectionCounts(win);
  clock.run(1500);
  await settle();
  tree.renderItem(0);
  const oldRenderer = tree.renderItem;
  fresh.installCollectionCounts(win);
  clock.run(1500);
  await settle();
  tree.renderItem(0);
  const badge = cell.querySelector(".zest-count");
  assert.equal(badge.textContent, "2");
  // A callback queued before takeover may run while both copies are alive.
  oldRenderer(0);
  old.uninstallCollectionCounts(win);
  clock.run(600);
  assert.equal(cell.querySelector(".zest-count"), badge);
  // A rapid toggle in the SAME copy must also invalidate its old sweep.
  fresh.uninstallCollectionCounts(win);
  fresh.installCollectionCounts(win);
  clock.run(1500);
  await settle();
  tree.renderItem(0);
  const newBadge = cell.querySelector(".zest-count");
  clock.run(600);
  assert.equal(cell.querySelector(".zest-count"), newBadge);
  const retired = tree.renderItem;
  fresh.uninstallCollectionCounts(win);
  retired(0);
  assert.equal(cell.querySelector(".zest-count"), null);
});

test("outgoing copy removes only its own tag and column menu nodes", () => {
  for (const type of ["tags", "views"]) {
    const win = documentFixture();
    const popup = win.document.createElement("menupopup");
    popup.id =
      type === "tags"
        ? "tag-selector-view-settings-menu"
        : "zotero-column-picker";
    win.document.documentElement.appendChild(popup);
    const Zotero = hostFixture();
    const mocks = {
      "src/tags/scope.ts": {},
      "src/tags/tree.ts": {},
      "src/tags/rules.ts": {},
      "src/tags/match.ts": {},
      "src/tags/menu.ts": {},
      "src/views/itemFilter.ts": {},
      "src/core/config.ts": { zestConfig: { get: () => ({ viewGroups: [] }) } },
      "src/columns/registry.ts": {},
    };
    const path =
      type === "tags" ? "src/tags/nestedTree.ts" : "src/views/viewGroups.ts";
    const install =
      type === "tags" ? "installTagOptionsMenu" : "installViewMenu";
    const uninstall =
      type === "tags" ? "uninstallTagOptionsMenu" : "uninstallViewMenu";
    const id = type === "tags" ? "zest-tagtree-toggle" : "zest-views-menu";
    const old = baseHarness(Zotero, {}, clockFixture(), mocks).load(path);
    const fresh = baseHarness(Zotero, {}, clockFixture(), mocks).load(path);
    old[install](win);
    for (const fn of win.document.documentElement.listeners.get("popupshowing"))
      fn({ target: popup });
    fresh[install](win);
    for (const fn of win.document.documentElement.listeners.get("popupshowing"))
      fn({ target: popup });
    const current = win.document.getElementById(id);
    assert.ok(current);
    old[uninstall](win);
    assert.equal(win.document.getElementById(id), current);
    fresh[uninstall](win);
    assert.equal(win.document.getElementById(id), null);
  }
});

function layoutWindow(width) {
  let columns = [{ dataKey: "title", width, hidden: false, ordinal: 0 }];
  let prefs = {};
  return {
    ZoteroPane: {
      itemsView: {
        tree: { _columns: { getAsArray: () => columns }, invalidate() {} },
        _getColumnPrefs: () => prefs,
        _storeColumnPrefs: (next) => {
          prefs = next;
        },
        _resetColumns: async () => {
          columns = columns.map((c) => ({ ...c, ...prefs[c.dataKey] }));
        },
        getSortField: () => "title",
        getSortDirection: () => 1,
      },
    },
  };
}

test("each window restores its own previous column layout", async () => {
  const h = baseHarness({}, {}, clockFixture(), {
    "src/core/config.ts": { newId: () => "view", zestConfig: {} },
    "src/columns/registry.ts": {},
  });
  const views = h.load("src/views/viewGroups.ts");
  const a = layoutWindow(120),
    b = layoutWindow(240);
  const view = {
    id: "next",
    name: "next",
    columns: [{ dataKey: "title", width: 400 }],
  };
  await views.applyView(a, view);
  assert.equal(views.hasPreviousLayout(b), false);
  await views.applyView(b, view);
  await views.restorePreviousLayout(a);
  await views.restorePreviousLayout(b);
  assert.equal(views.captureView(a, "A").columns[0].width, 120);
  assert.equal(views.captureView(b, "B").columns[0].width, 240);
});

test("Show in Library clears author state and watchers only in the target window", async () => {
  const win = documentFixture(),
    other = documentFixture();
  const listeners = new Set();
  const items = [1, 2].map((id) => ({ id, isRegularItem: () => true }));
  class CollectionTreeRow {
    async getItems() {
      return items;
    }
  }
  const row = new CollectionTreeRow();
  row.view = { _ownerDocument: win.document };
  let visible = [];
  let calls = 0;
  const nativeSearch = { query: "unchanged" };
  win.ZoteroPane = {
    nativeSearch,
    getSelectedLibraryIDs: () => [1],
    collectionsView: {
      selectLibrary: async () => {},
      onSelect: {
        addListener: (fn) => listeners.add(fn),
        removeListener: (fn) => listeners.delete(fn),
      },
    },
    itemsView: {
      refreshAndMaintainSelection: async () => {
        visible = await row.getItems();
      },
      getRowIndexByID: (id) =>
        visible.some((item) => item.id === id) ? 0 : false,
    },
    async selectItems(ids) {
      calls++;
      await this.itemsView.refreshAndMaintainSelection();
      return ids.every((id) => this.itemsView.getRowIndexByID(id) !== false);
    },
  };
  const Zotero = {
    ...hostFixture(),
    CollectionTreeRow,
    Items: { getAll: async () => items },
    Libraries: { userLibraryID: 1 },
  };
  const h = baseHarness(Zotero, {}, clockFixture(), {
    "src/graph/authorIdentity.ts": {
      buildAuthorResolverAsync: async () => ({
        memberItemIDs: () => new Set([1]),
      }),
    },
    "src/tags/nestedTree.ts": { clearSelection() {} },
  });
  const authors = h.load("src/authors/authorMenu.ts");
  const filters = h.load("src/views/itemFilter.ts");
  const reveal = h.load("src/views/reveal.ts");
  await authors.applyAuthorFilter(win, { label: "Author" });
  filters.setItemFilter(other, "author", () => []);
  assert.equal(listeners.size, 1);
  reveal.installRevealGuard(win);
  assert.equal(await win.ZoteroPane.selectItems([2]), true);
  assert.equal(calls, 2);
  assert.equal(listeners.size, 0);
  assert.equal(filters.activeItemFilters(win).length, 0);
  assert.deepEqual(Array.from(filters.activeItemFilters(other)), ["author"]);
  assert.equal(win.ZoteroPane.nativeSearch, nativeSearch);
  filters.clearItemFilters();
  reveal.uninstallAllRevealGuards();
});
