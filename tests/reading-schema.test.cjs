const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHarness } = require("./helpers.cjs");

const V1 = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
INSERT INTO meta VALUES ('schema','1');
CREATE TABLE page_time (libraryID INTEGER NOT NULL, itemKey TEXT NOT NULL,
 pageIndex INTEGER NOT NULL, seconds INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY (libraryID,itemKey,pageIndex)) WITHOUT ROWID;
CREATE TABLE daily_time (libraryID INTEGER NOT NULL, itemKey TEXT NOT NULL,
 day TEXT NOT NULL, seconds INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY (libraryID,itemKey,day)) WITHOUT ROWID;
CREATE TABLE item_meta (libraryID INTEGER NOT NULL, itemKey TEXT NOT NULL,
 pages INTEGER NOT NULL DEFAULT 0, firstRead INTEGER NOT NULL DEFAULT 0,
 lastRead INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (libraryID,itemKey)) WITHOUT ROWID;
INSERT INTO page_time VALUES (1,'READ0001',0,3600);
INSERT INTO daily_time VALUES (1,'READ0001','2026-09-06',3600);
INSERT INTO item_meta VALUES (1,'READ0001',10,100,200);
`;
const plain = (value) => JSON.parse(JSON.stringify(value));

// The host methods below execute actual SQLite, including transactional DDL
// and rollback. Only the host API boundary and injected failures are doubles.
function fixture(t, sql = V1) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zest-schema-"));
  const file = path.join(dir, "zest.sqlite");
  let sqlite = new DatabaseSync(file);
  sqlite.exec("PRAGMA journal_mode=WAL");
  sqlite.exec(sql);
  const conn = {
    statements: [],
    backups: [],
    failQuery: 0,
    failAfterQuery: false,
    failBackup: false,
    failCommit: false,
    async queryAsync(sql, params = [], options) {
      this.statements.push(sql);
      const fail = this.statements.length === this.failQuery;
      if (fail && !this.failAfterQuery) throw new Error("injected query fault");
      const stmt = sqlite.prepare(sql);
      const rows = /^(SELECT|PRAGMA)/i.test(sql.trim())
        ? stmt.all(...params)
        : (stmt.run(...params), undefined);
      if (options?.onRow)
        for (const row of rows)
          options.onRow({ getResultByIndex: (i) => Object.values(row)[i] });
      if (fail) throw new Error("injected query fault");
      return rows;
    },
    async valueQueryAsync(sql, params = []) {
      const row = (await this.queryAsync(sql, params))[0];
      return row ? Object.values(row)[0] : false;
    },
    async tableExists(name) {
      return !!(await this.valueQueryAsync(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        [name],
      ));
    },
    async executeTransaction(fn) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        await fn();
        if (this.failCommit) throw new Error("injected commit fault");
        sqlite.exec("COMMIT");
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
    async backupDatabase(suffix, force) {
      assert.equal(force, true);
      if (this.failBackup) return false;
      const backup = path.join(dir, `${suffix}.bak`);
      sqlite.prepare("VACUUM INTO ?").run(backup);
      this.backups.push(backup);
      return true;
    },
    async closeDatabase() {
      sqlite.close();
    },
    reopen() {
      sqlite.close();
      sqlite = new DatabaseSync(file);
    },
    sql: (sql) => sqlite.exec(sql),
    rows: (sql) => plain(sqlite.prepare(sql).all()),
    snapshot: () => {
      const tables = sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        )
        .all();
      return plain({
        schema: sqlite
          .prepare("SELECT type,name,sql FROM sqlite_master ORDER BY type,name")
          .all(),
        tables: tables.map(({ name }) => [
          name,
          sqlite.prepare(`SELECT * FROM ${name}`).all(),
        ]),
      });
    },
  };
  t.after(() => {
    try {
      sqlite.close();
    } catch {
      // Fault-injection cases may already have closed the native handle.
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const h = createHarness({
    globals: {
      Zotero: {
        DBConnection: function () {
          return conn;
        },
        logError() {},
      },
    },
  });
  const { initializeReadingSchema, zestDB } = h.load("src/core/db.ts");
  return { h, conn, initializeReadingSchema, zestDB };
}

function assertV2(conn) {
  assert.deepEqual(conn.rows("SELECT * FROM meta"), [
    { key: "schema", value: "2" },
  ]);
  assert.deepEqual(conn.rows("SELECT * FROM page_time"), [
    {
      libraryID: 1,
      itemKey: "READ0001",
      attKey: "",
      pageIndex: 0,
      seconds: 3600,
    },
  ]);
  assert.deepEqual(conn.rows("SELECT * FROM att_meta"), [
    { libraryID: 1, itemKey: "READ0001", attKey: "", pages: 10 },
  ]);
  assert.deepEqual(conn.rows("SELECT * FROM item_meta"), [
    { libraryID: 1, itemKey: "READ0001", firstRead: 100, lastRead: 200 },
  ]);
  assert.deepEqual(conn.rows("SELECT * FROM daily_time"), [
    { libraryID: 1, itemKey: "READ0001", day: "2026-09-06", seconds: 3600 },
  ]);
}

test("v1 migration preserves every table and keeps a verified pre-upgrade SQLite backup", async (t) => {
  const { conn, initializeReadingSchema } = fixture(t);
  const before = conn.snapshot();
  await initializeReadingSchema(conn);
  assertV2(conn);
  assert.equal(conn.backups.length, 1);
  const backup = new DatabaseSync(conn.backups[0]);
  assert.equal(backup.prepare("PRAGMA quick_check").get().quick_check, "ok");
  assert.deepEqual(
    plain(backup.prepare("SELECT * FROM page_time").all()),
    before.tables.find(([name]) => name === "page_time")[1],
  );
  assert.equal(
    backup.prepare("SELECT value FROM meta WHERE key='schema'").get().value,
    "1",
  );
  backup.close();
  conn.reopen();
  await initializeReadingSchema(conn);
  assertV2(conn);
  assert.equal(
    conn.backups.length,
    1,
    "reopening v2 does not create another migration backup",
  );
});

test("every query boundary rolls back or leaves an untouched v1 database and can retry", async (t) => {
  const baseline = fixture(t);
  await baseline.initializeReadingSchema(baseline.conn);
  const count = baseline.conn.statements.length;
  for (const after of [false, true]) {
    for (let index = 1; index <= count; index++) {
      const { conn, initializeReadingSchema } = fixture(t);
      const before = conn.snapshot();
      conn.failQuery = index;
      conn.failAfterQuery = after;
      await assert.rejects(
        initializeReadingSchema(conn),
        /injected query fault/,
        `query ${index}, after=${after}`,
      );
      conn.reopen();
      assert.deepEqual(
        conn.snapshot(),
        before,
        `query ${index}, after=${after} preserves v1`,
      );
      conn.failQuery = 0;
      await initializeReadingSchema(conn);
      assertV2(conn);
    }
  }
});

test("a real SQLite schema-marker write failure rolls back migrated tables", async (t) => {
  const { conn, initializeReadingSchema } = fixture(t);
  conn.sql(
    "CREATE TRIGGER reject_schema BEFORE INSERT ON meta WHEN NEW.key='schema' BEGIN SELECT RAISE(FAIL,'schema write denied'); END",
  );
  const before = conn.snapshot();
  await assert.rejects(initializeReadingSchema(conn), /schema write denied/);
  conn.reopen();
  assert.deepEqual(conn.snapshot(), before);
  conn.sql("DROP TRIGGER reject_schema");
  await initializeReadingSchema(conn);
  assertV2(conn);
});

test("backup and commit failures leave data unchanged", async (t) => {
  for (const property of ["failBackup", "failCommit"]) {
    const { conn, initializeReadingSchema } = fixture(t);
    const before = conn.snapshot();
    conn[property] = true;
    await assert.rejects(
      initializeReadingSchema(conn),
      /backup failed|commit fault/,
    );
    conn.reopen();
    assert.deepEqual(conn.snapshot(), before);
    conn[property] = false;
    await initializeReadingSchema(conn);
    assertV2(conn);
  }
});

test("already committed v2 tables with a stale or absent marker are repaired without recopying", async (t) => {
  for (const marker of ["UPDATE meta SET value='1'", "DELETE FROM meta"]) {
    const { conn, initializeReadingSchema } = fixture(t);
    await initializeReadingSchema(conn);
    conn.sql(marker);
    await initializeReadingSchema(conn);
    assertV2(conn);
    assert.equal(conn.backups.length, 2);
    conn.reopen();
    await initializeReadingSchema(conn);
    assertV2(conn);
  }
});

test("future and unrecognised partial layouts are never written or guessed", async (t) => {
  for (const mutation of [
    "UPDATE meta SET value='3'",
    "UPDATE meta SET value='invalid'",
    "ALTER TABLE page_time RENAME TO page_time_v1",
    "ALTER TABLE item_meta ADD COLUMN unknown TEXT",
    "CREATE TABLE att_meta (unexpected INTEGER)",
    "DROP TABLE daily_time",
  ]) {
    const { conn, initializeReadingSchema } = fixture(t);
    conn.sql(mutation);
    const before = conn.snapshot();
    await assert.rejects(initializeReadingSchema(conn), /schema/i);
    assert.deepEqual(conn.snapshot(), before);
    assert.equal(conn.backups.length, 0);
  }
});

test("fresh schema creation is atomic when the final marker fails", async (t) => {
  const { conn, initializeReadingSchema } = fixture(t, "");
  conn.failAfterQuery = true;
  const original = conn.queryAsync;
  conn.queryAsync = async function (sql, ...args) {
    if (/INSERT OR REPLACE INTO meta/.test(sql))
      this.failQuery = this.statements.length + 1;
    return original.call(this, sql, ...args);
  };
  await assert.rejects(initializeReadingSchema(conn), /query fault/);
  assert.deepEqual(conn.snapshot(), { schema: [], tables: [] });
  conn.queryAsync = original;
  conn.failQuery = 0;
  await initializeReadingSchema(conn);
  assert.equal(
    conn.rows("SELECT value FROM meta WHERE key='schema'")[0].value,
    "2",
  );
});

for (const mode of ["max", "sum"]) {
  test(`real SQLite rolls back the first imported item when the second fails (${mode})`, async (t) => {
    const { h, conn, zestDB } = fixture(t, "");
    h.mocks["src/utils/locale.ts"] = { getString: (key) => key };
    h.mocks["src/utils/timers.ts"] = { setInterval() {}, clearInterval() {} };
    assert.equal(await zestDB.init(), true);
    const { readingStore: store } = h.load("src/reading/store.ts");
    const record = (key, seconds) => ({
      libraryID: 1,
      itemKey: key,
      page: { 0: seconds },
      pages: 10,
      days: { "2026-09-15": seconds },
    });
    await store.mergeRecord(record("READ0001", 10), "max");
    conn.sql(
      "CREATE TRIGGER reject_second BEFORE INSERT ON page_time WHEN NEW.itemKey='READ0002' BEGIN SELECT RAISE(ABORT,'second row fault'); END;",
    );
    const before = conn.snapshot();
    await assert.rejects(
      store.mergeRecords(
        [record("READ0001", 60), record("READ0002", 30)],
        mode,
      ),
      /second row fault/,
    );
    assert.deepEqual(conn.snapshot(), before);
    assert.equal(store.get(1, "READ0001").total, 10);
    assert.equal(store.get(1, "READ0002"), undefined);
    conn.sql("DROP TRIGGER reject_second");
    await store.mergeRecords(
      [record("READ0001", 60), record("READ0002", 30)],
      mode,
    );
    assert.deepEqual(
      conn.rows("SELECT itemKey,seconds FROM page_time ORDER BY itemKey"),
      [
        { itemKey: "READ0001", seconds: mode === "sum" ? 70 : 60 },
        { itemKey: "READ0002", seconds: 30 },
      ],
    );
    assert.equal(store.get(1, "READ0001").total, mode === "sum" ? 70 : 60);
    assert.equal(store.get(1, "READ0002").total, 30);
  });
}
