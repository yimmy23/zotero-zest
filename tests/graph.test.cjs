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
  dispatch(type, init = {}) {
    const event = {
      target: this,
      clientX: 0,
      clientY: 0,
      pointerId: 1,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {},
      ...init,
    };
    for (const fn of [...(this.listeners.get(type) || [])]) fn(event);
    return event;
  }
  focus() {
    this.ownerDocument.activeElement?.dispatch("blur");
    this.ownerDocument.activeElement = this;
    this.dispatch("focus");
  }
  setPointerCapture() {}
  releasePointerCapture() {}
  get lastElementChild() {
    return this.children.at(-1) || null;
  }
}

function dom() {
  const frames = new Map();
  let nextFrame = 0;
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
    requestAnimationFrame: (callback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
  };
  doc.defaultView = win;
  const flushFrame = () => {
    for (const [id, callback] of [...frames]) {
      if (!frames.delete(id)) continue;
      callback();
    }
  };
  const settle = () => {
    let steps = 0;
    while (frames.size && steps++ < 200) flushFrame();
    assert.equal(frames.size, 0, "the graph must finish its bounded animation");
  };
  return { doc, win, frames, flushFrame, settle };
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
          fitView() {}
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

/** The force implementation is real; only the detached DOM and RAF are controlled. */
async function simulatedView(width = 960, height = 460, fontSize = 13) {
  const surface = dom();
  const { doc } = surface;
  surface.win.getComputedStyle = () => ({
    fontSize: `${fontSize}px`,
    getPropertyValue: () => "",
  });
  const container = doc.createElement("div");
  container.bounds = { width, height, left: 0, top: 0 };
  doc.documentElement.appendChild(container);
  const h = createHarness({
    mocks: {
      "d3-force": await import("d3-force"),
      "src/utils/timers.ts": { setTimeout: () => 1, clearTimeout() {} },
    },
  });
  const { GraphView } = h.load("src/graph/view.ts");
  const view = new GraphView(container, {});
  const svg = container.children[0];
  svg.bounds = container.bounds;
  const root = svg.children[0];
  const nodes = root.children[1];
  const labels = root.children[2];
  const camera = () => {
    const transform = root.getAttribute("transform");
    const match = /^translate\(([^,]+),([^)]+)\) scale\(([^)]+)\)$/.exec(
      transform,
    );
    assert.ok(match, `unexpected SVG camera: ${transform}`);
    return {
      x: Number(match[1]),
      y: Number(match[2]),
      scale: Number(match[3]),
      panX: Number(match[1]) - container.bounds.width / 2,
      panY: Number(match[2]) - container.bounds.height / 2,
    };
  };
  return { ...surface, view, container, svg, root, nodes, labels, camera };
}

function graphFixture(count = 258, star = false) {
  const sizes = star
    ? [count]
    : [count - 78, 22, 15, 10, 8, 6, 5, 4, 3, 1, 1, 1, 1, 1];
  const nodes = [];
  const edges = [];
  for (let component = 0; component < sizes.length; component++) {
    const start = nodes.length;
    for (let i = 0; i < sizes[component]; i++) {
      const id = String(nodes.length);
      nodes.push({
        id,
        label: `Researcher ${id} 等, 2024`,
        title: `Full title of study ${id}`,
        kind: nodes.length ? "item" : "center",
        weight: 0,
      });
    }
    for (let i = 1; i < sizes[component]; i++) {
      const source =
        component === 0 && !star && i > 13
          ? start + 1 + ((i - 14) % 13)
          : start;
      edges.push({
        source: String(source),
        target: String(start + i),
        weight: 1,
      });
      nodes[source].weight++;
      nodes[start + i].weight++;
    }
  }
  return { nodes, edges, mode: "related" };
}

function assertFitted(surface) {
  const { x, y, scale } = surface.camera();
  const { width, height } = surface.container.bounds;
  assert.ok(Number.isFinite(scale) && scale > 0);
  for (const circle of surface.nodes.children) {
    const cx = x + Number(circle.getAttribute("cx")) * scale;
    const cy = y + Number(circle.getAttribute("cy")) * scale;
    const radius = Number(circle.getAttribute("r")) * scale;
    assert.ok(
      cx - radius >= 28 - 1e-7 && cx + radius <= width - 28 + 1e-7,
      `node ${circle.getAttribute("aria-label")} has horizontal clipping`,
    );
    assert.ok(
      cy - radius >= 28 - 1e-7 && cy + radius <= height - 28 + 1e-7,
      `node ${circle.getAttribute("aria-label")} has vertical clipping`,
    );
  }
}

function modelState(data) {
  return data.nodes.map(({ id, x, y, vx, vy, fx, fy }) => ({
    id,
    x,
    y,
    vx,
    vy,
    fx,
    fy,
  }));
}

function visibleLabelBoxes(surface) {
  const { x, y, scale } = surface.camera();
  return surface.labels.children
    .filter((label) => label.style.opacity === "1")
    .map((label) => {
      const fontSize = Number.parseFloat(label.style.fontSize) * scale;
      const width = Array.from(label.textContent).reduce(
        (sum, char) => sum + fontSize * (char.charCodeAt(0) > 255 ? 1 : 0.58),
        0,
      );
      const height = Math.max(14, Math.ceil(fontSize * 1.5));
      return {
        x: x + Number(label.getAttribute("x")) * scale,
        y: y + Number(label.getAttribute("y")) * scale - height * 0.8,
        width,
        height,
      };
    });
}

function assertLabelSpacing(boxes, width, height, gap = 0) {
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    assert.ok(a.x >= 4 - 1e-7 && a.x + a.width <= width - 4 + 1e-7);
    assert.ok(a.y >= 4 - 1e-7 && a.y + a.height <= height - 4 + 1e-7);
    for (let j = i + 1; j < boxes.length; j++) {
      const b = boxes[j];
      const overlaps =
        a.x < b.x + b.width + gap - 1e-7 &&
        a.x + a.width + gap - 1e-7 > b.x &&
        a.y < b.y + b.height + gap - 1e-7 &&
        a.y + a.height + gap - 1e-7 > b.y;
      assert.equal(overlaps, false, `visible captions ${i} and ${j} overlap`);
    }
  }
}

for (const count of [258, 500]) {
  test(`real force layout fits ${count} mixed-component nodes without flattening a row along the top`, async () => {
    const surface = await simulatedView();
    const data = graphFixture(count);
    try {
      surface.view.setData(data);
      assert.equal(surface.nodes.children.length, count);
      assertFitted(surface);
      surface.settle();
      assertFitted(surface);
      const rows = new Map();
      for (const node of data.nodes) {
        assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
        const key = node.y.toFixed(7);
        rows.set(key, (rows.get(key) || 0) + 1);
      }
      assert.ok(
        Math.max(...rows.values()) < 8,
        "the viewport boundary must not collapse many nodes onto one y",
      );
      const before = modelState(data);
      surface.view.fitView();
      assert.deepEqual(
        modelState(data),
        before,
        "fitting only changes the camera",
      );
      assertFitted(surface);
    } finally {
      surface.view.destroy();
    }
  });
}

test("wheel and background pan retain a manual camera through settling and resize; new data refits", async () => {
  const surface = await simulatedView();
  const { view, svg, container } = surface;
  try {
    view.setData(graphFixture());
    const initial = surface.camera();
    const plain = svg.dispatch("wheel", { deltaY: -1 });
    assert.equal(
      plain.defaultPrevented,
      false,
      "ordinary wheel still scrolls Zotero",
    );
    assert.deepEqual(surface.camera(), initial);
    const zoom = svg.dispatch("wheel", {
      ctrlKey: true,
      deltaY: -1,
      clientX: 480,
      clientY: 230,
    });
    assert.equal(zoom.defaultPrevented, true);
    const zoomed = surface.camera();
    assert.ok(zoomed.scale > initial.scale);
    surface.settle();
    assert.deepEqual(
      surface.camera(),
      zoomed,
      "settling cannot undo a manual zoom",
    );
    svg.dispatch("pointerdown", { clientX: 100, clientY: 100 });
    svg.dispatch("pointermove", { clientX: 160, clientY: 130 });
    svg.dispatch("pointerup");
    const panned = surface.camera();
    assert.ok(Math.abs(panned.panX - zoomed.panX - 60) < 1e-8);
    assert.ok(Math.abs(panned.panY - zoomed.panY - 30) < 1e-8);
    container.bounds.width = 720;
    container.bounds.height = 320;
    view.resize();
    const resized = surface.camera();
    assert.equal(resized.scale, panned.scale);
    assert.ok(Math.abs(resized.panX - panned.panX) < 1e-8);
    assert.ok(Math.abs(resized.panY - panned.panY) < 1e-8);
    view.setData(graphFixture(20, true));
    surface.settle();
    assertFitted(surface);
    assert.notDeepEqual(
      surface.camera(),
      resized,
      "new data gets its own fitted view",
    );
    const writes = surface.doc.writes;
    view.resize();
    assert.equal(
      surface.doc.writes,
      writes,
      "same-size resize remains a no-op",
    );
  } finally {
    view.destroy();
  }
});

test("dragging a node does not trigger automatic camera movement after release", async () => {
  const surface = await simulatedView();
  const data = graphFixture(80, true);
  try {
    surface.view.setData(data);
    surface.settle();
    const camera = surface.camera();
    const center = surface.nodes.children[0];
    const oldX = data.nodes[0].x;
    const oldY = data.nodes[0].y;
    center.dispatch("pointerdown", { clientX: 480, clientY: 230 });
    center.dispatch("pointermove", { clientX: 550, clientY: 275 });
    surface.flushFrame();
    center.dispatch("pointerup");
    surface.settle();
    assert.deepEqual(surface.camera(), camera);
    assert.ok(data.nodes[0].x !== oldX || data.nodes[0].y !== oldY);
    surface.container.bounds.width = 800;
    surface.view.resize();
    assert.equal(surface.camera().scale, camera.scale);
    assert.ok(Math.abs(surface.camera().panX - camera.panX) < 1e-8);
    assert.ok(Math.abs(surface.camera().panY - camera.panY) < 1e-8);
  } finally {
    surface.view.destroy();
  }
});

test("focusing a high-degree hub keeps its caption visible without overlapping neighbour labels or exceeding 40", async () => {
  const surface = await simulatedView();
  try {
    surface.view.setData(graphFixture(180, true));
    surface.settle();
    surface.nodes.children[0].focus();
    const visible = surface.labels.children.filter(
      (label) => label.style.opacity === "1",
    );
    assert.ok(visible.length > 0 && visible.length <= 40);
    assert.equal(
      surface.labels.children[0].style.opacity,
      "1",
      "the focused caption stays on",
    );
    assertLabelSpacing(visibleLabelBoxes(surface), 960, 460, 3);
  } finally {
    surface.view.destroy();
  }
});

test("panning to a low-priority node still displays its label when 100 higher-priority candidates are off screen", async () => {
  const surface = await simulatedView();
  const nodes = Array.from({ length: 101 }, (_, i) => ({
    id: String(i),
    label: i === 100 ? "Visible lower-degree study" : `High-degree study ${i}`,
    kind: "item",
    weight: i === 100 ? 1 : 100,
    // Fixed coordinates isolate candidate selection from stochastic layout.
    fx: i === 100 ? 0 : 1000 + i * 2,
    fy: i === 100 ? 0 : (i % 10) * 8,
  }));
  const edges = nodes.slice(1).map((node) => ({
    source: "0",
    target: node.id,
    weight: 1,
  }));
  try {
    surface.view.setData({ nodes, edges, mode: "related" });
    surface.settle();
    const initial = surface.camera();
    const lowNodeScreenX = initial.x + nodes[100].x * initial.scale;
    const delta = 480 - lowNodeScreenX;
    surface.svg.dispatch("pointerdown", { clientX: 0, clientY: 0 });
    surface.svg.dispatch("pointermove", { clientX: delta, clientY: 0 });
    surface.svg.dispatch("pointerup");
    const camera = surface.camera();
    assert.equal(
      camera.scale,
      initial.scale,
      "panning does not increase the label budget",
    );
    assert.ok(
      nodes
        .slice(0, 100)
        .every((node) => camera.x + node.x * camera.scale > 960),
    );
    assert.equal(
      surface.labels.children[100].style.opacity,
      "1",
      "off-screen high-priority nodes must not consume the candidate budget",
    );
    assert.equal(visibleLabelBoxes(surface).length, 1);
    assertLabelSpacing(visibleLabelBoxes(surface), 960, 460);
  } finally {
    surface.view.destroy();
  }
});

test("large graph text reserves dynamic label height and a gap between every visible caption", async () => {
  const surface = await simulatedView(960, 460, 32);
  const nodes = Array.from({ length: 12 }, (_, i) => ({
    id: String(i),
    label: `Wide caption ${i}`,
    kind: "item",
    weight: 1,
    fx: (i % 3) * 90,
    fy: Math.floor(i / 3) * 32,
  }));
  const edges = nodes
    .slice(1)
    .map((node) => ({ source: "0", target: node.id, weight: 1 }));
  try {
    surface.view.setData({ nodes, edges, mode: "related" });
    surface.settle();
    const boxes = visibleLabelBoxes(surface);
    assert.ok(
      boxes.length >= 2,
      "the test must compare more than the forced caption",
    );
    assert.ok(
      boxes.every((box) => box.height === 41),
      "32px host text needs a 41px label box, not 14px",
    );
    assertLabelSpacing(boxes, 960, 460, 3);
    const visible = surface.labels.children.filter(
      (label) => label.style.opacity === "1",
    );
    assert.ok(
      visible.every((label) => label.textContent.endsWith("…")),
      "wide labels are truncated to the cached width budget",
    );
  } finally {
    surface.view.destroy();
  }
});

test("destroy cancels a pending real-force animation and prevents later DOM writes", async () => {
  const surface = await simulatedView();
  surface.view.setData(graphFixture());
  assert.ok(surface.frames.size > 0);
  surface.view.destroy();
  assert.equal(surface.frames.size, 0);
  const writes = surface.doc.writes;
  surface.settle();
  assert.equal(surface.doc.writes, writes);
  assert.equal(surface.container.children.length, 0);
});
