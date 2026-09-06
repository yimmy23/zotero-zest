const test = require("node:test");
const assert = require("node:assert/strict");
const { setImmediate } = require("node:timers");
const { createHarness } = require("./helpers.cjs");

/** Minimal detached DOM: tests assert observable writes and displayed data. */
class Element {
  constructor(doc, tag) {
    this.ownerDocument = doc;
    this.tagName = tag;
    this.children = [];
    this.style = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = "";
    this.bounds = { width: 600, height: 300, left: 0, top: 0 };
    this.classList = {
      add: (name) => this.classList.toggle(name, true),
      remove: (name) => this.classList.toggle(name, false),
      toggle: (name, on) => {
        const names = new Set(this.className.split(/\s+/).filter(Boolean));
        if (on) names.add(name);
        else names.delete(name);
        this.className = [...names].join(" ");
      },
    };
  }
  setAttribute(name, value) {
    this.ownerDocument.writes++;
    this.attributes.set(name, String(value));
    if (name === "class") this.className = String(value);
  }
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
  appendChild(node) {
    node.remove();
    this.children.push(node);
    node.parentElement = this;
    return node;
  }
  remove() {
    const siblings = this.parentElement?.children;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
    this.parentElement = null;
  }
  replaceChildren() {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
  }
  set textContent(text) {
    this.replaceChildren();
    this.text = text;
  }
  get textContent() {
    return (
      this.text || this.children.map((child) => child.textContent).join("")
    );
  }
  getBoundingClientRect() {
    return this.bounds;
  }
  addEventListener(type, fn) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(fn);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, fn) {
    this.listeners.get(type)?.delete(fn);
  }
  dispatch(type) {
    for (const fn of this.listeners.get(type) || []) fn({ target: this });
  }
}

function dom() {
  const doc = {
    writes: 0,
    createElement(tag) {
      return new Element(this, tag);
    },
    createXULElement(tag) {
      return this.createElement(tag);
    },
    createElementNS(_ns, tag) {
      return this.createElement(tag);
    },
    getElementById(id) {
      const find = (node) =>
        node.id === id ? node : node.children.map(find).find(Boolean);
      return find(this.documentElement) || null;
    },
  };
  doc.documentElement = doc.createElement("window");
  const win = {
    document: doc,
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    matchMedia: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }),
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
  };
  doc.defaultView = win;
  return { doc, win };
}

function viewFixture() {
  const { doc, win } = dom();
  const container = doc.createElement("div");
  doc.documentElement.appendChild(container);
  let simulations = 0;
  const h = createHarness({
    mocks: {
      "d3-force": {
        forceSimulation: () => {
          simulations++;
          throw new Error("unexpected simulation");
        },
      },
      "src/utils/timers.ts": { setTimeout: () => 1, clearTimeout() {} },
    },
  });
  const { GraphView } = h.load("src/graph/view.ts");
  return {
    doc,
    win,
    container,
    view: new GraphView(container, {}),
    simulations: () => simulations,
  };
}

test("an empty graph clears the scene without starting a force simulation", () => {
  const { view, simulations } = viewFixture();
  view.setData({ nodes: [], edges: [] });
  view.setData(null);
  assert.equal(simulations(), 0);
  view.destroy();
});

test("same-size graph resize does not rewrite SVG attributes, while an actual resize does", () => {
  const { view, doc, container } = viewFixture();
  const initial = doc.writes;
  view.resize();
  view.resize();
  assert.equal(doc.writes, initial);
  container.bounds.width = 720;
  view.resize();
  assert.ok(doc.writes > initial);
  const resized = doc.writes;
  view.resize();
  assert.equal(doc.writes, resized);
  view.destroy();
});

test("rapid graph mode switches discard an old build and display only the latest requested mode", async () => {
  const { doc, win } = dom();
  const host = doc.createXULElement("vbox");
  host.id = "zotero-items-pane-container";
  const itemsPane = doc.createXULElement("vbox");
  itemsPane.id = "zotero-items-pane";
  host.appendChild(itemsPane);
  doc.documentElement.appendChild(host);
  class Item {
    isRegularItem() {
      return true;
    }
  }
  const item = new Item();
  item.id = 1;
  win.ZoteroPane = {
    itemsView: { getSortedItems: () => [item] },
    getSelectedItems: () => [item],
  };
  const prefs = new Map([["graph.mode", "related"]]);
  const builds = [];
  const displayed = [];
  const h = createHarness({
    mocks: {
      "src/utils/locale.ts": { getString: (key) => key },
      "src/utils/prefs.ts": {
        getPref: (key) => prefs.get(key),
        getNumPref: (_key, fallback) => fallback,
        setPref: (key, value) => prefs.set(key, value),
      },
      "src/utils/timers.ts": { setTimeout: () => 1, clearTimeout() {} },
      "src/utils/guard.ts": { guard: (_area, fn) => fn },
      "src/graph/authorFetch.ts": { ensureAuthorships: async () => false },
      "src/authors/authorMenu.ts": { appendAuthorMenuItems() {} },
      "src/graph/build.ts": {
        buildGraph: (_items, mode) =>
          new Promise((resolve) => builds.push({ mode, resolve })),
      },
      "src/graph/view.ts": {
        GraphView: class {
          setData(data) {
            displayed.push(data.mode);
          }
          destroy() {}
        },
      },
      "src/ui/icons.ts": {
        icon: (document) => document.createElement("svg"),
        iconButton: (document, _icon, _title, className) => {
          const button = document.createElement("button");
          button.className = className;
          return button;
        },
      },
    },
    globals: { Zotero: { Item } },
  });
  const pane = h.load("src/graph/pane.ts");
  pane.showGraphPane(win);
  assert.equal(builds.length, 1);
  const box = doc.getElementById("zest-graph-pane");
  const header = box.children[0];
  const modes = header.children.find(
    (node) => node.getAttribute("aria-label") === "graph-filter-modes",
  );
  modes.children[1].dispatch("click");
  modes.children[2].dispatch("click");
  assert.equal(builds.length, 1, "a running build is not duplicated");
  builds[0].resolve({ mode: "related", nodes: [], edges: [] });
  await new Promise(setImmediate);
  assert.deepEqual(displayed, []);
  assert.equal(builds.length, 2);
  assert.equal(builds[1].mode, "tag");
  builds[1].resolve({ mode: "tag", nodes: [], edges: [] });
  await new Promise(setImmediate);
  assert.deepEqual(displayed, ["tag"]);
  const canvas = box.children[1];
  assert.equal(canvas.getAttribute("aria-busy"), "false");
  assert.equal(
    canvas.children[0].hidden,
    false,
    "empty results offer guidance",
  );
  pane.hideGraphPane(win);
});
