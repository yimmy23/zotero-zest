const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers.cjs");

const h = createHarness({ mocks: { "src/core/storage.ts": { cache: {} } } });
const { selectCoreAuthors } = h.load("src/panes/coreAuthors.ts");
const creators = [
  { family: "First", given: "Alice" },
  { family: "Middle", given: "Beatrice" },
  { family: "Last", given: "Charles" },
];
const row = (n, extra = {}) => ({ i: `A${n}`, n, v: 2, ...extra });
const visible = (result) => [...result.visibleAuthorIndices];
const plain = (value) => JSON.parse(JSON.stringify(value));
const institutionSummary = (result) =>
  plain(
    result.institutions.map(({ name, id, core }) => ({
      name,
      ...(id ? { id } : {}),
      core,
    })),
  );

test("core authors show first and verified corresponding authors, not last by position", () => {
  const result = selectCoreAuthors(creators, [
    row("Alice First", { p: "first", c: false }),
    row("Beatrice Middle", { p: "middle", c: true }),
    row("Charles Last", { p: "last", c: false }),
  ]);
  assert.deepEqual(visible(result), [0, 1]);
  assert.deepEqual(
    plain(
      result.authors.map(({ index, first, corresponding }) => ({
        index,
        first,
        corresponding,
      })),
    ),
    [
      { index: 0, first: true, corresponding: false },
      { index: 1, first: false, corresponding: true },
      { index: 2, first: false, corresponding: false },
    ],
  );
  assert.equal(result.needsDetails, false);
  assert.equal(
    result.authors.some((author) => author.last),
    false,
  );
});

test("multiple corresponding authors retain original creator order and first does not duplicate", () => {
  const result = selectCoreAuthors(creators, [
    row("Charles Last", { c: true }),
    row("Alice First", { c: true }),
    row("Beatrice Middle", { c: true }),
  ]);
  assert.deepEqual(visible(result), [0, 1, 2]);
  assert.equal(result.authors.length, 3);
});

test("unknown correspondence shows positional first and last without inventing correspondence or endless upgrades", () => {
  const unknown = selectCoreAuthors(creators, null);
  assert.deepEqual(visible(unknown), [0, 2]);
  assert.deepEqual(
    plain(
      unknown.authors.map(({ first, corresponding, last }) => ({
        first,
        corresponding,
        last,
      })),
    ),
    [
      { first: true, corresponding: false, last: false },
      { first: false, corresponding: false, last: false },
      { first: false, corresponding: false, last: true },
    ],
  );
  assert.equal(selectCoreAuthors(creators, null).needsDetails, true);
  const old = [{ i: "A1", n: "Charles Last", a: "Example Institute" }];
  assert.deepEqual(visible(selectCoreAuthors(creators, old)), [0, 2]);
  assert.equal(selectCoreAuthors(creators, old).needsDetails, true);
  const current = creators.map((c) => row(`${c.given} ${c.family}`));
  assert.equal(selectCoreAuthors(creators, current).needsDetails, false);
  assert.deepEqual(visible(selectCoreAuthors([], current)), []);
});

test("same-surname different given names and author-position matches cannot assign correspondence", () => {
  const result = selectCoreAuthors(
    [
      { family: "Smith", given: "Alice" },
      { family: "Smith", given: "John Robert" },
    ],
    [row("Alice Smith"), row("James Richard Smith", { p: "last", c: true })],
  );
  assert.deepEqual(visible(result), [0, 1]);
  assert.equal(result.authors[1].corresponding, false);
  assert.equal(result.authors[1].row, undefined);
});

test("all given tokens must agree; a shared first initial does not match another middle name", () => {
  const local = [
    { family: "First", given: "Alice" },
    { family: "Smith", given: "John Richard" },
  ];
  const result = selectCoreAuthors(local, [
    row("Alice First"),
    row("John Robert Smith", { c: true }),
  ]);
  assert.deepEqual(visible(result), [0, 1]);
  assert.equal(result.authors[1].corresponding, false);
  assert.deepEqual(
    visible(selectCoreAuthors(local, [row("J R Smith", { c: true })])),
    [0, 1],
  );
  assert.deepEqual(
    visible(selectCoreAuthors(local, [row("John Smith", { c: true })])),
    [0, 1],
  );
});

test("unique omitted-middle-name matches retain Heather Wakelee's own first-author institutions", () => {
  const result = selectCoreAuthors(
    [{ family: "Wakelee", given: "Heather" }, creators[1]],
    [
      row("Heather A. Wakelee", {
        p: "first",
        c: true,
        af: [{ i: "I1", n: "Stanford University" }],
      }),
      row("Beatrice Middle", { af: [{ i: "I2", n: "Other Institute" }] }),
    ],
  );
  assert.equal(result.authors[0].row.n, "Heather A. Wakelee");
  assert.equal(result.authors[0].corresponding, true);
  assert.deepEqual(institutionSummary(result), [
    { id: "I1", name: "Stanford University", core: true },
    { id: "I2", name: "Other Institute", core: false },
  ]);
});

test("omitted middle names remain ambiguous when multiple compatible people exist", () => {
  const result = selectCoreAuthors(
    [creators[0], { family: "Wakelee", given: "Heather" }],
    [row("Heather A. Wakelee", { c: true }), row("Heather B. Wakelee")],
  );
  assert.equal(result.authors[1].row, undefined);
  assert.deepEqual(visible(result), [0, 1]);
  assert.equal(result.authors[1].corresponding, false);
  const shared = selectCoreAuthors(
    [
      creators[0],
      { family: "Smith", given: "John Paul" },
      { family: "Smith", given: "John Peter" },
    ],
    [row("John Smith", { c: true })],
  );
  assert.deepEqual(visible(shared), [0, 2]);
  assert.equal(shared.authors[2].corresponding, false);
  assert.equal(shared.authors[1].row, undefined);
  assert.equal(shared.authors[2].row, undefined);
});

test("ambiguous initials, duplicate provider names and duplicate local names are rejected", () => {
  const local = [creators[0], { family: "Smith", given: "J" }];
  const rows = [
    row("John Smith", { c: true }),
    row("Jane Smith", { c: false }),
  ];
  const ambiguous = selectCoreAuthors(local, rows);
  assert.deepEqual(visible(ambiguous), [0, 1]);
  assert.equal(ambiguous.authors[1].corresponding, false);
  const duplicates = [
    row("John Smith", { i: "A1", c: true }),
    row("John Smith", { i: "A2" }),
  ];
  assert.deepEqual(
    visible(
      selectCoreAuthors(
        [creators[0], { family: "Smith", given: "John" }],
        duplicates,
      ),
    ),
    [0, 1],
  );
  assert.deepEqual(
    visible(
      selectCoreAuthors(
        [creators[0], ...local.slice(1), ...local.slice(1)],
        [row("John Smith", { c: true })],
      ),
    ),
    [0, 2],
  );
});

test("exact full names take precedence over incomplete initials elsewhere in the list", () => {
  const local = [
    creators[0],
    { family: "Smith", given: "J" },
    { family: "Smith", given: "John" },
  ];
  const result = selectCoreAuthors(local, [row("John Smith", { c: true })]);
  assert.deepEqual(visible(result), [0, 2]);
  assert.equal(result.authors[1].row, undefined);
});

test("exact initials-only spelling does not defeat another compatible full-name creator", () => {
  const result = selectCoreAuthors(
    [
      creators[0],
      { family: "Smith", given: "J" },
      { family: "Smith", given: "Jane" },
    ],
    [row("J Smith", { c: true })],
  );
  assert.deepEqual(visible(result), [0, 2]);
  assert.equal(result.authors[2].corresponding, false);
  assert.equal(result.authors[1].row, undefined);
  assert.equal(result.authors[2].row, undefined);
});

test("diacritics, hyphenated names, family-first names and exact CJK single fields are supported", () => {
  for (const [creator, name] of [
    [{ family: "Müller", given: "Jean-Pierre" }, "Muller, Jean Pierre"],
    [{ family: "van der Waals", given: "Johannes" }, "Johannes van der Waals"],
    [{ family: "王", given: "明" }, "王明"],
    [{ family: "王明", given: "" }, "王明"],
  ]) {
    const result = selectCoreAuthors(
      [creators[0], creator],
      [row(name, { c: true })],
    );
    assert.deepEqual(visible(result), [0, 1], name);
  }
});

test("core institutions retain complete names and all affiliations, deduplicating IDs and names", () => {
  const long = "University Hospital and Research Institute ".repeat(7).trim();
  const result = selectCoreAuthors(creators, [
    row("Alice First", {
      af: [
        { i: "I1", n: long },
        { i: "I2", n: "Shared Institute" },
      ],
      a: "truncated",
    }),
    row("Beatrice Middle", { af: [{ i: "I4", n: "Secondary Institute" }] }),
    row("Charles Last", {
      c: true,
      af: [
        { i: "I2", n: "Shared Institution renamed" },
        { n: " shared   institute " },
        { i: "I3", n: "Corresponding Institute" },
      ],
    }),
  ]);
  assert.deepEqual(institutionSummary(result), [
    { id: "I1", name: long, core: true },
    { id: "I3", name: "Corresponding Institute", core: true },
    { id: "I2", name: "Shared Institute", core: true },
    { id: "I4", name: "Secondary Institute", core: false },
  ]);
});

test("institution previews prefer author-specific first/corresponding affiliations and cap at three", () => {
  const shared = { i: "I0", n: "Multicentre Consortium Institute" };
  const result = selectCoreAuthors(
    [...creators, { family: "Other", given: "David" }],
    [
      row("Alice First", {
        af: [
          shared,
          { i: "I1", n: "First Author Institute" },
          { i: "I2", n: "First Author Secondary Institute" },
        ],
      }),
      row("Beatrice Middle", {
        af: [shared, { i: "I5", n: "Unrelated Personal Institute" }],
      }),
      row("Charles Last", {
        c: true,
        af: [
          shared,
          { i: "I3", n: "Corresponding Institute" },
          { i: "I4", n: "Corresponding Secondary Institute" },
        ],
      }),
      row("David Other", {
        af: [shared, { i: "I2", n: "First Author Secondary Institute" }],
      }),
    ],
  );
  assert.deepEqual(institutionSummary(result), [
    { id: "I1", name: "First Author Institute", core: true },
    { id: "I3", name: "Corresponding Institute", core: true },
    { id: "I4", name: "Corresponding Secondary Institute", core: true },
    { id: "I2", name: "First Author Secondary Institute", core: false },
    { id: "I0", name: "Multicentre Consortium Institute", core: false },
    { id: "I5", name: "Unrelated Personal Institute", core: false },
  ]);
  assert.equal(
    result.institutions.length,
    6,
    "folding preserves every unique institution",
  );
});

test("legacy and unmatched institutions remain expandable with at most two fallback core entries", () => {
  const rows = [
    { i: "A1", n: "Unknown Person", a: "One Institute" },
    { i: "A2", n: "Other Person", a: "Two Institute" },
    { i: "A3", n: "Third Person", a: "Three Institute" },
    { i: "A4", n: "Fourth Person", a: "one institute" },
  ];
  const result = selectCoreAuthors(creators, rows);
  assert.deepEqual(institutionSummary(result), [
    { name: "One Institute", core: true },
    { name: "Two Institute", core: true },
    { name: "Three Institute", core: false },
  ]);
  assert.deepEqual(visible(result), [0, 2]);
  for (const institution of result.institutions) {
    assert.equal(institution.first, false);
    assert.equal(institution.corresponding, false);
    assert.equal(institution.last, false);
    assert.deepEqual(plain(institution.authors), []);
  }
});

test("a sole author gets no redundant positional last label", () => {
  for (const rows of [null, [row("Alice First", { c: true })]]) {
    const result = selectCoreAuthors([creators[0]], rows);
    assert.deepEqual(visible(result), [0]);
    assert.equal(result.authors[0].first, true);
    assert.equal(result.authors[0].last, false);
    assert.equal(result.authors[0].corresponding, !!rows);
  }
  assert.deepEqual(visible(selectCoreAuthors([], null)), []);
});

test("a uniquely matched explicit first author overrides local order", () => {
  const result = selectCoreAuthors(creators, [
    row("Alice First", { c: true }),
    row("Beatrice Middle", { p: "first" }),
    row("Charles Last", { p: "last" }),
  ]);
  assert.deepEqual(visible(result), [0, 1]);
  assert.equal(result.authors[0].first, false);
  assert.equal(result.authors[0].corresponding, true);
  assert.equal(result.authors[1].first, true);
  assert.equal(result.authors[2].last, false);
  const noCorresponding = selectCoreAuthors(creators, [
    row("Beatrice Middle", { p: "first" }),
  ]);
  assert.deepEqual(visible(noCorresponding), [1, 2]);
  assert.equal(noCorresponding.authors[2].last, true);
});

test("ambiguous or unmatched explicit first positions retain positional first fallback", () => {
  for (const rows of [
    [
      row("Beatrice Middle", { p: "first" }),
      row("Charles Last", { p: "first" }),
    ],
    [row("Unmatched Person", { p: "first" })],
  ]) {
    const result = selectCoreAuthors(creators, rows);
    assert.deepEqual(visible(result), [0, 2]);
    assert.equal(result.authors[0].first, true);
    assert.equal(result.authors[1].first, false);
  }
});

test("shared institutions merge first and corresponding roles and matched author names", () => {
  const result = selectCoreAuthors(creators, [
    row("Alice First", {
      p: "first",
      af: [{ i: "I1", n: "Shared Institute" }],
    }),
    row("Beatrice Middle", {
      c: true,
      af: [
        { i: "I1", n: "Shared Institute renamed" },
        { n: "shared institute" },
      ],
    }),
    row("Charles Last", { af: [{ i: "I1", n: "Shared Institute" }] }),
  ]);
  assert.deepEqual(plain(result.institutions), [
    {
      id: "I1",
      name: "Shared Institute",
      core: true,
      first: true,
      corresponding: true,
      last: false,
      authors: ["Alice First", "Beatrice Middle"],
    },
  ]);
});

test("matched positional-last affiliations carry last but never corresponding evidence", () => {
  const result = selectCoreAuthors(creators, [
    row("Alice First", { af: [{ i: "I1", n: "First Institute" }] }),
    row("Beatrice Middle", { af: [{ i: "I2", n: "Middle Institute" }] }),
    row("Charles Last", { af: [{ i: "I3", n: "Last Institute" }] }),
  ]);
  const last = result.institutions.find(
    (institution) => institution.id === "I3",
  );
  assert.equal(last.core, true);
  assert.equal(last.last, true);
  assert.equal(last.corresponding, false);
  assert.equal(last.first, false);
  assert.deepEqual(plain(last.authors), ["Charles Last"]);
  const middle = result.institutions.find(
    (institution) => institution.id === "I2",
  );
  assert.equal(middle.core, false);
  assert.equal(middle.last, false);
  assert.deepEqual(plain(middle.authors), []);
});

test("preview fairness reserves a corresponding or last affiliation without changing specificity order", () => {
  for (const corresponding of [true, false]) {
    const specific = [1, 2, 3, 4].map((i) => ({
      i: `I${i}`,
      n: `First Institute ${i}`,
    }));
    const shared = { i: "I5", n: "Other Key Author Institute" };
    const result = selectCoreAuthors(creators, [
      row("Alice First", { af: specific }),
      row("Beatrice Middle", { af: [shared] }),
      row("Charles Last", { c: corresponding, af: [shared] }),
    ]);
    assert.deepEqual(
      plain(result.institutions.map((institution) => institution.id)),
      ["I1", "I2", "I3", "I4", "I5"],
    );
    assert.deepEqual(
      plain(
        result.institutions
          .filter((institution) => institution.core)
          .map((institution) => institution.id),
      ),
      ["I1", "I2", "I5"],
    );
    const other = result.institutions.at(-1);
    assert.equal(other.corresponding, corresponding);
    assert.equal(other.last, !corresponding);
    assert.deepEqual(plain(other.authors), ["Charles Last"]);
    for (const folded of result.institutions.filter(
      (institution) => !institution.core,
    )) {
      assert.equal(folded.first, true, "folding does not erase role evidence");
      assert.deepEqual(plain(folded.authors), ["Alice First"]);
    }
  }
});

test("a shared institution satisfies both preview roles without consuming two slots", () => {
  const shared = { i: "I1", n: "Shared First and Corresponding Institute" };
  const result = selectCoreAuthors(creators, [
    row("Alice First", { af: [shared, { i: "I2", n: "First Extra" }] }),
    row("Beatrice Middle"),
    row("Charles Last", {
      c: true,
      af: [shared, { i: "I3", n: "Corresponding Extra" }],
    }),
  ]);
  assert.equal(
    result.institutions.filter((institution) => institution.core).length,
    3,
  );
  const entry = result.institutions.find(
    (institution) => institution.id === "I1",
  );
  assert.equal(entry.first, true);
  assert.equal(entry.corresponding, true);
  assert.equal(entry.last, false);
});

test("core selection keeps supplied creator and authorship data immutable", () => {
  const freeze = (value) => {
    if (value && typeof value === "object") {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  };
  const local = freeze(creators.map((creator) => ({ ...creator })));
  const rows = freeze([
    row("Alice First", { af: [{ i: "I1", n: "Institute" }] }),
    row("Charles Last", { c: true, af: [{ i: "I1", n: "Institute" }] }),
  ]);
  const before = JSON.stringify({ local, rows });
  const first = selectCoreAuthors(local, rows);
  const second = selectCoreAuthors(local, rows);
  assert.deepEqual(plain(first.institutions), plain(second.institutions));
  assert.equal(JSON.stringify({ local, rows }), before);
});
