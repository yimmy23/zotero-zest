/** Native SQLite migration regression; only disposable .scaffold fixtures. */
const out = { ok: [], fail: [], notes: [], summary: "" };
const check = (name, condition) => (condition ? out.ok : out.fail).push(name);
if (
  !String(PathUtils.profileDir).endsWith("/.scaffold/dev-profile") ||
  !String(Zotero.DataDirectory.dir).endsWith("/.scaffold/dev-data")
) {
  out.fail.push("Isolated development profile and data directory required");
  out.summary = "0 passed, 1 failed; no fixture created";
  return out;
}
if (typeof dev.dbModule?.initializeReadingSchema !== "function") {
  out.fail.push("initializeReadingSchema dev export unavailable");
  out.summary = "0 passed, 1 failed; no fixture created";
  return out;
}
const dir = Zotero.DataDirectory.dir;
const name = `zest-reading-schema-probe-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const dbPath = Zotero.DataDirectory.getDatabase(name);
const preexisting = new Set(await IOUtils.getChildren(dir));
const belongsToFixture = (file) =>
  file === dbPath ||
  file.startsWith(dbPath + ".") ||
  file === dbPath + "-wal" ||
  file === dbPath + "-shm";
if ([...preexisting].some(belongsToFixture)) {
  out.fail.push("Generated fixture name already exists; no files changed");
  out.summary = "0 passed, 1 failed; no fixture created";
  return out;
}
let conn;
let closed = true;
const rows = async (sql, columns) =>
  (await conn.queryAsync(sql)).map((row) =>
    columns.map((column) => row[column]),
  );
const schemaVersion = () =>
  conn.valueQueryAsync("SELECT value FROM meta WHERE key='schema'");
const originalRows = {
  pages: [
    [1, "READ0001", 0, 3600],
    [2, "READ0002", -1, 25],
  ],
  days: [[1, "READ0001", "2026-09-06", 3600]],
  meta: [
    [1, "READ0001", 10, 100, 200],
    [2, "READ0002", 0, 110, 210],
  ],
};
async function capture(version) {
  const pageColumns = [
    "libraryID",
    "itemKey",
    ...(version === 2 ? ["attKey"] : []),
    "pageIndex",
    "seconds",
  ];
  const metaColumns = [
    "libraryID",
    "itemKey",
    ...(version === 1 ? ["pages"] : []),
    "firstRead",
    "lastRead",
  ];
  return {
    pages: await rows(
      `SELECT ${pageColumns.join(",")} FROM page_time ORDER BY libraryID,itemKey,pageIndex`,
      pageColumns,
    ),
    days: await rows(
      "SELECT libraryID,itemKey,day,seconds FROM daily_time ORDER BY libraryID,itemKey,day",
      ["libraryID", "itemKey", "day", "seconds"],
    ),
    meta: await rows(
      `SELECT ${metaColumns.join(",")} FROM item_meta ORDER BY libraryID,itemKey`,
      metaColumns,
    ),
    ...(version === 2
      ? {
          atts: await rows(
            "SELECT libraryID,itemKey,attKey,pages FROM att_meta ORDER BY libraryID,itemKey,attKey",
            ["libraryID", "itemKey", "attKey", "pages"],
          ),
        }
      : {}),
  };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
try {
  // Named connections are deliberate: Zotero skips native backups for external
  // absolute-path connections. This name can only resolve inside dev-data.
  conn = new Zotero.DBConnection(name);
  closed = false;
  await conn.executeTransaction(async () => {
    for (const sql of [
      "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)",
      "INSERT INTO meta VALUES ('schema','1')",
      "CREATE TABLE page_time (libraryID INTEGER NOT NULL,itemKey TEXT NOT NULL,pageIndex INTEGER NOT NULL,seconds INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(libraryID,itemKey,pageIndex)) WITHOUT ROWID",
      "CREATE TABLE daily_time (libraryID INTEGER NOT NULL,itemKey TEXT NOT NULL,day TEXT NOT NULL,seconds INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(libraryID,itemKey,day)) WITHOUT ROWID",
      "CREATE TABLE item_meta (libraryID INTEGER NOT NULL,itemKey TEXT NOT NULL,pages INTEGER NOT NULL DEFAULT 0,firstRead INTEGER NOT NULL DEFAULT 0,lastRead INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(libraryID,itemKey)) WITHOUT ROWID",
      "INSERT INTO page_time VALUES (1,'READ0001',0,3600),(2,'READ0002',-1,25)",
      "INSERT INTO daily_time VALUES (1,'READ0001','2026-09-06',3600)",
      "INSERT INTO item_meta VALUES (1,'READ0001',10,100,200),(2,'READ0002',0,110,210)",
      "CREATE TRIGGER reject_schema BEFORE INSERT ON meta WHEN NEW.key='schema' BEGIN SELECT RAISE(FAIL,'schema write denied'); END",
    ])
      await conn.queryAsync(sql);
  });
  check("v1 fixture rows established", same(await capture(1), originalRows));
  let markerFailed = false;
  try {
    await dev.dbModule.initializeReadingSchema(conn);
  } catch (e) {
    markerFailed = /schema write denied/.test(String(e));
    if (!markerFailed) throw e;
  }
  check("real SQLite trigger rejects schema marker", markerFailed);
  // Reopen through the native connection to verify the durable rollback.
  await conn.closeDatabase();
  check(
    "failed marker rolls back schema version",
    String(await schemaVersion()) === "1",
  );
  check(
    "failed marker rolls back all original rows",
    same(await capture(1), originalRows),
  );
  check(
    "failed marker leaves no migrated or intermediate tables",
    !(await conn.tableExists("att_meta")) &&
      !(await conn.tableExists("page_time_v1")) &&
      !(await conn.tableExists("item_meta_v1")),
  );
  const firstBackups = (await IOUtils.getChildren(dir)).filter(
    (file) =>
      file.startsWith(dbPath + ".pre-schema-2-") && file.endsWith(".bak"),
  );
  check(
    "native pre-upgrade backup exists after failure",
    firstBackups.length === 1 && (await IOUtils.stat(firstBackups[0])).size > 0,
  );
  await conn.queryAsync("DROP TRIGGER reject_schema");
  await dev.dbModule.initializeReadingSchema(conn);
  check("retry advances schema to v2", String(await schemaVersion()) === "2");
  const migrated = await capture(2);
  const expected = {
    pages: [
      [1, "READ0001", "", 0, 3600],
      [2, "READ0002", "", -1, 25],
    ],
    days: originalRows.days,
    meta: [
      [1, "READ0001", 100, 200],
      [2, "READ0002", 110, 210],
    ],
    atts: [[1, "READ0001", "", 10]],
  };
  check(
    "retry preserves page, day, timestamp and attachment metadata",
    same(migrated, expected),
  );
  await conn.queryAsync("UPDATE meta SET value='1' WHERE key='schema'");
  await dev.dbModule.initializeReadingSchema(conn);
  check(
    "already migrated layout repairs stale v1 marker",
    String(await schemaVersion()) === "2",
  );
  check(
    "stale-marker repair never recopies or duplicates reading rows",
    same(await capture(2), expected),
  );
  const backups = (await IOUtils.getChildren(dir)).filter(
    (file) =>
      file.startsWith(dbPath + ".pre-schema-2-") && file.endsWith(".bak"),
  );
  check(
    "migration retry and stale-marker repair retain distinct backups",
    backups.length === 3,
  );
  await dev.dbModule.initializeReadingSchema(conn);
  check(
    "repeated v2 initialization remains idempotent",
    same(await capture(2), expected),
  );
  check(
    "native SQLite quick_check passes",
    String(await conn.valueQueryAsync("PRAGMA quick_check")) === "ok",
  );
  out.notes.push(
    "Validated on named fixture " +
      name +
      "; backup includes Zotero's native SQLite/WAL handling.",
  );
} catch (e) {
  out.fail.push(String(e));
} finally {
  if (conn) {
    try {
      await conn.closeDatabase(true);
      closed = true;
    } catch (e) {
      out.fail.push("fixture close failed: " + String(e));
    }
    // Some supported Zotero builds leave the idle-backup observer registered
    // on permanent close. Remove only this fixture connection's observer.
    try {
      Components.classes["@mozilla.org/widget/useridleservice;1"]
        .getService(Components.interfaces.nsIUserIdleService)
        .removeIdleObserver(conn, 300);
    } catch {
      // Permanent close may already have removed it.
    }
  }
  if (closed) {
    try {
      for (const file of await IOUtils.getChildren(dir)) {
        if (!preexisting.has(file) && belongsToFixture(file))
          await IOUtils.remove(file);
      }
      check(
        "all owned fixture database and backup files removed",
        !(await IOUtils.getChildren(dir)).some(
          (file) => !preexisting.has(file) && belongsToFixture(file),
        ),
      );
    } catch (e) {
      out.fail.push("fixture cleanup failed: " + String(e));
    }
  } else
    out.notes.push(
      "Fixture files retained because the native connection did not close.",
    );
}
out.summary = `${out.ok.length} passed, ${out.fail.length} failed`;
return out;
