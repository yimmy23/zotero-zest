const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers.cjs");

const copy = (value) => JSON.parse(JSON.stringify(value));
const modulePath = "src/rank/impactFactor.ts";
const metadata = (overrides = {}) => ({
  year: 2024,
  impactFactor: 8.1,
  source: "dataset",
  categories: [
    { name: "Oncology", percentile: 91.2, rank: "20/322" },
    { name: "Immunology", percentile: 82.4 },
  ],
  ...overrides,
});
const value = (field, raw, source = "dataset") => ({
  field,
  value: raw,
  source,
});

test("rank-derived JCR validates source and recalculates percentile from the supplied fraction", () => {
  const { sanitizeJCRMetadata, resolveImpactFactor, parseJCRRank } =
    createHarness().load(modulePath);
  const raw = metadata({
    provider: "showjcr",
    percentileMethod: "rank",
    categories: [
      {
        name: "Oncology",
        rank: " 40 / 183 ",
        quartile: "Q1",
        percentile: 99.9,
      },
    ],
  });
  const clean = sanitizeJCRMetadata(raw);
  assert.equal(clean.categories[0].rank, "40/183");
  assert.equal(clean.categories[0].quartile, "Q1");
  assert.ok(
    Math.abs(clean.categories[0].percentile - 78.4153005464481) < 1e-10,
  );
  const resolved = resolveImpactFactor(
    { values: [value("sciif", "8.1")], jcr: clean },
    "sciif",
  );
  assert.equal(resolved.jcr.provider, "showjcr");
  assert.equal(resolved.jcr.percentileMethod, "rank");
  assert.equal(parseJCRRank("1/1").percentile, 50);
  assert.equal(parseJCRRank("1/100").percentile, 99.5);
  assert.equal(parseJCRRank("100/100").percentile, 0.5);
  for (const invalid of [
    { ...raw, provider: "unknown" },
    { ...raw, percentileMethod: "provided" },
    { ...raw, percentileMethod: undefined },
    { ...raw, source: "easyscholar" },
    { ...raw, categories: [{ name: "A", percentile: 99, rank: "N/A" }] },
    {
      ...raw,
      categories: [
        { name: "A", percentile: 99, rank: "1/100", quartile: "Q4" },
      ],
    },
  ])
    assert.equal(sanitizeJCRMetadata(invalid), undefined);
});

test("IF resolution preserves field priority, full raw provenance and numeric zero", () => {
  const { resolveImpactFactor } = createHarness().load(modulePath);
  const record = {
    values: [
      value("sciif", "8.1"),
      value("sciif5", "9.7"),
      value("oa2yr", "4.2", "openalex"),
    ],
    jcr: metadata(),
  };
  assert.deepEqual(copy(resolveImpactFactor(record, "sciif5")), {
    field: "sciif5",
    value: 9.7,
    raw: "9.7",
    source: "dataset",
  });
  assert.equal(resolveImpactFactor(record, "custom").jcr.categories.length, 2);
  record.values.unshift(value("custom", "0"));
  assert.deepEqual(copy(resolveImpactFactor(record, "custom")), {
    field: "custom",
    value: 0,
    raw: "0",
    source: "dataset",
  });
  record.values = [
    value("sciif", "N/A"),
    value("sciif5", "-1"),
    value("oa2yr", "0", "openalex"),
  ];
  assert.equal(resolveImpactFactor(record, "sciif").field, "oa2yr");
  assert.equal(resolveImpactFactor(record, "sciif").value, 0);
  assert.equal(resolveImpactFactor(record, "sciif").jcr, undefined);
  assert.equal(
    resolveImpactFactor({ values: [value("sciif", "Infinity")] }, "sciif"),
    undefined,
  );
  assert.equal(resolveImpactFactor(undefined, "sciif"), undefined);
});

test("JCR attaches only to a standard JIF from the matching source and value", () => {
  const { resolveImpactFactor } = createHarness().load(modulePath);
  for (const source of ["dataset", "easyscholar"]) {
    const rec = {
      values: [value("SCIIF", "８．１", source)],
      jcr: metadata({ source }),
    };
    assert.equal(resolveImpactFactor(rec, "sciif").jcr.year, 2024);
    rec.jcr = metadata({
      source: source === "dataset" ? "easyscholar" : "dataset",
    });
    assert.equal(resolveImpactFactor(rec, "sciif").jcr, undefined);
    rec.jcr = metadata({ source, impactFactor: 8.2 });
    assert.equal(resolveImpactFactor(rec, "sciif").jcr, undefined);
  }
});

test("JCR validation retains all subjects and percentile endpoints, and fails closed on conflicts", () => {
  const { sanitizeJCRMetadata } = createHarness().load(modulePath);
  const raw = metadata({
    impactFactor: 0,
    categories: [
      { name: " OnCoLoGy ", percentile: 0 },
      { name: "Immunology", percentile: 100 },
      { name: "oncology", percentile: 0 },
    ],
  });
  const before = copy(raw);
  const clean = sanitizeJCRMetadata(raw);
  assert.deepEqual(copy(clean.categories), [
    { name: "OnCoLoGy", percentile: 0 },
    { name: "Immunology", percentile: 100 },
  ]);
  assert.deepEqual(raw, before);
  const bad = [
    null,
    [],
    {},
    metadata({ year: undefined }),
    metadata({ year: "2024" }),
    metadata({ year: 1974 }),
    metadata({ year: 2024.5 }),
    metadata({ year: new Date().getFullYear() + 1 }),
    metadata({ source: "openalex" }),
    metadata({ source: "unknown" }),
    metadata({ impactFactor: -1 }),
    metadata({ impactFactor: null }),
    metadata({ categories: [] }),
    metadata({ categories: Array(51).fill(raw.categories[0]) }),
    ...[undefined, -1, 101, NaN, Infinity, "Q1", null].map((percentile) =>
      metadata({ categories: [{ name: "A", percentile }] }),
    ),
    metadata({ categories: [{ name: "", percentile: 50 }] }),
    metadata({ categories: [{ name: "A".repeat(201), percentile: 50 }] }),
    metadata({ categories: [{ name: "A", percentile: 50, rank: 2 }] }),
    metadata({
      categories: [{ name: "A", percentile: 50, rank: "x".repeat(81) }],
    }),
    metadata({
      categories: [
        { name: "A", percentile: 50 },
        { name: "a", percentile: 51 },
      ],
    }),
    metadata({
      categories: [
        { name: "A", percentile: 50, rank: "1/2" },
        { name: "a", percentile: 50, rank: "2/3" },
      ],
    }),
  ];
  for (const candidate of bad)
    assert.equal(
      sanitizeJCRMetadata(candidate),
      undefined,
      JSON.stringify(candidate),
    );
});

function datasetHarness(files = []) {
  const h = createHarness({
    mocks: {
      "src/core/config.ts": {
        zestConfig: {
          get: () => ({ datasets: files.map((_, i) => ({ id: `ds${i}` })) }),
        },
      },
    },
    globals: {
      PathUtils: { join: (...parts) => parts.join("/") },
      IOUtils: { exists: async () => true },
      Zotero: {
        DataDirectory: { dir: "/memory" },
        File: {
          getContentsAsync: async (path) =>
            JSON.stringify(files[Number(path.match(/ds(\d+)\.json$/)[1])]),
        },
      },
    },
  });
  return { ...h, ds: h.load("src/rank/sources/localDataset.ts") };
}

test("local JCR JSON and canonical CSV schemas preserve metadata without leaking into rank fields", () => {
  const { ds } = datasetHarness();
  const row = {
    name: "Example",
    issn: "1234-5678",
    sciif: "8.1",
    sci: "Q1",
    jcr: metadata(),
  };
  const parsed = ds.parseDataset(JSON.stringify([row]), "json");
  assert.deepEqual(copy(parsed.fields), ["sciif", "sci"]);
  assert.deepEqual(copy(parsed.rows[0].jcr), row.jcr);
  for (const [year, percentile, expected] of [
    ["2024", "0", 0],
    ["2024", "100", 100],
    ["", "95", undefined],
    ["2024", "Q1", undefined],
  ]) {
    const csv = ds.parseDataset(
      `name,sciif,jcrYear,jcrCategory,jifPercentile,jcrRank\nExample,0,${year},Oncology,${percentile},20/322`,
      "csv",
    );
    assert.deepEqual(copy(csv.fields), ["sciif"]);
    assert.equal(csv.rows[0].jcr?.categories[0].percentile, expected);
  }
  for (const jcr of [
    metadata({ impactFactor: 9 }),
    metadata({ source: "easyscholar" }),
    { categories: [{ name: "A", percentile: 99 }] },
  ]) {
    assert.equal(
      ds.parseDataset(JSON.stringify([{ ...row, jcr }]), "json").rows[0].jcr,
      undefined,
    );
  }
  assert.equal(
    ds.parseDataset("name,sciif,sci\nExample,8.1,Q1", "csv").rows[0].jcr,
    undefined,
  );
});

test("legacy scalar jcr fields stay available as journal labels in CSV and JSON", () => {
  const { ds } = datasetHarness();
  const csv = ds.parseDataset("name,jcr,sciif\nExample,Q1,8.1", "csv");
  assert.deepEqual(copy(csv.fields), ["jcr", "sciif"]);
  assert.deepEqual(copy(csv.rows[0].fields), { jcr: "Q1", sciif: "8.1" });
  assert.equal(csv.rows[0].jcr, undefined);
  for (const jcr of ["Q1", 0, false, ["Q1", "Q2"]]) {
    const parsed = ds.parseDataset(
      JSON.stringify([{ name: "Example", JCR: jcr, sciif: "8.1" }]),
      "json",
    );
    assert.equal(parsed.rows[0].fields.JCR, String(jcr));
    assert.equal(parsed.rows[0].jcr, undefined);
  }
});

test("flat JCR metadata opts in only with its complete column group", () => {
  const { ds } = datasetHarness();
  for (const missing of ["sciif", "jcrYear", "jcrCategory", "jifPercentile"]) {
    const row = {
      name: "Example",
      jcr: "Q1",
      sciif: "8.1",
      jcrYear: "2024",
      jcrCategory: "Custom",
      jifPercentile: "95",
      jcrRank: "My rank",
    };
    delete row[missing];
    const parsed = ds.parseDataset(JSON.stringify([row]), "json");
    const expected = { ...row };
    delete expected.name;
    assert.deepEqual(copy(parsed.rows[0].fields), expected);
    assert.equal(parsed.rows[0].jcr, undefined);
  }
  const csv = ds.parseDataset(
    "name,jcr,sciif,jcrYear,jcrCategory,jifPercentile,jcrRank\nExample,Q1,8.1,2024,Oncology,95,20/322",
    "csv",
  );
  assert.deepEqual(copy(csv.rows[0].fields), { jcr: "Q1", sciif: "8.1" });
  assert.equal(csv.rows[0].jcr.categories[0].percentile, 95);
  assert.equal(csv.rows[0].jcr.categories[0].rank, "20/322");
});

test("stored local JCR survives reload but never borrows another dataset's category data", async () => {
  const first = {
    name: "Example",
    issn: "1234-5678",
    fields: { sciif: "8.1" },
  };
  const second = { ...first, jcr: metadata() };
  for (const files of [
    [[first], [second]],
    [[second], [first]],
  ]) {
    const h = datasetHarness(files);
    await h.ds.loadDatasets();
    const rec = h.ds.lookupDatasetRecord("example", first.issn);
    assert.deepEqual(copy(rec.values), [value("sciif", "8.1")]);
    assert.equal(Boolean(rec.jcr), Boolean(files[0][0].jcr));
    assert.deepEqual(
      copy(h.ds.lookupDataset("example", first.issn)),
      copy(rec.values),
    );
  }
  const h = datasetHarness([[{ ...first, fields: { sci: "Q1" } }], [second]]);
  await h.ds.loadDatasets();
  assert.equal(
    h.ds.lookupDatasetRecord("example", first.issn).jcr.categories.length,
    2,
  );
});

test("duplicate journal rows do not silently select JCR subjects by file order", async () => {
  const a = {
    name: "Example",
    issn: "1234-5678",
    fields: { sciif: "8.1" },
    jcr: metadata(),
  };
  const b = {
    ...a,
    jcr: metadata({ categories: [{ name: "Other subject", percentile: 30 }] }),
  };
  for (const rows of [
    [a, b],
    [b, a],
  ]) {
    const before = copy(rows);
    const h = datasetHarness([rows]);
    await h.ds.loadDatasets();
    const rec = h.ds.lookupDatasetRecord("example", a.issn);
    assert.equal(rec.jcr, undefined);
    assert.equal(rec.values[0].value, "8.1");
    assert.deepEqual(rows, before);
  }
});

test("same-title journals with distinct identifiers retain their own category metadata", async () => {
  const rows = ["1234-5678", "8765-4321"].map((issn, index) => ({
    name: "Example",
    issn,
    fields: { sciif: "8.1" },
    jcr: metadata({
      categories: [{ name: "Oncology", percentile: index * 100 }],
    }),
  }));
  const h = datasetHarness([rows]);
  await h.ds.loadDatasets();
  assert.equal(h.ds.lookupDatasetRecord("example").jcr, undefined);
  for (let index = 0; index < rows.length; index++) {
    assert.equal(
      h.ds.lookupDatasetRecord("example", rows[index].issn).jcr.categories[0]
        .percentile,
      index * 100,
    );
  }
});
