const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers.cjs");

function domFixture() {
  let doc;
  class Element {
    constructor(tag) {
      this.tagName = tag;
      this.ownerDocument = doc;
      this.children = [];
      this.parentElement = null;
      this.className = "";
      this.textContent = "";
      this.dataset = {};
      this.listeners = new Map();
      const properties = new Map();
      this.style = {
        setProperty: (name, value, priority = "") =>
          properties.set(name, { value, priority }),
        getPropertyValue: (name) => properties.get(name)?.value || "",
        getPropertyPriority: (name) => properties.get(name)?.priority || "",
        removeProperty: (name) => properties.delete(name),
      };
      const classes = () =>
        new Set(this.className.split(/\s+/).filter(Boolean));
      this.classList = {
        contains: (name) => classes().has(name),
        add: (...names) => {
          this.className = [...new Set([...classes(), ...names])].join(" ");
        },
        remove: (...names) => {
          this.className = [...classes()]
            .filter((x) => !names.includes(x))
            .join(" ");
        },
        toggle: (name, force) => {
          if (force ?? !classes().has(name)) this.classList.add(name);
          else this.classList.remove(name);
        },
      };
    }
    appendChild(child) {
      child.remove();
      child.parentElement = this;
      this.children.push(child);
      return child;
    }
    insertBefore(child, before) {
      if (!before) return this.appendChild(child);
      child.remove();
      child.parentElement = this;
      const at = this.children.indexOf(before);
      this.children.splice(at < 0 ? this.children.length : at, 0, child);
      return child;
    }
    remove() {
      if (!this.parentElement) return;
      const at = this.parentElement.children.indexOf(this);
      if (at >= 0) this.parentElement.children.splice(at, 1);
      this.parentElement = null;
    }
    setAttribute(name, value) {
      this[name] = String(value);
    }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(fn);
    }
    querySelectorAll(selector) {
      const wanted = selector
        .split(".")
        .filter(Boolean)
        .map((x) => x.trim());
      const matches = (node) =>
        wanted.every((name) => node.classList.contains(name));
      const result = [];
      const walk = (node) => {
        for (const child of node.children) {
          if (matches(child)) result.push(child);
          walk(child);
        }
      };
      walk(this);
      return result;
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }
  }
  doc = {
    createElement: (tag) => new Element(tag),
    documentElement: new Element("window"),
  };
  const win = { document: doc, setTimeout() {}, clearTimeout() {} };
  doc.defaultView = win;
  return { win, Element };
}

test("legacy star parser accepts only complete one-to-five star tags", () => {
  const { parseStarRatingTag } = createHarness().load("src/rating/starTags.ts");
  assert.equal(parseStarRatingTag("⭐⭐⭐"), 3);
  assert.equal(parseStarRatingTag("★\uFE0F★\uFE0F"), 2);
  assert.equal(parseStarRatingTag("⭐精读"), undefined);
  assert.equal(parseStarRatingTag(" ⭐"), undefined);
  assert.equal(parseStarRatingTag("⭐⭐⭐⭐⭐⭐"), undefined);
});

test("rating column click writes Extra and the next render uses its new value", async () => {
  const { win } = domFixture();
  class Item {
    isRegularItem() {
      return true;
    }
    isEditable() {
      return true;
    }
  }
  const item = new Item();
  let extra = "3";
  const writes = [];
  const h = createHarness({
    globals: { Zotero: { Item } },
    mocks: {
      "src/utils/prefs.ts": {
        getPref: (name) => ({ "rating.mark": "★", "rating.option": "☆" })[name],
      },
      "src/utils/locale.ts": { getString: (key) => key },
      "src/utils/extra.ts": {
        getExtraLine: () => ({ value: extra }),
        setExtraLine: async (_item, _keys, value) => {
          writes.push(value);
          extra = value || "";
        },
      },
      "src/columns/registry.ts": {
        makeCell: (doc, _column, key) => {
          const cell = doc.createElement("span");
          cell.className = `cell zest-${key}`;
          const textSpan = doc.createElement("span");
          textSpan.className = "cell-text";
          cell.appendChild(textSpan);
          return { cell, textSpan };
        },
        rowItem: () => item,
        isPlainClick: (event) => event.button === 0,
      },
    },
  });
  const { ratingColumn, ratingDisplayMode, getRating } = h.load(
    "src/columns/rating.ts",
  );
  assert.equal(
    ratingDisplayMode(),
    "column",
    "undefined display keeps legacy column mode",
  );
  for (const malformed of ["3.5", "3 notes", "0", "6", "-1", "not-a-rating"]) {
    extra = malformed;
    assert.equal(getRating(item), 0, malformed);
  }
  extra = "3";
  const spec = ratingColumn();
  const first = spec.renderCell(0, "3", {}, false, win.document);
  const fourth = first.querySelectorAll(".zest-star")[3];
  fourth.listeners
    .get("click")
    .values()
    .next()
    .value({
      button: 0,
      stopPropagation() {},
    });
  await Promise.resolve();
  assert.deepEqual(writes, ["4"]);
  const rerendered = spec.renderCell(
    0,
    spec.dataProvider(item),
    {},
    false,
    win.document,
  );
  assert.equal(rerendered.querySelectorAll(".zest-star.on").length, 4);
});

test("title mode draws display-only Extra stars, removes only a matching raw legacy tag, and cleans recycled cells", () => {
  const { win } = domFixture();
  class Item {
    isRegularItem() {
      return true;
    }
  }
  const item = new Item();
  item.getItemsListTags = () => [{ tag: "⭐⭐⭐" }, { tag: "⭐精读" }];
  let display = "title";
  let enabled = true;
  let writes = 0;
  const reusable = win.document.createElement("span");
  reusable.className = "cell primary";
  for (let i = 0; i < 2; i++) {
    const swatch = win.document.createElement("span");
    swatch.className = "tag-swatch emoji";
    reusable.appendChild(swatch);
  }
  const text = win.document.createElement("span");
  text.className = "cell-text";
  reusable.appendChild(text);
  class View {
    getRow() {
      return { ref: item };
    }
    _renderCell(_index, _data, _column) {
      void _index;
      void _data;
      void _column;
      return reusable;
    }
  }
  const view = new View();
  win.ZoteroPane = { itemsView: view };
  const h = createHarness({
    globals: {
      Zotero: {
        Item,
        Utilities: { Internal: { containsEmoji: (tag) => tag.includes("⭐") } },
      },
    },
    mocks: {
      "src/utils/prefs.ts": {
        getPref: (name) =>
          ({
            "rating.display": display,
            "column.rating.enable": true,
            "rating.mark": "★",
            "rating.color": "#f0a",
            "titleDecor.heat": false,
            "titleDecor.unreadBold": false,
          })[name],
      },
      "src/columns/rating.ts": {
        getRating: () => 3,
        ratingListDisplayEnabled: () => enabled,
        ratingTitleDisplayEnabled: () =>
          enabled && (display === "title" || display === "both"),
        setRating: () => {
          writes++;
        },
      },
      "src/utils/locale.ts": {
        getString: (key, options) => `${key}:${options?.args?.rating ?? ""}`,
      },
      "src/reading/store.ts": { readingStore: { getForItem: () => null } },
      "src/reading/heat.ts": { cachedHeat: () => "" },
      "src/reading/status.ts": { effectiveStatus: () => ({ source: "none" }) },
      "src/utils/items.ts": { isTrackedItem: () => false },
      "src/columns/reading.ts": { heatColor: () => "", heatOpacity: () => 0 },
      "src/utils/timers.ts": { setTimeout: () => 1, clearTimeout() {} },
    },
  });
  const title = h.load("src/columns/titleDecor.ts");
  title.installTitleDecor(win);
  view._renderCell(0, "", { primary: true });
  const stars = reusable.querySelector(".zest-title-rating");
  assert.equal(stars.children.length, 3);
  assert.equal(stars.title, "rating-title-tip:3");
  const swatches = reusable.querySelectorAll(".tag-swatch.emoji");
  assert.equal(
    swatches[0].classList.contains("zest-title-rating-duplicate"),
    true,
  );
  assert.equal(
    swatches[1].classList.contains("zest-title-rating-duplicate"),
    false,
  );
  assert.equal(writes, 0, "title stars never write Extra");
  item.getItemsListTags = () => [
    { tag: "A\uFE0F", color: "#f00" },
    { tag: "⭐⭐⭐" },
  ];
  view._renderCell(0, "", { primary: true });
  assert.equal(
    swatches[0].classList.contains("zest-title-rating-duplicate"),
    false,
    "mismatched native VS16 swatches preserve semantic tags",
  );
  item.getItemsListTags = () => [{ tag: "⭐⭐⭐" }, { tag: "⭐精读" }];
  display = "column";
  view._renderCell(0, "", { primary: true });
  assert.equal(reusable.querySelector(".zest-title-rating"), null);
  assert.equal(
    swatches[0].classList.contains("zest-title-rating-duplicate"),
    true,
  );
  enabled = false;
  view._renderCell(0, "", { primary: true });
  assert.equal(
    swatches[0].classList.contains("zest-title-rating-duplicate"),
    false,
  );
  enabled = true;
  display = "both";
  view._renderCell(0, "", { primary: true });
  title.uninstallTitleDecor(win);
  assert.equal(reusable.querySelector(".zest-title-rating"), null);
  assert.equal(
    swatches[0].classList.contains("zest-title-rating-duplicate"),
    false,
  );
});

test("rating display mode registers only the column surface and never writes saved column layouts", () => {
  const observers = new Map();
  const registered = new Set();
  const events = [];
  let display = "title";
  const h = createHarness({
    globals: {
      Zotero: {
        Prefs: {
          registerObserver: (name, fn) => {
            observers.set(name, fn);
            return Symbol(name);
          },
          unregisterObserver() {},
        },
        Notifier: {
          registerObserver: () => "notifier",
          unregisterObserver() {},
        },
        getMainWindows: () => [],
        Items: {},
      },
    },
    mocks: {
      "src/utils/prefs.ts": {
        getPref: (name) =>
          ({ "rating.display": display, "column.rating.enable": true })[name],
      },
      "src/reading/store.ts": {
        readingStore: { onChange: () => () => {} },
        splitKey: () => [],
      },
      "src/columns/reading.ts": { readingColumn: () => ({ key: "reading" }) },
      "src/columns/status.ts": { statusColumn: () => ({ key: "status" }) },
      "src/columns/rating.ts": {
        ratingColumn: () => ({ key: "rating" }),
        ratingDisplayMode: () => display,
        ratingListDisplayEnabled: () => true,
      },
      "src/columns/tags.ts": { tagsColumn: () => ({ key: "tags" }) },
      "src/columns/textTags.ts": {
        textTagsColumn: () => ({ key: "textTags" }),
      },
      "src/columns/annotations.ts": {
        annotationsColumn: () => ({ key: "annots" }),
      },
      "src/columns/citations.ts": {
        citationsColumn: () => ({ key: "citations" }),
      },
      "src/columns/remark.ts": { remarkColumn: () => ({ key: "remark" }) },
      "src/columns/authors.ts": {
        authorsColumn: () => ({ key: "authors" }),
        firstAuthorColumn: () => ({ key: "first" }),
        lastAuthorColumn: () => ({ key: "last" }),
        bumpAuthorsVersion() {},
      },
      "src/columns/pubTags.ts": {
        publicationTagsColumn: () => ({ key: "pub" }),
        impactFactorColumn: () => ({ key: "if" }),
        venueColumn: () => ({ key: "venue" }),
      },
      "src/rank/index.ts": { startRankService() {}, stopRankService() {} },
      "src/rank/sources/localDataset.ts": { loadDatasets: async () => {} },
      "src/annots/density.ts": {
        startAnnotationWatch() {},
        stopAnnotationWatch() {},
      },
      "src/columns/registry.ts": {
        registerColumn: (spec) => {
          registered.add(spec.key);
          events.push(`register:${spec.key}`);
        },
        unregisterColumn: (key) => {
          registered.delete(key);
          events.push(`unregister:${key}`);
        },
        unregisterAllColumns() {},
        refreshItems() {},
        refreshAllRows() {},
        redrawAll() {},
        isRegistered: (key) => registered.has(key),
      },
      "src/columns/titleDecor.ts": {
        installTitleDecor() {},
        uninstallTitleDecor() {},
      },
    },
  });
  const columns = h.load("src/columns/index.ts");
  columns.registerAllColumns();
  assert.equal(registered.has("rating"), false);
  display = "both";
  observers.get("extensions.zotero.zest.rating.display")();
  assert.equal(registered.has("rating"), true);
  display = "title";
  observers.get("extensions.zotero.zest.rating.display")();
  assert.equal(registered.has("rating"), false);
  assert.deepEqual(
    events.filter((event) => event.includes("rating")),
    ["register:rating", "unregister:rating"],
  );
});
