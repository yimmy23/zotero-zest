const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers.cjs");
const copy = (value) => JSON.parse(JSON.stringify(value));
const header = [
  "Journal",
  "ISSN",
  "EISSN",
  "IF(2025)",
  "Category_1",
  "IF Quartile(2025)_1",
  "IF Rank(2025)_1",
  "Category_2",
  "IF Quartile(2025)_2",
  "IF Rank(2025)_2",
];
const row = [
  "CANCER IMMUNOLOGY IMMUNOTHERAPY",
  "0340-7004",
  "1432-0851",
  "5.8",
  "IMMUNOLOGY",
  "Q1",
  "40/183",
  "ONCOLOGY",
  "Q1",
  "67/333",
];
const parse = (rows) =>
  createHarness().load("src/rank/sources/showjcr.ts").parseShowJCRRows(rows);

test("ShowJCR imports explicit metric year, verified aliases and every source category rank", () => {
  const input = [header, row];
  const before = copy(input);
  const parsed = parse(input);
  assert.equal(parsed.name, "ShowJCR 2025");
  assert.equal(parsed.rows.length, 1);
  const journal = parsed.rows[0];
  assert.equal(journal.issn, "0340-7004, 1432-0851");
  assert.equal(journal.fields.sciif, "5.8");
  assert.equal(journal.fields.sci, "Q1");
  assert.equal(journal.fields["Category_2"], "ONCOLOGY");
  assert.equal(journal.fields["IF Rank(2025)_2"], "67/333");
  assert.equal(journal.jcr.year, 2025);
  assert.equal(journal.jcr.provider, "showjcr");
  assert.equal(journal.jcr.percentileMethod, "rank");
  assert.deepEqual(
    copy(journal.jcr.categories).map(({ name, rank, quartile }) => ({
      name,
      rank,
      quartile,
    })),
    [
      { name: "IMMUNOLOGY", rank: "40/183", quartile: "Q1" },
      { name: "ONCOLOGY", rank: "67/333", quartile: "Q1" },
    ],
  );
  assert.ok(
    Math.abs(journal.jcr.categories[0].percentile - 78.4153005464481) < 1e-10,
  );
  assert.ok(
    Math.abs(journal.jcr.categories[1].percentile - 80.03003003003003) < 1e-10,
  );
  assert.deepEqual(input, before);
});

test("multiple quartiles remain in source category order without selecting the best", () => {
  const raw = [...row];
  raw[5] = "Q3";
  raw[6] = "70/100";
  raw[8] = "Q1";
  raw[9] = "10/100";
  const parsed = parse([header, raw]).rows[0];
  assert.equal(parsed.fields.sci, "Q3 / Q1");
  assert.deepEqual(
    copy(parsed.jcr.categories).map(({ percentile }) => percentile),
    [30.5, 90.5],
  );
});

test("missing category ranks and nonnumeric IF preserve raw fields without fabricating percentiles", () => {
  for (const metric of [
    "<0.1",
    "N/A",
    "1e3",
    "-1",
    "1,000",
    "Infinity",
    "1.2.3",
  ]) {
    const raw = [...row];
    raw[3] = metric;
    const parsed = parse([header, raw]).rows[0];
    assert.equal(parsed.fields.sciif, metric);
    assert.equal(parsed.fields.sci, "Q1");
    assert.equal(parsed.jcr, undefined);
  }
  for (const rank of [
    "",
    "N/A",
    "0/183",
    "184/183",
    "40/0",
    "4e1/183",
    "40/183/200",
    "40.5/183",
    "40/1,000",
    "-40/183",
  ]) {
    const raw = [...row];
    raw[6] = rank;
    const parsed = parse([header, raw]).rows[0];
    assert.equal(parsed.jcr, undefined, rank);
    assert.equal(parsed.fields["Category_2"], "ONCOLOGY");
    assert.equal(parsed.fields["IF Rank(2025)_2"], "67/333");
    if (rank) assert.equal(parsed.fields["IF Rank(2025)_1"], rank);
  }
  const zero = [...row];
  zero[3] = "0";
  assert.equal(parse([header, zero]).rows[0].jcr.impactFactor, 0);
});

test("malformed, duplicated and mixed-year ShowJCR schemas fail recognition", () => {
  const badHeaders = [
    header.filter((value) => value !== "Journal"),
    header.filter((value) => !["ISSN", "EISSN"].includes(value)),
    [...header, "IF(2024)"],
    [...header, "IF(2025)"],
    header.map((value) =>
      value === "IF Rank(2025)_2" ? "IF Rank(2024)_2" : value,
    ),
    header.filter((value) => value !== "IF Quartile(2025)_2"),
    [...header, "IF Rank(2025)_3"],
    [...header, "Category_0"],
    [...header, "IF Rank(2025)_x"],
    header.map((value) => value.replace(/2025/g, "9999")),
  ];
  for (const candidate of badHeaders)
    assert.equal(parse([candidate, row]), null, JSON.stringify(candidate));
  assert.equal(parse([]), null);
  assert.equal(parse([header, [...row, "unheaded data"]]), null);
});

test("contradictory Q/rank, orphaned rank and duplicate category data suppress the whole graph", () => {
  const bad = [
    (() => {
      const raw = [...row];
      raw[5] = "Q4";
      return raw;
    })(),
    (() => {
      const raw = [...row];
      raw[4] = "";
      return raw;
    })(),
    (() => {
      const raw = [...row];
      raw[7] = "IMMUNOLOGY";
      return raw;
    })(),
    (() => {
      const raw = [...row];
      raw[8] = "Q5";
      return raw;
    })(),
  ];
  for (const raw of bad)
    assert.equal(parse([header, raw]).rows[0].jcr, undefined);
});

test("three known malformed eISSNs are dropped while their valid print ISSNs survive", () => {
  for (const [name, issn, eissn, metric, category, quartile, rank] of [
    [
      "RADICAL PHILOSOPHY",
      "0300-211X",
      "0030-211X",
      "2",
      "ETHICS",
      "Q2",
      "27/78",
    ],
    [
      "AFRICAN ENTOMOLOGY",
      "1021-3589",
      "2254-8854",
      "0.9",
      "ENTOMOLOGY",
      "Q3",
      "77/110",
    ],
    [
      "World Journal for Pediatric and Congenital Heart Surgery",
      "2150-1351",
      "2150-0136",
      "0.9",
      "CARDIAC & CARDIOVASCULAR SYSTEMS",
      "Q4",
      "199/237",
    ],
  ]) {
    const parsed = parse([
      header,
      [name, issn, eissn, metric, category, quartile, rank],
    ]).rows[0];
    assert.equal(parsed.issn, issn);
    assert.equal(parsed.jcr.categories[0].rank, rank);
  }
});

test("duplicate rows collapse but conflicting journal identities cannot be selected by file order", () => {
  assert.equal(parse([header, row, [...row]]).rows.length, 1);
  const other = [...row];
  other[0] = "A different journal";
  other[3] = "9";
  for (const records of [
    [row, other],
    [other, row],
    [row, [...row], other],
    [other, row, [...row]],
  ])
    assert.equal(parse([header, ...records]).rows.length, 0);
});

test("conflicting same-year subject denominators disable related whole-journal graphs only", () => {
  const other = [
    "Other Journal",
    "0028-0836",
    "",
    "12",
    "immunology",
    "Q1",
    "20/200",
    "NEUROLOGY",
    "Q1",
    "10/100",
  ];
  const unaffected = [
    "Unaffected Journal",
    "0007-9235",
    "",
    "10",
    "ONCOLOGY",
    "Q1",
    "1/333",
  ];
  for (const records of [
    [row, other, unaffected],
    [unaffected, other, row],
  ]) {
    const before = copy(records);
    const parsed = parse([header, ...records]);
    assert.equal(parsed.rows.length, 3);
    for (const name of [row[0], other[0]]) {
      const journal = parsed.rows.find((entry) => entry.name === name);
      assert.equal(journal.jcr, undefined);
      assert.ok(journal.fields.sciif);
      assert.equal(journal.fields.sci, "Q1");
      assert.ok(journal.fields["IF Rank(2025)_1"]);
      assert.ok(journal.fields["Category_2"]);
    }
    const kept = parsed.rows.find((entry) => entry.name === unaffected[0]);
    assert.equal(kept.jcr.categories[0].rank, "1/333");
    assert.deepEqual(records, before);
  }
});

test("a conflicting denominator remains evidence even when that journal's IF is suppressed", () => {
  const other = [
    "Other Journal",
    "0028-0836",
    "",
    "<0.1",
    "IMMUNOLOGY",
    "Q1",
    "20/200",
  ];
  const parsed = parse([header, row, other]);
  assert.equal(parsed.rows[0].jcr, undefined);
  assert.equal(parsed.rows[1].fields.sciif, "<0.1");
  assert.equal(parsed.rows[1].jcr, undefined);
});

test("ShowJCR accepts BOM, reordered columns and unfilled trailing subject slots", () => {
  const indices = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
  const reordered = indices.map((index) => header[index]);
  reordered[0] = `\uFEFF${reordered[0]}`;
  const parsed = parse([reordered, indices.map((index) => row[index])]);
  assert.equal(parsed.rows[0].fields.sciif, "5.8");
  assert.deepEqual(
    copy(parsed.rows[0].jcr.categories).map(({ name }) => name),
    ["IMMUNOLOGY", "ONCOLOGY"],
  );
  assert.equal(
    parse([header, row.slice(0, 7)]).rows[0].jcr.categories.length,
    1,
  );
});
