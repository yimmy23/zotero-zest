const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers.cjs");
const { events, windowFixture, PANEL_URL } = require("./dialog-fixture.cjs");

function item(
  id,
  { type = "regular", deleted = false, relatedItems = [] } = {},
) {
  return {
    id,
    key: `ITEM${id}`,
    libraryID: 1,
    deleted,
    relatedItems,
    isRegularItem: () => type === "regular",
    isAttachment: () => type === "attachment",
  };
}

function ownerWindow({ reader = false, observer = true } = {}) {
  const win = windowFixture({
    url: "chrome://zotero/content/zoteroPane.xhtml",
  });
  const doc = win.document;
  events(doc);
  doc.hidden = false;
  const create = doc.createElement;
  const frames = [];
  const decorate = (node) => {
    node.replaceChildren = (...children) => {
      node.textContent = "";
      node.append(...children);
    };
    node.closest = (selector) => {
      for (let parent = node; parent; parent = parent.parentElement)
        if (parent.matches(selector)) return parent;
      return null;
    };
    node.rect = { width: 340, height: 550 };
    node.getBoundingClientRect = () => node.rect;
    if (node.tagName === "iframe") {
      const addListener = node.addEventListener;
      const removeListener = node.removeEventListener;
      const capture = (options) =>
        typeof options === "boolean" ? options : !!options?.capture;
      node.removedListeners = [];
      node.addEventListener = (type, callback, options) => {
        addListener(type, callback, {
          ...(typeof options === "object" ? options : {}),
          capture: capture(options),
        });
      };
      node.removeEventListener = (type, callback, options) => {
        const registered = node.listeners.get(type)?.get(callback);
        const useCapture = capture(options);
        node.removedListeners.push({ type, callback, capture: useCapture });
        // DOM removal must match the original registration's event phase.
        if (registered?.capture === useCapture) removeListener(type, callback);
      };
      node.contentWindow = windowFixture({
        url: "about:blank",
        readyState: "loading",
      });
      node.contentWindow.frameElement = node;
      node.finishLoad = () => {
        node.contentWindow.finishLoad();
        // Chrome iframe document loads reach this element during capture only.
        for (const [callback, options] of node.listeners.get("load") || []) {
          if (!options.capture) continue;
          callback({
            type: "load",
            target: node.contentWindow.document,
            currentTarget: node,
            eventPhase: 1,
          });
          if (options.once) node.removeEventListener("load", callback, true);
        }
      };
      frames.push(node);
    }
    return node;
  };
  doc.createElement = (tag) => decorate(create(tag));
  doc.createElementNS = (_namespace, tag) => doc.createElement(tag);
  const observers = [];
  if (observer) {
    win.IntersectionObserver = class {
      constructor(callback) {
        this.callback = callback;
        this.disconnected = false;
        observers.push(this);
      }
      observe(target) {
        this.target = target;
      }
      disconnect() {
        this.disconnected = true;
      }
      intersect(isIntersecting) {
        this.callback([{ target: this.target, isIntersecting }]);
      }
    };
  }
  win.framesCreated = frames;
  win.observers = observers;
  if (!reader) {
    win.view = [item(900)];
    win.selection = [item(901)];
    win.viewReads = 0;
    win.selectionReads = 0;
    win.ZoteroPane = {
      itemsView: {
        getSortedItems: () => {
          win.viewReads++;
          return win.view;
        },
      },
      getSelectedItems: () => {
        win.selectionReads++;
        return win.selection;
      },
    };
  }
  return win;
}

function setup({ managerAvailable = true, prefs = {} } = {}) {
  const registrations = [];
  const removed = [];
  const mounted = [];
  const popouts = [];
  const logs = [];
  const themes = [];
  const knownItems = new Map();
  let failNextMount = false;
  const manager = {
    registerSection(options) {
      registrations.push(options);
      return `registered-${options.paneID}`;
    },
    unregisterSection(id) {
      removed.push(id);
    },
  };
  function controller(kind, win, host, source) {
    if (failNextMount) {
      failNextMount = false;
      throw new Error("Simulated iframe mount failure");
    }
    const state = {
      kind,
      win,
      host,
      source,
      active: true,
      dirty: false,
      disposed: false,
      actions: [],
      snapshots: [],
      read() {
        if (source)
          state.snapshots.push(
            kind === "matrix" ? source.getItems("selected") : source(),
          );
      },
      refresh() {
        state.actions.push("refresh");
        if (state.active) state.read();
        else state.dirty = true;
      },
      setActive(value) {
        state.actions.push(`active:${value}`);
        state.active = value;
        if (value && state.dirty) {
          state.dirty = false;
          state.read();
        }
      },
      dispose() {
        state.actions.push("dispose");
        state.disposed = true;
        state.active = false;
      },
    };
    mounted.push(state);
    state.read();
    return state;
  }
  const harness = createHarness({
    mocks: {
      "src/utils/locale.ts": {
        getString: (id) => id,
        getLocaleID: (id) => `zest-${id}`,
      },
      "src/utils/prefs.ts": { getPref: (key) => prefs[key] },
      "src/ui/dialogTheme.ts": {
        bindSidebarTheme(win, body) {
          const theme = {
            win,
            body,
            active: true,
            disposed: false,
            setActive(active) {
              theme.active = active;
            },
            dispose() {
              theme.disposed = true;
            },
          };
          themes.push(theme);
          return theme;
        },
      },
      "src/panes/annotMatrix.ts": {
        mountMatrix: (win, host, source) =>
          controller("matrix", win, host, source),
        openMatrix: (host, source) =>
          popouts.push({ kind: "matrix", host, source }),
      },
      "src/panes/statsDialog.ts": {
        mountStats: (win, onOpenDetails) => {
          const state = controller("stats", win);
          state.onOpenDetails = onOpenDetails;
          return state;
        },
        openStatsDialog: (host) => popouts.push({ kind: "stats", host }),
      },
      "src/graph/pane.ts": {
        showGraphPane: (host) => popouts.push({ kind: "graph", host }),
      },
      "src/panes/sidebarGraph.ts": {
        mountSidebarGraph: (body, source) =>
          controller("graph", body.ownerDocument.defaultView, body, source),
      },
    },
    globals: {
      Zotero: {
        ItemPaneManager: managerAvailable ? manager : undefined,
        Items: {
          getByLibraryAndKey: (libraryID, key) =>
            knownItems.get(`${libraryID}/${key}`),
        },
        logError: (error) => logs.push(error),
      },
      ztoolkit: { log: (...values) => logs.push(values) },
    },
  });
  const api = harness.load("src/panes/sidebarSections.ts");
  api.registerSidebarSections();
  function panel(
    kind,
    win = ownerWindow(),
    current = item(1),
    tabType = "library",
  ) {
    const definition = registrations.find(
      (entry) => entry.paneID === `workspace-${kind}`,
    );
    assert.ok(definition, `Missing ${kind} section registration`);
    const section = win.document.createElement("collapsible-section");
    section.open = true;
    const body = win.document.createElement("div");
    section.append(body);
    win.document.body.append(section);
    const enabled = [];
    const buttonStatus = [];
    const props = {
      body,
      doc: win.document,
      item: current,
      tabType,
      setEnabled: (value) => enabled.push(value),
      setSectionButtonStatus: (type, value) =>
        buttonStatus.push({ type, ...value }),
    };
    return { definition, section, body, win, props, enabled, buttonStatus };
  }
  function begin(state) {
    state.definition.onInit(state.props);
    state.definition.onItemChange(state.props);
    state.definition.onRender(state.props);
    state.definition.onAsyncRender(state.props);
    return state;
  }
  return {
    ...api,
    registrations,
    removed,
    mounted,
    popouts,
    logs,
    themes,
    prefs,
    knownItems,
    panel,
    begin,
    failMount: () => {
      failNextMount = true;
    },
  };
}

test("registers three independent native sidebar sections with header, navigation and pop-out icons", () => {
  const app = setup();
  assert.equal(app.registrations.length, 3);
  assert.deepEqual(
    app.registrations.map((entry) => entry.paneID),
    ["workspace-stats", "workspace-matrix", "workspace-graph"],
  );
  const icons = ["reading-stats", "matrix", "local-graph"];
  for (let i = 0; i < 3; i++) {
    const entry = app.registrations[i];
    assert.equal(entry.pluginID, "zest@zotero-zest.app");
    assert.equal(
      entry.header.icon,
      `chrome://zest/content/icons/${icons[i]}.svg`,
    );
    assert.equal(
      entry.sidenav.icon,
      `chrome://zest/content/icons/20/${icons[i]}.svg`,
    );
    assert.equal(
      entry.sectionButtons[0].icon,
      "chrome://zest/content/icons/open-window.svg",
    );
    assert.match(
      entry.header.l10nID,
      /^zest-sidebar-(stats|matrix|graph)-header$/,
    );
    assert.match(
      entry.sidenav.l10nID,
      /^zest-sidebar-(stats|matrix|graph)-sidenav$/,
    );
  }
  app.registerSidebarSections();
  assert.equal(app.registrations.length, 3, "registration is idempotent");
  assert.equal(setup({ managerAvailable: false }).registrations.length, 0);
});

test("iframe themes follow sidebar visibility and dispose on failure or removal", () => {
  const app = setup();
  const panel = app.begin(app.panel("matrix"));
  assert.equal(app.themes.length, 0, "an unloaded iframe has no theme work");
  panel.win.framesCreated.at(-1).finishLoad();
  const theme = app.themes[0];
  assert.equal(theme.body, panel.body);
  assert.equal(theme.win, panel.win.framesCreated.at(-1).contentWindow);
  panel.win.observers.at(-1).intersect(false);
  assert.equal(theme.active, false);
  panel.win.observers.at(-1).intersect(true);
  assert.equal(theme.active, true);
  app.prefs["sidebar.matrix"] = false;
  app.registerSidebarSections();
  assert.equal(theme.disposed, true);

  const stats = app.begin(app.panel("stats"));
  app.failMount();
  stats.win.framesCreated.at(-1).finishLoad();
  assert.equal(app.themes.at(-1).disposed, true, "failed mounts detach themes");
});

test("native init and shell render stay lazy; only a visible async render loads the iframe", () => {
  const app = setup();
  const state = app.panel("matrix");
  const { definition, props, win } = state;
  definition.onInit(props);
  definition.onItemChange(props);
  definition.onRender(props);
  win.observers[0].intersect(true);
  assert.equal(win.framesCreated.length, 0);
  assert.equal(app.mounted.length, 0);
  definition.onAsyncRender(props);
  assert.equal(win.framesCreated.length, 1);
  assert.equal(win.framesCreated[0].src, PANEL_URL);
  assert.equal(app.mounted.length, 0, "about:blank must not mount a renderer");
  win.framesCreated[0].dispatch("load");
  assert.equal(app.mounted.length, 0);
  win.framesCreated[0].finishLoad();
  assert.equal(app.mounted.length, 1);
  assert.equal(app.mounted[0].win, win.framesCreated[0].contentWindow);
  assert.equal(app.mounted[0].host, win);
  assert.notEqual(app.mounted[0].win, win);
  win.framesCreated[0].dispatch("load");
  definition.onAsyncRender(props);
  assert.equal(app.mounted.length, 1);
  assert.equal(app.logs.length, 0);
});

test("chrome iframe loads mount during capture and teardown removes the same event phase", () => {
  const app = setup();
  for (const kind of ["matrix", "stats"]) {
    const state = app.begin(app.panel(kind));
    const frame = state.win.framesCreated[0];
    const [listener, options] = [...frame.listeners.get("load")][0];
    assert.equal(options.capture, true);
    frame.removeEventListener("load", listener, false);
    assert.equal(
      frame.listeners.get("load").size,
      1,
      "a bubbling-phase removal cannot remove a capturing listener",
    );
    let bubblingCalls = 0;
    const bubbling = () => {
      bubblingCalls++;
    };
    frame.addEventListener("load", bubbling, false);
    const before = app.mounted.length;
    frame.finishLoad();
    assert.equal(app.mounted.length, before + 1);
    assert.equal(bubblingCalls, 0);
    state.definition.onDestroy(state.props);
    assert.equal(frame.listeners.get("load").has(listener), false);
    const removal = frame.removedListeners.findLast(
      (entry) => entry.callback === listener,
    );
    assert.equal(removal.capture, true);
    assert.equal(
      frame.listeners.get("load").has(bubbling),
      true,
      "teardown must not remove unrelated event listeners",
    );
    frame.finishLoad();
    assert.equal(app.mounted.length, before + 1);
  }
});

test("stats and matrix use isolated iframe documents and preserve native owner content", () => {
  const app = setup();
  const win = ownerWindow();
  const sentinel = win.document.createElement("div");
  sentinel.textContent = "Native Zotero fields";
  win.document.body.append(sentinel);
  const stats = app.begin(app.panel("stats", win));
  const matrix = app.begin(app.panel("matrix", win));
  win.framesCreated.forEach((frame) => frame.finishLoad());
  assert.equal(app.mounted.length, 2);
  assert.notEqual(app.mounted[0].win, app.mounted[1].win);
  for (const mounted of app.mounted) assert.notEqual(mounted.win, win);
  assert.equal(sentinel.parentElement, win.document.body);
  assert.equal(sentinel.textContent, "Native Zotero fields");
  assert.equal(
    stats.body.querySelector(".zest-sidebar-scope").textContent,
    "sidebar-stats-scope",
  );
  assert.equal(matrix.body.querySelector(".zest-sidebar-scope").hidden, true);
  assert.equal(stats.body.querySelector(".zest-sidebar-scope").hidden, true);
  assert.equal(stats.body.querySelector(".zest-sidebar-message").hidden, true);
  assert.equal(matrix.body.querySelector(".zest-sidebar-message").hidden, true);
});

test("sidebar preferences independently unregister and dispose panels in every window", () => {
  const app = setup();
  const first = app.begin(app.panel("stats"));
  const second = app.begin(app.panel("stats"));
  const matrix = app.begin(app.panel("matrix", first.win));
  first.win.framesCreated.forEach((frame) => frame.finishLoad());
  second.win.framesCreated.forEach((frame) => frame.finishLoad());
  const mountedStats = app.mounted.filter((state) => state.kind === "stats");
  const mountedMatrix = app.mounted.find((state) => state.kind === "matrix");
  mountedStats[0].onOpenDetails();
  assert.equal(app.popouts[0].host, first.win);
  assert.equal(app.popouts[0].kind, "stats");
  app.prefs["sidebar.stats"] = false;
  app.registerSidebarSections();
  assert.deepEqual(app.removed, ["registered-workspace-stats"]);
  assert.ok(mountedStats.every((state) => state.disposed));
  assert.equal(first.body.querySelector("iframe"), null);
  assert.equal(second.body.querySelector("iframe"), null);
  assert.equal(mountedMatrix.disposed, false);
  assert.ok(matrix.body.querySelector("iframe"));
  mountedStats[0].onOpenDetails();
  assert.equal(app.popouts.length, 1, "disposed rings cannot open a window");
  app.registerSidebarSections();
  assert.equal(app.removed.length, 1, "repeated sync is idempotent");
  app.prefs["sidebar.stats"] = true;
  app.registerSidebarSections();
  assert.equal(app.registrations.length, 4);
  assert.equal(app.registrations[3].paneID, "workspace-stats");
  assert.equal(mountedMatrix.disposed, false);
});

test("disabled sidebar tools do not register on startup or after an upgrade sweep", () => {
  const app = setup({
    prefs: { "sidebar.stats": false, "sidebar.graph": false },
  });
  assert.deepEqual(
    app.registrations.map((entry) => entry.paneID),
    ["workspace-matrix"],
  );
  app.unregisterSidebarSections();
  app.registerSidebarSections();
  assert.deepEqual(
    app.registrations.map((entry) => entry.paneID),
    ["workspace-matrix", "workspace-matrix"],
  );
  app.prefs["sidebar.matrix"] = false;
  app.registerSidebarSections();
  assert.deepEqual(app.removed, [
    "registered-workspace-matrix",
    "registered-workspace-matrix",
  ]);
});

test("rapid off/on resumes a retained native body even if Zotero skips cached render callbacks", () => {
  const app = setup();
  const panel = app.begin(app.panel("stats"));
  panel.win.framesCreated[0].finishLoad();
  app.prefs["sidebar.stats"] = false;
  app.registerSidebarSections();
  assert.equal(panel.body.children.length, 0);
  app.prefs["sidebar.stats"] = true;
  app.registerSidebarSections();
  const definition = app.registrations.at(-1);
  definition.onItemChange(panel.props);
  panel.win.observers.at(-1).intersect(true);
  assert.ok(panel.body.querySelector("iframe"));
  panel.win.framesCreated.at(-1).finishLoad();
  assert.equal(app.mounted.length, 2);
  assert.equal(app.mounted[0].disposed, true);
  assert.equal(app.mounted[1].active, true);
});

test("first async render restores a never-visible retained body without mounting while hidden", () => {
  for (const kind of ["stats", "matrix", "graph"]) {
    for (const hidden of [false, true]) {
      const app = setup();
      const panel = app.panel(kind);
      // Unlike the generic DOM fixture, an emptied native body has no height.
      panel.body.getBoundingClientRect = () => ({
        width: 340,
        height: panel.body.querySelector(".zest-sidebar-shell") ? 500 : 0,
      });
      panel.definition.onInit(panel.props);
      panel.definition.onItemChange(panel.props);
      panel.definition.onRender(panel.props);
      assert.equal(app.mounted.length, 0);
      assert.equal(panel.win.framesCreated.length, 0);
      app.prefs[`sidebar.${kind}`] = false;
      app.registerSidebarSections();
      app.prefs[`sidebar.${kind}`] = true;
      app.registerSidebarSections();
      const definition = app.registrations.at(-1);
      // Zotero retains the body and its synchronous-render cache, but this
      // off-screen panel has never received an async-render request.
      definition.onItemChange(panel.props);
      assert.equal(panel.body.children.length, 0);
      panel.win.document.hidden = hidden;
      definition.onAsyncRender(panel.props);
      assert.ok(panel.body.querySelector(".zest-sidebar-content"));
      assert.equal(
        panel.body.getAttribute("data-zest-sidebar-requested"),
        "true",
      );
      if (hidden) {
        assert.equal(panel.win.framesCreated.length, 0);
        assert.equal(app.mounted.length, 0);
        assert.equal(panel.win.viewReads, 0);
        panel.win.document.hidden = false;
        panel.win.document.dispatch("visibilitychange");
      }
      panel.win.framesCreated.forEach((frame) => frame.finishLoad());
      assert.equal(app.mounted.length, 1);
      assert.equal(app.mounted[0].kind, kind);
      definition.onAsyncRender(panel.props);
      assert.equal(app.mounted.length, 1, "repeated requests reuse content");
      assert.equal(
        panel.body.querySelectorAll(".zest-sidebar-shell").length,
        1,
      );
      assert.deepEqual(app.logs, []);
      app.unregisterSidebarSections();
    }
  }
});

test("source uses the pane item rather than library selection and forbids hidden reader view reads", () => {
  const app = setup();
  const win = ownerWindow();
  const current = item(12);
  const library = app.sidebarMatrixSource(current, "library", win);
  assert.equal(library.allowViewScope, true);
  assert.equal(library.selectedLabel, "matrix-scope-current");
  assert.equal(library.getItems("selected")[0], current);
  assert.equal(library.getItems("view"), win.view);
  assert.equal(win.viewReads, 1);
  assert.equal(win.selectionReads, 0);
  const reader = app.sidebarMatrixSource(current, "reader", win);
  assert.equal(reader.allowViewScope, false);
  assert.equal(reader.getItems("view")[0], current);
  assert.equal(reader.getItems("selected")[0], current);
  assert.equal(win.viewReads, 1);
  assert.equal(win.selectionReads, 0);
  const closedView = app.sidebarMatrixSource(
    current,
    "reader",
    ownerWindow({ reader: true }),
  );
  assert.equal(closedView.getItems("selected")[0], current);
  assert.equal(
    app.sidebarMatrixSource(undefined, "reader", win).getItems("view").length,
    0,
  );
  win.view = null;
  assert.throws(() => library.getItems("view"), /view unavailable/);
});

test("current-item changes cancel before refreshing and resume against only the new source", () => {
  const app = setup();
  const state = app.begin(app.panel("matrix"));
  state.win.framesCreated[0].finishLoad();
  const mounted = app.mounted[0];
  const initial = state.props.item;
  const next = item(22);
  state.props.item = next;
  mounted.actions.length = 0;
  state.definition.onItemChange(state.props);
  assert.deepEqual(mounted.actions, ["active:false", "refresh", "active:true"]);
  assert.equal(mounted.snapshots[0][0], initial);
  assert.equal(mounted.snapshots.at(-1)[0], next);
  assert.equal(mounted.source.getItems("selected")[0], next);
  assert.equal(state.win.selectionReads, 0);
});

test("a pending iframe load stays cancelled while collapsed and mounts the latest item when reopened", () => {
  const app = setup();
  const state = app.begin(app.panel("matrix"));
  const frame = state.win.framesCreated[0];
  state.section.open = false;
  state.definition.onToggle(state.props);
  state.props.item = item(40);
  state.definition.onItemChange(state.props);
  frame.finishLoad();
  assert.equal(app.mounted.length, 0);
  state.section.open = true;
  state.definition.onToggle(state.props);
  assert.equal(app.mounted.length, 1);
  assert.equal(app.mounted[0].snapshots[0][0], state.props.item);
});

test("visibility, intersection, collapse and unsupported items all suspend existing controllers", () => {
  const app = setup();
  const state = app.begin(app.panel("matrix"));
  state.win.framesCreated[0].finishLoad();
  const mounted = app.mounted[0];
  const observer = state.win.observers[0];
  observer.intersect(false);
  assert.equal(mounted.active, false);
  observer.intersect(true);
  assert.equal(mounted.active, true);
  state.win.document.hidden = true;
  state.win.document.dispatch("visibilitychange");
  assert.equal(mounted.active, false);
  state.win.document.hidden = false;
  state.win.document.dispatch("visibilitychange");
  assert.equal(mounted.active, true);
  state.section.open = false;
  state.definition.onToggle(state.props);
  assert.equal(mounted.active, false);
  state.section.open = true;
  state.definition.onToggle(state.props);
  assert.equal(mounted.active, true);
  for (const unsupported of [
    undefined,
    item(1, { deleted: true }),
    item(2, { type: "note" }),
  ]) {
    state.props.item = unsupported;
    state.definition.onItemChange(state.props);
    assert.equal(mounted.active, false);
    assert.equal(state.enabled.at(-1), false);
  }
  state.props.item = item(3, { type: "attachment" });
  state.definition.onItemChange(state.props);
  assert.equal(mounted.active, true);
  assert.equal(state.enabled.at(-1), true);
});

test("off-screen async render does no mounting and works without IntersectionObserver", () => {
  const app = setup();
  const win = ownerWindow({ observer: false });
  const state = app.panel("stats", win);
  state.body.rect = { width: 0, height: 0 };
  app.begin(state);
  assert.equal(win.framesCreated.length, 0);
  state.body.rect = { width: 340, height: 500 };
  state.definition.onAsyncRender(state.props);
  assert.equal(win.framesCreated.length, 1);
  win.framesCreated[0].finishLoad();
  assert.equal(app.mounted[0].kind, "stats");
});

test("reader graph includes the current paper and its valid relations without inspecting the library", () => {
  const app = setup();
  const current = item(5, {
    relatedItems: ["ITEM6", "ITEM6", "ITEM7", "ITEM8", "MISSING"],
  });
  const related = item(6);
  app.knownItems.set("1/ITEM6", related);
  app.knownItems.set("1/ITEM7", item(7, { deleted: true }));
  app.knownItems.set("1/ITEM8", item(8, { type: "attachment" }));
  const state = app.begin(app.panel("graph", ownerWindow(), current, "reader"));
  assert.equal(state.win.framesCreated.length, 0);
  assert.equal(app.mounted.length, 1);
  const source = app.mounted[0].snapshots[0];
  assert.deepEqual(
    Array.from(source.items, (value) => value.id),
    [5, 6],
  );
  assert.equal(source.itemID, current.id);
  assert.equal(source.host, state.win);
  assert.equal(state.win.viewReads, 0);
  assert.equal(state.win.selectionReads, 0);
  assert.equal(
    state.body.querySelector(".zest-sidebar-scope").textContent,
    "sidebar-graph-item",
  );
});

test("library graph uses visible regular items, excludes deleted children and retains the current paper", () => {
  const app = setup();
  const win = ownerWindow();
  win.view = [
    item(10),
    item(11, { deleted: true }),
    item(12, { type: "attachment" }),
  ];
  const current = item(15);
  app.begin(app.panel("graph", win, current));
  const source = app.mounted[0].snapshots[0];
  assert.deepEqual(
    Array.from(source.items, (value) => value.id),
    [10, 15],
  );
  assert.equal(source.itemID, current.id);
  assert.equal(win.viewReads, 1);
});

test("native pop-out buttons use the owning window and freeze the current matrix item", () => {
  const app = setup();
  const win = ownerWindow();
  const matrix = app.begin(app.panel("matrix", win, item(1), "reader"));
  const original = matrix.props.item;
  matrix.definition.sectionButtons[0].onClick(matrix.props);
  matrix.props.item = item(2);
  matrix.definition.onItemChange(matrix.props);
  const opened = app.popouts[0];
  assert.equal(opened.host, win);
  assert.equal(opened.source.allowViewScope, false);
  assert.equal(opened.source.getItems("selected")[0], original);
  for (const kind of ["stats", "graph"]) {
    const state = app.begin(app.panel(kind, win));
    state.definition.sectionButtons[0].onClick(state.props);
    assert.equal(app.popouts.at(-1).kind, kind);
    assert.equal(app.popouts.at(-1).host, win);
  }
  const reader = app.begin(
    app.panel("graph", ownerWindow({ reader: true }), item(3), "reader"),
  );
  assert.equal(reader.buttonStatus.at(-1).disabled, true);
  const count = app.popouts.length;
  reader.definition.sectionButtons[0].onClick(reader.props);
  assert.equal(app.popouts.length, count);
});

test("context changes update a matrix's reader versus library scope capability", () => {
  const app = setup();
  const state = app.begin(
    app.panel("matrix", ownerWindow(), item(1), "reader"),
  );
  state.win.framesCreated[0].finishLoad();
  assert.equal(app.mounted.at(-1).source.allowViewScope, false);
  state.props.tabType = "library";
  state.definition.onItemChange(state.props);
  state.win.framesCreated.at(-1).finishLoad();
  assert.equal(app.mounted.at(-1).source.allowViewScope, true);
  state.props.tabType = "reader";
  state.definition.onItemChange(state.props);
  state.win.framesCreated.at(-1).finishLoad();
  assert.equal(app.mounted.at(-1).source.allowViewScope, false);
});

test("destroy cancels pending iframe callbacks and unregister cleans listeners without closing owner windows", () => {
  const app = setup();
  const state = app.begin(app.panel("matrix"));
  const frame = state.win.framesCreated[0];
  const late = [...frame.listeners.get("load").keys()][0];
  state.definition.onDestroy(state.props);
  assert.equal(frame.listeners.get("load").size, 0);
  assert.equal(frame.parentElement, null);
  assert.equal(state.body.children.length, 0);
  assert.equal(state.win.observers[0].disconnected, true);
  assert.equal(state.win.document.listeners.get("visibilitychange").size, 0);
  frame.finishLoad();
  late();
  assert.equal(app.mounted.length, 0);
  app.unregisterSidebarSections();
  assert.equal(app.removed.length, 3);
  app.unregisterSidebarSections();
  assert.equal(app.removed.length, 3);
  assert.equal(state.win.closeCount, 0);
  app.registerSidebarSections();
  assert.equal(app.registrations.length, 6);
});

test("per-window teardown leaves other sidebar controllers and native content untouched", () => {
  const app = setup();
  const first = app.begin(app.panel("matrix"));
  const second = app.begin(app.panel("matrix"));
  first.win.framesCreated[0].finishLoad();
  second.win.framesCreated[0].finishLoad();
  app.closeSidebarSectionsForWindow(first.win);
  assert.equal(app.mounted[0].disposed, true);
  assert.equal(app.mounted[1].disposed, false);
  assert.equal(first.body.children.length, 0);
  assert.equal(second.body.children.length, 1);
  assert.equal(first.win.closeCount, 0);
  assert.equal(second.win.closeCount, 0);
  assert.equal(second.win.document.listeners.get("visibilitychange").size, 1);
  second.win.dispatch("unload");
  assert.equal(app.mounted[1].disposed, true);
  assert.equal(second.body.children.length, 0);
  assert.equal(second.win.document.listeners.get("visibilitychange").size, 0);
});

test("mount failure exposes one retry and a fresh isolated frame can recover", () => {
  const app = setup();
  const state = app.begin(app.panel("matrix"));
  app.failMount();
  state.win.framesCreated[0].finishLoad();
  assert.equal(app.mounted.length, 0);
  assert.equal(
    state.body.querySelector(".zest-sidebar-message").textContent,
    "sidebar-load-failed",
  );
  const retry = state.body.querySelector(".zest-sidebar-retry");
  assert.ok(retry);
  retry.click();
  assert.equal(state.win.framesCreated.length, 2);
  state.win.framesCreated[1].finishLoad();
  assert.equal(app.mounted.length, 1);
  assert.equal(state.body.querySelector(".zest-sidebar-retry"), null);
  assert.equal(state.body.querySelector(".zest-sidebar-message").hidden, true);
  assert.equal(state.win.closeCount, 0);
});
