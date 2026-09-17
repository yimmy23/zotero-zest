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
const paper = (
  name = "Example",
  issn = "1234-5678",
  id = 1,
  journalAbbreviation = "",
) => ({
  id,
  getField: (key) =>
    ({ publicationTitle: name, ISSN: issn, journalAbbreviation })[key] || "",
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

const jcehTitle = "Journal of clinical and experimental hematopathology : JCEH";
const jcehCanonical = "Journal of Clinical and Experimental Hematopathology";
const jcehIDs = ["1346-4280", "1880-9952"];

function jcehShowJCRRows() {
  const { parseShowJCRRows } = createHarness().load(
    "src/rank/sources/showjcr.ts",
  );
  return parseShowJCRRows([
    [
      "Journal",
      "ISSN",
      "eISSN",
      "IF(2025)",
      "Category_1",
      "IF Quartile(2025)_1",
      "IF Rank(2025)_1",
    ],
    [jcehCanonical, ...jcehIDs, "1.4", "HEMATOLOGY", "Q4", "78/103"],
  ]).rows;
}

test("JCEH with an empty ISSN immediately reads its ShowJCR 2025 IF and provenance", async () => {
  const h = await fixture({ rows: jcehShowJCRRows() });
  const original = paper(jcehTitle, "");
  for (const read of [h.rank.getJournalRecord, h.rank.requestJournalRecord]) {
    const result = read(original);
    assert.ok(result, "the exact imported title must match with no ISSN");
    assert.equal(result.values.find((v) => v.field === "sciif").value, "1.4");
    assert.equal(result.values.find((v) => v.field === "sci").value, "Q4");
    assert.equal(result.jcr.year, 2025);
    assert.equal(result.jcr.impactFactor, 1.4);
    assert.equal(result.jcr.provider, "showjcr");
    assert.equal(result.jcr.percentileMethod, "rank");
    assert.equal(result.jcr.categories[0].name, "HEMATOLOGY");
    assert.equal(result.jcr.categories[0].quartile, "Q4");
    assert.equal(result.jcr.categories[0].rank, "78/103");
    assert.equal(result.name, jcehTitle);
  }
  assert.equal(original.getField("publicationTitle"), jcehTitle);
  assert.equal(original.getField("ISSN"), "");
  assert.equal(h.requests.length, 0);
  assert.equal(h.writes.length, 0);
  assert.equal(h.timers.size, 0);
  const refreshed = await h.rank.lookupJournal(original);
  assert.equal(refreshed.values.find((v) => v.field === "sciif").value, "1.4");
});

test("JCEH local matching accepts verified ISSNs and abbreviations but retains journal conflicts", async () => {
  const rows = jcehShowJCRRows();
  rows[0].issn = jcehIDs[0];
  const h = await fixture({ rows });
  for (const title of [jcehCanonical, jcehTitle, "J. Clin. Exp. Hematop."]) {
    for (const ids of ["", ...jcehIDs, jcehIDs.join("; ")]) {
      const result = h.rank.getJournalRecord(paper(title, ids));
      assert.equal(
        result?.values.find((v) => v.field === "sciif").value,
        "1.4",
      );
    }
    for (const ids of ["1234-5678", `${jcehIDs[0]}, 1234-5678`]) {
      assert.equal(h.rank.getJournalRecord(paper(title, ids)), undefined);
    }
  }
  for (const title of [
    "JCEH",
    "Journal of Hematopathology",
    "Journal of Clinical and Experimental Hematology",
    `${jcehCanonical}: Clinical Edition`,
  ]) {
    assert.equal(h.rank.getJournalRecord(paper(title, "")), undefined);
  }
  await h.replaceRows([
    ...rows,
    {
      name: "Journal of Hematopathology",
      issn: "1868-9256",
      fields: { sciif: "0.8" },
    },
  ]);
  assert.equal(
    h.rank.getJournalRecord(paper(jcehTitle, "")).values[0].value,
    "1.4",
  );
  assert.equal(
    h.rank.getJournalRecord(paper("Journal of Hematopathology", "")).values[0]
      .value,
    "0.8",
  );
  assert.equal(h.requests.length, 0);
});

test("verified NEJM aliases retain correct print and electronic identifiers", async () => {
  const h = await fixture({
    rows: [
      {
        name: "NEW ENGLAND JOURNAL OF MEDICINE",
        issn: "0028-4793",
        fields: { sciif: "84.5" },
      },
    ],
  });
  for (const title of [
    "New England Journal of Medicine",
    "The New England journal of medicine",
    "N. Engl. J. Med.",
  ]) {
    for (const issn of ["", "0028-4793", "1533-4406"]) {
      assert.equal(
        h.rank.getJournalRecord(paper(title, issn))?.values[0].value,
        "84.5",
      );
    }
  }
  assert.equal(h.requests.length, 0);
  assert.equal(h.writes.length, 0);
});

test("known journal titles with contradictory ISSNs cannot read another journal's local or cached metrics", async () => {
  const wrongID = "1556-0864";
  const wrongRecord = cached([metric("sciif", "23.3")], {
    key: `issn:${wrongID}`,
    name: "Journal of Thoracic Oncology",
    issn: wrongID,
    issns: [wrongID],
    requestedISSNs: [wrongID],
  });
  const h = await fixture({
    rows: [
      ...jcehShowJCRRows(),
      { name: wrongRecord.name, issn: wrongID, fields: { sciif: "23.3" } },
    ],
    records: [wrongRecord],
    prefs: {
      "rank.autoFetch": true,
      "rank.useEasyScholar": true,
      "rank.useOpenAlex": true,
    },
  });
  for (const title of [
    jcehTitle,
    "J Clin Exp Hematop",
    "The New England journal of medicine",
  ]) {
    const conflict = paper(title, wrongID);
    assert.equal(h.rank.journalKeyOf(conflict).key, "");
    assert.equal(h.rank.journalRequestKeyOf(conflict), "");
    assert.equal(h.rank.getJournalRecord(conflict), undefined);
    assert.equal(h.rank.requestJournalRecord(conflict), undefined);
    assert.equal(await h.rank.lookupJournal(conflict), null);
    assert.equal(await h.rank.lookupJournal(conflict, true), null);
  }
  assert.equal(h.requests.length, 0);
  assert.equal(h.writes.length, 0);
  assert.equal(h.timers.size, 0);
  assert.equal(h.entries.get(wrongRecord.key), wrongRecord);
});

test("unverified abbreviations and qualified titles stay unmatched until a matching ISSN is supplied", async () => {
  const examples = [
    ["Front Oncol", "Frontiers in Oncology", "2234-943X"],
    ["J Thorac Oncol", "Journal of Thoracic Oncology", "1556-0864"],
    ["JAMA Netw Open", "JAMA Network Open", "2574-3805"],
    ["Diagnostics (Basel, Switzerland)", "Diagnostics", "2075-4418"],
    ["Radiation Oncology (London, England)", "Radiation Oncology", "1748-717X"],
    [
      "European Journal of Cancer (Oxford, England : 1990)",
      "EUROPEAN JOURNAL OF CANCER",
      "0959-8049",
    ],
    ["Clinics (Sao Paulo)", "Clinics", "1807-5932"],
    ["Cancers (Basel)", "Cancers", "2072-6694"],
    [
      "Journal of the National Cancer Institute",
      "JNCI-Journal of the National Cancer Institute",
      "0027-8874",
    ],
    [
      "Virchows Archiv : an international journal of pathology",
      "VIRCHOWS ARCHIV",
      "0945-6317",
    ],
  ];
  const h = await fixture({
    rows: examples.map(([, name, issn], index) => ({
      name,
      issn,
      fields: { sciif: String(index + 1) },
    })),
  });
  for (const [index, [name, canonical, issn]] of examples.entries()) {
    const original = paper(name, "");
    for (const read of [h.rank.getJournalRecord, h.rank.requestJournalRecord]) {
      assert.equal(read(original), undefined, name);
      assert.equal(
        read(paper(name, issn))?.values[0].value,
        String(index + 1),
        name,
      );
      assert.equal(
        read(paper(canonical, ""))?.values[0].value,
        String(index + 1),
        canonical,
      );
      assert.equal(read(paper(name, "9999-9999")), undefined, name);
    }
    assert.equal(original.getField("publicationTitle"), name);
  }
  assert.equal(h.requests.length, 0);
  assert.equal(h.writes.length, 0);
  assert.equal(h.timers.size, 0);
});

test("duplicate dataset names remain ambiguous despite an unverified item abbreviation", async () => {
  const h = await fixture({
    rows: [
      { name: "MEDICINE", issn: "0025-7974", fields: { sciif: "2" } },
      { name: "Medicine", issn: "1357-3039", fields: { sciif: "3" } },
    ],
  });
  for (const abbreviation of [
    "",
    "Medicine (Baltimore)",
    "Medicine (Abingdon)",
    "J Thorac Oncol",
    "Unknown",
  ]) {
    for (const read of [h.rank.getJournalRecord, h.rank.requestJournalRecord]) {
      assert.equal(read(paper("Medicine", "", 1, abbreviation)), undefined);
      assert.equal(
        read(paper("Medicine", "0025-7974", 1, abbreviation))?.values[0].value,
        "2",
      );
      assert.equal(
        read(paper("Medicine", "1357-3039", 1, abbreviation))?.values[0].value,
        "3",
      );
    }
  }
  assert.equal(h.requests.length, 0);
  assert.equal(h.writes.length, 0);
  assert.equal(h.timers.size, 0);
});

test("verified JCEH titles reject conflicting identifiers and unverified local or cache names", async () => {
  for (const [name, issn] of [
    [`The ${jcehCanonical}`, "1556-0864"],
    [`The ${jcehCanonical}`, ""],
    [jcehTitle, "1556-0864"],
  ]) {
    const record = cached([metric("sciif", "99")], {
      key: "name:journal of clinical and experimental hematopathology",
      name,
      issn,
      issns: issn ? [issn] : undefined,
      requestedISSNs: [],
    });
    const h = await fixture({
      rows: [{ name: record.name, issn, fields: { sciif: "99" } }],
      records: [record],
    });
    const current = paper(jcehTitle, "");
    for (const read of [h.rank.getJournalRecord, h.rank.requestJournalRecord])
      assert.equal(read(current), undefined);
    assert.equal((await h.rank.lookupJournal(current)).values.length, 0);
    await h.replaceRows([
      {
        name: jcehCanonical,
        issn: jcehIDs[0],
        fields: { sciif: "2" },
      },
    ]);
    assert.equal(h.rank.getJournalRecord(current).values[0].value, "2");
  }
});

test("official-journal boilerplate cannot prove that a historical name-only source is a current catalogue identity", async () => {
  const name = `${jcehCanonical}: Official Journal of an Unverified Historical Society`;
  const record = cached([metric("sciif", "99")], {
    key: "name:journal of clinical and experimental hematopathology",
    name,
    issn: undefined,
    issns: undefined,
    requestedISSNs: [],
  });
  const h = await fixture({
    rows: [{ name, fields: { sciif: "99" } }],
    records: [record],
  });
  const current = paper(jcehTitle, "");
  assert.equal(h.rank.getJournalRecord(current), undefined);
  assert.equal(h.rank.requestJournalRecord(current), undefined);
  assert.equal((await h.rank.lookupJournal(current)).values.length, 0);
  await h.replaceRows([
    {
      name: jcehCanonical,
      issn: jcehIDs[0],
      fields: { sciif: "3" },
    },
  ]);
  const historical = paper(name, "");
  assert.equal(h.rank.getJournalRecord(historical), undefined);
  assert.equal(h.rank.requestJournalRecord(historical), undefined);
  assert.equal(await h.rank.lookupJournal(historical), null);
  assert.equal(
    h.rank.getJournalRecord(paper(name, jcehIDs[0])).values[0].value,
    "3",
  );
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

test("version-1 source-verified aliases and catalogue aliases still reach print-only local rows", async () => {
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

test("uncatalogued custom name-only rows remain usable alongside source-verified cache aliases", async () => {
  const h = await fixture({
    rows: [{ name: "Example", fields: { sciif: "8.1" } }],
    records: [cached([metric("oa2yr", "4", "openalex")])],
  });
  assert.equal(h.rank.getJournalRecord(paper()).values[0].value, "8.1");
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
