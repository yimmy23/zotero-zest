const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHarness } = require("./helpers.cjs");
const { config } = require("../package.json");

const NOW = new Date("2026-09-07T12:00:00").getTime();
const PANEL_URL = `chrome://${config.addonRef}/content/panel.xhtml`;

test("bundled achievement artwork stays local and below a 50 KiB asset budget", () => {
  const dir = path.join(
    path.dirname(module.filename),
    "../addon/content/images/achievements",
  );
  const files = fs.readdirSync(dir).sort();
  assert.deepEqual(files, [
    "reading-library.webp",
    "reading-streak.webp",
    "reading-time.webp",
  ]);
  let size = 0;
  for (const file of files) {
    const bytes = fs.readFileSync(path.join(dir, file));
    assert.equal(bytes.subarray(0, 4).toString(), "RIFF");
    assert.equal(bytes.subarray(8, 12).toString(), "WEBP");
    size += bytes.length;
  }
  assert.ok(size < 50 * 1024, `${size} bytes`);
});
class FixedDate extends Date {
  constructor(...args) {
    super(...(args.length ? args : [NOW]));
  }
  static now() {
    return NOW;
  }
}

const { windowFixture } = require("./dialog-fixture.cjs");

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
  dateClass = FixedDate,
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
  const listeners = new Set();
  const unexpected = () => {
    throw new Error("statistics must not write, subscribe or schedule work");
  };
  const store = {
    loaded,
    entries: () => {
      reads++;
      return records.entries();
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
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
      Date: dateClass,
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
    emitChange() {
      for (const listener of [...listeners]) listener([]);
    },
    listenerCount: () => listeners.size,
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
    [...css.matchAll(new RegExp(`--zest-${token}:\\s*([^;]+)\\s*;`, "gi"))].map(
      (match) => match[1],
    ),
  );
  const channels = (colour, background = "#ffffff") => {
    if (colour.startsWith("rgb")) {
      const values = colour.match(/[\d.]+/g).map(Number);
      assert.ok(values.length === 3 || values.length === 4);
      const alpha = values[3] ?? 1;
      const base = channels(background);
      return values
        .slice(0, 3)
        .map((v, i) => v * alpha + base[i] * (1 - alpha));
    }
    assert.match(colour, /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i);
    const rgb =
      colour.length === 4
        ? colour
            .slice(1)
            .split("")
            .map((digit) => digit + digit)
            .join("")
        : colour.slice(1);
    return [0, 1, 2].map((i) => parseInt(rgb.slice(i * 2, i * 2 + 2), 16));
  };
  const luminance = (colour, background) => {
    const rgb = channels(colour, background);
    return [0.2126, 0.7152, 0.0722].reduce((sum, weight, index) => {
      const channel = rgb[index] / 255;
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
      const a = luminance(values[index], surfaces[index]);
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
  assert.equal(doc.querySelectorAll(".zest-medal img").length, 9);
  assert.equal(
    new Set(doc.querySelectorAll(".zest-medal img").map((image) => image.src))
      .size,
    3,
  );
  for (const image of doc.querySelectorAll(".zest-medal img")) {
    assert.match(
      image.src,
      /^chrome:\/\/zest\/content\/images\/achievements\/reading-(time|library|streak)\.webp$/,
    );
    assert.equal(image.loading, "lazy");
    assert.equal(image.alt, "");
  }
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
  app.emitChange();
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
  marker.className = "zest-stats zest-stats-standalone";
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

test("unloaded embedded statistics show an unknown value instead of a false zero", () => {
  const app = setup({ loaded: false, entries: [] });
  const mount = app.mountStats(app.win);
  const button = app.win.document.querySelector(".zest-stats-open-details");
  assert.equal(button.getAttribute("aria-busy"), "true");
  assert.equal(button.querySelector("strong").textContent, "—");
  app.store.loaded = true;
  app.emitChange();
  assert.equal(app.reads(), 2);
  assert.equal(
    app.win.document
      .querySelector(".zest-stats-open-details")
      .getAttribute("aria-busy"),
    null,
  );
  assert.equal(
    app.win.document.querySelector(".zest-rings-centre strong").textContent,
    "stats-zero-time",
  );
  mount.refresh();
  assert.equal(app.reads(), 3);
});

test("embedded statistics render only clickable rings without resolving document titles", () => {
  const app = setup({
    entries: Array.from({ length: 2000 }, (_, index) => [
      `1/READ${String(index).padStart(4, "0")}`,
      record(index === 0 ? 599 : 0),
    ]),
  });
  let opens = 0;
  app.mountStats(app.win, () => opens++);
  const doc = app.win.document;
  const button = doc.querySelector(".zest-stats-open-details");
  assert.equal(
    button.tagName,
    "button",
    "native button supports Enter and Space",
  );
  assert.equal(button.type, "button");
  assert.equal(button.disabled, false);
  assert.equal(
    button.listeners.has("keydown"),
    false,
    "native activation must not be duplicated",
  );
  button.focus();
  assert.equal(doc.activeElement, button);
  button.click();
  assert.equal(opens, 1);
  assert.equal(app.reads(), 1);
  assert.equal(
    app.lookups.length,
    0,
    "sidebar never resolves most-read titles",
  );
  assert.equal(doc.querySelectorAll("button").length, 1);
  assert.equal(doc.querySelectorAll(".zest-ring-progress").length, 3);
  assert.equal(doc.querySelectorAll(".zest-ring-track").length, 3);
  assert.match(button.getAttribute("aria-label"), /sidebar-open-window/);
  assert.match(button.getAttribute("aria-label"), /9 min 59 s \/ 30 min/);
  assert.match(button.getAttribute("aria-label"), /stats-ring-week-time/);
  assert.match(button.getAttribute("aria-label"), /stats-ring-week-days/);
  assert.equal(button.title, button.getAttribute("aria-label"));
  for (const selector of [
    ".zest-stats-header",
    ".zest-stats-summary",
    ".zest-stats-charts",
    ".zest-cal",
    ".zest-achievements",
    ".zest-goal-controls",
    ".zest-stats-top",
    ".zest-goal-week",
  ])
    assert.equal(
      doc.querySelector(selector),
      null,
      `${selector} is not built in the sidebar`,
    );
  const css = doc.querySelector("style").textContent;
  assert.match(css, /\.zest-stats-open-details[^}]*width:min\(172px,100%\)/);
  app.assertUnchanged();
});

test("embedded and standalone statistics have independent snapshots", () => {
  const standalone = windowFixture();
  const embedded = windowFixture();
  const app = setup({ windows: [standalone, embedded] });
  app.openStatsDialog(app.host);
  const mount = app.mountStats(embedded);
  assert.equal(app.reads(), 2);
  assert.equal(app.opens(), 1, "embedding must not open a second dialog");
  const standard = standalone.document;
  const sidebar = embedded.document;
  assert.ok(standard.querySelector(".zest-stats-standalone"));
  assert.ok(sidebar.querySelector(".zest-stats-embedded"));
  standard.querySelector('[data-range="7"]').click();
  assert.ok(standard.querySelector('[data-period-days="7"]'));
  assert.equal(sidebar.querySelector('[data-range="90"]'), null);
  assert.equal(app.reads(), 2, "standalone range reuses its own snapshot");
  const before = standard.querySelector(".zest-stats-summary").textContent;
  const previousToday = sidebar.querySelector(".zest-rings-centre").textContent;
  app.records.set("1/READ0002", record(900));
  mount.refresh();
  assert.equal(app.reads(), 3);
  assert.equal(
    standard.querySelector(".zest-stats-summary").textContent,
    before,
  );
  assert.notEqual(
    sidebar.querySelector(".zest-rings-centre").textContent,
    previousToday,
  );
  assert.ok(standard.querySelector('[data-period-days="7"]'));
  assert.equal(app.lookups.length, 1, "embedded refresh never resolves titles");
  app.closeStatsDialog();
  assert.equal(standalone.closed, true);
  assert.equal(embedded.closed, false);
  assert.ok(sidebar.querySelector(".zest-stats-embedded"));
  mount.refresh();
  assert.equal(
    app.reads(),
    4,
    "closing the dialog leaves sidebar ownership intact",
  );
  assert.deepEqual(app.logs, []);
  assert.deepEqual(app.prefWrites, []);
});

test("ring buttons without a host callback open the complete standalone statistics", () => {
  const standalone = windowFixture();
  const embedded = windowFixture();
  const app = setup({ windows: [standalone, embedded] });
  const mount = app.mountStats(embedded);
  embedded.document.querySelector(".zest-stats-open-details").click();
  assert.equal(app.opens(), 1);
  assert.ok(standalone.document.querySelector(".zest-stats-standalone"));
  assert.ok(standalone.document.querySelector(".zest-stats-charts"));
  assert.ok(standalone.document.querySelector(".zest-achievements"));
  assert.ok(embedded.document.querySelector(".zest-stats-embedded"));
  assert.equal(embedded.document.querySelector(".zest-achievements"), null);
  embedded.close();
  app.closeStatsDialog();
  embedded.document.querySelector(".zest-stats-open-details").click();
  assert.equal(app.opens(), 1, "a closed embedded host cannot reopen details");
  mount.dispose();
  app.assertUnchanged();
});

test("inactive statistics defer refresh work and collect one fresh snapshot on every reshow", () => {
  const app = setup();
  const mount = app.mountStats(app.win);
  const doc = app.win.document;
  const before = doc.querySelector(".zest-rings-centre").textContent;
  mount.setActive(false);
  const writes = doc.writes;
  mount.setActive(false);
  mount.refresh();
  mount.refresh();
  app.renderStats(app.win);
  assert.equal(app.reads(), 1);
  assert.equal(
    doc.writes,
    writes,
    "hidden refresh requests do no rendering work",
  );
  app.records.set("1/READ0002", record(900));
  mount.setActive(true);
  assert.equal(
    app.reads(),
    2,
    "all pending requests coalesce into one snapshot",
  );
  assert.notEqual(doc.querySelector(".zest-rings-centre").textContent, before);
  const resumedWrites = doc.writes;
  mount.setActive(true);
  assert.equal(
    app.reads(),
    2,
    "repeated active notifications do not recollect",
  );
  assert.equal(doc.writes, resumedWrites);
  const previousToday = doc.querySelector(".zest-rings-centre").textContent;
  mount.setActive(false);
  app.records.set("1/READ0003", record(1200));
  app.emitChange();
  assert.equal(app.reads(), 2, "reading data changes do no work while hidden");
  assert.equal(doc.writes, resumedWrites);
  mount.setActive(true);
  assert.equal(
    app.reads(),
    3,
    "reshow collects once even without an explicit refresh request",
  );
  assert.notEqual(
    doc.querySelector(".zest-rings-centre").textContent,
    previousToday,
    "reading changes made while hidden appear on reshow",
  );
  const latestWrites = doc.writes;
  mount.setActive(true);
  assert.equal(app.reads(), 3);
  assert.equal(doc.writes, latestWrites);
  assert.deepEqual(app.logs, []);
  assert.deepEqual(app.prefWrites, []);
});

test("compact reshow with no changes preserves the DOM and performs zero reads", () => {
  const app = setup();
  const mount = app.mountStats(app.win);
  const root = app.win.document.querySelector(".zest-stats");
  assert.equal(app.reads(), 1);
  mount.setActive(false);
  mount.setActive(true);
  assert.equal(app.reads(), 1);
  assert.strictEqual(
    app.win.document.querySelector(".zest-stats"),
    root,
    "unchanged compact content is kept in place",
  );
  mount.dispose();
});

test("compact reshow refreshes after a calendar day boundary without polling", () => {
  class MovingDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [MovingDate.current]));
    }
    static now() {
      return MovingDate.current;
    }
  }
  MovingDate.current = new Date("2026-09-07T12:00:00").getTime();
  const app = setup({ dateClass: MovingDate });
  const mount = app.mountStats(app.win);
  const root = app.win.document.querySelector(".zest-stats");
  MovingDate.current = new Date("2026-09-08T00:01:00").getTime();
  mount.setActive(false);
  mount.setActive(true);
  assert.equal(app.reads(), 2);
  assert.notStrictEqual(app.win.document.querySelector(".zest-stats"), root);
  mount.dispose();
});

test("compact reshow refreshes for a changed goal preference", () => {
  const app = setup();
  const mount = app.mountStats(app.win);
  const root = app.win.document.querySelector(".zest-stats");
  app.prefs.set("stats.dailyGoalMinutes", 45);
  mount.setActive(false);
  mount.setActive(true);
  assert.equal(app.reads(), 2);
  assert.notStrictEqual(app.win.document.querySelector(".zest-stats"), root);
  assert.match(
    app.win.document
      .querySelector(".zest-stats-open-details")
      .getAttribute("aria-label"),
    /45 min/,
  );
  mount.dispose();
});

test("active store changes only dirty the compact panel until resume", () => {
  const app = setup();
  const mount = app.mountStats(app.win);
  const root = app.win.document.querySelector(".zest-stats");
  app.records.set("1/READ0002", record(900));
  app.emitChange();
  assert.equal(app.reads(), 1);
  assert.strictEqual(app.win.document.querySelector(".zest-stats"), root);
  mount.setActive(false);
  mount.setActive(true);
  assert.equal(app.reads(), 2);
  assert.notStrictEqual(app.win.document.querySelector(".zest-stats"), root);
  mount.dispose();
});

test("inactive or repainted ring buttons cannot open details", () => {
  const app = setup();
  let opens = 0;
  const mount = app.mountStats(app.win, () => opens++);
  assert.equal(app.listenerCount(), 1);
  const doc = app.win.document;
  const original = doc.querySelector(".zest-stats-open-details");
  mount.setActive(false);
  const writes = doc.writes;
  original.click();
  assert.equal(opens, 0);
  assert.equal(doc.writes, writes);
  assert.equal(app.reads(), 1);
  mount.setActive(true);
  original.click();
  assert.equal(opens, 1, "unchanged DOM remains valid across a reshow");
  const resumed = doc.querySelector(".zest-stats-open-details");
  resumed.click();
  assert.equal(opens, 2);
  resumed.focus();
  mount.refresh();
  const current = doc.querySelector(".zest-stats-open-details");
  assert.equal(
    doc.activeElement,
    current,
    "refresh preserves ring button focus",
  );
  original.click();
  resumed.click();
  assert.equal(opens, 2, "replaced ring button cannot open details");
  current.click();
  assert.equal(opens, 3);
  app.assertUnchanged();
});

test("disposing an embedded instance clears only its owned content and rejects stale controls", () => {
  const app = setup();
  const doc = app.win.document;
  const head = doc.createElement("head");
  head.textContent = "native host stylesheet";
  doc.documentElement.append(head);
  let opens = 0;
  const mount = app.mountStats(app.win, () => opens++);
  const oldButton = doc.querySelector(".zest-stats-open-details");
  const unowned = doc.createElement("aside");
  unowned.textContent = "host-owned node";
  doc.body.append(unowned);
  mount.dispose();
  assert.equal(app.listenerCount(), 0, "dispose removes the store listener");
  assert.equal(app.win.closed, false);
  assert.equal(app.win.closeCount, 0);
  assert.equal(doc.querySelector(".zest-stats"), null);
  assert.equal(doc.querySelector("style"), null);
  assert.equal(doc.querySelector("head"), head);
  assert.equal(doc.querySelector("aside"), unowned);
  const writes = doc.writes;
  oldButton.click();
  assert.equal(opens, 0, "disposed callback is never invoked");
  mount.setActive(false);
  mount.refresh();
  mount.setActive(true);
  mount.dispose();
  assert.equal(app.reads(), 1);
  assert.equal(doc.writes, writes);
  const next = app.mountStats(app.win);
  assert.equal(app.listenerCount(), 1);
  assert.equal(app.reads(), 2, "remount does not keep the disposed snapshot");
  assert.ok(doc.querySelector(".zest-stats-open-details"));
  mount.dispose();
  mount.refresh();
  assert.ok(doc.querySelector(".zest-stats-embedded"));
  assert.equal(
    app.reads(),
    2,
    "a disposed handle cannot repaint the new instance",
  );
  next.dispose();
  assert.equal(app.listenerCount(), 0);
  app.assertUnchanged();
});

test("a disposed compact listener cannot dirty or repaint a replacement mount", () => {
  const app = setup();
  const first = app.mountStats(app.win);
  first.dispose();
  const second = app.mountStats(app.win);
  const reads = app.reads();
  assert.equal(app.listenerCount(), 1);
  app.emitChange();
  assert.equal(
    app.reads(),
    reads,
    "change notification alone does not repaint",
  );
  second.setActive(false);
  second.setActive(true);
  assert.equal(
    app.reads(),
    reads + 1,
    "only the replacement listener refreshes on resume",
  );
  second.dispose();
  assert.equal(app.listenerCount(), 0);
});

test("shutdown ignores main windows and embedded hosts even if they contain statistics markers", () => {
  const main = windowFixture({
    url: "chrome://zotero/content/zoteroPane.xhtml",
  });
  const embedded = windowFixture();
  const unrelatedPanel = windowFixture();
  for (const win of [main, unrelatedPanel]) {
    const marker = win.document.createElement("main");
    marker.className =
      win === main ? "zest-stats zest-stats-standalone" : "zest-stats";
    win.document.body.append(marker);
  }
  const app = setup({ windows: [main, embedded, unrelatedPanel] });
  const mount = app.mountStats(embedded);
  app.closeStatsDialog();
  for (const win of [main, embedded, unrelatedPanel]) {
    assert.equal(win.closed, false);
    assert.equal(win.closeCount, 0);
  }
  assert.ok(embedded.document.querySelector(".zest-stats-embedded"));
  mount.dispose();
  app.assertUnchanged();
});

test("repainted controls cannot change goals or overwrite the current range", () => {
  const app = setup();
  app.openStatsDialog(app.host);
  const doc = app.win.document;
  const staleRefresh = doc.querySelector(".zest-stats-refresh");
  const staleRange = doc.querySelector('[data-range="90"]');
  const staleGoal = doc.querySelector('[data-focus="stats-dailyGoalMinutes"]');
  doc.querySelector('[data-range="7"]').click();
  const writes = doc.writes;
  staleRefresh.click();
  staleRange.click();
  staleGoal.value = "60";
  staleGoal.dispatch("change");
  assert.equal(app.reads(), 1);
  assert.equal(doc.writes, writes);
  assert.ok(doc.querySelector('[data-period-days="7"]'));
  app.assertUnchanged();
});
