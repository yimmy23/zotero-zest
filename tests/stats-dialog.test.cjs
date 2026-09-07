const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers.cjs");
const { config } = require("../package.json");

const NOW = new Date("2026-09-07T12:00:00").getTime();
const PANEL_URL = `chrome://${config.addonRef}/content/panel.xhtml`;
class FixedDate extends Date {
  constructor(...args) {
    super(...(args.length ? args : [NOW]));
  }
  static now() {
    return NOW;
  }
}

function events(target) {
  const listeners = new Map();
  target.listeners = listeners;
  target.addEventListener = (type, callback, options = {}) => {
    const entries = listeners.get(type) || new Map();
    entries.set(callback, options);
    listeners.set(type, entries);
  };
  target.removeEventListener = (type, callback) => {
    listeners.get(type)?.delete(callback);
  };
  target.dispatch = (type) => {
    for (const [callback, options] of [...(listeners.get(type) || [])]) {
      if (options.once) listeners.get(type).delete(callback);
      callback({ type, target, currentTarget: target });
    }
  };
}

/** Detached DOM: preserves text, attributes, focus and native event lifetimes. */
class Element {
  constructor(doc, tag) {
    this.ownerDocument = doc;
    this.tagName = tag;
    this.nodeType = tag === "#text" ? 3 : 1;
    this.childNodes = [];
    this.parentElement = null;
    this.className = "";
    this.attributes = new Map();
    this.style = {};
    this.open = false;
    this.text = "";
    this.classList = {
      contains: (name) => this.className.split(/\s+/).includes(name),
      add: (...names) => {
        this.className = [
          ...new Set([...this.className.split(/\s+/), ...names]),
        ]
          .filter(Boolean)
          .join(" ");
      },
    };
    this.dataset = new Proxy(
      {},
      {
        set: (_target, key, value) => {
          this.setAttribute(
            `data-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
            value,
          );
          return true;
        },
      },
    );
    events(this);
  }
  get children() {
    return this.childNodes.filter((node) => node.nodeType === 1);
  }
  get value() {
    if (this.tagName === "progress") return this._value ?? 0;
    if (this.tagName === "select") {
      const selected =
        this._selectedValue === undefined
          ? this.children.find((option) => option.selected) || this.children[0]
          : this.children.find(
              (option) => option.value === this._selectedValue,
            );
      return selected?.value || "";
    }
    return this._value || "";
  }
  set value(value) {
    if (this.tagName === "select") this._selectedValue = String(value);
    else if (this.tagName === "progress") this._value = Number(value);
    else this._value = String(value);
  }
  get textContent() {
    return this.text + this.childNodes.map((node) => node.textContent).join("");
  }
  set textContent(value) {
    this.ownerDocument.writes++;
    for (const child of this.childNodes) child.parentElement = null;
    this.childNodes = [];
    this.text = String(value);
  }
  append(...nodes) {
    for (const node of nodes) this.appendChild(node);
  }
  appendChild(node) {
    this.ownerDocument.writes++;
    node.remove();
    node.parentElement = this;
    this.childNodes.push(node);
    return node;
  }
  remove() {
    const siblings = this.parentElement?.childNodes;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
    this.parentElement = null;
  }
  setAttribute(name, value) {
    this.ownerDocument.writes++;
    this.attributes.set(name, String(value));
    if (name === "class") this.className = String(value);
  }
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
  matches(selector) {
    const attrs = [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
    if (
      attrs.some(([, name, value]) =>
        value === undefined
          ? !this.attributes.has(name)
          : this.getAttribute(name) !== value,
      )
    )
      return false;
    const base = selector.replace(/\[[^\]]+\]/g, "");
    const [tag, ...classes] = base.split(".");
    return (
      (!tag || this.tagName === tag) &&
      classes.every((name) => this.classList.contains(name))
    );
  }
  querySelectorAll(selector) {
    const parts = selector.trim().split(/\s+/);
    const found = [];
    const matches = (node) => {
      if (!node.matches(parts.at(-1))) return false;
      let ancestor = node.parentElement;
      for (let i = parts.length - 2; i >= 0; i--) {
        while (ancestor && !ancestor.matches(parts[i]))
          ancestor = ancestor.parentElement;
        if (!ancestor) return false;
        ancestor = ancestor.parentElement;
      }
      return true;
    };
    const walk = (node) => {
      for (const child of node.children) {
        if (matches(child)) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  click() {
    this.dispatch("click");
  }
  focus() {
    this.ownerDocument.activeElement = this;
  }
}

function windowFixture({
  readyState = "complete",
  body = true,
  url = PANEL_URL,
} = {}) {
  const doc = {
    readyState,
    documentURI: url,
    URL: url,
    location: { href: url },
    activeElement: null,
    writes: 0,
    createElement: (tag) => new Element(doc, tag),
    createElementNS: (_namespace, tag) => new Element(doc, tag),
    createTextNode: (text) => {
      const node = new Element(doc, "#text");
      node.text = text;
      return node;
    },
    querySelector: (selector) => doc.documentElement.querySelector(selector),
    querySelectorAll: (selector) =>
      doc.documentElement.querySelectorAll(selector),
  };
  doc.documentElement = doc.createElement("html");
  const attachBody = () => {
    doc.body = doc.createElement("body");
    doc.documentElement.append(doc.body);
  };
  if (body) attachBody();
  const win = {
    document: doc,
    location: doc.location,
    closed: false,
    closeCount: 0,
    focusCount: 0,
    scrollY: 0,
    focus() {
      this.focusCount++;
    },
    scrollTo(_x, y) {
      this.scrollY = y;
    },
    close() {
      this.closeCount++;
      this.closed = true;
      this.dispatch("unload");
    },
    finishLoad() {
      if (doc.documentURI !== PANEL_URL) {
        doc.body?.remove();
        attachBody();
      }
      if (!doc.body) attachBody();
      doc.documentURI = PANEL_URL;
      doc.URL = PANEL_URL;
      doc.location.href = PANEL_URL;
      doc.readyState = "complete";
      this.dispatch("load");
    },
  };
  events(win);
  doc.defaultView = win;
  return win;
}

function record(seconds = 600, day = "2026-09-07") {
  return {
    total: seconds,
    days: new Map([[day, seconds]]),
    page: new Map([[0, seconds]]),
  };
}

function setup({
  entries = [["1/READ0001", record()]],
  windows,
  loaded = true,
} = {}) {
  const records = new Map(entries);
  const source = JSON.stringify(
    [...records].map(([key, rec]) => [
      key,
      rec.total,
      [...rec.days],
      [...rec.page],
    ]),
  );
  const allWindows = windows || [windowFixture()];
  let opens = 0;
  let reads = 0;
  const lookups = [];
  const logs = [];
  const localeCalls = [];
  const prefWrites = [];
  const prefs = new Map([
    ["stats.dailyGoalMinutes", 30],
    ["stats.weeklyGoalDays", 5],
  ]);
  const allowedPrefs = new Set(prefs.keys());
  const openCalls = [];
  const unexpected = () => {
    throw new Error("statistics must not write, subscribe or schedule work");
  };
  const store = {
    loaded,
    entries: () => {
      reads++;
      return records.entries();
    },
    onChange: unexpected,
    addSample: unexpected,
    mergeRecord: unexpected,
    flush: unexpected,
    clearItem: unexpected,
    clearAll: unexpected,
  };
  const host = {
    open: () => {
      throw new Error("Zotero chrome windows must use openDialog");
    },
    openDialog: (...args) => {
      openCalls.push(args);
      return allWindows[opens++];
    },
  };
  const h = createHarness({
    globals: {
      Date: FixedDate,
      setTimeout: unexpected,
      setInterval: unexpected,
      ztoolkit: { log: (...args) => logs.push(args) },
      Services: { wm: { getEnumerator: () => allWindows } },
      Zotero: {
        getMainWindow: () => host,
        logError: (error) => logs.push(error),
        Items: {
          getByLibraryAndKey(libraryID, key) {
            lookups.push([libraryID, key]);
            return { getField: () => `Title ${key}` };
          },
        },
      },
    },
    mocks: {
      "src/reading/store.ts": {
        readingStore: store,
        splitKey: (key) => [Number(key.split("/")[0]), key.split("/")[1]],
      },
      "src/utils/locale.ts": {
        getString: (key, options) => {
          const args = options?.args;
          localeCalls.push({ key, args });
          if (key === "stats-hours") return `${args.value} h`;
          if (key === "stats-minutes") return `${args.value} min`;
          if (key === "stats-seconds") return `${args.value} s`;
          if (key === "stats-goal-remaining") return `remaining ${args.value}`;
          return key;
        },
      },
      "src/utils/prefs.ts": {
        getPref: (key) => prefs.get(key),
        setPref: (key, value) => {
          assert.ok(
            allowedPrefs.has(key),
            `unexpected preference write: ${key}`,
          );
          prefs.set(key, value);
          prefWrites.push([key, value]);
        },
      },
      "src/ui/icons.ts": {
        icon: (doc) => doc.createElement("span"),
        ICON_CSS: "",
      },
      "src/ui/styles.ts": {
        accentColor: () => {
          throw new Error("statistics must use its dedicated chart palette");
        },
      },
    },
  });
  return {
    ...h.load("src/panes/statsDialog.ts"),
    host,
    store,
    records,
    lookups,
    logs,
    localeCalls,
    prefs,
    prefWrites,
    openCalls,
    win: allWindows[0],
    windows: allWindows,
    opens: () => opens,
    reads: () => reads,
    assertUnchanged(expectedPrefWrites = []) {
      assert.equal(
        JSON.stringify(
          [...records].map(([key, rec]) => [
            key,
            rec.total,
            [...rec.days],
            [...rec.page],
          ]),
        ),
        source,
      );
      assert.deepEqual(
        logs,
        [],
        "guard must not silently hide a rendering error",
      );
      assert.deepEqual(prefWrites, expectedPrefWrites);
    },
  };
}

test("only the twelve highest-time titles are resolved in a large reading index", () => {
  const entries = Array.from({ length: 2000 }, (_, index) => [
    `1/READ${String(index).padStart(4, "0")}`,
    record(index + 1),
  ]);
  const app = setup({ entries });
  const stats = app.collectStats(new FixedDate());
  assert.equal(app.reads(), 1);
  assert.equal(stats.itemCount, 2000);
  assert.equal(stats.topItems.length, 12);
  assert.equal(app.lookups.length, 12);
  assert.equal(stats.topItems[0].title, "Title READ1999");
  assert.equal(stats.topItems.at(-1).title, "Title READ1988");
  app.assertUnchanged();
});

test("the real light and dark chart palettes have three distinct colours with surface contrast", () => {
  const { READING_STATS_PALETTE: palette } =
    createHarness().load("src/ui/palette.ts");
  const app = setup();
  app.openStatsDialog(app.host);
  const css = app.win.document.querySelector("style").textContent;
  const surfaces = [
    ...css.matchAll(/--zest-surface:\s*(#[0-9a-f]{3,6})\s*;/gi),
  ].map((match) => match[1]);
  assert.equal(surfaces.length, 2, "both theme surfaces must be declared");
  const textColours = ["fg", "muted"].map((token) =>
    [
      ...css.matchAll(
        new RegExp(`--zest-${token}:\\s*(#[0-9a-f]{6})\\s*;`, "gi"),
      ),
    ].map((match) => match[1]),
  );
  const luminance = (hex) => {
    const rgb =
      hex.length === 4
        ? hex
            .slice(1)
            .split("")
            .map((digit) => digit + digit)
            .join("")
        : hex.slice(1);
    return [0.2126, 0.7152, 0.0722].reduce((sum, weight, index) => {
      const channel = parseInt(rgb.slice(index * 2, index * 2 + 2), 16) / 255;
      const linear =
        channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4;
      return sum + weight * linear;
    }, 0);
  };
  for (const [index, theme] of ["light", "dark"].entries()) {
    assert.deepEqual(Object.keys(palette[theme]).sort(), [
      "blue",
      "bronze",
      "violet",
    ]);
    const colours = Object.values(palette[theme]);
    assert.equal(new Set(colours.map((value) => value.toLowerCase())).size, 3);
    for (const colour of colours) {
      assert.match(colour, /^#[0-9a-f]{6}$/i);
      const a = luminance(colour);
      const b = luminance(surfaces[index]);
      const contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      assert.ok(
        contrast >= 3,
        `${theme} ${colour} contrast ${contrast.toFixed(2)} must be at least 3:1`,
      );
    }
    for (const values of textColours) {
      assert.equal(values.length, 2);
      const a = luminance(values[index]);
      const b = luminance(surfaces[index]);
      assert.ok(
        (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5,
        `${theme} normal and secondary text must be readable on panel surfaces`,
      );
    }
  }
  app.assertUnchanged();
});

test("rendered colour tokens map each ring and achievement to its semantic family", () => {
  const { READING_STATS_PALETTE: palette } =
    createHarness().load("src/ui/palette.ts");
  const app = setup();
  app.openStatsDialog(app.host);
  const doc = app.win.document;
  const css = doc.querySelector("style").textContent;
  ["blue", "violet", "bronze"].forEach((colour, index) => {
    for (const theme of ["light", "dark"]) {
      assert.match(
        css,
        new RegExp(`--zest-stats-${colour}:\\s*${palette[theme][colour]}`, "i"),
      );
    }
    assert.match(
      css,
      new RegExp(
        `\\.zest-ring-${index}\\s*\\{[^}]*--ring-color:\\s*var\\(--zest-stats-${colour}\\)`,
      ),
    );
  });
  assert.deepEqual(
    doc
      .querySelectorAll(".zest-achievement")
      .map((card) => card.getAttribute("data-metric")),
    [
      "seconds",
      "seconds",
      "seconds",
      "seconds",
      "items",
      "items",
      "days",
      "days",
      "days",
    ],
  );
  assert.match(
    css,
    /\.zest-achievement\s*\{[^}]*--achievement-color:\s*var\(--zest-stats-blue\)/,
  );
  assert.match(
    css,
    /\.zest-achievement\[data-metric=items\]\s*\{[^}]*--achievement-color:\s*var\(--zest-stats-violet\)/,
  );
  assert.match(
    css,
    /\.zest-achievement\[data-metric=days\]\s*\{[^}]*--achievement-color:\s*var\(--zest-stats-bronze\)/,
  );
  app.assertUnchanged();
});

test("a complete window renders once on open and adds no redundant load handler", () => {
  const app = setup();
  app.openStatsDialog(app.host);
  assert.equal(app.openCalls[0][0], PANEL_URL);
  assert.equal(app.reads(), 1);
  assert.equal(app.win.listeners.get("load")?.size || 0, 0);
  app.win.dispatch("load");
  assert.equal(app.reads(), 1);
  app.openStatsDialog(app.host);
  assert.equal(app.opens(), 1);
  assert.equal(app.win.focusCount, 1);
  assert.equal(app.reads(), 2, "reopening deliberately refreshes the snapshot");
  assert.equal(app.win.document.querySelectorAll(".zest-stats").length, 1);
  app.assertUnchanged();
});

test("a complete about:blank document waits for the target chrome document to load", () => {
  const win = windowFixture({ url: "about:blank" });
  const app = setup({ windows: [win] });
  app.openStatsDialog(app.host);
  assert.equal(app.reads(), 0, "about:blank is not the ready panel document");
  assert.equal(win.document.querySelector(".zest-stats"), null);
  assert.equal(win.listeners.get("load")?.size, 1);
  assert.equal(win.listeners.get("unload")?.size || 0, 0);
  win.dispatch("load");
  assert.equal(app.reads(), 0, "a blank-page load must not render the panel");
  assert.equal(win.listeners.get("load")?.size, 1);
  win.dispatch("unload");
  assert.equal(
    win.listeners.get("load")?.size,
    1,
    "about:blank unload must not cancel the actual panel load",
  );
  assert.doesNotThrow(() => app.openStatsDialog(app.host));
  assert.equal(app.opens(), 1);
  assert.equal(
    app.reads(),
    0,
    "reopening must not paint the transient document",
  );
  win.finishLoad();
  assert.equal(app.reads(), 1);
  assert.equal(win.document.querySelectorAll(".zest-stats").length, 1);
  assert.equal(win.listeners.get("load")?.size, 0);
  assert.equal(win.listeners.get("unload")?.size, 1);
  win.dispatch("load");
  assert.equal(app.reads(), 1, "the completed load callback is one-shot");
  app.assertUnchanged();
});

test("closing after blank-page events cancels the pending target load without reviving the window", () => {
  const blank = windowFixture({ url: "about:blank" });
  const next = windowFixture();
  const app = setup({ windows: [blank, next] });
  app.openStatsDialog(app.host);
  const lateLoad = [...blank.listeners.get("load").keys()][0];
  blank.dispatch("load");
  blank.dispatch("unload");
  app.closeStatsDialog();
  assert.equal(blank.closed, true);
  assert.equal(blank.listeners.get("load").size, 0);
  blank.finishLoad();
  lateLoad();
  assert.equal(app.reads(), 0);
  assert.equal(blank.document.querySelector(".zest-stats"), null);
  app.openStatsDialog(app.host);
  assert.equal(app.opens(), 2);
  assert.equal(app.reads(), 1);
  lateLoad();
  assert.equal(
    app.reads(),
    1,
    "a stale callback must not replace the new panel",
  );
  assert.equal(next.document.querySelectorAll(".zest-stats").length, 1);
  app.assertUnchanged();
});

test("range and refresh preserve expanded details, focus and scroll without subscriptions", () => {
  const app = setup();
  app.openStatsDialog(app.host);
  const doc = app.win.document;
  assert.equal(doc.querySelectorAll(".zest-stats-card").length, 6);
  assert.equal(doc.querySelectorAll(".zest-achievement progress").length, 9);
  assert.equal(doc.querySelectorAll("svg.zest-medal").length, 9);
  assert.ok(doc.querySelector("svg.zest-stats-trend"));
  assert.equal(doc.querySelector(".zest-stats-weekdays").children.length, 7);
  assert.equal(
    doc.querySelector('[data-range="30"]').getAttribute("aria-pressed"),
    "true",
  );
  doc.querySelector(".zest-stats-data").open = true;
  app.win.scrollY = 280;
  const range = doc.querySelector('[data-range="7"]');
  range.focus();
  range.click();
  assert.equal(app.reads(), 1, "range changes reuse the current snapshot");
  assert.ok(doc.querySelector('[data-period-days="7"]'));
  assert.equal(
    doc.querySelectorAll(".zest-stats-daily-table tbody tr").length,
    7,
  );
  assert.equal(doc.querySelector(".zest-stats-data").open, true);
  assert.equal(doc.activeElement.getAttribute("data-focus"), "range-7");
  assert.equal(app.win.scrollY, 280);
  const refresh = doc.querySelector(".zest-stats-refresh");
  refresh.focus();
  refresh.click();
  assert.equal(app.reads(), 2);
  assert.ok(doc.querySelector('[data-period-days="7"]'));
  assert.equal(doc.querySelector(".zest-stats-data").open, true);
  assert.equal(doc.querySelectorAll(".zest-stats").length, 1);
  assert.equal(doc.activeElement.getAttribute("data-focus"), "refresh");
  assert.equal(app.win.scrollY, 280);
  app.assertUnchanged();
});

test("reading changes remain a snapshot until an explicit refresh", () => {
  const app = setup();
  app.openStatsDialog(app.host);
  const doc = app.win.document;
  const original = doc.querySelector(".zest-stats-summary").textContent;
  const writes = doc.writes;
  app.records.set("1/READ0002", record(900));
  assert.equal(app.reads(), 1);
  assert.equal(doc.writes, writes);
  assert.equal(doc.querySelector(".zest-stats-summary").textContent, original);
  doc.querySelector('[data-range="90"]').click();
  assert.equal(app.reads(), 1, "changing range must not reload source records");
  assert.equal(doc.querySelector(".zest-stats-summary").textContent, original);
  doc.querySelector(".zest-stats-refresh").click();
  assert.equal(app.reads(), 2);
  assert.notEqual(
    doc.querySelector(".zest-stats-summary").textContent,
    original,
  );
  assert.deepEqual(app.logs, []);
});

test("goal rings expose matching native progress and retain the default targets without writing them", () => {
  const app = setup({ entries: [["1/READ0001", record(1800)]] });
  app.openStatsDialog(app.host);
  const doc = app.win.document;
  assert.equal(doc.querySelectorAll(".zest-ring-progress").length, 3);
  assert.equal(doc.querySelectorAll(".zest-ring-track").length, 3);
  assert.equal(doc.querySelectorAll(".zest-goal-day").length, 7);
  assert.equal(doc.querySelectorAll(".zest-goal-day.is-achieved").length, 1);
  assert.equal(
    doc.querySelector('[data-focus="stats-dailyGoalMinutes"]').value,
    "30",
  );
  assert.equal(
    doc.querySelector('[data-focus="stats-weeklyGoalDays"]').value,
    "5",
  );
  const progress = doc.querySelectorAll(".zest-goal-metric progress");
  assert.deepEqual(
    progress.map((node) => [node.value, node.max]),
    [
      [1800, 1800],
      [1800, 9000],
      [1, 5],
    ],
  );
  const arcs = doc.querySelectorAll(".zest-ring-progress");
  for (let i = 0; i < arcs.length; i++) {
    const perimeter = Number(arcs[i].getAttribute("stroke-dasharray"));
    const offset = Number(arcs[i].getAttribute("stroke-dashoffset"));
    assert.ok(
      Math.abs(1 - offset / perimeter - progress[i].value / progress[i].max) <
        1e-10,
    );
  }
  app.assertUnchanged();
});

test("every weekly target preset is displayed exactly, matching the native progress maximum", () => {
  const expected = [
    ["45 min", "1 h 15 min", "1 h 45 min"],
    ["1 h 30 min", "2 h 30 min", "3 h 30 min"],
    ["2 h 15 min", "3 h 45 min", "5 h 15 min"],
    ["3 h", "5 h", "7 h"],
  ];
  for (const [i, minutes] of [15, 30, 45, 60].entries()) {
    for (const [j, days] of [3, 5, 7].entries()) {
      const app = setup();
      app.prefs.set("stats.dailyGoalMinutes", minutes);
      app.prefs.set("stats.weeklyGoalDays", days);
      app.openStatsDialog(app.host);
      const row = app.win.document.querySelector(
        ".zest-goal-metric.zest-ring-1",
      );
      assert.equal(
        row.querySelector(".zest-goal-target").textContent,
        ` / ${expected[i][j]}`,
      );
      assert.equal(row.querySelector("progress").max, minutes * days * 60);
      app.assertUnchanged();
    }
  }
});

test("changing goals updates only the two target preferences and never rewrites source data or achievements", () => {
  const app = setup({ entries: [["1/READ0001", record(1800)]] });
  app.openStatsDialog(app.host);
  const doc = app.win.document;
  const achievements = doc
    .querySelectorAll(".zest-achievement")
    .map((node) => node.textContent);
  doc.querySelector('[data-range="7"]').click();
  doc.querySelector(".zest-stats-data").open = true;
  const daily = doc.querySelector('[data-focus="stats-dailyGoalMinutes"]');
  daily.value = "45";
  daily.focus();
  daily.dispatch("change");
  assert.equal(app.reads(), 1);
  assert.equal(
    doc.querySelector('[data-focus="stats-dailyGoalMinutes"]').value,
    "45",
  );
  assert.equal(
    doc.activeElement.getAttribute("data-focus"),
    "stats-dailyGoalMinutes",
  );
  assert.equal(doc.querySelector(".zest-stats-data").open, true);
  assert.ok(doc.querySelector('[data-period-days="7"]'));
  assert.equal(doc.querySelectorAll(".zest-goal-day.is-achieved").length, 0);
  let progress = doc.querySelectorAll(".zest-goal-metric progress");
  assert.deepEqual(
    progress.map((node) => [node.value, node.max]),
    [
      [1800, 2700],
      [1800, 13500],
      [0, 5],
    ],
  );
  const weekly = doc.querySelector('[data-focus="stats-weeklyGoalDays"]');
  weekly.value = "3";
  weekly.dispatch("change");
  assert.equal(app.reads(), 1);
  progress = doc.querySelectorAll(".zest-goal-metric progress");
  assert.deepEqual(
    progress.map((node) => [node.value, node.max]),
    [
      [1800, 2700],
      [1800, 8100],
      [0, 3],
    ],
  );
  assert.deepEqual(
    doc.querySelectorAll(".zest-achievement").map((node) => node.textContent),
    achievements,
  );
  doc.querySelector(".zest-stats-refresh").click();
  assert.equal(app.reads(), 2);
  assert.equal(
    doc.querySelector('[data-focus="stats-dailyGoalMinutes"]').value,
    "45",
  );
  assert.equal(
    doc.querySelector('[data-focus="stats-weeklyGoalDays"]').value,
    "3",
  );
  app.assertUnchanged([
    ["stats.dailyGoalMinutes", 45],
    ["stats.weeklyGoalDays", 3],
  ]);
});

test("invalid goal selections neither persist preferences nor trigger a new snapshot", () => {
  const app = setup();
  app.openStatsDialog(app.host);
  for (const key of ["stats-dailyGoalMinutes", "stats-weeklyGoalDays"]) {
    const select = app.win.document.querySelector(`[data-focus="${key}"]`);
    select.value = "999";
    select.dispatch("change");
  }
  assert.equal(app.reads(), 1);
  app.assertUnchanged();
});

test("sub-target durations show exact seconds instead of rounding goals or achievements up", () => {
  const goals = setup({ entries: [["1/READ0001", record(1799)]] });
  goals.openStatsDialog(goals.host);
  const row = goals.win.document.querySelector(".zest-goal-metric.zest-ring-0");
  assert.equal(row.querySelector("strong").textContent, "29 min 59 s / 30 min");
  assert.equal(
    row.querySelector(".zest-goal-amount").textContent,
    "29 min 59 s",
  );
  assert.equal(row.querySelector(".zest-goal-target").textContent, " / 30 min");
  assert.equal(
    row.querySelector(".zest-goal-detail").textContent,
    "remaining 1 s",
  );
  assert.equal(row.querySelector("progress").value, 1799);
  assert.equal(row.querySelector("progress").max, 1800);
  assert.ok(
    goals.localeCalls.some(
      ({ key, args }) => key === "stats-goal-remaining" && args.value === "1 s",
    ),
  );
  goals.assertUnchanged();

  const awards = setup({ entries: [["1/READ0001", record(299)]] });
  awards.openStatsDialog(awards.host);
  const first = awards.win.document
    .querySelectorAll(".zest-achievement")
    .find(
      (card) =>
        card.querySelector("h3").textContent ===
        "stats-achievement-first-reading",
    );
  assert.equal(
    first.querySelector(".zest-achievement-current").textContent,
    "4 min 59 s / 5 min",
  );
  assert.equal(first.classList.contains("is-unlocked"), false);
  assert.ok(
    first.querySelector("progress").value < first.querySelector("progress").max,
  );
  assert.ok(
    awards.localeCalls.some(
      ({ key, args }) => key === "stats-seconds" && args.value === 59,
    ),
  );
  awards.assertUnchanged();
});

test("closing a still-loading window prevents even a captured late load callback from rendering", () => {
  const win = windowFixture({ readyState: "loading", body: false });
  const app = setup({ windows: [win] });
  app.openStatsDialog(app.host);
  const lateLoad = [...win.listeners.get("load").keys()][0];
  assert.equal(app.reads(), 0);
  app.closeStatsDialog();
  assert.equal(win.closed, true);
  assert.equal(win.listeners.get("load").size, 0);
  lateLoad();
  assert.equal(app.reads(), 0);
  app.assertUnchanged();
});

test("reopening a still-loading window waits for its body and does not create another window", () => {
  const win = windowFixture({ readyState: "loading", body: false });
  const app = setup({ windows: [win] });
  app.openStatsDialog(app.host);
  assert.doesNotThrow(() => app.openStatsDialog(app.host));
  assert.equal(app.opens(), 1);
  assert.equal(app.reads(), 0);
  assert.equal(win.listeners.get("load").size, 1);
  win.finishLoad();
  assert.equal(app.reads(), 1);
  assert.equal(win.document.querySelectorAll(".zest-stats").length, 1);
  app.assertUnchanged();
});

test("shutdown closes the tracked and stale statistics windows but leaves other windows alone", () => {
  const current = windowFixture();
  const stale = windowFixture();
  const unrelated = windowFixture();
  const marker = stale.document.createElement("main");
  marker.className = "zest-stats";
  stale.document.body.append(marker);
  const app = setup({ windows: [current, stale, unrelated] });
  app.openStatsDialog(app.host);
  app.closeStatsDialog();
  assert.equal(current.closed, true);
  assert.equal(stale.closed, true);
  assert.equal(unrelated.closed, false);
  assert.equal(unrelated.closeCount, 0);
  app.assertUnchanged();
});

test("a late old-window unload does not invalidate a newer statistics window", () => {
  const first = windowFixture();
  const second = windowFixture();
  const app = setup({ windows: [first, second] });
  app.openStatsDialog(app.host);
  first.closed = true;
  app.openStatsDialog(app.host);
  first.dispatch("unload");
  app.openStatsDialog(app.host);
  assert.equal(app.opens(), 2);
  assert.equal(second.focusCount, 1);
  assert.equal(second.document.querySelectorAll(".zest-stats").length, 1);
  app.assertUnchanged();
});

test("unloaded and empty stores render explicit states without fetching or writing data", () => {
  for (const loaded of [false, true]) {
    const app = setup({ entries: [], loaded });
    app.openStatsDialog(app.host);
    const text =
      app.win.document.querySelector(".zest-stats-notice").textContent;
    assert.equal(text, loaded ? "stats-empty" : "stats-not-ready");
    assert.equal(app.lookups.length, 0);
    assert.equal(
      app.win.document.querySelectorAll(".zest-achievement progress").length,
      9,
    );
    app.assertUnchanged();
  }
});
