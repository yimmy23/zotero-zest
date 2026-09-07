const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHarness } = require("./helpers.cjs");
const { windowFixture } = require("./dialog-fixture.cjs");

function fixture() {
  const prefs = {
    "nestedTags.show": true,
    "nestedTags.tab": "tree",
    "nestedTags.linkSymbol": "/",
    "nestedTags.sort": "az",
    "textTags.match": "#",
    "nestedTags.matchChildTags": true,
  };
  const timers = new Map(),
    filters = new Map(),
    refreshes = new Map(),
    windows = [];
  let timerID = 0,
    collectCalls = 0,
    handler,
    collect;
  const scopes = new Map();
  const rows = new Map();
  const rules = new Map();
  const invalidations = [];
  class Item {
    constructor(tags = [], children = []) {
      this.tags = tags;
      this.children = children;
    }
  }
  const clock = {
    setTimeout(fn, ms) {
      timers.set(++timerID, { fn, ms });
      return timerID;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    run(ms) {
      for (const [id, t] of [...timers])
        if (t.ms === ms) {
          timers.delete(id);
          t.fn();
        }
    },
  };
  const harness = createHarness({
    globals: {
      Zotero: {
        Item,
        Prefs: { get: (key) => prefs[key] },
        Notifier: {
          registerObserver(observer) {
            handler = observer;
            return "tags";
          },
          unregisterObserver() {},
        },
        Promise: { delay: async () => {} },
      },
    },
    mocks: {
      "src/utils/prefs.ts": {
        getPref: (key) => prefs[key],
        setPref: (key, value) => {
          prefs[key] = value;
        },
      },
      "src/utils/locale.ts": {
        getString: (key, options) =>
          key + (options?.args ? JSON.stringify(options.args) : ""),
      },
      "src/utils/guard.ts": { guard: (_name, fn) => fn },
      "src/utils/timers.ts": clock,
      "src/tags/scope.ts": {
        collectTagScope: async (library, items, cancelled) => {
          collectCalls++;
          return collect
            ? collect(library, items, cancelled)
            : scopes.get(library);
        },
        selectedLibraryID: (win) => win.libraryID,
        cachedTags: (item, children, auto) =>
          [...item.tags, ...(children ? item.children : [])]
            .filter((t) => auto || t.type !== 1)
            .map((t) => t.tag),
        matchChildTags: () => prefs["nestedTags.matchChildTags"] !== false,
        clearTagCache() {},
        invalidateTagCache: (ids) => invalidations.push(ids),
      },
      "src/tags/rules.ts": {
        ruleFor: (name) => rules.get(name),
        resolveTagStyle: (name, colors) => ({
          color: colors.get(name)?.color || rules.get(name)?.color || "#ccc",
        }),
      },
      "src/tags/menu.ts": { showTagContextMenu() {} },
      "src/views/itemFilter.ts": {
        canFilter: () => true,
        setItemFilter: (win, _key, predicate) => {
          filters.set(win, predicate);
          return true;
        },
        refreshItemView: async (win) => {
          refreshes.set(win, (refreshes.get(win) || 0) + 1);
        },
      },
    },
  });
  const api = harness.load("src/tags/nestedTree.ts");
  const tree = harness.load("src/tags/tree.ts");
  function scope(tags, library = 1) {
    scopes.set(library, {
      libraryID: library,
      inputs: tags.map((tag, i) => ({
        tag,
        count: 1,
        itemIDs: new Set([i + 1]),
      })),
      inView: new Set(tags),
      inLibrary: new Set(tags),
    });
  }
  scope(["#Method/A", "#Method/B", "#Topic/Lung"]);
  function window() {
    const win = windowFixture(),
      doc = win.document;
    const create = doc.createElement;
    const enhance = (node) => {
      node.classList.remove = (name) => {
        node.className = node.className
          .split(/\s+/)
          .filter((n) => n !== name)
          .join(" ");
      };
      node.classList.toggle = (name, on) => {
        if (on ?? !node.classList.contains(name)) node.classList.add(name);
        else node.classList.remove(name);
      };
      node.contains = (child) => {
        for (let n = child; n; n = n.parentElement) if (n === node) return true;
        return false;
      };
      node.insertBefore = (child, next) => {
        child.remove();
        child.parentElement = node;
        node.childNodes.splice(node.childNodes.indexOf(next), 0, child);
        return child;
      };
      Object.defineProperty(node, "tabIndex", {
        get: () => Number(node.getAttribute("tabindex") ?? -1),
        set: (value) => {
          node.setAttribute("tabindex", String(value));
        },
      });
      const focus = node.focus.bind(node);
      node.focus = () => {
        focus();
        node.dispatch("focus");
      };
      node.scrollTop = 0;
      return node;
    };
    doc.createElement = (tag) => enhance(create(tag));
    doc.createElementNS = (_namespace, tag) => doc.createElement(tag);
    doc.getElementById = (id) => {
      const walk = (node) =>
        node.id === id ? node : node.children.map(walk).find(Boolean);
      return walk(doc.documentElement) || null;
    };
    const container = doc.createElement("div"),
      native = doc.createElement("div");
    container.id = "zotero-tag-selector-container";
    native.id = "zotero-tag-selector";
    container.append(native);
    doc.body.append(container);
    win.libraryID = 1;
    rows.set(win, [new Item()]);
    win.ZoteroPane = { itemsView: { getSortedItems: () => rows.get(win) } };
    windows.push(win);
    api.installTagTree(win);
    return win;
  }
  const row = (win, name) =>
    [...win.document.querySelectorAll(".zest-tagtree-row")].find(
      (r) => r.getAttribute("data-tag") === name,
    );
  return {
    api,
    tree,
    prefs,
    scopes,
    scope,
    window,
    row,
    rows,
    Item,
    rules,
    filters,
    refreshes,
    clock,
    invalidations,
    get collects() {
      return collectCalls;
    },
    set collect(fn) {
      collect = fn;
    },
    notify: (type, ids) => handler.notify("modify", type, ids),
  };
}
const settle = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};

test("all separator choices are supported, including plus, tilde and angle brackets", () => {
  const f = fixture();
  const source = fs.readFileSync(
    path.join(
      path.dirname(module.filename),
      "../addon/content/preferences.xhtml",
    ),
    "utf8",
  );
  const block = source.match(
    /<menulist preference="nestedTags.linkSymbol"[\s\S]*?<\/menulist>/,
  )[0];
  const choices = [...block.matchAll(/value="([^"]+)"/g)].map((m) =>
    m[1].replace("&lt;", "<"),
  );
  assert.deepEqual(new Set(choices), new Set(f.tree.LINK_SYMBOLS));
  for (const separator of choices) {
    f.prefs["nestedTags.linkSymbol"] = separator;
    assert.equal(f.api.linkSymbol(), separator);
    assert.equal(
      f.tree.buildTagTree([{ tag: `A${separator}B`, count: 1 }], {
        linkSymbol: separator,
      })[0].children[0].name,
      `A${separator}B`,
    );
  }
});

test("tabs have text, search has a label, tree is multiselect and selections are removable", async () => {
  const f = fixture(),
    w = f.window();
  await f.api.refreshTagTree(w);
  const d = w.document;
  assert.equal(d.querySelectorAll(".zest-tagtree-tab span").length, 2);
  assert.equal(
    d.querySelector(".zest-tagtree-search").getAttribute("aria-label"),
    "tags-search-placeholder",
  );
  assert.equal(
    d.querySelector(".zest-tagtree-body").getAttribute("aria-multiselectable"),
    "true",
  );
  f.row(w, "Method").click();
  assert.equal(d.querySelectorAll(".zest-tagtree-chip").length, 1);
  assert.equal(d.querySelector(".zest-tagtree-selection").hidden, false);
  d.querySelector(".zest-tagtree-chip").click();
  assert.equal(f.filters.get(w), null);
  assert.equal(d.querySelector(".zest-tagtree-selection").hidden, true);
});

test("new descendants update a selected branch; unchanged refreshes do not reinstall filters", async () => {
  const f = fixture();
  f.scope(["#Method/A"]);
  const w = f.window();
  await f.api.refreshTagTree(w);
  f.row(w, "Method").click();
  const count = f.refreshes.get(w);
  await f.api.refreshTagTree(w);
  assert.equal(f.refreshes.get(w), count);
  f.scope(["#Method/A", "#Method/B"]);
  await f.api.refreshTagTree(w);
  assert.deepEqual(Array.from(f.api.selectedTagNames(w)).sort(), [
    "#Method/A",
    "#Method/B",
  ]);
  assert.equal(
    f.filters.get(w)([
      new f.Item([{ tag: "#Method/A" }]),
      new f.Item([{ tag: "#Method/B" }]),
    ]).length,
    2,
  );
  assert.equal(f.refreshes.get(w), count + 1);
});

test("child and automatic preferences update an existing filter without another click", async () => {
  const f = fixture(),
    w = f.window();
  await f.api.refreshTagTree(w);
  f.row(w, "Method").click();
  const child = new f.Item([], [{ tag: "#Method/A" }]);
  assert.equal(f.filters.get(w)([child]).length, 1);
  f.prefs["nestedTags.matchChildTags"] = false;
  await f.api.refreshTagTree(w);
  assert.equal(f.filters.get(w)([child]).length, 0);
  const automatic = new f.Item([{ tag: "#Method/A", type: 1 }]);
  assert.equal(f.filters.get(w)([automatic]).length, 1);
  f.prefs["extensions.zotero.tagSelector.showAutomatic"] = false;
  await f.api.refreshTagTree(w);
  assert.equal(f.filters.get(w)([automatic]).length, 0);
});

test("native/master preference paths clear selections and filters in every window", async () => {
  const f = fixture(),
    a = f.window(),
    b = f.window();
  await f.api.refreshTagTree(a);
  await f.api.refreshTagTree(b);
  f.row(a, "Method").click();
  f.row(b, "Topic").click();
  f.prefs["nestedTags.tab"] = "native";
  f.api.syncTagPanes();
  for (const w of [a, b]) {
    assert.equal(f.api.selectedTagNames(w).length, 0);
    assert.equal(f.filters.get(w), null);
    assert.equal(
      w.document.getElementById("zotero-tag-selector").hidden,
      false,
    );
  }
  f.prefs["nestedTags.tab"] = "tree";
  f.api.syncTagPanes();
  await f.api.refreshTagTree(a);
  f.row(a, "Method").click();
  f.prefs["nestedTags.show"] = false;
  f.api.syncTagPanes();
  assert.equal(f.filters.get(a), null);
});

test("deleted branches and library changes cannot leave an invisible filter", async () => {
  const f = fixture(),
    w = f.window();
  await f.api.refreshTagTree(w);
  f.row(w, "Method").click();
  f.scope(["#Other/Tag"]);
  await f.api.refreshTagTree(w);
  assert.equal(f.api.selectedTagNames(w).length, 0);
  assert.equal(f.filters.get(w), null);
  f.row(w, "Other").click();
  f.scope(["#Method/C"], 2);
  w.libraryID = 2;
  await f.api.refreshTagTree(w);
  assert.equal(f.api.selectedTagNames(w).length, 0);
  assert.equal(f.filters.get(w), null);
  assert.ok(f.row(w, "Method"));
});

test("tree refresh preserves focus and scroll without stealing search focus", async () => {
  const f = fixture(),
    w = f.window();
  await f.api.refreshTagTree(w);
  f.row(w, "Method").focus();
  const scroller = w.document.querySelector(".zest-tagtree-scroll");
  scroller.scrollTop = 54;
  await f.api.refreshTagTree(w);
  assert.equal(w.document.activeElement, f.row(w, "Method"));
  assert.equal(scroller.scrollTop, 54);
  // Background chrome windows may defer focus events while activeElement is
  // already updated. The renderer must use that actual node, not the event.
  w.document.activeElement = f.row(w, "Topic");
  await f.api.refreshTagTree(w);
  assert.equal(w.document.activeElement, f.row(w, "Topic"));
  const search = w.document.querySelector(".zest-tagtree-search");
  search.focus();
  await f.api.refreshTagTree(w);
  assert.equal(w.document.activeElement, search);
});

test("arrows traverse children and parents, and search Escape clears without losing focus", async () => {
  const f = fixture(),
    w = f.window();
  await f.api.refreshTagTree(w);
  const body = w.document.querySelector(".zest-tagtree-body");
  f.row(w, "Method").focus();
  body.dispatch("keydown", { key: "ArrowRight" });
  assert.equal(f.row(w, "Method").getAttribute("aria-expanded"), "true");
  body.dispatch("keydown", { key: "ArrowRight" });
  assert.equal(w.document.activeElement, f.row(w, "Method/A"));
  body.dispatch("keydown", { key: "ArrowLeft" });
  assert.equal(w.document.activeElement, f.row(w, "Method"));
  const search = w.document.querySelector(".zest-tagtree-search");
  search.focus();
  search.value = "missing";
  search.dispatch("input");
  f.clock.run(150);
  assert.equal(w.document.querySelectorAll(".zest-tagtree-row").length, 0);
  assert.match(
    w.document.querySelector(".zest-tagtree-empty").textContent,
    /tags-no-results/,
  );
  search.dispatch("keydown", { key: "Escape" });
  assert.equal(search.value, "");
  assert.equal(w.document.activeElement, search);
  assert.ok(f.row(w, "Method"));
});

test("Zest colour-only rules paint dots and sort/collapse tooltips reflect current state", async () => {
  const f = fixture();
  f.rules.set("Method", { color: "#ff0000" });
  const w = f.window();
  await f.api.refreshTagTree(w);
  assert.equal(
    f.row(w, "Method").querySelector(".zest-tagtree-dot").style.backgroundColor,
    "#ff0000",
  );
  assert.equal(w.document.querySelector(".zest-sort").title, "tags-sort-az");
  w.document.querySelector(".zest-sort").click();
  assert.equal(w.document.querySelector(".zest-sort").title, "tags-sort-za");
  const collapse = w.document.querySelector(".zest-collapse");
  assert.equal(collapse.title, "tags-expand-all");
  collapse.click();
  assert.equal(collapse.title, "tags-collapse-all");
});

test("in-flight old scopes are cancelled and do not render after switching tabs", async () => {
  const f = fixture(),
    w = f.window();
  await f.api.refreshTagTree(w);
  let release, cancelled;
  f.collect = (_library, _items, isCancelled) => {
    cancelled = isCancelled;
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const pending = f.api.refreshTagTree(w);
  f.prefs["nestedTags.tab"] = "native";
  f.api.syncTagPanes();
  assert.equal(cancelled(), true);
  const writes = w.document.writes;
  release(f.scopes.get(1));
  await pending;
  assert.equal(w.document.writes, writes);
});

test("stale refresh generations are discarded and failures expose a retry", async () => {
  const f = fixture(),
    w = f.window();
  await f.api.refreshTagTree(w);
  let release, cancelled;
  f.collect = (_library, _items, c) => {
    cancelled = c;
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const first = f.api.refreshTagTree(w);
  void f.api.refreshTagTree(w);
  assert.equal(cancelled(), true);
  f.collect = null;
  f.scope(["#Fresh/Tag"]);
  release({
    inputs: [{ tag: "#Old/Tag", count: 1 }],
    inView: new Set(["#Old/Tag"]),
  });
  await first;
  await settle();
  assert.ok(f.row(w, "Fresh"));
  assert.equal(f.row(w, "Old"), undefined);
  f.collect = async () => {
    throw Error("fixture failure");
  };
  await f.api.refreshTagTree(w);
  assert.equal(w.document.querySelectorAll(".zest-tagtree-row").length, 0);
  assert.ok(w.document.querySelector(".zest-tagtree-retry"));
  f.collect = null;
  w.document.querySelector(".zest-tagtree-retry").click();
  await settle();
  assert.ok(f.row(w, "Fresh"));
});

test("hidden trees skip collection and item deletion invalidates dependencies", async () => {
  const f = fixture(),
    w = f.window();
  await f.api.refreshTagTree(w);
  const calls = f.collects;
  f.prefs["nestedTags.tab"] = "native";
  f.api.syncTagPanes();
  await f.api.refreshTagTree(w);
  assert.equal(f.collects, calls);
  f.notify("item", [42]);
  assert.deepEqual(f.invalidations.at(-1), [42]);
  f.api.uninstallTagTree(w);
  await f.api.refreshTagTree(w);
  assert.equal(f.collects, calls);
});

test("scheduled refresh invalidates an in-flight snapshot immediately and debounces one rerun", async () => {
  const f = fixture(),
    w = f.window();
  await f.api.refreshTagTree(w);
  let release, cancelled;
  f.collect = (_lib, _items, c) => {
    cancelled = c;
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const pending = f.api.refreshTagTree(w);
  const before = f.collects;
  f.api.refreshAllTagTrees();
  f.api.refreshAllTagTrees();
  assert.equal(cancelled(), true);
  f.collect = null;
  f.scope(["#Fresh/Tag"]);
  release({
    inputs: [{ tag: "#Old/Tag", count: 1 }],
    inView: new Set(["#Old/Tag"]),
  });
  await pending;
  assert.equal(f.row(w, "Old"), undefined);
  assert.equal(f.collects, before);
  f.clock.run(300);
  await settle();
  assert.equal(f.collects, before + 1);
  assert.ok(f.row(w, "Fresh"));
});

test("quick native-tree round trips never revive the previously started request", async () => {
  const f = fixture(),
    w = f.window();
  await f.api.refreshTagTree(w);
  let release, cancelled;
  f.collect = (_lib, _items, c) => {
    cancelled = c;
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const pending = f.api.refreshTagTree(w);
  f.api.setTagPaneMode(w, "native");
  f.api.setTagPaneMode(w, "tree");
  assert.equal(cancelled(), true);
  f.collect = null;
  f.scope(["#Fresh/Tag"]);
  release({
    inputs: [{ tag: "#Old/Tag", count: 1 }],
    inView: new Set(["#Old/Tag"]),
  });
  await pending;
  assert.equal(f.row(w, "Old"), undefined);
  f.clock.run(0);
  await settle();
  assert.ok(f.row(w, "Fresh"));
});

test("cancelled refresh failures never render errors from a stale request", async () => {
  const f = fixture(),
    w = f.window();
  await f.api.refreshTagTree(w);
  let reject, cancelled;
  f.collect = (_lib, _items, c) => {
    cancelled = c;
    return new Promise((_resolve, fail) => {
      reject = fail;
    });
  };
  const pending = f.api.refreshTagTree(w);
  f.api.refreshAllTagTrees();
  assert.equal(cancelled(), true);
  const writes = w.document.writes;
  reject(Error("stale failure"));
  await pending;
  assert.equal(w.document.writes, writes);
  assert.equal(w.document.querySelector(".zest-tagtree-retry"), null);
  f.collect = null;
  f.scope(["#Fresh/Tag"]);
  f.clock.run(300);
  await settle();
  assert.ok(f.row(w, "Fresh"));
});
