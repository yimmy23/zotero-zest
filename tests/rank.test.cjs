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
          remove: (ns, key) => entries.delete(key),
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

test("rank cache repairs stale numeric grades without losing explicit custom grades", () => {
  const key = "issn:1234-5678";
  const h = rankHarness({
    records: {
      [key]: {
        key,
        name: "Example",
        issn: "1234-5678",
        updated: Date.now(),
        values: [
          { field: "sciif", value: "N/A", rank: 5, source: "dataset" },
          { field: "sciif5", value: "-12", rank: 1, source: "dataset" },
          { field: "oa2yr", value: "0", rank: 1, source: "openalex" },
          { field: "custom", value: "Premium", rank: 2, source: "easyscholar" },
        ],
      },
    },
  });
  const values = h.rank.getJournalRecord(item("Example", "1234-5678")).values;
  assert.deepEqual(
    Array.from(values, (v) => v.rank),
    [undefined, undefined, 5, 2],
  );
});

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

const ciiTitle = "Cancer Immunology, Immunotherapy : CII";
const ciiCanonical = "Cancer Immunology, Immunotherapy";
const ciiIDs = ["0340-7004", "1432-0851"];

test("verified CII aliases handle punctuation without stripping real subtitles or historical titles", () => {
  const n = rankHarness().load("src/rank/normalize.ts");
  for (const title of [
    ciiTitle,
    "Cancer immunology, immunotherapy : CII.",
    "Ｃａｎｃｅｒ Immunology， Immunotherapy： CII",
    " Cancer Immunology,   Immunotherapy: CII ",
  ]) {
    assert.equal(n.journalLookupName(title), ciiCanonical);
    assert.equal(n.normalizeJournal(title), n.normalizeJournal(ciiCanonical));
  }
  for (const title of [
    "CA: A Cancer Journal for Clinicians",
    "Cancer immunology and immunotherapy",
    "Cancer Immunology, Immunotherapy: Clinical Edition",
    "Cancer Immunology, Immunotherapy (European Edition)",
    "Example Journal: EJ",
    "CII",
    "Medicine (Baltimore)",
    "Medicine (Abingdon)",
  ]) {
    assert.equal(n.journalLookupName(title), title);
    assert.notEqual(
      n.normalizeJournal(title),
      n.normalizeJournal(ciiCanonical),
    );
  }
});

test("ISSNs support print/electronic labels, full-width text and safe token boundaries", () => {
  const h = rankHarness();
  const n = h.load("src/rank/normalize.ts");
  assert.deepEqual(
    Array.from(
      n.allISSNs("pISSN: ０３４０－７００４; eISSN 1432–0851; 03407004"),
    ),
    ciiIDs,
  );
  assert.equal(n.normalizeISSN("2434-561x"), "2434-561X");
  for (const raw of [
    "123456789",
    "0340a7004",
    "X340-7004",
    "0340-7004,1432-0851",
  ])
    assert.equal(n.normalizeISSN(raw), "");
  assert.equal(n.allISSNs("123456789 / 1234-56789").length, 0);
  assert.deepEqual(
    Array.from(h.rank.journalKeyOf(item(ciiTitle, ciiIDs.join("; "))).issns),
    ciiIDs,
  );
});

function datasetHarness(rows) {
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
  return { ...h, ds: h.load("src/rank/sources/localDataset.ts") };
}

test("dataset imports aggregate every ISSN column and recover old spilled identifier fields in memory", async () => {
  const h = datasetHarness([
    {
      name: ciiCanonical,
      issn: ciiIDs[0],
      fields: { eISSN: ciiIDs[1], sciUp: "医学2区", xr: "医学1区" },
    },
  ]);
  const parsed = h.ds.parseDataset(
    JSON.stringify([
      {
        name: ciiCanonical,
        pISSN: ciiIDs[0],
        "e-ISSN": ciiIDs[1],
        "ISSN-L": ciiIDs[0],
        sciUp: "医学2区",
      },
    ]),
    "json",
  );
  assert.equal(parsed.rows[0].issn, ciiIDs.join(", "));
  assert.deepEqual(Array.from(parsed.fields), ["sciUp"]);
  const csv = h.ds.parseDataset(
    `name,Print ISSN,Electronic ISSN,sciUp\nExample,${ciiIDs[0]},${ciiIDs[1]},医学2区`,
    "csv",
  );
  assert.equal(csv.rows[0].issn, ciiIDs.join(", "));
  assert.deepEqual(Array.from(csv.fields), ["sciUp"]);
  await h.ds.loadDatasets();
  for (const id of ciiIDs)
    assert.deepEqual(
      Array.from(h.ds.lookupDataset("", id), (v) => [v.field, v.value]),
      [
        ["sciUp", "医学2区"],
        ["xr", "医学1区"],
      ],
    );
  assert.equal(h.ds.lookupDataset("", `${ciiIDs[0]}, 1357-3039`).length, 0);
});

test("verified print/electronic aliases resolve local rows without accepting conflicting titles or IDs", async () => {
  const h = datasetHarness([
    { name: ciiCanonical, issn: ciiIDs[0], fields: { sciUp: "医学2区" } },
  ]);
  await h.ds.loadDatasets();
  assert.equal(
    h.ds.lookupDataset("cancer immunology immunotherapy", ciiIDs[1]).length,
    0,
  );
  assert.equal(
    h.ds.lookupDataset("cancer immunology immunotherapy", ciiIDs[1], ciiIDs)[0]
      .value,
    "医学2区",
  );
  assert.equal(
    h.ds.lookupDataset("cancer immunology immunotherapy", "1357-3039", ciiIDs)
      .length,
    0,
  );
});

test("CII requests use the publisher title and preserve raw XR/CAS values and original item title", async () => {
  const h = rankHarness({ prefs: { "rank.useEasyScholar": true } });
  const es = h.mocks["src/rank/sources/easyscholar.ts"];
  es.fetchEasyScholar = async (name) => {
    h.calls.push(name);
    return {
      values: [
        { field: "xr", value: "医学1区", source: "easyscholar" },
        { field: "sciUp", value: "医学2区", source: "easyscholar" },
      ],
    };
  };
  const result = await h.rank.lookupJournal(item(ciiTitle, ciiIDs[1]));
  assert.deepEqual(h.calls, [ciiCanonical]);
  assert.equal(result.name, ciiTitle);
  assert.deepEqual(
    Array.from(result.values, (v) => [v.field, v.value]),
    [
      ["xr", "医学1区"],
      ["sciUp", "医学2区"],
    ],
  );
  assert.equal(
    h.rank.getJournalRecord(item(ciiCanonical, ciiIDs[0])).values[1].value,
    "医学2区",
  );
  const conflict = rankHarness({ prefs: { "rank.useEasyScholar": true } });
  await conflict.rank.lookupJournal(item(ciiTitle, "1357-3039"));
  assert.equal(conflict.calls.length, 0);
});

test("old CII name-cache hits remain readable while old misses refresh once under new rules", async () => {
  const key = "name:cancer immunology immunotherapy cii";
  for (const values of [metric("Q1"), []]) {
    const original = { key, name: ciiTitle, values, updated: 123 };
    const h = rankHarness({
      records: { [key]: original },
      prefs: { "rank.useEasyScholar": true },
    });
    assert.equal(
      h.rank.getJournalRecord(item(ciiTitle)).values.length,
      values.length,
    );
    assert.equal(
      h.rank.getJournalRecord(item(ciiCanonical)).values.length,
      values.length,
    );
    await h.rank.lookupJournal(item(ciiTitle));
    assert.equal(h.calls.length, values.length ? 0 : 1);
    if (!values.length) {
      const fresh = h.rank.getJournalRecord(item(ciiTitle));
      assert.equal(
        fresh.lookupVersion,
        h.load("src/rank/normalize.ts").JOURNAL_LOOKUP_VERSION,
      );
      await h.rank.lookupJournal(item(ciiTitle));
      assert.equal(h.calls.length, 1);
    }
    assert.equal(h.entries.get(key), original);
  }
});

test("old OA-only misses remain visible and queue upgrades only with automatic fetching enabled", async () => {
  const key = `issn:${ciiIDs[0]}`;
  for (const auto of [false, true]) {
    const values = [{ field: "oa2yr", value: "3.25", source: "openalex" }];
    const h = rankHarness({
      records: {
        [key]: {
          key,
          name: ciiTitle,
          issn: ciiIDs[0],
          values,
          updated: Date.now(),
        },
      },
      prefs: { "rank.useEasyScholar": true, "rank.autoFetch": auto },
    });
    const jobs = [];
    h.mocks["src/utils/timers.ts"].setTimeout = (fn) => {
      jobs.push(fn);
      return jobs.length;
    };
    h.mocks["src/utils/timers.ts"].clearTimeout = () => {};
    const paper = Object.assign(item(ciiTitle, ciiIDs[0]), { id: 1 });
    h.context.Zotero.Items = { get: () => paper };
    h.rank.startRankService(() => {});
    assert.equal(h.rank.requestJournalRecord(paper).values[0].value, "3.25");
    assert.equal(jobs.length, auto ? 1 : 0);
    assert.equal(h.calls.length, 0);
    if (auto) {
      jobs[0]();
      await new Promise(setImmediate);
      assert.equal(h.calls.length, 1);
    }
    h.rank.stopRankService();
  }
});

function actualOpenAlex(h, request) {
  const module = h.mocks["src/rank/sources/openalex.ts"];
  delete h.mocks["src/rank/sources/openalex.ts"];
  h.mocks["src/core/http.ts"].politeParam = () => "";
  h.mocks["src/core/http.ts"].http.request = request;
  const result = h.load("src/rank/sources/openalex.ts");
  Object.assign(module, result);
  return result;
}

test("OpenAlex exact-name resolution rejects fuzzy, ambiguous and contradictory full records", async () => {
  for (const kind of [
    "exact",
    "fuzzy",
    "ambiguous",
    "wrong full title",
    "malformed",
  ]) {
    const h = rankHarness();
    const oa = actualOpenAlex(h, async (_, url) => {
      if (url.includes("/autocomplete/")) {
        const hit = { display_name: ciiCanonical, external_id: ciiIDs[0] };
        return {
          results:
            kind === "malformed"
              ? {}
              : kind === "ambiguous"
                ? [hit, { ...hit, external_id: "1357-3039" }]
                : [
                    {
                      ...hit,
                      display_name:
                        kind === "fuzzy"
                          ? `${ciiCanonical} Reports`
                          : ciiCanonical,
                    },
                  ],
        };
      }
      return {
        display_name:
          kind === "wrong full title" ? "Another Journal" : ciiCanonical,
        issn_l: ciiIDs[0],
        issn: ciiIDs,
        summary_stats: { "2yr_mean_citedness": 3 },
      };
    });
    const result = await oa.fetchOpenAlexByName(ciiTitle);
    assert.equal(!!result, kind === "exact", kind);
  }
});

test("a DOI for another journal cannot move title-based values into its ISSN cache", async () => {
  const h = rankHarness({
    dataset: () => metric("Q1"),
    prefs: { "rank.useOpenAlex": true },
  });
  const oa = h.mocks["src/rank/sources/openalex.ts"];
  oa.fetchOpenAlexByDOI = async () => ({
    name: "Wrong Journal",
    issn: "1357-3039",
    issns: ["1357-3039"],
    values: [{ field: "oa2yr", value: "9", source: "openalex" }],
  });
  oa.fetchOpenAlexByName = async () => null;
  const paper = {
    getField: (key) =>
      ({ publicationTitle: "Original Journal", DOI: "10.1234/wrong" })[key] ||
      "",
  };
  const result = await h.rank.lookupJournal(paper);
  assert.deepEqual(
    Array.from(result.values, (v) => v.field),
    ["sci"],
  );
  assert.equal(h.entries.has("issn:1357-3039"), false);
});

test("verified source titles retry an empty easyScholar lookup and resolve print-only local CAS data", async () => {
  const h = rankHarness({
    dataset: (name, issn, aliases) =>
      name === "verified journal" && aliases?.includes("1234-5678")
        ? [{ field: "sciUp", value: "医学2区", source: "dataset" }]
        : [],
    prefs: { "rank.useEasyScholar": true, "rank.useOpenAlex": true },
  });
  h.mocks["src/rank/sources/easyscholar.ts"].fetchEasyScholar = async (
    name,
  ) => {
    h.calls.push(name);
    return {
      values:
        name === "Verified Journal"
          ? [{ field: "xr", value: "医学1区", source: "easyscholar" }]
          : [],
    };
  };
  h.mocks["src/rank/sources/openalex.ts"].fetchOpenAlexByISSN = async () => ({
    name: "Verified Journal",
    issn: "1234-5678",
    issns: ["1234-5678", "8765-4321"],
    values: [{ field: "oa2yr", value: "3.25", source: "openalex" }],
  });
  const result = await h.rank.lookupJournal(item("V. J.", "8765-4321"));
  assert.deepEqual(h.calls, ["V. J.", "Verified Journal"]);
  assert.deepEqual(
    Array.from(result.values, (v) => [v.field, v.value]),
    [
      ["sciUp", "医学2区"],
      ["xr", "医学1区"],
      ["oa2yr", "3.25"],
    ],
  );
  assert.equal(result.name, "V. J.");
});

test("multiple item ISSNs are tried but a source must corroborate all explicit identifiers", async () => {
  for (const conflict of [false, true]) {
    const h = rankHarness({ prefs: { "rank.useOpenAlex": true } });
    const requests = [];
    const oa = h.mocks["src/rank/sources/openalex.ts"];
    oa.fetchOpenAlexByISSN = async (id) => {
      requests.push(id);
      return id === "8765-4321"
        ? {
            name: "Dual Journal",
            issn: "1234-5678",
            issns: ["1234-5678", "8765-4321"],
            values: [{ field: "oa2yr", value: "3", source: "openalex" }],
          }
        : null;
    };
    oa.fetchOpenAlexByName = async () => null;
    const result = await h.rank.lookupJournal(
      item(
        "Dual Journal",
        `${conflict ? "1357-3039" : "1234-5678"}, 8765-4321`,
      ),
    );
    assert.equal(requests.length, 2);
    assert.equal(result.values.length, conflict ? 0 : 1);
    assert.equal(h.entries.has("issn:1234-5678"), !conflict);
  }
});

test("upgraded misses bypass old HTTP negative caches and full source records alone authorize DOI aliases", async () => {
  const key = "issn:1234-5678";
  const h = rankHarness({
    records: {
      [key]: {
        key,
        name: "Example",
        issn: "1234-5678",
        values: [],
        updated: Date.now(),
      },
    },
    prefs: { "rank.useOpenAlex": true },
  });
  const seen = [];
  const oa = actualOpenAlex(h, async (_, url, options) => {
    seen.push(options.noCache);
    if (url.includes("/works/"))
      return {
        primary_location: {
          source: { issn_l: "1234-5678", issn: ["1234-5678", "1357-3039"] },
        },
      };
    return {
      display_name: "Example",
      issn_l: "1234-5678",
      issn: ["1234-5678", "8765-4321"],
      summary_stats: { "2yr_mean_citedness": 3 },
    };
  });
  await h.rank.lookupJournal(item("Example", "1234-5678"));
  assert.deepEqual(seen, [true]);
  const result = await oa.fetchOpenAlexByDOI("10.1234/test");
  assert.deepEqual(Array.from(result.issns), ["1234-5678", "8765-4321"]);
});

test("dual-ISSN local hits and misses reuse the exact input cache with OpenAlex disabled", async () => {
  for (const hit of [false, true]) {
    let lookups = 0;
    const h = rankHarness({
      prefs: { "rank.autoFetch": true },
      dataset: () => {
        lookups++;
        return hit ? metric("Q2") : [];
      },
    });
    const jobs = [];
    h.mocks["src/utils/timers.ts"].setTimeout = (fn) => {
      jobs.push(fn);
      return jobs.length;
    };
    h.mocks["src/utils/timers.ts"].clearTimeout = () => {};
    const paper = Object.assign(item("Dual Journal", "1234-5678, 8765-4321"), {
      id: 1,
    });
    await h.rank.lookupJournal(paper);
    assert.equal(h.rank.getJournalRecord(paper).values.length, hit ? 1 : 0);
    assert.equal(h.rank.requestJournalRecord(paper).values.length, hit ? 1 : 0);
    await h.rank.lookupJournal(paper);
    const reordered = item("Dual Journal", "8765-4321, 1234-5678");
    assert.equal(
      h.rank.journalRequestKeyOf(paper),
      h.rank.journalRequestKeyOf(reordered),
    );
    await h.rank.lookupJournal(reordered);
    assert.equal(lookups, 1);
    assert.equal(jobs.length, 0);
    assert.equal(h.entries.has("issn:8765-4321"), false);
    h.rank.stopRankService();
  }
});

test("unverified title/ISSN combinations neither publish aliases nor share queue entries", async () => {
  const h = rankHarness({
    prefs: { "rank.autoFetch": true, "rank.useEasyScholar": true },
  });
  h.mocks["src/rank/sources/easyscholar.ts"].fetchEasyScholar = async (
    name,
  ) => {
    h.calls.push(name);
    return {
      values: [
        {
          field: "sciUp",
          value: name === "Title A" ? "医学1区" : "医学4区",
          source: "easyscholar",
        },
      ],
    };
  };
  const jobs = [];
  h.mocks["src/utils/timers.ts"].setTimeout = (fn) => {
    jobs.push(fn);
    return jobs.length;
  };
  h.mocks["src/utils/timers.ts"].clearTimeout = () => {};
  const a = Object.assign(item("Title A", "1234-5678"), { id: 1 });
  const b = Object.assign(item("Title B", "1234-5678"), { id: 2 });
  assert.notEqual(h.rank.journalRequestKeyOf(a), h.rank.journalRequestKeyOf(b));
  assert.equal(h.rank.journalRequestKeyOf(item("")), "");
  h.context.Zotero.Items = { get: (id) => (id === 1 ? a : b) };
  h.rank.startRankService(() => {});
  h.rank.requestJournalRecord(a);
  h.rank.requestJournalRecord(b);
  jobs[0]();
  await new Promise(setImmediate);
  assert.deepEqual(h.calls, ["Title A", "Title B"]);
  assert.equal(h.entries.has("issn:1234-5678"), false);
  assert.equal(h.rank.getJournalRecord(a).values[0].value, "医学1区");
  assert.equal(h.rank.getJournalRecord(b).values[0].value, "医学4区");
  await h.rank.lookupJournal(a);
  await h.rank.lookupJournal(b);
  assert.equal(h.calls.length, 2);
  h.rank.stopRankService();
});

test("verified refreshes replace exact-query caches and supersede older query records under other titles", async () => {
  const prefs = { "rank.useEasyScholar": true, "rank.useOpenAlex": false };
  const h = rankHarness({ prefs });
  let value = "医学4区";
  h.mocks["src/rank/sources/easyscholar.ts"].fetchEasyScholar = async () => ({
    values: [{ field: "sciUp", value, source: "easyscholar" }],
  });
  const a = item("V. J.", "1234-5678");
  const b = item("Verified Journal", "1234-5678");
  await h.rank.lookupJournal(a);
  await h.rank.lookupJournal(b);
  for (const entry of h.entries.values()) entry.updated = 1;
  prefs["rank.useOpenAlex"] = true;
  value = "医学1区";
  h.mocks["src/rank/sources/openalex.ts"].fetchOpenAlexByISSN = async () => ({
    name: "Verified Journal",
    issn: "1234-5678",
    issns: ["1234-5678"],
    values: [{ field: "oa2yr", value: "3", source: "openalex" }],
  });
  await h.rank.refreshJournal(a);
  assert.equal(h.entries.has("query:v j:1234-5678"), false);
  assert.equal(h.rank.getJournalRecord(a).values[0].value, value);
  assert.equal(h.rank.getJournalRecord(b).values[0].value, value);
});

test("legacy input ISSNs alone never authorize cross-title cache reuse", () => {
  const key = "issn:1234-5678";
  const original = {
    key,
    name: "Original Journal",
    issn: "1234-5678",
    issns: ["1234-5678", "8765-4321"],
    values: metric("Q1"),
    updated: Date.now(),
  };
  const h = rankHarness({ records: { [key]: original } });
  assert.equal(
    h.rank.getJournalRecord(item("Another Journal", "1234-5678")),
    undefined,
  );
  assert.equal(
    h.rank.getJournalRecord(item("Original Journal", "1234-5678")).values[0]
      .value,
    "Q1",
  );
  assert.equal(h.entries.get(key), original);
});

test("same-name OpenAlex fallbacks cannot contradict the known catalogue identifiers", async () => {
  const h = rankHarness({
    dataset: () => metric("Q1"),
    prefs: { "rank.useOpenAlex": true },
  });
  const oa = h.mocks["src/rank/sources/openalex.ts"];
  const wrong = {
    name: ciiCanonical,
    issn: "1357-3039",
    issns: ["1357-3039"],
    values: [{ field: "oa2yr", value: "9", source: "openalex" }],
  };
  oa.fetchOpenAlexByISSN = async () => null;
  oa.fetchOpenAlexByDOI = async () => wrong;
  oa.fetchOpenAlexByName = async () => wrong;
  const paper = {
    getField: (key) =>
      ({ publicationTitle: ciiTitle, DOI: "10.1234/wrong" })[key] || "",
  };
  const result = await h.rank.lookupJournal(paper);
  assert.deepEqual(
    Array.from(result.values, (v) => v.field),
    ["sci"],
  );
  assert.equal(result.issns.includes("1357-3039"), false);
  assert.equal(h.entries.has("issn:1357-3039"), false);
});
