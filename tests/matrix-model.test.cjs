const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers.cjs");

const model = createHarness().load("src/annots/matrixModel.ts");
const row = (values = {}) => ({
  annotation: {},
  attachment: {},
  key: "ANN00001",
  page: "iv",
  text: "Lung cancer trial",
  comment: "A useful method",
  color: "#ffd400",
  type: "highlight",
  tags: ["Method/Cohort"],
  itemTitle: "Study A",
  itemID: 1,
  itemIdentity: "1/STUDY001",
  attachmentTitle: "Main PDF",
  sourceURL:
    "zotero://open-pdf/library/items/ATT00001?page=4&annotation=ANN00001",
  ...values,
});
const plain = (value) => JSON.parse(JSON.stringify(value));

test("matrix query preserves AND, OR and exclusions and accepts spaced pipes", () => {
  const sample = row();
  for (const query of [
    "",
    "  ",
    "lung trial",
    "LUNG TRIAL",
    "lung|heart",
    "heart | lung trial",
    "heart| lung trial",
    "heart |lung trial",
    "lung -heart",
    "method/cohort",
    "main PDF",
  ]) {
    assert.equal(model.matchesQuery(sample, query), true, query);
  }
  for (const query of ["lung heart", "heart|liver", "lung -trial", "-useful"]) {
    assert.equal(model.matchesQuery(sample, query), false, query);
  }
});

test("quoted phrases, escaped quotes and literal pipes do not change the grammar", () => {
  assert.equal(model.matchesQuery(row(), '"lung cancer" trial'), true);
  assert.equal(model.matchesQuery(row(), '"cancer lung"'), false);
  assert.equal(model.matchesQuery(row(), '-"lung cancer"'), false);
  assert.equal(
    model.matchesQuery(row(), '"heart trial" | "lung cancer"'),
    true,
  );
  assert.equal(model.matchesQuery(row(), '"lung cancer'), true);
  assert.equal(
    model.matchesQuery(row({ text: 'a "trial"' }), '"a \\"trial\\""'),
    true,
  );
  assert.equal(model.matchesQuery(row({ text: "foo|bar" }), '"foo|bar"'), true);
  assert.equal(
    model.matchesQuery(row({ text: "foo bar" }), '"foo|bar"'),
    false,
  );
  assert.equal(model.matchesQuery(row(), "| lung || | heart |"), true);
  assert.equal(model.matchesQuery(row(), "|"), true);
});

test("combined filters are exact, use cached search text and do not mutate input", () => {
  const first = row({ searchText: "cached topic" });
  const second = row({ key: "ANN00002", comment: " ", type: "image" });
  const rows = [first, second];
  const snapshot = JSON.stringify(rows);
  const filters = {
    ...model.emptyFilters(),
    query: "cached topic",
    color: "#FFD400",
    tag: "Method/Cohort",
    item: "1/STUDY001",
    type: "highlight",
    commentsOnly: true,
  };
  assert.deepEqual(plain(model.filterRows(rows, filters)), plain([first]));
  assert.equal(model.filterRows(rows, { ...filters, tag: "Method" }).length, 0);
  assert.equal(
    model.filterRows(rows, { ...filters, item: "2/STUDY001" }).length,
    0,
  );
  assert.equal(model.filterRows(rows, { ...filters, query: "lung" }).length, 0);
  assert.equal(JSON.stringify(rows), snapshot);
  assert.notEqual(model.emptyFilters(), model.emptyFilters());
});

test("title sorting is stable and source order never sorts page labels", () => {
  const rows = [
    row({ itemTitle: "Study 10", key: "ANN00003", page: "1" }),
    row({ itemTitle: "Study 2", key: "ANN00002", page: "iv" }),
    row({ itemTitle: "Study 2", key: "ANN00001", page: "ii" }),
  ];
  const sorted = model.filterRows(rows, {
    ...model.emptyFilters(),
    sort: "title",
  });
  assert.deepEqual(
    Array.from(sorted, (r) => r.key),
    ["ANN00002", "ANN00001", "ANN00003"],
  );
  assert.deepEqual(
    Array.from(model.filterRows(rows, model.emptyFilters()), (r) => r.key),
    ["ANN00003", "ANN00002", "ANN00001"],
  );
});

test("CSV retains the six original columns, all provenance and formula protection", () => {
  const csv = model.toCSV([
    row({ itemTitle: "=SUM(A1)", text: 'A, "quote"\nnext', comment: "@risk" }),
  ]);
  assert.equal(
    csv.split("\n")[0],
    "item,page,text,comment,color,tags,type,attachment,sourceURL,itemIdentity,key",
  );
  assert.ok(csv.includes('"\'=SUM(A1)"'));
  assert.ok(csv.includes('"A, ""quote""\nnext"'));
  assert.ok(csv.includes('"\'@risk"'));
  assert.ok(csv.includes('"1/STUDY001","ANN00001"'));
  assert.equal(model.toCSV([]).split("\n").length, 1);
});

test("Markdown keeps same-title papers separate and includes both text and comments", () => {
  const markdown = model.toMarkdown(
    [
      row(),
      row({
        itemIdentity: "2/STUDY001",
        key: "ANN00002",
        comment: "Different library",
      }),
    ],
    { page: "页码", comment: "批注", tags: "标签", source: "定位" },
  );
  assert.equal((markdown.match(/^## Study A$/gm) || []).length, 2);
  assert.ok(markdown.includes("页码 iv"));
  assert.ok(markdown.includes("批注:\n\n> A useful method"));
  assert.ok(markdown.includes("标签: Method/Cohort"));
  assert.ok(markdown.includes("[定位](zotero://open-pdf/"));
  assert.ok(markdown.includes("> Lung cancer trial"));
  assert.ok(markdown.includes("> Different library"));
});

test("Markdown escapes untrusted HTML, links, headings and multiline content", () => {
  const markdown = model.toMarkdown([
    row({
      itemTitle: "# title\n<script>x</script>",
      text: "[link](javascript:evil)\n# injected\n<img onerror=evil>",
      comment: "**raw** & <tag>\nsecond line",
      tags: ["a|b", "<svg>"],
      sourceURL: "javascript:alert(1)",
    }),
  ]);
  assert.ok(markdown.includes("\\[link\\]\\(javascript:evil\\)"));
  assert.ok(markdown.includes("> \\# injected"));
  assert.ok(markdown.includes("&lt;img onerror=evil&gt;"));
  assert.ok(markdown.includes("\\*\\*raw\\*\\* &amp; &lt;tag&gt;"));
  assert.ok(markdown.includes("> second line"));
  assert.ok(!markdown.includes("<script>"));
  assert.ok(!markdown.includes("javascript:alert"));
  assert.ok(!markdown.includes("\n# injected"));
});

test("textless marks remain visible in Markdown without inventing annotation text", () => {
  const markdown = model.toMarkdown([
    row({ text: "", comment: "", type: "image", page: "" }),
  ]);
  assert.ok(markdown.includes("Main PDF · image"));
  assert.ok(markdown.includes("annotation=ANN00001"));
  assert.ok(!markdown.includes("> "));
});
