const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHarness } = require("./helpers.cjs");
const { windowFixture } = require("./dialog-fixture.cjs");

const resolved = (percentiles, extra = {}) => ({
  value: 12.3,
  field: "sciif",
  raw: "12.30",
  source: "easyscholar",
  ...(percentiles && {
    jcr: {
      year: 2024,
      categories: percentiles.map((percentile, i) => ({
        name: `Category ${i + 1}`,
        percentile,
        ...(i === 0 && { rank: "12/100" }),
      })),
    },
  }),
  ...extra,
});

function columnHarness({
  metric = resolved(),
  prefs = {},
  record = { key: "journal:example", values: [] },
  realResolver = false,
} = {}) {
  const win = windowFixture();
  const calls = [];
  class Item {
    isRegularItem() {
      return true;
    }
  }
  const item = new Item();
  win.ZoteroPane = { itemsView: { getRow: () => ({ ref: item }) } };
  const h = createHarness({
    globals: { Zotero: { Item } },
    mocks: {
      "src/utils/prefs.ts": { getPref: (key) => prefs[key] },
      "src/utils/timers.ts": {},
      "src/utils/locale.ts": {
        getString: (id, { args } = {}) =>
          args ? `${id} ${JSON.stringify(args)}` : id,
      },
      "src/rank/index.ts": {
        requestJournalRecord: () => record,
        getJournalRecord: () => record,
        journalKeyOf: () => ({ key: record.key }),
      },
      ...(realResolver
        ? {}
        : {
            "../rank/impactFactor": {
              resolveImpactFactor(rec, field) {
                assert.equal(rec, record);
                calls.push(field);
                return metric;
              },
            },
          }),
    },
  });
  const column = h.load("src/columns/pubTags.ts").impactFactorColumn();
  return {
    column,
    item,
    win,
    calls,
    render() {
      return column.renderCell(
        0,
        column.dataProvider(item),
        {},
        false,
        win.document,
      );
    },
  };
}

test("IF number, sort key and tooltip share the resolved field rather than the preferred missing field", () => {
  const h = columnHarness({
    metric: resolved(undefined, {
      field: "sciif5",
      value: 8.6,
      raw: "8.60",
      source: "dataset",
    }),
    prefs: { "if.field": "missing", "if.info": false },
  });
  const cell = h.render();
  assert.equal(h.column.dataProvider(h.item), "00008600");
  assert.equal(cell.querySelector(".cell-text").textContent, "8.6");
  assert.match(cell.getAttribute("aria-label"), /"field":"sciif5"/);
  assert.match(cell.getAttribute("aria-label"), /"source":"dataset"/);
  assert.match(cell.getAttribute("aria-label"), /"value":"8.60"/);
  assert.match(cell.getAttribute("aria-label"), /if-percentile-not-applicable/);
  assert.equal(cell.querySelector(".zest-if-percentile"), null);
  assert.deepEqual(h.calls, ["missing", "missing", "missing"]);
  assert.equal(Boolean(cell.title), false);
});

test("unknown metrics are empty but genuine zero remains visible and sortable", () => {
  const unknown = columnHarness({ metric: null });
  assert.equal(unknown.column.dataProvider(unknown.item), "");
  assert.equal(unknown.render().querySelector(".cell-text").textContent, "");
  const zero = columnHarness({
    metric: resolved(undefined, {
      value: 0,
      raw: "0.00",
      field: "oa2yr",
      source: "openalex",
    }),
    prefs: { "if.info": false },
  });
  assert.equal(zero.column.dataProvider(zero.item), "00000000");
  assert.equal(zero.render().querySelector(".cell-text").textContent, "0.0");
});

test("JIF without percentile never fabricates a mark from IF magnitude or quartile", () => {
  for (const style of [undefined, "percentile", "heat", "bar", "none"]) {
    const h = columnHarness({ prefs: { "if.style": style, "if.info": false } });
    const cell = h.render();
    assert.equal(cell.querySelector(".cell-text").textContent, "12.3");
    assert.match(cell.getAttribute("aria-label"), /if-percentile-missing/);
    assert.equal(cell.querySelector(".zest-if-percentile"), null);
    assert.equal(cell.querySelector(".zest-if-heat"), null);
    assert.equal(cell.querySelector(".zest-if-bar"), null);
  }
});

test("percentile and legacy styles show the centered number followed by one noninteractive marker", () => {
  for (const style of [undefined, "percentile", "heat", "bar"]) {
    const cell = columnHarness({
      metric: resolved([82.56]),
      prefs: { "if.style": style, "if.info": false },
    }).render();
    assert.equal(cell.children[0].className, "cell-text");
    assert.equal(cell.children[0].textContent, "12.3");
    const graph = cell.children[1];
    assert.equal(graph.className, "zest-if-percentile");
    assert.equal(graph.getAttribute("aria-hidden"), "true");
    assert.equal(graph.getAttribute("tabindex"), null);
    assert.equal(graph.listeners.size, 0);
    const point = graph.querySelector(".zest-if-point");
    assert.equal(point.style.left, "82.56%");
    assert.equal(point.listeners.size, 0);
    assert.equal(point.classList.contains("zest-if-top"), false);
    assert.match(cell.getAttribute("aria-label"), /"percentile":82.6/);
    assert.match(cell.getAttribute("aria-label"), /"year":"2024"/);
    assert.match(cell.getAttribute("aria-label"), /"rank":"12\/100"/);
  }
});

test("percentile boundaries include zero and 100 and only a single top-decile category is emphasized", () => {
  for (const percentile of [0, 89.9, 90, 100]) {
    const cell = columnHarness({ metric: resolved([percentile]) }).render();
    const point = cell.querySelector(".zest-if-point");
    assert.equal(point.style.left, `${percentile}%`);
    assert.equal(point.classList.contains("zest-if-top"), percentile >= 90);
  }
});

test("multiple categories draw the full neutral range and list every category without picking a winner", () => {
  const cell = columnHarness({ metric: resolved([97.3, 61.2, 84]) }).render();
  const graph = cell.querySelector(".zest-if-percentile");
  assert.ok(graph.classList.contains("zest-if-multiple"));
  const range = graph.querySelector(".zest-if-range");
  assert.equal(range.style.left, "61.2%");
  assert.ok(Math.abs(parseFloat(range.style.width) - 36.1) < 1e-9);
  assert.deepEqual(
    graph.querySelectorAll(".zest-if-point").map((point) => point.style.left),
    ["61.2%", "97.3%"],
  );
  assert.equal(graph.querySelector(".zest-if-top"), null);
  for (const name of ["Category 1", "Category 2", "Category 3"])
    assert.ok(cell.getAttribute("aria-label").includes(name));
  assert.match(cell.getAttribute("aria-label"), /"rank":"—"/);
});

test("equal percentiles across categories remain neutral and number-only mode retains complete tooltip", () => {
  const equal = columnHarness({ metric: resolved([95, 95]) }).render();
  assert.equal(equal.querySelectorAll(".zest-if-point").length, 1);
  assert.equal(equal.querySelector(".zest-if-top"), null);
  assert.equal(equal.querySelector(".zest-if-range").style.width, "0%");
  const plain = columnHarness({
    metric: resolved([95]),
    prefs: { "if.style": "none", "if.info": false },
  }).render();
  assert.equal(plain.querySelector(".cell-text").textContent, "12.3");
  assert.equal(plain.querySelector(".zest-if-percentile"), null);
  assert.match(plain.getAttribute("aria-label"), /if-jcr-detail/);
});

test("the percentile overlay has no pointer handling, absolute row sizing or hardcoded hue", () => {
  const styles = fs.readFileSync(
    path.join(path.dirname(module.filename), "../src/ui/styles.ts"),
    "utf8",
  );
  const section = styles.slice(
    styles.indexOf("/* Journal ranks and IF"),
    styles.indexOf("/* Collection count badge */"),
  );
  assert.match(section, /pointer-events: none/);
  assert.match(section, /flex-direction: column; justify-content: center/);
  assert.match(section, /var\(--zest-accent-strong\)/);
  assert.doesNotMatch(section, /#[a-f\d]{3,8}\b|\.row|line-height:\s*23px/);
});

test("real metric resolution keeps fallback values, provenance and percentile together", () => {
  const record = {
    key: "journal:example",
    values: [
      { field: "sciif", value: "6.40", source: "dataset" },
      { field: "oa2yr", value: "1.2", source: "openalex" },
    ],
    jcr: {
      year: 2024,
      impactFactor: 6.4,
      source: "dataset",
      categories: [{ name: "Oncology", percentile: 83.2 }],
    },
  };
  const h = columnHarness({
    record,
    realResolver: true,
    prefs: { "if.field": "unavailable" },
  });
  const cell = h.render();
  assert.equal(h.column.dataProvider(h.item), "00006400");
  assert.equal(cell.querySelector(".cell-text").textContent, "6.4");
  assert.match(cell.getAttribute("aria-label"), /"field":"sciif"/);
  assert.match(cell.getAttribute("aria-label"), /"source":"dataset"/);
  assert.doesNotMatch(cell.getAttribute("aria-label"), /openalex/);
  assert.equal(cell.querySelector(".zest-if-point").style.left, "83.2%");
  // A different preferred metric can never borrow the JIF percentile.
  const alternative = columnHarness({
    record,
    realResolver: true,
    prefs: { "if.field": "oa2yr" },
  }).render();
  assert.equal(alternative.querySelector(".cell-text").textContent, "1.2");
  assert.equal(alternative.querySelector(".zest-if-percentile"), null);
  assert.match(alternative.getAttribute("aria-label"), /"source":"openalex"/);
});

test("ShowJCR tooltip attributes rank-derived percentiles and each category quartile", () => {
  const metric = resolved([78.4]);
  metric.jcr.provider = "showjcr";
  metric.jcr.percentileMethod = "rank";
  metric.jcr.categories[0].quartile = "Q1";
  const cell = columnHarness({ metric }).render();
  assert.match(cell.getAttribute("aria-label"), /if-jcr-showjcr-derived/);
  assert.match(cell.getAttribute("aria-label"), /Category 1 · Q1/);
});

test("IF exposes metric details to assistive technology without adding a hover popup", () => {
  const cell = columnHarness({ metric: resolved([96]) }).render();
  assert.match(cell.getAttribute("aria-label"), /if-jcr-detail/);
  assert.equal(Boolean(cell.title), false);
  assert.equal(cell.getAttribute("tooltip"), null);
  assert.equal(cell.getAttribute("tooltiptext"), null);
});
