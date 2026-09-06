const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers.cjs");

const ITEM = "READ0001";
const ATT = "ATT00001";
const DAY = "2026-09-06";
const NOW = new Date(`${DAY}T12:00:00`).getTime();
const plain = (value) => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};

/** An atomic DB substitute with explicit failure and in-flight write gates. */
function database(seed = []) {
  const tables = {
    pages: new Map(),
    atts: new Map(),
    days: new Map(),
    meta: new Map(),
  };
  const key = (table, row) =>
    JSON.stringify([
      row.libraryID,
      row.itemKey,
      ...(table === "pages"
        ? [row.attKey, row.pageIndex]
        : table === "atts"
          ? [row.attKey]
          : table === "days"
            ? [row.day]
            : []),
    ]);
  const db = {
    loadCount: 0,
    writeCount: 0,
    deleteCount: 0,
    failLoads: 0,
    failWrites: 0,
    failDeletes: 0,
    beforeWrite: undefined,
    beforeDelete: undefined,
    active: 0,
    maxActive: 0,
    async loadAll() {
      this.loadCount++;
      if (this.failLoads-- > 0) throw new Error("database locked during load");
      return Object.fromEntries(
        Object.entries(tables).map(([name, rows]) => [
          name,
          [...rows.values()].map((r) => ({ ...r })),
        ]),
      );
    },
    async writeBatch(batch, mode) {
      this.writeCount++;
      this.maxActive = Math.max(this.maxActive, ++this.active);
      try {
        await this.beforeWrite?.(this.writeCount, batch, mode);
        if (this.failWrites-- > 0)
          throw new Error("database locked during write");
        for (const [table, rows] of Object.entries(batch)) {
          for (const row of rows) {
            const id = key(table, row);
            const current = tables[table].get(id);
            const next = { ...row };
            if (current && (table === "pages" || table === "days")) {
              next.seconds =
                mode === "add"
                  ? current.seconds + row.seconds
                  : Math.max(current.seconds, row.seconds);
            } else if (current && table === "meta") {
              next.firstRead = !current.firstRead
                ? row.firstRead
                : !row.firstRead
                  ? current.firstRead
                  : Math.min(current.firstRead, row.firstRead);
              next.lastRead = Math.max(current.lastRead, row.lastRead);
            }
            tables[table].set(id, next);
          }
        }
      } finally {
        this.active--;
      }
    },
    async remove(matches) {
      this.deleteCount++;
      this.maxActive = Math.max(this.maxActive, ++this.active);
      try {
        await this.beforeDelete?.();
        if (this.failDeletes-- > 0)
          throw new Error("database locked during delete");
        for (const rows of Object.values(tables)) {
          for (const [id, row] of rows) if (matches(row)) rows.delete(id);
        }
      } finally {
        this.active--;
      }
    },
    deleteItem(libraryID, itemKey) {
      return this.remove(
        (r) => r.libraryID === libraryID && r.itemKey === itemKey,
      );
    },
    deleteAll() {
      return this.remove(() => true);
    },
    seconds(libraryID = 1, itemKey = ITEM) {
      return [...tables.pages.values()]
        .filter((r) => r.libraryID === libraryID && r.itemKey === itemKey)
        .reduce((sum, row) => sum + row.seconds, 0);
    },
  };
  for (const row of seed) tables.pages.set(key("pages", row), row);
  return db;
}

function setup(db = database(), zotero = {}) {
  const timers = new Map();
  let timerID = 0;
  const h = createHarness({
    mocks: {
      "src/core/db.ts": { zestDB: db },
      "src/utils/prefs.ts": { getNumPref: (_key, fallback) => fallback },
      "src/utils/locale.ts": { getString: (key) => key },
      "src/utils/timers.ts": {
        setInterval: (fn) => {
          timers.set(++timerID, fn);
          return timerID;
        },
        clearInterval: (id) => timers.delete(id),
      },
    },
    globals: { Zotero: zotero },
  });
  const { readingStore } = h.load("src/reading/store.ts");
  return { h, db, store: readingStore, timers };
}

const sample = (store, seconds, itemKey = ITEM, now = NOW) =>
  store.addSample(1, itemKey, ATT, 0, seconds, 10, now);
const record = (seconds, itemKey = ITEM) => ({
  libraryID: 1,
  itemKey,
  atts: { [ATT]: { pages: 10, page: { 0: seconds } } },
  days: { [DAY]: seconds },
});
const seed = (seconds) => [
  { libraryID: 1, itemKey: ITEM, attKey: ATT, pageIndex: 0, seconds },
];

test("a failed max import leaves memory unchanged and retry persists every row", async () => {
  const { store, db } = setup(database(seed(10)));
  await store.load();
  db.failWrites = 1;
  await assert.rejects(store.mergeRecord(record(60), "max"), /locked/);
  assert.equal(store.get(1, ITEM).total, 10);
  assert.equal(db.seconds(), 10);
  await store.mergeRecord(record(60), "max");
  assert.equal(store.get(1, ITEM).total, 60);
  assert.equal(db.seconds(), 60);
  await store.mergeRecord(record(60), "max");
  assert.equal(db.seconds(), 60);
});

test("a failed pending flush blocks import, and retry does not double-count live time", async () => {
  const { store, db } = setup();
  await store.load();
  sample(store, 10);
  db.failWrites = 1;
  await assert.rejects(store.mergeRecord(record(60), "max"), /locked/);
  assert.equal(db.writeCount, 1);
  assert.equal(store.get(1, ITEM).total, 10);
  assert.equal(db.seconds(), 0);
  await store.mergeRecord(record(60), "max");
  await store.flush();
  assert.equal(db.seconds(), 60);
  assert.equal(store.get(1, ITEM).total, 60);
});

test("samples arriving during drain and merge commit are retained exactly once", async () => {
  const { store, db } = setup();
  await store.load();
  sample(store, 10);
  const draining = deferred(),
    drainRelease = deferred(),
    merging = deferred(),
    mergeRelease = deferred();
  db.beforeWrite = async (call) => {
    if (call === 1) {
      draining.resolve();
      await drainRelease.promise;
    }
    if (call === 2) {
      merging.resolve();
      await mergeRelease.promise;
    }
  };
  const merged = store.mergeRecord(record(60), "max");
  await draining.promise;
  sample(store, 5);
  drainRelease.resolve();
  await merging.promise;
  sample(store, 7);
  assert.equal(store.get(1, ITEM).total, 22);
  mergeRelease.resolve();
  await merged;
  assert.equal(store.get(1, ITEM).total, 72);
  assert.equal(store.get(1, ITEM).days.get(DAY), 72);
  assert.equal(db.seconds(), 60);
  await store.flush();
  assert.equal(db.seconds(), 72);
  assert.equal(db.maxActive, 1);
});

test("concurrent sum imports, flushes and clears execute in invocation order", async () => {
  const { store, db } = setup();
  await store.load();
  await Promise.all([
    store.mergeRecord(record(10), "sum"),
    store.mergeRecord(record(20), "sum"),
    store.flush(),
  ]);
  assert.equal(store.get(1, ITEM).total, 30);
  assert.equal(db.seconds(), 30);
  await Promise.all([
    store.clearItem(1, ITEM),
    store.mergeRecord(record(5), "sum"),
  ]);
  assert.equal(store.get(1, ITEM).total, 5);
  assert.equal(db.seconds(), 5);
  assert.equal(db.maxActive, 1);
});

test("failed clear preserves visible state; successful clear keeps new samples", async () => {
  const { store, db } = setup(database(seed(20)));
  await store.load();
  db.failDeletes = 1;
  await assert.rejects(store.clearItem(1, ITEM), /locked/);
  assert.equal(store.get(1, ITEM).total, 20);
  assert.equal(db.seconds(), 20);
  const deleting = deferred(),
    release = deferred();
  db.beforeDelete = async () => {
    deleting.resolve();
    await release.promise;
  };
  const clear = store.clearItem(1, ITEM);
  await deleting.promise;
  sample(store, 6);
  release.resolve();
  await clear;
  assert.equal(store.get(1, ITEM).total, 6);
  await store.flush();
  assert.equal(db.seconds(), 6);
});

test("clearAll preserves new samples in existing and newly created records", async () => {
  const { store, db } = setup(database(seed(20)));
  await store.load();
  const deleting = deferred(),
    release = deferred();
  db.beforeDelete = async () => {
    deleting.resolve();
    await release.promise;
  };
  const clear = store.clearAll();
  await deleting.promise;
  sample(store, 4);
  sample(store, 8, "READ0002");
  release.resolve();
  await clear;
  assert.equal(store.get(1, ITEM).total, 4);
  assert.equal(store.get(1, "READ0002").total, 8);
  await store.flush();
  assert.equal(db.seconds(), 4);
  assert.equal(db.seconds(1, "READ0002"), 8);
});

test("failed startup load remains retryable and overlays pending samples once", async () => {
  const { store, db, timers } = setup(database(seed(10)));
  db.failLoads = 1;
  sample(store, 7);
  await store.load();
  assert.equal(store.loaded, false);
  assert.equal(store.get(1, ITEM).total, 7);
  assert.equal(timers.size, 1, "a retry timer remains armed");
  assert.equal(await store.flush(), true);
  assert.equal(store.loaded, true);
  assert.equal(store.get(1, ITEM).total, 17);
  assert.equal(db.seconds(), 17);
  await store.load();
  assert.equal(db.loadCount, 2);
  assert.equal(store.get(1, ITEM).total, 17);
  await store.shutdown();
  assert.equal(timers.size, 0);
});

test("a rejected background flush requeues deltas and reports false without throwing", async () => {
  const { store, db } = setup();
  await store.load();
  sample(store, 4);
  const entered = deferred(),
    release = deferred();
  db.beforeWrite = async (call) => {
    if (call === 1) {
      entered.resolve();
      await release.promise;
    }
  };
  db.failWrites = 1;
  const flushing = store.flush();
  await entered.promise;
  sample(store, 6);
  release.resolve();
  assert.equal(await flushing, false);
  assert.equal(store.get(1, ITEM).total, 10);
  assert.equal(await store.flush(), true);
  assert.equal(db.seconds(), 10);
});

test("shutdown waits for an import and persists samples already queued", async () => {
  const { store, db, timers } = setup();
  await store.load();
  const entered = deferred(),
    release = deferred();
  db.beforeWrite = async (call) => {
    if (call === 1) {
      entered.resolve();
      await release.promise;
    }
  };
  const merge = store.mergeRecord(record(60), "max");
  await entered.promise;
  sample(store, 5);
  const closing = store.shutdown();
  sample(store, 99); // tracker callbacks after stop must not create unflushable data
  release.resolve();
  await Promise.all([merge, closing]);
  assert.equal(db.seconds(), 65);
  assert.equal(store.get(1, ITEM).total, 65);
  assert.equal(timers.size, 0);
  await assert.rejects(store.clearAll(), /stopped/);
});

function libraries() {
  const byKey = new Map();
  const add = (lib, key, options = {}) => {
    const item = {
      libraryID: lib,
      key,
      id: byKey.size + 1,
      deleted: false,
      parentID: false,
      isRegularItem: () => true,
      isAttachment: () => false,
      getField: () => `Title: ${key}`,
      ...options,
    };
    byKey.set(`${lib}/${key}`, item);
    return item;
  };
  const zotero = {
    Items: {
      getByLibraryAndKey: (lib, key) => byKey.get(`${lib}/${key}`) || false,
    },
    Libraries: {
      userLibraryID: 8,
      getAll: () => [8, 9, 10].map((libraryID) => ({ libraryID })),
      getType: (id) => (id === 8 ? "user" : "group"),
    },
    Groups: {
      getGroupIDFromLibraryID: (id) => ({ 9: 234, 10: 567 })[id],
      getLibraryIDFromGroupID: (id) => ({ 234: 9, 567: 10 })[id] || false,
    },
    Users: { getCurrentUserID: () => 123, getLocalUserKey: () => "LOCAL001" },
  };
  return { add, zotero };
}
const exported = (
  itemKey = ITEM,
  library = { type: "group", groupID: 234 },
) => ({
  libraryID: 4,
  library,
  itemKey,
  title: 'A "quoted", multiline\ntitle',
  pages: 10,
  pages_seconds: { 0: 60 },
  attachments: { [ATT]: { pages: 10, pages_seconds: { 0: 60 } } },
  firstRead: 100,
  lastRead: 200,
  days: { [DAY]: 60 },
});

for (const format of ["JSON", "CSV"]) {
  test(`${format} round trip maps group identity despite changed local libraryID`, async () => {
    const { add, zotero } = libraries();
    add(9, ITEM);
    add(10, ITEM); // identical item key in a different group must not interfere
    const { h, store, db } = setup(undefined, zotero);
    const api = h.load("src/reading/exportImport.ts");
    const text = api[`to${format}`]([exported()]);
    const items = api[`from${format}`](text);
    assert.equal(items[0].library.groupID, 234);
    assert.equal(items[0].title, exported().title);
    const result = await api.importItems(items, "max");
    assert.deepEqual(plain(result), {
      items: 1,
      matched: 1,
      skipped: 0,
      ambiguous: 0,
      seconds: 60,
    });
    assert.equal(db.seconds(9), 60);
    assert.equal(store.get(4, ITEM), undefined);
    assert.equal(store.get(10, ITEM), undefined);
    const collected = api.collectExport();
    assert.deepEqual(plain(collected[0].library), {
      type: "group",
      groupID: 234,
    });
  });
}

test("user identity and unsynced profile identity resolve only to the matching user", async () => {
  const { add, zotero } = libraries();
  add(8, ITEM);
  const { h, db } = setup(undefined, zotero);
  const api = h.load("src/reading/exportImport.ts");
  const input = [
    exported(ITEM, { type: "user", userID: 123 }),
    exported(ITEM, { type: "user", userID: 999 }),
    exported(ITEM, { type: "user", localUserKey: "LOCAL001" }),
    exported(ITEM, { type: "user", localUserKey: "OTHER001" }),
  ];
  const result = await api.importItems(api.fromJSON(api.toJSON(input)), "max");
  assert.equal(result.matched, 2);
  assert.equal(result.skipped, 2);
  assert.equal(db.seconds(8), 60);
});

test("legacy imports remap unique keys and report ambiguous, deleted and missing targets", async () => {
  const { add, zotero } = libraries();
  add(9, ITEM);
  add(9, "DUPL0001");
  add(10, "DUPL0001");
  add(9, "GONE0001", { deleted: true });
  add(9, "CHLD0001", {
    parentID: 5,
    isRegularItem: () => false,
    isAttachment: () => true,
  });
  const { h, db } = setup(undefined, zotero);
  const api = h.load("src/reading/exportImport.ts");
  const input = [ITEM, "DUPL0001", "GONE0001", "CHLD0001", "MISS0001"].map(
    (key) => {
      const it = exported(key);
      delete it.library;
      return it;
    },
  );
  const progress = [];
  const result = await api.importItems(
    api.fromJSON(JSON.stringify({ version: 1, items: input })),
    "max",
    (done) => progress.push(done),
  );
  assert.deepEqual(plain(result), {
    items: 1,
    matched: 1,
    skipped: 4,
    ambiguous: 1,
    seconds: 60,
  });
  assert.deepEqual(progress, [1, 2, 3, 4, 5]);
  assert.equal(db.seconds(9), 60);
});

test("legacy CSV headers remain importable without treating invalid identity as legacy", async () => {
  const { add, zotero } = libraries();
  add(9, ITEM);
  const { h } = setup(undefined, zotero);
  const api = h.load("src/reading/exportImport.ts");
  const legacy = api.fromCSV(
    `libraryID,itemKey,title,kind,key,seconds\n4,${ITEM},Paper,page,0,40\n`,
  );
  assert.equal((await api.importItems(legacy, "max")).matched, 1);
  const bad = api.fromJSON(
    JSON.stringify([
      exported(ITEM, { type: "invalid", localUserKey: "LOCAL001" }),
    ]),
  );
  assert.equal((await api.importItems(bad, "max")).skipped, 1);
  const missingGroup = exported(ITEM, { type: "group", groupID: 999 });
  assert.equal((await api.importItems([missingGroup], "max")).skipped, 1);
});
