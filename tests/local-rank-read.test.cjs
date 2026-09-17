const test = require("node:test");
const assert = require("node:assert/strict");
const { setImmediate } = require("node:timers");
const { createHarness } = require("./helpers.cjs");

const copy = (value) => JSON.parse(JSON.stringify(value));
const metric = (field, value, source = "dataset") => ({ field, value, source });
const jcr = (overrides = {}) => ({
  year: 2024,
  impactFactor: 8.1,
  source: "dataset",
  categories: [{ name: "Oncology", percentile: 90 }],
  ...overrides,
});
const row = (fields = { sciif: "8.1" }, metadata) => ({
  name: "Example",
  issn: "1234-5678",
  fields,
  ...(metadata ? { jcr: metadata } : {}),
});
const paper = (name = "Example", issn = "1234-5678", id = 1) => ({
  id,
  getField: (key) => ({ publicationTitle: name, ISSN: issn })[key] || "",
});
const cached = (values, extra = {}) => ({
  key: "issn:1234-5678",
  name: "Example",
  issn: "1234-5678",
  issns: ["1234-5678"],
  requestedISSNs: ["1234-5678"],
  lookupVersion: 1,
  values,
  updated: Date.now(),
  ...extra,
});

async function fixture({ rows = [], records = [], prefs = {} } = {}) {
  const entries = new Map(records.map((record) => [record.key, record]));
  const writes = [];
  const requests = [];
  const timers = new Map();
  let timerID = 0;
  let currentRows = rows;
  let blocked = false;
  const h = createHarness({
    mocks: {
      "src/utils/prefs.ts": {
        getPref: (key) => prefs[key] ?? false,
        getNumPref: () => 30,
      },
      "src/utils/timers.ts": {
        setTimeout: (callback) => {
          timers.set(++timerID, callback);
          return timerID;
        },
        clearTimeout: (id) => timers.delete(id),
      },
      "src/core/config.ts": {
        zestConfig: { get: () => ({ datasets: [{ id: "fixture" }] }) },
      },
      "src/core/storage.ts": {
        cache: {
          configure() {},
          get(_ns, key, sanitize) {
            const data = sanitize(entries.get(key));
            return data ? { data, age: 0 } : undefined;
          },
          set(_ns, key, value) {
            writes.push(key);
            entries.set(key, value);
          },
          clear: () => entries.clear(),
          remove: (_ns, key) => entries.delete(key),
          ageOf: () => undefined,
        },
      },
      "src/core/http.ts": {
        http: {
          recentlyUnreachable: () => blocked,
          throttledFor: () => (blocked ? 60000 : 0),
        },
      },
      "src/rank/sources/easyscholar.ts": {
        easyScholarBlocked: () => blocked,
        fetchEasyScholar: async (...args) => {
          requests.push(args);
          return { values: [metric("sci", "Q3", "easyscholar")] };
        },
      },
      "src/rank/sources/openalex.ts": {},
    },
    globals: {
      PathUtils: { join: (...parts) => parts.join("/") },
      IOUtils: { exists: async () => true },
      Zotero: {
        DataDirectory: { dir: "/memory" },
        File: { getContentsAsync: async () => JSON.stringify(currentRows) },
        Promise: { delay: async () => {} },
        Items: { get: (id) => paper("Example", "1234-5678", id) },
      },
    },
  });
  const datasets = h.load("src/rank/sources/localDataset.ts");
  await datasets.loadDatasets();
  const rank = h.load("src/rank/index.ts");
  return {
    ...h,
    rank,
    datasets,
    entries,
    writes,
    requests,
    timers,
    prefs,
    setBlocked(value) {
      blocked = value;
    },
    async replaceRows(next) {
      currentRows = next;
      await datasets.loadDatasets();
    },
    async runTimers() {
      for (const [id, callback] of [...timers]) {
        timers.delete(id);
        callback();
      }
      await new Promise(setImmediate);
    },
  };
}

test("local journal data is visible offline in both render callbacks without timers, network or cache writes", async () => {
  const h = await fixture({
    rows: [row({ sciif: "8.1", sci: "Q1" }, jcr())],
    prefs: { "rank.useEasyScholar": true, "rank.useOpenAlex": true },
  });
  for (const read of [h.rank.getJournalRecord, h.rank.requestJournalRecord]) {
    const result = read(paper());
    assert.deepEqual(
      copy(result.values.map(({ field, value, rank }) => [field, value, rank])),
      [
        ["sciif", "8.1", 2],
        ["sci", "Q1", 1],
      ],
    );
    assert.equal(result.jcr.categories[0].percentile, 90);
  }
  assert.equal(h.requests.length, 0);
  assert.equal(h.writes.length, 0);
  assert.equal(h.timers.size, 0);
});

test("local fields override cached fields without borrowing same-value JCR from a previous source or file", async () => {
  for (const source of ["dataset", "easyscholar"]) {
    const record = cached(
      [
        metric("sciif", "8.1", source),
        metric("sci", "Q1", "easyscholar"),
        metric("oa2yr", "4.6", "openalex"),
      ],
      { jcr: jcr({ source }) },
    );
    const before = copy(record);
    const h = await fixture({
      rows: [row({ SCIIF: "8.1" })],
      records: [record],
    });
    for (const read of [h.rank.getJournalRecord, h.rank.requestJournalRecord]) {
      const result = read(paper());
      assert.equal(result.values[0].source, "dataset");
      assert.equal(result.values[0].field, "SCIIF");
      assert.equal(result.jcr, undefined);
      assert.equal(result.values.length, 3);
      assert.equal(result.values[1].value, "Q1");
      assert.equal(result.values[2].value, "4.6");
    }
    assert.deepEqual(record, before);
  }
});

test("a local non-IF field preserves verified cached JCR and newly loaded local JIF immediately replaces it", async () => {
  const h = await fixture({
    rows: [row({ sciUp: "医学2区" })],
    records: [
      cached([metric("sciif", "8.1", "easyscholar")], {
        jcr: jcr({ source: "easyscholar" }),
      }),
    ],
  });
  assert.equal(h.rank.getJournalRecord(paper()).jcr.year, 2024);
  await h.replaceRows([
    row(
      { sciif: "8.1" },
      jcr({ year: 2025, categories: [{ name: "Oncology", percentile: 65 }] }),
    ),
  ]);
  for (const read of [h.rank.getJournalRecord, h.rank.requestJournalRecord]) {
    const result = read(paper());
    assert.equal(result.jcr.year, 2025);
    assert.equal(result.jcr.categories[0].percentile, 65);
  }
  // Non-force manual reads must also reapply the current local dataset.
  const result = await h.rank.lookupJournal(paper());
  assert.equal(result.jcr.year, 2025);
  assert.equal(h.requests.length, 0);
});

test("local-only reads do not infer aliases from input or legacy cached ISSN lists", async () => {
  const h = await fixture({ rows: [row()] });
  assert.equal(
    h.rank.getJournalRecord(paper("Example", "8765-4321")),
    undefined,
  );
  assert.equal(
    h.rank.requestJournalRecord(paper("Example", "1234-5678,8765-4321")),
    undefined,
  );
  assert.equal(
    h.rank.getJournalRecord(paper("Example", "1357-3039")),
    undefined,
  );
  const legacy = cached([metric("oa2yr", "4", "openalex")], {
    key: "issn:8765-4321",
    issn: "8765-4321",
    issns: ["1234-5678", "8765-4321"],
    lookupVersion: 0,
  });
  h.entries.set(legacy.key, legacy);
  assert.deepEqual(
    copy(
      h.rank
        .getJournalRecord(paper("Example", "8765-4321"))
        .values.map((v) => v.field),
    ),
    ["oa2yr"],
  );
});

test("current source-verified aliases and catalogue aliases can reach print-only local rows", async () => {
  const h = await fixture({
    rows: [row()],
    records: [
      cached([metric("oa2yr", "4", "openalex")], {
        key: "issn:8765-4321",
        issns: ["1234-5678", "8765-4321"],
      }),
    ],
  });
  const result = h.rank.getJournalRecord(paper("Abbreviation", "8765-4321"));
  assert.equal(result.values[0].field, "sciif");
  assert.equal(result.values[1].field, "oa2yr");
  await h.replaceRows([
    {
      name: "Cancer Immunology, Immunotherapy",
      issn: "0340-7004",
      fields: { sciif: "7.2" },
    },
  ]);
  const known = h.rank.getJournalRecord(
    paper("Cancer Immunology, Immunotherapy : CII", "1432-0851"),
  );
  assert.equal(known.values[0].value, "7.2");
  assert.equal(h.requests.length, 0);
});

test("manual cache fast paths wait for local loading before applying its new fields", async () => {
  const h = await fixture({
    rows: [row({ sciif: "8.1" })],
    records: [cached([metric("sciif", "4.2", "easyscholar")])],
  });
  let release;
  h.context.Zotero.File.getContentsAsync = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const loading = h.datasets.loadDatasets();
  await new Promise(setImmediate);
  const result = h.rank.lookupJournal(paper());
  release(JSON.stringify([row({ sciif: "9.9" })]));
  await loading;
  assert.equal((await result).values[0].value, "9.9");
  assert.equal(h.requests.length, 0);
});

test("clearing ranking cache cancels an in-flight response and queued rows without resetting source backoff", async () => {
  const h = await fixture({
    prefs: { "rank.autoFetch": true, "rank.useEasyScholar": true },
  });
  let release;
  h.mocks["src/rank/sources/easyscholar.ts"].fetchEasyScholar = async (
    ...args
  ) => {
    h.requests.push(args);
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const first = h.rank.lookupJournal(paper());
  await new Promise(setImmediate);
  assert.equal(h.requests.length, 1);
  h.rank.requestJournalRecord(paper("Pending", "2345-6789", 2));
  assert.equal(h.timers.size, 1);
  h.setBlocked(true);
  h.rank.clearRankCache();
  assert.equal(h.timers.size, 0);
  assert.equal(h.rank.rankSourceThrottled(), true);
  assert.equal(
    h.requests[0][1](),
    false,
    "the old request continuation is invalidated",
  );
  release({ values: [metric("sciif", "99", "easyscholar")] });
  assert.equal(await first, null);
  await h.runTimers();
  assert.equal(h.requests.length, 1);
  assert.equal(h.writes.length, 0);
  assert.equal(h.entries.size, 0);
  await h.replaceRows([row({ sciif: "6.3" })]);
  h.prefs["rank.autoFetch"] = false;
  assert.equal(h.rank.requestJournalRecord(paper()).values[0].value, "6.3");
});
