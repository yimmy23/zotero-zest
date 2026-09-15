/** Native SQLite whole-file imports; isolated development profile only. */
const out = { ok: [], fail: [], notes: [] };
const check = (name, ok) => (ok ? out.ok : out.fail).push(name);
if (
  !String(PathUtils.profileDir).endsWith("/.scaffold/dev-profile") ||
  !String(Zotero.DataDirectory.dir).endsWith("/.scaffold/dev-data")
)
  throw Error("Isolated dev profile required");
const items = [];
const conn = dev.zestDB.conn;
const trigger = `zest_import_probe_${Date.now()}`;
let triggerActive = false;
const sum = async (item) =>
  Number(
    await conn.valueQueryAsync(
      "SELECT COALESCE(SUM(seconds),0) FROM page_time WHERE libraryID=? AND itemKey=?",
      [item.libraryID, item.key],
    ),
  );
const installFailure = async () => {
  if (!/^[A-Z0-9]{8}$/.test(items[1].key))
    throw Error("Unexpected generated item key");
  await conn.queryAsync(
    `CREATE TEMP TRIGGER ${trigger} BEFORE INSERT ON page_time WHEN NEW.itemKey='${items[1].key}' BEGIN SELECT RAISE(ABORT,'phase b second item fault'); END`,
  );
  triggerActive = true;
};
const removeFailure = async () => {
  if (triggerActive) {
    await conn.queryAsync(`DROP TRIGGER ${trigger}`);
    triggerActive = false;
  }
};
try {
  for (const n of [1, 2]) {
    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", `Zest Phase B atomic import ${n}`);
    await item.saveTx();
    items.push(item);
  }
  const input = items.map((item) => ({
    libraryID: item.libraryID,
    library: {
      type: "user",
      userID: Zotero.Users.getCurrentUserID(),
      localUserKey: Zotero.Users.getLocalUserKey(),
    },
    itemKey: item.key,
    pages: 1,
    pages_seconds: { 0: 60 },
    days: { "2026-09-15": 60 },
    firstRead: 0,
    lastRead: 0,
  }));
  for (const mode of ["sum", "max"]) {
    await installFailure();
    let failed = false;
    try {
      await dev.exportImport.importItems(input, mode);
    } catch (e) {
      failed = /phase b second item fault/.test(String(e));
    }
    check(`import.${mode}.secondItemActuallyFailed`, failed);
    check(
      `import.${mode}.earlierSQLiteRowsRolledBack`,
      (await sum(items[0])) === 0 && (await sum(items[1])) === 0,
    );
    check(
      `import.${mode}.memoryNotPublished`,
      items.every((item) => !dev.readingStore.getForItem(item)?.total),
    );
    await removeFailure();
    const result = await dev.exportImport.importItems(input, mode);
    check(
      `import.${mode}.retryExactlyOnce`,
      result.matched === 2 &&
        (await sum(items[0])) === 60 &&
        (await sum(items[1])) === 60 &&
        items.every((item) => dev.readingStore.getForItem(item)?.total === 60),
    );
    for (const item of items)
      await dev.readingStore.clearItem(item.libraryID, item.key);
  }
  const records = items.map((item) => ({
    libraryID: item.libraryID,
    itemKey: item.key,
    totalPages: 1,
    secondsByPage: new Map([[0, 60]]),
    source: { kind: "note", ref: "isolated probe" },
  }));
  const report = {
    parents: 0,
    notes: 2,
    parsed: 2,
    skipped: 0,
    files: 0,
    offsetFixed: 0,
    unresolved: 0,
    ambiguous: 0,
    merged: 0,
    totalSeconds: 0,
    details: [],
  };
  await installFailure();
  let failed = false;
  try {
    await dev.migrate.applyLegacy(records, "sum", report);
  } catch (e) {
    failed = /phase b second item fault/.test(String(e));
  }
  check(
    "legacy.failureDoesNotClaimPartialSuccess",
    failed && report.merged === 0 && report.totalSeconds === 0,
  );
  check(
    "legacy.allSQLiteRowsRolledBack",
    (await sum(items[0])) === 0 && (await sum(items[1])) === 0,
  );
  await removeFailure();
  await dev.migrate.applyLegacy(records, "sum", report, () => {
    throw Error("closed progress display");
  });
  check(
    "legacy.retryAndDisplayFailureDoNotDuplicate",
    report.merged === 2 &&
      report.totalSeconds === 120 &&
      (await sum(items[0])) === 60 &&
      (await sum(items[1])) === 60,
  );
} catch (e) {
  out.fail.push("probe completed");
  out.notes.push(String(e));
} finally {
  await removeFailure();
  for (const item of items) {
    await dev.readingStore.clearItem(item.libraryID, item.key);
    await item.eraseTx();
  }
}
out.summary = `${out.ok.length} passed, ${out.fail.length} failed`;
return out;
