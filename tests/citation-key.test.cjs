const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness } = require("./helpers.cjs");
const { citationKeyOf } = createHarness().load("src/utils/citationKey.ts");

function itemWith({
  citationKey = "",
  extra = "",
  nativeUnavailable = false,
} = {}) {
  const reads = [];
  const item = {
    id: 42,
    libraryID: 1,
    key: "INTERNAL123",
    getField(field) {
      reads.push(field);
      if (field === "citationKey") {
        if (nativeUnavailable) throw new Error("Invalid field citationKey");
        return citationKey;
      }
      if (field === "extra") return extra;
      assert.fail(`Unexpected field read: ${field}`);
    },
    setField() {
      assert.fail("Reading a citation key must not write an item field");
    },
    saveTx() {
      assert.fail("Reading a citation key must not save the item");
    },
  };
  return { item, reads };
}

test("native citation keys take precedence without even reading legacy Extra", () => {
  const { item, reads } = itemWith({
    citationKey: "  Wang2025NSCLC  ",
    extra: "Citation Key: Outdated2020",
  });
  assert.equal(citationKeyOf(item), "Wang2025NSCLC");
  assert.deepEqual(reads, ["citationKey"]);
});

test("legacy Citation Key is read when the native field is absent, blank or unavailable", () => {
  for (const native of ["", " \t ", false, null, undefined]) {
    const { item } = itemWith({
      citationKey: native,
      extra:
        "Personal note\r\n  cItAtIoN kEy :  Li2024_NSCLC  \r\nRating: 4\r\n",
    });
    assert.equal(citationKeyOf(item), "Li2024_NSCLC");
  }
  const { item, reads } = itemWith({
    nativeUnavailable: true,
    extra: "Citation Key: Legacy2023",
  });
  assert.equal(citationKeyOf(item), "Legacy2023");
  assert.deepEqual(reads, ["citationKey", "extra"]);
});

test("an internal item key and unrelated Extra keys never become writing keys", () => {
  for (const extra of [
    "",
    "Citation Key:   ",
    "Citation: Other2020\nKey: WRONG\nZotero Key: INTERNAL123",
    "My Citation Key: Custom2024\nCitation Key Note: Another2025",
  ]) {
    assert.equal(citationKeyOf(itemWith({ extra }).item), "");
  }
});

test("unavailable item getters yield an empty key without throwing or falling back to item.key", () => {
  for (const item of [
    { key: "INTERNAL123" },
    {
      key: "INTERNAL123",
      getField() {
        throw new Error("Item unavailable");
      },
    },
  ]) {
    assert.equal(citationKeyOf(item), "");
  }
});

test("citation keys retain their exact non-whitespace content as data", () => {
  const key = 'Wang2025_中文-NSCLC:<img src=x onerror="bad()">';
  assert.equal(citationKeyOf(itemWith({ citationKey: key }).item), key);
  assert.equal(
    citationKeyOf(itemWith({ extra: `Citation Key: ${key}` }).item),
    key,
  );
});

function withBBT(provider) {
  return createHarness({
    globals: { Zotero: { BetterBibTeX: provider } },
  }).load("src/utils/citationKey.ts").citationKeyOf;
}

test("BBT's supported get(itemID) reads existing cache keys with its receiver intact", () => {
  const calls = [];
  const manager = {
    records: new Map([
      [
        42,
        {
          itemID: 42,
          libraryID: 1,
          itemKey: "INTERNAL123",
          citationKey: "  Cached2025  ",
        },
      ],
    ]),
    get(id) {
      calls.push(id);
      return this.records.get(id);
    },
    fill() {
      calls.push("fill");
    },
    update() {
      calls.push("update");
    },
  };
  const read = withBBT({ KeyManager: manager });
  assert.equal(read(itemWith().item), "Cached2025");
  assert.deepEqual(calls, [42]);
});

test("native values and explicit legacy Extra keys precede BBT's cache without calling it", () => {
  const calls = [];
  const read = withBBT({
    KeyManager: {
      get(id) {
        calls.push(id);
        return { citationKey: "Cached2025" };
      },
    },
  });
  assert.equal(
    read(
      itemWith({ citationKey: "Native2026", extra: "Citation Key: Legacy2024" })
        .item,
    ),
    "Native2026",
  );
  assert.equal(
    read(itemWith({ extra: "Citation Key: Legacy2024" }).item),
    "Legacy2024",
  );
  assert.deepEqual(calls, []);
});

test("BBT absence, startup, shutdown and malformed cache records remain harmless empty states", () => {
  for (const provider of [
    undefined,
    null,
    {},
    { KeyManager: {} },
    {
      KeyManager: {
        get() {
          throw new Error("Cache unavailable");
        },
      },
    },
    ...[
      null,
      undefined,
      false,
      "Internal2024",
      { retry: true, citationKey: "" },
      { citationKey: 123 },
    ].map((record) => ({ KeyManager: { get: () => record } })),
  ]) {
    assert.equal(withBBT(provider)(itemWith().item), "");
  }
});

test("BBT records with mismatched item or library identity never leak another item's key", () => {
  for (const mismatch of [
    { itemID: 99 },
    { libraryID: 2 },
    { itemKey: "OTHER123" },
  ]) {
    const read = withBBT({
      KeyManager: { get: () => ({ citationKey: "Wrong2025", ...mismatch }) },
    });
    assert.equal(read(itemWith().item), "");
  }
});

test("BBT queries require a saved numeric item ID and do not use Zotero's internal item key", () => {
  const calls = [];
  const read = withBBT({
    KeyManager: {
      get(id) {
        calls.push(id);
        return { citationKey: "Cache2025" };
      },
    },
  });
  for (const id of [undefined, null, 0, -1, 1.5, "42"]) {
    assert.equal(read({ ...itemWith().item, id }), "");
  }
  assert.deepEqual(calls, []);
});

test("a ready BBT cache is read on the next request without generating or retaining a stale key", () => {
  let record = { citationKey: "", retry: true };
  const read = withBBT({ KeyManager: { get: () => record } });
  const { item } = itemWith({ nativeUnavailable: true });
  assert.equal(read(item), "");
  record = { citationKey: "Ready2026" };
  assert.equal(read(item), "Ready2026");
  record = undefined;
  assert.equal(read(item), "");
});

test("unsupported async BBT lookups cannot return late keys or unhandled rejections", async () => {
  for (const get of [
    () => Promise.resolve({ citationKey: "Late2025" }),
    () => Promise.reject(new Error("Unavailable")),
  ]) {
    const read = withBBT({ KeyManager: { get } });
    assert.equal(read(itemWith().item), "");
    await Promise.resolve();
  }
});
