const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness } = require("./helpers.cjs");

function setup() {
  const nodes = [];
  const doc = {
    createElement(tag) {
      let content = "";
      const node = {
        tag,
        localName: tag,
        children: [],
        className: "",
        get textContent() {
          return (
            content + this.children.map((child) => child.textContent).join("")
          );
        },
        set textContent(value) {
          content = String(value);
          this.children = [];
        },
        appendChild(child) {
          this.children.push(child);
          return child;
        },
        append(...children) {
          children.forEach((child) => this.appendChild(child));
        },
      };
      nodes.push(node);
      return node;
    },
  };
  const { renderJournalMetrics } = createHarness({
    mocks: {
      "src/utils/locale.ts": {
        getString(key, options) {
          return options?.args
            ? `${key}: ${Object.values(options.args).join(" | ")}`
            : key;
        },
      },
    },
  }).load("src/panes/journalMetrics.ts");
  return {
    nodes,
    render: (record, field = "sciif") =>
      renderJournalMetrics(doc, record, field),
  };
}

function record(overrides = {}) {
  return {
    key: "issn:0340-7004",
    name: "Cancer Immunology, Immunotherapy",
    values: [{ field: "sciif", value: "5.8", source: "dataset" }],
    updated: 1,
    jcr: {
      year: 2025,
      impactFactor: 5.8,
      source: "dataset",
      provider: "showjcr",
      percentileMethod: "rank",
      categories: [
        {
          name: "IMMUNOLOGY",
          rank: "40/183",
          quartile: "Q1",
          percentile: 78.4153,
        },
        { name: "ONCOLOGY", rank: "67/333", quartile: "Q1", percentile: 80.03 },
      ],
    },
    ...overrides,
  };
}

test("JCR defaults closed with a year/count summary and compact labelled metric columns", () => {
  const { nodes, render } = setup();
  const panel = render(record());
  assert.equal(panel.tag, "details");
  assert.equal(panel.open, false);
  assert.equal(panel.children[0].tag, "summary");
  assert.equal(panel.children[0].textContent, "info-jcr-heading: 2025 | 2");
  assert.equal(panel.children.length, 2);
  const subjects = panel.children[1].children;
  assert.equal(subjects.length, 2);
  assert.equal(subjects[0].children[0].textContent, "IMMUNOLOGY");
  const [rank, percentile] = subjects[0].children[1].children;
  assert.equal(subjects[0].children[1].tag, "dl");
  assert.equal(rank.children[0].tag, "dt");
  assert.equal(rank.children[0].textContent, "info-jcr-rank");
  assert.equal(rank.children[1].tag, "dd");
  assert.equal(rank.children[1].textContent, "40 / 183");
  assert.equal(rank.children[1].children[0].className, "zest-info-jcr-total");
  assert.equal(percentile.children[0].textContent, "info-jcr-percentile");
  assert.equal(percentile.children[1].textContent, "78.4");
  assert.equal(
    subjects[1].children[1].children[0].children[1].textContent,
    "67 / 333",
  );
  assert.equal(
    subjects[1].children[1].children[1].children[1].textContent,
    "80",
  );
  assert.equal(panel.textContent.includes("Q1"), false);
  assert.equal(panel.textContent.includes("5.8"), false);
  assert.equal(panel.textContent.includes("ShowJCR"), false);
  assert.equal(panel.textContent.includes("derived"), false);
  assert.ok(nodes.every((node) => !node.title));
  assert.ok(
    nodes.every((node) =>
      [
        "details",
        "summary",
        "div",
        "ul",
        "li",
        "dl",
        "dt",
        "dd",
        "span",
      ].includes(node.tag),
    ),
  );
});

test("an exact IF without valid JCR gets an inline explanation without a graph", () => {
  const { nodes, render } = setup();
  const panel = render(record({ jcr: undefined }));
  assert.equal(panel.tag, "div");
  assert.equal(
    panel.children[0].textContent,
    "if-cell-tip: sciif | 5.8 | info-jcr-dataset",
  );
  assert.equal(panel.children[1].textContent, "if-percentile-missing");
  assert.equal(nodes.length, 3);
});

test("no usable IF does not add a JCR placeholder to books or rank-only records", () => {
  const { nodes, render } = setup();
  assert.equal(render(undefined), undefined);
  assert.equal(render(record({ values: [] })), undefined);
  assert.equal(
    render(
      record({ values: [{ field: "sci", value: "Q1", source: "dataset" }] }),
    ),
    undefined,
  );
  assert.equal(
    render(
      record({
        values: [{ field: "sciif", value: "<0.1", source: "dataset" }],
      }),
    ),
    undefined,
  );
  assert.equal(nodes.length, 0);
});

test("JCR metadata from another IF value or provider is never displayed", () => {
  const { render } = setup();
  for (const value of [
    { field: "sciif", value: "6.1", source: "dataset" },
    { field: "sciif", value: "5.8", source: "easyscholar" },
  ]) {
    assert.equal(
      render(record({ values: [value] })).children[1].textContent,
      "if-percentile-missing",
    );
  }
});

test("a non-JIF preferred metric cannot borrow the standard JIF percentile", () => {
  const { render } = setup();
  const rec = record();
  rec.values.push({ field: "oa2yr", value: "9.1", source: "openalex" });
  const panel = render(rec, "oa2yr");
  assert.equal(
    panel.children[0].textContent,
    "if-cell-tip: oa2yr | 9.1 | OpenAlex",
  );
  assert.equal(panel.children[1].textContent, "if-percentile-not-applicable");
});

test("direct percentiles keep their year, unknown rank and valid zero percentile", () => {
  const { render } = setup();
  for (const source of ["dataset", "easyscholar"]) {
    const rec = record({
      values: [{ field: "sciif", value: "0", source }],
      jcr: {
        year: 2024,
        impactFactor: 0,
        source,
        categories: [{ name: "TEST", percentile: 0 }],
      },
    });
    const panel = render(rec);
    assert.equal(panel.children[0].textContent, "info-jcr-heading: 2024 | 1");
    assert.equal(panel.children.length, 2);
    assert.equal(
      panel.children[1].children[0].children[1].children[0].children[1]
        .textContent,
      "—",
    );
    assert.equal(
      panel.children[1].children[0].children[1].children[1].children[1]
        .textContent,
      "0",
    );
  }
});

test("category names are literal text, never injected HTML", () => {
  const { nodes, render } = setup();
  const rec = record();
  rec.jcr.categories[0].name = '<img src=x onerror="fail()">';
  const panel = render(rec);
  assert.equal(
    panel.children[1].children[0].children[0].textContent,
    '<img src=x onerror="fail()">',
  );
  assert.ok(nodes.every((node) => node.innerHTML === undefined));
});
