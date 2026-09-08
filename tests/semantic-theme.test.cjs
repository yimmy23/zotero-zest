const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHarness } = require("./helpers.cjs");
const { windowFixture } = require("./dialog-fixture.cjs");

function dom() {
  const win = windowFixture();
  const doc = win.document;
  const create = doc.createElement;
  doc.createElement = (tag) => {
    const node = create(tag);
    node.style.getPropertyPriority = () => "";
    node.style.removeProperty = (name) => delete node.style[name];
    node.classList.toggle = (name, on) => {
      if (on) node.classList.add(name);
      else
        node.className = node.className
          .split(/\s+/)
          .filter((n) => n !== name)
          .join(" ");
    };
    node.insertBefore = (child, next) => {
      child.remove();
      child.parentElement = node;
      node.childNodes.splice(node.childNodes.indexOf(next), 0, child);
    };
    node.getBoundingClientRect = () => ({
      width: 600,
      height: 300,
      left: 0,
      top: 0,
    });
    return node;
  };
  doc.documentElement = doc.createElement("html");
  doc.body = doc.createElement("body");
  doc.documentElement.appendChild(doc.body);
  doc.createElementNS = (_ns, tag) => doc.createElement(tag);
  doc.getElementById = (id) => {
    const find = (node) =>
      node.id === id ? node : node.children.map(find).find(Boolean);
    return find(doc.documentElement) || null;
  };
  return win;
}

function semanticFixture() {
  const win = dom();
  // These render paths must not freeze a one-time window theme choice.
  win.matchMedia = () => {
    throw new Error("theme must be resolved by CSS");
  };
  const prefs = {
    "rank.textColor": "auto",
    "rank.opacity": 0.15,
    "textTags.textColor": "auto",
    "textTags.match": "#",
  };
  const rgb = [255, 102, 102];
  class Item {
    libraryID = 1;
    isRegularItem() {
      return true;
    }
    getAttachments() {
      return [2];
    }
    getTags() {
      return [{ tag: "#Method" }];
    }
  }
  const item = new Item();
  const annotation = {
    key: "ANNOT001",
    annotationPageLabel: "1",
    annotationText: "A highlight",
    annotationColor: "#ff6666",
    annotationType: "highlight",
    getTags: () => [],
  };
  const attachment = {
    id: 2,
    getAnnotations: () => [annotation],
    getField: () => "PDF",
  };
  let section;
  const errors = [];
  const harness = createHarness({
    globals: {
      ztoolkit: { log: (...args) => errors.push(args) },
      Zotero: {
        Item,
        Items: { get: () => attachment },
        Tags: {
          getColors: () =>
            new Map([["#Method", { color: "#ff6666", position: 0 }]]),
        },
        ItemPaneManager: {
          registerSection: (value) => {
            section = value;
            return "annots";
          },
          unregisterSection() {},
        },
      },
    },
    mocks: {
      "src/utils/prefs.ts": {
        getPref: (key) => prefs[key],
        getNumPref: (_key, value) => value,
      },
      "src/utils/locale.ts": {
        getString: (key) => key,
        getLocaleID: (key) => key,
      },
      "src/utils/guard.ts": { guard: (_name, fn) => fn },
      "src/utils/items.ts": {},
      "src/tags/nestedTree.ts": {
        selectedTagNames: () => [],
        onTagSelectionChange: () => () => {},
      },
      "src/ui/icons.ts": { iconButton: (doc) => doc.createElement("button") },
      "src/ui/styles.ts": { accentColor: () => "#40c463" },
      "src/columns/registry.ts": {
        rowItem: () => item,
        makeCell: (doc) => {
          const cell = doc.createElement("div"),
            textSpan = doc.createElement("span");
          cell.appendChild(textSpan);
          return { cell, textSpan };
        },
      },
      "src/rank/index.ts": {
        getJournalRecord: () => ({}),
        displayValuesForUI: () => [
          {
            field: "sci",
            sourceField: "sci",
            rank: 1,
            value: "Q1",
            source: "fixture",
          },
        ],
      },
      "src/rank/rank.ts": {
        displayFields: () => ["sci"],
        colorForRank: () => "#ff6666",
      },
      "src/rank/display.ts": {
        rankFieldsForDisplay: (fields) => fields,
        rankValueDisplay: () => ({ text: "Q1", description: "Q1" }),
      },
      "src/rank/normalize.ts": {},
      "src/rank/types.ts": {},
    },
  });
  const colors = harness.load("src/ui/color.ts");
  const badge = (module, factory) => {
    const api = harness.load(module);
    return api[factory]()
      .renderCell(0, "data", {}, false, win.document)
      .querySelector(".zest-badge");
  };
  return {
    win,
    prefs,
    rgb,
    item,
    harness,
    colors,
    badge,
    errors,
    section: () => section,
  };
}

function assertVariants(element, fixture) {
  assert.equal(
    element.style.getPropertyValue("--zest-readable-light"),
    fixture.colors.readableTextColor(fixture.rgb, false),
  );
  assert.equal(
    element.style.getPropertyValue("--zest-readable-dark"),
    fixture.colors.readableTextColor(fixture.rgb, true),
  );
  assert.notEqual(
    element.style.getPropertyValue("--zest-readable-light"),
    element.style.getPropertyValue("--zest-readable-dark"),
  );
}

for (const [name, module, factory, pref] of [
  [
    "journal",
    "src/columns/pubTags.ts",
    "publicationTagsColumn",
    "rank.textColor",
  ],
  [
    "text tag",
    "src/columns/textTags.ts",
    "textTagsColumn",
    "textTags.textColor",
  ],
]) {
  test(`${name} auto text retains both theme contrasts and the original semantic wash`, () => {
    const f = semanticFixture();
    const badge = f.badge(module, factory);
    assertVariants(badge, f);
    assert.equal(badge.classList.contains("zest-readable-text"), true);
    assert.equal(badge.style.color, undefined, "no fixed inline text colour");
    assert.match(badge.style.backgroundColor, /^rgba\(255,102,102,/);
  });
  test(`${name} explicit user text colour remains untouched`, () => {
    const f = semanticFixture();
    f.prefs[pref] = "#123456";
    const badge = f.badge(module, factory);
    assert.equal(badge.style.color, "#123456");
    assert.equal(badge.classList.contains("zest-readable-text"), false);
    assert.equal(badge.style.getPropertyValue("--zest-readable-dark"), "");
  });
}

test("annotation cards keep both contrast variants without changing text or source colour", () => {
  const f = semanticFixture();
  const api = f.harness.load("src/panes/annotSection.ts");
  api.registerAnnotSection();
  f.section().onRender({
    body: f.win.document.body,
    doc: f.win.document,
    item: f.item,
    tabType: "library",
  });
  assert.deepEqual(f.errors, []);
  const card = f.win.document.body.querySelector(".zest-annot-card");
  assertVariants(card, f);
  assert.equal(card.style.getPropertyValue("--zest-annot-rgb"), "255,102,102");
  assert.equal(card.style.getPropertyValue("--zest-annot-line"), "");
  assert.equal(
    card.querySelector(".zest-annot-text").textContent,
    "A highlight",
  );
  api.unregisterAnnotSection();
});

test("badge and annotation CSS select contrast with media rules, not a render-time flag", () => {
  const source = fs.readFileSync(
    path.join(path.dirname(module.filename), "../src/ui/styles.ts"),
    "utf8",
  );
  assert.match(
    source,
    /\.zest-badge\.zest-readable-text\s*\{\s*color:\s*var\(--zest-readable-light,/,
  );
  assert.match(
    source,
    /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*\.zest-badge\.zest-readable-text\s*\{\s*color:\s*var\(--zest-readable-dark,/,
  );
  assert.match(
    source,
    /border-inline-start:\s*3px solid var\(--zest-readable-light,/,
  );
  assert.match(
    source,
    /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*\.zest-annot-card\s*\{\s*border-inline-start-color:\s*var\(--zest-readable-dark,/,
  );
});

test("accent changes repaint only mounted graph colours, deduplicate events, and detach on destroy", () => {
  const win = dom(),
    other = dom();
  let accent = "#40c463",
    events = 0;
  for (const target of [win, other]) {
    target.CustomEvent = class {
      constructor(type) {
        this.type = type;
      }
    };
    target.dispatchEvent = (event) => {
      target.dispatch(event.type);
      return true;
    };
    target.matchMedia = () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    });
    target.getComputedStyle = () => ({
      getPropertyValue: (name) =>
        target.document.documentElement.style.getPropertyValue(name),
    });
    target.cancelAnimationFrame = () => {};
  }
  win.addEventListener("zest-accent-change", () => events++);
  const h = createHarness({
    globals: { Zotero: { getMainWindows: () => [win, other] } },
    mocks: {
      "src/utils/prefs.ts": { getPref: () => accent },
      "d3-force": {
        forceSimulation: () => {
          throw new Error("colour changes must not simulate");
        },
      },
      "src/utils/timers.ts": { setTimeout: () => 1, clearTimeout() {} },
    },
  });
  const styles = h.load("src/ui/styles.ts");
  styles.registerStyles(win);
  styles.registerStyles(other);
  assert.equal(events, 1);
  const { GraphView } = h.load("src/graph/view.ts");
  const graphs = [win, other].map((target) => {
    const container = target.document.createElement("div");
    target.document.body.appendChild(container);
    const view = new GraphView(container, {});
    const node = { id: "center", kind: "center", x: 27, y: 42 };
    const circle = target.document.createElementNS("svg", "circle");
    view.data = { nodes: [node], edges: [] };
    view.nodeEls.set(node.id, circle);
    view.setData = () => {
      throw new Error("colour changes must not rebuild data");
    };
    return { view, node, circle };
  });
  styles.applyAccent(win);
  assert.equal(events, 1, "same accent does not emit an update");
  accent = "#897299";
  styles.applyAccent(win);
  assert.equal(events, 2);
  assert.equal(graphs[0].circle.getAttribute("fill"), "rgb(93, 78, 104)");
  assert.equal(
    graphs[1].circle.getAttribute("fill"),
    null,
    "another window was not repainted",
  );
  assert.deepEqual([graphs[0].node.x, graphs[0].node.y], [27, 42]);
  styles.syncAccent();
  assert.equal(events, 2);
  assert.equal(graphs[1].circle.getAttribute("fill"), "rgb(93, 78, 104)");
  graphs[0].view.destroy();
  graphs[1].view.destroy();
  assert.equal(
    win.listeners.get("zest-accent-change").size,
    1,
    "only the test listener remains",
  );
  assert.equal(other.listeners.get("zest-accent-change").size, 0);
  styles.unregisterStyles(win);
  styles.unregisterStyles(other);
});
