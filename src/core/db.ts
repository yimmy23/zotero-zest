import { config } from "../../package.json";

/**
 * Plugin-owned SQLite database (`<Zotero data dir>/zest.sqlite`) opened with
 * Zotero's own `Zotero.DBConnection` (same machinery as zotero.sqlite:
 * mozStorage async connection, EXCLUSIVE lock, cached statements, idle
 * backups to `.bak`). Reading records live here — never in the main
 * library database, never in hidden items or notes.
 *
 * Rules (from db.js 9.0.6 / 10.0):
 * - `closeDatabase(true)` on shutdown and never re-open afterwards (a late
 *   write would open a second, never-closed connection that blocks Zotero's
 *   Sqlite shutdown barrier); the idle-backup observer Zotero registers on
 *   open must be removed too.
 * - `queryAsync` returns rows only for statements whose first token is
 *   select/pragma; upserts return undefined.
 * - Params: no booleans/undefined; use numbers/strings/null.
 * - Zotero 10 turns on WAL for named connections (extra `-wal` file).
 * - A failed open is NOT memoised: the next call retries, and writers throw
 *   so the store keeps its pending deltas instead of dropping them.
 *
 * Schema v2: page_time is keyed per ATTACHMENT (attKey; '' = unattributed,
 * used by legacy imports) so a 12-page article and its 60-page supplement do
 * not share one page map.
 */

const SCHEMA_VERSION = 2;

const SCHEMA_V2 = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS page_time (
  libraryID INTEGER NOT NULL,
  itemKey   TEXT    NOT NULL,
  attKey    TEXT    NOT NULL DEFAULT '',
  pageIndex INTEGER NOT NULL,
  seconds   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (libraryID, itemKey, attKey, pageIndex)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS att_meta (
  libraryID INTEGER NOT NULL,
  itemKey   TEXT    NOT NULL,
  attKey    TEXT    NOT NULL DEFAULT '',
  pages     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (libraryID, itemKey, attKey)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS daily_time (
  libraryID INTEGER NOT NULL,
  itemKey   TEXT    NOT NULL,
  day       TEXT    NOT NULL,
  seconds   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (libraryID, itemKey, day)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS item_meta (
  libraryID INTEGER NOT NULL,
  itemKey   TEXT    NOT NULL,
  firstRead INTEGER NOT NULL DEFAULT 0,
  lastRead  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (libraryID, itemKey)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS daily_time_day ON daily_time (day);
`;

/** v1 → v2: page_time gains attKey (PK change → rebuild); item_meta.pages → att_meta('') */
const MIGRATE_1_TO_2 = `
ALTER TABLE page_time RENAME TO page_time_v1;
CREATE TABLE page_time (
  libraryID INTEGER NOT NULL,
  itemKey   TEXT    NOT NULL,
  attKey    TEXT    NOT NULL DEFAULT '',
  pageIndex INTEGER NOT NULL,
  seconds   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (libraryID, itemKey, attKey, pageIndex)
) WITHOUT ROWID;
INSERT INTO page_time (libraryID, itemKey, attKey, pageIndex, seconds)
  SELECT libraryID, itemKey, '', pageIndex, seconds FROM page_time_v1;
DROP TABLE page_time_v1;
CREATE TABLE IF NOT EXISTS att_meta (
  libraryID INTEGER NOT NULL,
  itemKey   TEXT    NOT NULL,
  attKey    TEXT    NOT NULL DEFAULT '',
  pages     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (libraryID, itemKey, attKey)
) WITHOUT ROWID;
INSERT OR REPLACE INTO att_meta (libraryID, itemKey, attKey, pages)
  SELECT libraryID, itemKey, '', pages FROM item_meta WHERE pages > 0;
ALTER TABLE item_meta RENAME TO item_meta_v1;
CREATE TABLE item_meta (
  libraryID INTEGER NOT NULL,
  itemKey   TEXT    NOT NULL,
  firstRead INTEGER NOT NULL DEFAULT 0,
  lastRead  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (libraryID, itemKey)
) WITHOUT ROWID;
INSERT INTO item_meta (libraryID, itemKey, firstRead, lastRead)
  SELECT libraryID, itemKey, firstRead, lastRead FROM item_meta_v1;
DROP TABLE item_meta_v1;
`;

export interface PageRow {
  libraryID: number;
  itemKey: string;
  attKey: string;
  /** -1 = page-less time (snapshots, readers without a page notion) */
  pageIndex: number;
  seconds: number;
}
export interface AttRow {
  libraryID: number;
  itemKey: string;
  attKey: string;
  pages: number;
}
export interface DayRow {
  libraryID: number;
  itemKey: string;
  day: string;
  seconds: number;
}
export interface MetaRow {
  libraryID: number;
  itemKey: string;
  firstRead: number;
  lastRead: number;
}

export class DBUnavailableError extends Error {
  constructor() {
    super("zest.sqlite unavailable");
    this.name = "DBUnavailableError";
  }
}

class ZestDB {
  private conn: any = null;
  private initPromise?: Promise<boolean>;
  /** permanent: after close() nothing may re-open (a new plugin instance gets a new singleton) */
  private closed = false;
  private lastErrorLog = 0;
  /** true once the schema is verified */
  ok = false;

  /** Idempotent while it succeeds; a failure is retried on the next call. */
  init(): Promise<boolean> {
    if (this.closed) return Promise.resolve(false);
    if (!this.initPromise) this.initPromise = this._init();
    return this.initPromise;
  }

  private async runScript(sql: string) {
    // one statement per call: executeCached rejects multi-statement SQL
    for (const stmt of sql.split(";")) {
      const s = stmt.trim();
      if (s) await this.conn.queryAsync(s);
    }
  }

  private async _init(): Promise<boolean> {
    try {
      this.conn = new (Zotero as any).DBConnection(config.addonRef);
      await this.conn.queryAsync(
        "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)",
      );
      const raw = await this.conn.valueQueryAsync(
        "SELECT value FROM meta WHERE key='schema'",
      );
      const hasPageTime = await this.conn.tableExists("page_time");
      let version = raw ? Number(raw) : hasPageTime ? 1 : 0;
      if (version > SCHEMA_VERSION) {
        ztoolkit.log(
          `[db] schema ${version} is newer than this build (${SCHEMA_VERSION}); read-only caution`,
        );
      }
      if (version === 1) {
        await this.conn.executeTransaction(async () => {
          await this.runScript(MIGRATE_1_TO_2);
        });
        version = 2;
        ztoolkit.log("[db] migrated schema 1 → 2");
      }
      await this.runScript(SCHEMA_V2);
      await this.conn.queryAsync(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', ?)",
        [String(Math.max(version, SCHEMA_VERSION))],
      );
      this.ok = true;
    } catch (e) {
      const now = Date.now();
      if (now - this.lastErrorLog > 60_000) {
        this.lastErrorLog = now;
        ztoolkit.log("[db] init failed", e);
        Zotero.logError(e as any);
      }
      // discard the half-open connection so the next attempt starts clean
      try {
        await this.conn?.closeDatabase?.();
      } catch {
        // ignore
      }
      this.conn = null;
      this.ok = false;
      this.initPromise = undefined;
    }
    return this.ok;
  }

  get path(): string {
    try {
      return (
        this.conn?._dbPath ||
        (Zotero.DataDirectory as any).getDatabase(config.addonRef)
      );
    } catch {
      return "";
    }
  }

  private async require() {
    if (!(await this.init())) throw new DBUnavailableError();
  }

  async loadAll(): Promise<{
    pages: PageRow[];
    atts: AttRow[];
    days: DayRow[];
    meta: MetaRow[];
  }> {
    await this.require();
    const pages: PageRow[] = [];
    const atts: AttRow[] = [];
    const days: DayRow[] = [];
    const meta: MetaRow[] = [];
    // onRow avoids materialising proxy objects for large tables
    await this.conn.queryAsync(
      "SELECT libraryID, itemKey, attKey, pageIndex, seconds FROM page_time",
      [],
      {
        onRow: (row: any) =>
          pages.push({
            libraryID: row.getResultByIndex(0),
            itemKey: row.getResultByIndex(1),
            attKey: row.getResultByIndex(2),
            pageIndex: row.getResultByIndex(3),
            seconds: row.getResultByIndex(4),
          }),
      },
    );
    await this.conn.queryAsync(
      "SELECT libraryID, itemKey, attKey, pages FROM att_meta",
      [],
      {
        onRow: (row: any) =>
          atts.push({
            libraryID: row.getResultByIndex(0),
            itemKey: row.getResultByIndex(1),
            attKey: row.getResultByIndex(2),
            pages: row.getResultByIndex(3),
          }),
      },
    );
    await this.conn.queryAsync(
      "SELECT libraryID, itemKey, day, seconds FROM daily_time",
      [],
      {
        onRow: (row: any) =>
          days.push({
            libraryID: row.getResultByIndex(0),
            itemKey: row.getResultByIndex(1),
            day: row.getResultByIndex(2),
            seconds: row.getResultByIndex(3),
          }),
      },
    );
    await this.conn.queryAsync(
      "SELECT libraryID, itemKey, firstRead, lastRead FROM item_meta",
      [],
      {
        onRow: (row: any) =>
          meta.push({
            libraryID: row.getResultByIndex(0),
            itemKey: row.getResultByIndex(1),
            firstRead: row.getResultByIndex(2),
            lastRead: row.getResultByIndex(3),
          }),
      },
    );
    return { pages, atts, days, meta };
  }

  /**
   * Apply a batch atomically. `mode`:
   *  - "add": seconds += delta (live tracking)
   *  - "max": seconds = max(seconds, value) (imports / migration, idempotent)
   * Throws DBUnavailableError when the DB cannot be opened (caller keeps its data).
   */
  async writeBatch(
    batch: {
      pages: PageRow[];
      atts: AttRow[];
      days: DayRow[];
      meta: MetaRow[];
    },
    mode: "add" | "max",
  ): Promise<void> {
    if (
      !batch.pages.length &&
      !batch.atts.length &&
      !batch.days.length &&
      !batch.meta.length
    ) {
      return;
    }
    await this.require();
    const op =
      mode === "add"
        ? "seconds = seconds + excluded.seconds"
        : "seconds = max(seconds, excluded.seconds)";
    await this.conn.executeTransaction(async () => {
      for (const r of batch.pages) {
        await this.conn.queryAsync(
          `INSERT INTO page_time (libraryID, itemKey, attKey, pageIndex, seconds) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(libraryID, itemKey, attKey, pageIndex) DO UPDATE SET ${op}`,
          [
            r.libraryID,
            r.itemKey,
            r.attKey || "",
            r.pageIndex,
            Math.round(r.seconds),
          ],
        );
      }
      for (const r of batch.atts) {
        if (!(r.pages > 0)) continue;
        await this.conn.queryAsync(
          `INSERT INTO att_meta (libraryID, itemKey, attKey, pages) VALUES (?, ?, ?, ?)
           ON CONFLICT(libraryID, itemKey, attKey) DO UPDATE SET pages = excluded.pages`,
          [r.libraryID, r.itemKey, r.attKey || "", r.pages | 0],
        );
      }
      for (const r of batch.days) {
        await this.conn.queryAsync(
          `INSERT INTO daily_time (libraryID, itemKey, day, seconds) VALUES (?, ?, ?, ?)
           ON CONFLICT(libraryID, itemKey, day) DO UPDATE SET ${op}`,
          [r.libraryID, r.itemKey, r.day, Math.round(r.seconds)],
        );
      }
      for (const r of batch.meta) {
        await this.conn.queryAsync(
          `INSERT INTO item_meta (libraryID, itemKey, firstRead, lastRead) VALUES (?, ?, ?, ?)
           ON CONFLICT(libraryID, itemKey) DO UPDATE SET
             firstRead = CASE WHEN firstRead = 0 THEN excluded.firstRead
                              WHEN excluded.firstRead = 0 THEN firstRead
                              ELSE min(firstRead, excluded.firstRead) END,
             lastRead = max(lastRead, excluded.lastRead)`,
          [r.libraryID, r.itemKey, r.firstRead | 0, r.lastRead | 0],
        );
      }
    });
  }

  async deleteItem(libraryID: number, itemKey: string): Promise<void> {
    await this.require();
    await this.conn.executeTransaction(async () => {
      for (const t of ["page_time", "att_meta", "daily_time", "item_meta"]) {
        await this.conn.queryAsync(
          `DELETE FROM ${t} WHERE libraryID=? AND itemKey=?`,
          [libraryID, itemKey],
        );
      }
    });
  }

  async deleteAll(): Promise<void> {
    await this.require();
    await this.conn.executeTransaction(async () => {
      for (const t of ["page_time", "att_meta", "daily_time", "item_meta"]) {
        await this.conn.queryAsync(`DELETE FROM ${t}`);
      }
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    const conn = this.conn;
    this.conn = null;
    this.ok = false;
    // keep initPromise as-is: init() short-circuits on `closed` before it
    if (!conn) return;
    // Zotero registers `conn` as an idle observer for backups when the
    // connection opens; drop it so a stray idle event cannot re-open the DB
    // after the plugin is gone.
    try {
      const idleService = (Components.classes as any)[
        "@mozilla.org/widget/useridleservice;1"
      ].getService(Components.interfaces.nsIUserIdleService);
      idleService.removeIdleObserver(conn, 300);
    } catch {
      // not registered (never opened) — fine
    }
    try {
      await conn.closeDatabase(true);
    } catch (e) {
      ztoolkit.log("[db] close failed", e);
    }
  }
}

export const zestDB = new ZestDB();
