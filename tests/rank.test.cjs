const test = require("node:test");
const assert = require("node:assert/strict");
const { setTimeout, clearTimeout, setImmediate } = require("node:timers");
const { createHarness } = require("./helpers.cjs");

function rankHarness({ records = {}, dataset, prefs = {} } = {}) {
  const entries = new Map(Object.entries(records));
  const calls = [];
  const h = createHarness({
    mocks: {
      "src/utils/prefs.ts": {
        getPref: (key) => prefs[key] ?? false,
        getNumPref: () => 30,
      },
      "src/utils/timers.ts": { setTimeout, clearTimeout },
      "src/core/storage.ts": {
        cache: {
          configure() {},
          get(ns, key, sanitize) {
            const data = sanitize(entries.get(key));
            return data ? { data, age: 0 } : undefined;
          },
          set: (ns, key, value) => entries.set(key, value),
          clear: () => entries.clear(),
          ageOf: () => undefined,
        },
      },
      "src/core/http.ts": {
        http: { recentlyUnreachable: () => false, throttledFor: () => 0 },
      },
      "src/rank/sources/easyscholar.ts": {
        easyScholarBlocked: () => false,
        fetchEasyScholar: async (...args) => {
          calls.push(args);
          return { values: [] };
        },
      },
      "src/rank/sources/openalex.ts": {},
      "src/rank/sources/localDataset.ts": {
        datasetsLoaded: async () => {},
        lookupDataset: dataset ?? (() => []),
      },
    },
    globals: { Zotero: { Promise: { delay: async () => {} } } },
  });
  return { ...h, rank: h.load("src/rank/index.ts"), entries, calls };
}
const item = (publicationTitle, ISSN = "") => ({
  getField: (field) => ({ publicationTitle, ISSN })[field] || "",
});
const metric = (value) => [{ field: "sci", value, source: "dataset" }];

test("same base title with different ISSNs never shares ranks, even after a legacy cache entry", async () => {
  const legacy = {
    key: "medicine",
    name: "Medicine (Baltimore)",
    issn: "0025-7974",
    values: metric("Q1"),
    updated: Date.now(),
  };
  const h = rankHarness({
    records: { medicine: legacy, "issn:0025-7974": legacy },
    dataset: (_, issn) => metric(issn === "0025-7974" ? "Q1" : "Q4"),
  });
  const a = item("Medicine (Baltimore)", "0025-7974");
  const b = item("Medicine (Abingdon)", "1357-3039");
  assert.equal(h.rank.getJournalRecord(a).values[0].value, "Q1");
  assert.equal(h.rank.getJournalRecord(b), undefined);
  await h.rank.lookupJournal(b);
  assert.equal(h.rank.getJournalRecord(b).issn, "1357-3039");
  assert.equal(h.rank.getJournalRecord(b).values[0].value, "Q4");
  assert.equal(h.rank.getJournalRecord(a).values[0].value, "Q1");
});

test("journal identities keep significant parenthetical words and dedupe alternate titles by ISSN", () => {
  const h = rankHarness();
  const n = h.load("src/rank/normalize.ts");
  assert.notEqual(
    n.normalizeJournal("Medicine (Baltimore)"),
    n.normalizeJournal("Medicine (Abingdon)"),
  );
  assert.equal(
    h.rank.journalKeyOf(item("A Journal", "1234-5678")).key,
    h.rank.journalKeyOf(item("A J.", "1234-5678")).key,
  );
  const full =
    "European Journal of Cardio-Thoracic Surgery: Official Journal of the European Association for Cardio-Thoracic Surgery";
  assert.equal(
    h.rank.journalKeyOf(item(full)).key,
    h.rank.journalKeyOf(item("European Journal of Cardio-Thoracic Surgery"))
      .key,
  );
  assert.equal(
    n.journalLookupName("Medicine (Baltimore): Official Journal of Example"),
    "Medicine (Baltimore)",
  );
  assert.equal(
    n.journalLookupName("CA: A Cancer Journal for Clinicians"),
    "CA: A Cancer Journal for Clinicians",
  );
});

test("a legacy name cache cannot override a conflicting item ISSN", () => {
  const h = rankHarness({
    records: {
      medicine: {
        key: "medicine",
        name: "Medicine",
        issn: "0025-7974",
        values: metric("Q1"),
        updated: Date.now(),
      },
    },
  });
  assert.equal(
    h.rank.getJournalRecord(item("Medicine", "1357-3039")),
    undefined,
  );
  assert.equal(
    h.rank.getJournalRecord(item("Medicine", "0025-7974")).values[0].value,
    "Q1",
  );
});

test("stopping a rank lookup while local data loads prevents network and cache writes", async () => {
  const h = rankHarness({ prefs: { "rank.useEasyScholar": true } });
  let complete;
  h.mocks["src/rank/sources/localDataset.ts"].datasetsLoaded = () =>
    new Promise((resolve) => {
      complete = resolve;
    });
  const running = h.rank.lookupJournal(item("Example", "1234-5678"));
  h.rank.stopRankService();
  complete();
  assert.equal(await running, null);
  assert.equal(h.calls.length, 0);
  assert.equal(h.entries.size, 0);
});

test("render queues still populate local ranks when unrelated or disabled remote sources fail", async () => {
  for (const openAlex of [false, true]) {
    const h = rankHarness({
      prefs: { "rank.autoFetch": true, "rank.useOpenAlex": openAlex },
      dataset: () => metric("Q2"),
    });
    const jobs = [];
    h.mocks["src/utils/timers.ts"].setTimeout = (fn) => {
      jobs.push(fn);
      return jobs.length;
    };
    h.mocks["src/utils/timers.ts"].clearTimeout = () => {};
    h.mocks["src/core/http.ts"].http.recentlyUnreachable = () => true;
    h.mocks["src/core/http.ts"].http.throttledFor = () => 60000;
    const a = Object.assign(item("Local A", "1234-5678"), { id: 1 });
    const b = Object.assign(item("Local B", "8765-4321"), { id: 2 });
    h.context.Zotero.Items = { get: (id) => (id === 1 ? a : b) };
    h.rank.startRankService(() => {});
    h.rank.requestJournalRecord(a);
    h.rank.requestJournalRecord(b);
    assert.equal(jobs.length, 1);
    jobs[0]();
    await new Promise(setImmediate);
    assert.equal(h.rank.getJournalRecord(a).values[0].value, "Q2");
    assert.equal(h.rank.getJournalRecord(b).values[0].value, "Q2");
    assert.equal(h.rank.rankSourceThrottled(), openAlex);
    assert.equal(h.calls.length, 0);
    h.rank.stopRankService();
  }
});

test("DOI fallback accepts a verified eISSN and caches its print/electronic aliases", async () => {
  for (const electronic of ["8765-4321", "9999-9999"]) {
    const h = rankHarness({ prefs: { "rank.useOpenAlex": true } });
    const sourceModule = h.mocks["src/rank/sources/openalex.ts"];
    delete h.mocks["src/rank/sources/openalex.ts"];
    h.mocks["src/core/http.ts"].politeParam = () => "";
    const source = {
      issn_l: "1234-5678",
      issn: ["1234-5678", "8765-4321"],
      display_name: "Alias Journal",
    };
    h.mocks["src/core/http.ts"].http.request = async (method, url) => {
      if (url.includes("/works/doi:")) return { primary_location: { source } };
      if (url.includes("/sources/issn:1234-5678"))
        return { ...source, summary_stats: { "2yr_mean_citedness": 3.25 } };
      return null;
    };
    Object.assign(sourceModule, h.load("src/rank/sources/openalex.ts"));
    const paper = {
      getField: (field) =>
        ({
          publicationTitle: "Alias Journal",
          ISSN: electronic,
          DOI: "10.1234/example",
        })[field] || "",
    };
    const result = await h.rank.lookupJournal(paper);
    if (electronic === "8765-4321") {
      assert.equal(result.values[0].value, "3.25");
      assert.equal(
        h.rank.getJournalRecord(item("Any title", "1234-5678")).values[0].value,
        "3.25",
      );
      assert.equal(
        h.rank.getJournalRecord(item("Any title", electronic)).values[0].value,
        "3.25",
      );
    } else {
      assert.equal(result.values.length, 0);
      assert.equal(
        h.rank.getJournalRecord(item("Any title", "1234-5678")),
        undefined,
      );
    }
  }
});

test("local datasets reject conflicting title-only matches and index multiple ISSNs", async () => {
  const rows = [
    { name: "Medicine", issn: "0025-7974", fields: { sci: "Q1" } },
    { name: "Medicine", issn: "1357-3039", fields: { sci: "Q4" } },
    {
      name: "Dual ISSN Journal",
      issn: "1234-5678, 8765-4321",
      fields: { sci: "Q2" },
    },
  ];
  const h = createHarness({
    mocks: {
      "src/core/config.ts": {
        zestConfig: { get: () => ({ datasets: [{ id: "fixture" }] }) },
      },
    },
    globals: {
      PathUtils: { join: (...parts) => parts.join("/") },
      IOUtils: { exists: async () => true },
      Zotero: {
        DataDirectory: { dir: "/memory" },
        File: { getContentsAsync: async () => JSON.stringify({ rows }) },
      },
    },
  });
  const ds = h.load("src/rank/sources/localDataset.ts");
  await ds.loadDatasets();
  assert.equal(ds.lookupDataset("medicine").length, 0);
  assert.equal(ds.lookupDataset("medicine", "0025-7974")[0].value, "Q1");
  assert.equal(ds.lookupDataset("medicine", "1357-3039")[0].value, "Q4");
  assert.equal(ds.lookupDataset("dual issn journal", "9999-9999").length, 0);
  assert.equal(ds.lookupDataset("other title", "8765-4321")[0].value, "Q2");
});
