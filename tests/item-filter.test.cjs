const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers.cjs");

function fixture() {
  class CollectionTreeRow {
    constructor(win, result) {
      this.view = { _ownerDocument: { defaultView: win } };
      this.result = result;
      this.calls = [];
    }
    async getItems(...args) {
      this.calls.push(args);
      if (this.error) throw this.error;
      return this.result;
    }
  }
  const api = createHarness({
    globals: { Zotero: { CollectionTreeRow } },
  }).load("src/views/itemFilter.ts");
  return { api, row: (win, result) => new CollectionTreeRow(win, result) };
}

const top = (id, extra = {}) => ({
  id,
  isTopLevelItem: () => true,
  ...extra,
});
const child = (id, owner, extra = {}) => ({
  id,
  isTopLevelItem: () => false,
  topLevelItem: owner,
  ...extra,
});

test("a child-only native hit is ANDed with filters on its absent top-level owner", async () => {
  const f = fixture(),
    win = {},
    owner = top(1),
    attachment = child(2, owner),
    annotation = child(3, owner),
    row = f.row(win, [annotation, attachment]);
  const seen = [];
  f.api.setItemFilter(win, "tags", (items) => {
    seen.push(...items);
    return [];
  });
  assert.deepEqual(await row.getItems(), []);
  assert.deepEqual(seen, [owner], "one predicate input per parent identity");
  f.api.setItemFilter(win, "tags", (items) => items);
  const output = await row.getItems();
  assert.deepEqual(output, [annotation, attachment]);
  assert.equal(output[0], annotation);
  assert.ok(!output.includes(owner), "no synthetic parent result");
  f.api.clearItemFilters();
});

test("mixed native rows retain order and duplicates while all predicates compose on owners", async () => {
  const f = fixture(),
    win = {},
    a = top(1),
    b = top(2),
    c = top(3),
    aChild = child(11, a),
    bChild = child(12, b),
    cChild = child(13, c),
    native = [cChild, aChild, b, a, bChild, aChild],
    row = f.row(win, native);
  f.api.setItemFilter(win, "tags", (items) => items.filter((i) => i.id !== 2));
  f.api.setItemFilter(win, "author", (items) =>
    items.filter((i) => i.id !== 3),
  );
  assert.deepEqual(await row.getItems(), [aChild, a, aChild]);
  assert.deepEqual(row.result, native);
  f.api.clearItemFilters();
});

test("Trash membership stays native for a deleted child with a live absent owner", async () => {
  const f = fixture(),
    win = {},
    live = top(1, { deleted: false }),
    deletedChild = child(2, live, { deleted: true }),
    deletedParent = top(3, { deleted: true }),
    row = f.row(win, [deletedChild, deletedParent]);
  f.api.setItemFilter(win, "tags", (items) => items.filter((i) => i.id === 1));
  assert.deepEqual(await row.getItems(), [deletedChild]);
  f.api.setItemFilter(win, "tags", () => []);
  assert.deepEqual(await row.getItems(), []);
  f.api.clearItemFilters();
});

test("child-only filters remain per window and raw/unowned host requests pass through", async () => {
  const f = fixture(),
    a = {},
    b = {},
    items = [child(2, top(1))],
    rowA = f.row(a, items),
    rowB = f.row(b, items),
    unknown = f.row(undefined, items);
  f.api.setItemFilter(a, "tags", () => []);
  f.api.setItemFilter(b, "author", (items) => items);
  assert.deepEqual(await rowA.getItems(), []);
  assert.deepEqual(await rowB.getItems(), items);
  assert.equal(await unknown.getItems(), items);
  const opts = { unfiltered: true };
  assert.equal(await rowA.getItems(opts, "extra"), items);
  assert.equal(rowA.calls.at(-1)[0], opts);
  assert.equal(rowA.calls.at(-1)[1], "extra");
  f.api.clearWindowFilters(a);
  assert.equal(await rowA.getItems(), items);
  assert.deepEqual(Array.from(f.api.activeItemFilters(b)), ["author"]);
  f.api.clearItemFilters();
});

test("unknown owners fail open, predicate errors fail open and native errors still propagate", async () => {
  const f = fixture(),
    win = {},
    broken = child(2, undefined),
    row = f.row(win, [broken, top(1)]);
  Object.defineProperty(broken, "topLevelItem", {
    get() {
      throw new Error("owner unavailable");
    },
  });
  f.api.setItemFilter(win, "tags", () => []);
  assert.deepEqual(await row.getItems(), [broken]);
  f.api.setItemFilter(win, "tags", () => {
    throw new Error("predicate failed");
  });
  assert.equal(await row.getItems(), row.result);
  row.error = new Error("native failed");
  await assert.rejects(row.getItems(), (error) => error === row.error);
  f.api.clearItemFilters();
});
