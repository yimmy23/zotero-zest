const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers.cjs");

const creator = (family, given) => ({ family, given });
const row = (n, i = "A1", extra = {}) => ({ i, n, ...extra });
const ids = (matches) => Array.from(matches, (value) => value?.i);

function fixture() {
  const entries = new Map(),
    items = new Map(),
    logs = [];
  let creatorReads = 0,
    cacheReads = 0;
  const unexpected = () => {
    throw Error("author identity must stay local and read-only");
  };
  const h = createHarness({
    globals: {
      fetch: unexpected,
      ztoolkit: { log: (...args) => logs.push(args) },
      Zotero: {
        HTTP: { request: unexpected },
        Promise: { delay: async () => {} },
        Items: {
          getByLibraryAndKey: (library, key) => items.get(`${library}/${key}`),
        },
      },
    },
    mocks: {
      "src/core/storage.ts": {
        cache: {
          get(ns, key, sanitize) {
            cacheReads++;
            const data = sanitize(entries.get(`${ns}/${key}`));
            return data ? { data, age: 0 } : undefined;
          },
          set: unexpected,
          remove: unexpected,
        },
      },
    },
  });
  const api = h.load("src/graph/authorIdentity.ts");
  const core = h.load("src/panes/coreAuthors.ts");
  return {
    api,
    core,
    logs,
    creatorReads: () => creatorReads,
    cacheReads: () => cacheReads,
    item(names, rows = [], id = items.size + 1) {
      const item = {
        id,
        libraryID: 1,
        key: `ITEM${id}`,
        getCreators() {
          creatorReads++;
          return names.map(({ family, given }) => ({
            lastName: family,
            firstName: given,
          }));
        },
        getField: () => "",
      };
      items.set(`1/${item.key}`, item);
      entries.set(`oaAuthors/1/${item.key}`, rows);
      return item;
    },
  };
}

test("same surname and equal-list positions cannot attach another person's cached author ID", () => {
  for (const local of [creator("Smith", "Alice"), creator("Jones", "Robert")]) {
    const h = fixture(),
      rows = [row("John Smith")];
    const item = h.item([local], rows);
    assert.deepEqual(ids(h.api.matchAuthorships([local], rows)), [undefined]);
    assert.equal(h.api.findCachedAuthor(item, local.family, local.given), null);
    const resolver = h.api.buildAuthorResolver([item]);
    const category = resolver.categoriesFor(item)[0];
    assert.ok(category);
    assert.equal(category.authorRef.oaId, undefined);
    assert.notEqual(category.id, "a:oa:A1");
    assert.equal(category.hint, undefined);
    assert.deepEqual(h.logs, []);
  }
});

test("every supplied middle-name token must agree, while a unique omitted middle name remains compatible", () => {
  const { api } = fixture();
  const local = [creator("Smith", "John Robert")];
  assert.deepEqual(
    ids(api.matchAuthorships(local, [row("John Richard Smith")])),
    [undefined],
  );
  for (const name of ["J. R. Smith", "John R Smith", "John Smith"]) {
    assert.deepEqual(
      ids(api.matchAuthorships(local, [row(name)])),
      ["A1"],
      name,
    );
  }
  assert.deepEqual(
    ids(
      api.matchAuthorships(
        [creator("Smith", "John")],
        [row("John Robert Smith", "A1"), row("John Richard Smith", "A2")],
      ),
    ),
    [undefined],
  );
});

test("Chinese, diacritic, hyphenated and family-first names keep their unambiguous cached identities", () => {
  for (const [local, display] of [
    [creator("Müller", "Jean-Pierre"), "Muller, Jean Pierre"],
    [creator("Wang", "Xiao-Ming"), "Xiaoming Wang"],
    [creator("Smith", "J. R."), "John Robert Smith"],
    [creator("van der Waals", "Johannes"), "Johannes van der Waals"],
    [creator("王", "明"), "王明"],
    [creator("王明", ""), "王明"],
  ]) {
    const h = fixture(),
      item = h.item([local], [row(display)]);
    assert.deepEqual(
      ids(h.api.matchAuthorships([local], [row(display)])),
      ["A1"],
      display,
    );
    assert.equal(
      h.api.findCachedAuthor(item, local.family, local.given)?.i,
      "A1",
      display,
    );
    assert.equal(
      h.api.buildAuthorResolver([item]).categoriesFor(item)[0].id,
      "a:oa:A1",
      display,
    );
  }
});

test("surname substrings and romanisation subsequences are not identity evidence", () => {
  for (const [local, display] of [
    [creator("Muller", "John"), "John Mueller"],
    [creator("Wang", "Ming"), "Ming Wangh"],
    [creator("Jones", "Robert"), "Robert Jones-Smith"],
    [creator("Li", "Lei"), "Lei Liang"],
    [creator("Smith", ""), "John Smith"],
  ]) {
    const h = fixture(),
      item = h.item([local], [row(display)]);
    assert.deepEqual(
      ids(h.api.matchAuthorships([local], [row(display)])),
      [undefined],
      display,
    );
    assert.equal(
      h.api.findCachedAuthor(item, local.family, local.given),
      null,
      display,
    );
  }
});

test("ambiguity is rejected in both local-creator and cached-authorship directions", () => {
  const { api } = fixture();
  for (const [creators, rows, expected] of [
    [
      [creator("Smith", "J")],
      [row("John Smith", "A1"), row("Jane Smith", "A2")],
      [undefined],
    ],
    [
      [creator("Smith", "John Paul"), creator("Smith", "John Peter")],
      [row("John Smith")],
      [undefined, undefined],
    ],
    [
      [creator("Smith", "John"), creator("Smith", "John")],
      [row("John Smith")],
      [undefined, undefined],
    ],
    [
      [creator("Smith", "John")],
      [row("John Smith", "A1"), row("John Smith", "A2")],
      [undefined],
    ],
    [
      [creator("Smith", "J"), creator("Smith", "Jane")],
      [row("J Smith")],
      [undefined, undefined],
    ],
    [
      [creator("Smith", "J"), creator("Smith", "John")],
      [row("John Smith")],
      [undefined, "A1"],
    ],
    [
      [creator("Smith", "John"), creator("Smith", "Jane")],
      [row("Jane Smith", "A2"), row("John Smith", "A1")],
      ["A1", "A2"],
    ],
  ]) {
    assert.deepEqual(ids(api.matchAuthorships(creators, rows)), expected);
    assert.deepEqual(
      ids(
        api.matchAuthorships([...creators].reverse(), [...rows].reverse()),
      ).reverse(),
      expected,
    );
  }
});

test("one provider ID cannot be bound to multiple local creators through duplicate cached aliases", () => {
  const h = fixture(),
    local = [creator("Smith", "Alice"), creator("Smith", "John")];
  const rows = [row("Alice Smith", "A1"), row("John Smith", "A1")];
  const item = h.item(local, rows);
  assert.deepEqual(ids(h.api.matchAuthorships(local, rows)), [
    undefined,
    undefined,
  ]);
  for (const name of local)
    assert.equal(h.api.findCachedAuthor(item, name.family, name.given), null);
  assert.ok(
    h.api
      .buildAuthorResolver([item])
      .categoriesFor(item)
      .every((category) => !category.authorRef.oaId),
  );
});

test("cached-author lookup respects the whole creator list rather than rematching one clicked name", () => {
  const h = fixture();
  const item = h.item(
    [creator("Smith", "J"), creator("Smith", "Jane")],
    [row("J Smith")],
  );
  assert.equal(h.api.findCachedAuthor(item, "Smith", "J"), null);
  assert.equal(h.api.findCachedAuthor(item, "Smith", "Jane"), null);
  const duplicate = h.item(
    [creator("Smith", "John"), creator("Smith", "John")],
    [row("John Smith")],
  );
  assert.equal(h.api.findCachedAuthor(duplicate, "Smith", "John"), null);
  const unrelated = h.item([creator("Jones", "Robert")], [row("John Smith")]);
  assert.equal(h.api.findCachedAuthor(unrelated, "Smith", "John"), null);
  const full = h.item(
    [creator("Smith", "J"), creator("Smith", "John")],
    [row("John Smith")],
  );
  assert.equal(h.api.findCachedAuthor(full, "Smith", "J"), null);
  assert.equal(h.api.findCachedAuthor(full, "Smith", "John")?.i, "A1");
});

test("a wrong cached identity cannot merge local graph memberships with the real named author", () => {
  const h = fixture();
  const wrong = h.item(
    [creator("Smith", "Alice")],
    [row("John Smith", "A1", { a: "Wrong Institute" })],
  );
  const right = h.item(
    [creator("Smith", "John")],
    [row("John Smith", "A1", { a: "Right Institute" })],
  );
  const resolver = h.api.buildAuthorResolver([wrong, right]);
  assert.deepEqual(
    [...resolver.memberItemIDs({ family: "Smith", given: "John", oaId: "A1" })],
    [right.id],
  );
  assert.deepEqual(
    [...resolver.memberItemIDs({ family: "Smith", given: "Alice" })],
    [wrong.id],
  );
  assert.equal(resolver.categoriesFor(wrong)[0].hint, undefined);
  assert.equal(resolver.categoriesFor(right)[0].hint, "Right Institute");
});

test("graph collection reads each creator list and cache once, and sync and async resolvers agree", async () => {
  const h = fixture();
  const names = [
    creator("Smith", "John"),
    creator("Smith", "Jane"),
    creator("Jones", "Robert"),
  ];
  const rows = [
    row("Robert Jones", "A3"),
    row("Jane Smith", "A2"),
    row("John Smith", "A1"),
  ];
  const item = h.item(names, rows);
  const before = JSON.stringify([names, rows]);
  const resolver = h.api.buildAuthorResolver([item]);
  assert.equal(h.creatorReads(), 1);
  assert.equal(h.cacheReads(), 1);
  const sync = resolver.categoriesFor(item).map((category) => category.id);
  const asyncResolver = await h.api.buildAuthorResolverAsync([item], 1);
  assert.deepEqual(
    Array.from(asyncResolver.categoriesFor(item), (category) => category.id),
    Array.from(sync),
  );
  assert.deepEqual(Array.from(sync), ["a:oa:A1", "a:oa:A2", "a:oa:A3"]);
  assert.equal(JSON.stringify([names, rows]), before);
  assert.deepEqual(h.logs, []);
});

test("core author roles and graph identity use the same strict name matches", () => {
  const h = fixture(),
    local = [creator("Smith", "Alice"), creator("Smith", "John Robert")];
  const rows = [
    row("John Smith", "A1", { c: true }),
    row("John Richard Smith", "A2", { c: true }),
  ];
  const matched = h.api.matchAuthorships(local, rows);
  const core = h.core.selectCoreAuthors(local, rows);
  assert.deepEqual(
    Array.from(core.authors, (author) => author.row?.i),
    ids(matched),
  );
  assert.equal(core.authors[0].corresponding, false);
  assert.equal(core.authors[1].row?.i, "A1");
});

test("unreadable local creators cannot expose cached author identities", () => {
  const h = fixture(),
    item = h.item([creator("Smith", "John")], [row("John Smith")]);
  item.getCreators = () => {
    throw Error("unavailable creator list");
  };
  assert.equal(h.api.findCachedAuthor(item, "Smith", "John"), null);
  assert.deepEqual(
    Array.from(h.api.buildAuthorResolver([item]).categoriesFor(item)),
    [],
  );
  assert.deepEqual(h.logs, []);
});

test("known OpenAlex IDs override initials, conflicting names, and surname aliases globally", () => {
  const h = fixture();
  const a = h.item([creator("Smith", "J.")], [row("J Smith", "A1")]);
  const b = h.item([creator("Smith", "John")], [row("John Smith", "A2")]);
  const alias = h.item(
    [creator("Smyth", "John Robert")],
    [row("John Robert Smyth", "A1")],
  );
  const c = h.item(
    [creator("Smith", "J. R.")],
    [row("John Richard Smith", "A3")],
  );
  const resolver = h.api.buildAuthorResolver([a, b, alias, c]);
  for (const ref of [
    { family: "Smith", given: "J.", oaId: "A1" },
    { family: "Smith", given: "J. R.", oaId: "A1" },
    { family: "Smyth", given: "", oaId: "A1" },
    { family: "Different", given: "Anything", oaId: "A1" },
  ]) {
    assert.deepEqual([...resolver.memberItemIDs(ref)], [a.id, alias.id]);
    assert.equal(resolver.findCategory(ref).id, "a:oa:A1");
  }
  assert.deepEqual(
    [...resolver.memberItemIDs({ family: "Smith", given: "J.", oaId: "A404" })],
    [],
  );
  assert.equal(
    resolver.findCategory({ family: "Smith", given: "John", oaId: "A404" }),
    null,
  );
  assert.deepEqual(
    [...resolver.memberItemIDs({ family: "Smith", given: "J." })].sort(),
    [a.id, b.id, alias.id, c.id].sort(),
  );
});

test("token candidate indexing preserves middle-name, initial and joined-name ambiguity", async () => {
  const h = fixture();
  const names = [
    "John Robert",
    "John Richard",
    "John",
    "J. R.",
    "Xiao-Ming",
    "Xiaoming",
    "Lei",
    "Li",
    "L.",
    "",
    "J. Paul",
    "John Paul",
  ];
  const items = names.map((name) => h.item([creator("Wang", name)]));
  const sync = h.api.buildAuthorResolver(items);
  const asyncResolver = await h.api.buildAuthorResolverAsync(items, 1);
  const categories = items.map((item) => sync.categoriesFor(item)[0].id);
  assert.equal(categories[4], categories[5]);
  assert.equal(categories[10], categories[11]);
  assert.notEqual(categories[0], categories[1]);
  assert.notEqual(categories[2], categories[0]);
  assert.notEqual(categories[3], categories[0]);
  assert.notEqual(categories[6], categories[7]);
  assert.notEqual(categories[8], categories[6]);
  for (const item of items)
    assert.deepEqual(
      Array.from(asyncResolver.categoriesFor(item), (cat) => cat.id),
      Array.from(sync.categoriesFor(item), (cat) => cat.id),
    );
});
