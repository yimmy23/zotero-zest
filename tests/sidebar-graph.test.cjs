const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers.cjs");
const { windowFixture } = require("./dialog-fixture.cjs");

function graph(id = 1, { truncated = false } = {}) {
  return {
    nodes: [
      {
        id: `item-${id}`,
        itemID: id,
        label: `Paper ${id}`,
        title: `Title ${id}`,
      },
    ],
    edges: [],
    truncated,
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function setup({ maximum = 250, scope } = {}) {
  const win = windowFixture();
  const builds = [];
  const views = [];
  const logs = [];
  const opened = [];
  const selectedItems = [];
  const itemLookups = [];
  const attachments = new Map();
  const items = new Map([
    [1, { id: 1 }],
    [2, { id: 2 }],
    [3, { id: 3 }],
  ]);
  const host = { ZoteroPane: { selectItem: (id) => selectedItems.push(id) } };
  let currentScope = scope || {
    items: [{ id: 1 }, { id: 2 }],
    itemID: 2,
    host,
  };
  let sourceReads = 0;
  const unexpected = () => {
    throw new Error(
      "sidebar graph must not fetch, subscribe, or schedule work",
    );
  };
  const h = createHarness({
    globals: {
      fetch: unexpected,
      setTimeout: unexpected,
      setInterval: unexpected,
      ztoolkit: { log: (...args) => logs.push(args) },
      Zotero: {
        HTTP: { request: unexpected },
        Notifier: { registerObserver: unexpected },
        Items: {
          get(id) {
            itemLookups.push(id);
            return items.get(id) || false;
          },
        },
      },
    },
    mocks: {
      "src/utils/locale.ts": {
        getString: (key, options) =>
          options?.args ? `${key} ${JSON.stringify(options.args)}` : key,
      },
      "src/utils/prefs.ts": {
        getNumPref(key, fallback) {
          assert.equal(key, "graph.maxNodes");
          assert.equal(fallback, 250);
          return maximum;
        },
      },
      "src/utils/items.ts": {
        bestAttachment: (item) => attachments.get(item.id),
        async openAttachmentAt(attachment, options) {
          opened.push([attachment, options]);
        },
      },
      "src/ui/icons.ts": {
        iconButton(doc, name, title) {
          const button = doc.createElement("button");
          button.setAttribute("data-icon", name);
          button.setAttribute("aria-label", title);
          return button;
        },
      },
      "src/graph/build.ts": {
        buildGraph(items, mode, options) {
          let resolve, reject;
          const promise = new Promise((done, fail) => {
            resolve = done;
            reject = fail;
          });
          builds.push({ items, mode, options, resolve, reject });
          return promise;
        },
      },
      "src/graph/view.ts": {
        GraphView: class {
          constructor(canvas, callbacks) {
            this.canvas = canvas;
            this.callbacks = callbacks;
            this.data = [];
            this.fitCount = 0;
            this.destroyCount = 0;
            views.push(this);
          }
          setData(data) {
            this.data.push(data);
          }
          fitView() {
            this.fitCount++;
          }
          destroy() {
            this.destroyCount++;
          }
        },
      },
    },
  });
  const { mountSidebarGraph } = h.load("src/panes/sidebarGraph.ts");
  const mount = mountSidebarGraph(win.document.body, () => {
    sourceReads++;
    return currentScope;
  });
  return {
    win,
    doc: win.document,
    mount,
    builds,
    views,
    logs,
    opened,
    selectedItems,
    itemLookups,
    attachments,
    host,
    sourceReads: () => sourceReads,
    scope: () => currentScope,
    setScope(scope) {
      currentScope = scope;
    },
    async finish(index = builds.length - 1, data = graph()) {
      builds[index].resolve(data);
      await settle();
      return data;
    },
  };
}

test("sidebar graph builds local current context with a bounded node budget and explicit author roles", async () => {
  for (const [maximum, expected] of [
    [250, 120],
    [80, 80],
    [1, 30],
  ]) {
    const app = setup({ maximum });
    assert.equal(app.sourceReads(), 1);
    assert.equal(app.builds.length, 1);
    const build = app.builds[0];
    assert.equal(build.items, app.scope().items);
    assert.equal(build.mode, "related");
    assert.equal(build.options.maxNodes, expected);
    assert.equal(build.options.centerItemID, 2);
    assert.equal(build.options.authorRoles, "firstlast");
    assert.equal(build.options.minShared, 2);
    const data = await app.finish();
    assert.equal(app.views.length, 1);
    assert.equal(app.views[0].data[0], data);
    assert.equal(
      app.doc
        .querySelector(".zest-sidebar-graph-canvas")
        .getAttribute("aria-busy"),
      "false",
    );
    assert.match(
      app.doc.querySelector(".zest-sidebar-graph-status").textContent,
      /^graph-status /,
    );
    assert.equal(app.opened.length, 0);
    assert.deepEqual(app.logs, []);
    app.mount.dispose();
  }
});

test("mode changes rebuild the latest context, and obsolete promises cannot replace the current graph", async () => {
  const app = setup();
  const nextScope = { items: [{ id: 3 }], itemID: 3, host: app.host };
  app.setScope(nextScope);
  const modes = app.doc.querySelector("select");
  modes.value = "author";
  modes.dispatch("change");
  assert.equal(app.builds.length, 2);
  assert.equal(app.builds[1].items, nextScope.items);
  assert.equal(app.builds[1].options.centerItemID, 3);
  assert.equal(app.builds[1].mode, "author");
  const current = await app.finish(1, graph(3, { truncated: true }));
  await app.finish(0, graph(1));
  assert.equal(app.views.length, 1);
  assert.equal(app.views[0].data.length, 1);
  assert.equal(app.views[0].data[0], current);
  assert.match(
    app.doc.querySelector(".zest-sidebar-graph-status").textContent,
    /^graph-status-truncated /,
  );
  assert.deepEqual(app.logs, []);
});

test("hiding destroys the graph view and a clean resume reuses data without another build", async () => {
  const app = setup();
  const data = await app.finish();
  const first = app.views[0];
  app.mount.setActive(false);
  app.mount.setActive(false);
  assert.equal(first.destroyCount, 1);
  const writes = app.doc.writes;
  app.doc.querySelector('[data-icon="expand"]').click();
  assert.equal(first.fitCount, 0);
  assert.equal(app.doc.writes, writes);
  app.mount.setActive(true);
  assert.equal(app.sourceReads(), 1);
  assert.equal(app.builds.length, 1);
  assert.equal(app.views.length, 2);
  assert.equal(app.views[1].data[0], data);
  app.doc.querySelector('[data-icon="expand"]').click();
  assert.equal(app.views[1].fitCount, 1);
  app.mount.setActive(true);
  assert.equal(app.views.length, 2);
  app.mount.dispose();
  assert.equal(app.views[1].destroyCount, 1);
});

test("hidden refresh requests coalesce and hidden build completion cannot render", async () => {
  const app = setup();
  app.mount.setActive(false);
  const writes = app.doc.writes;
  app.mount.refresh();
  app.mount.refresh();
  await app.finish(0);
  assert.equal(app.builds.length, 1);
  assert.equal(app.sourceReads(), 1);
  assert.equal(app.views.length, 0);
  assert.equal(app.doc.writes, writes);
  app.setScope({ items: [{ id: 3 }], itemID: 3, host: app.host });
  app.mount.setActive(true);
  assert.equal(app.builds.length, 2);
  assert.equal(app.builds[1].options.centerItemID, 3);
  assert.equal(app.views.length, 0);
  await app.finish(1, graph(3));
  assert.equal(app.views.length, 1);
  assert.equal(app.views[0].data[0].nodes[0].itemID, 3);
  assert.deepEqual(app.logs, []);
});

test("selecting nodes only previews them; explicit open alone opens an attachment or selects an item", async () => {
  const app = setup();
  await app.finish();
  const callbacks = app.views[0].callbacks;
  const open = app.doc.querySelector(".zest-sidebar-graph-open");
  app.attachments.set(1, { id: 11 });
  callbacks.onSelect(graph(1).nodes[0]);
  assert.equal(
    app.doc.querySelector(".zest-sidebar-graph-detail").textContent,
    "Title 1",
  );
  assert.equal(open.hidden, false);
  assert.equal(app.opened.length, 0);
  assert.equal(app.itemLookups.length, 0);
  open.click();
  await settle();
  assert.equal(app.opened.length, 1);
  assert.equal(app.opened[0][0].id, 11);
  assert.equal(Object.keys(app.opened[0][1]).length, 0);
  assert.equal(app.selectedItems.length, 0);
  callbacks.onOpen(graph(2).nodes[0]);
  assert.deepEqual(app.selectedItems, [2]);
  callbacks.onSelect({ id: "tag", label: "Tag node" });
  assert.equal(open.hidden, true);
  callbacks.onOpen({ id: "tag", label: "Tag node" });
  callbacks.onOpen({ id: "missing", label: "Missing", itemID: 404 });
  assert.equal(app.opened.length, 1);
  assert.deepEqual(app.selectedItems, [2]);
  assert.deepEqual(app.logs, []);
});

test("dispose preserves unrelated DOM and cancels pending builds and retained handlers", async () => {
  const app = setup();
  await app.finish();
  const first = app.views[0];
  const refresh = app.doc.querySelector('[data-icon="refresh"]');
  const fit = app.doc.querySelector('[data-icon="expand"]');
  const modes = app.doc.querySelector("select");
  const open = app.doc.querySelector(".zest-sidebar-graph-open");
  first.callbacks.onSelect(graph(1).nodes[0]);
  app.mount.refresh();
  const unrelated = app.doc.createElement("aside");
  unrelated.textContent = "Other section";
  app.doc.body.append(unrelated);
  app.mount.dispose();
  assert.equal(app.doc.querySelector(".zest-sidebar-graph"), null);
  assert.equal(app.doc.querySelector("aside"), unrelated);
  assert.equal(first.destroyCount, 1);
  const writes = app.doc.writes;
  await app.finish(1, graph(2));
  app.mount.dispose();
  app.mount.setActive(true);
  app.mount.refresh();
  first.callbacks.onSelect(graph(2).nodes[0]);
  first.callbacks.onOpen(graph(2).nodes[0]);
  refresh.click();
  fit.click();
  modes.value = "tag";
  modes.dispatch("change");
  open.click();
  assert.equal(app.doc.writes, writes);
  assert.equal(app.builds.length, 2);
  assert.equal(app.views.length, 1);
  assert.equal(first.destroyCount, 1);
  assert.equal(app.itemLookups.length, 0);
  assert.equal(app.win.closeCount, 0);
  assert.deepEqual(app.logs, []);
});

test("callbacks retained by a destroyed view stay invalid after the sidebar resumes", async () => {
  const app = setup();
  await app.finish();
  const oldCallbacks = app.views[0].callbacks;
  app.mount.setActive(false);
  app.mount.setActive(true);
  assert.equal(app.views.length, 2);
  app.views[1].callbacks.onSelect(graph(2).nodes[0]);
  const before = app.doc.querySelector(
    ".zest-sidebar-graph-detail",
  ).textContent;
  const writes = app.doc.writes;
  oldCallbacks.onSelect(graph(1).nodes[0]);
  oldCallbacks.onOpen(graph(1).nodes[0]);
  assert.equal(
    app.doc.querySelector(".zest-sidebar-graph-detail").textContent,
    before,
  );
  assert.equal(app.doc.writes, writes);
  assert.equal(app.itemLookups.length, 0);
});

test("a context rebuild invalidates old node callbacks until the replacement graph is ready", async () => {
  const app = setup();
  await app.finish();
  const oldCallbacks = app.views[0].callbacks;
  app.setScope({ items: [{ id: 3 }], itemID: 3, host: app.host });
  app.mount.refresh();
  const before = app.doc.querySelector(
    ".zest-sidebar-graph-detail",
  ).textContent;
  const writes = app.doc.writes;
  oldCallbacks.onSelect(graph(1).nodes[0]);
  oldCallbacks.onOpen(graph(1).nodes[0]);
  assert.equal(
    app.doc.querySelector(".zest-sidebar-graph-detail").textContent,
    before,
  );
  assert.equal(app.doc.writes, writes);
  assert.equal(app.itemLookups.length, 0);
  await app.finish(1, graph(3));
  app.views.at(-1).callbacks.onSelect(graph(3).nodes[0]);
  assert.equal(
    app.doc.querySelector(".zest-sidebar-graph-detail").textContent,
    "Title 3",
  );
});

test("empty and failed builds expose stable status and release the loading state", async () => {
  const app = setup();
  await app.finish(0, { nodes: [], edges: [], truncated: false });
  assert.equal(
    app.doc.querySelector(".zest-sidebar-graph-status").textContent,
    "graph-empty",
  );
  app.mount.refresh();
  app.builds[1].reject(new Error("fixture build failed"));
  await settle();
  assert.equal(
    app.doc.querySelector(".zest-sidebar-graph-status").textContent,
    "graph-failed",
  );
  assert.equal(app.doc.querySelector('[data-icon="refresh"]').disabled, false);
  assert.equal(
    app.doc
      .querySelector(".zest-sidebar-graph-canvas")
      .getAttribute("aria-busy"),
    "false",
  );
  assert.equal(app.logs.length, 1);
  assert.equal(app.logs[0][0], "[sidebar graph] build failed");
});
