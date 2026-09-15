const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers.cjs");
const ITEM = "READ0001";
const plain = (value) => JSON.parse(JSON.stringify(value));

function setup({ rows = [], files = {} } = {}) {
  const items = new Map();
  const merged = [];
  const add = (lib, key = ITEM, options = {}) => {
    const item = {
      id: items.size + 1,
      libraryID: lib,
      key,
      deleted: false,
      isRegularItem: () => true,
      ...options,
    };
    items.set(`${lib}/${key}`, item);
    return item;
  };
  const h = createHarness({
    mocks: {
      "src/reading/store.ts": {
        readingStore: {
          async mergeRecords(records, mode) {
            for (const record of records)
              merged.push({
                ...record,
                page: Object.fromEntries(record.page),
                mode,
              });
          },
        },
      },
      "src/utils/locale.ts": { getString: (key) => key },
    },
    globals: {
      Zotero: {
        DB: { queryAsync: async () => rows },
        Items: {
          getByLibraryAndKey: (lib, key) => items.get(`${lib}/${key}`) || false,
          get: (id) =>
            [...items.values()].find((item) => item.id === id) || false,
        },
        Libraries: {
          userLibraryID: 1,
          getAll: () => [1, 2, 3].map((libraryID) => ({ libraryID })),
        },
        Prefs: { get: () => undefined },
        DataDirectory: { dir: "/isolated-fixture" },
        File: { getContentsAsync: async (name) => JSON.stringify(files[name]) },
      },
      IOUtils: { exists: async (name) => Object.hasOwn(files, name) },
      PathUtils: { join: (...parts) => parts.join("/") },
    },
  });
  return { add, items, merged, ...h.load("src/reading/migrate.ts") };
}
const fileRecord = { readingTime: { page: 10, data: { 0: 60 } } };
const note = (libraryID = 1, key = ITEM) => ({
  libraryID,
  parentKey: "PARN0001",
  noteKey: "NOTE0001",
  note: `${key}\n${JSON.stringify(fileRecord)}`,
});

test("note records retain their source library instead of picking a matching foreign library", async () => {
  const { add, merged, scanLegacy, applyLegacy } = setup({ rows: [note()] });
  add(2);
  add(3);
  const { records, report } = await scanLegacy();
  assert.equal(report.unresolved, 1);
  assert.equal(report.ambiguous, 0);
  assert.equal(records[0].libraryID, 1);
  await applyLegacy(records, "max", report);
  assert.equal(
    merged[0].libraryID,
    1,
    "preserved for restoration in the source library",
  );
  assert.equal(merged[0].page[0], 60);
});

test("a known note identity wins even when its key also exists in other libraries", async () => {
  const { add, merged, scanLegacy, applyLegacy } = setup({ rows: [note(2)] });
  add(1);
  const original = add(2);
  add(3);
  const { records, report } = await scanLegacy();
  assert.equal(records[0].itemID, original.id);
  assert.equal(report.unresolved, 0);
  await applyLegacy(records, "max", report);
  assert.equal(merged[0].libraryID, 2);
});

test("deleted note targets stay with their source library and resolve when restored", async () => {
  const { add, merged, scanLegacy, applyLegacy } = setup({ rows: [note()] });
  const original = add(1, ITEM, { deleted: true });
  add(2);
  const scan = await scanLegacy();
  assert.equal(scan.report.unresolved, 1);
  assert.equal(scan.records[0].libraryID, 1);
  await applyLegacy(scan.records, "max", scan.report);
  assert.equal(merged[0].libraryID, 1);
  original.deleted = false;
  const restored = await scanLegacy();
  assert.equal(restored.report.unresolved, 0);
  assert.equal(restored.records[0].itemID, original.id);
});

test("file keys matching multiple libraries are skipped even when the user library matches", async () => {
  for (const libs of [
    [2, 3],
    [1, 2],
  ]) {
    const { add, merged, scanLegacy, applyLegacy } = setup({
      files: { "/legacy.json": { [ITEM]: fileRecord } },
    });
    for (const lib of libs) add(lib);
    const { records, report } = await scanLegacy(["/legacy.json"]);
    assert.equal(report.ambiguous, 1);
    assert.equal(report.unresolved, 1);
    assert.equal(
      records[0].libraryID,
      1,
      "a file placeholder never becomes an arbitrary match",
    );
    await applyLegacy(records, "max", report);
    assert.deepEqual(merged, []);
    assert.equal(report.skipped, 1);
    assert.equal(report.merged, 0);
    assert.ok(report.details.some((text) => /ambiguous.*READ0001/.test(text)));
  }
});

test("unique file keys can remap, missing files remain in the untouched source", async () => {
  const files = {
    "/legacy.json": { [ITEM]: fileRecord, MISS0001: fileRecord },
  };
  const before = plain(files);
  const { add, merged, scanLegacy, applyLegacy } = setup({ files });
  add(3);
  const { records, report } = await scanLegacy(["/legacy.json"]);
  assert.equal(records.find((r) => r.itemKey === ITEM).libraryID, 3);
  assert.equal(report.unresolved, 1);
  await applyLegacy(records, "max", report);
  assert.equal(report.merged, 1);
  assert.equal(report.skipped, 1);
  assert.equal(merged[0].libraryID, 3);
  assert.deepEqual(files, before);
});

test("G1 file payloads keep file identity rules rather than masquerading as notes", async () => {
  const { add, merged, scanLegacy, applyLegacy } = setup({
    files: {
      "/legacy.json": {
        [ITEM]: { pageTime: { 0: 60 }, pageNum: 10, itemKey: ITEM },
      },
    },
  });
  add(1);
  add(2);
  const { records, report } = await scanLegacy(["/legacy.json"]);
  assert.equal(records[0].source.kind, "file");
  assert.equal(report.ambiguous, 1);
  await applyLegacy(records, "max", report);
  assert.deepEqual(merged, []);
});

test("numeric local IDs retain their explicit source identity and confirmation flag", async () => {
  const files = { "/legacy.json": { 1: fileRecord } };
  const { add, merged, scanLegacy, applyLegacy } = setup({ files });
  const original = add(2);
  add(3);
  const { records, report } = await scanLegacy(["/legacy.json"]);
  assert.equal(records[0].viaItemID, true);
  assert.equal(records[0].itemID, original.id);
  assert.equal(report.ambiguous, 0);
  await applyLegacy(records, "max", report);
  assert.equal(merged[0].libraryID, 2);
});

test("file identity is rechecked before merging if a collision appears after scan", async () => {
  const { add, merged, scanLegacy, applyLegacy } = setup({
    files: { "/legacy.json": { [ITEM]: fileRecord } },
  });
  add(2);
  const { records, report } = await scanLegacy(["/legacy.json"]);
  assert.equal(report.ambiguous, 0);
  add(3);
  await applyLegacy(records, "max", report);
  assert.deepEqual(merged, []);
  assert.equal(report.ambiguous, 1);
  assert.equal(report.skipped, 1);
});
